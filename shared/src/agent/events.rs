//! Unified agent event types for streaming output
#![allow(dead_code)]
//!
//! All agent types (Claude Code, OpenCode, Codex, Gemini) emit events
//! that are converted to this unified format before being forwarded
//! to P2P clients.
//!
//! # Event Types
//!
//! The event system provides granular visibility into agent operations:
//!
//! ## Session Lifecycle Events
//! - `SessionStarted` - Agent session has been initialized
//! - `SessionEnded` - Agent session has been terminated
//!
//! ## Turn/Response Events
//! - `TurnStarted` - A new turn/response is being generated
//! - `TextDelta` - Streaming text content from the agent
//! - `ReasoningDelta` - Streaming reasoning/thinking content
//! - `TurnCompleted` - The turn completed successfully
//! - `TurnError` - The turn failed with an error
//!
//! ## Tool Execution Events
//! - `ToolStarted` - A tool call has been initiated
//! - `ToolInputUpdated` - Tool input is being streamed/updated
//! - `ToolCompleted` - A tool call has finished (success or failure)
//!
//! ## Permission Events
//! - `ApprovalRequest` - Agent requires user approval for an action
//!
//! ## Monitoring Events
//! - `UsageUpdate` - Token usage and context information
//! - `ProgressUpdate` - Progress indicator for long-running operations
//! - `Notification` - General notifications with severity levels
//!
//! # Event Flow
//!
//! A typical agent interaction follows this event sequence:
//!
//! ```text
//! SessionStarted
//!   ├─> TurnStarted
//!   │    ├─> ReasoningDelta (optional)
//!   │    ├─> TextDelta (streaming)
//!   │    │    ├─> ToolStarted
//!   │    │    │    ├─> ApprovalRequest (if needed)
//!   │    │    │    ├─> ToolInputUpdated (streaming)
//!   │    │    │    └─> ToolCompleted
//!   │    │    └─> TextDelta (continues)
//!   │    └─> TurnCompleted or TurnError
//!   └─> UsageUpdate (periodic)
//! └─> SessionEnded
//! ```

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::message_protocol::{AgentType, NotificationLevel, ToolCallStatus};

/// Unified agent event for frontend consumption
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentEvent {
    /// Session/conversation started
    #[serde(rename = "session:started")]
    SessionStarted {
        session_id: String,
        agent: AgentType,
    },

    /// Turn/response started
    #[serde(rename = "turn:started")]
    TurnStarted { session_id: String, turn_id: String },

    /// Text content delta (streaming)
    #[serde(rename = "text:delta")]
    TextDelta { session_id: String, text: String },

    /// Reasoning/thinking content (for models that expose it)
    #[serde(rename = "reasoning:delta")]
    ReasoningDelta { session_id: String, text: String },

    /// Tool use started
    #[serde(rename = "tool:started")]
    ToolStarted {
        session_id: String,
        tool_id: String,
        tool_name: String,
        /// JSON string for bincode compatibility
        #[serde(default)]
        input: Option<String>,
    },

    /// Tool use completed
    #[serde(rename = "tool:completed")]
    ToolCompleted {
        session_id: String,
        tool_id: String,
        #[serde(default)]
        tool_name: Option<String>,
        /// JSON string for bincode compatibility
        #[serde(default)]
        output: Option<String>,
        #[serde(default)]
        error: Option<String>,
    },

    /// Tool input updated (streaming arguments)
    #[serde(rename = "tool:inputUpdated")]
    ToolInputUpdated {
        session_id: String,
        tool_id: String,
        #[serde(default)]
        tool_name: Option<String>,
        /// JSON string for bincode compatibility
        #[serde(default)]
        input: Option<String>,
    },

    /// Approval request from agent
    #[serde(rename = "approval:request")]
    ApprovalRequest {
        session_id: String,
        request_id: String,
        tool_name: String,
        /// JSON string for bincode compatibility
        #[serde(default)]
        input: Option<String>,
        #[serde(default)]
        message: Option<String>,
    },

    /// Turn/response completed
    #[serde(rename = "turn:completed")]
    TurnCompleted {
        session_id: String,
        /// JSON string for bincode compatibility
        #[serde(default)]
        result: Option<String>,
    },

    /// Turn/response error
    #[serde(rename = "turn:error")]
    TurnError {
        session_id: String,
        error: String,
        #[serde(default)]
        code: Option<String>,
    },

    /// Session ended
    #[serde(rename = "session:ended")]
    SessionEnded { session_id: String },

    /// Usage/token information
    #[serde(rename = "usage:update")]
    UsageUpdate {
        session_id: String,
        #[serde(default)]
        input_tokens: Option<i64>,
        #[serde(default)]
        output_tokens: Option<i64>,
        #[serde(default)]
        cached_tokens: Option<i64>,
        #[serde(default)]
        model_context_window: Option<i64>,
    },

    /// Progress update for long-running operations
    #[serde(rename = "progress:update")]
    ProgressUpdate {
        session_id: String,
        operation: String,
        progress: f32, // 0.0 to 1.0
        #[serde(default)]
        message: Option<String>,
    },

    /// General notification with severity level
    #[serde(rename = "notification")]
    Notification {
        session_id: String,
        level: NotificationLevel,
        message: String,
        /// JSON string for bincode compatibility
        #[serde(default)]
        details: Option<String>,
    },

    /// File operation notification (for ACP file operations)
    #[serde(rename = "file:operation")]
    FileOperation {
        session_id: String,
        operation: FileOperationType,
        path: String,
        #[serde(default)]
        status: Option<String>,
    },

    /// Terminal output from shell operations
    #[serde(rename = "terminal:output")]
    TerminalOutput {
        session_id: String,
        command: String,
        output: String,
        #[serde(default)]
        exit_code: Option<i32>,
    },

    /// Raw agent-specific event (passthrough)
    #[serde(rename = "raw")]
    Raw {
        session_id: String,
        agent: AgentType,
        /// Data as JSON string for bincode compatibility
        data: String,
    },
}

/// File operation types for ACP file operations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileOperationType {
    Read,
    Write,
    Create,
    Delete,
    Move,
    Copy,
}

impl std::fmt::Display for FileOperationType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileOperationType::Read => write!(f, "read"),
            FileOperationType::Write => write!(f, "write"),
            FileOperationType::Create => write!(f, "create"),
            FileOperationType::Delete => write!(f, "delete"),
            FileOperationType::Move => write!(f, "move"),
            FileOperationType::Copy => write!(f, "copy"),
        }
    }
}

impl AgentEvent {
    /// Get the session ID for this event
    pub fn session_id(&self) -> &str {
        match self {
            AgentEvent::SessionStarted { session_id, .. } => session_id,
            AgentEvent::TurnStarted { session_id, .. } => session_id,
            AgentEvent::TextDelta { session_id, .. } => session_id,
            AgentEvent::ReasoningDelta { session_id, .. } => session_id,
            AgentEvent::ToolStarted { session_id, .. } => session_id,
            AgentEvent::ToolCompleted { session_id, .. } => session_id,
            AgentEvent::ToolInputUpdated { session_id, .. } => session_id,
            AgentEvent::ApprovalRequest { session_id, .. } => session_id,
            AgentEvent::TurnCompleted { session_id, .. } => session_id,
            AgentEvent::TurnError { session_id, .. } => session_id,
            AgentEvent::SessionEnded { session_id } => session_id,
            AgentEvent::UsageUpdate { session_id, .. } => session_id,
            AgentEvent::ProgressUpdate { session_id, .. } => session_id,
            AgentEvent::Notification { session_id, .. } => session_id,
            AgentEvent::FileOperation { session_id, .. } => session_id,
            AgentEvent::TerminalOutput { session_id, .. } => session_id,
            AgentEvent::Raw { session_id, .. } => session_id,
        }
    }

    /// Check if this is a terminal event (turn completed or error)
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            AgentEvent::TurnCompleted { .. } | AgentEvent::TurnError { .. }
        )
    }

    /// Check if this event requires user action
    pub fn requires_action(&self) -> bool {
        matches!(self, AgentEvent::ApprovalRequest { .. })
    }

    /// Get the turn ID if this is a turn-scoped event
    pub fn turn_id(&self) -> Option<&str> {
        match self {
            AgentEvent::TurnStarted { turn_id, .. } => Some(turn_id),
            _ => None,
        }
    }
}

/// Event wrapper with turn ID for broadcast channel
#[derive(Debug, Clone)]
pub struct AgentTurnEvent {
    pub turn_id: String,
    pub event: AgentEvent,
}

/// Pending permission request state
#[derive(Debug)]
pub struct PendingPermission {
    pub request_id: String,
    pub session_id: String,
    pub tool_name: String,
    pub tool_params: Value,
    pub message: Option<String>,
    pub created_at: u64,
    pub response_tx: Option<tokio::sync::oneshot::Sender<PermissionResponse>>,
}

impl Clone for PendingPermission {
    fn clone(&self) -> Self {
        Self {
            request_id: self.request_id.clone(),
            session_id: self.session_id.clone(),
            tool_name: self.tool_name.clone(),
            tool_params: self.tool_params.clone(),
            message: self.message.clone(),
            created_at: self.created_at,
            response_tx: None, // Cannot clone oneshot sender
        }
    }
}

/// Permission response from remote client
#[derive(Debug, Clone)]
pub struct PermissionResponse {
    pub approved: bool,
    pub reason: Option<String>,
}

/// Convert AgentEvent to ClawdChat message protocol types
impl AgentEvent {
    /// Convert to AgentMessageContent for P2P transmission
    pub fn to_agent_message_content(
        &self,
        message_id: Option<String>,
    ) -> crate::message_protocol::AgentMessageContent {
        use crate::message_protocol::AgentMessageContent;

        match self {
            AgentEvent::TextDelta { text, .. } => AgentMessageContent::AgentResponse {
                content: text.clone(),
                thinking: false,
                message_id,
            },

            AgentEvent::ReasoningDelta { text, .. } => AgentMessageContent::AgentResponse {
                content: text.clone(),
                thinking: true,
                message_id,
            },

            AgentEvent::ToolStarted { tool_name, .. } => AgentMessageContent::ToolCallUpdate {
                tool_name: tool_name.clone(),
                status: ToolCallStatus::Started,
                output: None,
            },

            AgentEvent::ToolInputUpdated {
                tool_name, input, ..
            } => {
                AgentMessageContent::ToolCallUpdate {
                    tool_name: tool_name.clone().unwrap_or_else(|| "unknown".to_string()),
                    status: ToolCallStatus::InProgress,
                    output: input.clone(),
                }
            }

            AgentEvent::ToolCompleted {
                tool_name,
                output,
                error,
                ..
            } => {
                let status = if error.is_some() {
                    ToolCallStatus::Failed
                } else {
                    ToolCallStatus::Completed
                };
                AgentMessageContent::ToolCallUpdate {
                    tool_name: tool_name.clone().unwrap_or_else(|| "unknown".to_string()),
                    status,
                    output: output.clone().or(error.clone()),
                }
            }

            AgentEvent::ApprovalRequest {
                tool_name, message, ..
            } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Warning,
                message: format!(
                    "Permission required for {}: {}",
                    tool_name,
                    message.as_deref().unwrap_or("No description")
                ),
            },

            AgentEvent::TurnError { error, .. } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Error,
                message: error.clone(),
            },

            AgentEvent::UsageUpdate { .. } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Info,
                message: String::new(),
            },

            AgentEvent::SessionStarted { .. } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Info,
                message: "Session started".to_string(),
            },

            AgentEvent::SessionEnded { .. } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Info,
                message: "Session ended".to_string(),
            },

            AgentEvent::TurnStarted { .. } | AgentEvent::TurnCompleted { .. } => {
                AgentMessageContent::SystemNotification {
                    level: NotificationLevel::Info,
                    message: String::new(),
                }
            }

            AgentEvent::Raw { data, .. } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Info,
                message: data.to_string(),
            },

            AgentEvent::ProgressUpdate {
                operation,
                progress,
                message,
                ..
            } => {
                let msg = match message {
                    Some(m) => format!("{}: {} ({:.0}%)", operation, m, progress * 100.0),
                    None => format!("{}: {:.0}%", operation, progress * 100.0),
                };
                AgentMessageContent::SystemNotification {
                    level: NotificationLevel::Info,
                    message: msg,
                }
            }

            AgentEvent::Notification { level, message, .. } => {
                AgentMessageContent::SystemNotification {
                    level: level.clone(),
                    message: message.clone(),
                }
            }

            AgentEvent::FileOperation {
                operation, path, ..
            } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Info,
                message: format!("File operation: {} {}", operation, path),
            },

            AgentEvent::TerminalOutput {
                command,
                output,
                exit_code,
                ..
            } => {
                let msg = match exit_code {
                    Some(0) => format!("Command completed: {}\n{}", command, output),
                    Some(code) => {
                        format!("Command failed (exit {}): {}\n{}", code, command, output)
                    }
                    None => format!("Command output: {}\n{}", command, output),
                };
                AgentMessageContent::SystemNotification {
                    level: NotificationLevel::Info,
                    message: msg,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_serialization() {
        let event = AgentEvent::TextDelta {
            session_id: "session-1".to_string(),
            text: "Hello".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"text:delta\""));
        assert!(json.contains("\"session_id\":\"session-1\""));
    }

    #[test]
    fn event_session_id() {
        let event = AgentEvent::TurnStarted {
            session_id: "session-test".to_string(),
            turn_id: "turn-1".to_string(),
        };

        assert_eq!(event.session_id(), "session-test");
    }

    #[test]
    fn event_is_terminal() {
        let completed = AgentEvent::TurnCompleted {
            session_id: "session-1".to_string(),
            result: None,
        };
        assert!(completed.is_terminal());

        let delta = AgentEvent::TextDelta {
            session_id: "session-1".to_string(),
            text: "test".to_string(),
        };
        assert!(!delta.is_terminal());
    }

    #[test]
    fn event_requires_action() {
        let approval = AgentEvent::ApprovalRequest {
            session_id: "session-1".to_string(),
            request_id: "req-1".to_string(),
            tool_name: "bash".to_string(),
            input: None,
            message: Some("Run command?".to_string()),
        };
        assert!(approval.requires_action());

        let delta = AgentEvent::TextDelta {
            session_id: "session-1".to_string(),
            text: "test".to_string(),
        };
        assert!(!delta.requires_action());
    }
}
