use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use crate::commands::{HostCommand, JoinCommand, ListCommand, PlayCommand};
use crate::session::SessionManager;
use crate::ui::DisplayManager;

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
    },

    #[command(about = "Join a session using a ticket")]
    Join {
        #[arg(help = "Session ticket to join")]
        ticket: String,
    },

    #[command(about = "List active sessions")]
    List,

    #[command(about = "Play back a recorded session")]
    Play {
        #[arg(help = "Path to the session file")]
        file: String,
    },
}

/// Main CLI application with separated concerns
pub struct CliApp {
    session_manager: SessionManager,
}

impl CliApp {
    pub async fn new(relay: Option<String>) -> Result<Self> {
        let session_manager = SessionManager::new(relay)
            .await
            .context("Failed to initialize session manager")?;

        Ok(Self { session_manager })
    }

    pub async fn run(self, cli: Cli) -> Result<()> {
        match cli.command {
            Commands::Host {
                shell,
                title,
                width,
                height,
                save,
                passthrough,
                list_shells,
            } => {
                HostCommand::execute(
                    self.session_manager,
                    shell,
                    title,
                    width,
                    height,
                    save,
                    passthrough,
                    list_shells,
                ).await
            }
            Commands::Join { ticket } => {
                JoinCommand::execute(self.session_manager, ticket).await
            }
            Commands::List => {
                ListCommand::execute(&self.session_manager).await
            }
            Commands::Play { file } => {
                PlayCommand::execute(file).await
            }
        }
    }

    pub fn print_banner() {
        DisplayManager::print_banner();
    }

    pub async fn shutdown(self) -> Result<()> {
        self.session_manager.shutdown().await
    }
}