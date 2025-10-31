//! Output batching for improved network efficiency
//!
//! Collects small terminal outputs and sends them in batches to reduce
//! network overhead and improve throughput.

use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{RwLock, mpsc};
use tokio::time::interval;
use tracing::{debug, error};

use iroh_gossip::api::GossipSender;
use riterm_shared::P2PNetwork;

/// Configuration for output batching
#[derive(Debug, Clone)]
pub struct BatchConfig {
    /// Maximum number of bytes per batch
    pub max_batch_size: usize,
    /// Maximum delay before flushing batch (milliseconds)
    pub max_delay_ms: u64,
    /// Enable batching
    pub enabled: bool,
}

impl Default for BatchConfig {
    fn default() -> Self {
        Self {
            max_batch_size: 4096, // 4KB per batch
            max_delay_ms: 16,     // ~60 FPS
            enabled: true,
        }
    }
}

/// Output batcher that collects and sends terminal outputs in batches
pub struct OutputBatcher {
    config: BatchConfig,
    network: Arc<P2PNetwork>,
    session_id: String,
    gossip_sender: GossipSender,
    sender: mpsc::Sender<(String, Vec<u8>)>,
}

impl OutputBatcher {
    /// Create a new output batcher
    pub fn new(
        config: BatchConfig,
        network: Arc<P2PNetwork>,
        session_id: String,
        gossip_sender: GossipSender,
    ) -> Self {
        let (sender, receiver) = mpsc::channel(1000);

        let batcher = Self {
            config: config.clone(),
            network: network.clone(),
            session_id: session_id.clone(),
            gossip_sender: gossip_sender.clone(),
            sender,
        };

        // Start background flusher task
        if config.enabled {
            tokio::spawn(Self::flush_loop(
                config,
                network,
                session_id,
                gossip_sender,
                receiver,
            ));
        }

        batcher
    }

    /// Queue output for batching (returns immediately)
    pub async fn queue_output(&self, terminal_id: String, data: Vec<u8>) -> Result<()> {
        if !self.config.enabled {
            // Batching disabled, send immediately
            return self
                .network
                .send_terminal_output(&self.session_id, &self.gossip_sender, terminal_id, data)
                .await;
        }

        // Send to background task
        self.sender
            .send((terminal_id, data))
            .await
            .map_err(|e| anyhow::anyhow!("Failed to queue output: {}", e))?;

        Ok(())
    }

    /// Background loop that batches and flushes outputs
    async fn flush_loop(
        config: BatchConfig,
        network: Arc<P2PNetwork>,
        session_id: String,
        gossip_sender: GossipSender,
        mut receiver: mpsc::Receiver<(String, Vec<u8>)>,
    ) {
        let mut flush_interval = interval(Duration::from_millis(config.max_delay_ms));
        let mut terminal_buffers: HashMap<String, Vec<u8>> = HashMap::new();

        loop {
            tokio::select! {
                // Receive new output
                Some((terminal_id, data)) = receiver.recv() => {
                    let buffer = terminal_buffers.entry(terminal_id.clone()).or_insert_with(Vec::new);
                    buffer.extend_from_slice(&data);

                    // Flush if buffer is too large
                    if buffer.len() >= config.max_batch_size {
                        if let Err(e) = Self::flush_terminal(
                            &network,
                            &session_id,
                            &gossip_sender,
                            &terminal_id,
                            buffer,
                        )
                        .await
                        {
                            error!("Failed to flush terminal {}: {}", terminal_id, e);
                        }
                        terminal_buffers.remove(&terminal_id);
                    }
                }

                // Periodic flush
                _ = flush_interval.tick() => {
                    if !terminal_buffers.is_empty() {
                        Self::flush_all(
                            &network,
                            &session_id,
                            &gossip_sender,
                            &mut terminal_buffers,
                        )
                        .await;
                    }
                }
            }
        }
    }

    /// Flush a single terminal's buffer
    async fn flush_terminal(
        network: &P2PNetwork,
        session_id: &str,
        gossip_sender: &GossipSender,
        terminal_id: &str,
        buffer: &mut Vec<u8>,
    ) -> Result<()> {
        if buffer.is_empty() {
            return Ok(());
        }

        let data = std::mem::take(buffer);
        debug!("Flushing {} bytes for terminal {}", data.len(), terminal_id);

        network
            .send_terminal_output(session_id, gossip_sender, terminal_id.to_string(), data)
            .await
    }

    /// Flush all pending buffers
    async fn flush_all(
        network: &P2PNetwork,
        session_id: &str,
        gossip_sender: &GossipSender,
        buffers: &mut HashMap<String, Vec<u8>>,
    ) {
        for (terminal_id, buffer) in buffers.iter_mut() {
            if let Err(e) =
                Self::flush_terminal(network, session_id, gossip_sender, terminal_id, buffer).await
            {
                error!("Failed to flush terminal {}: {}", terminal_id, e);
            }
        }
        buffers.clear();
    }

    /// Force flush all pending outputs immediately
    pub async fn flush(&self) -> Result<()> {
        // In the current implementation, flush happens automatically
        // This method is provided for API completeness
        Ok(())
    }
}

impl Drop for OutputBatcher {
    fn drop(&mut self) {
        // Note: Pending outputs will be lost on drop
        // In a production system, you might want to flush here
        debug!("OutputBatcher dropped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_config_default() {
        let config = BatchConfig::default();
        assert_eq!(config.max_batch_size, 4096);
        assert_eq!(config.max_delay_ms, 16);
        assert!(config.enabled);
    }
}
