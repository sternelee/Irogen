use crate::terminal_events::TerminalEvent;
use tauri::{AppHandle, Manager};
use tokio::sync::broadcast;

/// Event management for real-time updates
pub struct EventManager {
    app_handle: AppHandle,
}

impl EventManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    /// Start listening for terminal events and forward them to the frontend
    pub async fn start_terminal_event_listener(
        &self,
        session_id: String,
        mut receiver: broadcast::Receiver<TerminalEvent>,
    ) {
        let app_handle = self.app_handle.clone();

        tokio::spawn(async move {
            while let Ok(event) = receiver.recv().await {
                let event_data = serde_json::json!({
                    "session_id": session_id,
                    "event_type": event.event_type,
                    "data": event.data,
                    "timestamp": event.timestamp,
                });

                // Emit event to frontend
                if let Err(e) = app_handle.emit("terminal-event", &event_data) {
                    eprintln!("Failed to emit terminal event: {}", e);
                }
            }
        });
    }

    /// Emit a session status update
    pub fn emit_session_status(&self, session_id: &str, status: &str) {
        let status_data = serde_json::json!({
            "session_id": session_id,
            "status": status,
            "timestamp": chrono::Utc::now().timestamp(),
        });

        if let Err(e) = self.app_handle.emit("session-status", &status_data) {
            eprintln!("Failed to emit session status: {}", e);
        }
    }

    /// Emit a network status update
    pub fn emit_network_status(&self, status: &str, details: Option<serde_json::Value>) {
        let status_data = serde_json::json!({
            "status": status,
            "details": details,
            "timestamp": chrono::Utc::now().timestamp(),
        });

        if let Err(e) = self.app_handle.emit("network-status", &status_data) {
            eprintln!("Failed to emit network status: {}", e);
        }
    }
}

