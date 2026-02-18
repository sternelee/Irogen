//! 斜杠命令路由器
#![allow(dead_code)]
//!
//! 此模块负责解析和路由用户的斜杠命令，
//! 区分 ClawdChat 内置命令和需要转发给 AI Agent 的命令。

use anyhow::Result;
use clawdchat_shared::message_protocol::{
    AgentType, BuiltinCommand, SlashCommand, SlashCommandResponseContent,
};

/// ClawdChat 内置命令列表
const CLAWDCHAT_BUILTIN_COMMANDS: &[&str] = &[
    "/list",    // 列出会话
    "/spawn",   // 启动新 Agent
    "/stop",    // 停止会话
    "/quit",    // 退出
    "/approve", // 批准权限请求
    "/deny",    // 拒绝权限请求
    "/help",    // 显示帮助（ClawdChat 版本）
];

/// 需要透传给 Agent 的通用命令（即使它们也是 ClawdChat 内置命令）
const PASSTHROUGH_COMMANDS: &[&str] = &[
    "/clear",     // 清屏/清空会话 - Agent 处理
    "/compact",   // 压缩上下文 - Agent 处理
    "/summarize", // 同 /compact - Agent 处理
];

/// Claude Code 专用命令（需要特殊处理）
const CLAUDE_SPECIFIC_COMMANDS: &[&str] = &[
    "/plugin",      // 插件管理
    "/skills",      // 技能列表
    "/context",     // 上下文信息
    "/permissions", // 权限管理
    "/config",      // 配置
    "/cost",        // 成本统计
    "/doctor",      // 诊断
    "/hooks",       // Hooks 管理
    "/ide",         // IDE 集成
    "/compact",     // 压缩上下文
    "/summarize",   // 同 /compact
    "/init",        // 初始化项目
];

/// OpenCode 专用命令
const OPENCODE_SPECIFIC_COMMANDS: &[&str] = &[
    "/sessions", // 会话列表
    "/new",      // 新会话
    "/undo",     // 撤销
    "/redo",     // 重做
    "/editor",   // 打开编辑器
    "/export",   // 导出会话
    "/themes",   // 主题
    "/models",   // 模型列表
    "/connect",  // 连接提供商
    "/share",    // 分享会话
    "/unshare",  // 取消分享
    "/details",  // 显示详细信息
    "/thinking", // 显示思考状态
];

/// Gemini CLI 专用命令
const GEMINI_SPECIFIC_COMMANDS: &[&str] = &[
    "/compress", // 压缩上下文
    "/editor",   // 编辑器选择
    "/theme",    // 主题切换
    "/auth",     // 认证方式
    "/about",    // 版本信息
    "/bug",      // 报告问题
    "/stats",    // 统计信息
    "/tools",    // 工具列表
    "/mcp",      // MCP 服务器
    "/memory",   // 内存管理
    "/restore",  // 恢复文件
    "/chat",     // 聊天历史
];

/// OpenAI Codex 专用命令
const CODEX_SPECIFIC_COMMANDS: &[&str] = &[
    "/generate",    // 生成代码
    "/complete",    // 代码补全
    "/refactor",    // 重构代码
    "/explain",     // 解释代码
    "/fix",         // 修复代码
    "/optimize",    // 优化代码
    "/test",        // 生成测试
    "/docs",        // 生成文档
    "/model",       // 切换模型
    "/temperature", // 设置温度参数
    "/max-tokens",  // 设置最大 token 数
    "/format",      // 代码格式化
    "/lint",        // 代码检查
];

/// GitHub Copilot 专用命令
const COPILOT_SPECIFIC_COMMANDS: &[&str] = &[
    "/explain",  // 解释代码
    "/fix",      // 修复代码
    "/optimize", // 优化
    "/tests",    // 生成测试
];

/// Qwen 专用命令
const QWEN_SPECIFIC_COMMANDS: &[&str] = &[
    "/chat", // 聊天
    "/code", // 生成代码
];

/// 通用命令（所有 Agent 都支持）
const UNIVERSAL_COMMANDS: &[&str] = &[
    "/help",  // 帮助
    "/clear", // 清屏/清空会话
    "/exit",  // 退出
    "/quit",  // 退出（同 /exit）
];

/// 命令路由器
pub struct CommandRouter {
    /// 当前 Agent 类型
    agent_type: AgentType,
}

impl CommandRouter {
    /// 创建新的命令路由器
    pub fn new(agent_type: AgentType) -> Self {
        Self { agent_type }
    }

    /// 解析用户输入的命令
    ///
    /// 判断是 ClawdChat 内置命令还是需要转发给 Agent 的命令
    pub fn parse_command(&self, input: &str) -> Result<SlashCommand> {
        let input = input.trim();

        // 检查是否是斜杠命令
        if !input.starts_with('/') {
            return Ok(SlashCommand::Passthrough {
                raw: input.to_string(),
            });
        }

        // 提取命令名称（第一个空格前的部分）
        let command_name = input.split_whitespace().next().unwrap_or(input);

        // 检查是否是 ClawdChat 内置命令
        if CLAWDCHAT_BUILTIN_COMMANDS.contains(&command_name) {
            return self.parse_builtin_command(input);
        }

        // 否则作为透传命令处理
        Ok(SlashCommand::Passthrough {
            raw: input.to_string(),
        })
    }

    /// 解析 ClawdChat 内置命令
    fn parse_builtin_command(&self, input: &str) -> Result<SlashCommand> {
        let parts: Vec<&str> = input.split_whitespace().collect();
        let command = parts.first().unwrap_or(&"");

        let builtin = match *command {
            "/list" => BuiltinCommand::ListSessions,
            "/help" => BuiltinCommand::ListCommands,
            "/quit" | "/exit" => {
                return Ok(SlashCommand::Builtin {
                    command_type: BuiltinCommand::StopSession {
                        session_id: "".to_string(), // 特殊处理
                    },
                });
            }
            "/spawn" => {
                if parts.len() < 3 {
                    return Err(anyhow::anyhow!(
                        "Usage: /spawn <agent_type> <project_path> [args...]"
                    ));
                }
                let agent_type = self.parse_agent_type(parts[1])?;
                let project_path = parts[2].to_string();
                let args = if parts.len() > 3 {
                    parts[3..].iter().map(|s| s.to_string()).collect()
                } else {
                    vec![]
                };
                BuiltinCommand::SpawnAgent {
                    agent_type,
                    project_path,
                    args,
                }
            }
            "/stop" => {
                if parts.len() < 2 {
                    return Err(anyhow::anyhow!("Usage: /stop <session_id>"));
                }
                BuiltinCommand::StopSession {
                    session_id: parts[1].to_string(),
                }
            }
            "/approve" => {
                // 这是一个快捷方式，实际会通过权限响应消息处理
                BuiltinCommand::GetAgentInfo // 临时占位
            }
            "/deny" => {
                BuiltinCommand::GetAgentInfo // 临时占位
            }
            _ => {
                return Err(anyhow::anyhow!("Unknown builtin command: {}", command));
            }
        };

        Ok(SlashCommand::Builtin {
            command_type: builtin,
        })
    }

    /// 解析 Agent 类型字符串
    fn parse_agent_type(&self, s: &str) -> Result<AgentType> {
        match s.to_lowercase().as_str() {
            "claude" | "claudecode" | "claude-code" => Ok(AgentType::ClaudeCode),
            "opencode" | "open" | "openai" => Ok(AgentType::OpenCode),
            "codex" | "openai-codex" | "openai-codex-cli" => Ok(AgentType::Codex),
            "gemini" | "gemini-cli" => Ok(AgentType::Gemini),
            "copilot" | "gh-copilot" | "github-copilot" => Ok(AgentType::Copilot),
            "qwen" | "qwen-code" | "ali-qwen" => Ok(AgentType::Qwen),
            "goose" | "block-goose" => Ok(AgentType::Goose),
            "openclaw" | "open-claw" => Ok(AgentType::OpenClaw),
            "custom" => Ok(AgentType::Custom),
            _ => Err(anyhow::anyhow!("Unknown agent type: {}", s)),
        }
    }

    /// 获取指定 Agent 类型支持的命令列表
    pub fn get_supported_commands(&self, agent_type: AgentType) -> Vec<CommandInfo> {
        let mut commands = Vec::new();

        // 通用命令
        for cmd in UNIVERSAL_COMMANDS {
            commands.push(CommandInfo {
                name: cmd.to_string(),
                description: self.get_command_description(cmd),
                category: CommandCategory::Universal,
                examples: vec![cmd.to_string()],
            });
        }

        // Agent 特定命令
        let agent_commands = match agent_type {
            AgentType::ClaudeCode => CLAUDE_SPECIFIC_COMMANDS,
            AgentType::OpenCode => OPENCODE_SPECIFIC_COMMANDS,
            AgentType::Codex => CODEX_SPECIFIC_COMMANDS,
            AgentType::Gemini => GEMINI_SPECIFIC_COMMANDS,
            AgentType::Copilot => COPILOT_SPECIFIC_COMMANDS,
            AgentType::Qwen => QWEN_SPECIFIC_COMMANDS,
            AgentType::Goose | AgentType::OpenClaw => &[],
            AgentType::AcpAgent | AgentType::Custom | AgentType::ZeroClaw => &[],
        };

        for cmd in agent_commands {
            commands.push(CommandInfo {
                name: cmd.to_string(),
                description: self.get_command_description(cmd),
                category: CommandCategory::AgentSpecific,
                examples: self.get_command_examples(cmd, agent_type),
            });
        }

        commands
    }

    /// 获取命令描述
    fn get_command_description(&self, command: &str) -> String {
        match command {
            "/help" => "显示帮助信息".to_string(),
            "/clear" => "清空屏幕或会话历史".to_string(),
            "/exit" | "/quit" => "退出当前会话".to_string(),
            "/plugin" => "管理 Claude Code 插件".to_string(),
            "/skills" => "列出可用的技能".to_string(),
            "/context" => "显示当前上下文使用情况".to_string(),
            "/sessions" => "列出/切换历史会话".to_string(),
            "/new" => "开始新会话".to_string(),
            "/undo" => "撤销上一次操作".to_string(),
            "/redo" => "重做已撤销的操作".to_string(),
            "/editor" => "打开外部编辑器".to_string(),
            "/export" => "导出会话记录".to_string(),
            "/themes" => "列出/切换主题".to_string(),
            "/models" => "列出可用模型".to_string(),
            "/compact" | "/summarize" => "压缩会话上下文".to_string(),
            "/memory" => "管理 GEMINI.md 文件".to_string(),
            "/stats" => "显示会话统计信息".to_string(),
            "/generate" => "生成代码".to_string(),
            "/complete" => "代码补全".to_string(),
            "/refactor" => "重构代码".to_string(),
            "/explain" => "解释代码".to_string(),
            "/fix" => "修复代码".to_string(),
            "/optimize" => "优化代码".to_string(),
            "/test" => "生成测试".to_string(),
            "/docs" => "生成文档".to_string(),
            "/model" => "切换模型".to_string(),
            "/temperature" => "设置温度参数".to_string(),
            "/max-tokens" => "设置最大 token 数".to_string(),
            "/format" => "代码格式化".to_string(),
            "/lint" => "代码检查".to_string(),
            _ => format!("{} 命令", command),
        }
    }

    /// 获取命令示例
    fn get_command_examples(&self, command: &str, agent_type: AgentType) -> Vec<String> {
        match command {
            "/plugin" => match agent_type {
                AgentType::ClaudeCode => vec!["/plugin install @npm/package".to_string()],
                _ => vec![],
            },
            "/sessions" => vec!["/sessions".to_string(), "/sessions resume 1".to_string()],
            "/new" => vec!["/new".to_string()],
            "/undo" => vec!["/undo".to_string()],
            "/redo" => vec!["/redo".to_string()],
            "/export" => vec!["/export".to_string()],
            "/themes" => vec!["/themes".to_string()],
            "/models" => vec!["/models".to_string()],
            "/memory" => match agent_type {
                AgentType::Gemini => vec!["/memory add".to_string(), "/memory show".to_string()],
                _ => vec![],
            },
            "/stats" => vec!["/stats".to_string()],
            "/generate" => match agent_type {
                AgentType::Codex => vec![
                    "/generate a function to parse JSON".to_string(),
                    "/generate async fetch wrapper".to_string(),
                ],
                _ => vec![],
            },
            "/complete" => match agent_type {
                AgentType::Codex => vec!["/complete".to_string()],
                _ => vec![],
            },
            "/refactor" => match agent_type {
                AgentType::Codex => vec!["/refactor this function to be more readable".to_string()],
                _ => vec![],
            },
            "/explain" => match agent_type {
                AgentType::Codex => vec!["/explain selected code".to_string()],
                _ => vec![],
            },
            "/fix" => match agent_type {
                AgentType::Codex => vec!["/fix bugs in this code".to_string()],
                _ => vec![],
            },
            "/optimize" => match agent_type {
                AgentType::Codex => vec!["/optimize for performance".to_string()],
                _ => vec![],
            },
            "/test" => match agent_type {
                AgentType::Codex => vec!["/test generate unit tests for this function".to_string()],
                _ => vec![],
            },
            "/docs" => match agent_type {
                AgentType::Codex => vec!["/docs generate JSDoc comments".to_string()],
                _ => vec![],
            },
            "/model" => match agent_type {
                AgentType::Codex => vec![
                    "/model gpt-4".to_string(),
                    "/model gpt-3.5-turbo".to_string(),
                ],
                _ => vec![],
            },
            "/temperature" => match agent_type {
                AgentType::Codex => vec!["/temperature 0.7".to_string()],
                _ => vec![],
            },
            "/max-tokens" => match agent_type {
                AgentType::Codex => vec!["/max-tokens 1000".to_string()],
                _ => vec![],
            },
            "/format" => match agent_type {
                AgentType::Codex => vec!["/format".to_string()],
                _ => vec![],
            },
            "/lint" => match agent_type {
                AgentType::Codex => vec!["/lint".to_string()],
                _ => vec![],
            },
            _ => vec![command.to_string()],
        }
    }

    /// 检查命令是否是内置命令
    pub fn is_builtin_command(&self, command: &str) -> bool {
        let command_name = command.split_whitespace().next().unwrap_or(command);
        CLAWDCHAT_BUILTIN_COMMANDS.contains(&command_name)
    }

    /// 检查命令是否被当前 Agent 支持
    pub fn is_agent_supported(&self, command: &str) -> bool {
        let command_name = command.split_whitespace().next().unwrap_or(command);

        UNIVERSAL_COMMANDS.contains(&command_name)
            || match self.agent_type {
                AgentType::ClaudeCode => CLAUDE_SPECIFIC_COMMANDS.contains(&command_name),
                AgentType::OpenCode => OPENCODE_SPECIFIC_COMMANDS.contains(&command_name),
                AgentType::Codex => CODEX_SPECIFIC_COMMANDS.contains(&command_name),
                AgentType::Gemini => GEMINI_SPECIFIC_COMMANDS.contains(&command_name),
                AgentType::Copilot => COPILOT_SPECIFIC_COMMANDS.contains(&command_name),
                AgentType::Qwen => QWEN_SPECIFIC_COMMANDS.contains(&command_name),
                AgentType::Goose | AgentType::OpenClaw => false,
                AgentType::AcpAgent | AgentType::Custom | AgentType::ZeroClaw => false,
            }
    }

    /// 格式化命令响应
    pub fn format_response(&self, content: SlashCommandResponseContent) -> String {
        match content {
            SlashCommandResponseContent::Success { data } => {
                serde_json::to_string_pretty(&data).unwrap_or_else(|_| "Success".to_string())
            }
            SlashCommandResponseContent::Error { message } => {
                format!("Error: {}", message)
            }
            SlashCommandResponseContent::Structured { format, content } => match format {
                clawdchat_shared::message_protocol::OutputFormat::Markdown => content,
                clawdchat_shared::message_protocol::OutputFormat::Text => content,
                clawdchat_shared::message_protocol::OutputFormat::Json => content,
                clawdchat_shared::message_protocol::OutputFormat::Table => content,
            },
        }
    }
}

/// 命令信息
#[derive(Debug, Clone)]
pub struct CommandInfo {
    /// 命令名称
    pub name: String,
    /// 命令描述
    pub description: String,
    /// 命令分类
    pub category: CommandCategory,
    /// 示例用法
    pub examples: Vec<String>,
}

/// 命令分类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandCategory {
    /// 通用命令（所有 Agent 支持）
    Universal,
    /// Agent 特定命令
    AgentSpecific,
    /// ClawdChat 内置命令
    Builtin,
}

/// 解析 @文件引用语法（OpenCode/Gemini）
pub fn parse_file_reference(input: &str) -> Option<(String, String)> {
    // 匹配 @filename 或 @filename:pattern 格式
    let re = regex::Regex::new(r"@([^\s:]+)(?::(\S+))?").ok()?;
    let caps = re.captures(input)?;
    let file = caps.get(1)?.as_str().to_string();
    let pattern = caps
        .get(2)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    Some((file, pattern))
}

/// 解析 !shell 命令语法
pub fn parse_shell_command(input: &str) -> Option<String> {
    if input.starts_with('!') {
        Some(input[1..].to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_builtin_command() {
        let router = CommandRouter::new(AgentType::ClaudeCode);

        // 测试 /list 命令
        let result = router.parse_command("/list").unwrap();
        assert!(matches!(result, SlashCommand::Builtin { .. }));

        // 测试普通输入
        let result = router.parse_command("hello world").unwrap();
        assert!(matches!(result, SlashCommand::Passthrough { .. }));
    }

    #[test]
    fn test_is_builtin_command() {
        let router = CommandRouter::new(AgentType::ClaudeCode);

        assert!(router.is_builtin_command("/list"));
        assert!(router.is_builtin_command("/spawn claude ."));
        assert!(router.is_builtin_command("/help"));
        assert!(!router.is_builtin_command("/plugin"));
    }

    #[test]
    fn test_parse_file_reference() {
        let result = parse_file_reference("Read @src/main.rs").unwrap();
        assert_eq!(result.0, "src/main.rs");

        let result = parse_file_reference("Search @src:pattern").unwrap();
        assert_eq!(result.0, "src");
        assert_eq!(result.1, "pattern");
    }

    #[test]
    fn test_parse_shell_command() {
        assert_eq!(parse_shell_command("!ls -la"), Some("ls -la".to_string()));
        assert_eq!(parse_shell_command("normal text"), None);
    }

    #[test]
    fn test_agent_type_parsing() {
        let router = CommandRouter::new(AgentType::ClaudeCode);

        assert_eq!(
            router.parse_agent_type("claude").unwrap(),
            AgentType::ClaudeCode
        );
        assert_eq!(
            router.parse_agent_type("opencode").unwrap(),
            AgentType::OpenCode
        );
        assert_eq!(
            router.parse_agent_type("gemini").unwrap(),
            AgentType::Gemini
        );
    }

    #[test]
    fn test_command_support() {
        let claude_router = CommandRouter::new(AgentType::ClaudeCode);
        let open_router = CommandRouter::new(AgentType::OpenCode);

        assert!(claude_router.is_agent_supported("/plugin"));
        assert!(!open_router.is_agent_supported("/plugin"));

        assert!(open_router.is_agent_supported("/sessions"));
        assert!(!claude_router.is_agent_supported("/sessions"));
    }
}
