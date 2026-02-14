//! Message adapter for converting agent events to P2P messages
#![allow(dead_code)]
//!
//! Provides utilities to convert AgentEvent to RiTerm message protocol types
//! for transmission to remote P2P clients.

use riterm_shared::message_protocol::{
    AgentMessageContent, AgentPermissionRequest, AgentPermissionResponse, Message, MessageBuilder,
    MessageType, NotificationData, NotificationLevel, NotificationPriority, NotificationType,
    PermissionMode, ToolCallStatus,
};

use super::events::AgentEvent;

/// Convert an AgentEvent to an AgentMessageContent
pub fn event_to_message_content(
    event: &AgentEvent,
    _message_id: Option<String>,
) -> AgentMessageContent {
    match event {
        // Streaming text - use TextDelta for incremental updates
        AgentEvent::TextDelta { text, .. } => AgentMessageContent::TextDelta {
            text: text.clone(),
            thinking: false,
        },

        // Reasoning/thinking content
        AgentEvent::ReasoningDelta { text, .. } => AgentMessageContent::TextDelta {
            text: text.clone(),
            thinking: true,
        },

        // Turn lifecycle - for loading state management
        AgentEvent::TurnStarted { turn_id, .. } => AgentMessageContent::TurnStarted {
            turn_id: turn_id.clone(),
        },

        AgentEvent::TurnCompleted { result, .. } => {
            let content = result.as_ref().and_then(|v| {
                if let Some(obj) = v.as_object() {
                    obj.get("content")
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            });
            AgentMessageContent::TurnCompleted { content }
        }

        AgentEvent::TurnError { error, .. } => AgentMessageContent::TurnError {
            error: error.clone(),
        },

        // Tool calls
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

        // Approval requests - keep as system notification for now
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

        // Session lifecycle - skip these, they're not message content
        AgentEvent::SessionStarted { .. } => AgentMessageContent::SystemNotification {
            level: NotificationLevel::Info,
            message: String::new(), // Empty, frontend should ignore
        },

        AgentEvent::SessionEnded { .. } => AgentMessageContent::SystemNotification {
            level: NotificationLevel::Info,
            message: String::new(), // Empty, frontend should ignore
        },

        // Usage updates - skip, not message content
        AgentEvent::UsageUpdate { .. } => AgentMessageContent::SystemNotification {
            level: NotificationLevel::Info,
            message: String::new(),
        },

        // Raw events - pass through as system notification
        AgentEvent::Raw { data, .. } => AgentMessageContent::SystemNotification {
            level: NotificationLevel::Info,
            message: data.to_string(),
        },
    }
}

/// Build a P2P message from an AgentEvent
pub fn build_agent_message(
    sender_id: String,
    session_id: String,
    event: &AgentEvent,
    _sequence: Option<u64>,
) -> Message {
    use riterm_shared::message_protocol::{AgentMessageMessage, MessagePayload};

    let content = event_to_message_content(event, None);

    Message {
        message_type: MessageType::AgentMessage,
        sender_id,
        payload: MessagePayload::AgentMessage(AgentMessageMessage {
            session_id: session_id.clone(),
            content,
            sequence: None,
        }),
        receiver_id: None,
        session_id: Some(session_id),
        priority: riterm_shared::message_protocol::MessagePriority::Normal,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        requires_response: false,
        correlation_id: None,
        id: uuid::Uuid::new_v4().to_string(),
    }
}

/// Build a notification message from an AgentEvent
pub fn build_notification(
    sender_id: String,
    session_id: String,
    event: &AgentEvent,
) -> Option<Message> {
    let (notification_type, title, body, priority) = match event {
        AgentEvent::ApprovalRequest {
            tool_name,
            message,
            request_id: _request_id,
            ..
        } => (
            NotificationType::PermissionRequest,
            "Permission Required".to_string(),
            format!(
                "Tool: {}\n{}",
                tool_name,
                message.as_deref().unwrap_or("No description provided")
            ),
            NotificationPriority::High,
        ),
        AgentEvent::TurnError { error, .. } => (
            NotificationType::Error,
            "Error".to_string(),
            error.clone(),
            NotificationPriority::High,
        ),
        AgentEvent::ToolCompleted {
            tool_name, error, ..
        } => {
            if error.is_some() {
                (
                    NotificationType::Error,
                    "Tool Failed".to_string(),
                    format!(
                        "{}: {}",
                        tool_name.as_deref().unwrap_or("Unknown"),
                        error.as_ref().unwrap()
                    ),
                    NotificationPriority::Normal,
                )
            } else {
                (
                    NotificationType::ToolCompleted,
                    "Tool Completed".to_string(),
                    format!(
                        "{} completed successfully",
                        tool_name.as_deref().unwrap_or("Tool")
                    ),
                    NotificationPriority::Low,
                )
            }
        }
        AgentEvent::SessionStarted { .. } => (
            NotificationType::SessionStatus,
            "Session Started".to_string(),
            "AI Agent session has started".to_string(),
            NotificationPriority::Low,
        ),
        AgentEvent::SessionEnded { .. } => (
            NotificationType::SessionStatus,
            "Session Ended".to_string(),
            "AI Agent session has ended".to_string(),
            NotificationPriority::Normal,
        ),
        _ => return None,
    };

    let notification = NotificationData {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: Some(session_id),
        notification_type,
        title,
        body,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        priority,
        read: false,
    };

    Some(MessageBuilder::notification(sender_id, notification))
}

/// Build a permission request message
pub fn build_permission_request(
    sender_id: String,
    session_id: String,
    request_id: String,
    tool_name: String,
    tool_params: serde_json::Value,
    description: Option<String>,
) -> Message {
    let request = AgentPermissionRequest {
        request_id,
        session_id,
        tool_name,
        tool_params,
        requested_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        permission_mode: PermissionMode::AlwaysAsk,
        description,
    };

    MessageBuilder::agent_permission_request(sender_id, request)
}

/// Build a permission response message
pub fn build_permission_response(
    sender_id: String,
    request_id: String,
    approved: bool,
    reason: Option<String>,
) -> Message {
    let response = AgentPermissionResponse {
        request_id,
        approved,
        permission_mode: if approved {
            PermissionMode::ApproveForSession
        } else {
            PermissionMode::Deny
        },
        decided_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        reason,
    };

    MessageBuilder::agent_permission_response(sender_id, response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_wrapper::events::AgentEvent;

    #[test]
    fn test_text_delta_conversion() {
        let event = AgentEvent::TextDelta {
            session_id: "session-1".to_string(),
            text: "Hello".to_string(),
        };

        let content = event_to_message_content(&event, None);
        match content {
            AgentMessageContent::TextDelta { text, thinking, .. } => {
                assert_eq!(text, "Hello");
                assert!(!thinking);
            }
            _ => panic!("Expected AgentMessageContent::TextDelta"),
        }
    }

    #[test]
    fn test_reasoning_delta_conversion() {
        let event = AgentEvent::ReasoningDelta {
            session_id: "session-1".to_string(),
            text: "Thinking...".to_string(),
        };

        let content = event_to_message_content(&event, None);
        match content {
            AgentMessageContent::TextDelta { text, thinking, .. } => {
                assert_eq!(text, "Thinking...");
                assert!(thinking);
            }
            _ => panic!("Expected AgentMessageContent::TextDelta with thinking=true"),
        }
    }

    #[test]
    fn test_tool_started_conversion() {
        let event = AgentEvent::ToolStarted {
            session_id: "session-1".to_string(),
            tool_id: "tool-1".to_string(),
            tool_name: "bash".to_string(),
            input: Some(serde_json::json!({"command": "ls"})),
        };

        let content = event_to_message_content(&event, None);
        match content {
            AgentMessageContent::ToolCallUpdate {
                tool_name, status, ..
            } => {
                assert_eq!(tool_name, "bash");
                // Can't compare status directly without PartialEq
                assert!(matches!(status, ToolCallStatus::Started));
            }
            _ => panic!("Expected ToolCallUpdate"),
        }
    }

    #[test]
    fn test_error_conversion() {
        let event = AgentEvent::TurnError {
            session_id: "session-1".to_string(),
            error: "Something went wrong".to_string(),
            code: Some("E001".to_string()),
        };

        let content = event_to_message_content(&event, None);
        match content {
            AgentMessageContent::TurnError { error } => {
                assert_eq!(error, "Something went wrong");
            }
            _ => panic!("Expected TurnError"),
        }
    }

    #[test]
    fn test_notification_building() {
        let event = AgentEvent::ApprovalRequest {
            session_id: "session-1".to_string(),
            request_id: "req-1".to_string(),
            tool_name: "bash".to_string(),
            input: None,
            message: Some("Run command?".to_string()),
        };

        let msg = build_notification("cli".to_string(), "session-1".to_string(), &event);

        assert!(msg.is_some());
        let msg = msg.unwrap();
        assert!(matches!(msg.message_type, MessageType::Notification));
    }
}
