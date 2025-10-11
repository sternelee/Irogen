use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use crate::local_terminal_manager::LocalTerminalManager;
use riterm_shared::P2PNetwork;

#[derive(Parser)]
#[command(name = "iroh-code-remote")]
#[command(about = "A terminal agent for remote P2P management")]
pub struct Cli {
    #[arg(
        long,
        help = "Custom relay server URL (e.g., https://relay.example.com)"
    )]
    pub relay: Option<String>,

    #[arg(long, help = "Authentication token for ticket submission")]
    pub auth: Option<String>,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    #[command(about = "Start terminal agent mode to receive remote P2P commands")]
    Agent {
        #[arg(help = "Session ticket to join")]
        ticket: String,
    },
}

pub struct CliApp {
    network: P2PNetwork,
    terminal_manager: LocalTerminalManager,
}

impl CliApp {
    pub async fn new(relay: Option<String>) -> Result<Self> {
        let network = P2PNetwork::new(relay)
            .await
            .context("Failed to initialize P2P network")?;

        let terminal_manager = LocalTerminalManager::new();

        Ok(Self {
            network,
            terminal_manager,
        })
    }

    pub async fn run(&mut self, cli: Cli) -> Result<()> {
        match cli.command {
            Commands::Agent { ticket } => {
                self.start_terminal_agent(ticket).await
            }
        }
    }

    /// 启动终端代理模式 - 接收远程P2P指令来管理本地终端
    async fn start_terminal_agent(&mut self, ticket: String) -> Result<()> {
        use riterm_shared::SessionTicket;
        use std::str::FromStr;
        use tracing::info;

        println!("🚀 Starting Terminal Agent Mode...");
        println!("📋 Parsing session ticket...");

        let session_ticket = SessionTicket::from_str(&ticket)
            .context("Failed to parse session ticket")?;

        println!("✅ Session ticket parsed successfully");
        println!("🌐 Joining remote session...");

        let (sender, event_receiver) = self.network
            .join_session(session_ticket)
            .await
            .context("Failed to join session")?;

        // 设置终端管理器的P2P会话
        let session_id = format!("agent_{}", self.network.get_node_id().await);
        self.terminal_manager.set_p2p_session(
            self.network.clone(),
            session_id.clone(),
            sender.clone()
        ).await;

        println!("✅ Joined session successfully");
        println!("🤖 Terminal Agent is now active and ready to receive remote commands");
        println!();
        println!("📊 Agent Status:");
        println!("   🔗 Node ID: {}", &self.network.get_node_id().await[..16]);
        println!("   📡 Listening for remote terminal management commands...");
        println!("   🛠️  Local terminal management capabilities enabled");
        println!();
        println!("💡 Remote users can now:");
        println!("   • Create terminals on this machine");
        println!("   • Manage terminal sessions");
        println!("   • Create WebShares for local services");
        println!("   • View system statistics");
        println!();
        println!("⚠️  Press Ctrl+C to stop the agent");

        // 启动P2P消息处理器来处理远程指令
        let _network_clone = self.network.clone();
        let _terminal_manager_clone = self.terminal_manager.clone();
        let _session_id_clone = session_id.clone();
        let _sender_clone = sender.clone();

        tokio::spawn(async move {
            let mut receiver = event_receiver;
            while let Ok(event) = receiver.recv().await {
                match event.event_type {
                    riterm_shared::EventType::Output => {
                        // 检查是否为终端管理指令
                        if event.data.starts_with("[Terminal") || event.data.starts_with("[WebShare") || event.data.starts_with("[Stats") {
                            info!("Received potential management command: {}", event.data);
                            // 这些消息会通过P2P消息处理器自动处理
                        }
                    }
                    riterm_shared::EventType::End => {
                        info!("Remote session ended");
                        break;
                    }
                    _ => {}
                }
            }
        });

        // 保持代理运行直到用户中断
        tokio::signal::ctrl_c().await?;
        println!("\n👋 Terminal Agent stopped");

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
            Print("│         🤖 Terminal Agent Mode              │\n"),
            Print("│     P2P Remote Terminal Management          │\n"),
            Print("╰─────────────────────────────────────────────╯\n"),
            ResetColor,
            Print("\n")
        )
        .ok();
    }
}
