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
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::p2p::P2PNetwork;
use crate::shell::{ShellConfig, ShellDetector};
use crate::terminal::{SessionHeader, TerminalEvent, TerminalPlayer, TerminalRecorder};

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
            } => {
                if list_shells {
                    self.list_available_shells();
                    return Ok(());
                }

                self.host_session(shell, title, width, height, save, passthrough)
                    .await
            }
            Commands::Join { ticket } => self.join_session(ticket).await,
            Commands::List => self.list_sessions().await,
            Commands::Play { file } => self.play_session(file).await,
        }
    }

    fn setup_host_environment(
        shell: Option<String>,
        title: Option<String>,
        width: u16,
        height: u16,
    ) -> Result<(ShellConfig, SessionHeader)> {
        let shell_type = if let Some(shell_cmd) = shell {
            ShellDetector::validate_shell_command(&shell_cmd)
                .with_context(|| format!("Invalid shell: {}", shell_cmd))?
        } else {
            ShellDetector::get_default_shell()
        };

        let shell_config = ShellConfig::new(shell_type.clone());
        let (command, args) = shell_config.get_full_command();
        let session_id = Uuid::new_v4().to_string();

        let header = SessionHeader {
            version: 2,
            width,
            height,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
            title,
            command: Some(format!("{} {}", command, args.join(" "))),
            session_id,
        };

        println!("🚀 Starting shared terminal session...");
        println!("📋 Session ID: {}", header.session_id);
        println!("🐚 Shell: {} ({})", shell_type.get_display_name(), command);
        println!("📏 Size: {}x{}", width, height);
        println!();

        Ok((shell_config, header))
    }

    async fn spawn_pty_tasks(
        &self,
        session_id: String,
        sender: iroh_gossip::api::GossipSender,
        input_receiver: mpsc::UnboundedReceiver<String>,
        shell_config: &ShellConfig,
        width: u16,
        height: u16,
        passthrough: bool,
    ) -> Result<TerminalRecorder> {
        let (recorder, mut event_receiver) = TerminalRecorder::new(session_id.clone());

        // Forward terminal recorder events to network
        let network_clone = self.network.clone();
        let session_id_clone_for_events = session_id.clone();
        tokio::spawn(async move {
            while let Some(event) = event_receiver.recv().await {
                match event.event_type {
                    crate::terminal::EventType::Output => {
                        if let Err(e) = network_clone
                            .send_terminal_output(&sender, event.data, &session_id_clone_for_events)
                            .await
                        {
                            error!("Failed to send terminal output: {}", e);
                        }
                    }
                    crate::terminal::EventType::Input => {
                        if let Err(e) = network_clone
                            .send_input(&sender, event.data, &session_id_clone_for_events)
                            .await
                        {
                            error!("Failed to send terminal input: {}", e);
                        }
                    }
                    crate::terminal::EventType::Resize { width, height } => {
                        if let Err(e) = network_clone
                            .send_resize_event(&sender, width, height, &session_id_clone_for_events)
                            .await
                        {
                            error!("Failed to send resize event: {}", e);
                        }
                    }
                    _ => {}
                }
            }
            debug!("Terminal event forwarding task ended");
        });

        // Create a channel for sending remote input to the PTY
        let (pty_input_sender, pty_input_receiver) = mpsc::unbounded_channel::<String>();

        // Handle input from network and forward to PTY
        tokio::spawn(async move {
            info!("Starting remote input handler for session: {}", session_id);
            let mut input_receiver = input_receiver;
            loop {
                match input_receiver.recv().await {
                    Some(input_data) => {
                        if let Err(e) = pty_input_sender.send(input_data) {
                            error!("Failed to send input to PTY channel: {}", e);
                            break;
                        }
                    }
                    None => {
                        info!("Remote input channel closed for session: {}", session_id);
                        break;
                    }
                }
            }
            info!(
                "Remote input handler task ending for session: {}",
                session_id
            );
        });

        if passthrough {
            println!("✅ Starting passthrough terminal session. Press Ctrl+C to exit.");
            recorder
                .start_passthrough_session_with_config(
                    shell_config,
                    width,
                    height,
                    Some(pty_input_receiver),
                )
                .await?;
        } else {
            println!("✅ Starting terminal session. Press Ctrl+C to exit.");
            recorder.start_session_with_config(
                shell_config,
                width,
                height,
                Some(pty_input_receiver),
            )?;
            tokio::signal::ctrl_c().await?;
        }

        Ok(recorder)
    }

    async fn host_session(
        &mut self,
        shell: Option<String>,
        title: Option<String>,
        width: u16,
        height: u16,
        save_file: Option<String>,
        passthrough: bool,
    ) -> Result<()> {
        let (shell_config, header) = Self::setup_host_environment(shell, title, width, height)?;
        let session_id = header.session_id.clone();

        println!("🌐 Node ID: {}", self.network.get_node_id().await);
        if let Ok(node_addr) = self.network.get_node_addr().await {
            println!("📍 Node Address: {:?}", node_addr);
        }

        let (topic_id, sender, input_receiver) = self
            .network
            .create_shared_session(header)
            .await
            .context("Failed to create shared session")?;

        // Create and display session ticket
        let ticket = self
            .network
            .create_session_ticket(topic_id, &session_id)
            .await?;
        println!("🎫 Session Ticket: {}", ticket);
        println!("💡 Others can join using: roterm join {}", ticket);

        // Display QR code for the ticket
        self.display_qr_code(&ticket.to_string());

        let recorder = self
            .spawn_pty_tasks(
                session_id.clone(),
                sender.clone(),
                input_receiver,
                &shell_config,
                width,
                height,
                passthrough,
            )
            .await?;

        self.network
            .end_session(&sender, session_id.clone())
            .await?;

        if let Some(save_path) = save_file {
            println!("💾 Saving session to: {}", save_path);
            recorder.save_to_file(&save_path).await?;
            println!("✅ Session saved successfully!");
        }

        println!("\n👋 Session ended.");

        Ok(())
    }

    async fn join_session(&mut self, ticket_str: String) -> Result<()> {
        println!("🔗 Joining session with ticket...");
        println!("🌐 Your Node ID: {}", self.network.get_node_id().await);

        // Parse session ticket
        let ticket = ticket_str
            .parse::<crate::p2p::SessionTicket>()
            .context("Failed to parse session ticket")?;

        println!(
            "📡 Successfully parsed ticket for topic: {}",
            ticket.topic_id
        );

        // First diagnose the connection to help troubleshoot
        if let Err(e) = self.network.diagnose_connection(&ticket).await {
            warn!("Connection diagnosis failed: {}", e);
        }

        println!("Attempting to join session (with retries)...");
        let (sender, mut event_receiver) = self
            .network
            .join_session_with_retry(ticket.clone(), 3)
            .await
            .context("Failed to join session after multiple attempts")?;

        let network_clone = self.network.clone();
        let sender_clone = sender.clone();
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

                                    let session_id = format!("session_{}", ticket.topic_id);
                                    if let Err(e) = network_clone
                                        .send_input(&sender_clone, input_data, &session_id)
                                        .await
                                    {
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

        // Create a channel for sending input to the PTY
        let (_pty_input_sender, _pty_input_receiver) = mpsc::unbounded_channel::<String>();

        // Spawn task to handle events from the network
        let _event_task = tokio::spawn(async move {
            while let Ok(event) = event_receiver.recv().await {
                match event.event_type {
                    crate::terminal::EventType::Output => {
                        print!("{}", event.data);
                        io::stdout().flush().ok();
                    }
                    crate::terminal::EventType::Input => {
                        // Forward input to PTY
                        // Note: In this version, we're not actually using the channel since we don't have a PTY to send to
                        debug!("Received input event: {}", event.data);
                        // Print the input to stdout so we can see it
                        print!("{}", event.data);
                        io::stdout().flush().ok();
                    }
                    crate::terminal::EventType::Start => {
                        execute!(
                            io::stdout(),
                            SetForegroundColor(Color::Green),
                            Print(format!("🎬 Session started: {}\n", event.data)),
                            ResetColor
                        )
                        .ok();
                    }
                    crate::terminal::EventType::End => {
                        execute!(
                            io::stdout(),
                            SetForegroundColor(Color::Red),
                            Print("🛑 Session ended\n"),
                            ResetColor
                        )
                        .ok();
                        break;
                    }
                    crate::terminal::EventType::Resize { width, height } => {
                        execute!(
                            io::stdout(),
                            SetForegroundColor(Color::Yellow),
                            Print(format!("📐 Terminal resized: {}x{}\n", width, height)),
                            ResetColor
                        )
                        .ok();
                    }
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

        let file_content = tokio::fs::read_to_string(&file)
            .await
            .with_context(|| format!("Failed to read session file: {}", file))?;

        let events: Vec<TerminalEvent> = serde_json::from_str(&file_content)
            .with_context(|| format!("Failed to parse session file: {}", file))?;

        if events.is_empty() {
            println!("⚠️  No events found in session file");
            return Ok(());
        }

        println!(
            "📺 Starting playback of {} events. Press Ctrl+C to stop.",
            events.len()
        );
        println!("⏯️  Press any key to start...");

        // Wait for user input to start
        let _ = tokio::io::stdin().read_u8().await;

        let mut player = TerminalPlayer::new(events);
        player.play().await?;

        println!("\n✅ Playback completed.");
        Ok(())
    }

    fn list_available_shells(&self) {
        println!("🐚 Available Shells:");
        println!();

        let available_shells = ShellDetector::detect_available_shells();
        let current_shell = ShellDetector::get_current_shell();

        if available_shells.is_empty() {
            println!("❌ No supported shells found on this system");
            return;
        }

        for (index, shell) in available_shells.iter().enumerate() {
            let is_current = current_shell.as_ref() == Some(shell);
            let marker = if is_current { "→" } else { " " };
            let status = if is_current { " (current)" } else { "" };

            execute!(
                io::stdout(),
                SetForegroundColor(if is_current {
                    Color::Green
                } else {
                    Color::Cyan
                }),
                Print(format!(
                    "{}{}. {} - {}{}\n",
                    marker,
                    index + 1,
                    shell.get_display_name(),
                    shell.get_command_path(),
                    status
                )),
                ResetColor
            )
            .ok();
        }

        println!();
        println!("💡 Use --shell <name> to specify a shell, or let roterm detect automatically");
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
        // This function is intentionally left empty as network message handling
        // is done in the P2PNetwork's start_topic_listener method
        // We keep this function as a placeholder for future extensions
    }

    fn display_qr_code(&self, ticket: &str) {
        use qrcode::QrCode;

        match QrCode::new(ticket.as_bytes()) {
            Ok(qr_code) => {
                let qr_string = qr_code
                    .render::<char>()
                    .quiet_zone(true)
                    .module_dimensions(2, 1)
                    .build();
                println!("🎫 Scan the QR code below to join this session:");
                println!("\n{}\n", qr_string);
            }
            Err(e) => {
                eprintln!("Failed to generate QR code: {}", e);
            }
        }
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
        )
        .ok();
    }
}

