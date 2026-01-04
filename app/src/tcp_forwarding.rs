use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;
use tracing::{error, info};


/// TCP 转发会话信息
#[derive(Debug, Clone)]
pub struct TcpForwardingSession {
    pub id: String,
    pub local_addr: String,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String,
}

/// TCP 连接管理器
pub struct TcpForwardingManager {
    sessions: Arc<RwLock<HashMap<String, TcpForwardingSession>>>,
    connections: Arc<RwLock<HashMap<String, TcpStream>>>,
    message_sender: Option<Box<dyn Fn(String, Vec<u8>) + Send + Sync>>,
}

impl Default for TcpForwardingManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            connections: Arc::new(RwLock::new(HashMap::new())),
            message_sender: None,
        }
    }
}

impl TcpForwardingManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置消息发送器
    pub fn set_message_sender<F>(&mut self, sender: F)
    where
        F: Fn(String, Vec<u8>) + Send + Sync + 'static,
    {
        self.message_sender = Some(Box::new(sender));
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
        let _shutdown_tx = self.start_listener(
            session_id.clone(),
            local_addr_parsed,
            remote_host.clone(),
            remote_port,
        ).await?;

        // 更新会话状态
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(&session_id) {
                session.status = "running".to_string();
            }
        }

        info!("TCP forwarding session created: {} ({} -> {}:{})",
              session_id, local_addr, remote_host, remote_port);

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
        let (shutdown_tx, mut shutdown_rx) = mpsc::unbounded_channel();
        let session_id_clone = session_id.clone();

        tokio::spawn(async move {
            let listener = match TcpListener::bind(local_addr).await {
                Ok(l) => l,
                Err(e) => {
                    error!("Failed to bind to {}: {}", local_addr, e);
                    return;
                }
            };

            info!("TCP listener started on {} for session {}", local_addr, session_id_clone);

            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, addr)) => {
                                info!("New TCP connection from {} for session {}", addr, session_id_clone);

                                let session_id_for_task = session_id_clone.clone();
                                let remote_host_for_task = remote_host.clone();

                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(
                                        stream,
                                        session_id_for_task,
                                        remote_host_for_task,
                                        remote_port,
                                    ).await {
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
                        info!("TCP listener shutting down for session {}", session_id_clone);
                        break;
                    }
                }
            }
        });

        Ok(shutdown_tx)
    }

    /// 停止会话
    pub async fn stop_session(&self, session_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
}

/// 处理单个 TCP 连接
async fn handle_connection(
    mut stream: TcpStream,
    _session_id: String,
    remote_host: String,
    remote_port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let connection_id = Uuid::new_v4().to_string();

    // 这里我们需要一个全局的消息发送器，暂时先记录日志
    info!("Would send CONNECT {}:{} for connection {}", remote_host, remote_port, connection_id);

    // 读取从本地客户端的数据
    let mut buffer = vec![0u8; 8192];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) => {
                info!("Client disconnected for connection {}", connection_id);
                break;
            }
            Ok(n) => {
                // 将数据发送到远程
                let _data = buffer[..n].to_vec();
                info!("Would send {} bytes for connection {}", n, connection_id);
                // TODO: 实际发送数据
            }
            Err(e) => {
                error!("Error reading from client: {}", e);
                break;
            }
        }
    }

    // 发送连接关闭消息
    info!("Would send CLOSE for connection {}", connection_id);

    Ok(())
}