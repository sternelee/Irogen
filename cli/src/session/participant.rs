use anyhow::{Context, Result};
use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyModifiers},
    execute,
    style::{Color, Print, ResetColor, SetForegroundColor},
    terminal,
};
use std::io::{self, Write};
use tokio::sync::{broadcast, mpsc};
use tracing::{debug, error, info, warn};

use crate::p2p::{P2PNetwork, SessionTicket};
use crate::terminal::TerminalEvent;
use crate::session::{SessionManager, manager::SessionInfo};

/// Handles joining and participating in terminal sessions
pub struct ParticipantSession {
    session_manager: SessionManager,
}

impl ParticipantSession {
    pub fn new(session_manager: SessionManager) -> Self {
        Self { session_manager }
    }

    pub async fn join(&mut self, ticket_str: String) -> Result<()> {
        info!("Joining session with ticket...");
        
        let network = self.session_manager.network();
        info!("Your Node ID: {}", network.get_node_id().await);

        // Parse session ticket
        let ticket = ticket_str
            .parse::<SessionTicket>()
            .context("Failed to parse session ticket")?;

        info!("Successfully parsed ticket for topic: {}", ticket.topic_id);

        // Diagnose connection
        if let Err(e) = network.diagnose_connection(&ticket).await {
            warn!("Connection diagnosis failed: {}", e);
        }

        // Join session with retry
        info!("Attempting to join session (with retries)...");
        let (sender, event_receiver) = network
            .join_session_with_retry(ticket.clone(), 3)
            .await
            .context("Failed to join session after multiple attempts")?;

        let session_id = format!("session_{}", ticket.topic_id);
        
        // Register as participant
        let session_info = SessionInfo {
            session_id: session_id.clone(),
            is_host: false,
            shell_type: crate::shell::ShellType::Bash, // Default, will be updated
            width: 80,  // Default, will be updated
            height: 24, // Default, will be updated
            title: None,
        };
        self.session_manager.register_session(session_info).await;

        // Send participant joined notification
        if let Err(e) = network.send_participant_joined(&sender, &session_id).await {
            warn!("Failed to send participant joined notification: {}", e);
        } else {
            info!("Sent participant joined notification, waiting for history data...");
        }

        // Wait for history data
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Start input handling
        self.start_input_handler(network.clone(), sender.clone(), ticket.topic_id).await;

        // Start output handling
        self.start_output_handler(event_receiver).await?;

        // Cleanup
        self.session_manager.unregister_session(&session_id).await;
        info!("Disconnected from session");

        Ok(())
    }

    async fn start_input_handler(
        &self,
        network: P2PNetwork,
        sender: iroh_gossip::api::GossipSender,
        topic_id: iroh_gossip::proto::TopicId,
    ) {
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
                                    let input_data = Self::key_to_string(code);
                                    if let Some(input) = input_data {
                                        let session_id = format!("session_{}", topic_id);
                                        if let Err(e) = network
                                            .send_input(&sender, input, &session_id)
                                            .await
                                        {
                                            error!("Failed to send input: {}", e);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        });
    }

    async fn start_output_handler(
        &self,
        mut event_receiver: broadcast::Receiver<TerminalEvent>,
    ) -> Result<()> {
        info!("Joined session. Receiving terminal output...");
        info!("Type to send input to the remote session. Press Ctrl+C to exit.");

        terminal::enable_raw_mode()?;

        // Handle events from the network
        let event_task = tokio::spawn(async move {
            while let Ok(event) = event_receiver.recv().await {
                Self::handle_terminal_event(event).await;
            }
        });

        // Wait for Ctrl+C
        tokio::signal::ctrl_c().await?;
        terminal::disable_raw_mode()?;

        // Cancel the event handling task
        event_task.abort();

        Ok(())
    }

    async fn handle_terminal_event(event: TerminalEvent) {
        match event.event_type {
            crate::terminal::EventType::Output => {
                print!("{}", event.data);
                io::stdout().flush().ok();
            }
            crate::terminal::EventType::Input => {
                debug!("Received input event: {}", event.data);
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

    fn key_to_string(code: KeyCode) -> Option<String> {
        match code {
            KeyCode::Enter => Some("\n".to_string()),
            KeyCode::Tab => Some("\t".to_string()),
            KeyCode::Backspace => Some("\x08".to_string()),
            KeyCode::Char(c) => Some(c.to_string()),
            _ => None,
        }
    }
}