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

/// Claude Code Agent (ACP compatible)
///
/// Claude Code does not natively support ACP over stdio.
/// Instead, the `@zed-industries/claude-code-acp` npm package provides an ACP
/// bridge that wraps Claude Code via the official Claude Agent SDK.
///
/// Install: `npm install -g @zed-industries/claude-code-acp`
/// Command: `claude-code-acp` (no arguments needed, communicates via ACP JSON-RPC over stdio)
pub struct ClaudeCodeAgent;

impl Agent for ClaudeCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn command(&self) -> &str {
        "claude-code-acp"
    }

    fn default_args(&self) -> Vec<String> {
        // claude-code-acp communicates via ACP JSON-RPC over stdio with no extra args
        vec![]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        // First check if claude-code-acp is available
        let output = Command::new(self.command()).arg("--version").output();
        match output {
            Ok(output) if output.status.success() => {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Ok(AgentAvailability {
                    available: true,
                    version: Some(version),
                    executable: self.command().to_string(),
                })
            }
            _ => {
                // Fall back to checking if claude itself is available
                let claude_output = Command::new("claude").arg("--version").output()?;
                let available = claude_output.status.success();
                let version = if available {
                    Some(String::from_utf8_lossy(&claude_output.stdout).trim().to_string())
                } else {
                    None
                };
                Ok(AgentAvailability {
                    available,
                    version,
                    executable: self.command().to_string(),
                })
            }
        }
    }

    fn get_version(&self) -> Result<String> {
        let output = Command::new(self.command()).arg("--version").output();
        match output {
            Ok(output) if output.status.success() => {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            }
            _ => {
                // Fall back to claude version
                let claude_output = Command::new("claude").arg("--version").output()?;
                if !claude_output.status.success() {
                    return Err(anyhow::anyhow!("Failed to get Claude Code version. Install claude-code-acp: npm install -g @zed-industries/claude-code-acp"));
                }
                Ok(String::from_utf8_lossy(&claude_output.stdout).trim().to_string())
            }
        }
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
            AgentType::AcpAgent => Box::new(ClaudeCodeAgent), // AcpAgent uses Claude as default
            AgentType::Custom => Box::new(ClaudeCodeAgent), // Custom defaults to Claude
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_factory_create() {
        let claude = AgentFactory::create(AgentType::ClaudeCode);
        assert_eq!(claude.agent_type(), AgentType::ClaudeCode);
        assert_eq!(claude.command(), "claude-code-acp");
        assert!(claude.default_args().is_empty());
    }

    #[test]
    fn test_acp_command() {
        let (cmd, args) = AgentFactory::get_acp_command(AgentType::ClaudeCode);
        assert_eq!(cmd, "claude-code-acp");
        assert!(args.is_empty());
    }

    #[test]
    fn test_agent_factory_get_default() {
        // 这个测试依赖于系统上是否安装了相应的工具
        let default = AgentFactory::get_default();
        println!("Default agent: {:?}", default);
    }
}
