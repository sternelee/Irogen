//! Session storage module for persistent agent sessions.
//!
//! This module provides:
//! - `SessionStore` trait for session persistence
//! - `SessionRecord` data structure for storing session metadata and messages
//! - `SqliteSessionStore` implementation using SQLite

pub mod sqlite;

pub use sqlite::SqliteSessionStore;

use std::path::PathBuf;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::message_protocol::AgentType;

/// Session status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    /// Session is currently active
    Active,
    /// Session is paused (can be resumed)
    Paused,
    /// Session has completed
    Completed,
}

impl Default for SessionStatus {
    fn default() -> Self {
        SessionStatus::Active
    }
}

impl std::fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionStatus::Active => write!(f, "active"),
            SessionStatus::Paused => write!(f, "paused"),
            SessionStatus::Completed => write!(f, "completed"),
        }
    }
}

impl std::str::FromStr for SessionStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "active" => Ok(SessionStatus::Active),
            "paused" => Ok(SessionStatus::Paused),
            "completed" => Ok(SessionStatus::Completed),
            _ => Err(format!("Unknown session status: {}", s)),
        }
    }
}

/// A single chat message in a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// Unique message ID
    pub id: String,
    /// Whether this is a user message or agent message
    pub is_user: bool,
    /// Message content (text)
    pub content: String,
    /// Timestamp (Unix epoch milliseconds)
    pub timestamp: u64,
    /// Sequence number for ordering
    pub sequence: u64,
    /// Attachments (file paths)
    #[serde(default)]
    pub attachments: Option<Vec<String>>,
}

/// Session record - persisted representation of an agent session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    /// Unique session ID
    pub session_id: String,
    /// Agent type (ClaudeCode, OpenCode, etc.)
    pub agent_type: AgentType,
    /// Project/working directory path
    pub project_path: String,
    /// Session start time (Unix epoch milliseconds)
    pub started_at: u64,
    /// Last activity time (Unix epoch milliseconds)
    pub last_active_at: u64,
    /// Current session status
    pub status: SessionStatus,
    /// Hostname where session was created
    pub hostname: String,
    /// Operating system
    pub os: String,
    /// Chat messages history
    pub messages: Vec<ChatMessage>,
    /// Extra metadata (JSON string for flexibility)
    pub metadata_json: String,
}

/// Filter for listing sessions
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionFilter {
    /// Filter by agent type
    pub agent_type: Option<AgentType>,
    /// Filter by status
    pub status: Option<SessionStatus>,
    /// Filter by project path
    pub project_path: Option<String>,
    /// Maximum number of results
    pub limit: Option<usize>,
    /// Offset for pagination
    pub offset: Option<usize>,
}

/// Session store trait for persistence
#[async_trait]
pub trait SessionStore: Send + Sync {
    /// Save a session record
    async fn save_session(&self, record: &SessionRecord) -> anyhow::Result<()>;

    /// Load a session by ID
    async fn load_session(&self, session_id: &str) -> anyhow::Result<Option<SessionRecord>>;

    /// List sessions with optional filter
    async fn list_sessions(&self, filter: &SessionFilter) -> anyhow::Result<Vec<SessionRecord>>;

    /// Update an existing session
    async fn update_session(&self, record: &SessionRecord) -> anyhow::Result<()>;

    /// Delete a session
    async fn delete_session(&self, session_id: &str) -> anyhow::Result<()>;

    /// Add a message to a session
    async fn add_message(&self, session_id: &str, message: &ChatMessage) -> anyhow::Result<()>;

    /// Get messages for a session
    async fn get_messages(&self, session_id: &str) -> anyhow::Result<Vec<ChatMessage>>;
}

/// Create a new SQLite-backed session store
pub fn create_session_store(data_dir: &PathBuf) -> anyhow::Result<sqlite::SqliteSessionStore> {
    sqlite::SqliteSessionStore::new(data_dir)
}
