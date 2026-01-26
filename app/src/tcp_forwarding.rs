//! TCP 转发管理模块
//!
//! 此模块实现了从本地 TCP 客户端到远程 CLI 的 TCP 数据转发。

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, RwLock};
use uuid::Uuid;
use tracing::{debug, error, info, warn};

use riterm_shared::TcpDataType;

/// TCP 转发会话信息
#[derive(Debug, Clone)]
pub struct TcpForwardingSession {
    pub id: String,
    pub local_addr: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String,
}

/// TCP 连接信息
#[derive(Debug, Clone)]
pub struct TcpConnectionInfo {
    pub connection_id: String,
    pub stream: Arc<RwLock<TcpStream>>,
    pub session_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub created_at: std::time::SystemTime,
}

/// 消息发送请求
#[derive(Debug, Clone)]
pub struct TcpMessageRequest {
    pub session_id: String,
    pub connection_id: String,
    pub data: Vec<u8>,
    pub data_type: TcpDataType,
}

/// TCP 连接管理器
pub struct TcpForwardingManager {
    sessions: Arc<RwLock<HashMap<String, TcpForwardingSession>>>,
    /// Tracks active TCP connections from local clients
    /// Key: connection_id, Value: TcpConnectionInfo
    tcp_connections: Arc<RwLock<HashMap<String, TcpConnectionInfo>>>,
    /// Channel for sending messages to CLI through P2P network
    message_tx: broadcast::Sender<TcpMessageRequest>,
}

impl Default for TcpForwardingManager {
    fn default() -> Self {
        let (message_tx, _) = broadcast::channel(1000);
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            tcp_connections: Arc::new(RwLock::new(HashMap::new())),
            message_tx,
        }
    }
}

impl TcpForwardingManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 获取消息发送通道的发送端
    pub fn get_message_sender(&self) -> broadcast::Sender<TcpMessageRequest> {
        self.message_tx.clone()
    }

    /// 订阅消息通道的接收端
    /// 每次调用都会返回一个新的 receiver，可以独立接收消息
    pub fn subscribe_message_receiver(&self) -> broadcast::Receiver<TcpMessageRequest> {
        self.message_tx.subscribe()
    }

    /// 处理从 CLI 接收到的 TCP 数据
    /// 当 CLI 发送数据回来时，写入到本地 TCP 连接
    pub async fn handle_tcp_data_from_cli(
        &self,
        session_id: &str,
        connection_id: &str,
        data: &[u8],
        data_type: &TcpDataType,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match data_type {
            TcpDataType::Data => {
                debug!(
                    "Received {} bytes from CLI for connection {}",
                    data.len(),
                    connection_id
                );

                // 查找对应的 TCP 连接并写入数据
                let connections = self.tcp_connections.read().await;
                if let Some(conn_info) = connections.get(connection_id) {
                    let mut stream = conn_info.stream.write().await;
                    stream.write_all(data).await?;
                    stream.flush().await?;

                    debug!("Successfully wrote {} bytes to local TCP stream", data.len());
                    Ok(())
                } else {
                    warn!(
                        "TCP connection not found for connection_id: {} (session: {})",
                        connection_id, session_id
                    );
                    Err(format!("Connection not found: {}", connection_id).into())
                }
            }
            TcpDataType::ConnectionClose => {
                info!(
                    "CLI closed connection {} for session {}",
                    connection_id, session_id
                );

                // 移除连接并关闭 TCP 流
                let mut connections = self.tcp_connections.write().await;
                if let Some(conn_info) = connections.remove(connection_id) {
                    drop(conn_info); // Explicitly drop to close stream
                    info!("Closed local TCP connection: {}", connection_id);
                }
                Ok(())
            }
            TcpDataType::ConnectionOpen => {
                // CLI 端不应该发送 ConnectionOpen 到 App
                warn!("Received unexpected ConnectionOpen from CLI for connection {}", connection_id);
                Ok(())
            }
            TcpDataType::Error => {
                error!(
                    "CLI reported error for connection {}: {:?}",
                    connection_id,
                    String::from_utf8_lossy(data)
                );
                // 移除有错误的连接
                let mut connections = self.tcp_connections.write().await;
                connections.remove(connection_id);
                Ok(())
            }
        }
    }

    /// 创建 TCP 转发会话
    pub async fn create_session(
        &self,
        local_addr: String,
        remote_host: String,
        remote_port: u16,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let session_id = Uuid::new_v4().to_string();

        let session = TcpForwardingSession {
            id: session_id.clone(),
            local_addr: local_addr.clone(),
            remote_host: remote_host.clone(),
            remote_port,
            status: "starting".to_string(),
        };

        // 保存会话
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
        }

        // 启动本地监听器
        let local_addr_parsed: SocketAddr = local_addr.parse()?;
        let remote_host_for_listener = remote_host.clone();
        let _shutdown_tx = self
            .start_listener(session_id.clone(), local_addr_parsed, remote_host_for_listener, remote_port)
            .await?;

        // 更新会话状态
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(&session_id) {
                session.status = "running".to_string();
            }
        }

        info!(
            "TCP forwarding session created: {} ({} -> {}:{})",
            session_id, local_addr, remote_host, remote_port
        );

        Ok(session_id)
    }

    /// 启动 TCP 监听器
    async fn start_listener(
        &self,
        session_id: String,
        local_addr: SocketAddr,
        remote_host: String,
        remote_port: u16,
    ) -> Result<mpsc::UnboundedSender<()>, Box<dyn std::error::Error + Send + Sync>> {
        use tokio::sync::mpsc;

        let (shutdown_tx, mut shutdown_rx) = mpsc::unbounded_channel();
        let session_id_clone = session_id.clone();

        // 获取共享资源的克隆
        let tcp_connections_clone = self.tcp_connections.clone();
        let message_tx_clone = self.message_tx.clone();

        tokio::spawn(async move {
            let listener = match TcpListener::bind(local_addr).await {
                Ok(l) => l,
                Err(e) => {
                    error!("Failed to bind to {}: {}", local_addr, e);
                    return;
                }
            };

            info!(
                "TCP listener started on {} for session {}",
                local_addr, session_id_clone
            );

            // Clone remote_host for use in the loop
            let remote_host_for_loop = remote_host.clone();

            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, addr)) => {
                                info!(
                                    "New TCP connection from {} for session {}",
                                    addr, session_id_clone
                                );

                                let session_id_for_task = session_id_clone.clone();
                                let tcp_connections_for_task = tcp_connections_clone.clone();
                                let message_tx_for_task = message_tx_clone.clone();
                                let remote_host_for_task = remote_host_for_loop.clone();

                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(
                                        stream,
                                        session_id_for_task,
                                        remote_host_for_task,
                                        remote_port,
                                        tcp_connections_for_task,
                                        message_tx_for_task,
                                    )
                                    .await
                                    {
                                        error!("Error handling connection: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                error!("Error accepting connection: {}", e);
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        info!(
                            "TCP listener shutting down for session {}",
                            session_id_clone
                        );
                        break;
                    }
                }
            }
        });

        Ok(shutdown_tx)
    }

    /// 停止会话
    pub async fn stop_session(
        &self,
        session_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // 从会话列表中移除
        let mut sessions = self.sessions.write().await;
        if let Some(mut session) = sessions.remove(session_id) {
            session.status = "stopped".to_string();
            info!("TCP forwarding session stopped: {}", session_id);
            Ok(())
        } else {
            Err("Session not found".into())
        }
    }

    /// 获取所有会话
    pub async fn list_sessions(&self) -> Vec<TcpForwardingSession> {
        let sessions = self.sessions.read().await;
        sessions.values().cloned().collect()
    }

    /// 恢复现有的 TCP 转发会话（用于重连后恢复会话）
    ///
    /// # 参数
    /// * `session_id` - CLI 端的会话 ID
    /// * `local_addr` - 本地监听地址
    /// * `remote_host` - 远程主机
    /// * `remote_port` - 远程端口
    ///
    /// # 返回
    /// 成功返回 session_id，失败返回错误
    pub async fn restore_session(
        &self,
        session_id: String,
        local_addr: String,
        remote_host: String,
        remote_port: u16,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // 检查会话是否已存在
        {
            let sessions = self.sessions.read().await;
            if sessions.contains_key(&session_id) {
                warn!("Session {} already exists, skipping restore", session_id);
                return Ok(());
            }
        }

        let session = TcpForwardingSession {
            id: session_id.clone(),
            local_addr: local_addr.clone(),
            remote_host: remote_host.clone(),
            remote_port,
            status: "starting".to_string(),
        };

        // 保存会话
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
        }

        // 启动本地监听器
        let local_addr_parsed: SocketAddr = local_addr.parse()?;
        let remote_host_for_listener = remote_host.clone();
        let _shutdown_tx = self
            .start_listener(session_id.clone(), local_addr_parsed, remote_host_for_listener, remote_port)
            .await?;

        // 更新会话状态
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(&session_id) {
                session.status = "running".to_string();
            }
        }

        info!(
            "TCP forwarding session restored: {} ({} -> {}:{})",
            session_id, local_addr, remote_host, remote_port
        );

        Ok(())
    }
}

/// 处理单个 TCP 连接
async fn handle_connection(
    stream: TcpStream,
    session_id: String,
    _remote_host: String,
    _remote_port: u16,
    tcp_connections: Arc<RwLock<HashMap<String, TcpConnectionInfo>>>,
    message_tx: broadcast::Sender<TcpMessageRequest>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let connection_id = Uuid::new_v4().to_string();
    let peer_addr = stream.peer_addr().ok();

    info!(
        "New TCP connection from {:?} (connection_id: {})",
        peer_addr, connection_id
    );

    // 1. 保存连接信息
    let conn_info = TcpConnectionInfo {
        connection_id: connection_id.clone(),
        stream: Arc::new(RwLock::new(stream)),
        session_id: session_id.clone(),
        bytes_sent: 0,
        bytes_received: 0,
        created_at: std::time::SystemTime::now(),
    };
    {
        let mut connections = tcp_connections.write().await;
        connections.insert(connection_id.clone(), conn_info);
    }

    // 2. 发送 ConnectionOpen 消息到 CLI（通过通道）
    if let Err(e) = message_tx.send(TcpMessageRequest {
        session_id: session_id.clone(),
        connection_id: connection_id.clone(),
        data: vec![],
        data_type: TcpDataType::ConnectionOpen,
    }) {
        error!("Failed to send ConnectionOpen message: {}", e);
        return Err("Failed to send ConnectionOpen message".into());
    }
    info!("Sent ConnectionOpen to CLI for connection {}", connection_id);

    // 获取流引用用于读取
    let stream_arc = {
        let connections = tcp_connections.read().await;
        connections.get(&connection_id).map(|c| c.stream.clone())
    };

    if let Some(stream_ref) = stream_arc {
        let mut stream_read = stream_ref.write().await;

        // 3. 循环读取本地客户端数据并转发到 CLI
        let mut buffer = vec![0u8; 8192];
        loop {
            match stream_read.read(&mut buffer).await {
                Ok(0) => {
                    info!("Client disconnected for connection {}", connection_id);
                    break;
                }
                Ok(n) => {
                    debug!(
                        "Read {} bytes from local client for connection {}",
                        n, connection_id
                    );

                    // 发送数据到 CLI（通过通道）
                    let data = buffer[..n].to_vec();
                    if let Err(e) = message_tx.send(TcpMessageRequest {
                        session_id: session_id.clone(),
                        connection_id: connection_id.clone(),
                        data,
                        data_type: TcpDataType::Data,
                    }) {
                        error!("Failed to send TCP data message: {}", e);
                        break;
                    }
                }
                Err(e) => {
                    error!("Error reading from local client: {}", e);
                    break;
                }
            }
        }
    }

    // 4. 清理连接并关闭
    if let Err(e) = message_tx.send(TcpMessageRequest {
        session_id: session_id.clone(),
        connection_id: connection_id.clone(),
        data: vec![],
        data_type: TcpDataType::ConnectionClose,
    }) {
        error!("Failed to send ConnectionClose message: {}", e);
    }
    info!("Sent ConnectionClose to CLI for connection {}", connection_id);

    {
        let mut connections = tcp_connections.write().await;
        connections.remove(&connection_id);
    }

    info!("TCP connection handler ended for connection {}", connection_id);
    Ok(())
}
