//! OpenCode 集成模块
#![allow(dead_code)]
//!
//! 此模块专门处理与 OpenCode (OpenAI AI 编码助手) 的集成，
//! 包括输出解析、权限请求处理等。

use anyhow::Result;
use regex::Regex;
use riterm_shared::message_protocol::{AgentMessageContent, NotificationLevel, ToolCallStatus};

/// OpenCode 输出解析器
pub struct OpenCodeOutputParser {
    /// 权限请求正则表达式
    permission_regex: Regex,
    /// 工具调用正则表达式
    tool_regex: Regex,
    /// 错误消息正则表达式
    error_regex: Regex,
}

impl OpenCodeOutputParser {
    /// 创建新的解析器
    pub fn new() -> Result<Self> {
        Ok(Self {
            // 匹配类似 "Allow editing file.txt?" 的权限请求
            permission_regex: Regex::new(
                r"^(Allow|Confirm|Proceed) (.+?)(?: \[y/n\]|\(y/n\))?\?*$",
            )?,
            // 匹配工具调用
            tool_regex: Regex::new(r"^(Running|Executing): (.+)$")?,
            // 匹配错误消息
            error_regex: Regex::new(r"^(Error|ERROR): (.+)")?,
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
            let tool = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            return ParseResult::PermissionRequest {
                tool: tool.to_string(),
                description: line.to_string(),
            };
        }

        // 检查是否是工具调用
        if let Some(caps) = self.tool_regex.captures(line) {
            let tool = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            return ParseResult::ToolCall {
                tool: tool.to_string(),
                status: ToolCallStatus::Started,
            };
        }

        // 检查是否是错误消息
        if let Some(caps) = self.error_regex.captures(line) {
            return ParseResult::Error {
                message: caps.get(2).map(|m| m.as_str()).unwrap_or(line).to_string(),
            };
        }

        // 检查是否是完成标记
        if line.contains("Done") || line.contains("Completed") || line.contains("Finished") {
            return ParseResult::ToolCallComplete;
        }

        // 检查是否是思考状态
        if line.contains("Thinking") || line.contains("Analyzing") || line.contains("Processing") {
            return ParseResult::Thinking;
        }

        // 默认作为普通输出
        ParseResult::Output {
            content: line.to_string(),
        }
    }
}

impl Default for OpenCodeOutputParser {
    fn default() -> Self {
        Self::new().expect("Failed to create OpenCodeOutputParser")
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
    /// 工具调用完成
    ToolCallComplete,
    /// 错误消息
    Error { message: String },
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
            } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Warning,
                message: format!("Permission request: {}", description),
            },
            ParseResult::ToolCall { tool, status } => AgentMessageContent::ToolCallUpdate {
                tool_name: tool,
                status,
                output: None,
            },
            ParseResult::ToolCallComplete => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Success,
                message: "Tool execution completed".to_string(),
            },
            ParseResult::Error { message } => AgentMessageContent::SystemNotification {
                level: NotificationLevel::Error,
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
}

/// 检测 OpenCode 是否可用
pub fn check_opencode_available() -> Result<bool> {
    let output = std::process::Command::new("opencode")
        .arg("--version")
        .output()?;

    Ok(output.status.success())
}

/// 获取 OpenCode 版本
pub fn get_opencode_version() -> Result<String> {
    let output = std::process::Command::new("opencode")
        .arg("--version")
        .output()?;

    if !output.status.success() {
        return Err(anyhow::anyhow!("Failed to get OpenCode version"));
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(version)
}

/// 获取默认的 OpenCode 启动参数
pub fn get_default_opencode_args() -> Vec<String> {
    vec!["--non-interactive".to_string()]
}

/// 类型别名导出，用于避免命名冲突
pub type OpenCodeParseResult = ParseResult;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_permission_request() {
        let parser = OpenCodeOutputParser::new().unwrap();
        let result = parser.parse_line("Allow editing src/main.rs? [y/n]");
        assert!(matches!(result, ParseResult::PermissionRequest { .. }));
    }

    #[test]
    fn test_parse_tool_call() {
        let parser = OpenCodeOutputParser::new().unwrap();
        let result = parser.parse_line("Running: git status");
        match result {
            ParseResult::ToolCall { tool, .. } => {
                assert_eq!(tool, "git status");
            }
            _ => panic!("Expected ToolCall result"),
        }
    }
}
