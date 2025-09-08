use anyhow::{Context, Result};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::p2p::P2PNetwork;
use crate::shell::{ShellConfig, ShellDetector};
use crate::terminal::{SessionHeader, TerminalRecorder};
use crate::terminal_config::TerminalConfigDetector;

pub struct HostSession {
    network: P2PNetwork,
    ticket: Option<String>,
    auth_token: Option<String>,
}

impl HostSession {
    pub fn new(network: P2PNetwork) -> Self {
        Self {
            network,
            ticket: None,
            auth_token: None,
        }
    }

    pub async fn start(
        &mut self,
        shell: Option<String>,
        title: Option<String>,
        width: u16,
        height: u16,
        save_file: Option<String>,
        passthrough: bool,
        auth: Option<String>,
    ) -> Result<()> {
        // Store auth token for later use
        self.auth_token = auth.clone();

        let (shell_config, header) = Self::setup_environment(shell, title, width, height)?;
        let session_id = header.session_id.clone();

        self.display_terminal_config().await;

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
        println!("💡 Join using: {}", ticket);

        // Store ticket and submit to API if auth is provided
        let ticket_string = ticket.to_string();
        self.ticket = Some(ticket_string.clone());

        if let Some(auth_token) = &self.auth_token {
            match self.submit_ticket_to_api(&ticket_string, auth_token).await {
                Ok(_) => println!("✅ Ticket submitted to API successfully"),
                Err(e) => println!("❌ Failed to submit ticket to API: {}", e),
            }
        }

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

        // 设置历史记录回调，当有新参与者加入时自动发送历史记录
        let recorder_clone = recorder.clone();
        self.network
            .set_history_callback(move |_session_id| {
                let recorder = recorder_clone.clone();
                let (tx, rx) = tokio::sync::oneshot::channel();

                tokio::spawn(async move {
                    let session_info = recorder.get_session_info().await;
                    let _ = tx.send(Some(session_info));
                });

                rx
            })
            .await;

        info!(
            "✅ History callback set successfully. New participants will receive session history automatically."
        );

        self.network
            .end_session(&sender, session_id.clone())
            .await?;

        // Delete ticket from API if auth was used
        if let (Some(ticket), Some(auth_token)) = (&self.ticket, &self.auth_token) {
            match self.delete_ticket_from_api(ticket, auth_token).await {
                Ok(_) => println!("✅ Ticket deleted from API successfully"),
                Err(e) => println!("❌ Failed to delete ticket from API: {}", e),
            }
        }

        if let Some(save_path) = save_file {
            println!("💾 Saving session to: {}", save_path);
            recorder.save_to_file(&save_path).await?;
            println!("✅ Session saved successfully!");
        }

        println!("\n👋 Session ended.");

        Ok(())
    }

    fn setup_environment(
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

    async fn display_terminal_config(&self) {
        match TerminalConfigDetector::detect_full_config() {
            Ok(config) => {
                let summary = TerminalConfigDetector::generate_config_summary(&config);
                println!("🔧 Terminal Config: {}", summary);
                println!(
                    "   Shell: {} ({})",
                    config.shell_config.shell_type, config.shell_config.shell_path
                );
                println!(
                    "   Terminal: {} ({}x{})",
                    config.terminal_type, config.terminal_size.width, config.terminal_size.height
                );

                if !config.shell_config.plugins.is_empty() {
                    println!("   Plugins: {}", config.shell_config.plugins.join(", "));
                }

                if let Some(theme) = &config.shell_config.theme {
                    println!("   Theme: {}", theme);
                }

                println!(
                    "   OS: {} ({})",
                    config.system_info.os, config.system_info.arch
                );
                println!();
            }
            Err(e) => {
                warn!("Failed to detect terminal configuration: {}", e);
            }
        }
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
        let shell_type = shell_config.shell_type.get_display_name().to_string();
        let (recorder, mut event_receiver) = TerminalRecorder::new(session_id.clone(), shell_type)
            .await
            .context("Failed to create terminal recorder")?;

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

    async fn submit_ticket_to_api(&self, ticket: &str, auth_token: &str) -> Result<()> {
        let base_host_api = std::env::var("BASE_HOST_API")
            .unwrap_or_else(|_| "https://api.example.com".to_string());
        let client = reqwest::Client::new();

        let response = client
            .post(&format!("{}/ticket", base_host_api))
            .header("authentication", auth_token)
            .header("Content-Type", "text/plain")
            .body(ticket.to_string())
            .send()
            .await
            .context("Failed to send ticket to API")?;

        if response.status().is_success() {
            info!("Ticket submitted successfully to {}/ticket", base_host_api);
            Ok(())
        } else {
            anyhow::bail!("API returned status: {}", response.status())
        }
    }

    async fn delete_ticket_from_api(&self, ticket: &str, auth_token: &str) -> Result<()> {
        let base_host_api = std::env::var("BASE_HOST_API")
            .unwrap_or_else(|_| "https://api.example.com".to_string());
        let client = reqwest::Client::new();

        let response = client
            .delete(&format!("{}/ticket", base_host_api))
            .header("authentication", auth_token)
            .header("Content-Type", "text/plain")
            .body(ticket.to_string())
            .send()
            .await
            .context("Failed to delete ticket from API")?;

        if response.status().is_success() {
            info!("Ticket deleted successfully from {}/ticket", base_host_api);
            Ok(())
        } else {
            anyhow::bail!("API returned status: {}", response.status())
        }
    }

    fn display_qr_code(&self, ticket: &str) {
        use crate::string_compressor::StringCompressor;
        use fast_qr::qr::QRBuilder;

        // Show compression statistics
        println!("🔧 Ticket Compression Analysis:");

        // For display purposes, if this is already a compressed ticket (CT_ prefix),
        // try to show the compression ratio by decompressing and recompressing
        if ticket.starts_with("CT_") {
            println!("   ✅ Using compressed ticket format");
            if let Ok(decompressed) = StringCompressor::decompress(&ticket[3..]) {
                println!(
                    "   📊 Original (decompressed): {} bytes",
                    decompressed.len()
                );
                println!("   📊 Compressed: {} bytes", ticket.len());
                let compression_ratio =
                    (1.0 - (ticket.len() as f64 / decompressed.len() as f64)) * 100.0;
                println!(
                    "   📊 Compression ratio: {:.1}% reduction",
                    compression_ratio
                );

                // Test different compression methods for comparison
                if let Ok(standard_compressed) = StringCompressor::compress(&decompressed) {
                    println!(
                        "   🔍 Standard compression would be: {} bytes",
                        standard_compressed.len()
                    );
                }
                if let Ok(hybrid_compressed) = StringCompressor::compress_hybrid(&decompressed) {
                    println!(
                        "   🔍 Hybrid compression achieved: {} bytes (current method)",
                        hybrid_compressed.len()
                    );
                }
            }
        } else {
            // This shouldn't happen with new tickets, but handle legacy format
            println!("   ⚠️  Using uncompressed ticket format");
            if let Ok(compressed) = StringCompressor::compress_hybrid(ticket) {
                let compression_ratio =
                    (1.0 - (compressed.len() as f64 / ticket.len() as f64)) * 100.0;
                println!(
                    "   📊 Could compress from {} to {} bytes ({:.1}% reduction)",
                    ticket.len(),
                    compressed.len(),
                    compression_ratio
                );
            }
        }

        println!("   📏 Final ticket length: {} characters", ticket.len());

        // Calculate QR code data density
        let qr_efficiency = if ticket.len() < 100 {
            "Excellent"
        } else if ticket.len() < 150 {
            "Good"
        } else if ticket.len() < 250 {
            "Fair"
        } else {
            "Poor"
        };
        println!(
            "   📱 Mobile QR compatibility: {} (shorter is better for scanning)",
            qr_efficiency
        );
        println!();

        match QRBuilder::new(ticket.as_bytes()).build() {
            Ok(qr_code) => {
                let qr_string = qr_code.to_str();
                println!("🎫 Scan the QR code below to join this session:");
                println!("\n{}\n", qr_string);
            }
            Err(e) => {
                eprintln!("Failed to generate QR code: {}", e);
            }
        }
    }
}

impl Drop for HostSession {
    fn drop(&mut self) {
        // Clean up ticket on drop (e.g., when Ctrl+C is pressed)
        if let (Some(ticket), Some(auth_token)) = (&self.ticket, &self.auth_token) {
            let ticket = ticket.clone();
            let auth_token = auth_token.clone();

            // Use a non-blocking approach to avoid potential deadlocks
            std::thread::spawn(move || {
                // Use a timeout to prevent hanging on shutdown
                let cleanup_result = std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build();

                    if let Ok(rt) = rt {
                        rt.block_on(async move {
                            let base_host_api = std::env::var("BASE_HOST_API")
                                .unwrap_or_else(|_| "https://api.example.com".to_string());

                            // Set a shorter timeout for cleanup operations
                            let client = reqwest::Client::builder()
                                .timeout(std::time::Duration::from_secs(3))
                                .build();

                            if let Ok(client) = client {
                                let request_future = client
                                    .delete(&format!("{}/ticket", base_host_api))
                                    .header("authentication", &auth_token)
                                    .header("Content-Type", "text/plain")
                                    .body(ticket)
                                    .send();

                                // Add timeout to the entire cleanup operation
                                match tokio::time::timeout(
                                    std::time::Duration::from_secs(5),
                                    request_future,
                                )
                                .await
                                {
                                    Ok(Ok(_)) => {
                                        debug!("Ticket cleanup completed successfully");
                                    }
                                    Ok(Err(e)) => {
                                        debug!("Failed to delete ticket on exit: {}", e);
                                    }
                                    Err(_) => {
                                        debug!("Ticket cleanup timed out");
                                    }
                                }
                            }
                        });
                    }
                });

                // Wait for cleanup with overall timeout
                if cleanup_result.join().is_err() {
                    debug!("Ticket cleanup thread panicked or timed out");
                }
            });
        }
    }
}
