//! Simplified terminal manager inspired by sshx architecture
//! Provides efficient management of multiple terminal sessions

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info};

use crate::output_batcher::{BatchConfig, OutputBatcher};
use crate::terminal_runner::{TerminalCommand as RunnerCommand, TerminalRunner};
use iroh_gossip::api::GossipSender;
use riterm_shared::p2p::{TerminalInfo, TerminalStatus};
use riterm_shared::{P2PNetwork, TerminalCommand, TerminalResponse};

/// Simplified terminal manager with direct P2P integration
#[derive(Clone)]
pub struct TerminalManager {
    terminals: Arc<RwLock<HashMap<String, TerminalSession>>>,
    /// Optional output batcher for improved network efficiency
    batcher: Option<Arc<OutputBatcher>>,
}

/// Terminal session information
pub struct TerminalSession {
    pub info: TerminalInfo,
    pub sender: mpsc::Sender<RunnerCommand>,
}

impl TerminalManager {
    /// Create a new terminal manager
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            batcher: None,
        }
    }

    /// Configure with P2P network and output batching (enables direct output sending)
    pub fn with_network(
        mut self,
        network: Arc<P2PNetwork>,
        session_id: String,
        gossip_sender: GossipSender,
    ) -> Self {
        // Create output batcher with default config
        let config = BatchConfig::default();
        let batcher = OutputBatcher::new(config, network, session_id, gossip_sender);
        self.batcher = Some(Arc::new(batcher));
        self
    }

    /// Configure with custom batch configuration
    pub fn with_batch_config(
        mut self,
        network: Arc<P2PNetwork>,
        session_id: String,
        gossip_sender: GossipSender,
        config: BatchConfig,
    ) -> Self {
        let batcher = OutputBatcher::new(config, network, session_id, gossip_sender);
        self.batcher = Some(Arc::new(batcher));
        self
    }

    /// Internal method: send terminal output (with batching if enabled)
    async fn send_output(&self, terminal_id: &str, data: Vec<u8>) -> Result<()> {
        if let Some(batcher) = &self.batcher {
            batcher
                .queue_output(terminal_id.to_string(), data)
                .await
                .context("Failed to queue terminal output")?;
        }
        Ok(())
    }

    /// Create a new terminal
    pub async fn create_terminal(
        &self,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> Result<String> {
        let terminal_id = generate_terminal_id();
        info!("Creating terminal: {}", terminal_id);

        // Create terminal runner
        let mut runner = TerminalRunner::new(
            terminal_id.clone(),
            name.clone(),
            shell_path,
            working_dir,
            size,
        )
        .await
        .context("Failed to create terminal runner")?;

        // Create command channel
        let (sender, receiver) = mpsc::channel(100);

        // Get terminal info for storage
        let info = runner.get_info();

        // Store terminal session with info
        let session = TerminalSession {
            info: info.clone(),
            sender,
        };
        let mut terminals = self.terminals.write().await;
        terminals.insert(terminal_id.clone(), session);
        drop(terminals); // Release lock

        // Start terminal runner in background with direct P2P integration
        let terminals_ref = self.terminals.clone();
        let terminal_id_for_spawn = terminal_id.clone();
        let manager_clone = self.clone(); // Clone self to send output

        tokio::spawn(async move {
            // Set output callback to send directly to P2P network
            let manager_for_output = manager_clone.clone();
            let tid_for_callback = terminal_id_for_spawn.clone();

            runner.set_output_callback(move |_id, data| {
                let manager = manager_for_output.clone();
                let tid = tid_for_callback.clone();
                tokio::spawn(async move {
                    if let Err(e) = manager.send_output(&tid, data.into_bytes()).await {
                        error!("Failed to send terminal output: {}", e);
                    }
                });
            });

            if let Err(e) = runner.run(receiver).await {
                error!("Terminal {} failed: {}", terminal_id_for_spawn, e);
            } else {
                info!("Terminal {} completed successfully", terminal_id_for_spawn);
            }

            // Clean up terminal when done
            terminals_ref.write().await.remove(&terminal_id_for_spawn);
        });

        info!("Created terminal: {}", terminal_id);
        Ok(terminal_id)
    }

    /// Send input to a terminal
    pub async fn send_input(&self, terminal_id: &str, data: Vec<u8>) -> Result<()> {
        let terminals = self.terminals.read().await;
        if let Some(session) = terminals.get(terminal_id) {
            session
                .sender
                .send(RunnerCommand::Input(data))
                .await
                .context("Failed to send input to terminal")?;
            debug!("Sent input to terminal: {}", terminal_id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Terminal {} not found", terminal_id))
        }
    }

    /// Resize a terminal
    pub async fn resize_terminal(&self, terminal_id: &str, rows: u16, cols: u16) -> Result<()> {
        let terminals = self.terminals.read().await;
        if let Some(session) = terminals.get(terminal_id) {
            session
                .sender
                .send(RunnerCommand::Resize(rows, cols))
                .await
                .context("Failed to send resize command to terminal")?;
            info!("Resized terminal {} to {}x{}", terminal_id, rows, cols);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Terminal {} not found", terminal_id))
        }
    }

    /// Close a terminal
    pub async fn close_terminal(&self, terminal_id: &str) -> Result<()> {
        let terminals = self.terminals.read().await;
        if let Some(session) = terminals.get(terminal_id) {
            session
                .sender
                .send(RunnerCommand::Close)
                .await
                .context("Failed to send close command to terminal")?;
            info!("Closed terminal: {}", terminal_id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Terminal {} not found", terminal_id))
        }
    }

    /// Get terminal information
    pub async fn get_terminal_info(&self, terminal_id: &str) -> Option<TerminalInfo> {
        let terminals = self.terminals.read().await;
        terminals
            .get(terminal_id)
            .map(|session| session.info.clone())
    }

    /// List all terminals
    pub async fn list_terminals(&self) -> Vec<TerminalInfo> {
        let terminals = self.terminals.read().await;
        terminals
            .iter()
            .map(|(_, session)| session.info.clone())
            .collect()
    }

    /// Handle terminal command from P2P network
    /// This is the main entry point for processing TerminalCommand messages
    pub async fn handle_terminal_command(
        &self,
        command: TerminalCommand,
    ) -> Result<TerminalResponse> {
        info!("Handling terminal command: {:?}", command);

        match command {
            TerminalCommand::Create {
                name,
                shell_path,
                working_dir,
                size,
            } => {
                let terminal_id = self
                    .create_terminal(name, shell_path, working_dir, size)
                    .await?;
                let info = self
                    .get_terminal_info(&terminal_id)
                    .await
                    .ok_or_else(|| anyhow::anyhow!("Terminal not found after creation"))?;
                Ok(TerminalResponse::Created { terminal_id, info })
            }

            TerminalCommand::Input { terminal_id, data } => {
                self.send_input(&terminal_id, data).await?;
                // Input doesn't return a direct response, output is sent via callback
                Ok(TerminalResponse::StatusUpdate {
                    terminal_id,
                    status: TerminalStatus::Running,
                })
            }

            TerminalCommand::Resize {
                terminal_id,
                rows,
                cols,
            } => {
                self.resize_terminal(&terminal_id, rows, cols).await?;
                Ok(TerminalResponse::StatusUpdate {
                    terminal_id,
                    status: TerminalStatus::Running,
                })
            }

            TerminalCommand::Stop { terminal_id } => {
                self.close_terminal(&terminal_id).await?;
                Ok(TerminalResponse::Stopped { terminal_id })
            }

            TerminalCommand::List => {
                let terminals = self.list_terminals().await;
                Ok(TerminalResponse::List { terminals })
            }
        }
    }

    /// Create terminal via P2P request (for remote participants)
    pub async fn handle_create_terminal_request(
        &self,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> Result<String> {
        info!("Handling P2P terminal creation request");
        self.create_terminal(name, shell_path, working_dir, size)
            .await
            .context("Failed to create terminal via P2P request")
    }
}

/// Generate a unique terminal ID
fn generate_terminal_id() -> String {
    use uuid::Uuid;
    format!("term_{}", Uuid::new_v4().to_string()[..8].to_lowercase())
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_terminal_manager() {
        let manager = TerminalManager::new();

        // Test terminal creation
        let terminal_id = manager
            .create_terminal(Some("test".to_string()), None, None, Some((24, 80)))
            .await
            .unwrap();

        assert!(!terminal_id.is_empty());

        // Test listing terminals
        let terminals = manager.list_terminals().await;
        assert_eq!(terminals.len(), 1);
        assert_eq!(terminals[0].id, terminal_id);
        assert_eq!(terminals[0].name, Some("test".to_string()));

        // Test getting terminal info
        let info = manager.get_terminal_info(&terminal_id).await;
        assert!(info.is_some());
        assert_eq!(info.unwrap().name, Some("test".to_string()));

        // Test sending input
        manager
            .send_input(&terminal_id, b"echo hello\n".to_vec())
            .await
            .unwrap();

        // Test resizing
        manager
            .resize_terminal(&terminal_id, 30, 100)
            .await
            .unwrap();

        // Test closing
        manager.close_terminal(&terminal_id).await.unwrap();
    }

    #[test]
    fn test_generate_terminal_id() {
        let id1 = generate_terminal_id();
        let id2 = generate_terminal_id();

        assert!(!id1.is_empty());
        assert!(!id2.is_empty());
        assert_ne!(id1, id2);
        assert!(id1.starts_with("term_"));
        assert!(id2.starts_with("term_"));
        assert_eq!(id1.len(), 13); // "term_" + 8 chars
        assert_eq!(id2.len(), 13);
    }
}
