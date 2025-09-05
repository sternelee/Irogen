use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::p2p::{P2PNetwork, EncryptionKey};
use crate::session_encrypt::SessionEncrypt;
use crate::terminal_impl::get_default_shell;

/// Shell ID，类似 sshx 中的 Sid
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ShellId(pub u64);

impl std::fmt::Display for ShellId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// 终端会话状态，类似 sshx 的会话持久化
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionState {
    pub session_id: String,
    pub session_name: String,
    pub session_key: String, // 改为字符串密钥
    pub created_at: u64,
    pub last_accessed: u64,
    pub shell_count: u32,
    pub current_directory: Option<String>,
}

/// 客户端消息类型，基于 sshx 的 ClientMessage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ClientMessage {
    /// Hello 握手消息，包含会话名称和认证令牌
    Hello { session_name: String, auth_token: String },

    /// 终端数据，包含 shell ID、数据和序列号
    TerminalData {
        shell_id: ShellId,
        data: Vec<u8>,
        sequence: u64,
    },

    /// 创建新 shell 的确认消息
    ShellCreated {
        shell_id: ShellId,
        x: i32,
        y: i32,
    },

    /// Shell 关闭消息
    ShellClosed {
        shell_id: ShellId,
    },

    /// 心跳响应
    Pong(u64),

    /// 错误消息
    Error(String),

    /// 窗口大小变更
    WindowResize {
        shell_id: ShellId,
        rows: u16,
        cols: u16,
    },
}

/// 服务器消息类型，基于 sshx 的 ServerMessage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerMessage {
    /// 输入数据到指定 shell
    Input {
        shell_id: ShellId,
        data: Vec<u8>,
        offset: u64,
    },

    /// 创建新 shell 请求
    CreateShell {
        shell_id: ShellId,
        x: i32,
        y: i32,
    },

    /// 关闭指定 shell
    CloseShell {
        shell_id: ShellId,
    },

    /// 同步序列号，用于数据一致性
    Sync {
        sequences: HashMap<ShellId, u64>,
    },

    /// 调整窗口大小
    Resize {
        shell_id: ShellId,
        rows: u16,
        cols: u16,
    },

    /// 心跳请求
    Ping(u64),

    /// 错误消息
    Error(String),
}

/// Shell 数据消息，内部使用
#[derive(Debug)]
pub enum ShellData {
    /// 来自网络的输入数据
    Data(Vec<u8>),
    /// 序列号同步信息
    Sync(u64),
    /// 窗口大小变更
    Size(u16, u16),
}

/// 共享终端会话管理器
pub struct SharedTerminalSession {
    session_id: String,
    session_name: String,
    session_encrypt: SessionEncrypt,

    /// P2P 网络连接
    network: Arc<P2PNetwork>,

    /// Shell 任务通信通道
    shells_tx: Arc<RwLock<HashMap<ShellId, mpsc::Sender<ShellData>>>>,

    /// 客户端消息发送通道
    client_tx: mpsc::Sender<ClientMessage>,
    client_rx: mpsc::Receiver<ClientMessage>,

    /// 服务器消息广播
    server_broadcast: broadcast::Sender<ServerMessage>,

    /// 下一个 Shell ID 计数器
    next_shell_id: Arc<RwLock<u64>>,
}

impl SharedTerminalSession {
    /// 创建新的共享终端会话
    pub async fn new(
        network: Arc<P2PNetwork>,
        session_name: Option<String>,
    ) -> Result<Self> {
        let session_id = Uuid::new_v4().to_string();
        let session_name = session_name.unwrap_or_else(|| {
            format!("session-{}", &session_id[..8])
        });

        // 生成会话密钥，类似 sshx 的 rand_alphanumeric(14)
        let session_key = SessionEncrypt::generate_session_key();
        let session_encrypt = SessionEncrypt::new(&session_key);

        let (client_tx, client_rx) = mpsc::channel(64);
        let (server_broadcast, _) = broadcast::channel(256);

        Ok(Self {
            session_id,
            session_name,
            session_encrypt,
            network,
            shells_tx: Arc::new(RwLock::new(HashMap::new())),
            client_tx,
            client_rx,
            server_broadcast,
            next_shell_id: Arc::new(RwLock::new(1)),
        })
    }

    /// 启动终端会话
    pub async fn start(&mut self) -> Result<()> {
        info!("Starting shared terminal session: {}", self.session_name);

        // 发送 Hello 消息
        let hello_msg = ClientMessage::Hello {
            session_name: self.session_name.clone(),
            auth_token: self.session_id.clone(),
        };

        self.client_tx.send(hello_msg).await?;

        // 启动消息处理循环
        self.run_message_loop().await
    }

    /// 创建新的 shell
    pub async fn create_shell(&mut self, x: i32, y: i32) -> Result<ShellId> {
        let shell_id = {
            let mut counter = self.next_shell_id.write().await;
            let id = ShellId(*counter);
            *counter += 1;
            id
        };

        let (shell_tx, shell_rx) = mpsc::channel(16);

        // 存储 shell 通道
        {
            let mut shells = self.shells_tx.write().await;
            shells.insert(shell_id, shell_tx);
        }

        // 启动 shell 处理任务
        self.spawn_shell_task(shell_id, shell_rx).await;

        // 发送创建确认
        let created_msg = ClientMessage::ShellCreated {
            shell_id,
            x,
            y,
        };
        self.client_tx.send(created_msg).await?;

        info!("Created shell: {}", shell_id);
        Ok(shell_id)
    }

    /// 关闭 shell
    pub async fn close_shell(&mut self, shell_id: ShellId) -> Result<()> {
        {
            let mut shells = self.shells_tx.write().await;
            shells.remove(&shell_id);
        }

        let closed_msg = ClientMessage::ShellClosed { shell_id };
        self.client_tx.send(closed_msg).await?;

        info!("Closed shell: {}", shell_id);
        Ok(())
    }

    /// 处理服务器消息
    async fn handle_server_message(&self, message: ServerMessage) -> Result<()> {
        match message {
            ServerMessage::Input { shell_id, data, offset } => {
                let shells = self.shells_tx.read().await;
                if let Some(sender) = shells.get(&shell_id) {
                    let shell_data = ShellData::Data(data);
                    sender.send(shell_data).await.ok();
                } else {
                    warn!("Received input for non-existent shell: {}", shell_id);
                }
            }

            ServerMessage::CreateShell { shell_id, x, y } => {
                // 这里应该由会话管理器处理，而不是直接在这里创建
                debug!("Received create shell request: {}", shell_id);
            }

            ServerMessage::CloseShell { shell_id } => {
                let mut shells = self.shells_tx.write().await;
                shells.remove(&shell_id);
                debug!("Server requested to close shell: {}", shell_id);
            }

            ServerMessage::Sync { sequences } => {
                let shells = self.shells_tx.read().await;
                for (shell_id, seq) in sequences {
                    if let Some(sender) = shells.get(&shell_id) {
                        sender.send(ShellData::Sync(seq)).await.ok();
                    }
                }
            }

            ServerMessage::Resize { shell_id, rows, cols } => {
                let shells = self.shells_tx.read().await;
                if let Some(sender) = shells.get(&shell_id) {
                    sender.send(ShellData::Size(rows, cols)).await.ok();
                } else {
                    warn!("Received resize for non-existent shell: {}", shell_id);
                }
            }

            ServerMessage::Ping(timestamp) => {
                let pong_msg = ClientMessage::Pong(timestamp);
                self.client_tx.send(pong_msg).await?;
            }

            ServerMessage::Error(error) => {
                error!("Server error: {}", error);
            }
        }

        Ok(())
    }

    /// 消息处理主循环
    async fn run_message_loop(&mut self) -> Result<()> {
        let mut server_rx = self.server_broadcast.subscribe();

        loop {
            tokio::select! {
                // 处理客户端消息
                client_msg = self.client_rx.recv() => {
                    match client_msg {
                        Some(msg) => {
                            // 通过 P2P 网络发送消息
                            self.send_client_message(msg).await?;
                        }
                        None => {
                            info!("Client message channel closed");
                            break;
                        }
                    }
                }

                // 处理服务器消息
                server_msg = server_rx.recv() => {
                    match server_msg {
                        Ok(msg) => {
                            self.handle_server_message(msg).await?;
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            info!("Server message channel closed");
                            break;
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            warn!("Server message channel lagged");
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// 通过 P2P 网络发送客户端消息
    async fn send_client_message(&self, message: ClientMessage) -> Result<()> {
        // 序列化消息
        let data = bincode::serialize(&message)?;

        // TODO: 通过 P2P 网络发送加密消息
        // 这里需要与现有的 P2PNetwork 集成
        debug!("Sending client message: {:?}", message);

        Ok(())
    }

    /// 启动 shell 处理任务
    async fn spawn_shell_task(
        &self,
        shell_id: ShellId,
        shell_rx: mpsc::Receiver<ShellData>,
    ) {
        let client_tx = self.client_tx.clone();
        let session_encrypt = self.session_encrypt.clone();

        tokio::spawn(async move {
            debug!("Starting shell task for: {}", shell_id);

            // TODO: Implement shell task handling for legacy CLI mode
            // For now, just get the shell and log
            let shell = get_default_shell().await;
            debug!("Would start shell task with: {}", shell);
            
            // Placeholder implementation - this is old CLI code
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

            debug!("Shell task ended for: {}", shell_id);
        });
    }

    /// 获取会话信息
    pub async fn get_session_info(&self) -> TerminalSessionState {
        let shell_count = self.shells_tx.read().await.len() as u32;

        TerminalSessionState {
            session_id: self.session_id.clone(),
            session_name: self.session_name.clone(),
            session_key: "****".to_string(), // 不暴露实际密钥
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            last_accessed: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            shell_count,
            current_directory: std::env::current_dir()
                .ok()
                .and_then(|p| p.to_str().map(|s| s.to_string())),
        }
    }
}

/// 终端会话管理器，用于管理多个共享会话
pub struct TerminalSessionManager {
    sessions: Arc<RwLock<HashMap<String, Arc<RwLock<SharedTerminalSession>>>>>,
    network: Arc<P2PNetwork>,
}

impl TerminalSessionManager {
    pub fn new(network: Arc<P2PNetwork>) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            network,
        }
    }

    /// 创建新会话
    pub async fn create_session(
        &self,
        session_name: Option<String>,
    ) -> Result<String> {
        let session = SharedTerminalSession::new(
            self.network.clone(),
            session_name,
        ).await?;

        let session_id = session.session_id.clone();
        let session_arc = Arc::new(RwLock::new(session));

        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session_arc);
        }

        info!("Created terminal session: {}", session_id);
        Ok(session_id)
    }

    /// 获取会话
    pub async fn get_session(
        &self,
        session_id: &str,
    ) -> Option<Arc<RwLock<SharedTerminalSession>>> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).cloned()
    }

    /// 移除会话
    pub async fn remove_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().await;
        sessions.remove(session_id);
        info!("Removed terminal session: {}", session_id);
        Ok(())
    }

    /// 列出所有会话
    pub async fn list_sessions(&self) -> Vec<String> {
        let sessions = self.sessions.read().await;
        sessions.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_id_display() {
        let shell_id = ShellId(42);
        assert_eq!(format!("{}", shell_id), "42");
    }

    #[test]
    fn test_session_state_serialization() {
        let state = TerminalSessionState {
            session_id: "test-session".to_string(),
            session_name: "Test Session".to_string(),
            session_key: "test-key".to_string(),
            created_at: 1640995200,
            last_accessed: 1640995300,
            shell_count: 2,
            current_directory: Some("/tmp".to_string()),
        };

        let json = serde_json::to_string(&state).unwrap();
        let deserialized: TerminalSessionState = serde_json::from_str(&json).unwrap();

        assert_eq!(state.session_id, deserialized.session_id);
        assert_eq!(state.session_name, deserialized.session_name);
        assert_eq!(state.shell_count, deserialized.shell_count);
    }
}
