//! RiTerm P2P Client
//!
//! 此模块实现了连接到远程 RiTerm host 的客户端功能，支持 P2P 通信和交互式对话。

use anyhow::Result;
use riterm_shared::CommunicationManager;
use riterm_shared::message_protocol::{
    AgentControlAction, AgentControlMessage, AgentMessageContent, AgentPermissionMessage,
    AgentPermissionMessageInner, AgentPermissionResponse, AgentSessionAction, AgentSessionMessage,
    AgentType, Message, MessagePayload, MessageType, PermissionMode, RemoteSpawnAction,
    RemoteSpawnMessage,
};
use riterm_shared::quic_server::{QuicMessageClient, SerializableEndpointAddr};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, RwLock, oneshot};
use tracing::{debug, info};

/// P2P 客户端连接配置
#[derive(Clone)]
pub struct ClientConfig {
    /// 连接票据
    pub ticket: String,
    /// 中继服务器 URL（可选，用于 NAT 穿透）
    pub relay_url: Option<String>,
    /// 心跳间隔
    #[allow(dead_code)]
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
    sessions: Arc<RwLock<Vec<AgentSessionInfo>>>,
    /// 等待响应的通道映射 (correlation_id -> sender)
    response_channels: Arc<Mutex<HashMap<String, oneshot::Sender<Message>>>>,
}

/// AI Agent 会话信息
#[derive(Debug, Clone)]
pub struct AgentSessionInfo {
    pub session_id: String,
    pub agent_type: String,
    pub project_path: String,
    #[allow(dead_code)]
    pub started_at: u64,
    #[allow(dead_code)]
    pub active: bool,
}

impl RiTermClient {
    /// 创建新的客户端
    pub fn new(config: ClientConfig) -> Self {
        Self {
            config,
            quic_client: None,
            connection_id: None,
            remote_node_id: None,
            connected: false,
            sessions: Arc::new(RwLock::new(Vec::new())),
            response_channels: Arc::new(Mutex::new(HashMap::new())),
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
        )
        .await?;

        info!("🌐 QUIC client initialized, connecting to remote host...");

        // 3. 通过 iroh 建立 QUIC 连接
        let connection_id = quic_client.connect_to_server(&remote_node_id).await?;

        info!("✅ Connected to remote host: {:?}", remote_node_id);
        println!("✅ Connected to remote host");

        // 获取消息接收器并启动处理任务
        let mut message_rx = quic_client.get_message_receiver();
        let sessions_ref = self.sessions.clone();
        let response_channels = self.response_channels.clone();

        tokio::spawn(async move {
            while let Ok(message) = message_rx.recv().await {
                Self::handle_message(message, sessions_ref.clone(), response_channels.clone())
                    .await;
            }
        });

        // 更新状态
        self.quic_client = Some(Arc::new(Mutex::new(quic_client)));
        self.connection_id = Some(connection_id);
        self.remote_node_id = Some(remote_node_id.to_string());
        self.connected = true;

        Ok(())
    }

    /// 处理接收到的消息
    async fn handle_message(
        message: Message,
        sessions_ref: Arc<RwLock<Vec<AgentSessionInfo>>>,
        response_channels: Arc<Mutex<HashMap<String, oneshot::Sender<Message>>>>,
    ) {
        // 检查是否是响应消息，如果是则路由到等待的通道
        if let Some(correlation_id) = &message.correlation_id {
            let mut channels = response_channels.lock().await;
            if let Some(tx) = channels.remove(correlation_id) {
                // 发送响应到等待的通道
                let _ = tx.send(message);
                return;
            }
        }

        // 处理其他消息类型
        match message.message_type {
            MessageType::AgentSession => {
                if let MessagePayload::AgentSession(session_msg) = message.payload {
                    Self::handle_agent_session(session_msg, sessions_ref).await;
                }
            }
            MessageType::AgentMessage => {
                Self::handle_agent_message(message).await;
            }
            MessageType::Response => {
                // 没有等待的响应通道，打印响应内容
                Self::handle_response(message).await;
            }
            MessageType::AgentControl => {
                debug!("Received AgentControl message");
                // TODO: 处理控制响应
            }
            MessageType::AgentPermission => {
                Self::handle_permission_request(message).await;
            }
            _ => {
                debug!("Received message type: {:?}", message.message_type);
            }
        }
    }

    /// 处理 Agent 会话消息
    async fn handle_agent_session(
        session_msg: AgentSessionMessage,
        sessions_ref: Arc<RwLock<Vec<AgentSessionInfo>>>,
    ) {
        match session_msg.action {
            AgentSessionAction::Register { metadata } => {
                info!("📝 Session registered: {}", metadata.session_id);
                let session = AgentSessionInfo {
                    session_id: metadata.session_id.clone(),
                    agent_type: format!("{:?}", metadata.agent_type),
                    project_path: metadata.project_path,
                    started_at: metadata.started_at,
                    active: metadata.active,
                };

                let mut sessions = sessions_ref.write().await;
                // 检查是否已存在，避免重复
                if !sessions.iter().any(|s| s.session_id == session.session_id) {
                    sessions.push(session);
                }
            }
            AgentSessionAction::UpdateStatus { active, thinking } => {
                debug!(
                    "Session status update: active={}, thinking={}",
                    active, thinking
                );
                // 更新会话状态 - 需要从消息中获取 session_id
                // 注意：UpdateStatus 消息应该包含 session_id，但目前协议中没有
                // 这里暂时只记录日志，等待协议更新
            }
            AgentSessionAction::ListSessions => {
                debug!("ListSessions action received");
            }
            _ => {
                debug!("Other AgentSession action: {:?}", session_msg.action);
            }
        }
    }

    /// 处理 Agent 消息
    async fn handle_agent_message(message: Message) {
        if let MessagePayload::AgentMessage(agent_msg) = message.payload {
            match agent_msg.content {
                AgentMessageContent::AgentResponse { content, .. } => {
                    println!("{}", content);
                }
                AgentMessageContent::SystemNotification { level, message } => match level {
                    riterm_shared::message_protocol::NotificationLevel::Info => {
                        println!("ℹ️  {}", message);
                    }
                    riterm_shared::message_protocol::NotificationLevel::Warning => {
                        println!("⚠️  {}", message);
                    }
                    riterm_shared::message_protocol::NotificationLevel::Error => {
                        println!("❌ {}", message);
                    }
                    riterm_shared::message_protocol::NotificationLevel::Success => {
                        println!("✅ {}", message);
                    }
                },
                _ => {
                    debug!("Other AgentMessage content: {:?}", agent_msg.content);
                }
            }
        }
    }

    /// 处理响应消息
    async fn handle_response(message: Message) {
        if let MessagePayload::Response(response) = message.payload {
            if let Some(ref data) = response.data {
                println!("{}", data);
            } else if let Some(ref msg) = response.message {
                println!("{}", msg);
            } else {
                debug!("Empty response received");
            }
        }
    }

    /// 处理权限请求消息
    async fn handle_permission_request(message: Message) {
        if let MessagePayload::AgentPermission(perm_msg) = message.payload {
            if let AgentPermissionMessageInner::Request(request) = perm_msg.inner {
                println!();
                println!("🔔 Permission Request:");
                println!("   Session: {}", request.session_id);
                println!("   Tool: {}", request.tool_name);
                if let Some(desc) = request.description {
                    println!("   Description: {}", desc);
                }
                println!("   Request ID: {}", request.request_id);
                println!();
                println!("Use /approve <request_id> or /deny <request_id> to respond");
                println!();
            }
        }
    }

    /// 断开连接
    pub async fn disconnect(&mut self) -> Result<()> {
        if !self.connected {
            return Ok(());
        }

        info!("🔌 Disconnecting...");

        self.connected = false;
        self.remote_node_id = None;
        self.connection_id = None;
        self.sessions.write().await.clear();
        self.response_channels.lock().await.clear();
        self.quic_client = None;

        println!("🔌 Disconnected");
        Ok(())
    }

    /// 是否已连接
    #[allow(dead_code)]
    pub fn is_connected(&self) -> bool {
        self.connected
    }

    /// 获取远程节点 ID
    #[allow(dead_code)]
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

    /// 发送消息并等待响应
    async fn send_and_wait(&self, message: Message) -> Result<Message> {
        let message_id = message.id.clone();

        // 创建响应通道
        let (tx, rx) = oneshot::channel();
        {
            let mut channels = self.response_channels.lock().await;
            channels.insert(message_id.clone(), tx);
        }

        // 发送消息
        self.send_quic_message(message).await?;

        // 等待响应（带超时）
        match tokio::time::timeout(self.config.timeout, rx).await {
            Ok(Ok(response)) => Ok(response),
            Ok(Err(_)) => Err(anyhow::anyhow!("Response channel closed")),
            Err(_) => {
                // 超时，清理通道
                let mut channels = self.response_channels.lock().await;
                channels.remove(&message_id);
                Err(anyhow::anyhow!("Response timeout"))
            }
        }
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
        )
        .requires_response();

        // 通过 P2P 发送并等待响应
        let response_msg = self.send_and_wait(message).await?;

        // 解析响应消息
        if let MessagePayload::Response(response) = response_msg.payload {
            if !response.success {
                return Err(anyhow::anyhow!(
                    "ListSessions failed: {}",
                    response
                        .message
                        .unwrap_or_else(|| "Unknown error".to_string())
                ));
            }

            // 如果响应中有数据，解析会话列表
            if let Some(data) = response.data {
                // 响应数据应该是 JSON 数组格式的会话列表
                // 但会话主要是通过 Register 消息异步更新的
                debug!("ListSessions response: {}", data);
            }
        }

        // 返回本地缓存的会话列表（通过 Register 消息更新）
        Ok(self.sessions.read().await.clone())
    }

    /// 发送消息到指定的 AI Agent 会话
    pub async fn send_message(&self, session_id: &str, content: &str) -> Result<String> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        debug!("💬 Sending message to session: {}", session_id);

        let request_id = uuid::Uuid::new_v4().to_string();

        let message = Message::new(
            MessageType::AgentControl,
            "client".to_string(),
            MessagePayload::AgentControl(AgentControlMessage {
                session_id: session_id.to_string(),
                action: AgentControlAction::SendInput {
                    content: content.to_string(),
                },
                request_id: Some(request_id.clone()),
            }),
        )
        .requires_response();

        // 通过 P2P 发送消息
        self.send_quic_message(message).await?;

        info!("💬 Message sent (request_id: {})", request_id);
        Ok(request_id)
    }

    /// 启动新的 AI Agent 会话（远程生成）
    pub async fn spawn_session(
        &mut self,
        agent_type: &str,
        project_path: &str,
        args: &[String],
    ) -> Result<AgentSessionInfo> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        info!("🚀 Spawning new {} session", agent_type);

        // 解析 agent 类型
        let agent_type_enum = match agent_type.to_lowercase().as_str() {
            "claude" | "claudecode" => AgentType::ClaudeCode,
            "opencode" => AgentType::OpenCode,
            "gemini" => AgentType::Gemini,
            _ => AgentType::Custom,
        };

        // 构建远程生成消息
        // Generate a session ID for this spawn request
        let session_id = uuid::Uuid::new_v4().to_string();

        let message = Message::new(
            MessageType::RemoteSpawn,
            "client".to_string(),
            MessagePayload::RemoteSpawn(RemoteSpawnMessage {
                action: RemoteSpawnAction::SpawnSession {
                    session_id: session_id.clone(),
                    agent_type: agent_type_enum,
                    project_path: project_path.to_string(),
                    args: args.to_vec(),
                },
                request_id: Some(uuid::Uuid::new_v4().to_string()),
            }),
        )
        .requires_response();

        // 通过 P2P 发送并等待响应
        let response_msg = self.send_and_wait(message).await?;

        // 解析响应消息
        if let MessagePayload::Response(response) = response_msg.payload {
            if !response.success {
                return Err(anyhow::anyhow!(
                    "SpawnSession failed: {}",
                    response
                        .message
                        .unwrap_or_else(|| "Unknown error".to_string())
                ));
            }

            // 响应数据应包含新会话的信息
            if let Some(data) = response.data {
                debug!("SpawnSession response: {}", data);

                // 解析 JSON 响应获取 session_id
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                    if let Some(session_id) = json.get("session_id").and_then(|v| v.as_str()) {
                        let session_info = AgentSessionInfo {
                            session_id: session_id.to_string(),
                            agent_type: agent_type.to_string(),
                            project_path: project_path.to_string(),
                            started_at: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)?
                                .as_secs(),
                            active: true,
                        };
                        info!("✅ Session spawned: {}", session_info.session_id);
                        return Ok(session_info);
                    }
                }
            }
        }

        // 如果没有收到 session_id，等待会话注册消息
        // 给一些时间让 Register 消息到达
        tokio::time::sleep(Duration::from_millis(500)).await;

        // 尝试从缓存中找到新创建的会话
        let sessions = self.sessions.read().await;
        for session in sessions.iter() {
            if session.project_path == project_path
                && session.agent_type.to_lowercase() == agent_type.to_lowercase()
            {
                info!("✅ Session spawned (from cache): {}", session.session_id);
                return Ok(session.clone());
            }
        }

        Err(anyhow::anyhow!(
            "Failed to spawn session or receive session registration"
        ))
    }

    /// 获取会话元数据
    pub async fn get_session_metadata(&self, session_id: &str) -> Result<AgentSessionInfo> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        debug!("📊 Fetching metadata for session: {}", session_id);

        // 检查本地缓存
        let sessions = self.sessions.read().await;
        for session in sessions.iter() {
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
        permission_id: &str,
        approved: bool,
    ) -> Result<()> {
        if !self.connected {
            return Err(anyhow::anyhow!("Not connected"));
        }

        info!(
            "📝 Responding to permission: {} -> {}",
            permission_id, approved
        );

        // 确定权限模式
        let permission_mode = if approved {
            PermissionMode::ApproveForSession
        } else {
            PermissionMode::Deny
        };

        // 构建权限响应消息
        let response = AgentPermissionResponse {
            request_id: permission_id.to_string(),
            approved,
            permission_mode,
            decided_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
            reason: if !approved {
                Some("User denied the request".to_string())
            } else {
                None
            },
        };

        let message = Message::new(
            MessageType::AgentPermission,
            "client".to_string(),
            MessagePayload::AgentPermission(AgentPermissionMessage {
                inner: AgentPermissionMessageInner::Response(response),
            }),
        )
        .requires_response();

        // 通过 P2P 发送权限响应
        self.send_quic_message(message).await?;

        info!("✅ Permission response sent");
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
            client_key_path: Some(std::env::current_dir().unwrap().join(".riterm_client_key")),
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
    #[allow(dead_code)]
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
        println!("  /approve   - Approve a permission request");
        println!("  /deny      - Deny a permission request");
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
                    Ok(_request_id) => {
                        // 响应会通过消息接收器异步处理
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to send message: {}", e);
                    }
                }
            } else {
                println!(
                    "⚠️  No active session. Use /spawn to create one or /list to see available sessions."
                );
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
                        println!(
                            "   {}. {} ({})",
                            i + 1,
                            session.session_id,
                            session.agent_type
                        );
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

                match self
                    .client
                    .spawn_session(agent_type, project_path, &args)
                    .await
                {
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
                    self.client
                        .control_session(session_id, SessionControlAction::Pause)
                        .await?;
                    println!("⏸️  Session paused");
                } else {
                    println!("⚠️  No active session");
                }
            }
            "/resume" => {
                if let Some(session_id) = &self.current_session_id {
                    self.client
                        .control_session(session_id, SessionControlAction::Resume)
                        .await?;
                    println!("▶️  Session resumed");
                } else {
                    println!("⚠️  No active session");
                }
            }
            "/stop" => {
                if let Some(session_id) = &self.current_session_id.clone() {
                    self.client
                        .control_session(session_id, SessionControlAction::Stop)
                        .await?;
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
                        let current =
                            if self.current_session_id.as_ref() == Some(&session.session_id) {
                                " (current)"
                            } else {
                                ""
                            };
                        println!(
                            "  {}. {}{} - {}",
                            i + 1,
                            session.session_id,
                            current,
                            session.agent_type
                        );
                        println!("      📁 {}", session.project_path);
                    }
                }
            }
            "/approve" => {
                if parts.len() < 2 {
                    println!("Usage: /approve <request_id>");
                    return Ok(());
                }
                let request_id = parts[1];
                let session_id = self.current_session_id.as_deref().unwrap_or("");
                match self
                    .client
                    .respond_to_permission(session_id, request_id, true)
                    .await
                {
                    Ok(_) => println!("✅ Permission approved"),
                    Err(e) => eprintln!("❌ Failed to approve permission: {}", e),
                }
            }
            "/deny" => {
                if parts.len() < 2 {
                    println!("Usage: /deny <request_id>");
                    return Ok(());
                }
                let request_id = parts[1];
                let session_id = self.current_session_id.as_deref().unwrap_or("");
                match self
                    .client
                    .respond_to_permission(session_id, request_id, false)
                    .await
                {
                    Ok(_) => println!("❌ Permission denied"),
                    Err(e) => eprintln!("❌ Failed to deny permission: {}", e),
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
