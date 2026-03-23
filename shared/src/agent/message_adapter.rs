//! Message adapter for converting agent events to P2P messages
#![allow(dead_code)]
//!
//! Provides utilities to convert AgentEvent to ClawdChat message protocol types
//! for transmission to remote P2P clients.

use crate::message_protocol::{
    AgentMessageContent, AgentPermissionRequest, AgentPermissionResponse, Message, MessageBuilder,
    MessageType, NotificationData, NotificationLevel, NotificationPriority, NotificationType,
    PermissionMode, ToolCallStatus,
};

use super::events::AgentEvent;

/// Convert an AgentEvent to a JSON value for frontend consumption
///
/// This function converts AgentEvent to a format expected by the frontend,
/// using snake_case event types (e.g., "text_delta" instead of "text:delta").
pub fn event_to_message_content(
    event: &AgentEvent,
    _message_id: Option<String>,
) -> serde_json::Value {
    let result = match event {
        AgentEvent::TextDelta { session_id, text } => serde_json::json!({
            "type": "text_delta",
            "sessionId": session_id,
            "text": text,
        }),

        AgentEvent::ReasoningDelta { session_id, text } => serde_json::json!({
            "type": "reasoning_delta",
            "sessionId": session_id,
            "text": text,
        }),

        AgentEvent::TurnStarted {
            session_id,
            turn_id,
        } => serde_json::json!({
            "type": "turn_started",
            "sessionId": session_id,
            "turnId": turn_id,
        }),

        AgentEvent::TurnCompleted { session_id, result } => {
            let content = result.as_ref().and_then(|s| {
                let v: serde_json::Value = serde_json::from_str(s).ok()?;
                if let Some(obj) = v.as_object() {
                    obj.get("content")
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            });
            serde_json::json!({
                "type": "turn_completed",
                "sessionId": session_id,
                "content": content,
            })
        }

        AgentEvent::TurnError {
            session_id,
            error,
            code,
        } => serde_json::json!({
            "type": "turn_error",
            "sessionId": session_id,
            "error": error,
            "code": code,
        }),

        AgentEvent::ToolStarted {
            session_id,
            tool_id,
            tool_name,
            input,
        } => {
            let input_json = input
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!({}));
            serde_json::json!({
                "type": "tool_started",
                "sessionId": session_id,
                "toolId": tool_id,
                "toolName": tool_name,
                "input": input_json,
            })
        }

        AgentEvent::ToolInputUpdated {
            session_id,
            tool_id,
            tool_name,
            input,
        } => {
            let input_json = input
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(serde_json::json!({}));
            serde_json::json!({
                "type": "tool_input_updated",
                "sessionId": session_id,
                "toolId": tool_id,
                "toolName": tool_name,
                "input": input_json,
            })
        }

        AgentEvent::ToolCompleted {
            session_id,
            tool_id,
            tool_name,
            output,
            error,
        } => {
            let output_json: Option<serde_json::Value> =
                output.as_ref().and_then(|s| serde_json::from_str(s).ok());
            serde_json::json!({
                "type": "tool_completed",
                "sessionId": session_id,
                "toolId": tool_id,
                "toolName": tool_name,
                "output": output_json,
                "error": error,
            })
        }

        AgentEvent::ApprovalRequest {
            session_id,
            request_id,
            tool_name,
            input,
            message,
        } => {
            let input_json: Option<serde_json::Value> =
                input.as_ref().and_then(|s| serde_json::from_str(s).ok());
            serde_json::json!({
                "type": "approval_request",
                "sessionId": session_id,
                "requestId": request_id,
                "toolName": tool_name,
                "input": input_json,
                "message": message,
            })
        }

        AgentEvent::UsageUpdate {
            session_id,
            input_tokens,
            output_tokens,
            cached_tokens,
            model_context_window,
        } => serde_json::json!({
            "type": "usage_update",
            "sessionId": session_id,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "cachedTokens": cached_tokens,
            "modelContextWindow": model_context_window,
        }),

        AgentEvent::SessionStarted { session_id, agent } => serde_json::json!({
            "type": "session_started",
            "sessionId": session_id,
            "agent": agent,
        }),

        AgentEvent::SessionEnded { session_id } => serde_json::json!({
            "type": "session_ended",
            "sessionId": session_id,
        }),

        AgentEvent::ProgressUpdate {
            session_id,
            operation,
            progress,
            message,
        } => serde_json::json!({
            "type": "progress_update",
            "sessionId": session_id,
            "operation": operation,
            "progress": progress,
            "message": message,
        }),

        AgentEvent::Notification {
            session_id,
            level,
            message,
            details,
        } => serde_json::json!({
            "type": "notification",
            "sessionId": session_id,
            "level": level,
            "message": message,
            "details": details,
        }),

        AgentEvent::FileOperation {
            session_id,
            operation,
            path,
            status,
        } => serde_json::json!({
            "type": "file_operation",
            "sessionId": session_id,
            "operation": operation,
            "path": path,
            "status": status,
        }),

        AgentEvent::TerminalOutput {
            session_id,
            command,
            output,
            exit_code,
        } => serde_json::json!({
            "type": "terminal_output",
            "sessionId": session_id,
            "command": command,
            "output": output,
            "exitCode": exit_code,
        }),

        AgentEvent::Raw {
            session_id,
            data,
            agent,
        } => serde_json::json!({
            "type": "raw",
            "sessionId": session_id,
            "agent": agent,
            "data": data,
        }),
    };

    result
}

/// Convert an AgentEvent to P2P AgentMessageContent
///
/// This function is used for P2P message transmission where we need
/// the simplified protocol format.
pub fn event_to_agent_message_content(
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
            let content = result.as_ref().and_then(|s| {
                let v: serde_json::Value = serde_json::from_str(s).ok()?;
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
        } => AgentMessageContent::ToolCallUpdate {
            tool_name: tool_name.clone().unwrap_or_else(|| "unknown".to_string()),
            status: ToolCallStatus::InProgress,
            output: input.clone(),
        },

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

        // Approval requests - emit as ApprovalRequest for frontend to show permission UI
        AgentEvent::ApprovalRequest {
            session_id: _,
            request_id,
            tool_name,
            input,
            message,
        } => AgentMessageContent::ApprovalRequest {
            request_id: request_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
            message: message.clone(),
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
        AgentEvent::Raw { data, .. } => AgentMessageContent::RawEvent {
            event_type: "raw".to_string(),
            // Parse JSON string back to Value for AgentMessageContent
            data: serde_json::from_str(data).unwrap_or(serde_json::json!({})),
        },

        // Progress updates
        AgentEvent::ProgressUpdate {
            operation,
            progress,
            message,
            ..
        } => AgentMessageContent::SystemNotification {
            level: NotificationLevel::Info,
            message: format!(
                "{}: {} ({:.0}%)",
                operation,
                message.as_deref().unwrap_or(""),
                progress * 100.0
            ),
        },

        // General notifications
        AgentEvent::Notification { level, message, .. } => {
            AgentMessageContent::SystemNotification {
                level: level.clone(),
                message: message.clone(),
            }
        }

        // File operations
        AgentEvent::FileOperation {
            operation, path, ..
        } => AgentMessageContent::SystemNotification {
            level: NotificationLevel::Info,
            message: format!("File operation: {} {}", operation, path),
        },

        // Terminal output
        AgentEvent::TerminalOutput {
            command,
            output,
            exit_code,
            ..
        } => AgentMessageContent::SystemNotification {
            level: NotificationLevel::Info,
            message: match exit_code {
                Some(0) => format!("Command completed: {}\n{}", command, output),
                Some(code) => format!("Command failed (exit {}): {}\n{}", code, command, output),
                None => format!("Command output: {}\n{}", command, output),
            },
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
    use crate::message_protocol::{AgentMessageMessage, MessagePayload};

    let content = event_to_agent_message_content(event, None);

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
        priority: crate::message_protocol::MessagePriority::Normal,
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
    // Serialize tool_params to JSON string for bincode compatibility
    let tool_params_str = serde_json::to_string(&tool_params).unwrap_or_else(|_| "{}".to_string());

    let request = AgentPermissionRequest {
        request_id,
        session_id,
        tool_name,
        tool_params: tool_params_str,
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

    #[test]
    fn test_text_delta_conversion() {
        let event = AgentEvent::TextDelta {
            session_id: "session-1".to_string(),
            text: "Hello".to_string(),
        };

        let content = event_to_agent_message_content(&event, None);
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

        let content = event_to_agent_message_content(&event, None);
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
            input: Some(serde_json::to_string(&serde_json::json!({"command": "ls"})).unwrap()),
        };

        let content = event_to_agent_message_content(&event, None);
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

        let content = event_to_agent_message_content(&event, None);
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
