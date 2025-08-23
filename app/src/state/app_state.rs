use std::sync::Arc;
use tokio::sync::RwLock;
use crate::config::MobileConfig;
use crate::services::{NetworkService, SessionService, TerminalService};
use crate::error::AppResult;

/// Main application state with service-based architecture
pub struct AppState {
    pub config: MobileConfig,
    pub network_service: Arc<NetworkService>,
    pub session_service: Arc<SessionService>,
    pub terminal_service: Arc<TerminalService>,
    pub is_initialized: Arc<RwLock<bool>>,
}

impl AppState {
    pub fn new() -> Self {
        let config = MobileConfig::load();

        Self {
            network_service: Arc::new(NetworkService::new(config.clone())),
            session_service: Arc::new(SessionService::new(config.clone())),
            terminal_service: Arc::new(TerminalService::new(config.clone())),
            config,
            is_initialized: Arc::new(RwLock::new(false)),
        }
    }

    /// Initialize the application state
    pub async fn initialize(&self, relay_url: Option<String>) -> AppResult<String> {
        // Initialize network
        let node_id = self.network_service.initialize(relay_url).await?;

        // Mark as initialized
        *self.is_initialized.write().await = true;

        Ok(node_id)
    }

    /// Check if the application is initialized
    pub async fn is_ready(&self) -> bool {
        *self.is_initialized.read().await && self.network_service.is_initialized().await
    }

    /// Get application statistics
    pub async fn get_app_stats(&self) -> AppResult<serde_json::Value> {
        let network_stats = self.network_service.get_stats().await?;
        let session_stats = self.session_service.get_stats().await;

        Ok(serde_json::json!({
            "network": network_stats,
            "sessions": session_stats,
            "config": {
                "theme": self.config.ui.theme,
                "auto_reconnect": self.config.session.auto_reconnect,
                "max_history_lines": self.config.session.max_history_lines,
            },
            "initialized": self.is_ready().await,
        }))
    }

    /// Cleanup all resources
    pub async fn cleanup(&self) -> AppResult<()> {
        // Get all active sessions
        let sessions = self.session_service.list_sessions().await;

        // Disconnect all sessions
        for session in sessions {
            let _ = self.session_service.disconnect_session(&session.session_id).await;
        }

        // Shutdown network
        self.network_service.shutdown().await?;

        // Mark as not initialized
        *self.is_initialized.write().await = false;

        Ok(())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
