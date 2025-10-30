use anyhow::{Context, Result};
use clap::Parser;
use std::sync::Arc;
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

        // Phase 2: Configure TerminalManager with direct P2P integration
        // This removes the callback chain: Runner -> Manager -> CLI -> Network
        // New simplified flow: Runner -> Manager -> Network (direct)
        self.terminal_manager = self.terminal_manager.clone().with_network(
            Arc::new(self.network.clone()),
            header.session_id.clone(),
            gossip_sender_for_responses.clone(),
        );

        // 设置终端管理消息处理器
        let terminal_manager = self.terminal_manager.clone();

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

        // Note: The terminal_input_callback in P2PNetwork will handle terminal commands
        // Output is sent directly through TerminalManager -> P2PNetwork (no callback chain)

        // Keep the connection alive
        let _input_receiver = input_receiver; // Keep receiver to prevent channel close
        let _gossip_sender = gossip_sender_for_responses; // Keep sender alive

        // Host runs until user interrupts
        println!("✅ Terminal host is running. Press Ctrl+C to stop.");
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
