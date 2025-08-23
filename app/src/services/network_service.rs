use std::sync::Arc;
use tokio::sync::RwLock;
use crate::config::MobileConfig;
use crate::error::{AppError, AppResult};
use crate::p2p::P2PNetwork;

/// Network service for managing P2P connections
pub struct NetworkService {
    network: Arc<RwLock<Option<P2PNetwork>>>,
    config: MobileConfig,
}

impl NetworkService {
    pub fn new(config: MobileConfig) -> Self {
        Self {
            network: Arc::new(RwLock::new(None)),
            config,
        }
    }

    /// Initialize network with optional relay
    pub async fn initialize(&self, relay_url: Option<String>) -> AppResult<String> {
        let mut network_guard = self.network.write().await;

        let network = P2PNetwork::new(relay_url)
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        let node_id = network.get_node_id().await;
        *network_guard = Some(network);

        Ok(node_id)
    }

    /// Get network instance (read-only)
    pub async fn get_network(&self) -> AppResult<Arc<RwLock<Option<P2PNetwork>>>> {
        Ok(self.network.clone())
    }

    /// Check if network is initialized
    pub async fn is_initialized(&self) -> bool {
        self.network.read().await.is_some()
    }

    /// Get node information
    pub async fn get_node_info(&self) -> AppResult<serde_json::Value> {
        let network_guard = self.network.read().await;

        match network_guard.as_ref() {
            Some(network) => {
                let node_id = network.get_node_id().await;
                let node_addr = network.get_node_addr().await.ok();

                Ok(serde_json::json!({
                    "node_id": node_id,
                    "node_addr": node_addr.map(|addr| addr.to_string()),
                    "status": "connected",
                    "config": {
                        "timeout_ms": self.config.network.connection_timeout_ms,
                        "retry_attempts": self.config.network.retry_attempts,
                    }
                }))
            }
            None => Err(AppError::NetworkNotInitialized),
        }
    }

    /// Connect to a peer
    pub async fn connect_to_peer(&self, peer_addr: String) -> AppResult<()> {
        let network_guard = self.network.read().await;

        match network_guard.as_ref() {
            Some(network) => {
                let addr = peer_addr.parse()
                    .map_err(|e| AppError::InvalidAddress(e.to_string()))?;

                network.connect_to_peer(addr).await
                    .map_err(|e| AppError::ConnectionFailed(e.to_string()))?;

                Ok(())
            }
            None => Err(AppError::NetworkNotInitialized),
        }
    }

    /// Shutdown network
    pub async fn shutdown(&self) -> AppResult<()> {
        let mut network_guard = self.network.write().await;

        if let Some(network) = network_guard.take() {
            network.shutdown().await
                .map_err(|e| AppError::NetworkError(e.to_string()))?;
        }

        Ok(())
    }

    /// Get network statistics
    pub async fn get_stats(&self) -> AppResult<serde_json::Value> {
        let network_guard = self.network.read().await;

        match network_guard.as_ref() {
            Some(network) => {
                let (total_sessions, hosted_sessions) = network.get_session_stats().await;

                Ok(serde_json::json!({
                    "total_sessions": total_sessions,
                    "hosted_sessions": hosted_sessions,
                    "participant_sessions": total_sessions - hosted_sessions,
                }))
            }
            None => Err(AppError::NetworkNotInitialized),
        }
    }
}
