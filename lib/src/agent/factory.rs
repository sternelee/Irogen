//! 统一 AI Agent 接口
//!
//! 此模块定义了统一的 AI Agent 接口，用于管理不同类型的 AI 编码工具。
//!
//! # ACP-Based Architecture
//!
//! 所有 agent 类型都通过 ACP (Agent Client Protocol) 接入。
//! 不同 agent 类型只是提供不同的命令和配置参数。

use anyhow::Result;
use riterm_shared::message_protocol::AgentType;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use tracing::{debug, info};

/// Agent 可用性检查结果
#[derive(Debug, Clone, Serialize)]
pub struct AgentAvailability {
    /// Agent 是否可用
    pub available: bool,
    /// Agent 版本
    pub version: Option<String>,
    /// Agent 可执行路径
    pub executable: String,
}

/// 统一的 Agent 接口
///
/// 所有 agent 类型都通过 ACP 协议接入，因此都需要提供
/// ACP 兼容的命令和参数配置。
pub trait Agent {
    /// 获取 agent 类型
    fn agent_type(&self) -> AgentType;

    /// 获取命令名称
    fn command(&self) -> &str;

    /// 获取 ACP 兼容的默认参数（通常包含 --stdio）
    fn default_args(&self) -> Vec<String>;

    /// 检查是否可用
    fn check_available(&self) -> Result<AgentAvailability>;

    /// 获取版本
    fn get_version(&self) -> Result<String>;

    /// 构建启动命令
    fn build_command(&self, project_path: &Path, extra_args: Vec<String>) -> Command {
        let mut cmd = Command::new(self.command());
        cmd.args(self.default_args())
            .args(extra_args)
            .current_dir(project_path);
        cmd
    }
}

/// Claude Code Agent
///
/// Uses the `claude` CLI directly with SDK Control Protocol for streaming
/// JSON communication over stdio. The default_args provide the flags needed
/// for SDK-mode sessions (streaming JSON input/output with permission prompts).
///
/// Requires: `claude` CLI installed (https://docs.anthropic.com/en/docs/claude-code)
pub struct ClaudeCodeAgent;

impl Agent for ClaudeCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn command(&self) -> &str {
        "claude"
    }

    fn default_args(&self) -> Vec<String> {
        vec![
            "-p".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--input-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--permission-prompt-tool".to_string(),
            "stdio".to_string(),
        ]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new("claude").arg("--version").output()?;
        let available = output.status.success();
        let version = if available {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        };
        Ok(AgentAvailability {
            available,
            version,
            executable: self.command().to_string(),
        })
    }

    fn get_version(&self) -> Result<String> {
        let output = Command::new("claude").arg("--version").output()?;
        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "Failed to get Claude Code version. Ensure 'claude' CLI is installed."
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// OpenCode Agent (ACP compatible)
///
/// OpenCode is an ACP-compatible agent that communicates via JSON-RPC 2.0.
pub struct OpenCodeAgent;

impl Agent for OpenCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenCode
    }

    fn command(&self) -> &str {
        "opencode"
    }

    fn default_args(&self) -> Vec<String> {
        // OpenCode uses --stdio for ACP communication
        vec!["--stdio".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command()).arg("--version").output()?;

        let available = output.status.success();
        let version = if available {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        };

        Ok(AgentAvailability {
            available,
            version,
            executable: self.command().to_string(),
        })
    }

    fn get_version(&self) -> Result<String> {
        let output = Command::new(self.command()).arg("--version").output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get OpenCode version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// Gemini CLI Agent (ACP compatible)
///
/// Gemini CLI is an ACP-compatible agent that communicates via JSON-RPC 2.0.
pub struct GeminiAgent;

impl Agent for GeminiAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Gemini
    }

    fn command(&self) -> &str {
        "gemini"
    }

    fn default_args(&self) -> Vec<String> {
        // Gemini CLI uses --stdio for ACP communication
        vec!["--stdio".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command()).arg("--version").output()?;

        let available = output.status.success();
        let version = if available {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        };

        Ok(AgentAvailability {
            available,
            version,
            executable: self.command().to_string(),
        })
    }

    fn get_version(&self) -> Result<String> {
        let output = Command::new(self.command()).arg("--version").output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get Gemini version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// OpenAI Codex Agent (ACP compatible)
///
/// Codex is an ACP-compatible agent that communicates via JSON-RPC 2.0.
pub struct CodexAgent;

impl Agent for CodexAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn command(&self) -> &str {
        "codex"
    }

    fn default_args(&self) -> Vec<String> {
        // Codex uses --stdio for ACP communication
        vec!["--stdio".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command()).arg("--version").output()?;

        let available = output.status.success();
        let version = if available {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        };

        Ok(AgentAvailability {
            available,
            version,
            executable: self.command().to_string(),
        })
    }

    fn get_version(&self) -> Result<String> {
        let output = Command::new(self.command()).arg("--version").output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get Codex version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// GitHub Copilot Agent (ACP compatible)
///
/// GitHub Copilot is an ACP-compatible agent that communicates via JSON-RPC 2.0.
pub struct CopilotAgent;

impl Agent for CopilotAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Copilot
    }

    fn command(&self) -> &str {
        "gh"
    }

    fn default_args(&self) -> Vec<String> {
        // GitHub Copilot uses copilot --stdio for ACP communication
        vec!["copilot".to_string(), "--stdio".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .args(["copilot", "--version"])
            .output()?;

        let available = output.status.success();
        let version = if available {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        };

        Ok(AgentAvailability {
            available,
            version,
            executable: self.command().to_string(),
        })
    }

    fn get_version(&self) -> Result<String> {
        let output = Command::new(self.command())
            .args(["copilot", "--version"])
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get Copilot version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// Qwen Code Agent (ACP compatible)
///
/// Qwen Code is an ACP-compatible agent that communicates via JSON-RPC 2.0.
pub struct QwenAgent;

impl Agent for QwenAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Qwen
    }

    fn command(&self) -> &str {
        "qwen-agent"
    }

    fn default_args(&self) -> Vec<String> {
        // Qwen Code uses --stdio for ACP communication
        vec!["--stdio".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command()).arg("--version").output()?;

        let available = output.status.success();
        let version = if available {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        };

        Ok(AgentAvailability {
            available,
            version,
            executable: self.command().to_string(),
        })
    }

    fn get_version(&self) -> Result<String> {
        let output = Command::new(self.command()).arg("--version").output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get Qwen version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// ZeroClaw Agent (built-in, no external binary)
///
/// ZeroClaw is an in-process agent that calls LLM APIs directly.
/// It supports 22+ providers and needs no external CLI.
pub struct ZeroClawAgent;

impl Agent for ZeroClawAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::ZeroClaw
    }

    fn command(&self) -> &str {
        "zeroclaw" // Not actually used — in-process
    }

    fn default_args(&self) -> Vec<String> {
        vec![] // Configuration passed via extra_args at spawn time
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        // Always available — it's built-in
        Ok(AgentAvailability {
            available: true,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            executable: "built-in".to_string(),
        })
    }

    fn get_version(&self) -> Result<String> {
        Ok(env!("CARGO_PKG_VERSION").to_string())
    }
}

/// Agent 工厂
pub struct AgentFactory;

impl AgentFactory {
    /// 根据 AgentType 创建对应的 Agent 实现
    ///
    /// 所有 agent 类型都提供 ACP 兼容的配置，因此可以统一通过
    /// AcpStreamingSession 进行通信。
    pub fn create(agent_type: AgentType) -> Box<dyn Agent> {
        match agent_type {
            AgentType::ClaudeCode => Box::new(ClaudeCodeAgent),
            AgentType::OpenCode => Box::new(OpenCodeAgent),
            AgentType::Codex => Box::new(CodexAgent),
            AgentType::Gemini => Box::new(GeminiAgent),
            AgentType::Copilot => Box::new(CopilotAgent),
            AgentType::Qwen => Box::new(QwenAgent),
            AgentType::ZeroClaw => Box::new(ZeroClawAgent),
            AgentType::AcpAgent => Box::new(ClaudeCodeAgent), // AcpAgent uses Claude as default
            AgentType::Custom => Box::new(ClaudeCodeAgent),   // Custom defaults to Claude
        }
    }

    /// 检查所有可用的 agent
    pub fn check_all_available() -> Result<HashMap<AgentType, AgentAvailability>> {
        let mut results = HashMap::new();

        let agents: Vec<Box<dyn Agent>> = vec![
            Box::new(ClaudeCodeAgent),
            Box::new(OpenCodeAgent),
            Box::new(CodexAgent),
            Box::new(GeminiAgent),
            Box::new(CopilotAgent),
            Box::new(QwenAgent),
            Box::new(ZeroClawAgent),
        ];

        for agent in agents {
            let agent_type = agent.agent_type();
            match agent.check_available() {
                Ok(availability) => {
                    if availability.available {
                        info!(
                            "✅ {:?} is available (ACP-compatible): {}",
                            agent_type,
                            availability
                                .version
                                .as_ref()
                                .unwrap_or(&"unknown".to_string())
                        );
                        results.insert(agent_type, availability);
                    } else {
                        debug!("❌ {:?} is not available", agent_type);
                    }
                }
                Err(e) => {
                    debug!("❌ Failed to check {:?}: {}", agent_type, e);
                }
            }
        }

        Ok(results)
    }

    /// 获取默认的 agent (优先使用可用的)
    pub fn get_default() -> Option<AgentType> {
        let available = Self::check_all_available().ok()?;

        // 优先级: Claude > Codex > OpenCode > Copilot > Qwen > Gemini
        if available.contains_key(&AgentType::ClaudeCode) {
            return Some(AgentType::ClaudeCode);
        }
        if available.contains_key(&AgentType::Codex) {
            return Some(AgentType::Codex);
        }
        if available.contains_key(&AgentType::OpenCode) {
            return Some(AgentType::OpenCode);
        }
        if available.contains_key(&AgentType::Copilot) {
            return Some(AgentType::Copilot);
        }
        if available.contains_key(&AgentType::Qwen) {
            return Some(AgentType::Qwen);
        }
        if available.contains_key(&AgentType::Gemini) {
            return Some(AgentType::Gemini);
        }

        None
    }

    /// 获取 agent 的 ACP 命令和参数
    ///
    /// 返回 (command, args) 元组，用于启动 ACP 会话。
    pub fn get_acp_command(agent_type: AgentType) -> (String, Vec<String>) {
        let agent = Self::create(agent_type);
        (agent.command().to_string(), agent.default_args())
    }

    /// Get the SDK command and arguments for Claude Code
    ///
    /// This returns the command and args for direct Claude CLI communication
    /// via the SDK Control Protocol (streaming JSON over stdio).
    pub fn get_sdk_command(agent_type: AgentType) -> Option<(String, Vec<String>)> {
        match agent_type {
            AgentType::ClaudeCode => {
                let agent = ClaudeCodeAgent;
                Some((agent.command().to_string(), agent.default_args()))
            }
            _ => None, // Other agents use ACP
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_factory_create() {
        let claude = AgentFactory::create(AgentType::ClaudeCode);
        assert_eq!(claude.agent_type(), AgentType::ClaudeCode);
        assert_eq!(claude.command(), "claude");
        assert!(!claude.default_args().is_empty());
    }

    #[test]
    fn test_acp_command() {
        let (cmd, args) = AgentFactory::get_acp_command(AgentType::ClaudeCode);
        assert_eq!(cmd, "claude");
        assert!(!args.is_empty());
    }

    #[test]
    fn test_sdk_command() {
        let result = AgentFactory::get_sdk_command(AgentType::ClaudeCode);
        assert!(result.is_some());
        let (cmd, args) = result.unwrap();
        assert_eq!(cmd, "claude");
        assert!(args.contains(&"-p".to_string()));

        // Other agents should return None for SDK
        let result = AgentFactory::get_sdk_command(AgentType::OpenCode);
        assert!(result.is_none());
    }

    #[test]
    fn test_agent_factory_get_default() {
        // 这个测试依赖于系统上是否安装了相应的工具
        let default = AgentFactory::get_default();
        println!("Default agent: {:?}", default);
    }
}
