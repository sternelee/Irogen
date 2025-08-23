use anyhow::{Context, Result};
use std::collections::HashMap;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::p2p::{P2PNetwork, SessionTicket};
use crate::terminal::{SessionHeader, TerminalRecorder};
use crate::shell::{ShellConfig, ShellDetector, ShellType};

/// Manages terminal sessions and their lifecycle
pub struct SessionManager {
    network: P2PNetwork,
    active_sessions: RwLock<HashMap<String, SessionInfo>>,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub session_id: String,
    pub is_host: bool,
    pub shell_type: ShellType,
    pub width: u16,
    pub height: u16,
    pub title: Option<String>,
}

impl SessionManager {
    pub async fn new(relay: Option<String>) -> Result<Self> {
        let network = P2PNetwork::new(relay)
            .await
            .context("Failed to initialize P2P network")?;

        Ok(Self {
            network,
            active_sessions: RwLock::new(HashMap::new()),
        })
    }

    pub fn network(&self) -> &P2PNetwork {
        &self.network
    }

    pub async fn create_session_header(
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
            title: title.clone(),
            command: Some(format!("{} {}", command, args.join(" "))),
            session_id: session_id.clone(),
        };

        // Store session info
        let session_info = SessionInfo {
            session_id: session_id.clone(),
            is_host: true,
            shell_type,
            width,
            height,
            title,
        };

        Ok((shell_config, header))
    }

    pub async fn register_session(&self, session_info: SessionInfo) {
        let mut sessions = self.active_sessions.write().await;
        let session_id = session_info.session_id.clone();
        sessions.insert(session_id.clone(), session_info);
        debug!("Registered session: {}", session_id);
    }

    pub async fn unregister_session(&self, session_id: &str) {
        let mut sessions = self.active_sessions.write().await;
        if sessions.remove(session_id).is_some() {
            debug!("Unregistered session: {}", session_id);
        }
    }

    pub async fn get_session_info(&self, session_id: &str) -> Option<SessionInfo> {
        let sessions = self.active_sessions.read().await;
        sessions.get(session_id).cloned()
    }

    pub async fn list_active_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.active_sessions.read().await;
        sessions.values().cloned().collect()
    }

    pub async fn get_session_stats(&self) -> (usize, usize) {
        let sessions = self.active_sessions.read().await;
        let total = sessions.len();
        let hosted = sessions.values().filter(|s| s.is_host).count();
        (total, hosted)
    }

    pub async fn setup_history_callback(&self, recorder: TerminalRecorder) {
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

        info!("History callback set successfully");
    }

    pub async fn shutdown(&self) -> Result<()> {
        info!("Shutting down session manager");
        
        // Clear all active sessions
        {
            let mut sessions = self.active_sessions.write().await;
            sessions.clear();
        }

        // Shutdown network
        self.network.shutdown().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::ShellType;

    #[tokio::test]
    async fn test_session_info_creation() {
        let session_info = SessionInfo {
            session_id: "test-session".to_string(),
            is_host: true,
            shell_type: ShellType::Bash,
            width: 80,
            height: 24,
            title: Some("Test Session".to_string()),
        };

        assert_eq!(session_info.session_id, "test-session");
        assert!(session_info.is_host);
        assert_eq!(session_info.width, 80);
        assert_eq!(session_info.height, 24);
    }

    #[test]
    fn test_app_config_defaults() {
        let config = crate::config::AppConfig::default();
        
        assert_eq!(config.default_width, 80);
        assert_eq!(config.default_height, 24);
        assert_eq!(config.max_retry_attempts, 3);
        assert_eq!(config.channel_buffer_size, 1000);
    }
}