use anyhow::{Context, Result};
use clap::Parser;
use tokio::sync::mpsc;
use tracing::{debug, error, info};
use std::sync::Arc;

use crate::terminal_manager::TerminalManager;
use riterm_shared::{P2PNetwork, p2p::*};

#[derive(Parser)]
#[command(name = "riterm")]
#[command(about = "A terminal host for remote P2P management")]
pub struct Cli {
    #[arg(
        long,
        help = "Custom relay server URL (e.g., https://relay.example.com)"
    )]
    pub relay: Option<String>,

    #[arg(long, help = "Authentication token for ticket submission")]
    pub auth: Option<String>,
}

pub struct CliApp {
    network: P2PNetwork,
    terminal_manager: TerminalManager,
    tcp_forward_manager: Option<riterm_shared::TcpForwardManager>,
    message_router: Arc<MessageRouter>,
}

impl CliApp {
    pub async fn new(relay: Option<String>) -> Result<Self> {
        let network = P2PNetwork::new(relay)
            .await
            .context("Failed to initialize P2P network")?;

        let terminal_manager = TerminalManager::new();
        let message_router = Arc::new(MessageRouter::new());

        Ok(Self {
            network,
            terminal_manager,
            tcp_forward_manager: None,
            message_router,
        })
    }

    pub async fn run(&mut self, _cli: Cli) -> Result<()> {
        // 注册消息处理器
        self.setup_message_handlers().await?;

        // 设置TCP转发消息处理器
        self.setup_tcp_forward_message_handler().await?;

        // 设置文件传输消息处理器
        self.setup_file_transfer_message_handler().await?;

        self.start_terminal_host().await
    }

    /// 设置所有消息处理器
    async fn setup_message_handlers(&mut self) -> Result<()> {
        // 注册终端消息处理器
        let terminal_handler = Arc::new(CliTerminalMessageHandler::new(
            self.terminal_manager.clone(),
            self.network.clone(),
        ));
        self.message_router.register_handler(terminal_handler).await;

        // 注册端口转发处理器
        let port_forward_handler = Arc::new(CliPortForwardMessageHandler::new(
            self.network.clone(),
        ));
        self.message_router.register_handler(port_forward_handler).await;

        // 注册文件传输处理器
        let file_transfer_handler = Arc::new(CliFileTransferMessageHandler::new(
            self.terminal_manager.clone(),
        ));
        self.message_router.register_handler(file_transfer_handler).await;

        info!("All message handlers registered successfully");
        Ok(())
    }

    /// 启动终端主机模式 - 创建P2P会话并管理本地终端
    async fn start_terminal_host(&mut self) -> Result<()> {
        use riterm_shared::SessionHeader;
        use tracing::info;

        println!("🚀 Starting Terminal Host Mode...");
        println!("📡 Creating P2P session...");

        // 创建会话头信息
        let header = SessionHeader {
            version: 2,
            width: 80,
            height: 24,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            title: Some("Riterm Terminal Host".to_string()),
            command: None,
            session_id: format!("host_{}", uuid::Uuid::new_v4()),
        };

        // 创建共享会话
        let (topic_id, sender, input_receiver) = self
            .network
            .create_shared_session(header.clone())
            .await
            .context("Failed to create shared session")?;

        println!("✅ P2P session created successfully");
        println!("🎫 Generating session ticket...");

        // 创建会话票据
        let ticket = self
            .network
            .create_session_ticket(topic_id, &header.session_id)
            .await
            .context("Failed to create session ticket")?;

        println!("✅ Session ticket generated successfully");
        println!();
        println!("📊 Host Status:");
        println!("   🔗 Node ID: {}", &self.network.get_node_id().to_string()[..16]);
        println!("   📡 Session ID: {}", header.session_id);
        println!("   🛠️  Local terminal management capabilities enabled");
        println!();

        // 显示ticket信息
        println!("🎫 === SESSION TICKET ===");
        println!("{}", ticket);
        println!("========================");
        println!();
        println!("💡 Share this ticket with remote users to allow them to connect");
        println!("💡 Remote users can scan the QR code or copy the ticket text");
        println!("⚠️  Press Ctrl+C to stop the host");

        // 设置终端输入处理器回调
        let terminal_manager_for_input = self.terminal_manager.clone();
        let session_id_for_input = header.session_id.clone();
        let network_for_input = self.network.clone();

        // 创建终端输入处理器回调
        let input_processor =
            move |terminal_id: String,
                  data: String|
                  -> tokio::task::JoinHandle<anyhow::Result<Option<String>>> {
                let terminal_manager = terminal_manager_for_input.clone();
                let _session_id = session_id_for_input.clone();
                let _network = network_for_input.clone();

                tokio::spawn(async move {
                    info!(
                        "🔥 RECEIVED TERMINAL INPUT: terminal_id={}, data='{}'",
                        terminal_id, data
                    );

                    // 将输入发送到实际的终端会话
                    let data_clone = data.clone();
                    if let Err(e) = terminal_manager
                        .send_input(&terminal_id, data.into_bytes())
                        .await
                    {
                        error!("Failed to send input to terminal {}: {}", terminal_id, e);
                        return Ok(None);
                    }

                    info!(
                        "✅ Successfully sent input '{}' to terminal {}",
                        data_clone, terminal_id
                    );

                    // 这里暂时返回 None，实际的输出将由终端会话通过其他方式发送
                    // 未来可以在这里等待终端的输出响应
                    info!(
                        "⏭️ Terminal input callback returning None (output will be sent via callback chain)"
                    );
                    Ok(None)
                })
            };

        // 设置终端输入处理回调
        self.network
            .set_terminal_input_callback(input_processor)
            .await;

        // 保存gossip sender的引用用于后续发送响应
        let gossip_sender_for_responses = sender.clone();

        // 设置终端输出处理器回调
        let _terminal_manager_for_output = self.terminal_manager.clone();
        let session_id_for_output = header.session_id.clone();
        let network_for_output = self.network.clone();
        let _gossip_sender_for_output = gossip_sender_for_responses.clone();

        // 创建终端输出处理器回调
        let output_processor = move |terminal_id: String, data: String| {
            let session_id = session_id_for_output.clone();
            let network = network_for_output.clone();
            let _gossip_sender = _gossip_sender_for_output.clone();

            info!(
                "🔥 RECEIVED TERMINAL OUTPUT: terminal_id={}, data='{}'",
                terminal_id, data
            );

            tokio::spawn(async move {
                // 创建新的结构化终端输出消息
                let terminal_message = MessageFactory::terminal_output(
                    network.local_node_id(),
                    terminal_id.clone(),
                    data.clone(),
                );

                // 发送终端输出
                if let Err(e) = network
                    .send_message_to_session(&session_id, terminal_message)
                    .await
                {
                    error!("Failed to send terminal output to P2P network: {}", e);
                } else {
                    info!(
                        "✅ Successfully sent terminal output from {} to P2P network: '{}'",
                        terminal_id, data
                    );
                }
            });
        };

        // 设置终端输出处理回调
        self.terminal_manager
            .set_output_callback(output_processor)
            .await;

        // 设置终端管理消息处理器
        let terminal_manager = self.terminal_manager.clone();
        let _network_for_terminal = self.network.clone();

        // 创建一个默认终端用于测试
        let terminal_manager_task = terminal_manager.clone();
        let session_id_terminal = header.session_id.clone();
        tokio::spawn(async move {
            info!(
                "Creating default terminal for session: {}",
                session_id_terminal
            );

            if let Ok(terminal_id) = terminal_manager_task
                .create_terminal(
                    Some("Default Terminal".to_string()),
                    None, // Use system default shell
                    Some(
                        std::env::current_dir()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string(),
                    ),
                    Some((24, 80)),
                )
                .await
            {
                info!("Created default terminal: {}", terminal_id);
            }
        });

        // 设置历史记录回调来处理终端管理请求
        let terminal_manager = self.terminal_manager.clone();
        let _session_id_for_history = header.session_id.clone();
        let _sender_for_history = sender.clone();

        self.network
            .set_history_callback(move |_session_id: &str| {
                let _terminal_manager = terminal_manager.clone();
                let _session_id = _session_id_for_history.clone();
                let _sender = _sender_for_history.clone();

                let (tx, rx) = tokio::sync::oneshot::channel();

                // 在后台任务中处理终端管理请求
                tokio::spawn(async move {
                    // 这里应该获取实际的终端历史记录
                    // 现在先返回空的历史记录用于测试
                    let session_info = riterm_shared::p2p::SessionInfo {
                        logs: String::new(),
                        shell: "bash".to_string(),
                        cwd: std::env::current_dir()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string(),
                    };

                    let _ = tx.send(Some(session_info));
                });

                rx
            })
            .await;

        // 设置事件监听器来处理终端创建事件
        let terminal_manager_for_events = self.terminal_manager.clone();
        let session_id_for_events = header.session_id.clone();
        let network_for_events = self.network.clone();
        let _gossip_sender_for_events = gossip_sender_for_responses.clone();

        tokio::spawn(async move {
            info!(
                "Starting terminal creation event listener for session: {}",
                session_id_for_events
            );

            // 获取事件接收器 - 简化版本，直接创建新的事件接收器
            let session = {
                let sessions = network_for_events.get_active_sessions().await;
                if sessions.contains(&session_id_for_events) {
                    // 重新获取事件接收器
                    network_for_events
                        .create_event_receiver(&session_id_for_events)
                        .await
                } else {
                    info!(
                        "Session {} not found for event listening",
                        session_id_for_events
                    );
                    return;
                }
            };

            if let Some(mut event_receiver) = session {
                while let Ok(event) = event_receiver.recv().await {
                    match event.event_type {
                        riterm_shared::p2p::EventType::Output { data } => {
                            // 检查是否是终端创建请求
                            if data.contains("[Terminal Create Request]") {
                                info!(
                                    "Detected terminal create request in event, creating terminal..."
                                );

                                // 解析事件数据来提取参数 - 使用系统默认 shell
                                let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
                                    // 如果 SHELL 环境变量不存在，使用默认路径
                                    if cfg!(unix) {
                                        "/bin/bash".to_string()
                                    } else {
                                        "cmd.exe".to_string()
                                    }
                                });
                                let working_dir = std::env::current_dir()
                                    .unwrap_or_default()
                                    .to_string_lossy()
                                    .to_string();
                                let size = Some((24, 80));

                                if let Ok(terminal_id) = terminal_manager_for_events
                                    .create_terminal(
                                        None, // name
                                        Some(shell_path),
                                        Some(working_dir),
                                        size,
                                    )
                                    .await
                                {
                                    info!(
                                        "✅ Successfully created terminal {} from event",
                                        terminal_id
                                    );

                                    // 获取终端列表并发送响应给前端
                                    let terminal_list =
                                        terminal_manager_for_events.list_terminals().await;
                                    info!(
                                        "📋 Sending terminal list with {} terminals to frontend",
                                        terminal_list.len()
                                    );

                                    // 创建新的结构化终端列表响应消息
                                    let terminal_list_message = MessageBuilder::new()
                                        .from_node(network_for_events.local_node_id())
                                        .with_domain(MessageDomain::Terminal)
                                        .build(StructuredPayload::TerminalManagement(
                                            TerminalManagementMessage::ListResponse { terminals: terminal_list }
                                        ));

                                    // 发送终端列表响应
                                    if let Err(e) = network_for_events
                                        .send_message_to_session(&session_id_for_events, terminal_list_message)
                                        .await
                                    {
                                        error!("Failed to send terminal list response: {}", e);
                                    } else {
                                        info!("✅ Terminal list response sent successfully");
                                    }
                                } else {
                                    info!("❌ Failed to create terminal from event");
                                }
                            }
                        }
                        _ => {
                            // 其他事件类型暂时忽略
                        }
                    }
                }

                info!("Terminal creation event listener ended");
            } else {
                info!(
                    "No event receiver available for session: {}",
                    session_id_for_events
                );
            }
        });

        // 注意：input_receiver 现在用于接收旧的 Input 消息类型
        // 新的 TerminalInput 消息直接在 P2P 网络层处理
        let _input_receiver = input_receiver; // 保留 receiver 以避免通道关闭

        // 保持主机运行直到用户中断
        tokio::signal::ctrl_c().await?;
        println!("\n👋 Terminal Host stopped");

        Ok(())
    }

    pub fn print_banner() {
        use crossterm::{
            cursor, execute,
            style::{Color, Print, ResetColor, SetForegroundColor},
            terminal::{Clear, ClearType},
        };
        use std::io;

        execute!(
            io::stdout(),
            Clear(ClearType::All),
            cursor::MoveTo(0, 0),
            SetForegroundColor(Color::Blue),
            Print("╭─────────────────────────────────────────────╮\n"),
            Print("│         🖥️  Riterm Terminal Manager            │\n"),
            Print("│     P2P Remote Terminal Management          │\n"),
            Print("╰─────────────────────────────────────────────╯\n"),
            ResetColor,
            Print("\n")
        )
        .ok();
    }

    /// 启动 TCP 转发模式 (like dumbpipe listen-tcp)
    async fn start_tcp_forward(
        &mut self,
        local_port: u16,
        remote_port: u16,
        service_name: String,
    ) -> Result<()> {
        use riterm_shared::SessionHeader;

        println!("🌐 Starting TCP Forward Mode...");
        println!("📡 Local port: {}", local_port);
        println!("🔌 Remote port: {}", remote_port);
        println!("🏷️  Service: {}", service_name);

        // Create P2P session for TCP forwarding
        let header = SessionHeader {
            version: 2,
            width: 80,
            height: 24,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
            title: Some(format!("TCP Forward: {} -> {}", local_port, remote_port)),
            command: None,
            session_id: format!("tcp_forward_{}_{}", local_port, remote_port),
        };

        let (ticket, _connection_sender, mut _event_receiver) = self
            .network
            .create_shared_session(header.clone())
            .await
            .context("Failed to create TCP forwarding session")?;

        println!("\n✅ TCP Forward Session Created!");
        println!("🎫 Share this ticket with the client:");
        println!("📋 {}", ticket);

        // Create TCP forward manager
        let config = riterm_shared::TcpForwardConfig {
            node_id: self.network.local_node_id(),
            service_id: format!("tcp_{}_{}", local_port, remote_port),
            local_port,
            remote_port,
            service_name: service_name.clone(),
            session_id: header.session_id.clone(),
            network_sender: _connection_sender.clone(),
        };

        let tcp_manager = riterm_shared::TcpForwardManager::new(config);

        // Start TCP forwarding
        tcp_manager
            .start()
            .await
            .context("Failed to start TCP forwarding")?;

        self.tcp_forward_manager = Some(tcp_manager);

        // Keep the session alive
        println!("🔄 TCP forwarding is active... Press Ctrl+C to stop");

        // Handle shutdown signal
        tokio::signal::ctrl_c().await?;
        println!("\n🛑 Shutting down TCP forwarding...");

        if let Some(manager) = self.tcp_forward_manager.take() {
            manager.stop().await?;
        }

        Ok(())
    }

    /// 设置TCP转发消息处理器
    async fn setup_tcp_forward_message_handler(&mut self) -> Result<()> {
        let network = self.network.clone();
        let mut message_receiver = network
            .get_message_receiver()
            .await
            .context("Failed to get message receiver")?;

        // 启动TCP转发消息处理任务
        tokio::spawn(async move {
            info!("TCP forward message handler started");

            while let Some(message) = message_receiver.recv().await {
                match message {
                    NetworkMessage::Structured { payload: StructuredPayload::PortForward(PortForwardMessage::Create {
                        service_id,
                        local_port,
                        remote_port,
                        service_type: _,
                        service_name,
                        terminal_id: _,
                        metadata,
                    }), .. } => {
                        let session_id = metadata
                            .as_ref()
                            .and_then(|m| m.get("session_id"))
                            .cloned()
                            .unwrap_or_else(|| service_id.clone());
                        info!(
                            "Received TCP forward create request: {}:{:?}:{} for session {}",
                            local_port, remote_port, service_name, session_id
                        );

                        // 创建TCP转发配置
                        let (tcp_sender, tcp_receiver) = mpsc::unbounded_channel();
                        let config = riterm_shared::TcpForwardConfig {
                            node_id: network.local_node_id(),
                            service_id: service_id.clone(),
                            local_port,
                            remote_port: remote_port.unwrap_or(0), // Use 0 if not specified
                            service_name: service_name.clone(),
                            session_id: session_id.clone(),
                            network_sender: tcp_sender,
                        };

                        // 启动TCP转发管理器
                        let tcp_manager = riterm_shared::TcpForwardManager::new(config);
                        if let Err(e) = tcp_manager.start().await {
                            error!("Failed to start TCP forwarding for {}: {}", service_name, e);
                            continue;
                        }

                        info!(
                            "TCP forwarding started for {} ({} -> {:?})",
                            service_name, local_port, remote_port
                        );

                        // 启动消息转发任务
                        let network_clone = network.clone();
                        let session_id_clone = session_id.clone();
                        tokio::spawn(async move {
                            Self::handle_tcp_forward_messages(
                                network_clone,
                                session_id_clone,
                                tcp_manager,
                                tcp_receiver,
                            )
                            .await;
                        });
                    }
                    _ => {
                        // 其他消息类型暂时忽略
                    }
                }
            }

            info!("TCP forward message handler ended");
        });

        Ok(())
    }

    /// 处理TCP转发的消息
    async fn handle_tcp_forward_messages(
        _network: P2PNetwork,
        session_id: String,
        tcp_manager: riterm_shared::TcpForwardManager,
        mut message_receiver: mpsc::UnboundedReceiver<NetworkMessage>,
    ) {
        info!(
            "Starting TCP forward message handler for session: {}",
            session_id
        );

        while let Some(message) = message_receiver.recv().await {
            match message {
                NetworkMessage::Structured { payload: StructuredPayload::PortForward(PortForwardMessage::Data {
                    service_id,
                    data,
                }), .. } if service_id == session_id => {
                    // 将接收到的数据转发到本地TCP连接
                    if let Err(e) = tcp_manager.forward_data(&data).await {
                        error!("Failed to forward TCP data: {}", e);
                    }
                }
                NetworkMessage::Structured { payload: StructuredPayload::PortForward(PortForwardMessage::Stopped {
                    service_id,
                    reason,
                }), .. } if service_id == session_id => {
                    info!("TCP forward stopped for session: {}", session_id);
                    if let Some(reason) = reason {
                        info!("Stop reason: {}", reason);
                    }
                    if let Err(e) = tcp_manager.stop().await {
                        error!("Failed to stop TCP forwarding: {}", e);
                    }
                    break;
                }
                _ => {
                    // 其他消息类型忽略
                }
            }
        }

        info!(
            "TCP forward message handler ended for session: {}",
            session_id
        );
    }

    /// 设置文件传输消息处理器
    async fn setup_file_transfer_message_handler(&mut self) -> Result<()> {
        let network = self.network.clone();
        let terminal_manager = self.terminal_manager.clone();
        let mut message_receiver = network
            .get_message_receiver()
            .await
            .context("Failed to get message receiver for file transfer")?;

        // 启动文件传输消息处理任务
        tokio::spawn(async move {
            info!("File transfer message handler started");

            while let Some(message) = message_receiver.recv().await {
                match message {
                    NetworkMessage::Structured { payload: StructuredPayload::FileTransfer(FileTransferMessage::Start {
                        terminal_id,
                        file_name,
                        file_size,
                        chunk_count: _,
                        mime_type: _,
                    }), .. } => {
                        info!(
                            "Received file transfer start: {} for terminal {} ({} bytes)",
                            file_name,
                            terminal_id,
                            file_size
                        );

                        // For now, we'll handle the old way - in the new architecture,
                        // file data should come through Chunk messages
                        // This is a placeholder for the chunked transfer implementation

                        // Get the terminal's current working directory
                        let current_dir =
                            match terminal_manager.get_terminal_info(&terminal_id).await {
                                Some(terminal_info) => {
                                    std::path::PathBuf::from(&terminal_info.current_dir)
                                }
                                None => {
                                    info!(
                                        "Terminal {} not found, using default directory",
                                        terminal_id
                                    );
                                    std::env::current_dir()
                                        .unwrap_or_else(|_| std::path::PathBuf::from("/"))
                                }
                            };

                        let file_path = current_dir.join(&file_name);
                        info!("File will be saved to: {}", file_path.display());

                        // In the new architecture, we should wait for Chunk messages
                        // For now, we'll log that we're ready to receive file chunks
                        info!("Ready to receive file chunks for: {}", file_name);
                    }
                    NetworkMessage::Structured { payload: StructuredPayload::FileTransfer(FileTransferMessage::Chunk {
                        terminal_id,
                        file_name,
                        chunk_index,
                        chunk_data,
                        is_last,
                    }), .. } => {
                        info!(
                            "Received file chunk {}/{} for {} ({} bytes)",
                            chunk_index,
                            "unknown", // We don't have total chunks yet
                            file_name,
                            chunk_data.len()
                        );

                        // Get the terminal's current working directory
                        let current_dir =
                            match terminal_manager.get_terminal_info(&terminal_id).await {
                                Some(terminal_info) => {
                                    std::path::PathBuf::from(&terminal_info.current_dir)
                                }
                                None => {
                                    std::env::current_dir()
                                        .unwrap_or_else(|_| std::path::PathBuf::from("/"))
                                }
                            };

                        let file_path = current_dir.join(&file_name);

                        // For now, we'll just append or create the file
                        // In a full implementation, we should handle chunk ordering and reassembly
                        if chunk_index == 0 {
                            // First chunk - create or overwrite the file
                            if let Err(e) = tokio::fs::write(&file_path, &chunk_data).await {
                                error!("Failed to save first chunk of file {}: {}", file_name, e);
                            } else {
                                info!("Saved first chunk of file: {}", file_name);
                            }
                        } else {
                            // Subsequent chunks - append to file
                            if let Err(e) = tokio::fs::write(&file_path, &chunk_data).await {
                                error!("Failed to save chunk {} of file {}: {}", chunk_index, file_name, e);
                            } else {
                                info!("Saved chunk {} of file: {}", chunk_index, file_name);
                            }
                        }

                        if is_last {
                            info!("✅ File transfer completed: {} -> {}", file_name, file_path.display());
                        }
                    }
                    NetworkMessage::Structured { payload: StructuredPayload::FileTransfer(FileTransferMessage::Complete {
                        terminal_id: _,
                        file_name,
                        file_path,
                        file_hash,
                    }), .. } => {
                        info!(
                            "✅ File transfer completion confirmed: {} -> {}",
                            file_name, file_path
                        );
                        if let Some(hash) = file_hash {
                            info!("File hash: {}", hash);
                        }
                    }
                    NetworkMessage::Structured { payload: StructuredPayload::FileTransfer(FileTransferMessage::Error {
                        terminal_id: _,
                        file_name,
                        error_message,
                        error_code,
                    }), .. } => {
                        error!(
                            "❌ File transfer error for {}: {} (code: {:?})",
                            file_name, error_message, error_code
                        );
                    }
                      _ => {
                        // Other message types are handled by different handlers
                    }
                }
            }

            info!("File transfer message handler ended");
        });

        Ok(())
    }
}

// === Message Handler Implementations ===

/// CLI Terminal Message Handler
pub struct CliTerminalMessageHandler {
    terminal_manager: TerminalManager,
    network: P2PNetwork,
}

impl CliTerminalMessageHandler {
    pub fn new(terminal_manager: TerminalManager, network: P2PNetwork) -> Self {
        Self {
            terminal_manager,
            network,
        }
    }
}

impl MessageHandler for CliTerminalMessageHandler {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            match message {
                NetworkMessage::Structured { payload, .. } => {
                    match payload {
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::Create {
                            name: _,
                            shell_path: _,
                            working_dir: _,
                            size: _,
                        }) => {
                            info!("Creating terminal from structured message");
                            // This would be handled by the existing terminal creation logic
                        }
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::Input {
                            terminal_id: _,
                            data: _,
                        }) => {
                            info!("Handling terminal input from structured message");
                            // This would be handled by the existing terminal input logic
                        }
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::Resize {
                            terminal_id,
                            rows,
                            cols,
                        }) => {
                            info!("Resizing terminal {} to {}x{}", terminal_id, rows, cols);
                            if let Err(e) = self.terminal_manager.resize_terminal(&terminal_id, rows, cols).await {
                                error!("Failed to resize terminal {}: {}", terminal_id, e);
                            }
                        }
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::Stop {
                            terminal_id,
                        }) => {
                            info!("Stopping terminal {}", terminal_id);
                            if let Err(e) = self.terminal_manager.close_terminal(&terminal_id).await {
                                error!("Failed to stop terminal {}: {}", terminal_id, e);
                            }
                        }
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::ListRequest) => {
                            info!("Handling terminal list request");
                            // This would be handled by the existing terminal list logic
                        }
                        _ => {
                            debug!("Ignoring terminal message type in CLI handler");
                        }
                    }
                }
              }
            Ok(())
        })
    }

    fn domain(&self) -> MessageDomain {
        MessageDomain::Terminal
    }
}

/// CLI Port Forward Message Handler
pub struct CliPortForwardMessageHandler {
    network: P2PNetwork,
}

impl CliPortForwardMessageHandler {
    pub fn new(network: P2PNetwork) -> Self {
        Self { network }
    }
}

impl MessageHandler for CliPortForwardMessageHandler {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            match message {
                NetworkMessage::Structured { payload, .. } => {
                    match payload {
                        StructuredPayload::PortForward(PortForwardMessage::Create {
                            service_id: _,
                            local_port: _,
                            remote_port: _,
                            service_type,
                            service_name,
                            terminal_id: _,
                            metadata: _,
                        }) => {
                            info!("Creating port forwarding service: {} ({})", service_name, service_type);
                            // This would be handled by the existing port forwarding logic
                        }
                        StructuredPayload::PortForward(PortForwardMessage::Connected {
                            service_id: _,
                            assigned_remote_port,
                            access_url,
                        }) => {
                            info!("Port forwarding service connected on port {}", assigned_remote_port);
                            if let Some(url) = access_url {
                                info!("Access URL: {}", url);
                            }
                        }
                        StructuredPayload::PortForward(PortForwardMessage::StatusUpdate {
                            service_id: _,
                            status,
                        }) => {
                            info!("Port forwarding service status: {:?}", status);
                        }
                        StructuredPayload::PortForward(PortForwardMessage::Stopped {
                            service_id: _,
                            reason,
                        }) => {
                            info!("Port forwarding service stopped");
                            if let Some(reason) = reason {
                                info!("Stop reason: {}", reason);
                            }
                        }
                        _ => {
                            debug!("Ignoring port forward message type in CLI handler");
                        }
                    }
                }
                }
            Ok(())
        })
    }

    fn domain(&self) -> MessageDomain {
        MessageDomain::PortForward
    }
}

/// CLI File Transfer Message Handler
pub struct CliFileTransferMessageHandler {
    terminal_manager: TerminalManager,
}

impl CliFileTransferMessageHandler {
    pub fn new(terminal_manager: TerminalManager) -> Self {
        Self { terminal_manager }
    }
}

impl MessageHandler for CliFileTransferMessageHandler {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async move {
            match message {
                NetworkMessage::Structured { payload, .. } => {
                    match payload {
                        StructuredPayload::FileTransfer(FileTransferMessage::Start {
                            terminal_id: _,
                            file_name,
                            file_size,
                            chunk_count: _,
                            mime_type: _,
                        }) => {
                            info!("File transfer started: {} ({} bytes)", file_name, file_size);
                        }
                        StructuredPayload::FileTransfer(FileTransferMessage::Progress {
                            terminal_id: _,
                            file_name,
                            bytes_transferred,
                            total_bytes,
                        }) => {
                            info!("File transfer progress: {} - {}/{} bytes ({}%)",
                                file_name, bytes_transferred, total_bytes,
                                (bytes_transferred * 100 / total_bytes.max(1))
                            );
                        }
                        StructuredPayload::FileTransfer(FileTransferMessage::Complete {
                            terminal_id: _,
                            file_name,
                            file_path,
                            file_hash,
                        }) => {
                            info!("File transfer completed: {} -> {}", file_name, file_path);
                            if let Some(hash) = file_hash {
                                info!("File hash: {}", hash);
                            }
                        }
                        StructuredPayload::FileTransfer(FileTransferMessage::Error {
                            terminal_id: _,
                            file_name,
                            error_message,
                            error_code,
                        }) => {
                            error!("File transfer error: {} - {} (code: {:?})", file_name, error_message, error_code);
                        }
                        _ => {
                            debug!("Ignoring file transfer message type in CLI handler");
                        }
                    }
                }
              }
            Ok(())
        })
    }

    fn domain(&self) -> MessageDomain {
        MessageDomain::FileTransfer
    }
}
