//! CLI 端消息服务器实现
//!
//! 此模块实现了作为 host 端的消息事件处理能力，
//! 包括终端管理、TCP 转发和系统控制功能。

use anyhow::Result;
use portable_pty::{CommandBuilder, MasterPty, PtySize};
use riterm_shared::{
    AvailableTools, CommunicationManager, IODataType, Message, MessageHandler, MessagePayload,
    MessageType, OSInfo, PackageManager, QuicMessageServer, QuicMessageServerConfig,
    ResponseMessage, ShellInfo, SystemAction, SystemInfo, SystemInfoAction, TcpForwardingAction,
    TcpForwardingType, TerminalAction, Tool, UserInfo,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener as TokioTcpListener, TcpStream as TokioTcpStream};
use tokio::process::Command;
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::shell::ShellDetector;

/// Connection information for status display
#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    pub id: String,
    pub node_id: iroh::PublicKey,
    pub established_at: std::time::SystemTime,
    pub last_activity: std::time::SystemTime,
}

/// 终端会话信息（序列化版本，不包含 PTY 对象）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSession {
    pub id: String,
    pub name: Option<String>,
    pub shell_type: String,
    pub current_dir: String,
    pub size: (u16, u16),
    pub running: bool,
    pub created_at: std::time::SystemTime,
}

/// 内部终端会话信息（包含 PTY 对象）
pub struct InternalTerminalSession {
    pub session: TerminalSession,
    pub master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
    pub writer: Option<Arc<Mutex<Box<dyn std::io::Write + Send>>>>,
    pub input_tx: Option<mpsc::UnboundedSender<Vec<u8>>>, // 输入通道
    pub output_tx: Option<mpsc::UnboundedSender<String>>,
    pub output_broadcast: Option<tokio::sync::broadcast::Sender<Vec<u8>>>, // 输出广播
}

impl Default for TerminalSession {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: None,
            shell_type: "bash".to_string(),
            current_dir: std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            size: (24, 80),
            running: false,
            created_at: std::time::SystemTime::now(),
        }
    }
}

impl InternalTerminalSession {
    fn new(
        master: Option<Box<dyn MasterPty + Send>>,
        input_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
        output_tx: Option<mpsc::UnboundedSender<String>>,
        output_broadcast: Option<tokio::sync::broadcast::Sender<Vec<u8>>>,
    ) -> Self {
        // 从 master 中分离 writer
        let (master_arc, writer_arc) = if let Some(m) = master {
            // 取出 writer（只能取一次）
            let writer = m.take_writer().ok();
            (
                Some(Arc::new(Mutex::new(m))),
                writer.map(|w| Arc::new(Mutex::new(w))),
            )
        } else {
            (None, None)
        };

        Self {
            session: TerminalSession::default(),
            master: master_arc,
            writer: writer_arc,
            input_tx,
            output_tx,
            output_broadcast,
        }
    }
}

/// TCP 转发会话信息（序列化版本）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpForwardingSession {
    pub id: String,
    pub client_node_id: String, // 创建此会话的客户端节点ID
    pub local_addr: String,
    pub remote_target: String,
    pub forwarding_type: String, // "local-to-remote" or "remote-to-local"
    pub active_connections: u32,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub status: String, // "running", "stopped", "error"
    pub created_at: std::time::SystemTime,
}

/// 内部 TCP 转发会话信息（包含运行时对象）
pub struct InternalTcpForwardingSession {
    pub session: TcpForwardingSession,
    pub connections: Arc<RwLock<HashMap<String, TcpConnection>>>,
    pub shutdown_tx: Option<mpsc::UnboundedSender<()>>,
}

/// TCP 连接信息
pub struct TcpConnection {
    pub stream: Option<TokioTcpStream>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub created_at: std::time::SystemTime,
}

impl Default for TcpConnection {
    fn default() -> Self {
        Self {
            stream: None,
            bytes_sent: 0,
            bytes_received: 0,
            created_at: std::time::SystemTime::now(),
        }
    }
}

impl Default for TcpForwardingSession {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            client_node_id: "".to_string(), // 将在创建时设置
            local_addr: "127.0.0.1:0".to_string(),
            remote_target: "127.0.0.1:0".to_string(),
            forwarding_type: "local-to-remote".to_string(),
            active_connections: 0,
            bytes_sent: 0,
            bytes_received: 0,
            status: "stopped".to_string(),
            created_at: std::time::SystemTime::now(),
        }
    }
}

impl InternalTcpForwardingSession {
    fn new(session: TcpForwardingSession) -> Self {
        Self {
            session,
            connections: Arc::new(RwLock::new(HashMap::new())),
            shutdown_tx: None,
        }
    }
}

impl Default for InternalTcpForwardingSession {
    fn default() -> Self {
        Self::new(TcpForwardingSession::default())
    }
}

/// 系统状态信息
#[derive(Debug, Clone)]
pub struct SystemStatus {
    pub status: String,
    pub uptime: u64,
    pub active_terminals: u32,
    pub active_tcp_sessions: u32,
    pub memory_usage: u64,
}

/// CLI 消息服务器
pub struct CliMessageServer {
    /// QUIC 消息服务器
    quic_server: QuicMessageServer,
    /// 通信管理器
    communication_manager: Arc<CommunicationManager>,
    /// 活跃终端会话（内部版本，包含 PTY）
    terminal_sessions: Arc<RwLock<HashMap<String, InternalTerminalSession>>>,
    /// TCP 转发会话（内部版本，包含运行时对象）
    tcp_sessions: Arc<RwLock<HashMap<String, InternalTcpForwardingSession>>>,
    /// 系统状态
    system_status: Arc<RwLock<SystemStatus>>,
    /// 默认终端路径
    default_shell_path: String,
}

impl CliMessageServer {
    /// 创建新的 CLI 消息服务器
    pub async fn new(config: QuicMessageServerConfig) -> Result<Self> {
        info!("Initializing CLI message server...");

        // 获取默认终端路径
        let shell_config = ShellDetector::get_shell_config();
        let default_shell_path = shell_config.shell_path.clone();

        #[cfg(debug_assertions)]
        info!(
            "🐚 Detected shell: {} at {}",
            shell_config.shell_type, default_shell_path
        );

        // 创建通信管理器
        let communication_manager =
            Arc::new(CommunicationManager::new("riterm_cli_host".to_string()));
        communication_manager.initialize().await?;

        // 创建 QUIC 服务器
        let quic_server = QuicMessageServer::new(config, communication_manager.clone()).await?;

        // 创建服务器实例
        let server = Self {
            quic_server,
            communication_manager,
            terminal_sessions: Arc::new(RwLock::new(HashMap::new())),
            tcp_sessions: Arc::new(RwLock::new(HashMap::new())),
            system_status: Arc::new(RwLock::new(SystemStatus {
                status: "running".to_string(),
                uptime: 0,
                active_terminals: 0,
                active_tcp_sessions: 0,
                memory_usage: 0,
            })),
            default_shell_path,
        };

        // 注册消息处理器
        server.register_message_handlers().await?;

        Ok(server)
    }

    /// 注册消息处理器
    async fn register_message_handlers(&self) -> Result<()> {
        // 注册终端管理处理器
        let terminal_handler = Arc::new(TerminalMessageHandler::new(
            self.terminal_sessions.clone(),
            self.communication_manager.clone(),
            self.quic_server.clone(),
            self.default_shell_path.clone(),
        ));
        self.communication_manager
            .register_message_handler(terminal_handler)
            .await;

        // 注册终端 I/O 处理器
        let terminal_io_handler = Arc::new(TerminalIOHandler::new(self.terminal_sessions.clone()));
        self.communication_manager
            .register_message_handler(terminal_io_handler)
            .await;

        // 注册 TCP 转发处理器
        let tcp_handler = Arc::new(TcpForwardingMessageHandler::new(
            self.tcp_sessions.clone(),
            self.communication_manager.clone(),
            self.quic_server.clone(),
        ));
        self.communication_manager
            .register_message_handler(tcp_handler)
            .await;

        // 注册 TCP 数据处理器
        let tcp_data_handler = Arc::new(TcpDataMessageHandler::new(self.tcp_sessions.clone()));
        self.communication_manager
            .register_message_handler(tcp_data_handler)
            .await;

        // 注册系统控制处理器
        let system_handler = Arc::new(SystemControlMessageHandler::new(self.system_status.clone()));
        self.communication_manager
            .register_message_handler(system_handler)
            .await;

        // 注册系统信息处理器
        let system_info_handler = Arc::new(SystemInfoMessageHandler::new());
        self.communication_manager
            .register_message_handler(system_info_handler)
            .await;

        // 启动定期连接清理任务
        self.start_connection_cleanup_task().await;

        info!("All message handlers registered successfully");
        Ok(())
    }

    /// 启动定期连接清理任务
    async fn start_connection_cleanup_task(&self) {
        let quic_server = self.quic_server.clone();

        tokio::spawn(async move {
            let mut cleanup_interval = tokio::time::interval(std::time::Duration::from_secs(60));

            loop {
                cleanup_interval.tick().await;

                // 清理超过5分钟不活跃的连接
                let cleaned_count = quic_server
                    .cleanup_inactive_connections(std::time::Duration::from_secs(300))
                    .await;

                if cleaned_count > 0 {
                    info!("🔌 Cleaned up {} inactive connections", cleaned_count);
                }
            }
        });
    }

    /// 获取节点 ID
    pub fn get_node_id(&self) -> String {
        let node_id = self.quic_server.get_node_id();
        // 使用 base58 编码或者 hex 格式（取决于可用的方法）
        // 先尝试使用 debug 格式，如果太长就截断
        let debug_str = format!("{:?}", node_id);
        if debug_str.len() > 32 {
            format!("{}...", &debug_str[..29])
        } else {
            debug_str
        }
    }

    /// 获取默认shell路径
    pub fn get_default_shell_path(&self) -> &str {
        &self.default_shell_path
    }

    /// 生成连接票据 - 使用 NodeAddr (推荐，包含relay信息)
    pub fn generate_connection_ticket(&self) -> Result<String> {
        use data_encoding::BASE32;
        use riterm_shared::SerializableEndpointAddr;

        // 使用 get_node_id 获取节点ID
        let node_id = self.quic_server.get_node_id();
        tracing::info!("🎫 Generating ticket for node: {:?}", node_id);

        // 使用 SerializableEndpointAddr::from_endpoint_id 创建地址
        let serializable_addr = SerializableEndpointAddr::from_endpoint_id(node_id, riterm_shared::QUIC_MESSAGE_ALPN)?;
        let encoded_addr = serializable_addr.to_base64()?;

        // 创建 ticket 结构
        let ticket_data = serde_json::json!({
            "node_id": node_id.to_string(),
            "endpoint_addr": encoded_addr,
            "relay_url": None::<String>, // 简化版本，不包含relay信息
            "alpn": "riterm_quic",
            "created_at": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        });

        // 生成 base32 编码的 ticket
        let ticket_json = serde_json::to_string(&ticket_data)?;
        let ticket = format!("ticket:{}", BASE32.encode(ticket_json.as_bytes()));

        tracing::info!("✅ Connection ticket generated successfully");
        tracing::info!("🎫 NodeId: {:?}", node_id);
        tracing::info!(
            "🎫 ALPN: {}",
            std::str::from_utf8(riterm_shared::QUIC_MESSAGE_ALPN)?
        );
        tracing::info!("🎫 Ticket preview: {}...", &ticket[..50.min(ticket.len())]);

        Ok(ticket)
    }

    /// 获取活跃连接数
    pub async fn get_active_connections_count(&self) -> usize {
        self.quic_server.get_active_connections_count().await
    }

    /// 获取连接信息用于状态显示
    pub async fn get_connection_info(&self) -> Result<Vec<riterm_shared::ConnectionInfo>> {
        Ok(self.quic_server.get_connection_info().await)
    }

    /// 关闭服务器
    pub async fn shutdown(&self) -> Result<()> {
        info!("Shutting down CLI message server");

        // 关闭所有终端会话
        let sessions = self.terminal_sessions.read().await;
        for session in sessions.values() {
            if session.session.running {
                info!("Terminating terminal session: {}", session.session.id);
                // TODO: 实现终端会话清理
            }
        }

        // 关闭 QUIC 服务器
        self.quic_server.shutdown().await?;
        Ok(())
    }
}

/// 终端管理消息处理器
pub struct TerminalMessageHandler {
    terminal_sessions: Arc<RwLock<HashMap<String, InternalTerminalSession>>>,
    communication_manager: Arc<CommunicationManager>,
    quic_server: QuicMessageServer,
    default_shell_path: String,
}

impl TerminalMessageHandler {
    pub fn new(
        terminal_sessions: Arc<RwLock<HashMap<String, InternalTerminalSession>>>,
        communication_manager: Arc<CommunicationManager>,
        quic_server: QuicMessageServer,
        default_shell_path: String,
    ) -> Self {
        Self {
            terminal_sessions,
            communication_manager,
            quic_server,
            default_shell_path,
        }
    }

    /// 创建新的终端会话
    async fn create_terminal(
        &self,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: (u16, u16),
    ) -> Result<String> {
        let terminal_id = Uuid::new_v4().to_string();
        info!("Creating terminal session: {}", terminal_id);

        // 确定 working directory
        let work_dir = working_dir.clone().unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        });

        // 确定 shell 路径，优先使用启动时记录的默认路径
        let shell = match &shell_path {
            Some(custom_shell) => custom_shell.clone(),
            None => self.default_shell_path.clone(),
        };

        #[cfg(debug_assertions)]
        {
            info!("🔧 Creating terminal with shell: {}", shell);
            info!("📁 Working directory: {}", work_dir);
            if let Some(custom_shell) = &shell_path {
                info!("✨ Using custom shell: {}", custom_shell);
            } else {
                info!(
                    "🐚 Using default shell from CLI startup: {}",
                    self.default_shell_path
                );
            }
        }

        // 创建 PTY 对
        let pty_pair = portable_pty::native_pty_system().openpty(PtySize {
            rows: size.0,
            cols: size.1,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // 创建命令
        let mut cmd = CommandBuilder::new(shell.clone());
        if working_dir.is_some() {
            cmd.cwd(&work_dir);
        } else {
            // 如果没有指定工作目录，使用CLI启动时的工作目录
            cmd.cwd(
                &std::env::current_dir()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .as_ref(),
            );
        }

        // 启动 shell
        let _join_handle = pty_pair.slave.spawn_command(cmd)?;
        let mut master = pty_pair.master;

        // 创建输入输出通道
        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (output_tx, _output_rx) = mpsc::unbounded_channel();

        // 创建输出广播通道（用于向所有订阅者广播输出）
        let (output_broadcast_tx, _output_broadcast_rx) = tokio::sync::broadcast::channel(1000);

        // 获取 reader 和 writer
        let reader = master.try_clone_reader()?;
        let writer_result = master.take_writer();

        if writer_result.is_err() {
            return Err(anyhow::anyhow!("Failed to get PTY writer"));
        }
        let writer = writer_result.unwrap();

        // 创建终端会话
        let mut session = InternalTerminalSession::new(
            Some(master),
            Some(input_tx.clone()),
            Some(output_tx),
            Some(output_broadcast_tx.clone()),
        );
        session.session.id = terminal_id.clone();
        session.session.name = name;
        session.session.shell_type = shell;
        session.session.current_dir = work_dir;
        session.session.size = size;
        session.session.running = true;

        // 存储会话
        {
            let mut sessions = self.terminal_sessions.write().await;
            sessions.insert(terminal_id.clone(), session);
        }

        info!("Terminal session created successfully: {}", terminal_id);
        info!("✅ PTY ready, starting async I/O loop (sshx pattern)...");

        // 将 reader 和 writer 包装在 Arc<Mutex<>> 中以便在 select 分支中使用
        let reader_shared = Arc::new(tokio::sync::Mutex::new(reader));
        let writer_shared = Arc::new(tokio::sync::Mutex::new(writer));

        // 启动异步 I/O 循环（使用 tokio::select!，参考 sshx）
        let terminal_id_clone = terminal_id.clone();
        let output_broadcast_for_io = output_broadcast_tx.clone();
        let quic_server_for_io = self.quic_server.clone();

        tokio::spawn(async move {
            use riterm_shared::message_protocol::{IODataType, MessageBuilder};
            use std::io::{Read, Write};

            info!("🔄 Terminal I/O loop started for: {}", terminal_id_clone);

            let mut read_buffer = vec![0u8; 8192];

            loop {
                tokio::select! {
                    // 处理输入（从通道读取并写入 PTY）
                    Some(input_data) = input_rx.recv() => {
                        #[cfg(debug_assertions)]
                        debug!("Writing {} bytes to PTY", input_data.len());

                        // 使用 spawn_blocking 进行同步 I/O
                        let writer = writer_shared.clone();
                        let data = input_data.clone();
                        let write_result = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
                            let mut writer = writer.blocking_lock();
                            writer.write_all(&data)?;
                            writer.flush()?;
                            Ok(())
                        }).await;

                        match write_result {
                            Ok(Ok(_)) => {
                                #[cfg(debug_assertions)]
                                debug!("Input written and flushed");
                            }
                            Ok(Err(e)) => {
                                error!("Failed to write to PTY: {}", e);
                                break;
                            }
                            Err(e) => {
                                error!("Write task panicked: {}", e);
                                break;
                            }
                        }
                    }

                    // 处理输出（从 PTY 读取并发送到客户端）
                    read_result = {
                        let reader = reader_shared.clone();
                        let mut buffer = read_buffer.clone();
                        tokio::task::spawn_blocking(move || -> anyhow::Result<(usize, Vec<u8>)> {
                            let mut reader = reader.blocking_lock();
                            let n = reader.read(&mut buffer)?;
                            Ok((n, buffer))
                        })
                    } => {
                        match read_result {
                            Ok(Ok((0, _))) => {
                                info!("Terminal {} reader: reached EOF", terminal_id_clone);
                                break;
                            }
                            Ok(Ok((n, buffer))) => {
                                let data = buffer[..n].to_vec();
                                #[cfg(debug_assertions)]
                                debug!("Terminal {} output: {} bytes", terminal_id_clone, n);

                                // 广播输出到所有订阅者
                                let _ = output_broadcast_for_io.send(data.clone());

                                // 发送输出消息到所有连接的客户端
                                let output_msg = MessageBuilder::terminal_io(
                                    "cli_server".to_string(),
                                    terminal_id_clone.clone(),
                                    IODataType::Output,
                                    data,
                                );

                                // 广播到所有连接的客户端
                                if let Err(e) = quic_server_for_io.broadcast_message(output_msg).await {
                                    error!("Failed to broadcast terminal output: {}", e);
                                    // 不要因为发送失败就退出，继续处理
                                }
                            }
                            Ok(Err(e)) => {
                                error!("Failed to read from PTY: {}", e);
                                break;
                            }
                            Err(e) => {
                                error!("Read task panicked: {}", e);
                                break;
                            }
                        }
                    }
                }
            }

            info!("Terminal I/O loop ended for: {}", terminal_id_clone);
        });

        info!("✅ Async I/O loop spawned for terminal: {}", terminal_id);

        // 返回 terminal_id
        Ok(terminal_id)
    }

    /// 发送输入到终端
    async fn send_input(&self, terminal_id: &str, input: String) -> Result<()> {
        debug!(
            "Sending input to terminal {}: {} bytes",
            terminal_id,
            input.len()
        );

        // 找到对应的终端 session 并克隆 master 引用
        let master_clone = {
            let sessions = self.terminal_sessions.read().await;
            if let Some(terminal_session) = sessions.get(terminal_id) {
                terminal_session.master.clone()
            } else {
                return Err(anyhow::anyhow!(
                    "Terminal session not found: {}",
                    terminal_id
                ));
            }
        };

        if let Some(_master_arc) = master_clone {
            // 创建一个异步任务来处理写入操作
            let input_bytes = input.as_bytes().to_vec();
            let terminal_id_clone = terminal_id.to_string();

            tokio::task::spawn_blocking(move || {
                // TODO: 实现真正的 PTY 输入
                // portable_pty 的 MasterPty 需要特定的方法来写入数据
                debug!(
                    "PTY input not yet implemented for terminal {}: {} bytes",
                    terminal_id_clone,
                    input_bytes.len()
                );

                // 暂时只记录输入内容
                if let Ok(input_str) = String::from_utf8(input_bytes.clone()) {
                    debug!("Input content: {:?}", input_str);
                }
            });

            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "Terminal not found or not properly initialized"
            ))
        }
    }

    /// 调整终端大小
    async fn resize_terminal(&self, terminal_id: &str, rows: u16, cols: u16) -> Result<()> {
        debug!("Resizing terminal {} to {}x{}", terminal_id, rows, cols);

        // 先克隆 master 引用以避免借用检查器问题
        let master_clone = {
            let sessions = self.terminal_sessions.read().await;
            if let Some(terminal_session) = sessions.get(terminal_id) {
                terminal_session.master.clone()
            } else {
                return Err(anyhow::anyhow!(
                    "Terminal session not found: {}",
                    terminal_id
                ));
            }
        };

        if let Some(_master_arc) = master_clone {
            // 创建新的终端大小
            let new_size = PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            };

            // 创建一个异步任务来处理大小调整操作
            let terminal_id_clone = terminal_id.to_string();

            tokio::task::spawn_blocking(move || {
                // TODO: 实现真正的 PTY 大小调整
                debug!(
                    "PTY resize not yet implemented for terminal {}: {}x{}",
                    terminal_id_clone, new_size.rows, new_size.cols
                );
            });

            // 更新会话信息中的终端大小
            let mut sessions = self.terminal_sessions.write().await;
            if let Some(session) = sessions.get_mut(terminal_id) {
                session.session.size = (rows, cols);
            }

            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "Terminal not found or not properly initialized"
            ))
        }
    }

    /// 停止终端
    async fn stop_terminal(&self, terminal_id: &str) -> Result<()> {
        debug!("Stopping terminal session: {}", terminal_id);

        let mut sessions = self.terminal_sessions.write().await;
        if let Some(mut session) = sessions.remove(terminal_id) {
            // 标记为非运行状态
            session.session.running = false;

            // 关闭输出通道，这会导致读取线程退出
            if let Some(output_tx) = session.output_tx.take() {
                drop(output_tx);
            }

            // PTY master 和 slave 会在 drop 时自动清理
            // 读取线程在通道关闭后会自动退出

            info!("Terminal session stopped and cleaned up: {}", terminal_id);
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "Terminal session not found: {}",
                terminal_id
            ))
        }
    }

    /// 列出所有终端
    async fn list_terminals(&self) -> Result<Vec<TerminalSession>> {
        let sessions = self.terminal_sessions.read().await;
        let terminals: Vec<TerminalSession> = sessions
            .values()
            .map(|internal_session| internal_session.session.clone())
            .collect();
        Ok(terminals)
    }
}

#[async_trait::async_trait]
impl MessageHandler for TerminalMessageHandler {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        match &message.payload {
            MessagePayload::TerminalManagement(terminal_msg) => {
                match &terminal_msg.action {
                    TerminalAction::Create {
                        name,
                        shell_path,
                        working_dir,
                        size,
                    } => {
                        match self
                            .create_terminal(
                                name.clone(),
                                shell_path.clone(),
                                working_dir.clone(),
                                *size,
                            )
                            .await
                        {
                            Ok(terminal_id) => {
                                let response_data = serde_json::json!({
                                    "terminal_id": terminal_id,
                                    "status": "created"
                                });
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: true,
                                        data: Some(response_data.to_string()),
                                        message: Some("Terminal created successfully".to_string()),
                                    }),
                                )));
                            }
                            Err(e) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!("Failed to create terminal: {}", e)),
                                    }),
                                )));
                            }
                        }
                    }
                    TerminalAction::Input {
                        terminal_id, data, ..
                    } => {
                        match self
                            .send_input(terminal_id, String::from_utf8_lossy(data).to_string())
                            .await
                        {
                            Ok(()) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: true,
                                        data: None,
                                        message: Some("Input sent successfully".to_string()),
                                    }),
                                )));
                            }
                            Err(e) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!("Failed to send input: {}", e)),
                                    }),
                                )));
                            }
                        }
                    }
                    TerminalAction::Resize {
                        terminal_id,
                        rows,
                        cols,
                    } => match self.resize_terminal(terminal_id, *rows, *cols).await {
                        Ok(()) => {
                            return Ok(Some(message.create_response(MessagePayload::Response(
                                ResponseMessage {
                                    request_id: message.id.clone(),
                                    success: true,
                                    data: None,
                                    message: Some("Terminal resized successfully".to_string()),
                                },
                            ))));
                        }
                        Err(e) => {
                            return Ok(Some(message.create_response(MessagePayload::Response(
                                ResponseMessage {
                                    request_id: message.id.clone(),
                                    success: false,
                                    data: None,
                                    message: Some(format!("Failed to resize terminal: {}", e)),
                                },
                            ))));
                        }
                    },
                    TerminalAction::Stop { terminal_id } => {
                        match self.stop_terminal(terminal_id).await {
                            Ok(()) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: true,
                                        data: None,
                                        message: Some("Terminal stopped successfully".to_string()),
                                    }),
                                )));
                            }
                            Err(e) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!("Failed to stop terminal: {}", e)),
                                    }),
                                )));
                            }
                        }
                    }
                    TerminalAction::List => match self.list_terminals().await {
                        Ok(terminals) => {
                            let response_data = serde_json::json!({
                                "terminals": terminals
                            });
                            return Ok(Some(message.create_response(MessagePayload::Response(
                                ResponseMessage {
                                    request_id: message.id.clone(),
                                    success: true,
                                    data: Some(response_data.to_string()),
                                    message: Some("Terminals listed successfully".to_string()),
                                },
                            ))));
                        }
                        Err(e) => {
                            return Ok(Some(message.create_response(MessagePayload::Response(
                                ResponseMessage {
                                    request_id: message.id.clone(),
                                    success: false,
                                    data: None,
                                    message: Some(format!("Failed to list terminals: {}", e)),
                                },
                            ))));
                        }
                    },
                    TerminalAction::Info { terminal_id } => {
                        // TODO: 实现终端信息查询
                        warn!("Terminal info not yet implemented for: {}", terminal_id);
                        return Ok(Some(message.create_response(MessagePayload::Response(
                            ResponseMessage {
                                request_id: message.id.clone(),
                                success: false,
                                data: None,
                                message: Some("Terminal info not yet implemented".to_string()),
                            },
                        ))));
                    }
                }
            }
            _ => {}
        }
        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![MessageType::TerminalManagement]
    }
}

/// 终端 I/O 消息处理器
pub struct TerminalIOHandler {
    terminal_sessions: Arc<RwLock<HashMap<String, InternalTerminalSession>>>,
}

impl TerminalIOHandler {
    pub fn new(terminal_sessions: Arc<RwLock<HashMap<String, InternalTerminalSession>>>) -> Self {
        Self { terminal_sessions }
    }

    /// 处理终端输入
    async fn handle_terminal_input(&self, terminal_id: &str, data: Vec<u8>) -> Result<()> {
        let terminal_id = terminal_id.to_string();
        info!(
            "Handling terminal input for {}: {} bytes",
            terminal_id,
            data.len()
        );

        // 找到对应的终端 session 并获取输入通道
        let input_tx = {
            let sessions = self.terminal_sessions.read().await;
            if let Some(terminal_session) = sessions.get(&terminal_id) {
                terminal_session.input_tx.clone()
            } else {
                return Err(anyhow::anyhow!(
                    "Terminal session not found: {}",
                    terminal_id
                ));
            }
        };

        if let Some(tx) = input_tx {
            // 通过通道发送输入数据到 I/O 循环
            tx.send(data)
                .map_err(|e| anyhow::anyhow!("Failed to send input to terminal: {}", e))?;

            info!("✅ Terminal input queued successfully");
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "Terminal input channel not found or not properly initialized"
            ))
        }
    }
}

#[async_trait::async_trait]
impl MessageHandler for TerminalIOHandler {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        match &message.payload {
            MessagePayload::TerminalIO(io_msg) => {
                info!(
                    "Received TerminalIO message: type={:?}, terminal_id={}",
                    io_msg.data_type, io_msg.terminal_id
                );

                match &io_msg.data_type {
                    IODataType::Input => {
                        info!(
                            "Processing terminal input for {}: {} bytes",
                            io_msg.terminal_id,
                            io_msg.data.len()
                        );

                        // 处理终端输入，不返回响应（高频操作）
                        if let Err(e) = self
                            .handle_terminal_input(&io_msg.terminal_id, io_msg.data.clone())
                            .await
                        {
                            error!("Failed to process terminal input: {}", e);
                        } else {
                            info!("Terminal input processed successfully");
                        }
                        // 不返回响应，避免不必要的网络开销
                        return Ok(None);
                    }
                    IODataType::Output => {
                        // 输出消息通常由 CLI 服务器发送给客户端，而不是接收
                        warn!("Received unexpected terminal output message from client");
                        return Ok(Some(message.create_response(
                            MessagePayload::Response(ResponseMessage {
                                request_id: message.id.clone(),
                                success: false,
                                data: None,
                                message: Some("Terminal output messages should only be sent from server to client".to_string()),
                            })
                        )));
                    }
                    IODataType::Error => {
                        warn!(
                            "Received terminal error message from client: {:?}",
                            String::from_utf8_lossy(&io_msg.data)
                        );
                        return Ok(Some(
                            message.create_response(MessagePayload::Response(ResponseMessage {
                                request_id: message.id.clone(),
                                success: false,
                                data: None,
                                message: Some(
                                    "Terminal error messages are not supported from client"
                                        .to_string(),
                                ),
                            })),
                        ));
                    }
                    IODataType::Resize { rows, cols } => {
                        // 处理终端大小调整请求
                        debug!(
                            "Received resize request for terminal {}: {}x{}",
                            io_msg.terminal_id, rows, cols
                        );
                        // 这里可以转发给终端管理处理器或者直接处理
                        return Ok(Some(message.create_response(
                            MessagePayload::Response(ResponseMessage {
                                request_id: message.id.clone(),
                                success: false,
                                data: None,
                                message: Some("Terminal resize should be sent via TerminalManagement messages".to_string()),
                            })
                        )));
                    }
                    IODataType::Signal { signal } => {
                        warn!(
                            "Received terminal signal message from client: signal={}",
                            signal
                        );
                        return Ok(Some(
                            message.create_response(MessagePayload::Response(ResponseMessage {
                                request_id: message.id.clone(),
                                success: false,
                                data: None,
                                message: Some(
                                    "Terminal signal messages are not supported from client"
                                        .to_string(),
                                ),
                            })),
                        ));
                    }
                }
            }
            _ => {}
        }
        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![MessageType::TerminalIO]
    }
}

/// TCP 转发消息处理器
pub struct TcpForwardingMessageHandler {
    tcp_sessions: Arc<RwLock<HashMap<String, InternalTcpForwardingSession>>>,
    communication_manager: Arc<CommunicationManager>,
    quic_server: QuicMessageServer,
}

impl TcpForwardingMessageHandler {
    pub fn new(
        tcp_sessions: Arc<RwLock<HashMap<String, InternalTcpForwardingSession>>>,
        communication_manager: Arc<CommunicationManager>,
        quic_server: QuicMessageServer,
    ) -> Self {
        Self {
            tcp_sessions,
            communication_manager,
            quic_server,
        }
    }

    /// 创建 TCP 转发会话
    async fn create_tcp_forwarding_session(
        &self,
        client_node_id: String,
        local_addr: String,
        remote_host: Option<String>,
        remote_port: Option<u16>,
        forwarding_type: TcpForwardingType,
    ) -> Result<String> {
        let session_id = Uuid::new_v4().to_string();

        // 构建远程目标地址
        let remote_target = match (&remote_host, remote_port) {
            (Some(host), Some(port)) => format!("{}:{}", host, port),
            _ => return Err(anyhow::anyhow!("Remote host and port must be specified")),
        };

        info!(
            "Creating TCP forwarding session for client {}: {} -> {}",
            client_node_id, local_addr, remote_target
        );

        // 检查端口冲突 - 同一个客户端不能创建相同本地地址的会话
        {
            let sessions = self.tcp_sessions.read().await;
            for existing_session in sessions.values() {
                if existing_session.session.client_node_id == client_node_id
                    && existing_session.session.local_addr == local_addr
                    && existing_session.session.status == "running"
                {
                    return Err(anyhow::anyhow!(
                        "Port conflict: Client {} already has a running session on {}",
                        client_node_id,
                        local_addr
                    ));
                }
            }
        }

        // 验证地址格式
        let local_socket_addr: SocketAddr = local_addr
            .parse()
            .map_err(|_| anyhow::anyhow!("Invalid local address format: {}", local_addr))?;
        let remote_socket_addr: SocketAddr = remote_target
            .parse()
            .map_err(|_| anyhow::anyhow!("Invalid remote target format: {}", remote_target))?;

        // 创建会话对象
        let mut session = TcpForwardingSession::default();
        session.id = session_id.clone();
        session.client_node_id = client_node_id;
        session.local_addr = local_addr;
        session.remote_target = remote_target;
        session.forwarding_type = format!("{:?}", forwarding_type);
        session.status = "starting".to_string();

        let internal_session = InternalTcpForwardingSession::new(session);

        // 启动转发服务
        let shutdown_tx = self
            .start_tcp_forwarding_service(
                session_id.clone(),
                local_socket_addr,
                remote_socket_addr,
                internal_session.connections.clone(),
            )
            .await?;

        // 更新会话状态
        {
            let mut sessions = self.tcp_sessions.write().await;
            let mut session_with_tx = internal_session;
            session_with_tx.shutdown_tx = Some(shutdown_tx);
            session_with_tx.session.status = "running".to_string();
            session_with_tx.session.created_at = std::time::SystemTime::now();
            sessions.insert(session_id.clone(), session_with_tx);
        }

        info!(
            "TCP forwarding session created successfully: {}",
            session_id
        );
        Ok(session_id)
    }

    /// 启动 TCP 转发服务
    async fn start_tcp_forwarding_service(
        &self,
        session_id: String,
        local_addr: SocketAddr,
        remote_addr: SocketAddr,
        connections: Arc<RwLock<HashMap<String, TcpConnection>>>,
    ) -> Result<mpsc::UnboundedSender<()>> {
        let (shutdown_tx, mut shutdown_rx) = mpsc::unbounded_channel();
        let session_id_clone = session_id.clone();

        // 启动 TCP 监听器
        let listener = TokioTcpListener::bind(local_addr)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to bind to {}: {}", local_addr, e))?;

        let actual_local_addr = listener.local_addr()?;
        info!("TCP forwarding listening on: {}", actual_local_addr);

        // 启动接受连接的任务
        tokio::spawn(async move {
            info!(
                "TCP forwarding service started for session: {}",
                session_id_clone
            );

            loop {
                tokio::select! {
                    // 接受新连接
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((stream, remote_client_addr)) => {
                                info!("New TCP connection from: {} -> {}", remote_client_addr, actual_local_addr);

                                // 处理连接
                                let connection_id = Uuid::new_v4().to_string();
                                let connections_clone = connections.clone();
                                let _session_id_clone = session_id_clone.clone();
                                let remote_addr_clone = remote_addr;

                                tokio::spawn(async move {
                                    if let Err(e) = Self::handle_tcp_connection(
                                        connection_id.clone(),
                                        stream,
                                        remote_client_addr,
                                        actual_local_addr,
                                        remote_addr_clone,
                                        connections_clone.clone(),
                                    ).await {
                                        error!("TCP connection handling error: {}", e);
                                    }

                                    // 连接结束后清理连接信息
                                    connections_clone.write().await.remove(&connection_id);
                                    info!("TCP connection closed: {}", connection_id);
                                });
                            }
                            Err(e) => {
                                error!("Failed to accept TCP connection: {}", e);
                            }
                        }
                    }

                    // 接收关闭信号
                    _ = shutdown_rx.recv() => {
                        info!("TCP forwarding service shutting down for session: {}", session_id_clone);
                        break;
                    }
                }
            }

            info!(
                "TCP forwarding service stopped for session: {}",
                session_id_clone
            );
        });

        Ok(shutdown_tx)
    }

    /// 处理单个 TCP 连接
    async fn handle_tcp_connection(
        connection_id: String,
        mut client_stream: TokioTcpStream,
        client_addr: SocketAddr,
        local_addr: SocketAddr,
        remote_addr: SocketAddr,
        connections: Arc<RwLock<HashMap<String, TcpConnection>>>,
    ) -> Result<()> {
        // 连接到远程服务器
        let mut remote_stream = TokioTcpStream::connect(remote_addr)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to connect to remote {}: {}", remote_addr, e))?;

        // 记录连接信息（不存储流，流将在数据转发中处理）
        {
            let mut conn_map = connections.write().await;
            conn_map.insert(
                connection_id.clone(),
                TcpConnection {
                    stream: None, // 流不在这里存储，而是由数据转发逻辑管理
                    bytes_sent: 0,
                    bytes_received: 0,
                    created_at: std::time::SystemTime::now(),
                },
            );
        }

        info!(
            "TCP connection established: {} <-> {} <-> {}",
            client_addr, local_addr, remote_addr
        );

        // 双向数据转发
        let (mut client_read, mut client_write) = client_stream.split();
        let (mut remote_read, mut remote_write) = remote_stream.split();

        // 客户端到远程服务器的数据流
        let client_to_remote = async {
            let mut buffer = [0u8; 8192];
            loop {
                match client_read.read(&mut buffer).await {
                    Ok(0) => break, // 连接关闭
                    Ok(n) => {
                        if remote_write.write_all(&buffer[..n]).await.is_err() {
                            break;
                        }

                        // 更新字节数统计
                        let mut conn_map = connections.write().await;
                        if let Some(conn) = conn_map.get_mut(&connection_id) {
                            conn.bytes_sent += n as u64;
                        }
                    }
                    Err(_) => break,
                }
            }
        };

        // 远程服务器到客户端的数据流
        let remote_to_client = async {
            let mut buffer = [0u8; 8192];
            loop {
                match remote_read.read(&mut buffer).await {
                    Ok(0) => break, // 连接关闭
                    Ok(n) => {
                        if client_write.write_all(&buffer[..n]).await.is_err() {
                            break;
                        }

                        // 更新字节数统计
                        let mut conn_map = connections.write().await;
                        if let Some(conn) = conn_map.get_mut(&connection_id) {
                            conn.bytes_received += n as u64;
                        }
                    }
                    Err(_) => break,
                }
            }
        };

        // 运行双向数据转发
        tokio::select! {
            _ = client_to_remote => {
                debug!("Client to remote stream ended for connection: {}", connection_id);
            }
            _ = remote_to_client => {
                debug!("Remote to client stream ended for connection: {}", connection_id);
            }
        }

        Ok(())
    }

    /// 停止 TCP 转发会话（带客户端所有权验证）
    async fn stop_tcp_forwarding_session(
        &self,
        client_node_id: &str,
        session_id: &str,
    ) -> Result<()> {
        debug!(
            "Stopping TCP forwarding session: {} for client: {}",
            session_id, client_node_id
        );

        let mut sessions = self.tcp_sessions.write().await;
        if let Some(mut session) = sessions.get(session_id) {
            // 验证客户端所有权
            if session.session.client_node_id != client_node_id {
                return Err(anyhow::anyhow!(
                    "Access denied: Client {} cannot stop session owned by {}",
                    client_node_id,
                    session.session.client_node_id
                ));
            }
        }

        if let Some(mut session) = sessions.remove(session_id) {
            // 发送关闭信号
            if let Some(shutdown_tx) = session.shutdown_tx.take() {
                let _ = shutdown_tx.send(());
            }

            // 更新状态
            session.session.status = "stopped".to_string();

            info!(
                "TCP forwarding session stopped: {} by client: {}",
                session_id, client_node_id
            );
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "TCP forwarding session not found: {}",
                session_id
            ))
        }
    }

    /// 列出 TCP 转发会话（可选按客户端过滤）
    async fn list_tcp_forwarding_sessions(
        &self,
        client_node_id: Option<String>,
    ) -> Result<Vec<TcpForwardingSession>> {
        let sessions = self.tcp_sessions.read().await;
        let mut tcp_sessions = Vec::new();

        for internal_session in sessions.values() {
            let session = internal_session.session.clone();

            // 如果指定了客户端ID，则只返回该客户端的会话
            if let Some(ref client_id) = client_node_id {
                if session.client_node_id != *client_id {
                    continue;
                }
            }

            // 更新活跃连接数和字节数统计
            let mut session_with_stats = session.clone();
            {
                let connections = internal_session.connections.read().await;
                session_with_stats.active_connections = connections.len() as u32;
                session_with_stats.bytes_sent = connections.values().map(|c| c.bytes_sent).sum();
                session_with_stats.bytes_received =
                    connections.values().map(|c| c.bytes_received).sum();
            }

            tcp_sessions.push(session_with_stats);
        }

        Ok(tcp_sessions)
    }

    /// 获取 TCP 转发会话信息
    async fn get_tcp_forwarding_session_info(
        &self,
        session_id: &str,
    ) -> Result<TcpForwardingSession> {
        let sessions = self.tcp_sessions.read().await;
        if let Some(internal_session) = sessions.get(session_id) {
            let mut session = internal_session.session.clone();

            // 更新统计信息
            let connections = internal_session.connections.read().await;
            session.active_connections = connections.len() as u32;
            session.bytes_sent = connections.values().map(|c| c.bytes_sent).sum();
            session.bytes_received = connections.values().map(|c| c.bytes_received).sum();

            Ok(session)
        } else {
            Err(anyhow::anyhow!(
                "TCP forwarding session not found: {}",
                session_id
            ))
        }
    }
}

#[async_trait::async_trait]
impl MessageHandler for TcpForwardingMessageHandler {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        match &message.payload {
            MessagePayload::TcpForwarding(tcp_msg) => {
                match &tcp_msg.action {
                    TcpForwardingAction::CreateSession {
                        local_addr,
                        remote_host,
                        remote_port,
                        forwarding_type,
                    } => {
                        match self
                            .create_tcp_forwarding_session(
                                message.sender_id.clone(), // 使用消息发送者作为客户端ID
                                local_addr.clone(),
                                remote_host.clone(),
                                *remote_port,
                                forwarding_type.clone(),
                            )
                            .await
                        {
                            Ok(session_id) => {
                                // 创建会话成功后，获取最新的会话列表并包含在响应中
                                match self
                                    .list_tcp_forwarding_sessions(Some(message.sender_id.clone()))
                                    .await
                                {
                                    Ok(sessions) => {
                                        let response_data = serde_json::json!({
                                            "session_id": session_id,
                                            "status": "created",
                                            "sessions": sessions
                                        });
                                        return Ok(Some(
                                            message.create_response(MessagePayload::Response(
                                                ResponseMessage {
                                                    request_id: message.id.clone(),
                                                    success: true,
                                                    data: Some(response_data.to_string()),
                                                    message: Some(
                                                        "TCP forwarding session created successfully"
                                                            .to_string(),
                                                    ),
                                                },
                                            )),
                                        ));
                                    }
                                    Err(e) => {
                                        // 如果获取列表失败，至少返回创建成功的消息
                                        let response_data = serde_json::json!({
                                            "session_id": session_id,
                                            "status": "created"
                                        });
                                        return Ok(Some(
                                            message.create_response(MessagePayload::Response(
                                                ResponseMessage {
                                                    request_id: message.id.clone(),
                                                    success: true,
                                                    data: Some(response_data.to_string()),
                                                    message: Some(
                                                        "TCP forwarding session created successfully"
                                                            .to_string(),
                                                    ),
                                                },
                                            )),
                                        ));
                                    }
                                }
                            }
                            Err(e) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!(
                                            "Failed to create TCP forwarding session: {}",
                                            e
                                        )),
                                    }),
                                )));
                            }
                        }
                    }
                    TcpForwardingAction::StopSession { session_id } => {
                        match self
                            .stop_tcp_forwarding_session(&message.sender_id, session_id)
                            .await
                        {
                            Ok(()) => {
                                // 停止会话成功后，获取最新的会话列表并包含在响应中
                                match self
                                    .list_tcp_forwarding_sessions(Some(message.sender_id.clone()))
                                    .await
                                {
                                    Ok(sessions) => {
                                        let response_data = serde_json::json!({
                                            "session_id": session_id,
                                            "status": "stopped",
                                            "sessions": sessions
                                        });
                                        return Ok(Some(
                                            message.create_response(MessagePayload::Response(
                                                ResponseMessage {
                                                    request_id: message.id.clone(),
                                                    success: true,
                                                    data: Some(response_data.to_string()),
                                                    message: Some(
                                                        "TCP forwarding session stopped successfully"
                                                            .to_string(),
                                                    ),
                                                },
                                            )),
                                        ));
                                    }
                                    Err(e) => {
                                        // 如果获取列表失败，至少返回停止成功的消息
                                        let response_data = serde_json::json!({
                                            "session_id": session_id,
                                            "status": "stopped"
                                        });
                                        return Ok(Some(
                                            message.create_response(MessagePayload::Response(
                                                ResponseMessage {
                                                    request_id: message.id.clone(),
                                                    success: true,
                                                    data: Some(response_data.to_string()),
                                                    message: Some(
                                                        "TCP forwarding session stopped successfully"
                                                            .to_string(),
                                                    ),
                                                },
                                            )),
                                        ));
                                    }
                                }
                            }
                            Err(e) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!(
                                            "Failed to stop TCP forwarding session: {}",
                                            e
                                        )),
                                    }),
                                )));
                            }
                        }
                    }
                    TcpForwardingAction::ListSessions => {
                        match self
                            .list_tcp_forwarding_sessions(Some(message.sender_id.clone()))
                            .await
                        {
                            Ok(sessions) => {
                                let response_data = serde_json::json!({
                                    "sessions": sessions
                                });
                                return Ok(Some(
                                    message.create_response(MessagePayload::Response(
                                        ResponseMessage {
                                            request_id: message.id.clone(),
                                            success: true,
                                            data: Some(response_data.to_string()),
                                            message: Some(
                                                "TCP forwarding sessions listed successfully"
                                                    .to_string(),
                                            ),
                                        },
                                    )),
                                ));
                            }
                            Err(e) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!(
                                            "Failed to list TCP forwarding sessions: {}",
                                            e
                                        )),
                                    }),
                                )));
                            }
                        }
                    }
                    TcpForwardingAction::GetSessionInfo { session_id } => {
                        match self.get_tcp_forwarding_session_info(session_id).await {
                            Ok(session) => {
                                let response_data = serde_json::json!({
                                    "session": session
                                });
                                return Ok(Some(
                                    message
                                        .create_response(MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: true,
                                        data: Some(response_data.to_string()),
                                        message: Some(
                                            "TCP forwarding session info retrieved successfully"
                                                .to_string(),
                                        ),
                                    })),
                                ));
                            }
                            Err(e) => {
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!(
                                            "Failed to get TCP forwarding session info: {}",
                                            e
                                        )),
                                    }),
                                )));
                            }
                        }
                    }
                    TcpForwardingAction::Connect { .. } => {
                        // Connect action is not directly supported for TCP forwarding
                        // Connections are handled automatically by the forwarding service
                        warn!(
                            "Direct TCP connection not supported through forwarding - use CreateSession instead"
                        );
                        return Ok(Some(message.create_response(
                            MessagePayload::Response(ResponseMessage {
                                request_id: message.id.clone(),
                                success: false,
                                data: None,
                                message: Some("Direct TCP connection not supported - use CreateSession to establish forwarding".to_string()),
                            })
                        )));
                    }
                }
            }
            _ => {}
        }
        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![MessageType::TcpForwarding]
    }
}

/// 系统控制消息处理器
pub struct SystemControlMessageHandler {
    system_status: Arc<RwLock<SystemStatus>>,
}

impl SystemControlMessageHandler {
    pub fn new(system_status: Arc<RwLock<SystemStatus>>) -> Self {
        Self { system_status }
    }
}

#[async_trait::async_trait]
impl MessageHandler for SystemControlMessageHandler {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        match &message.payload {
            MessagePayload::SystemControl(system_msg) => match &system_msg.action {
                SystemAction::GetStatus => {
                    let status = self.system_status.read().await;
                    let response_data = serde_json::json!({
                        "status": status.status,
                        "uptime": status.uptime,
                        "active_terminals": status.active_terminals,
                        "active_tcp_sessions": status.active_tcp_sessions,
                        "memory_usage": status.memory_usage
                    });
                    return Ok(Some(message.create_response(MessagePayload::Response(
                        ResponseMessage {
                            request_id: message.id.clone(),
                            success: true,
                            data: Some(response_data.to_string()),
                            message: Some("System status retrieved successfully".to_string()),
                        },
                    ))));
                }
                SystemAction::Restart => {
                    warn!("System restart not implemented");
                    return Ok(Some(message.create_response(MessagePayload::Response(
                        ResponseMessage {
                            request_id: message.id.clone(),
                            success: false,
                            data: None,
                            message: Some("System restart not implemented".to_string()),
                        },
                    ))));
                }
                SystemAction::Shutdown => {
                    warn!("System shutdown not implemented");
                    return Ok(Some(message.create_response(MessagePayload::Response(
                        ResponseMessage {
                            request_id: message.id.clone(),
                            success: false,
                            data: None,
                            message: Some("System shutdown not implemented".to_string()),
                        },
                    ))));
                }
                SystemAction::GetLogs { .. } => {
                    warn!("Get logs not implemented");
                    return Ok(Some(message.create_response(MessagePayload::Response(
                        ResponseMessage {
                            request_id: message.id.clone(),
                            success: false,
                            data: None,
                            message: Some("Get logs not implemented".to_string()),
                        },
                    ))));
                }
            },
            _ => {}
        }
        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![MessageType::SystemControl]
    }
}

/// 系统信息消息处理器
pub struct SystemInfoMessageHandler;

impl SystemInfoMessageHandler {
    pub fn new() -> Self {
        Self
    }

    /// 收集系统信息
    async fn collect_system_info(&self) -> Result<SystemInfo> {
        info!("Collecting system information...");

        // 收集操作系统信息
        let os_info = self.collect_os_info().await?;

        // 收集 Shell 信息
        let shell_info = self.collect_shell_info().await?;

        // 收集可用工具信息
        let available_tools = self.collect_available_tools().await?;

        // 收集环境变量（选择性收集重要的环境变量）
        let environment_vars = self.collect_environment_vars();

        // 获取系统架构
        let architecture = std::env::consts::ARCH.to_string();

        // 获取主机名
        let hostname = gethostname::gethostname()
            .to_str()
            .unwrap_or("unknown")
            .to_string();

        // 获取用户信息
        let user_info = self.collect_user_info();

        let system_info = SystemInfo {
            os_info,
            shell_info,
            available_tools,
            environment_vars,
            architecture,
            hostname,
            user_info,
        };

        info!("System information collected successfully");
        Ok(system_info)
    }

    /// 收集操作系统信息
    async fn collect_os_info(&self) -> Result<OSInfo> {
        let os_type = std::env::consts::OS.to_string();

        // 获取详细的操作系统信息
        let (name, version, kernel_version) = if cfg!(target_os = "macos") {
            // macOS 特定的信息收集
            match self.run_command("sw_vers", &["-productName"]).await {
                Ok(product_name) => {
                    let version = self
                        .run_command("sw_vers", &["-productVersion"])
                        .await
                        .unwrap_or_default();
                    let kernel_version =
                        self.run_command("uname", &["-r"]).await.unwrap_or_default();
                    (product_name, version, kernel_version)
                }
                Err(_) => (
                    "macOS".to_string(),
                    "Unknown".to_string(),
                    "Unknown".to_string(),
                ),
            }
        } else if cfg!(target_os = "linux") {
            // Linux 特定的信息收集
            let name = if let Ok(name) = self.run_command("lsb_release", &["-i", "-s"]).await {
                name
            } else if let Ok(_) = self.run_command("cat", &["/etc/os-release"]).await {
                // Parse os-release for name
                "Linux".to_string()
            } else {
                "Linux".to_string()
            };

            let version = self
                .run_command("lsb_release", &["-r", "-s"])
                .await
                .unwrap_or_else(|_| "Unknown".to_string());

            let kernel_version = self.run_command("uname", &["-r"]).await.unwrap_or_default();
            (name, version, kernel_version)
        } else if cfg!(target_os = "windows") {
            // Windows 特定的信息收集
            let name = "Windows".to_string();
            let version = self
                .run_command("cmd", &["/c", "ver"])
                .await
                .unwrap_or_else(|_| "Unknown".to_string());
            let kernel_version = version.clone();
            (name, version, kernel_version)
        } else {
            // 其他操作系统
            (
                os_type.clone(),
                "Unknown".to_string(),
                "Unknown".to_string(),
            )
        };

        Ok(OSInfo {
            os_type,
            name,
            version,
            kernel_version,
        })
    }

    /// 收集 Shell 信息
    async fn collect_shell_info(&self) -> Result<ShellInfo> {
        let shell_detector = ShellDetector::get_shell_config();

        let default_shell = shell_detector.shell_path.clone();
        let shell_type = shell_detector.shell_type.clone();
        let shell_version = self
            .get_shell_version(&default_shell)
            .await
            .unwrap_or_else(|_| "Unknown".to_string());

        // 查找可用的 shells
        let mut available_shells = Vec::new();

        let potential_shells = if cfg!(target_os = "macos") || cfg!(target_os = "linux") {
            vec![
                "/bin/bash",
                "/bin/zsh",
                "/bin/fish",
                "/bin/sh",
                "/usr/bin/fish",
            ]
        } else if cfg!(target_os = "windows") {
            vec!["powershell", "cmd"]
        } else {
            vec![]
        };

        for shell in potential_shells {
            if self.check_command_exists(shell).await {
                available_shells.push(shell.to_string());
            }
        }

        Ok(ShellInfo {
            default_shell,
            shell_type: shell_type.to_string(),
            shell_version,
            available_shells,
        })
    }

    /// 收集可用工具信息
    async fn collect_available_tools(&self) -> Result<AvailableTools> {
        // 包管理器
        let package_managers = self.collect_package_managers().await;

        // 版本控制工具
        let version_control = self.collect_version_control_tools().await;

        // 文本编辑器
        let text_editors = self.collect_text_editors().await;

        // 搜索工具
        let search_tools = self.collect_search_tools().await;

        // 开发工具
        let development_tools = self.collect_development_tools().await;

        // 系统工具
        let system_tools = self.collect_system_tools().await;

        Ok(AvailableTools {
            package_managers,
            version_control,
            text_editors,
            search_tools,
            development_tools,
            system_tools,
        })
    }

    /// 收集包管理器
    async fn collect_package_managers(&self) -> Vec<PackageManager> {
        let mut managers = Vec::new();

        let potential_managers = [
            ("brew", "brew", "Homebrew"),
            ("apt", "apt", "APT"),
            ("apt-get", "apt-get", "APT"),
            ("yum", "yum", "YUM"),
            ("dnf", "dnf", "DNF"),
            ("pacman", "pacman", "Pacman"),
            ("npm", "npm", "NPM"),
            ("pip", "pip", "PIP"),
            ("pip3", "pip3", "PIP3"),
            ("cargo", "cargo", "Cargo"),
        ];

        for (cmd, name, display_name) in potential_managers {
            if let Ok(version) = self.get_tool_version(cmd).await {
                managers.push(PackageManager {
                    name: display_name.to_string(),
                    command: cmd.to_string(),
                    version,
                    available: true,
                });
            }
        }

        managers
    }

    /// 收集版本控制工具
    async fn collect_version_control_tools(&self) -> Vec<Tool> {
        let mut tools = Vec::new();

        let vcs_tools = [
            ("git", "Git", "分布式版本控制系统"),
            ("svn", "Subversion", "集中式版本控制系统"),
            ("hg", "Mercurial", "分布式版本控制系统"),
        ];

        for (cmd, name, description) in vcs_tools {
            if let Ok(version) = self.get_tool_version(cmd).await {
                tools.push(Tool {
                    name: name.to_string(),
                    command: cmd.to_string(),
                    version,
                    available: true,
                    description: description.to_string(),
                });
            }
        }

        tools
    }

    /// 收集文本编辑器
    async fn collect_text_editors(&self) -> Vec<Tool> {
        let mut editors = Vec::new();

        let editor_tools = [
            ("vim", "Vim", "强大的文本编辑器"),
            ("vi", "Vi", "经典文本编辑器"),
            ("nvim", "Neovim", "现代 Vim 分支"),
            ("emacs", "Emacs", "可扩展的文本编辑器"),
            ("nano", "Nano", "简单易用的文本编辑器"),
            ("code", "VS Code", "Visual Studio Code"),
        ];

        for (cmd, name, description) in editor_tools {
            if let Ok(version) = self.get_tool_version(cmd).await {
                editors.push(Tool {
                    name: name.to_string(),
                    command: cmd.to_string(),
                    version,
                    available: true,
                    description: description.to_string(),
                });
            }
        }

        editors
    }

    /// 收集搜索工具
    async fn collect_search_tools(&self) -> Vec<Tool> {
        let mut tools = Vec::new();

        let search_tools = [
            ("rg", "ripgrep", "超快的文本搜索工具"),
            ("grep", "grep", "经典文本搜索工具"),
            ("find", "find", "文件查找工具"),
            ("fd", "fd", "用户友好的文件查找工具"),
            ("ag", "silver searcher", "快速的文本搜索工具"),
        ];

        for (cmd, name, description) in search_tools {
            if let Ok(version) = self.get_tool_version(cmd).await {
                tools.push(Tool {
                    name: name.to_string(),
                    command: cmd.to_string(),
                    version,
                    available: true,
                    description: description.to_string(),
                });
            }
        }

        tools
    }

    /// 收集开发工具
    async fn collect_development_tools(&self) -> Vec<Tool> {
        let mut tools = Vec::new();

        let dev_tools = [
            ("node", "Node.js", "JavaScript 运行时"),
            ("npm", "NPM", "Node.js 包管理器"),
            ("python", "Python", "Python 编程语言"),
            ("python3", "Python 3", "Python 3 编程语言"),
            ("java", "Java", "Java 编程语言"),
            ("javac", "Java Compiler", "Java 编译器"),
            ("go", "Go", "Go 编程语言"),
            ("rustc", "Rust", "Rust 编程语言"),
            ("cargo", "Cargo", "Rust 包管理器"),
            ("gcc", "GCC", "C/C++ 编译器"),
            ("clang", "Clang", "C/C++ 编译器"),
            ("make", "Make", "构建工具"),
            ("cmake", "CMake", "构建系统"),
            ("docker", "Docker", "容器化平台"),
            ("curl", "cURL", "网络请求工具"),
            ("wget", "wget", "文件下载工具"),
        ];

        for (cmd, name, description) in dev_tools {
            if let Ok(version) = self.get_tool_version(cmd).await {
                tools.push(Tool {
                    name: name.to_string(),
                    command: cmd.to_string(),
                    version,
                    available: true,
                    description: description.to_string(),
                });
            }
        }

        tools
    }

    /// 收集系统工具
    async fn collect_system_tools(&self) -> Vec<Tool> {
        let mut tools = Vec::new();

        let sys_tools = [
            ("ps", "ps", "进程状态工具"),
            ("top", "top", "系统监控工具"),
            ("htop", "htop", "交互式进程查看器"),
            ("ls", "ls", "列出目录内容"),
            ("cat", "cat", "文件内容查看"),
            ("less", "less", "文件分页查看"),
            ("tail", "tail", "文件尾部查看"),
            ("head", "head", "文件头部查看"),
            ("sed", "sed", "流编辑器"),
            ("awk", "awk", "文本处理工具"),
            ("jq", "jq", "JSON 处理工具"),
            ("tar", "tar", "归档工具"),
            ("zip", "zip", "压缩工具"),
            ("unzip", "unzip", "解压工具"),
            ("ssh", "SSH", "安全远程连接"),
            ("scp", "SCP", "安全文件传输"),
        ];

        for (cmd, name, description) in sys_tools {
            if let Ok(version) = self.get_tool_version(cmd).await {
                tools.push(Tool {
                    name: name.to_string(),
                    command: cmd.to_string(),
                    version,
                    available: true,
                    description: description.to_string(),
                });
            }
        }

        tools
    }

    /// 收集环境变量
    fn collect_environment_vars(&self) -> HashMap<String, String> {
        let mut vars = HashMap::new();

        // 收集重要的环境变量
        let important_vars = [
            "PATH",
            "HOME",
            "USER",
            "SHELL",
            "LANG",
            "LC_ALL",
            "TERM",
            "EDITOR",
            "VISUAL",
            "GOPATH",
            "GOROOT",
            "NODE_PATH",
            "PYTHONPATH",
            "JAVA_HOME",
            "RUST_HOME",
            "CARGO_HOME",
        ];

        for var in important_vars {
            if let Ok(value) = std::env::var(var) {
                vars.insert(var.to_string(), value);
            }
        }

        vars
    }

    /// 收集用户信息
    fn collect_user_info(&self) -> UserInfo {
        UserInfo {
            username: std::env::var("USER")
                .unwrap_or_else(|_| std::env::var("USERNAME").unwrap_or_default()),
            home_directory: std::env::var("HOME")
                .unwrap_or_else(|_| std::env::var("USERPROFILE").unwrap_or_default()),
            current_directory: std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            user_id: std::env::var("UID").unwrap_or_else(|_| "unknown".to_string()),
            group_id: std::env::var("GID").unwrap_or_else(|_| "unknown".to_string()),
        }
    }

    /// 检查命令是否存在
    async fn check_command_exists(&self, command: &str) -> bool {
        self.run_command("which", &[command]).await.is_ok()
            || self.run_command("whereis", &[command]).await.is_ok()
            || self.run_command("command", &["-v", command]).await.is_ok()
    }

    /// 获取工具版本
    async fn get_tool_version(&self, command: &str) -> Result<String> {
        // 尝试不同的版本参数
        let version_args = ["--version", "-V", "-v", "version"];

        for arg in version_args {
            if let Ok(output) = self.run_command(command, &[arg]).await {
                let cleaned = output.trim().to_string();
                if !cleaned.is_empty()
                    && !cleaned.contains("not found")
                    && !cleaned.contains("command not found")
                {
                    return Ok(cleaned);
                }
            }
        }

        Err(anyhow::anyhow!("Unable to get version for {}", command))
    }

    /// 获取 Shell 版本
    async fn get_shell_version(&self, shell_path: &str) -> Result<String> {
        // 根据不同 shell 类型使用不同的版本参数
        if shell_path.contains("bash") {
            self.run_command(shell_path, &["--version"]).await
        } else if shell_path.contains("zsh") {
            self.run_command(shell_path, &["--version"]).await
        } else if shell_path.contains("fish") {
            self.run_command(shell_path, &["--version"]).await
        } else {
            if let Ok(version) = self.run_command(shell_path, &["--version"]).await {
                Ok(version)
            } else if let Ok(version) = self.run_command(shell_path, &["-v"]).await {
                Ok(version)
            } else if let Ok(version) = self.run_command(shell_path, &["-V"]).await {
                Ok(version)
            } else {
                Err(anyhow::anyhow!("Unable to get shell version"))
            }
        }
    }

    /// 运行命令并获取输出
    async fn run_command(&self, command: &str, args: &[&str]) -> Result<String> {
        let output = Command::new(command).args(args).output().await;

        match output {
            Ok(output) => {
                if output.status.success() {
                    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
                } else {
                    Err(anyhow::anyhow!(
                        "Command failed: {}",
                        String::from_utf8_lossy(&output.stderr)
                    ))
                }
            }
            Err(e) => Err(anyhow::anyhow!("Failed to run command {}: {}", command, e)),
        }
    }
}

#[async_trait::async_trait]
impl MessageHandler for SystemInfoMessageHandler {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        match &message.payload {
            MessagePayload::SystemInfo(system_info_msg) => {
                match &system_info_msg.action {
                    SystemInfoAction::GetSystemInfo => {
                        info!("Received system info request");
                        match self.collect_system_info().await {
                            Ok(system_info) => {
                                let response_payload = MessagePayload::SystemInfo(
                                    riterm_shared::message_protocol::SystemInfoMessage {
                                        action: SystemInfoAction::SystemInfoResponse(system_info),
                                        request_id: system_info_msg.request_id.clone(),
                                    },
                                );
                                return Ok(Some(message.create_response(response_payload)));
                            }
                            Err(e) => {
                                error!("Failed to collect system info: {}", e);
                                return Ok(Some(message.create_response(
                                    MessagePayload::Response(ResponseMessage {
                                        request_id: message.id.clone(),
                                        success: false,
                                        data: None,
                                        message: Some(format!(
                                            "Failed to collect system info: {}",
                                            e
                                        )),
                                    }),
                                )));
                            }
                        }
                    }
                    SystemInfoAction::SystemInfoResponse(_) => {
                        // 服务器端不应该收到响应消息
                        warn!("Received unexpected SystemInfoResponse message");
                        return Ok(None);
                    }
                }
            }
            _ => {}
        }
        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![MessageType::SystemInfo]
    }
}

/// TCP 数据消息处理器
pub struct TcpDataMessageHandler {
    tcp_sessions: Arc<RwLock<HashMap<String, InternalTcpForwardingSession>>>,
}

impl TcpDataMessageHandler {
    pub fn new(tcp_sessions: Arc<RwLock<HashMap<String, InternalTcpForwardingSession>>>) -> Self {
        Self { tcp_sessions }
    }

    /// 处理 TCP 数据消息
    async fn handle_tcp_data(
        &self,
        session_id: &str,
        connection_id: &str,
        data: &[u8],
        data_type: &riterm_shared::message_protocol::TcpDataType,
    ) -> Result<()> {
        let sessions = self.tcp_sessions.read().await;
        if let Some(internal_session) = sessions.get(session_id) {
            match data_type {
                riterm_shared::message_protocol::TcpDataType::Data => {
                    // 转发数据到对应的 TCP 连接
                    let mut connections = internal_session.connections.write().await;
                    if let Some(conn_info) = connections.get_mut(connection_id) {
                        if let Some(stream) = &mut conn_info.stream {
                            match tokio::io::AsyncWriteExt::write_all(stream, data).await {
                                Ok(_) => {
                                    conn_info.bytes_sent += data.len() as u64;
                                    debug!(
                                        "TCP data forwarded to connection {}: {} bytes",
                                        connection_id,
                                        data.len()
                                    );
                                }
                                Err(e) => {
                                    error!(
                                        "Failed to forward TCP data to connection {}: {}",
                                        connection_id, e
                                    );
                                    // 连接可能已经断开，移除流对象但保留统计信息
                                    conn_info.stream = None;
                                }
                            }
                        } else {
                            warn!("TCP stream not available for connection {}", connection_id);
                        }
                    } else {
                        warn!("TCP connection not found: {}", connection_id);
                    }
                }
                riterm_shared::message_protocol::TcpDataType::ConnectionOpen => {
                    info!(
                        "TCP connection open requested for session {} connection {}",
                        session_id, connection_id
                    );
                    // 连接打开通常由服务端主动发起，这里主要是记录
                }
                riterm_shared::message_protocol::TcpDataType::ConnectionClose => {
                    info!(
                        "TCP connection close requested for session {} connection {}",
                        session_id, connection_id
                    );
                    let mut connections = internal_session.connections.write().await;
                    if let Some(conn_info) = connections.get_mut(connection_id) {
                        // 关闭 TCP 流
                        if let Some(mut stream) = conn_info.stream.take() {
                            let _ = stream.shutdown().await;
                        }
                    }
                }
                riterm_shared::message_protocol::TcpDataType::Error => {
                    error!(
                        "TCP error for session {} connection {}: {:?}",
                        session_id,
                        connection_id,
                        String::from_utf8_lossy(data)
                    );
                }
            }
        } else {
            warn!("TCP session not found: {}", session_id);
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl MessageHandler for TcpDataMessageHandler {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        match &message.payload {
            MessagePayload::TcpData(tcp_data_msg) => {
                debug!(
                    "Received TCP data message: session_id={}, connection_id={}, data_type={:?}, data_len={}",
                    tcp_data_msg.session_id,
                    tcp_data_msg.connection_id,
                    tcp_data_msg.data_type,
                    tcp_data_msg.data.len()
                );

                // 处理 TCP 数据，不返回响应（高频操作）
                if let Err(e) = self
                    .handle_tcp_data(
                        &tcp_data_msg.session_id,
                        &tcp_data_msg.connection_id,
                        &tcp_data_msg.data,
                        &tcp_data_msg.data_type,
                    )
                    .await
                {
                    error!("Failed to process TCP data: {}", e);
                    return Ok(Some(message.create_error_response(format!(
                        "TCP data processing failed: {}",
                        e
                    ))));
                }

                // TCP 数据消息不需要响应
                return Ok(None);
            }
            _ => {}
        }
        Ok(None)
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        vec![MessageType::TcpData]
    }
}
