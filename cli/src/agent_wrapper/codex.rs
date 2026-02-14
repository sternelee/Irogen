//! OpenAI Codex 集成模块
#![allow(dead_code)]
//!
//! 此模块专门处理与 OpenAI Codex (OpenAI AI 编码助手) 的集成，
//! 包括输出解析、权限请求处理等。

use anyhow::Result;
use regex::Regex;
use riterm_shared::message_protocol::{AgentMessageContent, NotificationLevel, ToolCallStatus};

/// OpenAI Codex 输出解析器
pub struct CodexOutputParser {
    /// 权限请求正则表达式
    permission_regex: Regex,
    /// 工具调用开始正则表达式
    tool_start_regex: Regex,
    /// 工具调用完成正则表达式
    tool_complete_regex: Regex,
    /// 文件编辑正则表达式
    file_edit_regex: Regex,
    /// 代码生成完成正则表达式
    generation_complete_regex: Regex,
}

impl CodexOutputParser {
    /// 创建新的解析器
    pub fn new() -> Result<Self> {
        Ok(Self {
            // 匹配类似 "Allow editing file.py?" 或 "Confirm changes to src/main.rs?" 的权限请求
            permission_regex: Regex::new(r"^(Allow|Confirm|Approve) (.+?)(?: \[y/n\])?\?*$")?,
            // 匹配工具调用开始，如 "▶ Running git status" 或 "→ Executing: npm test"
            tool_start_regex: Regex::new(r"^(?:▶|→|Running|Executing|▶ Running): (.+)$")?,
            // 匹配工具调用完成，如 "✓ Done: git status" or "✔ Completed: npm install"
            tool_complete_regex: Regex::new(r"^(✓|✔|Done|Completed|Finished): (.+)$")?,
            // 匹配文件编辑操作，如 "Editing: src/main.rs" or "Modified: package.json"
            file_edit_regex: Regex::new(r"^(Editing|Modified|Updated|Created): (.+)$")?,
            // 匹配代码生成完成，如 "Generated: 100 lines" or "Code generation complete"
            generation_complete_regex: Regex::new(
                r"^(Generated:|Code generation complete|Generation complete)",
            )?,
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

        // 检查是否是文件编辑操作
        if let Some(caps) = self.file_edit_regex.captures(line) {
            let _action = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let file = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            return ParseResult::FileEdit {
                file: file.to_string(),
            };
        }

        // 检查是否是代码生成完成
        if self.generation_complete_regex.is_match(line) {
            return ParseResult::GenerationComplete;
        }

        // 检查是否是工具调用开始
        if let Some(caps) = self.tool_start_regex.captures(line) {
            let tool = caps.get(1).map(|m| m.as_str()).unwrap_or("");
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
        if line.starts_with("Error:") || line.starts_with("ERROR:") || line.starts_with("✗") {
            return ParseResult::Error {
                message: line.to_string(),
            };
        }

        // 检查是否是警告
        if line.starts_with("Warning:") || line.starts_with("WARNING:") || line.starts_with("⚠") {
            return ParseResult::Warning {
                message: line.to_string(),
            };
        }

        // 检查是否是思考状态（Codex 正在分析或生成代码）
        if line.contains("Analyzing") || line.contains("Generating") || line.contains("Thinking") {
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

impl Default for CodexOutputParser {
    fn default() -> Self {
        Self::new().expect("Failed to create CodexOutputParser")
    }
}

/// 解析结果
#[derive(Debug, Clone)]
pub enum ParseResult {
    /// 空行
    Empty,
    /// 权限请求
    PermissionRequest { tool: String, description: String },
    /// 文件编辑
    FileEdit { file: String },
    /// 代码生成完成
    GenerationComplete,
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
            ParseResult::FileEdit { file } => AgentMessageContent::ToolCallUpdate {
                tool_name: "file_edit".to_string(),
                status: ToolCallStatus::Completed,
                output: Some(format!("Edited file: {}", file)),
            },
            ParseResult::GenerationComplete => AgentMessageContent::AgentResponse {
                content: "Code generation complete".to_string(),
                thinking: false,
                message_id: None,
            },
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
}

/// 获取默认的 OpenAI Codex 启动参数
pub fn get_default_codex_args() -> Vec<String> {
    vec![
        "exec".to_string(), // Run non-interactively
    ]
}

/// 类型别名导出，用于避免命名冲突
pub type CodexParseResult = ParseResult;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_permission_request() {
        let parser = CodexOutputParser::new().unwrap();
        let result = parser.parse_line("Allow editing src/main.rs?");

        match result {
            ParseResult::PermissionRequest { tool, .. } => {
                assert_eq!(tool, "editing src/main.rs");
            }
            _ => panic!("Expected PermissionRequest result"),
        }
    }

    #[test]
    fn test_parse_tool_call() {
        let parser = CodexOutputParser::new().unwrap();
        let result = parser.parse_line("▶ Running: git status");

        match result {
            ParseResult::ToolCall { tool, .. } => {
                assert_eq!(tool, "git status");
            }
            _ => panic!("Expected ToolCall result"),
        }
    }

    #[test]
    fn test_parse_file_edit() {
        let parser = CodexOutputParser::new().unwrap();
        let result = parser.parse_line("Editing: src/main.rs");

        match result {
            ParseResult::FileEdit { file } => {
                assert_eq!(file, "src/main.rs");
            }
            _ => panic!("Expected FileEdit result"),
        }
    }

    #[test]
    fn test_parse_error() {
        let parser = CodexOutputParser::new().unwrap();
        let result = parser.parse_line("✗ Failed to execute command");

        match result {
            ParseResult::Error { .. } => {
                // Ok
            }
            _ => panic!("Expected Error result"),
        }
    }
}
