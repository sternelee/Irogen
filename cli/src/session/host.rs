use anyhow::{Context, Result};
use tokio::sync::mpsc;
use tracing::{debug, error, info};

use crate::p2p::{P2PNetwork, SessionTicket};
use crate::terminal::{SessionHeader, TerminalEvent, TerminalRecorder};
use crate::shell::ShellConfig;
use crate::session::{SessionManager, manager::SessionInfo};

/// Handles hosting terminal sessions
pub struct HostSession {
    session_manager: SessionManager,
}

impl HostSession {
    pub fn new(session_manager: SessionManager) -> Self {
        Self { session_manager }
    }

    pub async fn start(
        &mut self,
        shell: Option<String>,
        title: Option<String>,
        width: u16,
        height: u16,
        save_file: Option<String>,
        passthrough: bool,
    ) -> Result<()> {
        let (shell_config, header) = SessionManager::create_session_header(
            shell, title, width, height
        ).await?;
        
        let session_id = header.session_id.clone();
        
        info!("Starting shared terminal session");
        info!("Session ID: {}", session_id);
        info!("Shell: {} ({})", shell_config.shell_type.get_display_name(), 
              shell_config.get_full_command().0);
        info!("Size: {}x{}", width, height);

        // Display network info
        let network = self.session_manager.network();
        info!("Node ID: {}", network.get_node_id().await);
        if let Ok(node_addr) = network.get_node_addr().await {
            info!("Node Address: {:?}", node_addr);
        }

        // Create P2P session
        let (topic_id, sender, input_receiver) = network
            .create_shared_session(header.clone())
            .await
            .context("Failed to create shared session")?;

        // Create and display session ticket
        let ticket = network
            .create_session_ticket(topic_id, &session_id)
            .await?;
        
        info!("Join using: {}", ticket);

        // Register session
        let session_info = SessionInfo {
            session_id: session_id.clone(),
            is_host: true,
            shell_type: shell_config.shell_type.clone(),
            width,
            height,
            title: header.title.clone(),
        };
        self.session_manager.register_session(session_info).await;

        // Start terminal session
        let recorder = self.spawn_terminal_session(
            session_id.clone(),
            sender.clone(),
            input_receiver,
            &shell_config,
            width,
            height,
            passthrough,
        ).await?;

        // Setup history callback
        self.session_manager.setup_history_callback(recorder.clone()).await;

        // Wait for session to end
        tokio::signal::ctrl_c().await?;

        // Cleanup
        network.end_session(&sender, session_id.clone()).await?;
        self.session_manager.unregister_session(&session_id).await;

        // Save session if requested
        if let Some(save_path) = save_file {
            info!("Saving session to: {}", save_path);
            recorder.save_to_file(&save_path).await?;
            info!("Session saved successfully!");
        }

        info!("Session ended");
        Ok(())
    }

    async fn spawn_terminal_session(
        &self,
        session_id: String,
        sender: iroh_gossip::api::GossipSender,
        input_receiver: mpsc::UnboundedReceiver<String>,
        shell_config: &ShellConfig,
        width: u16,
        height: u16,
        passthrough: bool,
    ) -> Result<TerminalRecorder> {
        let shell_type = shell_config.shell_type.get_display_name().to_string();
        let (recorder, mut event_receiver) = TerminalRecorder::new(session_id.clone(), shell_type)
            .await
            .context("Failed to create terminal recorder")?;

        // Forward terminal events to network
        let network = self.session_manager.network().clone();
        let session_id_clone = session_id.clone();
        tokio::spawn(async move {
            while let Some(event) = event_receiver.recv().await {
                if let Err(e) = Self::handle_terminal_event(
                    &network, 
                    &sender, 
                    &session_id_clone, 
                    event
                ).await {
                    error!("Failed to handle terminal event: {}", e);
                }
            }
            debug!("Terminal event forwarding task ended");
        });

        // Handle remote input
        let (pty_input_sender, pty_input_receiver) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            let mut input_receiver = input_receiver;
            while let Some(input_data) = input_receiver.recv().await {
                if let Err(e) = pty_input_sender.send(input_data) {
                    error!("Failed to send input to PTY channel: {}", e);
                    break;
                }
            }
            info!("Remote input handler task ended for session: {}", session_id);
        });

        // Start terminal session
        if passthrough {
            info!("Starting passthrough terminal session. Press Ctrl+C to exit.");
            recorder
                .start_passthrough_session_with_config(
                    shell_config,
                    width,
                    height,
                    Some(pty_input_receiver),
                )
                .await?;
        } else {
            info!("Starting terminal session. Press Ctrl+C to exit.");
            // For now, use the existing method - this needs to be implemented properly
            // recorder.start_session_with_config(shell_config, width, height, Some(pty_input_receiver))?;
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        Ok(recorder)
    }

    async fn handle_terminal_event(
        network: &P2PNetwork,
        sender: &iroh_gossip::api::GossipSender,
        session_id: &str,
        event: TerminalEvent,
    ) -> Result<()> {
        match event.event_type {
            crate::terminal::EventType::Output => {
                network.send_terminal_output(sender, event.data, session_id).await
            }
            crate::terminal::EventType::Input => {
                network.send_input(sender, event.data, session_id).await
            }
            crate::terminal::EventType::Resize { width, height } => {
                network.send_resize_event(sender, width, height, session_id).await
            }
            _ => Ok(()),
        }
    }

    pub fn get_session_ticket_string(&self, ticket: &SessionTicket) -> String {
        ticket.to_string()
    }
}