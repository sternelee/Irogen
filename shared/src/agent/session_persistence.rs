//! Session persistence for ACP agent sessions
//!
//! This module provides file-system based persistence for agent session state,
//! including conversation history, token usage, and configuration.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

use crate::message_protocol::AgentType;

/// Schema version for session record compatibility
const SESSION_RECORD_SCHEMA: &str = "acpx.session.v1";

/// Token usage statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTokenUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}

/// A single message in the conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    pub timestamp: Option<String>,
    pub attachments: Option<Vec<String>>,
}

/// Session configuration options
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub model: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub max_turns: Option<u32>,
    pub system_prompt: Option<String>,
}

/// Persistent record of an ACP agent session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    /// Schema version for compatibility
    pub schema: String,
    /// Unique record ID (acpx internal)
    pub acpx_record_id: String,
    /// ACP session ID (from the agent)
    pub acp_session_id: String,
    /// Agent-specific session ID (if different from ACP)
    pub agent_session_id: Option<String>,
    /// Agent command used to start the session
    pub agent_command: String,
    /// Working directory
    pub cwd: String,
    /// Optional session name
    pub name: Option<String>,
    /// Creation timestamp (ISO 8601)
    pub created_at: String,
    /// Last activity timestamp
    pub last_used_at: String,
    /// Sequence number for ordering
    pub last_seq: u64,
    /// Whether the session is closed
    pub closed: bool,
    /// When the session was closed
    pub closed_at: Option<String>,
    /// Agent process ID
    pub pid: Option<u32>,
    /// When the agent was started
    pub agent_started_at: Option<String>,
    /// Last prompt timestamp
    pub last_prompt_at: Option<String>,
    /// Last agent exit code
    pub last_agent_exit_code: Option<i32>,
    /// Last agent exit signal
    pub last_agent_exit_signal: Option<String>,
    /// When the agent last exited
    pub last_agent_exit_at: Option<String>,
    /// Disconnect reason
    pub last_agent_disconnect_reason: Option<String>,
    /// Protocol version
    pub protocol_version: Option<u32>,
    /// Session title (if set by agent)
    pub title: Option<String>,
    /// Conversation messages
    pub messages: Vec<SessionMessage>,
    /// Cumulative token usage
    pub cumulative_token_usage: SessionTokenUsage,
    /// Per-request token usage
    pub request_token_usage: HashMap<String, SessionTokenUsage>,
    /// Session configuration
    pub config: SessionConfig,
    /// Agent type
    pub agent_type: AgentType,
}

impl SessionRecord {
    /// Create a new session record
    pub fn new(
        acpx_record_id: String,
        acp_session_id: String,
        agent_command: String,
        cwd: String,
        agent_type: AgentType,
    ) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            schema: SESSION_RECORD_SCHEMA.to_string(),
            acpx_record_id,
            acp_session_id,
            agent_session_id: None,
            agent_command,
            cwd,
            name: None,
            created_at: now.clone(),
            last_used_at: now,
            last_seq: 0,
            closed: false,
            closed_at: None,
            pid: None,
            agent_started_at: None,
            last_prompt_at: None,
            last_agent_exit_code: None,
            last_agent_exit_signal: None,
            last_agent_exit_at: None,
            last_agent_disconnect_reason: None,
            protocol_version: None,
            title: None,
            messages: Vec::new(),
            cumulative_token_usage: SessionTokenUsage::default(),
            request_token_usage: HashMap::new(),
            config: SessionConfig::default(),
            agent_type,
        }
    }

    /// Add a message to the conversation
    pub fn add_message(&mut self, role: &str, content: &str) {
        self.messages.push(SessionMessage {
            role: role.to_string(),
            content: content.to_string(),
            timestamp: Some(chrono::Utc::now().to_rfc3339()),
            attachments: None,
        });
        self.last_seq += 1;
        self.last_used_at = chrono::Utc::now().to_rfc3339();
    }

    /// Mark the session as closed
    pub fn close(&mut self) {
        self.closed = true;
        self.closed_at = Some(chrono::Utc::now().to_rfc3339());
    }

    /// Update token usage
    pub fn add_token_usage(&mut self, request_id: &str, usage: SessionTokenUsage) {
        self.request_token_usage
            .insert(request_id.to_string(), usage.clone());
        // Update cumulative
        if let Some(input) = usage.input_tokens {
            self.cumulative_token_usage.input_tokens =
                Some(self.cumulative_token_usage.input_tokens.unwrap_or(0) + input);
        }
        if let Some(output) = usage.output_tokens {
            self.cumulative_token_usage.output_tokens =
                Some(self.cumulative_token_usage.output_tokens.unwrap_or(0) + output);
        }
    }

    /// Save the record to disk
    pub async fn save(&self, base_dir: &Path) -> std::io::Result<()> {
        let path = session_record_path(base_dir, &self.acpx_record_id);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        tokio::fs::write(&path, json).await?;
        debug!("Saved session record to {}", path.display());
        Ok(())
    }

    /// Load a record from disk
    pub async fn load(base_dir: &Path, record_id: &str) -> std::io::Result<Option<Self>> {
        let path = session_record_path(base_dir, record_id);
        if !path.exists() {
            return Ok(None);
        }
        let json = tokio::fs::read_to_string(&path).await?;
        let record: SessionRecord = serde_json::from_str(&json)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        Ok(Some(record))
    }

    /// Delete a record from disk
    pub async fn delete(base_dir: &Path, record_id: &str) -> std::io::Result<()> {
        let path = session_record_path(base_dir, record_id);
        if path.exists() {
            tokio::fs::remove_file(&path).await?;
            info!("Deleted session record {}", record_id);
        }
        Ok(())
    }

    /// List all persisted session records
    pub async fn list_all(base_dir: &Path) -> std::io::Result<Vec<Self>> {
        let mut records = Vec::new();
        let sessions_dir = base_dir.join("sessions");
        if !sessions_dir.exists() {
            return Ok(records);
        }

        let mut entries = tokio::fs::read_dir(&sessions_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                let json = tokio::fs::read_to_string(&path).await?;
                if let Ok(record) = serde_json::from_str::<SessionRecord>(&json) {
                    records.push(record);
                } else {
                    warn!("Failed to parse session record at {}", path.display());
                }
            }
        }

        // Sort by last_used_at descending
        records.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
        Ok(records)
    }

    /// Find sessions by agent type
    pub async fn find_by_agent_type(
        base_dir: &Path,
        agent_type: AgentType,
    ) -> std::io::Result<Vec<Self>> {
        let all = Self::list_all(base_dir).await?;
        Ok(all
            .into_iter()
            .filter(|r| r.agent_type == agent_type)
            .collect())
    }
}

/// Get the file path for a session record
fn session_record_path(base_dir: &Path, record_id: &str) -> PathBuf {
    base_dir
        .join("sessions")
        .join(format!("{}.json", record_id))
}

/// Get the default sessions directory
pub fn default_sessions_dir() -> PathBuf {
    if let Some(config_dir) = dirs::config_dir() {
        config_dir.join("irogen").join("sessions")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".irogen").join("sessions")
    } else {
        PathBuf::from(".irogen").join("sessions")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_session_record_save_load() {
        let temp_dir = tempfile::tempdir().unwrap();
        let record = SessionRecord::new(
            "test-123".to_string(),
            "acp-session-456".to_string(),
            "claude-agent-acp".to_string(),
            "/tmp".to_string(),
            AgentType::ClaudeCode,
        );

        record.save(temp_dir.path()).await.unwrap();
        let loaded = SessionRecord::load(temp_dir.path(), "test-123")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(loaded.acpx_record_id, "test-123");
        assert_eq!(loaded.acp_session_id, "acp-session-456");
        assert_eq!(loaded.agent_type, AgentType::ClaudeCode);
    }

    #[tokio::test]
    async fn test_session_record_messages() {
        let temp_dir = tempfile::tempdir().unwrap();
        let mut record = SessionRecord::new(
            "test-456".to_string(),
            "acp-session-789".to_string(),
            "codex-acp".to_string(),
            "/workspace".to_string(),
            AgentType::Codex,
        );

        record.add_message("user", "Hello");
        record.add_message("assistant", "Hi there!");
        assert_eq!(record.messages.len(), 2);

        record.save(temp_dir.path()).await.unwrap();
        let loaded = SessionRecord::load(temp_dir.path(), "test-456")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.messages.len(), 2);
    }
}
