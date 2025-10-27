use anyhow::{Context, Result};
use clap::Parser;
use tracing::error;

use crate::terminal_manager::TerminalManager;
use riterm_shared::P2PNetwork;

#[derive(Parser)]
#[command(name = "iroh-code-remote")]
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
}

impl CliApp {
    pub async fn new(relay: Option<String>) -> Result<Self> {
        let network = P2PNetwork::new(relay)
            .await
            .context("Failed to initialize P2P network")?;

        let terminal_manager = TerminalManager::new();

        Ok(Self {
            network,
            terminal_manager,
        })
    }

    pub async fn run(&mut self, _cli: Cli) -> Result<()> {
        self.start_terminal_host().await
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
        println!("   🔗 Node ID: {}", &self.network.get_node_id().await[..16]);
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

        // 创建终端输入处理器回调
        let input_processor =
            move |terminal_id: String,
                  data: String|
                  -> tokio::task::JoinHandle<anyhow::Result<Option<String>>> {
                let terminal_manager = terminal_manager_for_input.clone();
                // let session_id = session_id_for_input.clone();
                // let network = network_for_input.clone();

                tokio::spawn(async move {
                    // info!(
                    //     "🔥 RECEIVED TERMINAL INPUT: terminal_id={}, data='{}'",
                    //     terminal_id, data
                    // );

                    // 将输入发送到实际的终端会话
                    // let data_clone = data.clone();
                    if let Err(e) = terminal_manager
                        .send_input(&terminal_id, data.into_bytes())
                        .await
                    {
                        error!("Failed to send input to terminal {}: {}", terminal_id, e);
                        return Ok(None);
                    }

                    // info!(
                    //     "✅ Successfully sent input '{}' to terminal {}",
                    //     data_clone, terminal_id
                    // );

                    // 这里暂时返回 None，实际的输出将由终端会话通过其他方式发送
                    // 未来可以在这里等待终端的输出响应
                    // info!(
                    //     "⏭️ Terminal input callback returning None (output will be sent via callback chain)"
                    // );
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
        // let terminal_manager_for_output = self.terminal_manager.clone();
        let session_id_for_output = header.session_id.clone();
        let network_for_output = self.network.clone();
        let gossip_sender_for_output = gossip_sender_for_responses.clone();

        // 创建终端输出处理器回调
        let output_processor = move |terminal_id: String, data: String| {
            let session_id = session_id_for_output.clone();
            let network = network_for_output.clone();
            let gossip_sender = gossip_sender_for_output.clone();

            // info!(
            //     "🔥 RECEIVED TERMINAL OUTPUT: terminal_id={}, data='{}'",
            //     terminal_id, data
            // );

            tokio::spawn(async move {
                // 使用保存的 gossip sender 发送终端输出
                if let Err(e) = network
                    .send_terminal_output(
                        &session_id,
                        &gossip_sender,
                        terminal_id.clone(),
                        data.clone(),
                    )
                    .await
                {
                    error!("Failed to send terminal output to P2P network: {}", e);
                } else {
                    // info!(
                    //     "✅ Successfully sent terminal output from {} to P2P network: '{}'",
                    //     terminal_id, data
                    // );
                }
            });
        };

        // 设置终端输出处理回调
        self.terminal_manager
            .set_output_callback(output_processor)
            .await;

        // 设置终端管理消息处理器
        let terminal_manager = self.terminal_manager.clone();
        // let network_for_terminal = self.network.clone();

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
        let _terminal_manager = self.terminal_manager.clone();

        self.network
            .set_history_callback(move |_session_id: &str| {
                // let terminal_manager = terminal_manager.clone();
                // let session_id = session_id_for_history.clone();
                // let sender = sender_for_history.clone();

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
        let gossip_sender_for_events = gossip_sender_for_responses.clone();

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
                        riterm_shared::p2p::EventType::Output => {
                            // 检查是否是终端创建请求
                            if event.data.contains("[Terminal Create Request]") {
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

                                    // 直接使用保存的gossip sender发送终端列表响应
                                    if let Err(e) = network_for_events
                                        .send_terminal_list_response(
                                            &session_id_for_events,
                                            &gossip_sender_for_events,
                                            terminal_list,
                                        )
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
}
