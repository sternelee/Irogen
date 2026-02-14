//! Unified agent event types for streaming output
#![allow(dead_code)]
//!
//! All agent types (Claude Code, OpenCode, Codex, Gemini) emit events
//! that are converted to this unified format before being forwarded
//! to P2P clients.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use riterm_shared::message_protocol::{AgentType, NotificationLevel, ToolCallStatus};

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
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },

    /// Tool use completed
    #[serde(rename = "tool:completed")]
    ToolCompleted {
        session_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// Tool input updated (streaming arguments)
    #[serde(rename = "tool:inputUpdated")]
    ToolInputUpdated {
        session_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },

    /// Approval request from agent
    #[serde(rename = "approval:request")]
    ApprovalRequest {
        session_id: String,
        request_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    /// Turn/response completed
    #[serde(rename = "turn:completed")]
    TurnCompleted {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
    },

    /// Turn/response error
    #[serde(rename = "turn:error")]
    TurnError {
        session_id: String,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },

    /// Session ended
    #[serde(rename = "session:ended")]
    SessionEnded { session_id: String },

    /// Usage/token information
    #[serde(rename = "usage:update")]
    UsageUpdate {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cached_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_context_window: Option<i64>,
    },

    /// Raw agent-specific event (passthrough)
    #[serde(rename = "raw")]
    Raw {
        session_id: String,
        agent: AgentType,
        data: Value,
    },
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

/// Permission modes for approval workflow
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionMode {
    /// Always ask for permission
    AlwaysAsk,
    /// Auto-approve file edits, ask for shell commands
    AcceptEdits,
    /// Auto-approve everything (dangerous)
    AutoApprove,
    /// Plan mode - read-only
    Plan,
}

impl Default for PermissionMode {
    fn default() -> Self {
        Self::AcceptEdits
    }
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

/// Convert AgentEvent to RiTerm message protocol types
impl AgentEvent {
    /// Convert to AgentMessageContent for P2P transmission
    pub fn to_agent_message_content(
        &self,
        message_id: Option<String>,
    ) -> riterm_shared::message_protocol::AgentMessageContent {
        use riterm_shared::message_protocol::AgentMessageContent;

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
                let output = input.as_ref().and_then(|v| serde_json::to_string(v).ok());
                AgentMessageContent::ToolCallUpdate {
                    tool_name: tool_name.clone().unwrap_or_else(|| "unknown".to_string()),
                    status: ToolCallStatus::InProgress,
                    output,
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
                let output_str = output
                    .as_ref()
                    .and_then(|v| serde_json::to_string(v).ok())
                    .or_else(|| error.clone());
                AgentMessageContent::ToolCallUpdate {
                    tool_name: tool_name.clone().unwrap_or_else(|| "unknown".to_string()),
                    status,
                    output: output_str,
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
