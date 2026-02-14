//! Claude Code 集成模块
#![allow(dead_code)]
//!
//! 此模块专门处理与 Claude Code (Anthropic AI 编码助手) 的集成，
//! 包括输出解析、权限请求处理等。

use anyhow::Result;
use regex::Regex;
use riterm_shared::message_protocol::{AgentMessageContent, NotificationLevel, ToolCallStatus};

/// Claude Code 输出解析器
pub struct ClaudeOutputParser {
    /// 权限请求正则表达式
    permission_regex: Regex,
    /// 工具调用开始正则表达式
    tool_start_regex: Regex,
    /// 工具调用完成正则表达式
    tool_complete_regex: Regex,
}

impl ClaudeOutputParser {
    /// 创建新的解析器
    pub fn new() -> Result<Self> {
        Ok(Self {
            // 匹配类似 "Allow edit to file src/main.rs?" 的权限请求
            permission_regex: Regex::new(r"^(Allow|Confirm) (.+?)(?: \[y/n\])?\?*$")?,
            // 匹配工具调用开始，如 "Running: git status"
            tool_start_regex: Regex::new(r"^(Running|Executing|Using): (.+)$")?,
            // 匹配工具调用完成
            tool_complete_regex: Regex::new(r"^(Done|Completed|Finished): (.+)$")?,
        })
    }

    /// 解析一行输出
    pub fn parse_line(&self, line: &str) -> ParseResult {
        let line = line.trim();

        // 空行跳过
        if line.is_empty() {
            return ParseResult::Empty;
        }

        // 检查是否是权限请求
        if let Some(caps) = self.permission_regex.captures(line) {
            let _action = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let tool = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            return ParseResult::PermissionRequest {
                tool: tool.to_string(),
                description: line.to_string(),
            };
        }

        // 检查是否是工具调用开始
        if let Some(caps) = self.tool_start_regex.captures(line) {
            let tool = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            return ParseResult::ToolCall {
                tool: tool.to_string(),
                status: ToolCallStatus::Started,
            };
        }

        // 检查是否是工具调用完成
        if let Some(caps) = self.tool_complete_regex.captures(line) {
            let tool = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            return ParseResult::ToolCall {
                tool: tool.to_string(),
                status: ToolCallStatus::Completed,
            };
        }

        // 检查是否是错误消息
        if line.starts_with("Error:") || line.starts_with("ERROR:") || line.contains("error:") {
            return ParseResult::Error {
                message: line.to_string(),
            };
        }

        // 检查是否是警告
        if line.starts_with("Warning:") || line.starts_with("WARNING:") {
            return ParseResult::Warning {
                message: line.to_string(),
            };
        }

        // 检查是否是思考状态（Claude 正在思考）
        if line.contains("Thinking") || line.contains("Analyzing") {
            return ParseResult::Thinking;
        }

        // 默认作为普通输出
        ParseResult::Output {
            content: line.to_string(),
        }
    }

    /// 解析权限请求的工具名称
    pub fn parse_tool_from_permission(&self, line: &str) -> Option<String> {
        if let Some(caps) = self.permission_regex.captures(line) {
            caps.get(2).map(|m| m.as_str().to_string())
        } else {
            None
        }
    }
}

impl Default for ClaudeOutputParser {
    fn default() -> Self {
        Self::new().expect("Failed to create ClaudeOutputParser")
    }
}

/// 解析结果
#[derive(Debug, Clone)]
pub enum ParseResult {
    /// 空行
    Empty,
    /// 权限请求
    PermissionRequest { tool: String, description: String },
    /// 工具调用
    ToolCall {
        tool: String,
        status: ToolCallStatus,
    },
    /// 错误消息
    Error { message: String },
    /// 警告消息
    Warning { message: String },
    /// 思考状态
    Thinking,
    /// 普通输出
    Output { content: String },
}

impl ParseResult {
    /// 转换为 AgentMessageContent
    pub fn to_message_content(self) -> AgentMessageContent {
        match self {
            ParseResult::Empty => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Info,
                message: String::new(),
            },
            ParseResult::PermissionRequest {
                tool: _,
                description,
            } => {
                // 权限请求需要特殊处理，这里返回通知
                AgentMessageContent::SystemNotification {
                    level: NotificationLevel::Warning,
                    message: format!("Permission request: {}", description),
                }
            }
            ParseResult::ToolCall { tool, status } => AgentMessageContent::ToolCallUpdate {
                tool_name: tool,
                status,
                output: None,
            },
            ParseResult::Error { message } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Error,
                message,
            },
            ParseResult::Warning { message } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Warning,
                message,
            },
            ParseResult::Thinking => AgentMessageContent::AgentResponse {
                content: String::new(),
                thinking: true,
                message_id: None,
            },
            ParseResult::Output { content } => AgentMessageContent::AgentResponse {
                content,
                thinking: false,
                message_id: None,
            },
        }
    }

    /// 是否是权限请求
    pub fn is_permission_request(&self) -> bool {
        matches!(self, ParseResult::PermissionRequest { .. })
    }
}

/// 检测 Claude Code 是否可用
pub fn check_claude_available() -> Result<bool> {
    let output = std::process::Command::new("claude")
        .arg("--version")
        .output()?;

    Ok(output.status.success())
}

/// 获取 Claude Code 版本
pub fn get_claude_version() -> Result<String> {
    let output = std::process::Command::new("claude")
        .arg("--version")
        .output()?;

    if !output.status.success() {
        return Err(anyhow::anyhow!("Failed to get Claude version"));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(version)
}

/// 获取默认的 Claude Code 启动参数
pub fn get_default_claude_args() -> Vec<String> {
    vec!["--no-prompt".to_string(), "--no-launch-browser".to_string()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_permission_request() {
        let parser = ClaudeOutputParser::new().unwrap();
        let result = parser.parse_line("Allow edit to file src/main.rs? [y/n]");
        assert!(result.is_permission_request());
    }

    #[test]
    fn test_parse_tool_call() {
        let parser = ClaudeOutputParser::new().unwrap();
        let result = parser.parse_line("Running: git status");
        match result {
            ParseResult::ToolCall { tool, .. } => {
                assert_eq!(tool, "git status");
            }
            _ => panic!("Expected ToolCall result"),
        }
    }

    #[test]
    fn test_parse_error() {
        let parser = ClaudeOutputParser::new().unwrap();
        let result = parser.parse_line("Error: Failed to read file");
        match result {
            ParseResult::Error { .. } => {}
            _ => panic!("Expected Error result"),
        }
    }
}
