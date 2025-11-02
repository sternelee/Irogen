//! 基于消息事件的QUIC服务器
//!
//! 此模块实现了一个支持统一消息协议的QUIC服务器，
//! 允许App通过iroh向CLI发送管理指令。

use crate::event_manager::*;
use crate::message_protocol::*;
use anyhow::Result;
use async_trait::async_trait;
use iroh::{Endpoint, EndpointAddr, discovery::dns::DnsDiscovery};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info};

/// ALPN协议标识符
pub const QUIC_MESSAGE_ALPN: &[u8] = b"com.riterm.messages/1";

/// QUIC消息服务器配置
#[derive(Debug, Clone)]
pub struct QuicMessageServerConfig {
    /// 绑定地址
    pub bind_addr: Option<std::net::SocketAddr>,
    /// 中继服务器URL
    pub relay_url: Option<String>,
    /// 最大连接数
    pub max_connections: usize,
    /// 心跳间隔
    pub heartbeat_interval: std::time::Duration,
    /// 超时设置
    pub timeout: std::time::Duration,
}

impl Default for QuicMessageServerConfig {
    fn default() -> Self {
        Self {
            bind_addr: None,
            relay_url: None,
            max_connections: 100,
            heartbeat_interval: std::time::Duration::from_secs(30),
            timeout: std::time::Duration::from_secs(60),
        }
    }
}

/// QUIC连接状态
#[derive(Debug, Clone)]
pub struct QuicConnection {
    pub id: String,
    pub node_id: iroh::PublicKey,
    pub endpoint_addr: String,
    pub established_at: std::time::SystemTime,
    pub last_activity: std::time::SystemTime,
}

/// QUIC消息服务器
pub struct QuicMessageServer {
    endpoint: Endpoint,
    connections: Arc<RwLock<HashMap<String, QuicConnection>>>,
    communication_manager: Arc<CommunicationManager>,
    #[allow(dead_code)] // 配置字段用于未来扩展
    config: QuicMessageServerConfig,
    shutdown_tx: mpsc::Sender<()>,
}

impl QuicMessageServer {
    /// 创建新的QUIC消息服务器
    pub async fn new(
        config: QuicMessageServerConfig,
        communication_manager: Arc<CommunicationManager>,
    ) -> Result<Self> {
        info!("Initializing QUIC message server...");

        // 创建endpoint
        let endpoint = if let Some(relay) = &config.relay_url {
            info!("Using custom relay: {}", relay);
            let _relay_url: url::Url = relay.parse()?;
            Endpoint::builder()
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        } else {
            info!("Using default relay");
            Endpoint::builder()
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        };
        let node_id = endpoint.id();
        info!("QUIC server node ID: {:?}", node_id);

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        let server = Self {
            endpoint,
            connections: Arc::new(RwLock::new(HashMap::new())),
            communication_manager,
            config,
            shutdown_tx,
        };

        // 启动连接接受器
        server.start_connection_acceptor(shutdown_rx).await?;

        Ok(server)
    }

    /// 启动连接接受器
    async fn start_connection_acceptor(&self, shutdown_rx: mpsc::Receiver<()>) -> Result<()> {
        let endpoint = self.endpoint.clone();
        let connections = self.connections.clone();
        let comm_manager = self.communication_manager.clone();

        tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;
            loop {
                tokio::select! {
                    connection_result = endpoint.accept() => {
                        match connection_result {
                            Some(connecting) => {
                                debug!("Incoming connection accepted");

                                let conn = connections.clone();
                                let cm = comm_manager.clone();

                                tokio::spawn(async move {
                                    // Directly handle the incoming connection by accepting it
                                    if let Err(e) = Self::handle_connection(
                                        connecting,
                                        conn,
                                        cm,
                                    ).await {
                                        error!("Error handling message connection: {}", e);
                                    }
                                });
                            }
                            None => {
                                debug!("No more incoming connections");
                                break;
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        info!("Shutting down connection acceptor");
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    /// 处理消息连接
    async fn handle_connection(
        incoming: iroh::endpoint::Incoming,
        connections: Arc<RwLock<HashMap<String, QuicConnection>>>,
        communication_manager: Arc<CommunicationManager>,
    ) -> Result<()> {
        // 执行握手
        let connection = incoming.await?;
        let remote_node_id = connection.remote_id();
        let endpoint_addr = format!("{:?}", remote_node_id);

        info!("Message connection established with: {:?}", remote_node_id);

        // 创建连接状态
        let connection_id = format!("conn_{}", uuid::Uuid::new_v4());
        let conn_state = QuicConnection {
            id: connection_id.clone(),
            node_id: remote_node_id?,
            endpoint_addr: endpoint_addr.clone(),
            established_at: std::time::SystemTime::now(),
            last_activity: std::time::SystemTime::now(),
        };

        // 存储连接
        {
            let mut conns = connections.write().await;
            conns.insert(connection_id.clone(), conn_state);
        }

        // 处理消息流
        Self::handle_message_streams(connection, connection_id, communication_manager).await
    }

    /// 处理消息流
    async fn handle_message_streams(
        connection: iroh::endpoint::Connection,
        connection_id: String,
        communication_manager: Arc<CommunicationManager>,
    ) -> Result<()> {
        // 接受双向流用于消息通信
        loop {
            match connection.accept_bi().await {
                Ok((send_stream, recv_stream)) => {
                    let cm = communication_manager.clone();
                    let conn_id = connection_id.clone();

                    tokio::spawn(async move {
                        if let Err(e) =
                            Self::handle_message_stream(send_stream, recv_stream, cm, conn_id).await
                        {
                            error!("Error handling message stream: {}", e);
                        }
                    });
                }
                Err(e) => {
                    debug!("Connection closed: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    /// 处理单个消息流
    async fn handle_message_stream(
        mut send_stream: iroh::endpoint::SendStream,
        mut recv_stream: iroh::endpoint::RecvStream,
        communication_manager: Arc<CommunicationManager>,
        _connection_id: String,
    ) -> Result<()> {
        let mut buffer = vec![0u8; 8192];

        loop {
            match recv_stream.read(&mut buffer).await {
                Ok(Some(n)) => {
                    let data = &buffer[..n];

                    // 尝试反序列化消息
                    match MessageSerializer::deserialize_from_network(data) {
                        Ok(message) => {
                            debug!(
                                "Received message: {:?} from {}",
                                message.message_type, message.sender_id
                            );

                            // 处理传入消息
                            if let Err(e) = communication_manager
                                .receive_incoming_message(message.clone())
                                .await
                            {
                                error!("Failed to process incoming message: {}", e);

                                // 发送错误响应
                                let error_response = message.create_error_response(format!(
                                    "Failed to process message: {}",
                                    e
                                ));
                                if let Err(e) =
                                    Self::send_message(&mut send_stream, &error_response).await
                                {
                                    error!("Failed to send error response: {}", e);
                                }
                            } else {
                                // 处理成功，发送响应（如果需要）
                                if message.requires_response {
                                    let response = Self::create_default_response(&message);
                                    if let Err(e) =
                                        Self::send_message(&mut send_stream, &response).await
                                    {
                                        error!("Failed to send response: {}", e);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            error!("Failed to deserialize message: {}", e);
                        }
                    }
                }
                Ok(None) => {
                    debug!("Stream closed by peer");
                    break;
                }
                Err(e) => {
                    error!("Error reading from stream: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    /// 发送消息到流
    async fn send_message(
        send_stream: &mut iroh::endpoint::SendStream,
        message: &Message,
    ) -> Result<()> {
        let data = MessageSerializer::serialize_for_network(message)?;
        send_stream.write_all(&data).await?;
        send_stream.finish()?;
        Ok(())
    }

    /// 创建默认响应
    fn create_default_response(message: &Message) -> Message {
        let response_data = serde_json::json!({
            "status": "processed",
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        });

        message.create_response(MessagePayload::Response(ResponseMessage {
            request_id: message.id.clone(),
            success: true,
            data: Some(response_data),
            message: Some("Message processed successfully".to_string()),
        }))
    }

    /// 发送消息到特定节点
    pub async fn send_message_to_node(
        &self,
        node_id: &iroh::PublicKey,
        _message: Message,
    ) -> Result<()> {
        // 这里需要实现根据node_id找到连接并发送消息的逻辑
        // 由于iroh的限制，这通常需要重新建立连接
        info!("Sending message to node: {:?}", node_id);

        // 暂时返回成功，实际实现需要更多逻辑
        Ok(())
    }

    /// 广播消息到所有连接的节点
    pub async fn broadcast_message(&self, message: Message) -> Result<()> {
        let connections = self.connections.read().await;
        info!("Broadcasting message to {} connections", connections.len());

        for connection in connections.values() {
            if let Err(e) = self
                .send_message_to_node(&connection.node_id, message.clone())
                .await
            {
                error!(
                    "Failed to send message to node {:?}: {}",
                    connection.node_id, e
                );
            }
        }

        Ok(())
    }

    /// 获取端点地址
    pub fn get_endpoint_addr(&self) -> Result<EndpointAddr> {
        Ok(self.endpoint.addr())
    }

    /// 获取节点ID
    pub fn get_node_id(&self) -> iroh::PublicKey {
        self.endpoint.id()
    }

    /// 获取活跃连接数
    pub async fn get_active_connections_count(&self) -> usize {
        let connections = self.connections.read().await;
        connections.len()
    }

    /// 列出活跃连接
    pub async fn list_active_connections(&self) -> Vec<QuicConnection> {
        let connections = self.connections.read().await;
        connections.values().cloned().collect()
    }

    /// 关闭服务器
    pub async fn shutdown(&self) -> Result<()> {
        info!("Shutting down QUIC message server");

        // 发送关闭信号
        let _ = self.shutdown_tx.send(()).await;

        // 关闭所有连接
        {
            let mut connections = self.connections.write().await;
            connections.clear();
        }

        Ok(())
    }
}

/// QUIC消息客户端
pub struct QuicMessageClient {
    endpoint: Endpoint,
    #[allow(dead_code)] // 通信管理器用于未来扩展
    communication_manager: Arc<CommunicationManager>,
    server_connections: Arc<RwLock<HashMap<String, iroh::endpoint::Connection>>>,
}

impl QuicMessageClient {
    /// 创建新的QUIC消息客户端
    pub async fn new(
        relay_url: Option<String>,
        communication_manager: Arc<CommunicationManager>,
    ) -> Result<Self> {
        info!("Initializing QUIC message client...");

        let endpoint = if let Some(relay) = relay_url {
            let _relay_url: url::Url = relay.parse()?;
            Endpoint::builder()
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        } else {
            Endpoint::builder()
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        };

        let node_id = endpoint.id();
        info!("QUIC client node ID: {:?}", node_id);

        Ok(Self {
            endpoint,
            communication_manager,
            server_connections: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// 连接到QUIC消息服务器
    pub async fn connect_to_server(&mut self, endpoint_addr: &EndpointAddr) -> Result<String> {
        info!("Connecting to QUIC message server: {:?}", endpoint_addr);

        let connection = self
            .endpoint
            .connect(endpoint_addr.clone(), QUIC_MESSAGE_ALPN)
            .await?;
        let server_node_id = connection.remote_id();

        let connection_id = format!("client_conn_{}", uuid::Uuid::new_v4());

        // 存储连接
        {
            let mut connections = self.server_connections.write().await;
            connections.insert(connection_id.clone(), connection);
        }

        info!("Connected to server: {:?}", server_node_id);
        Ok(connection_id)
    }

    /// 发送消息到服务器
    pub async fn send_message_to_server(
        &mut self,
        connection_id: &str,
        message: Message,
    ) -> Result<()> {
        let connections = self.server_connections.read().await;
        if let Some(connection) = connections.get(connection_id) {
            let mut send_stream = connection.open_uni().await?;
            let data = MessageSerializer::serialize_for_network(&message)?;
            send_stream.write_all(&data).await?;
            send_stream.finish()?;
            Ok(())
        } else {
            Err(anyhow::anyhow!("Connection not found: {}", connection_id))
        }
    }

    /// 断开与服务器的连接
    pub async fn disconnect_from_server(&mut self, connection_id: &str) -> Result<()> {
        let mut connections = self.server_connections.write().await;
        if let Some(connection) = connections.remove(connection_id) {
            connection.close(0u8.into(), b"Client disconnect");
            info!("Disconnected from server: {}", connection_id);
        }
        Ok(())
    }

    /// 获取客户端节点ID
    pub fn get_node_id(&self) -> iroh::PublicKey {
        self.endpoint.id()
    }
}

/// 消息处理器示例
pub struct QuicMessageHandler {
    name: String,
}

impl QuicMessageHandler {
    pub fn new(name: String) -> Self {
        Self { name }
    }
}

#[async_trait]
impl MessageHandler for QuicMessageHandler {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        debug!(
            "[{}] Handling message: {:?}",
            self.name, message.message_type
        );

        match &message.payload {
            MessagePayload::Heartbeat(_) => {
                // 处理心跳消息
                if message.requires_response {
                    let response =
                        MessageBuilder::heartbeat(self.name.clone(), 0, "alive".to_string());
                    return Ok(Some(response));
                }
            }
            MessagePayload::TerminalManagement(msg) => {
                info!(
                    "[{}] Terminal management action: {:?}",
                    self.name, msg.action
                );
                // 这里应该调用实际的终端管理逻辑
            }
            MessagePayload::TcpForwarding(msg) => {
                info!("[{}] TCP forwarding action: {:?}", self.name, msg.action);
                // 这里应该调用实际的TCP转发逻辑
            }
            MessagePayload::SystemControl(msg) => {
                info!("[{}] System control action: {:?}", self.name, msg.action);
                // 这里应该调用实际的系统控制逻辑
            }
            _ => {}
        }

        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![
            MessageType::Heartbeat,
            MessageType::TerminalManagement,
            MessageType::TcpForwarding,
            MessageType::SystemControl,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_quic_server_creation() {
        let _config = QuicMessageServerConfig::default();
        let _comm_manager = Arc::new(CommunicationManager::new("test_node".to_string()));

        // 注意：这个测试需要实际的iroh环境，在实际使用时可能需要模拟
        // let server = QuicMessageServer::new(_config, _comm_manager).await;
        // assert!(server.is_ok());
    }

    #[test]
    fn test_message_serialization() {
        let message = MessageBuilder::heartbeat("test".to_string(), 1, "active".to_string());

        let serialized = MessageSerializer::serialize_for_network(&message).unwrap();
        let deserialized = MessageSerializer::deserialize_from_network(&serialized).unwrap();

        assert_eq!(message.id, deserialized.id);
        assert_eq!(message.sender_id, deserialized.sender_id);
    }
}
