//! TCP 转发管理模块
//!
//! 此模块实现了从本地 TCP 客户端到远程 CLI 的 TCP 数据转发。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{RwLock, broadcast, mpsc};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use shared::{TcpDataType, quic_server::QuicMessageClientHandle};
use std::sync::Arc as StdArc;

/// TCP 转发会话信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpForwardingSession {
    #[allow(dead_code)]
    pub id: String,
    pub local_addr: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String,
}

/// TCP 连接信息
#[derive(Debug, Clone)]
pub struct TcpConnectionInfo {
    #[allow(dead_code)]
    pub connection_id: String,
    pub stream: Option<Arc<RwLock<TcpStream>>>, // Option for dumbpipe mode where stream is not stored
    #[allow(dead_code)]
    pub session_id: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    #[allow(dead_code)]
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
    /// Quic client for opening direct P2P streams (dumbpipe-style)
    quic_client: Option<StdArc<QuicMessageClientHandle>>,
    /// CLI endpoint ID for opening P2P streams
    cli_endpoint_id: Arc<RwLock<Option<String>>>,
    /// Shutdown senders for each session's TCP listener
    shutdown_senders: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<()>>>>,
}

impl Default for TcpForwardingManager {
    fn default() -> Self {
        let (message_tx, _) = broadcast::channel(1000);
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            tcp_connections: Arc::new(RwLock::new(HashMap::new())),
            message_tx,
            quic_client: None,
            cli_endpoint_id: Arc::new(RwLock::new(None)),
            shutdown_senders: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl TcpForwardingManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置 Quic 客户端（用于直接 P2P 流转发）
    pub fn set_quic_client(&mut self, quic_client: QuicMessageClientHandle) {
        self.quic_client = Some(StdArc::new(quic_client));
    }

    /// 设置 CLI endpoint ID（用于打开 P2P 流）
    pub async fn set_cli_endpoint_id(&self, endpoint_id: String) {
        let mut id = self.cli_endpoint_id.write().await;
        *id = Some(endpoint_id);
    }

    /// 获取消息发送通道的发送端
    #[allow(dead_code)]
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
    /// 注意：此方法用于旧的消息协议方式，dumbpipe 模式不再使用此方法
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
                    // 处理 Option<Arc<RwLock<TcpStream>>>
                    if let Some(stream_ref) = &conn_info.stream {
                        let mut stream = stream_ref.write().await;
                        stream.write_all(data).await?;
                        stream.flush().await?;

                        debug!(
                            "Successfully wrote {} bytes to local TCP stream",
                            data.len()
                        );
                    } else {
                        // dumbpipe 模式下 stream 为 None，数据转发在 handle_connection 中处理
                        debug!(
                            "Connection {} is using dumbpipe mode, data handled separately",
                            connection_id
                        );
                    }
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
                warn!(
                    "Received unexpected ConnectionOpen from CLI for connection {}",
                    connection_id
                );
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

    /// 创建 TCP 转发会话（但不启动监听器）
    pub async fn create_session_pending(
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
            status: "pending".to_string(), // 等待 CLI 响应
        };

        // 保存会话
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
        }

        info!(
            "TCP forwarding session created (pending): {} ({} -> {}:{})",
            session_id, local_addr, remote_host, remote_port
        );

        Ok(session_id)
    }

    /// 启动会话监听器（在收到 CLI 响应后调用）
    pub async fn start_session_listener(
        &self,
        session_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // 获取会话信息
        let (local_addr, remote_host, remote_port) = {
            let sessions = self.sessions.read().await;
            let session = sessions
                .get(session_id)
                .ok_or_else(|| format!("Session not found: {}", session_id))?;
            (
                session.local_addr.clone(),
                session.remote_host.clone(),
                session.remote_port,
            )
        };

        // 启动本地监听器
        let local_addr_parsed: SocketAddr = local_addr.parse()?;
        let remote_host_for_listener = remote_host.clone();
        let shutdown_tx = self
            .start_listener(
                session_id.to_string(),
                local_addr_parsed,
                remote_host_for_listener,
                remote_port,
            )
            .await?;

        // 保存 shutdown_tx 以防止 listener 被立即关闭
        {
            let mut shutdown_senders = self.shutdown_senders.write().await;
            shutdown_senders.insert(session_id.to_string(), shutdown_tx);
        }

        // 更新会话状态
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(session_id) {
                session.status = "running".to_string();
            }
        }

        info!(
            "TCP forwarding listener started for session: {}",
            session_id
        );

        Ok(())
    }

    /// 创建 TCP 转发会话（旧的同步方式，保留用于兼容）
    #[allow(dead_code)]
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
            .start_listener(
                session_id.clone(),
                local_addr_parsed,
                remote_host_for_listener,
                remote_port,
            )
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
        _remote_host: String,
        _remote_port: u16,
    ) -> Result<mpsc::UnboundedSender<()>, Box<dyn std::error::Error + Send + Sync>> {
        use tokio::sync::mpsc;

        let (shutdown_tx, mut shutdown_rx) = mpsc::unbounded_channel();
        let session_id_clone = session_id.clone();

        // 获取共享资源的克隆
        let tcp_connections_clone = self.tcp_connections.clone();
        let message_tx_clone = self.message_tx.clone();
        let quic_client_clone = self.quic_client.clone();
        let cli_endpoint_id_clone = self.cli_endpoint_id.clone();

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
                                let quic_client_for_task = quic_client_clone.clone();
                                let cli_endpoint_id_for_task = cli_endpoint_id_clone.clone();

                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(
                                        stream,
                                        session_id_for_task,
                                        tcp_connections_for_task,
                                        message_tx_for_task,
                                        quic_client_for_task,
                                        cli_endpoint_id_for_task,
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
    #[allow(dead_code)]
    pub async fn stop_session(
        &self,
        session_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // 发送 shutdown 信号给 listener
        {
            let mut shutdown_senders = self.shutdown_senders.write().await;
            if let Some(shutdown_tx) = shutdown_senders.remove(session_id) {
                let _ = shutdown_tx.send(());
                info!(
                    "Shutdown signal sent to TCP listener for session: {}",
                    session_id
                );
            }
        }

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
    #[allow(dead_code)]
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
        let shutdown_tx = self
            .start_listener(
                session_id.clone(),
                local_addr_parsed,
                remote_host_for_listener,
                remote_port,
            )
            .await?;

        // 保存 shutdown_tx 以防止 listener 被立即关闭
        {
            let mut shutdown_senders = self.shutdown_senders.write().await;
            shutdown_senders.insert(session_id.clone(), shutdown_tx);
        }

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

/// 处理单个 TCP 连接（dumbpipe 风格：直接 P2P 流转发）
async fn handle_connection(
    stream: TcpStream,
    session_id: String,
    tcp_connections: Arc<RwLock<HashMap<String, TcpConnectionInfo>>>,
    _message_tx: broadcast::Sender<TcpMessageRequest>, // 保留用于兼容性，但不再使用
    quic_client: Option<StdArc<QuicMessageClientHandle>>,
    cli_endpoint_id: Arc<RwLock<Option<String>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let connection_id = Uuid::new_v4().to_string();
    let peer_addr = stream.peer_addr().ok();

    info!(
        "New TCP connection from {:?} (connection_id: {})",
        peer_addr, connection_id
    );

    // 获取 quic client
    let quic_client = quic_client.ok_or("Quic client not available")?;

    // 获取远程 CLI endpoint_id
    let remote_endpoint_id = {
        let id_guard = cli_endpoint_id.read().await;
        id_guard.as_ref().ok_or("CLI endpoint ID not set")?.clone()
    };

    // 解析 endpoint_id
    use std::str::FromStr;
    let endpoint_id = iroh::EndpointId::from_str(&remote_endpoint_id)
        .map_err(|e| format!("Invalid endpoint ID: {}", e))?;

    // 打开 P2P TCP 流到 CLI，包含 session_id 用于 CLI 查找目标地址
    let (mut p2p_send, mut p2p_recv) = quic_client
        .open_tcp_stream(&endpoint_id, &session_id)
        .await
        .map_err(|e| format!("Failed to open P2P TCP stream: {}", e))?;

    info!(
        "Opened P2P TCP stream for connection {} in session {}",
        connection_id, session_id
    );

    // 分离本地 TCP 流
    let (mut tcp_read, mut tcp_write) = stream.into_split();

    // 初始化连接统计（不存储实际的 stream，因为 OwnedWriteHalf 无法被克隆）
    // 注意：对于 dumbpipe 模式，stream 为 None，只用于统计信息
    {
        let mut connections = tcp_connections.write().await;
        connections.insert(
            connection_id.clone(),
            TcpConnectionInfo {
                connection_id: connection_id.clone(),
                stream: None, // dumbpipe mode doesn't store the stream
                session_id: session_id.clone(),
                bytes_sent: 0,
                bytes_received: 0,
                created_at: std::time::SystemTime::now(),
            },
        );
    }

    // 双向转发
    let tcp_to_p2p = async {
        let mut buffer = vec![0u8; 8192];
        loop {
            match tcp_read.read(&mut buffer).await {
                Ok(0) => {
                    info!("TCP connection closed for connection {}", connection_id);
                    break;
                }
                Ok(n) => {
                    if p2p_send.write_all(&buffer[..n]).await.is_err() {
                        error!(
                            "Failed to write to P2P stream for connection {}",
                            connection_id
                        );
                        break;
                    }
                    // 更新统计
                    let mut conns = tcp_connections.write().await;
                    if let Some(conn) = conns.get_mut(&connection_id) {
                        conn.bytes_sent += n as u64;
                    }
                }
                Err(e) => {
                    error!("Error reading from TCP: {}", e);
                    break;
                }
            }
        }
    };

    let p2p_to_tcp = async {
        let mut buffer = vec![0u8; 8192];
        loop {
            match p2p_recv.read(&mut buffer).await {
                Ok(Some(n)) => {
                    if tcp_write.write_all(&buffer[..n]).await.is_err() {
                        error!("Failed to write to TCP for connection {}", connection_id);
                        break;
                    }
                    // 更新统计
                    let mut conns = tcp_connections.write().await;
                    if let Some(conn) = conns.get_mut(&connection_id) {
                        conn.bytes_received += n as u64;
                    }
                }
                Ok(None) => {
                    info!("P2P stream closed for connection {}", connection_id);
                    break;
                }
                Err(e) => {
                    error!("Error reading from P2P stream: {}", e);
                    break;
                }
            }
        }
    };

    // 运行双向转发，任一方向结束则停止
    tokio::select! {
        _ = tcp_to_p2p => {},
        _ = p2p_to_tcp => {},
    }

    // 清理连接
    {
        let mut connections = tcp_connections.write().await;
        connections.remove(&connection_id);
    }

    info!(
        "TCP connection handler ended for connection {}",
        connection_id
    );
    Ok(())
}
