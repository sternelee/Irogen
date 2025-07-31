use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor},
    terminal::{self, Clear, ClearType},
};
use std::io::{self, Write};
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;
use tracing::error;
use uuid::Uuid;

use crate::p2p::{P2PNetwork, ShareMessage};
use crate::terminal::{SessionHeader, TerminalEvent, TerminalRecorder, TerminalPlayer};

#[derive(Parser)]
#[command(name = "iroh-code-remote")]
#[command(about = "A terminal session sharing tool powered by iroh p2p network")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    #[command(about = "Start a new shared terminal session")]
    Host {
        #[arg(short, long, default_value = "bash")]
        command: String,

        #[arg(short, long)]
        title: Option<String>,

        #[arg(long, default_value_t = 80)]
        width: u16,

        #[arg(long, default_value_t = 24)]
        height: u16,

        #[arg(short, long)]
        save: Option<String>,
    },

    #[command(about = "Join an existing shared session")]
    Join {
        #[arg(help = "Session ID to join")]
        session_id: String,

        #[arg(short, long, help = "Node address to connect to (format: node_id@addr:port)")]
        peer: Option<String>,
    },

    #[command(about = "List active sessions")]
    List,

    #[command(about = "Play back a recorded session")]
    Play {
        #[arg(help = "Path to the session file")]
        file: String,
    },
}

pub struct CliApp {
    network: P2PNetwork,
    message_receiver: mpsc::UnboundedReceiver<ShareMessage>,
}

impl CliApp {
    pub async fn new() -> Result<Self> {
        let (network, message_receiver) = P2PNetwork::new().await
            .context("Failed to initialize P2P network")?;

        Ok(Self {
            network,
            message_receiver,
        })
    }

    pub async fn run(&mut self, cli: Cli) -> Result<()> {
        match cli.command {
            Commands::Host { command, title, width, height, save } => {
                self.host_session(command, title, width, height, save).await
            }
            Commands::Join { session_id, peer } => {
                self.join_session(session_id, peer).await
            }
            Commands::List => {
                self.list_sessions().await
            }
            Commands::Play { file } => {
                self.play_session(file).await
            }
        }
    }

    async fn host_session(
        &mut self,
        command: String,
        title: Option<String>,
        width: u16,
        height: u16,
        save_file: Option<String>,
    ) -> Result<()> {
        let session_id = Uuid::new_v4().to_string();

        let header = SessionHeader {
            version: 2,
            width,
            height,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
            title,
            command: Some(command.clone()),
            session_id: session_id.clone(),
        };

        println!("🚀 Starting shared terminal session...");
        println!("📋 Session ID: {}", session_id);
        println!("🌐 Node ID: {}", self.network.get_node_id().await);

        // Display node address for others to connect
        if let Ok(node_addr) = self.network.get_node_addr().await {
            println!("📍 Node Address: {:?}", node_addr);
            println!("💡 Others can join using: iroh-code-remote join {} --peer {:?}", session_id, node_addr);
        }

        println!("💻 Command: {}", command);
        println!("📏 Size: {}x{}", width, height);
        println!();

        let input_receiver = self.network.create_shared_session(header.clone()).await
            .context("Failed to create shared session")?;

        let (recorder, mut event_receiver) = TerminalRecorder::new(session_id.clone());

        let network_clone = self.network.clone();
        let session_id_clone = session_id.clone();
        tokio::spawn(async move {
            while let Some(event) = event_receiver.recv().await {
                if let Err(e) = network_clone.send_terminal_event(session_id_clone.clone(), event).await {
                    error!("Failed to send terminal event: {}", e);
                }
            }
        });

        self.handle_input_forwarding(input_receiver).await;

        self.handle_network_messages().await;

        println!("✅ Starting terminal session. Press Ctrl+C to exit.");
        recorder.start_session(&command, width, height)?;

        tokio::signal::ctrl_c().await?;
        self.network.end_session(session_id.clone()).await?;

        if let Some(save_path) = save_file {
            println!("💾 Saving session to: {}", save_path);
            recorder.save_to_file(&save_path).await?;
            println!("✅ Session saved successfully!");
        }

        println!("\n👋 Session ended.");

        Ok(())
    }

    async fn join_session(&mut self, session_id: String, peer: Option<String>) -> Result<()> {
        println!("🔗 Joining session: {}", session_id);
        println!("🌐 Your Node ID: {}", self.network.get_node_id().await);

        // Connect to peer if specified
        if let Some(peer_addr) = peer {
            println!("📡 Connecting to peer: {}", peer_addr);
            // TODO: Implement peer connection parsing and connection
            // let node_addr: iroh::NodeAddr = peer_addr.parse()
            //     .with_context(|| format!("Invalid peer address format: {}", peer_addr))?;
            //
            // self.network.connect_to_peer(node_addr).await
            //     .context("Failed to connect to peer")?;

            println!("✅ Peer connection feature coming soon");
        }

        let mut event_receiver = self.network.join_session(session_id.clone()).await
            .context("Failed to join session")?;

        let network_clone = self.network.clone();
        let session_id_clone = session_id.clone();
        tokio::spawn(async move {
            loop {
                if let Ok(has_event) = event::poll(std::time::Duration::from_millis(100)) {
                    if has_event {
                        if let Ok(event) = event::read() {
                            match event {
                                Event::Key(KeyEvent {
                                    code: KeyCode::Char('c'),
                                    modifiers: KeyModifiers::CONTROL,
                                    ..
                                }) => {
                                    break;
                                }
                                Event::Key(KeyEvent { code, .. }) => {
                                    let input_data = match code {
                                        KeyCode::Enter => "\n".to_string(),
                                        KeyCode::Tab => "\t".to_string(),
                                        KeyCode::Backspace => "\x08".to_string(),
                                        KeyCode::Char(c) => c.to_string(),
                                        _ => continue,
                                    };

                                    if let Err(e) = network_clone.send_input(session_id_clone.clone(), input_data).await {
                                        error!("Failed to send input: {}", e);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        });

        println!("✅ Joined session. Receiving terminal output...");
        println!("💡 Type to send input to the remote session. Press Ctrl+C to exit.");

        terminal::enable_raw_mode()?;

        tokio::spawn(async move {
            while let Ok(event) = event_receiver.recv().await {
                match event.event_type {
                    crate::terminal::EventType::Output => {
                        print!("{}", event.data);
                        io::stdout().flush().ok();
                    }
                    crate::terminal::EventType::Start => {
                        execute!(
                            io::stdout(),
                            SetForegroundColor(Color::Green),
                            Print(format!("🎬 Session started: {}\n", event.data)),
                            ResetColor
                        ).ok();
                    }
                    crate::terminal::EventType::End => {
                        execute!(
                            io::stdout(),
                            SetForegroundColor(Color::Red),
                            Print("🛑 Session ended\n"),
                            ResetColor
                        ).ok();
                        break;
                    }
                    crate::terminal::EventType::Resize { width, height } => {
                        execute!(
                            io::stdout(),
                            SetForegroundColor(Color::Yellow),
                            Print(format!("📐 Terminal resized: {}x{}\n", width, height)),
                            ResetColor
                        ).ok();
                    }
                    _ => {}
                }
            }
        });

        self.handle_network_messages().await;

        tokio::signal::ctrl_c().await?;
        terminal::disable_raw_mode()?;
        println!("\n👋 Disconnected from session.");

        Ok(())
    }

    async fn list_sessions(&self) -> Result<()> {
        println!("📋 Active Sessions:");
        println!("🌐 Your Node ID: {}", self.network.get_node_id().await);
        println!();

        let sessions = self.network.get_active_sessions().await;

        if sessions.is_empty() {
            println!("🔍 No active sessions found.");
        } else {
            for (index, session_id) in sessions.iter().enumerate() {
                let is_host = self.network.is_session_host(session_id).await;
                let role = if is_host { "Host" } else { "Participant" };

                execute!(
                    io::stdout(),
                    SetForegroundColor(Color::Cyan),
                    Print(format!("{}. ", index + 1)),
                    ResetColor,
                    Print(format!("{} ({})\n", session_id, role))
                )?;
            }
        }

        Ok(())
    }

    async fn play_session(&self, file: String) -> Result<()> {
        println!("🎬 Playing back session from: {}", file);

        let file_content = tokio::fs::read_to_string(&file).await
            .with_context(|| format!("Failed to read session file: {}", file))?;

        let events: Vec<TerminalEvent> = serde_json::from_str(&file_content)
            .with_context(|| format!("Failed to parse session file: {}", file))?;

        if events.is_empty() {
            println!("⚠️  No events found in session file");
            return Ok(());
        }

        println!("📺 Starting playback of {} events. Press Ctrl+C to stop.", events.len());
        println!("⏯️  Press any key to start...");

        // Wait for user input to start
        let _ = tokio::io::stdin().read_u8().await;

        let mut player = TerminalPlayer::new(events);
        player.play().await?;

        println!("\n✅ Playback completed.");
        Ok(())
    }

    async fn handle_input_forwarding(&self, mut input_receiver: mpsc::UnboundedReceiver<String>) {
        tokio::spawn(async move {
            while let Some(input_data) = input_receiver.recv().await {
                print!("{}", input_data);
                io::stdout().flush().ok();
            }
        });
    }

    async fn handle_network_messages(&mut self) {
        let _network = self.network.clone();
        tokio::spawn(async move {
            // Handle incoming network messages
            // This would typically involve listening for messages from other nodes
            // and processing them accordingly
        });
    }

    pub fn print_banner() {
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
        ).ok();
    }
}
