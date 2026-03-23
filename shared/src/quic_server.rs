//! 基于消息事件的QUIC服务器
//!
//! 此模块实现了一个支持统一消息协议的QUIC服务器，
//! 允许App通过iroh向CLI发送管理指令。

use crate::event_manager::*;
use crate::message_protocol::*;
use anyhow::Result;
use async_trait::async_trait;
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey, discovery::dns::DnsDiscovery};
use iroh_base::{RelayUrl, TransportAddr};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

// Type aliases for compatibility - using simplified approach for now
pub type NodeId = EndpointId;

// 端点地址序列化辅助结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializableEndpointAddr {
    pub node_id: String,
    pub relay_url: Option<String>,
    pub direct_addresses: Vec<String>,
    pub alpn: String,
}

impl SerializableEndpointAddr {
    /// 从 endpoint_id 创建可序列化的端点地址（兼容旧版本）
    pub fn from_endpoint_id(endpoint_id: EndpointId, alpn: &[u8]) -> Result<Self> {
        Self::from_endpoint_info(endpoint_id, None, vec![], alpn)
    }

    /// 从完整信息创建可序列化的端点地址
    pub fn from_endpoint_info(
        endpoint_id: EndpointId,
        relay_url: Option<String>,
        direct_addresses: Vec<String>,
        alpn: &[u8],
    ) -> Result<Self> {
        Ok(Self {
            node_id: endpoint_id.to_string(),
            relay_url,
            direct_addresses,
            alpn: std::str::from_utf8(alpn)?.to_string(),
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

    /// 重建 EndpointId
    pub fn try_to_endpoint_id(&self) -> Result<EndpointId> {
        use std::str::FromStr;

        // 解析 endpoint_id
        let endpoint_id = EndpointId::from_str(&self.node_id)
            .map_err(|e| anyhow::anyhow!("Failed to parse endpoint_id: {}", e))?;

        Ok(endpoint_id)
    }

    /// 重建 iroh::EndpointAddr，包含 direct addresses 和 relay_url
    /// 用于支持直连穿透
    pub fn try_to_node_addr(&self) -> Result<EndpointAddr> {
        use std::collections::BTreeSet;
        use std::net::SocketAddr;
        use std::str::FromStr;

        // 解析 endpoint_id
        let public_key = iroh_base::PublicKey::from_str(&self.node_id)
            .map_err(|e| anyhow::anyhow!("Failed to parse endpoint_id: {}", e))?;

        // 创建地址集合
        let mut addrs = BTreeSet::new();

        // 添加 direct addresses
        for addr_str in &self.direct_addresses {
            if let Ok(addr) = SocketAddr::from_str(addr_str) {
                addrs.insert(TransportAddr::Ip(addr));
                tracing::info!("Added direct address: {}", addr);
            } else {
                tracing::warn!("Invalid direct address: {}", addr_str);
            }
        }

        // 添加 relay_url（如果存在）
        let relay_url = if let Some(ref relay_url_str) = self.relay_url {
            if let Ok(url) = relay_url_str.parse::<RelayUrl>() {
                tracing::info!("Added relay URL: {}", relay_url_str);
                Some(url)
            } else {
                tracing::warn!("Invalid relay URL: {}", relay_url_str);
                None
            }
        } else {
            None
        };

        // 如果有 relay URL，添加到地址集合
        if let Some(url) = relay_url {
            addrs.insert(TransportAddr::Relay(url));
        }

        // 创建 EndpointAddr
        Ok(EndpointAddr::from_parts(public_key, addrs))
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

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock, broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

/// ALPN协议标识符
pub const QUIC_MESSAGE_ALPN: &[u8] = b"com.clawdpilot.messages/1";

/// TCP转发握手协议魔数
/// 格式: [魔数(5字节)] [session_id长度(4字节u32BE)] [session_id(UTF-8字符串)]
pub const TCP_STREAM_HANDSHAKE: &[u8] = &[0x00, 0x01, 0x02, 0x03, 0x04];

/// TCP 流处理器类型
/// 接收 (send_stream, recv_stream, remote_endpoint_id, session_id)，返回 Future
pub type TcpStreamHandler = Arc<
    dyn Fn(
            iroh::endpoint::SendStream,
            iroh::endpoint::RecvStream,
            EndpointId,
            String, // session_id
        ) -> Pin<Box<dyn Future<Output = Result<()>> + Send>>
        + Send
        + Sync,
>;

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
            .map(|cwd| cwd.join("clawdchat_secret_key"));

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
    pub node_id: EndpointId,
    pub endpoint_addr: String,
    pub established_at: std::time::SystemTime,
    pub last_activity: std::time::SystemTime,
    pub connection: iroh::endpoint::Connection, // 存储实际的连接对象
}

/// 连接信息用于状态显示
#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    pub id: String,
    pub node_id: EndpointId,
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
    /// TCP 流处理器（用于处理 TCP 转发流）
    tcp_stream_handler: Arc<RwLock<Option<TcpStreamHandler>>>,
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

        // 创建endpoint builder
        let mut builder = Endpoint::builder()
            .secret_key(secret_key)
            .alpns(vec![QUIC_MESSAGE_ALPN.to_vec()])
            .discovery(DnsDiscovery::n0_dns());

        // 如果指定了 bind_addr，使用它
        if let Some(ref bind_addr) = config.bind_addr {
            info!("Binding to address: {}", bind_addr);
            // 使用 bind_addr_v4 或 bind_addr_v6 方法
            match bind_addr {
                std::net::SocketAddr::V4(addr_v4) => {
                    builder = builder.bind_addr_v4(*addr_v4);
                }
                std::net::SocketAddr::V6(addr_v6) => {
                    builder = builder.bind_addr_v6(*addr_v6);
                }
            }
        }

        // 创建endpoint
        let endpoint = builder.bind().await?;

        // 如果指定了 relay，也记录一下
        if let Some(ref relay) = config.relay_url {
            info!("Using custom relay: {}", relay);
        } else {
            info!("Using default relay");
        }

        let node_id = endpoint.id();
        info!("QUIC server node ID: {:?}", node_id);

        // 如果使用了固定端口，记录实际绑定的地址
        if let Some(ref bind_addr) = config.bind_addr {
            if bind_addr.port() != 0 {
                // 端口不是 0，说明是固定端口
                info!("Server bound to fixed port: {}", bind_addr);
            }
        }

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
            tcp_stream_handler: Arc::new(RwLock::new(None)),
        };

        // 启动连接接受器
        server.start_connection_acceptor(shutdown_rx).await?;

        Ok(server)
    }

    /// 设置 TCP 流处理器
    /// 当收到 TCP 转发流时，会调用此处理器
    pub async fn set_tcp_stream_handler(&self, handler: TcpStreamHandler) {
        let mut guard = self.tcp_stream_handler.write().await;
        *guard = Some(handler);
        info!("TCP stream handler registered");
    }

    /// 启动连接接受器
    async fn start_connection_acceptor(&self, shutdown_rx: mpsc::Receiver<()>) -> Result<()> {
        let endpoint = self.endpoint.clone();
        let connections = self.connections.clone();
        let comm_manager = self.communication_manager.clone();
        let tcp_handler = self.tcp_stream_handler.clone();

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
                                let handler = tcp_handler.clone();

                                tokio::spawn(async move {
                                    // Directly handle the incoming connection by accepting it
                                    if let Err(e) = Self::handle_connection(
                                        connecting,
                                        conn,
                                        cm,
                                        handler,
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
        tcp_stream_handler: Arc<RwLock<Option<TcpStreamHandler>>>,
    ) -> Result<()> {
        // 执行握手（30s超时，防止慢连接或恶意对端长期占用资源）
        let connection = tokio::time::timeout(std::time::Duration::from_secs(30), incoming)
            .await
            .map_err(|_| anyhow::anyhow!("Incoming connection handshake timed out after 30s"))??;
        let remote_endpoint_id = connection.remote_id();
        let endpoint_addr = format!("{:?}", remote_endpoint_id);

        // 检查是否已有相同endpoint_id的连接
        let connection_id = {
            let mut conns = connections.write().await;

            info!(
                "Message connection established with: {:?}",
                remote_endpoint_id
            );

            // 查找是否有相同endpoint_id的连接
            let existing_conn = conns
                .iter_mut()
                .find(|(_, conn)| conn.node_id == remote_endpoint_id);

            if let Some((existing_id, existing_conn)) = existing_conn {
                // 找到相同endpoint_id的连接，更新连接信息但保持相同ID
                info!("🔄 Reconnected from same node: {:?}", remote_endpoint_id);
                existing_conn.connection = connection.clone();
                existing_conn.last_activity = std::time::SystemTime::now();
                existing_conn.endpoint_addr = endpoint_addr.clone();
                existing_id.clone()
            } else {
                // 新连接，创建新的连接状态
                let new_connection_id = format!("conn_{}", uuid::Uuid::new_v4());
                let conn_state = QuicConnection {
                    id: new_connection_id.clone(),
                    node_id: remote_endpoint_id,
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
        Self::handle_message_streams(
            connection,
            connection_id,
            communication_manager,
            tcp_stream_handler,
        )
        .await
    }

    /// 处理消息流
    async fn handle_message_streams(
        connection: iroh::endpoint::Connection,
        connection_id: String,
        communication_manager: Arc<CommunicationManager>,
        tcp_stream_handler: Arc<RwLock<Option<TcpStreamHandler>>>,
    ) -> Result<()> {
        let remote_endpoint_id = connection.remote_id();

        // 接受双向流用于消息通信
        loop {
            match connection.accept_bi().await {
                Ok((send_stream, mut recv_stream)) => {
                    let cm = communication_manager.clone();
                    let conn_id = connection_id.clone();
                    let handler = tcp_stream_handler.clone();
                    let remote_id = remote_endpoint_id;

                    tokio::spawn(async move {
                        // 首先读取前几个字节来判断是 TCP 流还是消息流
                        let mut peek_buf = vec![0u8; TCP_STREAM_HANDSHAKE.len()];
                        match recv_stream.read_exact(&mut peek_buf).await {
                            Ok(()) => {
                                if peek_buf == TCP_STREAM_HANDSHAKE {
                                    // 这是 TCP 转发流，继续读取 session_id
                                    info!("🔌 Detected TCP forwarding stream from {:?}", remote_id);

                                    // 读取 session_id 长度 (4字节 u32 BE)
                                    let mut len_buf = [0u8; 4];
                                    if let Err(e) = recv_stream.read_exact(&mut len_buf).await {
                                        error!("Failed to read session_id length: {}", e);
                                        return;
                                    }
                                    let session_id_len = u32::from_be_bytes(len_buf) as usize;

                                    // 防止过大的 session_id
                                    if session_id_len > 1024 {
                                        error!("Session ID too long: {}", session_id_len);
                                        return;
                                    }

                                    // 读取 session_id
                                    let mut session_id_buf = vec![0u8; session_id_len];
                                    if let Err(e) =
                                        recv_stream.read_exact(&mut session_id_buf).await
                                    {
                                        error!("Failed to read session_id: {}", e);
                                        return;
                                    }

                                    let session_id = match String::from_utf8(session_id_buf) {
                                        Ok(s) => s,
                                        Err(e) => {
                                            error!("Invalid session_id (not UTF-8): {}", e);
                                            return;
                                        }
                                    };

                                    info!("🔌 TCP stream for session: {}", session_id);

                                    // 获取 TCP 流处理器
                                    let tcp_handler = {
                                        let guard = handler.read().await;
                                        guard.clone()
                                    };

                                    if let Some(tcp_handler) = tcp_handler {
                                        if let Err(e) = tcp_handler(
                                            send_stream,
                                            recv_stream,
                                            remote_id,
                                            session_id,
                                        )
                                        .await
                                        {
                                            error!("Error handling TCP stream: {}", e);
                                        }
                                    } else {
                                        warn!("Received TCP stream but no handler registered");
                                    }
                                } else {
                                    // 这是消息流，需要将已读取的字节传递给消息处理器
                                    if let Err(e) = Self::handle_message_stream_with_initial_data(
                                        send_stream,
                                        recv_stream,
                                        cm,
                                        conn_id,
                                        peek_buf,
                                    )
                                    .await
                                    {
                                        error!("Error handling message stream: {}", e);
                                    }
                                }
                            }
                            Err(e) => {
                                error!("Error reading stream header: {}", e);
                            }
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

    /// 处理单个消息流（带有初始数据）
    async fn handle_message_stream_with_initial_data(
        mut send_stream: iroh::endpoint::SendStream,
        mut recv_stream: iroh::endpoint::RecvStream,
        communication_manager: Arc<CommunicationManager>,
        connection_id: String,
        initial_data: Vec<u8>,
    ) -> Result<()> {
        let mut buffer = vec![0u8; 8192];
        // 累积缓冲区：支持半包/粘包
        let mut pending_data = initial_data;
        debug!(
            "message-stream start: connection_id={}, initial_data_len={}",
            connection_id,
            pending_data.len()
        );

        loop {
            // 尽可能解析 pending_data 里的完整帧：[len:4be][payload:len]
            while pending_data.len() >= 4 {
                let length = u32::from_be_bytes([
                    pending_data[0],
                    pending_data[1],
                    pending_data[2],
                    pending_data[3],
                ]) as usize;

                if pending_data.len() < 4 + length {
                    // 半包，继续读取
                    break;
                }

                let message_bytes = pending_data[4..4 + length].to_vec();
                pending_data.drain(..4 + length);

                match Message::from_bytes(&message_bytes) {
                    Ok(message) => {
                        info!(
                            "📨 Received message: connection_id={}, type={:?}, sender={}, requires_response={}, frame_len={}",
                            connection_id,
                            message.message_type,
                            message.sender_id,
                            message.requires_response,
                            message_bytes.len()
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
                        let preview = message_bytes
                            .iter()
                            .take(24)
                            .map(|b| format!("{:02x}", b))
                            .collect::<Vec<_>>()
                            .join(" ");
                        // Best-effort frame introspection for protocol mismatch diagnostics.
                        let mut parsed_id: Option<String> = None;
                        let mut parsed_type_tag: Option<u32> = None;
                        if message_bytes.len() >= 8 {
                            let id_len = u64::from_le_bytes([
                                message_bytes[0],
                                message_bytes[1],
                                message_bytes[2],
                                message_bytes[3],
                                message_bytes[4],
                                message_bytes[5],
                                message_bytes[6],
                                message_bytes[7],
                            ]) as usize;
                            if message_bytes.len() >= 8 + id_len {
                                parsed_id = std::str::from_utf8(&message_bytes[8..8 + id_len])
                                    .ok()
                                    .map(|s| s.to_string());
                                if message_bytes.len() >= 8 + id_len + 4 {
                                    parsed_type_tag = Some(u32::from_le_bytes([
                                        message_bytes[8 + id_len],
                                        message_bytes[8 + id_len + 1],
                                        message_bytes[8 + id_len + 2],
                                        message_bytes[8 + id_len + 3],
                                    ]));
                                }
                            }
                        }
                        error!(
                            "Failed to deserialize message: connection_id={}, frame_len={}, parsed_id={:?}, parsed_type_tag={:?}, error={}",
                            connection_id,
                            message_bytes.len(),
                            parsed_id,
                            parsed_type_tag,
                            e
                        );

                        // Try to parse the message with more context
                        if parsed_type_tag == Some(14) {
                            // RemoteSpawn
                            error!(
                                "RemoteSpawn deserialization failed. This is likely a bincode schema mismatch. \
                                Expected fields: id(36), sender_id(3), session_id(45), project_path(12), args(0), mcp_servers(None), request_id(36)"
                            );
                        }
                    }
                }
            }

            match recv_stream.read(&mut buffer).await {
                Ok(Some(n)) => {
                    pending_data.extend_from_slice(&buffer[..n]);
                    debug!(
                        "message-stream read: connection_id={}, read_bytes={}, buffered_bytes={}",
                        connection_id,
                        n,
                        pending_data.len()
                    );
                }
                Ok(None) => {
                    if !pending_data.is_empty() {
                        warn!(
                            "Stream closed with incomplete message data: connection_id={}, buffered_bytes={}",
                            connection_id,
                            pending_data.len()
                        );
                    } else {
                        debug!("Stream closed by peer: connection_id={}", connection_id);
                    }
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
        // finish() may fail if the peer has already closed their receive side.
        // This is not necessarily an error - the data may have been received.
        if let Err(e) = send_stream.finish() {
            debug!("Stream finish returned error (may be expected): {}", e);
        }
        Ok(())
    }

    /// 判断消息类型是否应该使用独立 stream 发送
    fn is_streaming_message(msg_type: MessageType) -> bool {
        matches!(msg_type, MessageType::AgentMessage | MessageType::TcpData)
    }

    /// 通过独立 uni-stream 发送流式消息（AgentMessage、TcpData）
    /// 返回 stream ID 用于追踪
    pub async fn send_streaming_message(
        &self,
        node_id: &EndpointId,
        message: &Message,
    ) -> Result<u64> {
        let connection = {
            let connections = self.connections.read().await;
            connections
                .values()
                .find(|c| c.node_id == *node_id)
                .map(|c| c.connection.clone())
                .ok_or_else(|| anyhow::anyhow!("Connection not found for node: {:?}", node_id))?
        };

        let mut send_stream = connection.open_uni().await?;
        let data = MessageSerializer::serialize_for_network(message)?;
        send_stream.write_all(&data).await?;
        send_stream.finish()?;

        Ok(send_stream.id().into())
    }

    /// 发送消息到特定节点（自动选择传输方式）
    /// - AgentMessage/TcpData: 使用独立 uni-stream
    /// - 其他消息类型: 使用共享 BiDi stream
    pub async fn send_message_to_node_auto(
        &self,
        node_id: &EndpointId,
        message: &Message,
    ) -> Result<()> {
        if Self::is_streaming_message(message.message_type) {
            self.send_streaming_message(node_id, message).await?;
        } else {
            self.send_message_to_node(node_id, message.clone()).await?;
        }
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
    pub async fn send_message_to_node(&self, node_id: &EndpointId, message: Message) -> Result<()> {
        #[cfg(debug_assertions)]
        debug!("Sending message to node: {:?}", node_id);

        // 找到对应的连接
        let connection = {
            let connections = self.connections.read().await;
            connections
                .values()
                .find(|c| c.node_id == *node_id)
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
    ///
    /// 当发送失败时，会自动清理断开的连接。客户端重连后可以恢复接收消息。
    pub async fn broadcast_message(&self, message: Message) -> Result<()> {
        // 先收集所有连接的快照（避免在发送时持有锁）
        let connection_snapshots: Vec<(String, EndpointId, iroh::endpoint::Connection)> = {
            let connections = self.connections.read().await;
            #[cfg(debug_assertions)]
            debug!("Broadcasting message to {} connections", connections.len());
            connections
                .iter()
                .map(|(id, c)| (id.clone(), c.node_id.clone(), c.connection.clone()))
                .collect()
        };

        // 无锁发送
        let mut failed_node_ids: Vec<(String, EndpointId)> = Vec::new();

        for (conn_id, node_id, connection) in &connection_snapshots {
            match connection.open_bi().await {
                Ok((mut send_stream, _recv_stream)) => {
                    if let Err(e) = Self::send_message(&mut send_stream, &message).await {
                        error!("Failed to send message to node {:?}: {}", node_id, e);
                        failed_node_ids.push((conn_id.clone(), node_id.clone()));
                    }
                }
                Err(e) => {
                    error!("Failed to open stream to node {:?}: {}", node_id, e);
                    failed_node_ids.push((conn_id.clone(), node_id.clone()));
                }
            }
        }

        // 清理发送失败的连接
        if !failed_node_ids.is_empty() {
            let mut connections = self.connections.write().await;
            for (conn_id, node_id) in failed_node_ids {
                if let Some(conn) = connections.remove(&conn_id) {
                    info!(
                        "Auto cleanup disconnected node: {:?} (connection: {})",
                        node_id, conn_id
                    );
                    conn.connection
                        .close(0u32.into(), b"Send failed, auto cleanup");
                }
            }
        }

        Ok(())
    }

    /// 获取节点ID
    pub fn get_node_id(&self) -> EndpointId {
        self.endpoint.id()
    }

    /// 获取本机 direct addresses 用于 ticket 生成
    /// 优先返回配置的 bind_addr，如果配置了固定端口则使用它
    /// 如果使用随机端口，则返回空列表（需要依赖 relay 或 discovery）
    pub fn get_direct_addresses(&self) -> Vec<String> {
        let mut addresses = Vec::new();

        // 优先使用配置的 bind_addr
        if let Some(config_addr) = &self.config.bind_addr {
            // 只有当端口不是 0（随机端口）时才包含在 ticket 中
            if config_addr.port() != 0 {
                addresses.push(config_addr.to_string());
                tracing::info!(
                    "Using configured bind_addr as direct address: {}",
                    config_addr
                );
                return addresses;
            } else {
                tracing::info!("Using random port (0), not including in direct addresses");
            }
        }

        // 如果是随机端口，不返回固定地址
        // 依赖 relay 或 discovery 来建立连接
        addresses
    }

    /// 获取 relay URL
    pub fn get_relay_url(&self) -> Option<String> {
        self.config.relay_url.clone()
    }

    /// 检查是否使用了固定端口
    pub fn is_using_fixed_port(&self) -> bool {
        self.config
            .bind_addr
            .map(|addr| addr.port() != 0)
            .unwrap_or(false)
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

    /// 主动清理指定endpoint_id的连接
    pub async fn cleanup_connection_by_node_id(&self, node_id: &EndpointId) -> bool {
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

    /// 打开到远程的 TCP 转发流
    /// session_id 用于标识这个 TCP 流属于哪个转发会话
    /// 每个 TCP 连接都会创建一个新的 QUIC bidi 流
    pub async fn open_tcp_stream(
        &self,
        remote_endpoint_id: &EndpointId,
        session_id: &str,
    ) -> Result<(iroh::endpoint::SendStream, iroh::endpoint::RecvStream)> {
        // 查找或建立到远程的连接
        let connection = {
            let connections = self.connections.read().await;
            connections
                .values()
                .find(|c| c.node_id == *remote_endpoint_id)
                .map(|c| c.connection.clone())
        };

        let connection = match connection {
            Some(conn) => conn,
            None => {
                // 需要建立新连接
                return Err(anyhow::anyhow!(
                    "No active connection to endpoint {:?}. Please ensure message protocol connection is established first.",
                    remote_endpoint_id
                ));
            }
        };

        // 打开 bidi 流
        let (mut send_stream, recv_stream) = connection
            .open_bi()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to open bidi stream: {}", e))?;

        // 发送握手协议：魔数 + session_id长度 + session_id
        send_stream
            .write_all(TCP_STREAM_HANDSHAKE)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write handshake magic: {}", e))?;

        let session_id_bytes = session_id.as_bytes();
        let len_bytes = (session_id_bytes.len() as u32).to_be_bytes();
        send_stream
            .write_all(&len_bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write session_id length: {}", e))?;
        send_stream
            .write_all(session_id_bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write session_id: {}", e))?;

        info!(
            "TCP forwarding stream opened to endpoint {:?} for session {}",
            remote_endpoint_id, session_id
        );

        Ok((send_stream, recv_stream))
    }

    /// 获取与指定 endpoint_id 的连接
    pub async fn get_connection(
        &self,
        endpoint_id: &EndpointId,
    ) -> Option<iroh::endpoint::Connection> {
        let connections = self.connections.read().await;
        connections
            .values()
            .find(|c| c.node_id == *endpoint_id)
            .map(|c| c.connection.clone())
    }

    /// 关闭服务器
    pub async fn shutdown(&self) -> Result<()> {
        info!("Shutting down QUIC message server");

        // 发送关闭信号
        let _ = self.shutdown_tx.send(()).await;

        // 优雅关闭所有连接（通知对端），然后清除
        {
            let mut connections = self.connections.write().await;
            for (conn_id, conn) in connections.drain() {
                info!("Closing connection {} during shutdown", conn_id);
                conn.connection.close(0u32.into(), b"Server shutdown");
            }
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
    #[allow(dead_code)] // 保持接收器存活以防止广播通道关闭
    _message_rx: broadcast::Receiver<Message>,
    message_tx: broadcast::Sender<Message>,
}

/// 重连参数，用于自动恢复连接
#[derive(Clone)]
struct ConnectionParams {
    node_addr: EndpointAddr,
    connection_id: String,
}

/// QUIC消息客户端的线程安全包装器
#[derive(Clone)]
pub struct QuicMessageClientHandle {
    client: Arc<Mutex<QuicMessageClient>>,
    /// 从 client 克隆，用于无锁发送消息
    server_connections: Arc<RwLock<HashMap<String, iroh::endpoint::Connection>>>,
    message_tx: broadcast::Sender<Message>,
    endpoint: Arc<Endpoint>,
    /// 重连参数
    connection_params: Arc<RwLock<Option<ConnectionParams>>>,
    /// 健康监控取消令牌
    health_cancel: CancellationToken,
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

        if let Some(ref relay) = relay_url {
            info!(
                "Custom relay URL provided: {} (using default relay discovery)",
                relay
            );
        }

        let endpoint = Endpoint::builder()
            .secret_key(secret_key)
            .alpns(vec![QUIC_MESSAGE_ALPN.to_vec()])
            .discovery(DnsDiscovery::n0_dns())
            .bind()
            .await?;

        let node_id = endpoint.id();
        info!("QUIC client node ID: {:?}", node_id);

        // 等待 endpoint 完成 relay 注册，确保 NAT 穿透就绪（移动端尤其重要）
        info!("Waiting for client endpoint to come online...");
        endpoint.online().await;
        info!("Client endpoint is online");

        // 创建消息广播通道
        let (message_tx, message_rx) = broadcast::channel(1000);

        Ok(Self {
            endpoint: Arc::new(endpoint),
            communication_manager,
            server_connections: Arc::new(RwLock::new(HashMap::new())),
            _message_rx: message_rx,
            message_tx,
        })
    }

    /// 连接到QUIC消息服务器 - 使用 EndpointId
    pub async fn connect_to_server(&mut self, node_addr: &EndpointId) -> Result<String> {
        self.connect_to_server_with_node_addr(node_addr).await
    }

    /// 连接到QUIC消息服务器 - 使用完整的 EndpointAddr（支持 direct addresses 和 relay）
    pub async fn connect_to_server_with_node_addr(
        &mut self,
        node_addr: &EndpointId,
    ) -> Result<String> {
        // 创建一个只有 node_id 的 EndpointAddr（无 direct addresses）
        use iroh_base::PublicKey;
        let public_key = PublicKey::from(*node_addr);
        let addrs = std::collections::BTreeSet::new();
        let full_node_addr = EndpointAddr::from_parts(public_key, addrs);
        self.connect_to_server_with_full_node_addr(&full_node_addr)
            .await
    }

    /// 连接到QUIC消息服务器 - 使用完整的 EndpointAddr（支持 direct addresses 和 relay）
    /// 这是推荐使用的方法，可以支持直连穿透
    pub async fn connect_to_server_with_full_node_addr(
        &mut self,
        node_addr: &EndpointAddr,
    ) -> Result<String> {
        info!("🔗 Connecting to QUIC message server via EndpointAddr");
        info!("🔗 Node ID: {:?}", node_addr.id);

        // 提取 direct addresses 和 relay URL
        let direct_addrs: Vec<_> = node_addr
            .addrs
            .iter()
            .filter_map(|a| {
                if let TransportAddr::Ip(addr) = a {
                    Some(addr.to_string())
                } else {
                    None
                }
            })
            .collect();
        let relay_url = node_addr
            .addrs
            .iter()
            .filter_map(|a| {
                if let TransportAddr::Relay(url) = a {
                    Some(url.to_string())
                } else {
                    None
                }
            })
            .next();

        info!("🔗 Direct addresses: {:?}", direct_addrs);
        info!("🔗 Relay URL: {:?}", relay_url);

        // 使用 iroh 的 connect 方法建立连接
        let connection = self
            .endpoint
            .connect(node_addr.clone(), QUIC_MESSAGE_ALPN)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to connect to node {:?}: {}", node_addr.id, e))?;

        let server_node_id = connection.remote_id();
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
        let server_connections_clone = self.server_connections.clone();

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
                        info!("Connection {} lost: {}", connection_id_clone, e);
                        // 清理僵死连接
                        {
                            let mut conns = server_connections_clone.write().await;
                            conns.remove(&connection_id_clone);
                        }
                        // 通过 broadcast 通知连接断开
                        let lost_msg = MessageBuilder::heartbeat(
                            "system".to_string(),
                            0,
                            "connection_lost".to_string(),
                        );
                        let _ = message_tx.send(lost_msg);
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
            debug!(
                "send_message_to_server(mut): connection_id={}, message_id={}, message_type={:?}, requires_response={}, wire_len={}",
                connection_id,
                message.id,
                message.message_type,
                message.requires_response,
                data.len()
            );
            send_stream.write_all(&data).await?;
            send_stream.finish()?;

            // 如果消息需要响应，等待读取响应（带超时）
            if message.requires_response {
                debug!("Waiting for response to message: {}", message.id);
                let mut response_data = Vec::new();
                let _ = tokio::time::timeout(std::time::Duration::from_secs(30), async {
                    loop {
                        let mut buffer = vec![0u8; 8192];
                        match recv_stream.read(&mut buffer).await {
                            Ok(Some(n)) => {
                                response_data.extend_from_slice(&buffer[..n]);
                            }
                            Ok(None) => break,
                            Err(e) => {
                                error!("Error reading response: {}", e);
                                break;
                            }
                        }
                    }
                })
                .await;

                if !response_data.is_empty() {
                    match MessageSerializer::deserialize_from_network(&response_data) {
                        Ok(response) => {
                            debug!(
                                "Received response: type={:?}, broadcasting to {} subscribers",
                                response.message_type,
                                self.message_tx.receiver_count()
                            );
                            // 广播接收到的响应
                            if let Err(e) = self.message_tx.send(response) {
                                error!("Failed to broadcast response: {} (no receivers?)", e);
                            }
                        }
                        Err(e) => {
                            error!("Failed to deserialize response: {}", e);
                        }
                    }
                } else {
                    debug!("Response stream closed by server");
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
    pub fn get_node_id(&self) -> EndpointId {
        self.endpoint.id()
    }

    /// 获取消息接收器
    pub fn get_message_receiver(&self) -> broadcast::Receiver<Message> {
        self.message_tx.subscribe()
    }

    /// 打开到远程服务器的 TCP 转发流
    /// session_id 用于标识这个 TCP 流属于哪个转发会话
    pub async fn open_tcp_stream(
        &self,
        remote_endpoint_id: &EndpointId,
        session_id: &str,
    ) -> Result<(iroh::endpoint::SendStream, iroh::endpoint::RecvStream)> {
        // 查找已建立的连接
        let connections = self.server_connections.read().await;
        let connection = connections
            .values()
            .find(|c| c.remote_id() == *remote_endpoint_id)
            .cloned();

        drop(connections); // 释放锁

        let connection = connection.ok_or_else(|| {
            anyhow::anyhow!(
                "No active connection to endpoint {:?}. Please connect via message protocol first.",
                remote_endpoint_id
            )
        })?;

        // 打开 bidi 流
        let (mut send_stream, recv_stream) = connection
            .open_bi()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to open bidi stream: {}", e))?;

        // 发送握手协议：魔数 + session_id长度 + session_id
        send_stream
            .write_all(TCP_STREAM_HANDSHAKE)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write handshake magic: {}", e))?;

        let session_id_bytes = session_id.as_bytes();
        let len_bytes = (session_id_bytes.len() as u32).to_be_bytes();
        send_stream
            .write_all(&len_bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write session_id length: {}", e))?;
        send_stream
            .write_all(session_id_bytes)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to write session_id: {}", e))?;

        info!(
            "TCP forwarding stream opened from client to endpoint {:?} for session {}",
            remote_endpoint_id, session_id
        );

        Ok((send_stream, recv_stream))
    }

    /// 处理传入的数据流
    async fn handle_incoming_stream(
        mut recv_stream: iroh::endpoint::RecvStream,
        message_tx: broadcast::Sender<Message>,
        connection_id: String,
    ) -> Result<()> {
        debug!("Handling incoming stream for connection: {}", connection_id);

        // 读取所有数据（有界 + 超时）
        const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024; // 16 MiB
        let read_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            recv_stream.read_to_end(MAX_MESSAGE_SIZE),
        )
        .await;

        match read_result {
            Ok(Ok(data)) => {
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
                        let preview = data
                            .iter()
                            .take(24)
                            .map(|b| format!("{:02x}", b))
                            .collect::<Vec<_>>()
                            .join(" ");
                        // First byte should be message_type tag
                        let msg_type_tag = data.first().map(|b| format!("{:02x}", b)).unwrap_or_else(|| "empty".to_string());
                        error!(
                            "Failed to deserialize message for connection {}: data_len={}, msg_type_tag={}, data_hex=[{}], error={}",
                            connection_id,
                            data.len(),
                            msg_type_tag,
                            preview,
                            e
                        );
                        return Err(e);
                    }
                }
            }
            Ok(Err(e)) => {
                error!(
                    "Failed to read data for connection {}: {}",
                    connection_id, e
                );
                return Err(e.into());
            }
            Err(_) => {
                error!(
                    "Timeout reading incoming stream for connection: {}",
                    connection_id
                );
                return Err(anyhow::anyhow!("Stream read timeout"));
            }
        }

        Ok(())
    }
}

impl QuicMessageClientHandle {
    async fn send_message_internal(
        &self,
        connection_id: &str,
        message: Message,
        broadcast_response: bool,
    ) -> Result<Option<Message>> {
        let connection = {
            let conns = self.server_connections.read().await;
            conns
                .get(connection_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Connection not found: {}", connection_id))?
        };

        let (mut send_stream, mut recv_stream) = connection.open_bi().await?;
        let data = MessageSerializer::serialize_for_network(&message)?;
        debug!(
            "send_message_to_server(handle): connection_id={}, message_id={}, message_type={:?}, requires_response={}, wire_len={}",
            connection_id,
            message.id,
            message.message_type,
            message.requires_response,
            data.len()
        );
        send_stream.write_all(&data).await?;
        send_stream.finish()?;

        if !message.requires_response {
            return Ok(None);
        }

        let mut response_data = Vec::new();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(30), async {
            loop {
                let mut buffer = vec![0u8; 8192];
                match recv_stream.read(&mut buffer).await {
                    Ok(Some(n)) => response_data.extend_from_slice(&buffer[..n]),
                    Ok(None) => break,
                    Err(e) => {
                        error!(
                            "send_message_to_server(handle) read response error: connection_id={}, message_id={}, error={}",
                            connection_id,
                            message.id,
                            e
                        );
                        break;
                    }
                }
            }
        })
        .await;

        if response_data.is_empty() {
            warn!(
                "send_message_to_server(handle) response stream closed without data: connection_id={}, message_id={}, message_type={:?}",
                connection_id, message.id, message.message_type
            );
            return Ok(None);
        }

        match MessageSerializer::deserialize_from_network(&response_data) {
            Ok(response) => {
                if let MessagePayload::Response(resp) = &response.payload {
                    info!(
                        "send_message_to_server(handle) received response: connection_id={}, request_id={}, success={}",
                        connection_id, resp.request_id, resp.success
                    );
                } else {
                    info!(
                        "send_message_to_server(handle) received non-response payload: connection_id={}, message_type={:?}",
                        connection_id, response.message_type
                    );
                }

                if broadcast_response {
                    let _ = self.message_tx.send(response.clone());
                }

                Ok(Some(response))
            }
            Err(e) => {
                let preview = response_data
                    .iter()
                    .take(24)
                    .map(|b| format!("{:02x}", b))
                    .collect::<Vec<_>>()
                    .join(" ");
                error!(
                    "send_message_to_server(handle) failed to deserialize direct response: connection_id={}, message_id={}, data_len={}, data_hex=[{}], error={}",
                    connection_id,
                    message.id,
                    response_data.len(),
                    preview,
                    e
                );
                Err(e)
            }
        }
    }

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
        let server_connections = client.server_connections.clone();
        let message_tx = client.message_tx.clone();
        let endpoint = client.endpoint.clone();
        Ok(Self {
            client: Arc::new(Mutex::new(client)),
            server_connections,
            message_tx,
            endpoint,
            connection_params: Arc::new(RwLock::new(None)),
            health_cancel: CancellationToken::new(),
        })
    }

    /// 获取节点ID
    pub async fn get_node_id(&self) -> EndpointId {
        let client = self.client.lock().await;
        client.get_node_id()
    }

    /// 连接到QUIC消息服务器 - 使用 EndpointId
    pub async fn connect_to_server(&self, node_addr: &EndpointId) -> Result<String> {
        let mut client = self.client.lock().await;
        client.connect_to_server(node_addr).await
    }

    /// 使用完整的 EndpointAddr 连接到服务器（支持 direct addresses 和 relay）
    /// 这是推荐使用的方法，可以支持直连穿透
    pub async fn connect_to_server_with_node_addr(
        &self,
        node_addr: &EndpointAddr,
    ) -> Result<String> {
        let connection_id = {
            let mut client = self.client.lock().await;
            client
                .connect_to_server_with_full_node_addr(node_addr)
                .await?
        };
        // 保存重连参数
        {
            let mut params = self.connection_params.write().await;
            *params = Some(ConnectionParams {
                node_addr: node_addr.clone(),
                connection_id: connection_id.clone(),
            });
        }
        // 启动健康监控
        self.start_health_monitor();
        Ok(connection_id)
    }

    /// 使用 EndpointId 连接到服务器（别名，保持向后兼容）
    #[deprecated(since = "0.9.0", note = "使用 connect_to_server_with_node_addr 代替")]
    pub async fn connect_to_server_with_endpoint_id(
        &self,
        node_addr: &EndpointId,
    ) -> Result<String> {
        self.connect_to_server(node_addr).await
    }

    /// 断开与服务器的连接
    pub async fn disconnect_from_server(&self, connection_id: &str) -> Result<()> {
        // 停止健康监控
        self.health_cancel.cancel();
        let mut client = self.client.lock().await;
        client.disconnect_from_server(connection_id).await
    }

    /// 发送消息到服务器（无锁发送，不阻塞其他操作）
    pub async fn send_message_to_server(
        &self,
        connection_id: &str,
        message: Message,
    ) -> Result<()> {
        let _ = self
            .send_message_internal(connection_id, message, true)
            .await?;
        Ok(())
    }

    pub async fn send_message_to_server_with_response(
        &self,
        connection_id: &str,
        message: Message,
    ) -> Result<Option<Message>> {
        self.send_message_internal(connection_id, message, false)
            .await
    }

    /// 获取消息接收器
    pub fn get_message_receiver(&self) -> broadcast::Receiver<Message> {
        self.message_tx.subscribe()
    }

    /// 打开到远程服务器的 TCP 转发流（用于 App 端的 connect-tcp 模式）
    pub async fn open_tcp_stream(
        &self,
        remote_endpoint_id: &EndpointId,
        session_id: &str,
    ) -> Result<(iroh::endpoint::SendStream, iroh::endpoint::RecvStream)> {
        let client = self.client.lock().await;
        client.open_tcp_stream(remote_endpoint_id, session_id).await
    }

    /// 启动连接健康监控：定期心跳探测，检测断连后自动重连
    fn start_health_monitor(&self) {
        // 取消旧的监控
        self.health_cancel.cancel();

        let server_connections = self.server_connections.clone();
        let connection_params = self.connection_params.clone();
        let endpoint = self.endpoint.clone();
        let message_tx = self.message_tx.clone();
        // 为新的监控创建 child token
        let health_cancel = self.health_cancel.child_token();

        tokio::spawn(async move {
            let mut heartbeat_seq: u64 = 0;
            let mut consecutive_failures: u32 = 0;
            let heartbeat_interval = std::time::Duration::from_secs(15);
            let heartbeat_timeout = std::time::Duration::from_secs(10);

            loop {
                tokio::select! {
                    _ = health_cancel.cancelled() => {
                        info!("Health monitor cancelled");
                        break;
                    }
                    _ = tokio::time::sleep(heartbeat_interval) => {
                        let params = connection_params.read().await.clone();
                        let Some(params) = params else { continue; };

                        // 获取当前连接
                        let connection = {
                            let conns = server_connections.read().await;
                            conns.get(&params.connection_id).cloned()
                        };

                        match connection {
                            Some(conn) => {
                                // 发送心跳探测
                                let mut heartbeat = MessageBuilder::heartbeat(
                                    "health_monitor".to_string(),
                                    heartbeat_seq,
                                    "ping".to_string(),
                                );
                                heartbeat.requires_response = true;
                                info!(
                                    "health probe send: connection_id={}, seq={}, message_id={}, wire_sender={}",
                                    params.connection_id,
                                    heartbeat_seq,
                                    heartbeat.id,
                                    heartbeat.sender_id
                                );

                                match Self::send_heartbeat_probe(&conn, &heartbeat, heartbeat_timeout).await {
                                    Ok(_) => {
                                        heartbeat_seq += 1;
                                        if consecutive_failures > 0 {
                                            info!("Heartbeat recovered after {} failures", consecutive_failures);
                                        }
                                        consecutive_failures = 0;
                                    }
                                    Err(e) => {
                                        consecutive_failures += 1;
                                        warn!("Heartbeat {} failed (attempt {}): {}",
                                            heartbeat_seq, consecutive_failures, e);

                                        if consecutive_failures >= 2 {
                                            info!("Connection dead after {} failures, reconnecting",
                                                consecutive_failures);
                                            // 清理僵死连接
                                            {
                                                let mut conns = server_connections.write().await;
                                                conns.remove(&params.connection_id);
                                            }
                                            let lost = MessageBuilder::heartbeat(
                                                "system".to_string(), 0,
                                                "connection_lost".to_string(),
                                            );
                                            let _ = message_tx.send(lost);

                                            // 尝试重连
                                            Self::attempt_reconnect(
                                                &endpoint, &server_connections,
                                                &connection_params, &message_tx,
                                                &mut consecutive_failures,
                                            ).await;
                                        }
                                    }
                                }
                            }
                            None => {
                                // 连接不在 map 中，尝试重连
                                consecutive_failures += 1;
                                info!("Connection missing, attempting reconnect (attempt {})", consecutive_failures);
                                Self::attempt_reconnect(
                                    &endpoint, &server_connections,
                                    &connection_params, &message_tx,
                                    &mut consecutive_failures,
                                ).await;
                            }
                        }
                    }
                }
            }
        });
    }

    /// 发送心跳探测并等待响应
    async fn send_heartbeat_probe(
        connection: &iroh::endpoint::Connection,
        heartbeat: &Message,
        timeout: std::time::Duration,
    ) -> Result<()> {
        tokio::time::timeout(timeout, async {
            let (mut send, mut recv) = connection.open_bi().await?;
            let data = MessageSerializer::serialize_for_network(heartbeat)?;
            send.write_all(&data).await?;
            send.finish()?;
            let _ = recv.read_to_end(64 * 1024).await?;
            Ok::<(), anyhow::Error>(())
        })
        .await
        .map_err(|_| anyhow::anyhow!("Heartbeat timeout"))??;
        Ok(())
    }

    /// 指数退避自动重连
    async fn attempt_reconnect(
        endpoint: &Arc<Endpoint>,
        server_connections: &Arc<RwLock<HashMap<String, iroh::endpoint::Connection>>>,
        connection_params: &Arc<RwLock<Option<ConnectionParams>>>,
        message_tx: &broadcast::Sender<Message>,
        consecutive_failures: &mut u32,
    ) {
        let params = connection_params.read().await.clone();
        let Some(params) = params else {
            return;
        };

        // 指数退避: 2s, 4s, 8s, 16s, 30s (cap)
        let delay_secs = (2u64 << (*consecutive_failures).min(4)).min(30);
        let delay = std::time::Duration::from_secs(delay_secs);
        info!("Reconnecting in {:?}...", delay);

        // 广播 reconnecting 状态
        let reconnecting =
            MessageBuilder::heartbeat("system".to_string(), 0, "reconnecting".to_string());
        let _ = message_tx.send(reconnecting);

        tokio::time::sleep(delay).await;

        // 尝试连接，带 30 秒超时
        let connect_result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            endpoint.connect(params.node_addr.clone(), QUIC_MESSAGE_ALPN),
        )
        .await;

        match connect_result {
            Ok(Ok(new_connection)) => {
                info!("Reconnected successfully");
                *consecutive_failures = 0;

                // 用相同 connection_id 存储新连接
                {
                    let mut conns = server_connections.write().await;
                    conns.insert(params.connection_id.clone(), new_connection.clone());
                }

                // 广播 connected 状态
                let connected =
                    MessageBuilder::heartbeat("system".to_string(), 0, "connected".to_string());
                let _ = message_tx.send(connected);

                // 为新连接启动 receiver task
                let tx = message_tx.clone();
                let cid = params.connection_id.clone();
                let conns = server_connections.clone();
                tokio::spawn(async move {
                    loop {
                        match new_connection.accept_bi().await {
                            Ok((_send, recv)) => {
                                let tx = tx.clone();
                                let cid = cid.clone();
                                tokio::spawn(async move {
                                    if let Err(e) =
                                        QuicMessageClient::handle_incoming_stream(recv, tx, cid)
                                            .await
                                    {
                                        error!("Stream error after reconnect: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                info!("Reconnected connection lost: {}", e);
                                let mut c = conns.write().await;
                                c.remove(&cid);
                                let lost = MessageBuilder::heartbeat(
                                    "system".to_string(),
                                    0,
                                    "connection_lost".to_string(),
                                );
                                let _ = tx.send(lost);
                                break;
                            }
                        }
                    }
                });
            }
            Ok(Err(e)) => {
                warn!("Reconnect failed: {}", e);
                *consecutive_failures += 1;
            }
            Err(_) => {
                warn!("Reconnect timed out");
                *consecutive_failures += 1;
            }
        }
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
            MessagePayload::SystemControl(msg) => {
                info!("[{}] System control action: {:?}", self.name, msg.action);
                // 这里应该调用实际的系统控制逻辑
            }
            MessagePayload::TcpForwarding(msg) => {
                info!("[{}] TCP forwarding action: {:?}", self.name, msg.action);
                // 这里应该调用实际的TCP转发逻辑
            }
            _ => {}
        }

        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![
            MessageType::Heartbeat,
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
