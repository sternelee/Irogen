use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use crate::host::HostSession;
use crate::p2p::P2PNetwork;
use crate::playback::PlaybackSession;
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

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    #[command(about = "Start a new shared terminal session")]
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

        #[arg(long, help = "Share terminal configuration with remote app")]
        share_config: bool,
    },

    #[command(about = "Play back a recorded session")]
    Play {
        #[arg(help = "Path to the session file")]
        file: String,

        #[arg(long, help = "Playback speed multiplier", default_value_t = 1.0)]
        speed: f32,
    },
}

pub struct CliApp {
    network: P2PNetwork,
}

impl CliApp {
    pub async fn new(relay: Option<String>) -> Result<Self> {
        let network = P2PNetwork::new(relay)
            .await
            .context("Failed to initialize P2P network")?;

        Ok(Self { network })
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
                share_config,
            } => {
                if list_shells {
                    ShellManager::list_available()?;
                    return Ok(());
                }

                let mut host_session = HostSession::new(self.network.clone());
                host_session
                    .start(shell, title, width, height, save, passthrough, share_config)
                    .await
            }
            Commands::Play { file, speed } => PlaybackSession::start(file, speed).await,
        }
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
