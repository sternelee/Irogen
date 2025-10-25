/// 极简化的远程控制客户端
/// 专注于基本功能，避免复杂的类型问题
use anyhow::{Context, Result, anyhow};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};
use uuid::Uuid;

use iroh::Endpoint;
use riterm_shared::{NodeTicket, simple_protocol::*};

/// 极简化的远程终端客户端
pub struct SimpleClientMinimal {
    endpoint: Option<Endpoint>,
    connection: Option<ConnectionInfo>,
}

/// 连接信息
#[derive(Debug)]
struct ConnectionInfo {
    id: String,
    last_activity: Arc<RwLock<std::time::Instant>>,
}

/// 简单的响应类型
#[derive(Debug, Clone)]
pub enum ClientResponse {
    Connected(String),
    Disconnected(String),
    TerminalCreated(String),
    TerminalOutput(String, String),
    Error(String),
    Pong,
}

impl SimpleClientMinimal {
    /// 创建新的简化客户端
    pub fn new() -> Self {
        Self {
            endpoint: None,
            connection: None,
        }
    }

    /// 初始化网络
    pub async fn initialize(&mut self, _relay_url: Option<String>) -> Result<()> {
        let endpoint = Endpoint::builder()
            .alpns(vec![b"RITERMV0".to_vec()])
            .discovery_n0()
            .bind()
            .await?;

        self.endpoint = Some(endpoint);
        info!("🔧 Simple client initialized");
        Ok(())
    }

    /// 连接到远程主机
    pub async fn connect_to_host(&mut self, ticket: NodeTicket) -> Result<String> {
        let endpoint = self
            .endpoint
            .as_ref()
            .ok_or_else(|| anyhow!("Network not initialized"))?;

        info!("🔗 Connecting to host: {}", ticket.node_addr().node_id);

        // 连接到远程主机
        let node_addr = ticket.node_addr().clone();
        let connection = endpoint
            .connect(node_addr, b"RITERMV0")
            .await
            .context("Failed to connect to remote host")?;

        // 建立双向流
        let (mut send, mut recv) = connection
            .open_bi()
            .await
            .context("Failed to open bidirectional stream")?;

        // 简单握手
        const HANDSHAKE: &[u8] = b"RITERM_HELLO";
        send.write_all(HANDSHAKE)
            .await
            .context("Failed to send handshake")?;

        let mut handshake_buf = [0u8; HANDSHAKE.len()];
        recv.read_exact(&mut handshake_buf)
            .await
            .context("Failed to read handshake")?;

        if handshake_buf != HANDSHAKE {
            return Err(anyhow::anyhow!("Invalid handshake from host"));
        }

        let connection_id = Uuid::new_v4().to_string();
        info!("✅ Connected to host with ID: {}", connection_id);

        self.connection = Some(ConnectionInfo {
            id: connection_id.clone(),
            last_activity: Arc::new(RwLock::new(std::time::Instant::now())),
        });

        // 启动响应处理
        let conn_id = connection_id.clone();
        tokio::spawn(async move {
            Self::handle_responses(conn_id, send, recv).await;
        });

        Ok(connection_id)
    }

    /// 发送终端创建请求
    pub async fn create_terminal(&mut self, name: Option<String>) -> Result<()> {
        let request_data = serde_json::json!({
            "name": name,
            "shell": "/bin/bash",
            "rows": 24,
            "cols": 80
        });

        self.send_message(ProtocolCommand::TerminalCreate, request_data)
            .await
    }

    /// 发送终端输入
    pub async fn send_input(&mut self, input: String) -> Result<()> {
        let request_data = serde_json::json!({
            "id": "default",
            "data": input
        });

        self.send_message(ProtocolCommand::TerminalInput, request_data)
            .await
    }

    /// 发送ping
    pub async fn send_ping(&mut self) -> Result<()> {
        let ping_data = serde_json::json!({
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        });

        self.send_message(ProtocolCommand::Ping, ping_data).await
    }

    /// 通用消息发送方法
    async fn send_message(
        &mut self,
        command: ProtocolCommand,
        data: serde_json::Value,
    ) -> Result<()> {
        let connection = self
            .connection
            .as_mut()
            .ok_or_else(|| anyhow!("Not connected to host"))?;

        let message = ProtocolMessage::create(command.clone(), data);
        let _message_bytes = ProtocolCodec::encode(&message)?;

        // 这里需要一个实际的send流，在简化版本中只记录
        info!("📤 Would send: {:?}", command);

        // 更新活动时间
        *connection.last_activity.write().await = std::time::Instant::now();
        Ok(())
    }

    /// 处理响应
    async fn handle_responses(
        connection_id: String,
        mut _send: iroh::endpoint::SendStream,
        mut recv: iroh::endpoint::RecvStream,
    ) {
        info!("📨 Starting response handler for: {}", connection_id);

        let mut buffer = vec![0u8; 4096];

        loop {
            let n = recv.read(&mut buffer).await;

            if let Ok(Some(bytes_read)) = n {
                if bytes_read == 0 {
                    info!("🔌 Connection closed by host");
                    break;
                }

                // 尝试解析协议消息
                let message_data = &buffer[..bytes_read];
                if let Ok(Some(response)) = ProtocolCodec::decode(message_data) {
                    info!("📩 Received: {:?}", response.command);

                    match response.command {
                        ProtocolCommand::TerminalStatus => {
                            info!("✅ Terminal status updated");
                        }
                        ProtocolCommand::TerminalOutput => {
                            if let Some(output) = response.data.get("data") {
                                info!("📝 Terminal output: {}", output);
                            }
                        }
                        ProtocolCommand::Pong => {
                            info!("🏓 Pong received");
                        }
                        ProtocolCommand::Error => {
                            if let Some(error_msg) = response.data.get("message") {
                                warn!("❌ Error from host: {}", error_msg);
                            }
                        }
                        _ => {
                            debug!("📦 Other response: {:?}", response.command);
                        }
                    }
                } else {
                    debug!("🔍 Incomplete response received");
                }
            } else {
                info!("🔌 Connection read returned None");
                break;
            }
        }

        info!("👋 Response handler completed for: {}", connection_id);
    }

    /// 检查连接状态
    pub fn is_connected(&self) -> bool {
        self.connection.is_some()
    }

    /// 获取连接时长
    pub async fn get_connection_duration(&self) -> Option<u64> {
        if let Some(conn) = &self.connection {
            let activity = *conn.last_activity.read().await;
            Some(std::time::Instant::now().duration_since(activity).as_secs())
        } else {
            None
        }
    }
}

impl Default for SimpleClientMinimal {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_client_creation() {
        let client = SimpleClientMinimal::new();
        assert!(!client.is_connected());
        assert!(client.get_connection_duration().await.is_none());
    }

    #[test]
    fn test_protocol_parsing() {
        let raw = "[PING]{\"timestamp\":123}";
        if let Ok(Some(msg)) = ProtocolCodec::decode(raw.as_bytes()) {
            assert_eq!(msg.command, ProtocolCommand::Ping);
        } else {
            panic!("Failed to parse protocol message");
        }
    }
}

