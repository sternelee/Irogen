use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::config::MobileConfig;
use crate::error::{AppError, AppResult};
use crate::p2p::{P2PNetwork, GossipSender};

/// Terminal history entry
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TerminalHistoryEntry {
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub entry_type: TerminalEntryType,
    pub content: String,
    pub session_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum TerminalEntryType {
    Input,
    Output,
    Command,
    System,
}

/// Terminal service for managing terminal I/O
pub struct TerminalService {
    history: Arc<RwLock<HashMap<String, Vec<TerminalHistoryEntry>>>>,
    config: MobileConfig,
}

impl TerminalService {
    pub fn new(config: MobileConfig) -> Self {
        Self {
            history: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Send input to a terminal session
    pub async fn send_input(
        &self,
        session_id: &str,
        input: String,
        sender: &GossipSender,
        network: &P2PNetwork,
    ) -> AppResult<()> {
        // Send input through network
        network.send_input(sender, input.clone(), session_id).await
            .map_err(|e| AppError::SendFailed(e.to_string()))?;

        // Record in history
        self.add_history_entry(
            session_id,
            TerminalEntryType::Input,
            input,
        ).await;

        Ok(())
    }

    /// Send a command to a terminal session
    pub async fn send_command(
        &self,
        session_id: &str,
        command: String,
        sender: &GossipSender,
        network: &P2PNetwork,
    ) -> AppResult<()> {
        // Add newline to command
        let command_with_newline = format!("{}\n", command);

        // Send command through network
        network.send_input(sender, command_with_newline.clone(), session_id).await
            .map_err(|e| AppError::SendFailed(e.to_string()))?;

        // Record in history
        self.add_history_entry(
            session_id,
            TerminalEntryType::Command,
            command,
        ).await;

        Ok(())
    }

    /// Send output to a terminal session (for hosts)
    pub async fn send_output(
        &self,
        session_id: &str,
        output: String,
        sender: &GossipSender,
        network: &P2PNetwork,
    ) -> AppResult<()> {
        // Send output through network
        network.send_terminal_output(sender, output.clone(), session_id).await
            .map_err(|e| AppError::SendFailed(e.to_string()))?;

        // Record in history
        self.add_history_entry(
            session_id,
            TerminalEntryType::Output,
            output,
        ).await;

        Ok(())
    }

    /// Add entry to terminal history
    pub async fn add_history_entry(
        &self,
        session_id: &str,
        entry_type: TerminalEntryType,
        content: String,
    ) {
        let entry = TerminalHistoryEntry {
            timestamp: chrono::Utc::now(),
            entry_type,
            content,
            session_id: session_id.to_string(),
        };

        let mut history = self.history.write().await;
        let session_history = history.entry(session_id.to_string()).or_insert_with(Vec::new);

        session_history.push(entry);

        // Limit history size
        if session_history.len() > self.config.session.max_history_lines {
            session_history.remove(0);
        }
    }

    /// Get terminal history for a session
    pub async fn get_history(&self, session_id: &str) -> Vec<TerminalHistoryEntry> {
        let history = self.history.read().await;
        history.get(session_id).cloned().unwrap_or_default()
    }

    /// Get recent history (last N entries)
    pub async fn get_recent_history(&self, session_id: &str, count: usize) -> Vec<TerminalHistoryEntry> {
        let history = self.history.read().await;

        if let Some(session_history) = history.get(session_id) {
            let start = if session_history.len() > count {
                session_history.len() - count
            } else {
                0
            };
            session_history[start..].to_vec()
        } else {
            Vec::new()
        }
    }

    /// Clear history for a session
    pub async fn clear_history(&self, session_id: &str) {
        let mut history = self.history.write().await;
        history.remove(session_id);
    }

    /// Get history statistics
    pub async fn get_history_stats(&self, session_id: &str) -> serde_json::Value {
        let history = self.history.read().await;

        if let Some(session_history) = history.get(session_id) {
            let total_entries = session_history.len();
            let input_count = session_history.iter()
                .filter(|e| matches!(e.entry_type, TerminalEntryType::Input))
                .count();
            let output_count = session_history.iter()
                .filter(|e| matches!(e.entry_type, TerminalEntryType::Output))
                .count();
            let command_count = session_history.iter()
                .filter(|e| matches!(e.entry_type, TerminalEntryType::Command))
                .count();

            serde_json::json!({
                "total_entries": total_entries,
                "input_count": input_count,
                "output_count": output_count,
                "command_count": command_count,
                "first_entry": session_history.first().map(|e| e.timestamp),
                "last_entry": session_history.last().map(|e| e.timestamp),
            })
        } else {
            serde_json::json!({
                "total_entries": 0,
                "input_count": 0,
                "output_count": 0,
                "command_count": 0,
                "first_entry": null,
                "last_entry": null,
            })
        }
    }

    /// Export history to JSON
    pub async fn export_history(&self, session_id: &str) -> AppResult<String> {
        let history = self.get_history(session_id).await;
        serde_json::to_string_pretty(&history)
            .map_err(|e| AppError::ParseError(e.to_string()))
    }
}
