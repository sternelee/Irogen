use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use crate::host::HostSession;
use crate::p2p::P2PNetwork;
use crate::shared_terminal::{TerminalSessionManager, SharedTerminalSession, TerminalSessionState};
use crate::shell_manager::ShellManager;

#[derive(Parser)]
#[command(name = "iroh-code-remote")]
#[command(about = "A terminal session sharing tool powered by iroh p2p network")]
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
    #[command(about = "Start a new shared terminal session (sshx-style)")]
    Host {
        #[arg(long, help = "Shell to use (bash, zsh, fish, nu, pwsh, etc.)")]
        shell: Option<String>,

        #[arg(short, long)]
        title: Option<String>,

        #[arg(long, default_value_t = 80)]
        width: u16,

        #[arg(long, default_value_t = 24)]
        height: u16,

        #[arg(short, long)]
        save: Option<String>,

        #[arg(long, help = "Enable passthrough mode (like asciinema)")]
        passthrough: bool,

        #[arg(long, help = "List available shells and exit")]
        list_shells: bool,
        
        #[arg(long, help = "Enable read-only access mode")]
        enable_readers: bool,
        
        #[arg(long, help = "Session name (defaults to user@hostname)")]
        name: Option<String>,
        
        #[arg(long, help = "Quiet mode, only output session ticket")]
        quiet: bool,
    },
    
    #[command(about = "Join an existing shared session")]
    Join {
        #[arg(help = "Session ticket to join")]
        ticket: String,
        
        #[arg(long, help = "Join as read-only observer")]
        read_only: bool,
    },
    
    #[command(about = "List active sessions")]
    List,
    
    #[command(about = "Clean up old session files")]
    Cleanup {
        #[arg(long, default_value_t = 7, help = "Remove sessions older than N days")]
        days: u64,
    },
}

pub struct CliApp {
    network: P2PNetwork,
    session_manager: TerminalSessionManager,
}

impl CliApp {
    pub async fn new(relay: Option<String>) -> Result<Self> {
        let network = P2PNetwork::new(relay)
            .await
            .context("Failed to initialize P2P network")?;
            
        let session_manager = TerminalSessionManager::new(std::sync::Arc::new(network.clone()));

        Ok(Self { network, session_manager })
    }

    pub async fn run(&mut self, cli: Cli) -> Result<()> {
        match cli.command {
            Commands::Host {
                shell,
                title,
                width,
                height,
                save,
                passthrough,
                list_shells,
                enable_readers,
                name,
                quiet,
            } => {
                if list_shells {
                    ShellManager::list_available()?;
                    return Ok(());
                }

                // 获取会话名称，类似 sshx 的逻辑
                let session_name = name.unwrap_or_else(|| {
                    let mut name = whoami::username();
                    if let Ok(host) = whoami::fallible::hostname() {
                        let host = host.split('.').next().unwrap_or(&host);
                        name += "@";
                        name += host;
                    }
                    name
                });

                // 创建新的共享终端会话
                let session_id = self.session_manager.create_session(Some(session_name.clone())).await?;
                
                if let Some(session_arc) = self.session_manager.get_session(&session_id).await {
                    let mut session = session_arc.write().await;
                    
                    // 启动会话
                    session.start().await?;
                    
                    // 创建第一个 shell
                    let shell_id = session.create_shell(0, 0).await?;
                    
                    let session_info = session.get_session_info().await;
                    
                    if quiet {
                        // 仅输出会话票据
                        println!("Session ticket will be generated here");
                        // TODO: 实现票据生成逻辑
                    } else {
                        // 显示会话信息
                        self.print_session_info(&session_name, &session_info, enable_readers);
                    }
                    
                    // TODO: 实现实际的终端处理逻辑
                    // 等待 Ctrl+C
                    tokio::signal::ctrl_c().await?;
                    
                    // 清理
                    session.close_shell(shell_id).await?;
                }
                
                Ok(())
            }
            
            Commands::Join { ticket, read_only } => {
                // TODO: 实现加入现有会话的逻辑
                println!("Joining session with ticket: {}", ticket);
                println!("Read-only mode: {}", read_only);
                Ok(())
            }
            
            Commands::List => {
                // 列出活跃会话
                let sessions = self.session_manager.list_sessions().await;
                if sessions.is_empty() {
                    println!("No active sessions found");
                } else {
                    println!("Active sessions:");
                    for (i, session_id) in sessions.iter().enumerate() {
                        println!("  {}: {}", i + 1, session_id);
                    }
                }
                Ok(())
            }
            
            Commands::Cleanup { days } => {
                // TODO: 实现会话清理逻辑
                println!("Cleaning up sessions older than {} days", days);
                Ok(())
            }
        }
    }

    /// Print session information in sshx style
    fn print_session_info(&self, session_name: &str, session_info: &TerminalSessionState, enable_readers: bool) {
        use crossterm::style::{Color, Stylize};
        
        let version = env!("CARGO_PKG_VERSION");
        
        println!();
        println!("  {} {}", "iroh-code-remote".with(Color::Green).bold(), version.with(Color::Green));
        println!();
        
        if enable_readers {
            println!("  {} Read-only link:  {}", "➜".with(Color::Green), "TODO: generate read-only link".with(Color::Cyan).underlined());
            println!("  {} Writable link:   {}", "➜".with(Color::Green), "TODO: generate writable link".with(Color::Cyan).underlined());
        } else {
            println!("  {} Link:  {}", "➜".with(Color::Green), "TODO: generate session link".with(Color::Cyan).underlined());
        }
        
        println!("  {} Session:  {}", "➜".with(Color::Green), session_name.with(Color::Grey));
        println!("  {} Session ID: {}", "➜".with(Color::Green), &session_info.session_id[..8].with(Color::Grey));
        
        if let Some(cwd) = &session_info.current_directory {
            println!("  {} Directory: {}", "➜".with(Color::Green), cwd.clone().with(Color::Grey));
        }
        
        println!();
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
            Print("│           🌐 Iroh Code Remote              │\n"),
            Print("│      P2P Terminal Session Sharing          │\n"),
            Print("╰─────────────────────────────────────────────╯\n"),
            ResetColor,
            Print("\n")
        )
        .ok();
    }
}
