//! RiTerm P2P Client
//!
//! 此模块实现了连接到远程 RiTerm host 的客户端功能，支持 P2P 通信和交互式对话。

use anyhow::Result;
use riterm_shared::message_protocol::{
    Message, MessageType, AgentSessionAction, AgentControlAction,
    MessagePayload, AgentSessionMessage, AgentControlMessage,
};
use riterm_shared::quic_server::{
    QuicMessageClient, SerializableEndpointAddr,
};
use riterm_shared::CommunicationManager;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock, broadcast};
use tracing::{debug, info};

/// P2P 客户端连接配置
#[derive(Clone)]
pub struct ClientConfig {
    /// 连接票据
    pub ticket: String,
    /// 中继服务器 URL（可选，用于 NAT 穿透）
    pub relay_url: Option<String>,
    /// 心跳间隔
    pub heartbeat_interval: Duration,
    /// 消息超时
    pub timeout: Duration,
    /// 客户端密钥文件路径（可选，用于持久化客户端 node ID）
    pub client_key_path: Option<PathBuf>,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            ticket: String::new(),
            relay_url: None,
            heartbeat_interval: Duration::from_secs(30),
            timeout: Duration::from_secs(30),
            client_key_path: None,
        }
    }
}

/// RiTerm P2P 客户端
pub struct RiTermClient {
    config: ClientConfig,
    quic_client: Option<Arc<Mutex<QuicMessageClient>>>,
    connection_id: Option<String>,
    remote_node_id: Option<String>,
    connected: bool,
    sessions: Vec<AgentSessionInfo>,
    message_rx: broadcast::Receiver<Message>,
    message_tx: broadcast::Sender<Message>,
}

/// AI Agent 会话信息
#[derive(Debug, Clone)]
pub struct AgentSessionInfo {
    pub session_id: String,
    pub agent_type: String,
    pub project_path: String,
    pub started_at: u64,
    pub active: bool,
}

impl RiTermClient {
    /// 创建新的客户端
    pub fn new(config: ClientConfig) -> Self {
        let (message_tx, message_rx) = broadcast::channel(1000);

        Self {
            config,
            quic_client: None,
            connection_id: None,
            remote_node_id: None,
            connected: false,
            sessions: Vec::new(),
            message_rx,
            message_tx,
        }
    }

    /// 连接到远程 host
    pub async fn connect(&mut self) -> Result<()> {
        info!("🔄 Connecting to remote RiTerm host...");
        println!("🔄 Connecting to remote RiTerm host...");

        // 1. 解析 ticket
        let endpoint_addr = SerializableEndpointAddr::from_base64(&self.config.ticket)
            .map_err(|e| anyhow::anyhow!("Failed to parse ticket: {}", e))?;

        let remote_node_id = endpoint_addr.try_to_endpoint_id()?;
        info!("🎫 Parsed remote node ID from ticket");

        // 2. 创建 QUIC 客户端
        let communication_manager = Arc::new(CommunicationManager::new("client".to_string()));
        let mut quic_client = QuicMessageClient::new_with_secret_key(
            self.config.relay_url.clone(),
            communication_manager,
            self.config.client_key_path.as_deref(),
        ).await?;

        info!("🌐 QUIC client initialized, connecting to remote host...");

        // 3. 通过 iroh 建立 QUIC 连接
        let connection_id = quic_client.connect_to_server(&remote_node_id).await?;

        info!("✅ Connected to remote host: {:?}", remote_node_id);
        println!("✅ Connected to remote host");

        // 更新状态
        self.quic_client = Some(Arc::new(Mutex::new(quic_client)));
        self.connection_id = Some(connection_id);
        self.remote_node_id = Some(remote_node_id.to_string());
        self.connected = true;

        // 启动消息接收处理任务
        self.start_message_receiver().await;

        Ok(())
    }

    /// 启动消息接收处理器
    async fn start_message_receiver(&self) {
        let mut rx = self.message_tx.subscribe();
        let sessions_ref = Arc::new(RwLock::new(self.sessions.clone()));

        tokio::spawn(async move {
            while let Ok(message) = rx.recv().await {
                Self::handle_message(message, sessions_ref.clone()).await;
            }
        });
    }

    /// 处理接收到的消息
    async fn handle_message(
        message: Message,
        sessions_ref: Arc<RwLock<Vec<AgentSessionInfo>>>,
    ) {
        match message.message_type {
            MessageType::AgentSession => {
                debug!("Received AgentSession message");
                // TODO: 解析会话列表更新
            }
            MessageType::AgentControl => {
                debug!("Received AgentControl message");
                // TODO: 处理控制响应
            }
            MessageType::Response => {
                debug!("Received Response message");
                if let Ok(response_text) = extract_response_content(&message) {
                    println!("🤖 {}", response_text);
                }
            }
            _ => {
                debug!("Received message type: {:?}", message.message_type);
            }
        }
    }

    /// 断开连接
    pub async fn disconnect(&mut self) -> Result<()> {
        if !self.connected {
            return Ok(());
        }

        info!("🔌 Disconnecting...");

        if let (Some(quic_client), Some(connection_id)) = (&self.quic_client, &self.connection_id) {
            let client = quic_client.lock().await;
            // Note: disconnect requires &mut, so we need to handle this differently
            // For now, we'll just mark as disconnected
            drop(client);
        }

        self.connected = false;
        self.remote_node_id = None;
        self.connection_id = None;
        self.sessions.clear();
        self.quic_client = None;

        println!("🔌 Disconnected");
        Ok(())
    }

    /// 是否已连接
    pub fn is_connected(&self) -> bool {
        self.connected
    }

    /// 获取远程节点 ID
    pub fn remote_node_id(&self) -> Option<&str> {
        self.remote_node_id.as_deref()
    }

    /// 发送消息到 QUIC 服务器
    async fn send_quic_message(&self, message: Message) -> Result<()> {
        if let (Some(quic_client), Some(conn_id)) = (&self.quic_client, &self.connection_id) {
            let mut client = quic_client.lock().await;
            client.send_message_to_server(conn_id, message).await?;
        }
        Ok(())
    }

    /// 获取可用的 AI Agent 会话列表
    pub async fn list_sessions(&mut self) -> Result<Vec<AgentSessionInfo>> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        debug!("📋 Fetching available sessions...");

        // 构建会话列表请求消息
        let message = Message::new(
            MessageType::AgentSession,
            "client".to_string(),
            MessagePayload::AgentSession(AgentSessionMessage {
                action: AgentSessionAction::ListSessions,
                request_id: Some(uuid::Uuid::new_v4().to_string()),
            }),
        ).requires_response();

        // 通过 P2P 发送并等待响应
        self.send_quic_message(message).await?;

        // TODO: 实际从响应中解析会话列表
        // 暂时返回空列表
        Ok(Vec::new())
    }

    /// 发送消息到指定的 AI Agent 会话
    pub async fn send_message(&self, session_id: &str, content: &str) -> Result<String> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        debug!("💬 Sending message to session: {}", session_id);

        let message = Message::new(
            MessageType::AgentControl,
            "client".to_string(),
            MessagePayload::AgentControl(AgentControlMessage {
                session_id: session_id.to_string(),
                action: AgentControlAction::SendInput {
                    content: content.to_string(),
                },
                request_id: Some(uuid::Uuid::new_v4().to_string()),
            }),
        ).requires_response();

        // 通过 P2P 发送消息
        self.send_quic_message(message).await?;

        let request_id = uuid::Uuid::new_v4().to_string();
        info!("💬 Message sent (request_id: {})", request_id);
        Ok(request_id)
    }

    /// 启动新的 AI Agent 会话（远程生成）
    pub async fn spawn_session(
        &mut self,
        agent_type: &str,
        project_path: &str,
        _args: &[String],
    ) -> Result<AgentSessionInfo> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        info!("🚀 Spawning new {} session", agent_type);

        // TODO: 构建远程生成消息 - 需要使用 RemoteSpawn MessageType
        // 目前先返回模拟的会话信息
        let session_info = AgentSessionInfo {
            session_id: uuid::Uuid::new_v4().to_string(),
            agent_type: agent_type.to_string(),
            project_path: project_path.to_string(),
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
            active: true,
        };

        self.sessions.push(session_info.clone());

        info!("✅ Session spawned: {}", session_info.session_id);
        Ok(session_info)
    }

    /// 获取会话元数据
    pub async fn get_session_metadata(&self, session_id: &str) -> Result<AgentSessionInfo> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        debug!("📊 Fetching metadata for session: {}", session_id);

        // 检查本地缓存
        for session in &self.sessions {
            if session.session_id == session_id {
                return Ok(session.clone());
            }
        }

        Err(anyhow::anyhow!("Session not found"))
    }

    /// 响应权限请求
    pub async fn respond_to_permission(
        &self,
        _session_id: &str,
        _permission_id: &str,
        _response: bool,
    ) -> Result<()> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        info!("📝 Responding to permission");

        // TODO: 通过 P2P 发送权限响应
        Ok(())
    }

    /// 控制会话（暂停/恢复/停止）
    pub async fn control_session(
        &self,
        session_id: &str,
        action: SessionControlAction,
    ) -> Result<()> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        info!("🎮 Controlling session: {:?}", action);

        let control_action = match action {
            SessionControlAction::Pause => AgentControlAction::Pause,
            SessionControlAction::Resume => AgentControlAction::Resume,
            SessionControlAction::Stop => AgentControlAction::Terminate,
        };

        let message = Message::new(
            MessageType::AgentControl,
            "client".to_string(),
            MessagePayload::AgentControl(AgentControlMessage {
                session_id: session_id.to_string(),
                action: control_action,
                request_id: Some(uuid::Uuid::new_v4().to_string()),
            }),
        );

        // 通过 P2P 发送控制消息
        self.send_quic_message(message).await?;

        debug!("Control action sent");
        Ok(())
    }
}

/// 从响应消息中提取内容
fn extract_response_content(message: &Message) -> Result<String> {
    match &message.payload {
        MessagePayload::Response(response) => {
            if let Some(ref data) = response.data {
                Ok(data.clone())
            } else if let Some(ref msg) = response.message {
                Ok(msg.clone())
            } else {
                Ok("Success".to_string())
            }
        }
        _ => Err(anyhow::anyhow!("Not a response message")),
    }
}

/// 会话控制动作
#[derive(Debug)]
pub enum SessionControlAction {
    Pause,
    Resume,
    Stop,
}

/// 交互式客户端会话
pub struct InteractiveClient {
    client: RiTermClient,
    current_session_id: Option<String>,
}

impl InteractiveClient {
    /// 创建新的交互式客户端
    pub fn new(ticket: String, relay: Option<String>) -> Self {
        let config = ClientConfig {
            ticket,
            relay_url: relay,
            client_key_path: Some(
                std::env::current_dir()
                    .unwrap()
                    .join(".riterm_client_key")
            ),
            ..Default::default()
        };

        Self {
            client: RiTermClient::new(config),
            current_session_id: None,
        }
    }

    /// 连接到远程 host
    pub async fn connect(&mut self) -> Result<()> {
        self.client.connect().await
    }

    /// 断开连接
    pub async fn disconnect(&mut self) -> Result<()> {
        self.client.disconnect().await
    }

    /// 运行交互式对话循环
    pub async fn run_interactive(&mut self) -> Result<()> {
        use std::io::{BufRead, Write};

        println!();
        println!("💬 RiTerm P2P Client - Interactive Mode");
        println!();
        println!("Commands:");
        println!("  /list      - List available AI Agent sessions");
        println!("  /spawn     - Spawn new AI Agent session");
        println!("  /switch    - Switch to a different session");
        println!("  /pause     - Pause current session");
        println!("  /resume    - Resume current session");
        println!("  /stop      - Stop current session");
        println!("  /sessions  - Show all sessions");
        println!("  /quit      - Exit");
        println!();

        let stdin = std::io::stdin();
        let mut stdout = std::io::stdout();
        let mut line = String::new();

        loop {
            // 显示提示符
            let session_hint = if let Some(sid) = &self.current_session_id {
                format!("[{}] ", &sid[..sid.len().min(8)])
            } else {
                String::new()
            };

            print!("{}❓ ", session_hint);
            stdout.flush()?;

            // 读取用户输入
            line.clear();
            stdin.lock().read_line(&mut line)?;

            let input = line.trim();

            if input.is_empty() {
                continue;
            }

            // 处理命令
            if input.starts_with('/') {
                if let Err(e) = self.handle_command(input).await {
                    println!("❌ Error: {}", e);
                }
                continue;
            }

            // 发送消息到当前会话
            if let Some(session_id) = &self.current_session_id {
                match self.client.send_message(session_id, input).await {
                    Ok(request_id) => {
                        debug!("💬 Message sent (request_id: {})", request_id);
                        // 响应会通过消息接收器异步处理
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to send message: {}", e);
                    }
                }
            } else {
                println!("⚠️  No active session. Use /spawn to create one or /list to see available sessions.");
            }
        }
    }

    /// 处理命令
    async fn handle_command(&mut self, input: &str) -> Result<()> {
        let parts: Vec<&str> = input.split_whitespace().collect();

        if parts.is_empty() {
            return Ok(());
        }

        match parts[0] {
            "/list" => {
                let sessions = self.client.list_sessions().await?;
                println!();
                if sessions.is_empty() {
                    println!("📭 No active sessions found.");
                } else {
                    println!("📋 Active Sessions:");
                    for (i, session) in sessions.iter().enumerate() {
                        println!("   {}. {} ({})", i + 1, session.session_id, session.agent_type);
                        println!("      Project: {}", session.project_path);
                        println!();
                    }
                }
            }
            "/spawn" => {
                if parts.len() < 3 {
                    println!("Usage: /spawn <agent_type> <project_path> [args...]");
                    println!("  agent_type: claude, opencode, gemini");
                    return Ok(());
                }

                let agent_type = parts[1];
                let project_path = parts[2];
                let args: Vec<String> = parts[3..].iter().map(|s| s.to_string()).collect();

                match self.client.spawn_session(agent_type, project_path, &args).await {
                    Ok(session) => {
                        println!("✅ Session created: {}", session.session_id);
                        self.current_session_id = Some(session.session_id.clone());
                        println!("📌 Switched to new session");
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to spawn session: {}", e);
                    }
                }
            }
            "/switch" => {
                if parts.len() < 2 {
                    println!("Usage: /switch <session_id>");
                    return Ok(());
                }

                let session_id = parts[1];

                // 验证会话是否存在
                match self.client.get_session_metadata(session_id).await {
                    Ok(_) => {
                        self.current_session_id = Some(session_id.to_string());
                        println!("📌 Switched to session: {}", session_id);
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to switch session: {}", e);
                    }
                }
            }
            "/pause" => {
                if let Some(session_id) = &self.current_session_id {
                    self.client.control_session(session_id, SessionControlAction::Pause).await?;
                    println!("⏸️  Session paused");
                } else {
                    println!("⚠️  No active session");
                }
            }
            "/resume" => {
                if let Some(session_id) = &self.current_session_id {
                    self.client.control_session(session_id, SessionControlAction::Resume).await?;
                    println!("▶️  Session resumed");
                } else {
                    println!("⚠️  No active session");
                }
            }
            "/stop" => {
                if let Some(session_id) = &self.current_session_id.clone() {
                    self.client.control_session(session_id, SessionControlAction::Stop).await?;
                    println!("🛑 Session stopped");
                    self.current_session_id = None;
                } else {
                    println!("⚠️  No active session");
                }
            }
            "/sessions" => {
                let sessions = self.client.list_sessions().await?;
                println!();
                println!("📊 All Sessions:");
                println!();

                if sessions.is_empty() {
                    println!("  No active sessions");
                } else {
                    for (i, session) in sessions.iter().enumerate() {
                        let current = if self.current_session_id.as_ref() == Some(&session.session_id) {
                            " (current)"
                        } else {
                            ""
                        };
                        println!("  {}. {}{} - {}", i + 1, session.session_id, current, session.agent_type);
                        println!("      📁 {}", session.project_path);
                    }
                }
            }
            "/quit" => {
                println!("👋 Goodbye!");
                self.client.disconnect().await?;
                std::process::exit(0);
            }
            _ => {
                println!("❓ Unknown command: {}", parts[0]);
                println!("   Type /quit to exit");
            }
        }

        Ok(())
    }
}
