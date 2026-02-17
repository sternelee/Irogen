//! Qwen Code Integration Module
#![allow(dead_code)]
//!
//! Handles integration with Qwen Code Agent.

use anyhow::Result;
use riterm_shared::message_protocol::{AgentMessageContent, NotificationLevel};

/// Qwen Output Parser
pub struct QwenOutputParser;

impl QwenOutputParser {
    pub fn new() -> Result<Self> {
        Ok(Self)
    }

    pub fn parse_line(&self, line: &str) -> QwenParseResult {
        let line = line.trim();
        if line.is_empty() {
            return QwenParseResult::Empty;
        }

        // TODO: Add specific parsing logic for Qwen output
        QwenParseResult::Output {
            content: line.to_string(),
        }
    }
}

pub enum QwenParseResult {
    Empty,
    Output { content: String },
    // Add more variants as needed
}

impl QwenParseResult {
    pub fn to_message_content(self) -> AgentMessageContent {
        match self {
            QwenParseResult::Empty => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Info,
                message: String::new(),
            },
            QwenParseResult::Output { content } => AgentMessageContent::AgentResponse {
                content,
                thinking: false,
                message_id: None,
            },
        }
    }
}

pub fn check_qwen_available() -> Result<bool> {
    // Assuming 'qwen' or similar command
    let output = std::process::Command::new("qwen")
        .arg("--version")
        .output()?;
    Ok(output.status.success())
}
