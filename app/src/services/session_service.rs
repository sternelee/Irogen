use crate::config::MobileConfig;
use crate::error::{AppError, AppResult};
use crate::p2p::{GossipSender, P2PNetwork, SessionTicket};
use crate::terminal::TerminalEvent;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};

/// Session information for mobile app
#[derive(Debug, Clone)]
pub struct MobileSessionInfo {
    pub session_id: String,
    pub is_host: bool,
    pub status: SessionStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_activity: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SessionStatus {
    Connecting,
    Connected,
    Disconnected,
    Error(String),
}

/// Session service for managing terminal sessions
pub struct SessionService {
    sessions: Arc<RwLock<HashMap<String, SessionData>>>,
    config: MobileConfig,
}

struct SessionData {
    info: MobileSessionInfo,
    sender: Option<GossipSender>,
    receiver: Option<broadcast::Receiver<TerminalEvent>>,
}

impl SessionService {
    pub fn new(config: MobileConfig) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Join a session using a ticket
    pub async fn join_session(&self, ticket: String, network: &P2PNetwork) -> AppResult<String> {
        // Parse ticket
        let parsed_ticket = ticket
            .parse::<SessionTicket>()
            .map_err(|e| AppError::InvalidTicket(e.to_string()))?;

        // Join session
        let (sender, receiver) = network
            .join_session(parsed_ticket)
            .await
            .map_err(|e| AppError::JoinFailed(e.to_string()))?;

        let session_id = format!("session_{}", sender.topic());
        let now = chrono::Utc::now();

        // Create session info
        let session_info = MobileSessionInfo {
            session_id: session_id.clone(),
            is_host: false,
            status: SessionStatus::Connected,
            created_at: now,
            last_activity: now,
        };

        // Store session data
        let session_data = SessionData {
            info: session_info,
            sender: Some(sender),
            receiver: Some(receiver),
        };

        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id.clone(), session_data);

        Ok(session_id)
    }

    /// Create a new hosted session
    pub async fn create_session(
        &self,
        network: &P2PNetwork,
        title: Option<String>,
    ) -> AppResult<(String, String)> {
        // Create session header
        let header = crate::terminal::SessionHeader {
            version: 2,
            width: 80,
            height: 24,
            timestamp: chrono::Utc::now().timestamp() as u64,
            title,
            command: None,
            session_id: uuid::Uuid::new_v4().to_string(),
        };

        let session_id = header.session_id.clone();

        // Create shared session
        let (topic_id, sender, input_receiver) = network
            .create_shared_session(header)
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        // Create session ticket
        let ticket = network
            .create_session_ticket(topic_id, &session_id)
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?;

        let now = chrono::Utc::now();

        // Create session info
        let session_info = MobileSessionInfo {
            session_id: session_id.clone(),
            is_host: true,
            status: SessionStatus::Connected,
            created_at: now,
            last_activity: now,
        };

        // Store session data
        let session_data = SessionData {
            info: session_info,
            sender: Some(sender),
            receiver: None, // Host doesn't need receiver for now
        };

        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id.clone(), session_data);

        Ok((session_id, ticket.to_string()))
    }

    /// Get session information
    pub async fn get_session_info(&self, session_id: &str) -> AppResult<MobileSessionInfo> {
        let sessions = self.sessions.read().await;

        match sessions.get(session_id) {
            Some(session_data) => Ok(session_data.info.clone()),
            None => Err(AppError::SessionNotFound(session_id.to_string())),
        }
    }

    /// List all active sessions
    pub async fn list_sessions(&self) -> Vec<MobileSessionInfo> {
        let sessions = self.sessions.read().await;
        sessions.values().map(|data| data.info.clone()).collect()
    }

    /// Update session activity
    pub async fn update_activity(&self, session_id: &str) -> AppResult<()> {
        let mut sessions = self.sessions.write().await;

        if let Some(session_data) = sessions.get_mut(session_id) {
            session_data.info.last_activity = chrono::Utc::now();
            Ok(())
        } else {
            Err(AppError::SessionNotFound(session_id.to_string()))
        }
    }

    /// Disconnect from a session
    pub async fn disconnect_session(&self, session_id: &str) -> AppResult<()> {
        let mut sessions = self.sessions.write().await;

        if let Some(mut session_data) = sessions.remove(session_id) {
            session_data.info.status = SessionStatus::Disconnected;

            // Clean up sender
            if let Some(sender) = session_data.sender.take() {
                drop(sender);
            }

            // Clean up receiver
            if let Some(receiver) = session_data.receiver.take() {
                drop(receiver);
            }

            Ok(())
        } else {
            Err(AppError::SessionNotFound(session_id.to_string()))
        }
    }

    /// Get session sender for sending messages
    pub async fn get_session_sender(&self, session_id: &str) -> AppResult<GossipSender> {
        let sessions = self.sessions.read().await;

        match sessions.get(session_id) {
            Some(session_data) => match &session_data.sender {
                Some(sender) => Ok(sender.clone()),
                None => Err(AppError::SessionNotActive(session_id.to_string())),
            },
            None => Err(AppError::SessionNotFound(session_id.to_string())),
        }
    }

    /// Get session statistics
    pub async fn get_stats(&self) -> serde_json::Value {
        let sessions = self.sessions.read().await;
        let total = sessions.len();
        let hosted = sessions.values().filter(|data| data.info.is_host).count();
        let connected = sessions
            .values()
            .filter(|data| data.info.status == SessionStatus::Connected)
            .count();

        serde_json::json!({
            "total_sessions": total,
            "hosted_sessions": hosted,
            "participant_sessions": total - hosted,
            "connected_sessions": connected,
        })
    }
}

