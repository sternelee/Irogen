/// 简化的远程控制客户端 - 基于dumbpipe模式
/// 纯客户端，专注于指令发送和响应接收
use anyhow::{Context, Result, anyhow};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use iroh::Endpoint;
use riterm_shared::{NodeTicket, simple_protocol::*};
use tokio::io::AsyncWriteExt;

/// 简化的远程终端客户端
pub struct SimpleRemoteClient {
    endpoint: Option<Endpoint>,
    connection: Option<ClientConnection>,
    ticket: Option<NodeTicket>,
}

/// 客户端连接信息
#[derive(Debug)]
pub struct ClientConnection {
    pub id: String,
    pub send_stream: iroh::endpoint::SendStream,
    pub recv_stream: iroh::endpoint::RecvStream,
    pub last_activity: Arc<RwLock<std::time::Instant>>,
}

/// 指令回调trait
pub trait CommandCallback: Send + Sync {
    fn on_response(&self, command: ProtocolCommand, data: serde_json::Value);
    fn on_error(&self, error: String);
    fn on_connected(&self, connection_id: String);
    fn on_disconnected(&self, connection_id: String);
}

impl SimpleRemoteClient {
    /// 创建新的简化客户端
    pub fn new() -> Self {
        Self {
            endpoint: None,
            connection: None,
            ticket: None,
        }
    }

    /// 初始化网络
    pub async fn initialize(&mut self, relay_url: Option<String>) -> Result<()> {
        let endpoint = if let Some(_relay) = relay_url {
            // 暂时禁用relay功能，简化实现
            Endpoint::builder()
                .alpns(vec![b"RITERMV0".to_vec()])
                .discovery_n0()
                .bind()
                .await?
        } else {
            Endpoint::builder()
                .alpns(vec![b"RITERMV0".to_vec()])
                .discovery_n0()
                .bind()
                .await?
        };

        self.endpoint = Some(endpoint);
        Ok(())
    }

    /// 连接到远程主机
    pub async fn connect_to_host(&mut self, ticket: NodeTicket) -> Result<String> {
        let endpoint = self
            .endpoint
            .as_ref()
            .ok_or_else(|| anyhow!("Network not initialized"))?;

        // 连接到远程主机 - 标准dumbpipe模式
        let connection = endpoint
            .connect(ticket.node_addr().into(), &"RITERMV0")
            .await
            .context("Failed to connect to remote host")?;

        // 建立双向流
        let (mut send, mut recv) = connection
            .open_bi()
            .await
            .context("Failed to open bidirectional stream")?;

        // 简单握手
        const HANDSHAKE: &[u8] = b"RITERM_HELLO";
        if let Err(e) = send.write_all(HANDSHAKE).await {
            return Err(anyhow::anyhow!("Failed to send handshake: {}", e));
        }

        let mut handshake_buf = [0u8; HANDSHAKE.len()];
        if let Err(e) = recv.read_exact(&mut handshake_buf).await {
            return Err(anyhow::anyhow!("Failed to read handshake: {}", e));
        }

        if handshake_buf != HANDSHAKE {
            return Err(anyhow::anyhow!("Invalid handshake from host"));
        }

        info!("✅ Connected to host: {}", ticket.node_addr().node_id);

        // 存储连接信息
        let connection_id = Uuid::new_v4().to_string();
        let client_connection = ClientConnection {
            id: connection_id.clone(),
            send_stream: send,
            recv_stream: recv,
            last_activity: Arc::new(RwLock::new(std::time::Instant::now())),
        };

        self.connection = Some(client_connection);
        self.ticket = Some(ticket);

        info!("🔗 Connection established: {}", connection_id);
        Ok(connection_id)
    }

    /// 发送指令到远程主机
    pub async fn send_command(
        &mut self,
        command: ProtocolCommand,
        data: serde_json::Value,
    ) -> Result<()> {
        let connection = self
            .connection
            .as_mut()
            .ok_or_else(|| anyhow!("Not connected to host"))?;

        let message = ProtocolMessage::create(command.clone(), data);
        let message_bytes = ProtocolCodec::encode(&message)?;

        // 发送消息
        connection
            .send_stream
            .write_all(&message_bytes)
            .await
            .context("Failed to send command")?;
        connection
            .send_stream
            .flush()
            .await
            .context("Failed to flush message")?;

        // 更新活动时间
        *connection.last_activity.write().await = std::time::Instant::now();

        debug!("📤 Sent command: {:?}", command);
        Ok(())
    }

    /// 发送带结构化数据的指令
    pub async fn send_structured_command<T: serde::Serialize>(
        &mut self,
        command: ProtocolCommand,
        data: T,
    ) -> Result<()> {
        let json_data = serde_json::to_value(data).context("Failed to serialize command data")?;
        self.send_command(command, json_data).await
    }

    /// 启动响应监听器
    pub async fn start_response_listener(
        &mut self,
        callback: Box<dyn CommandCallback>,
    ) -> Result<()> {
        let connection = self
            .connection
            .as_mut()
            .ok_or_else(|| anyhow!("Not connected to host"))?;

        info!("👂 Starting response listener...");

        // 消息缓冲区
        let mut buffer = vec![0u8; 8192];
        let connection_id = connection.id.clone();
        let last_activity: Arc<RwLock<std::time::Instant>> = Arc::clone(&connection.last_activity);

        loop {
            // 读取响应
            let n = connection
                .recv_stream
                .read(&mut buffer)
                .await
                .context("Failed to read from connection")?;

            if let Some(bytes_read) = n {
                if bytes_read == 0 {
                    info!("🔌 Connection closed by host");
                    break;
                }

                // 解析协议消息
                let message_data = &buffer[..bytes_read];
                if let Ok(Some(response)) = ProtocolCodec::decode(message_data) {
                    info!("📨 Received response: {:?}", response.command);

                    // 更新活动时间
                    *last_activity.write().await = std::time::Instant::now();

                    // 处理特殊响应
                    let command = response.command.clone();
                    let data = response.data;

                    // 调用回调
                    callback.on_response(command.clone(), data);

                    match command {
                        ProtocolCommand::Error => {
                            if let Some(error_msg) = data.get("message") {
                                callback.on_error(
                                    error_msg.as_str().unwrap_or("Unknown error").to_string(),
                                );
                            }
                        }
                        ProtocolCommand::Pong => {
                            debug!("🏓 Received pong from host");
                        }
                        _ => {
                            debug!("Other response: {:?}", command);
                        }
                    }
                } else {
                    warn!("🔍 Received incomplete response, waiting for more data");
                }
            } else {
                info!("🔌 Connection read returned None - connection closed");
                break;
            }
        }

        // 调用断开连接回调
        callback.on_disconnected(connection_id);
        Ok(())
    }

    /// 断开连接
    pub async fn disconnect(&mut self) -> Result<()> {
        if let Some(mut connection) = self.connection.take() {
            info!("🔌 Disconnecting from host...");

            // 尝试优雅关闭连接
            if let Err(e) = connection.send_stream.shutdown().await {
                warn!("Error closing send stream: {}", e);
            }

            // 重置连接状态
            self.ticket = None;
            info!("👋 Disconnected from host");
        }

        Ok(())
    }

    /// 获取连接状态
    pub fn is_connected(&self) -> bool {
        self.connection.is_some()
    }

    /// 获取连接信息
    pub fn get_connection_info(&self) -> Option<&ClientConnection> {
        self.connection.as_ref()
    }

    /// 获取连接时长（秒）
    pub async fn get_connection_duration(&self) -> Option<u64> {
        if let Some(conn) = &self.connection {
            let activity = *conn.last_activity.read().await;
            let now = std::time::Instant::now();
            Some(now.duration_since(activity).as_secs())
        } else {
            None
        }
    }

    /// 发送ping
    pub async fn send_ping(&mut self) -> Result<()> {
        let ping_data = serde_json::json!({
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        });

        self.send_command(ProtocolCommand::Ping, ping_data).await
    }

    /// === 便捷方法：终端管理 ===

    /// 创建远程终端
    pub async fn create_terminal(
        &mut self,
        name: Option<String>,
        shell: Option<String>,
        cwd: Option<String>,
        rows: Option<u16>,
        cols: Option<u16>,
    ) -> Result<()> {
        let request = TerminalCreateRequest {
            name,
            shell,
            cwd,
            rows,
            cols,
        };

        self.send_structured_command(ProtocolCommand::TerminalCreate, request)
            .await
    }

    /// 发送终端输入
    pub async fn send_terminal_input(&mut self, terminal_id: String, input: String) -> Result<()> {
        let request = TerminalInputRequest {
            id: terminal_id,
            data: input,
        };

        self.send_structured_command(ProtocolCommand::TerminalInput, request)
            .await
    }

    /// 调整终端大小
    pub async fn resize_terminal(
        &mut self,
        terminal_id: String,
        rows: u16,
        cols: u16,
    ) -> Result<()> {
        let request = TerminalResizeRequest {
            id: terminal_id,
            rows,
            cols,
        };

        self.send_structured_command(ProtocolCommand::TerminalResize, request)
            .await
    }

    /// 列出所有终端
    pub async fn list_terminals(&mut self) -> Result<()> {
        self.send_command(ProtocolCommand::TerminalList, serde_json::Value::Null)
            .await
    }

    /// 停止终端
    pub async fn stop_terminal(&mut self, terminal_id: String) -> Result<()> {
        let request = TerminalInputRequest {
            id: terminal_id,
            data: String::new(),
        };

        self.send_structured_command(ProtocolCommand::TerminalStop, request)
            .await
    }

    /// === 便捷方法：文件传输 ===

    /// 上传文件到远程主机
    pub async fn upload_file(&mut self, path: String, data: Vec<u8>) -> Result<()> {
        use base64::Engine;

        let encoded_data = base64::engine::general_purpose::STANDARD.encode(&data);
        let request = FileUploadRequest {
            path,
            data: encoded_data,
            size: Some(data.len() as u64),
        };

        self.send_structured_command(ProtocolCommand::FileUpload, request)
            .await
    }

    /// === 便捷方法：端口转发 ===

    /// 创建端口转发
    pub async fn create_port_forward(
        &mut self,
        local_port: u16,
        remote_port: Option<u16>,
        service_name: String,
    ) -> Result<()> {
        let request = PortForwardCreateRequest {
            local_port,
            remote_port,
            service_name,
            service_type: Some("tcp".to_string()),
        };

        self.send_structured_command(ProtocolCommand::PortForwardCreate, request)
            .await
    }
}

impl Default for SimpleRemoteClient {
    fn default() -> Self {
        Self::new()
    }
}

/// 简单的指令回调实现
pub struct SimpleCallback {
    pub on_response_fn: Option<Box<dyn Fn(ProtocolCommand, serde_json::Value) + Send + Sync>>,
    pub on_error_fn: Option<Box<dyn Fn(String) + Send + Sync>>,
    pub on_connected_fn: Option<Box<dyn Fn(String) + Send + Sync>>,
    pub on_disconnected_fn: Option<Box<dyn Fn(String) + Send + Sync>>,
}

impl SimpleCallback {
    pub fn new() -> Self {
        Self {
            on_response_fn: None,
            on_error_fn: None,
            on_connected_fn: None,
            on_disconnected_fn: None,
        }
    }

    pub fn on_response<F>(mut self, f: F) -> Self
    where
        F: Fn(ProtocolCommand, serde_json::Value) + Send + Sync + 'static,
    {
        self.on_response_fn = Some(Box::new(f));
        self
    }

    pub fn on_error<F>(mut self, f: F) -> Self
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        self.on_error_fn = Some(Box::new(f));
        self
    }

    pub fn on_connected<F>(mut self, f: F) -> Self
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        self.on_connected_fn = Some(Box::new(f));
        self
    }

    pub fn on_disconnected<F>(mut self, f: F) -> Self
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        self.on_disconnected_fn = Some(Box::new(f));
        self
    }
}

impl CommandCallback for SimpleCallback {
    fn on_response(&self, command: ProtocolCommand, data: serde_json::Value) {
        if let Some(ref f) = self.on_response_fn {
            f(command, data);
        }
    }

    fn on_error(&self, error: String) {
        if let Some(ref f) = self.on_error_fn {
            f(error);
        }
    }

    fn on_connected(&self, connection_id: String) {
        if let Some(ref f) = self.on_connected_fn {
            f(connection_id);
        }
    }

    fn on_disconnected(&self, connection_id: String) {
        if let Some(ref f) = self.on_disconnected_fn {
            f(connection_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_simple_client_creation() {
        let client = SimpleRemoteClient::new();
        assert!(!client.is_connected());
        assert!(client.get_connection_info().is_none());
    }

    #[test]
    fn test_simple_callback() {
        let mut callback = SimpleCallback::new();

        callback = callback
            .on_response(|cmd, data| {
                println!("Response: {:?}, Data: {}", cmd, data);
            })
            .on_error(|error| {
                eprintln!("Error: {}", error);
            });

        // 这里可以测试回调功能
        assert!(callback.on_response_fn.is_some());
        assert!(callback.on_error_fn.is_some());
    }

    #[test]
    fn test_terminal_create_request() {
        let request = TerminalCreateRequest {
            name: Some("test".to_string()),
            shell: Some("/bin/bash".to_string()),
            cwd: Some("/home".to_string()),
            rows: Some(24),
            cols: Some(80),
        };

        let msg =
            ProtocolMessage::create_with_data(ProtocolCommand::TerminalCreate, request).unwrap();
        assert!(msg.raw.contains("[TERMINAL_CREATE]"));
        assert!(msg.raw.contains("/bin/bash"));
    }
}

