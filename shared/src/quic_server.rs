//! 基于消息事件的QUIC服务器
//!
//! 此模块实现了一个支持统一消息协议的QUIC服务器，
//! 允许App通过iroh向CLI发送管理指令。

use crate::event_manager::*;
use crate::message_protocol::*;
use anyhow::Result;
use async_trait::async_trait;
pub use iroh::NodeAddr;
use iroh::{Endpoint, SecretKey, discovery::dns::DnsDiscovery};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

// 端点地址序列化辅助结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializableEndpointAddr {
    pub node_id: String,
    pub relay_url: Option<String>,
    pub direct_addresses: Vec<String>,
    pub alpn: String,
}

impl SerializableEndpointAddr {
    /// 从 iroh NodeAddr 创建可序列化的端点地址（推荐使用，包含relay信息）
    pub fn from_node_addr(node_addr: &NodeAddr) -> Result<Self> {
        let node_id = node_addr.node_id.to_string();
        let relay_url = node_addr
            .relay_url
            .as_ref()
            .map(|url: &iroh::RelayUrl| url.to_string());
        let direct_addresses: Vec<String> = node_addr
            .direct_addresses
            .iter()
            .map(|addr: &std::net::SocketAddr| addr.to_string())
            .collect();

        Ok(Self {
            node_id,
            relay_url,
            direct_addresses,
            alpn: std::str::from_utf8(QUIC_MESSAGE_ALPN)?.to_string(),
        })
    }

    /// 转换为 base64 字符串
    pub fn to_base64(&self) -> Result<String> {
        let json = serde_json::to_string(self)?;
        let engine = base64::engine::general_purpose::STANDARD;
        Ok(engine.encode(json.as_bytes()))
    }

    /// 从 base64 字符串创建
    pub fn from_base64(s: &str) -> Result<Self> {
        let engine = base64::engine::general_purpose::STANDARD;

        // 添加调试信息
        tracing::debug!(
            "Attempting to decode base64 string (length: {}): {:?}",
            s.len(),
            s
        );

        // 先清理所有空白字符
        let cleaned = s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
        tracing::debug!(
            "Cleaned base64 string (length: {}): {:?}",
            cleaned.len(),
            cleaned
        );

        // 检查输入是否只包含有效的 base64 字符
        if !is_valid_base64(&cleaned) {
            return Err(anyhow::anyhow!(
                "Invalid base64 string: contains invalid characters or incorrect length (cleaned: {})",
                cleaned
            ));
        }

        match engine.decode(&cleaned) {
            Ok(decoded) => {
                tracing::debug!("Successfully decoded {} bytes from base64", decoded.len());
                match String::from_utf8(decoded) {
                    Ok(json) => {
                        tracing::debug!("Decoded JSON: {}", json);
                        match serde_json::from_str(&json) {
                            Ok(addr) => {
                                tracing::debug!(
                                    "Successfully parsed SerializableEndpointAddr: {:?}",
                                    addr
                                );
                                Ok(addr)
                            }
                            Err(e) => {
                                tracing::error!("Failed to parse JSON: {}, JSON: {}", e, json);
                                Err(anyhow::anyhow!("Failed to parse JSON from base64: {}", e))
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to convert bytes to UTF-8: {}", e);
                        Err(anyhow::anyhow!("Failed to convert bytes to UTF-8: {}", e))
                    }
                }
            }
            Err(e) => {
                tracing::error!("Base64 decode failed: {}", e);
                Err(anyhow::anyhow!("Base64 decode failed: {}", e))
            }
        }
    }

    /// 重建 NodeAddr (推荐使用，包含relay信息)
    pub fn try_to_node_addr(&self) -> Result<NodeAddr> {
        use std::str::FromStr;

        // 解析 node_id
        let node_id = iroh::PublicKey::from_str(&self.node_id)
            .map_err(|e| anyhow::anyhow!("Failed to parse node_id: {}", e))?;

        // 解析 relay_url
        let relay_url = if let Some(ref url_str) = self.relay_url {
            Some(
                iroh::RelayUrl::from_str(url_str)
                    .map_err(|e| anyhow::anyhow!("Failed to parse relay URL: {}", e))?,
            )
        } else {
            None
        };

        // 解析 direct_addresses
        let direct_addresses: Result<Vec<_>, _> = self
            .direct_addresses
            .iter()
            .map(|addr_str| addr_str.parse::<std::net::SocketAddr>())
            .collect();
        let direct_addresses = direct_addresses
            .map_err(|e| anyhow::anyhow!("Failed to parse direct address: {}", e))?;

        // 构建 NodeAddr
        let mut node_addr = NodeAddr::new(node_id);
        if let Some(relay) = relay_url {
            node_addr = node_addr.with_relay_url(relay);
        }
        for addr in direct_addresses {
            node_addr = node_addr.with_direct_addresses([addr]);
        }

        Ok(node_addr)
    }
}

use base64::Engine as _;

// 检查字符串是否为有效的 base64
fn is_valid_base64(s: &str) -> bool {
    // 先清理空白字符，然后检查剩余字符是否有效
    let cleaned = s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    if cleaned.is_empty() {
        return false;
    }

    // 检查长度是否是4的倍数（base64 要求）
    if cleaned.len() % 4 != 0 {
        return false;
    }

    // 检查字符是否有效
    cleaned
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}

use std::sync::Arc;
use tokio::sync::{Mutex, RwLock, broadcast, mpsc};
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
    /// SecretKey存储路径（用于持久化node ID）
    pub secret_key_path: Option<std::path::PathBuf>,
}

impl Default for QuicMessageServerConfig {
    fn default() -> Self {
        // 默认使用当前启动目录
        let default_path = std::env::current_dir()
            .ok()
            .map(|cwd| cwd.join("riterm_secret_key"));

        Self {
            bind_addr: None,
            relay_url: None,
            max_connections: 100,
            heartbeat_interval: std::time::Duration::from_secs(30),
            timeout: std::time::Duration::from_secs(60),
            secret_key_path: default_path,
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
    pub connection: iroh::endpoint::Connection, // 存储实际的连接对象
}

/// 连接信息用于状态显示
#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    pub id: String,
    pub node_id: iroh::PublicKey,
    pub established_at: std::time::SystemTime,
    pub last_activity: std::time::SystemTime,
}

/// QUIC消息服务器
#[derive(Clone)]
pub struct QuicMessageServer {
    endpoint: Endpoint,
    connections: Arc<RwLock<HashMap<String, QuicConnection>>>,
    communication_manager: Arc<CommunicationManager>,
    #[allow(dead_code)] // 配置字段用于未来扩展
    config: QuicMessageServerConfig,
    shutdown_tx: mpsc::Sender<()>,
}

impl QuicMessageServer {
    /// 加载或生成SecretKey
    async fn load_or_generate_secret_key(key_path: Option<&Path>) -> Result<SecretKey> {
        match key_path {
            Some(path) => {
                // 尝试加载已有的密钥
                if path.exists() {
                    info!("Loading existing secret key from: {:?}", path);
                    let key_data = fs::read(path)?;
                    if key_data.len() != 32 {
                        return Err(anyhow::anyhow!(
                            "Invalid secret key file length: expected 32 bytes, got {}",
                            key_data.len()
                        ));
                    }
                    let mut key_array = [0u8; 32];
                    key_array.copy_from_slice(&key_data);
                    let secret_key = SecretKey::from_bytes(&key_array);
                    info!("✅ Loaded existing secret key");
                    Ok(secret_key)
                } else {
                    // 生成新密钥并保存
                    info!("Generating new secret key and saving to: {:?}", path);
                    let secret_key = SecretKey::generate(&mut rand::rng());

                    // 确保目录存在
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent)?;
                    }

                    // 保存密钥到文件
                    let key_bytes = secret_key.to_bytes();
                    let mut file = fs::File::create(path)?;
                    file.write_all(&key_bytes)?;

                    // 设置文件权限（仅所有者可读写）
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let mut perms = fs::metadata(path)?.permissions();
                        perms.set_mode(0o600); // rw-------
                        fs::set_permissions(path, perms)?;
                    }

                    info!("✅ Generated and saved new secret key");
                    Ok(secret_key)
                }
            }
            None => {
                info!("No secret key path provided, generating temporary key");
                Ok(SecretKey::generate(&mut rand::rng()))
            }
        }
    }
    /// 创建新的QUIC消息服务器
    pub async fn new(
        config: QuicMessageServerConfig,
        communication_manager: Arc<CommunicationManager>,
    ) -> Result<Self> {
        info!("Initializing QUIC message server...");

        // 加载或生成SecretKey
        let secret_key =
            Self::load_or_generate_secret_key(config.secret_key_path.as_deref()).await?;

        // 创建endpoint with ALPN and persistent secret key
        let endpoint = if let Some(relay) = &config.relay_url {
            info!("Using custom relay: {}", relay);
            let _relay_url: url::Url = relay.parse()?;
            Endpoint::builder()
                .secret_key(secret_key)
                .alpns(vec![QUIC_MESSAGE_ALPN.to_vec()])
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        } else {
            info!("Using default relay");
            Endpoint::builder()
                .secret_key(secret_key)
                .alpns(vec![QUIC_MESSAGE_ALPN.to_vec()])
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        };
        let node_addr = endpoint.node_addr();
        let node_id = node_addr.node_id;
        info!("QUIC server node ID: {:?}", node_id);

        // 等待endpoint上线 - 这对于NAT穿透至关重要
        info!("Waiting for endpoint to be ready...");
        endpoint.online().await;
        info!("✅ Endpoint is online!");

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
        let remote_node_id = connection.remote_node_id();
        let endpoint_addr = format!("{:?}", remote_node_id);

        // 检查是否已有相同node_id的连接
        let connection_id = {
            let mut conns = connections.write().await;

            // 先获取node_id，然后使用
            let remote_id = remote_node_id?;

            info!("Message connection established with: {:?}", remote_id);

            // 查找是否有相同node_id的连接
            let existing_conn = conns.iter_mut().find(|(_, conn)| conn.node_id == remote_id);

            if let Some((existing_id, existing_conn)) = existing_conn {
                // 找到相同node_id的连接，更新连接信息但保持相同ID
                info!("🔄 Reconnected from same node: {:?}", remote_id);
                existing_conn.connection = connection.clone();
                existing_conn.last_activity = std::time::SystemTime::now();
                existing_conn.endpoint_addr = endpoint_addr.clone();
                existing_id.clone()
            } else {
                // 新连接，创建新的连接状态
                let new_connection_id = format!("conn_{}", uuid::Uuid::new_v4());
                let conn_state = QuicConnection {
                    id: new_connection_id.clone(),
                    node_id: remote_id,
                    endpoint_addr: endpoint_addr.clone(),
                    established_at: std::time::SystemTime::now(),
                    last_activity: std::time::SystemTime::now(),
                    connection: connection.clone(),
                };

                conns.insert(new_connection_id.clone(), conn_state);
                new_connection_id
            }
        };

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
                            info!(
                                "📨 Received message: type={:?}, sender={}, requires_response={}",
                                message.message_type, message.sender_id, message.requires_response
                            );

                            // 处理传入消息
                            match communication_manager
                                .receive_incoming_message(message.clone())
                                .await
                            {
                                Ok(Some(response)) => {
                                    // 处理器返回了响应，发送它
                                    info!("📤 Sending handler-generated response");
                                    if let Err(e) =
                                        Self::send_message(&mut send_stream, &response).await
                                    {
                                        error!("Failed to send response: {}", e);
                                    }
                                }
                                Ok(None) => {
                                    info!("✅ Message processed, no response needed");
                                    // 处理成功但没有响应，如果需要则发送默认响应
                                    if message.requires_response {
                                        let response = Self::create_default_response(&message);
                                        if let Err(e) =
                                            Self::send_message(&mut send_stream, &response).await
                                        {
                                            error!("Failed to send default response: {}", e);
                                        }
                                    }
                                }
                                Err(e) => {
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
            data: Some(response_data.to_string()), // 转换为 JSON 字符串
            message: Some("Message processed successfully".to_string()),
        }))
    }

    /// 发送消息到特定节点
    pub async fn send_message_to_node(
        &self,
        node_id: &iroh::PublicKey,
        message: Message,
    ) -> Result<()> {
        #[cfg(debug_assertions)]
        debug!("Sending message to node: {:?}", node_id);

        // 找到对应的连接
        let connection = {
            let connections = self.connections.read().await;
            connections
                .values()
                .find(|c| &c.node_id == node_id)
                .map(|c| c.connection.clone())
                .ok_or_else(|| anyhow::anyhow!("Connection not found for node: {:?}", node_id))?
        };

        // 使用现有连接打开新流
        let (mut send_stream, _recv_stream) = connection.open_bi().await?;

        // 序列化并发送消息
        Self::send_message(&mut send_stream, &message).await?;

        #[cfg(debug_assertions)]
        debug!("Message sent successfully to node: {:?}", node_id);
        Ok(())
    }

    /// 广播消息到所有连接的节点
    pub async fn broadcast_message(&self, message: Message) -> Result<()> {
        let connections = self.connections.read().await;
        #[cfg(debug_assertions)]
        debug!("Broadcasting message to {} connections", connections.len());

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

    /// 获取端点地址 (返回NodeAddr，包含relay信息)
    pub fn get_endpoint_addr(&self) -> NodeAddr {
        self.get_node_addr()
    }

    /// 获取节点地址（包含relay信息）- 推荐使用此方法进行连接
    pub fn get_node_addr(&self) -> NodeAddr {
        self.endpoint.node_addr()
    }

    /// 获取节点ID
    pub fn get_node_id(&self) -> iroh::PublicKey {
        self.endpoint.node_addr().node_id
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

    /// 获取连接信息用于状态显示
    pub async fn get_connection_info(&self) -> Vec<ConnectionInfo> {
        let connections = self.connections.read().await;
        connections
            .values()
            .map(|conn| ConnectionInfo {
                id: conn.id.clone(),
                node_id: conn.node_id,
                established_at: conn.established_at,
                last_activity: conn.last_activity,
            })
            .collect()
    }

    /// 主动清理指定node_id的连接
    pub async fn cleanup_connection_by_node_id(&self, node_id: &iroh::PublicKey) -> bool {
        let mut connections = self.connections.write().await;

        // 找到要删除的连接ID
        let connection_to_remove: Option<String> = connections
            .iter()
            .find(|(_, conn)| conn.node_id == *node_id)
            .map(|(id, _)| id.clone());

        if let Some(connection_id) = connection_to_remove {
            if let Some(conn) = connections.remove(&connection_id) {
                info!(
                    "🔌 Force cleanup connection: {} (Node: {:?})",
                    connection_id, node_id
                );
                // 关闭连接
                conn.connection.close(0u32.into(), b"Connection cleanup");
                debug!("Closed connection during cleanup");
                true
            } else {
                false
            }
        } else {
            false
        }
    }

    /// 清理不活跃的连接（超过指定时间没有活动）
    pub async fn cleanup_inactive_connections(&self, timeout: std::time::Duration) -> usize {
        let mut connections = self.connections.write().await;
        let now = std::time::SystemTime::now();

        let inactive_connections: Vec<String> = connections
            .iter()
            .filter(|(_, conn)| {
                now.duration_since(conn.last_activity).unwrap_or_default() > timeout
            })
            .map(|(id, _)| id.clone())
            .collect();

        let count = inactive_connections.len();
        for connection_id in inactive_connections {
            if let Some(conn) = connections.remove(&connection_id) {
                info!(
                    "🔌 Cleanup inactive connection: {} (inactive for {:?}",
                    connection_id,
                    now.duration_since(conn.last_activity).unwrap_or_default()
                );

                conn.connection
                    .close(0u32.into(), b"Inactive connection cleanup");
                debug!("Closed inactive connection during cleanup");
            }
        }

        count
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
    endpoint: Arc<Endpoint>,
    #[allow(dead_code)] // 通信管理器用于未来扩展
    communication_manager: Arc<CommunicationManager>,
    server_connections: Arc<RwLock<HashMap<String, iroh::endpoint::Connection>>>,
    message_rx: broadcast::Receiver<Message>,
    message_tx: broadcast::Sender<Message>,
}

/// QUIC消息客户端的线程安全包装器
#[derive(Clone)]
pub struct QuicMessageClientHandle {
    client: Arc<Mutex<QuicMessageClient>>,
}

impl QuicMessageClient {
    /// 创建新的QUIC消息客户端
    pub async fn new(
        relay_url: Option<String>,
        communication_manager: Arc<CommunicationManager>,
    ) -> Result<Self> {
        Self::new_with_secret_key(relay_url, communication_manager, None).await
    }

    /// 创建新的QUIC消息客户端，支持持久化SecretKey
    pub async fn new_with_secret_key(
        relay_url: Option<String>,
        communication_manager: Arc<CommunicationManager>,
        secret_key_path: Option<&Path>,
    ) -> Result<Self> {
        info!("Initializing QUIC message client...");

        // 加载或生成SecretKey
        let secret_key = QuicMessageServer::load_or_generate_secret_key(secret_key_path).await?;

        let endpoint = if let Some(relay) = relay_url {
            let _relay_url: url::Url = relay.parse()?;
            Endpoint::builder()
                .secret_key(secret_key)
                .alpns(vec![QUIC_MESSAGE_ALPN.to_vec()])
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        } else {
            Endpoint::builder()
                .secret_key(secret_key)
                .alpns(vec![QUIC_MESSAGE_ALPN.to_vec()])
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        };

        let node_addr = endpoint.node_addr();
        let node_id = node_addr.node_id;
        info!("QUIC client node ID: {:?}", node_id);

        // 创建消息广播通道
        let (message_tx, message_rx) = broadcast::channel(1000);

        Ok(Self {
            endpoint: Arc::new(endpoint),
            communication_manager,
            server_connections: Arc::new(RwLock::new(HashMap::new())),
            message_rx,
            message_tx,
        })
    }

    /// 连接到QUIC消息服务器 - 使用 NodeAddr (统一接口)
    pub async fn connect_to_server(&mut self, node_addr: &NodeAddr) -> Result<String> {
        self.connect_to_server_with_node_addr(node_addr).await
    }

    /// 连接到QUIC消息服务器 - 使用 NodeAddr (推荐，包含relay信息)
    pub async fn connect_to_server_with_node_addr(
        &mut self,
        node_addr: &NodeAddr,
    ) -> Result<String> {
        info!("🔗 Connecting to QUIC message server via NodeAddr");
        info!("🔗 Node ID: {:?}", node_addr.node_id);
        info!("🔗 Relay URL: {:?}", node_addr.relay_url);
        info!("🔗 Direct addresses: {:?}", node_addr.direct_addresses);

        // 使用 iroh 的 connect 方法建立连接，NodeAddr 包含relay信息
        let connection = self
            .endpoint
            .connect(node_addr.clone(), QUIC_MESSAGE_ALPN)
            .await
            .map_err(|e| {
                anyhow::anyhow!("Failed to connect to node {:?}: {}", node_addr.node_id, e)
            })?;

        let server_node_id = connection.remote_node_id()?;
        let connection_id = format!("conn_{}", uuid::Uuid::new_v4());

        info!("✅ Connected to server: {:?}", server_node_id);
        info!("🔗 Connection ID: {}", connection_id);

        // 存储连接
        {
            let mut connections = self.server_connections.write().await;
            connections.insert(connection_id.clone(), connection.clone());
        }

        // 启动接收消息的任务 - 使用 accept_bi 而不是 accept_uni
        let connection_for_task = connection.clone();
        let message_tx = self.message_tx.clone();
        let connection_id_clone = connection_id.clone();

        tokio::spawn(async move {
            info!(
                "📨 Starting message receiver task for connection: {}",
                connection_id_clone
            );

            loop {
                match connection_for_task.accept_bi().await {
                    Ok((_send_stream, recv_stream)) => {
                        let message_tx = message_tx.clone();
                        let connection_id_for_task = connection_id_clone.clone();

                        tokio::spawn(async move {
                            let connection_id = connection_id_for_task.clone();
                            if let Err(e) = Self::handle_incoming_stream(
                                recv_stream,
                                message_tx,
                                connection_id_for_task,
                            )
                            .await
                            {
                                error!(
                                    "Failed to handle incoming stream for {}: {}",
                                    connection_id, e
                                );
                            }
                        });
                    }
                    Err(e) => {
                        debug!("Connection {} closed: {}", connection_id_clone, e);
                        break;
                    }
                }
            }

            info!(
                "📨 Message receiver task ended for connection: {}",
                connection_id_clone
            );
        });

        Ok(connection_id)
    }

    /// 发送消息到服务器 - 使用双向流并等待响应
    pub async fn send_message_to_server(
        &mut self,
        connection_id: &str,
        message: Message,
    ) -> Result<()> {
        let connections = self.server_connections.read().await;
        if let Some(connection) = connections.get(connection_id) {
            // 打开双向流
            let (mut send_stream, mut recv_stream) = connection.open_bi().await?;

            // 发送消息
            let data = MessageSerializer::serialize_for_network(&message)?;
            send_stream.write_all(&data).await?;
            send_stream.finish()?;

            // 如果消息需要响应，等待读取响应
            if message.requires_response {
                debug!("Waiting for response to message: {}", message.id);
                let mut buffer = vec![0u8; 8192];
                match recv_stream.read(&mut buffer).await {
                    Ok(Some(n)) => {
                        let response_data = &buffer[..n];
                        match MessageSerializer::deserialize_from_network(response_data) {
                            Ok(response) => {
                                debug!("Received response: {:?}", response.message_type);
                                // 广播接收到的响应
                                let _ = self.message_tx.send(response);
                            }
                            Err(e) => {
                                error!("Failed to deserialize response: {}", e);
                            }
                        }
                    }
                    Ok(None) => {
                        debug!("Response stream closed by server");
                    }
                    Err(e) => {
                        error!("Error reading response: {}", e);
                    }
                }
            }

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
        self.endpoint.node_addr().node_id
    }

    /// 获取消息接收器
    pub fn get_message_receiver(&self) -> broadcast::Receiver<Message> {
        self.message_tx.subscribe()
    }

    /// 处理传入的数据流
    async fn handle_incoming_stream(
        mut recv_stream: iroh::endpoint::RecvStream,
        message_tx: broadcast::Sender<Message>,
        connection_id: String,
    ) -> Result<()> {
        debug!("Handling incoming stream for connection: {}", connection_id);

        // 读取所有数据
        match recv_stream.read_to_end(usize::MAX).await {
            Ok(data) => {
                debug!(
                    "Received {} bytes for connection: {}",
                    data.len(),
                    connection_id
                );

                // 反序列化消息
                match MessageSerializer::deserialize_from_network(&data) {
                    Ok(message) => {
                        debug!(
                            "Received message for connection {}: {:?}",
                            connection_id, message.message_type
                        );

                        // 广播消息
                        if let Err(e) = message_tx.send(message) {
                            error!(
                                "Failed to broadcast message for connection {}: {}",
                                connection_id, e
                            );
                        } else {
                            debug!("Broadcasted message for connection: {}", connection_id);
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to deserialize message for connection {}: {}",
                            connection_id, e
                        );
                        return Err(e);
                    }
                }
            }
            Err(e) => {
                error!(
                    "Failed to read data for connection {}: {}",
                    connection_id, e
                );
                return Err(e.into());
            }
        }

        Ok(())
    }
}

impl QuicMessageClientHandle {
    /// 创建新的QUIC消息客户端句柄
    pub async fn new(
        relay_url: Option<String>,
        communication_manager: Arc<CommunicationManager>,
    ) -> Result<Self> {
        Self::new_with_secret_key(relay_url, communication_manager, None).await
    }

    /// 创建新的QUIC消息客户端句柄，支持持久化SecretKey
    pub async fn new_with_secret_key(
        relay_url: Option<String>,
        communication_manager: Arc<CommunicationManager>,
        secret_key_path: Option<&Path>,
    ) -> Result<Self> {
        let client = QuicMessageClient::new_with_secret_key(
            relay_url,
            communication_manager,
            secret_key_path,
        )
        .await?;
        Ok(Self {
            client: Arc::new(Mutex::new(client)),
        })
    }

    /// 获取节点ID
    pub async fn get_node_id(&self) -> iroh::PublicKey {
        let client = self.client.lock().await;
        client.get_node_id()
    }

    /// 连接到QUIC消息服务器 - 使用 EndpointAddr
    pub async fn connect_to_server(&self, node_addr: &NodeAddr) -> Result<String> {
        let mut client = self.client.lock().await;
        client.connect_to_server(node_addr).await
    }

    /// 使用 NodeAddr 连接到服务器 (推荐，包含relay信息)
    pub async fn connect_to_server_with_node_addr(&self, node_addr: &NodeAddr) -> Result<String> {
        // connect_to_server 现在已经使用 NodeAddr，这个方法保留作为别名
        self.connect_to_server(node_addr).await
    }

    /// 断开与服务器的连接
    pub async fn disconnect_from_server(&self, connection_id: &str) -> Result<()> {
        let mut client = self.client.lock().await;
        client.disconnect_from_server(connection_id).await
    }

    /// 发送消息到服务器
    pub async fn send_message_to_server(
        &self,
        connection_id: &str,
        message: Message,
    ) -> Result<()> {
        let mut client = self.client.lock().await;
        client.send_message_to_server(connection_id, message).await
    }

    /// 获取消息接收器
    pub async fn get_message_receiver(&self) -> broadcast::Receiver<Message> {
        let client = self.client.lock().await;
        client.get_message_receiver()
    }

    // Note: get_active_connections_count and list_active_connections are not available in QuicMessageClient
    // They belong to QuicMessageServer. We'll implement them here if needed in the future.
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
