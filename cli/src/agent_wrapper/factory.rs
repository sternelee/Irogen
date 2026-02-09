//! 统一 AI Agent 接口
//!
//! 此模块定义了统一的 AI Agent 接口，用于管理不同类型的 AI 编码工具。

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
pub trait Agent {
    /// 获取 agent 类型
    fn agent_type(&self) -> AgentType;

    /// 获取默认命令
    fn command(&self) -> &str;

    /// 检查是否可用
    fn check_available(&self) -> Result<AgentAvailability>;

    /// 获取版本
    fn get_version(&self) -> Result<String>;

    /// 获取默认参数
    fn default_args(&self) -> Vec<String>;

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
pub struct ClaudeCodeAgent;

impl Agent for ClaudeCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn command(&self) -> &str {
        "claude"
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
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
            .arg("--version")
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get Claude version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn default_args(&self) -> Vec<String> {
        vec![
            "-p".to_string(),  // --print for non-interactive output
        ]
    }
}

/// OpenCode Agent
pub struct OpenCodeAgent;

impl Agent for OpenCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenCode
    }

    fn command(&self) -> &str {
        "opencode"
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
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
            .arg("--version")
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get OpenCode version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn default_args(&self) -> Vec<String> {
        vec![
            "--non-interactive".to_string(),
        ]
    }
}

/// Gemini CLI Agent
pub struct GeminiAgent;

impl Agent for GeminiAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Gemini
    }

    fn command(&self) -> &str {
        "gemini"
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("version")
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
            .arg("version")
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get Gemini version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn default_args(&self) -> Vec<String> {
        vec![
            "chat".to_string(),
            "--non-interactive".to_string(),
        ]
    }
}

/// OpenAI Codex Agent
pub struct CodexAgent;

impl Agent for CodexAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Codex
    }

    fn command(&self) -> &str {
        "codex"
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
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
            .arg("--version")
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get Codex version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn default_args(&self) -> Vec<String> {
        vec![
            "exec".to_string(),  // Run non-interactively
        ]
    }
}

/// Agent 工厂
pub struct AgentFactory;

impl AgentFactory {
    /// 根据 AgentType 创建对应的 Agent 实现
    pub fn create(agent_type: AgentType) -> Box<dyn Agent> {
        match agent_type {
            AgentType::ClaudeCode => Box::new(ClaudeCodeAgent),
            AgentType::OpenCode => Box::new(OpenCodeAgent),
            AgentType::Codex => Box::new(CodexAgent),
            AgentType::Gemini => Box::new(GeminiAgent),
            AgentType::Custom => {
                // 自定义 agent 需要用户提供命令
                Box::new(ClaudeCodeAgent) // 默认回退到 Claude
            }
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
        ];

        for agent in agents {
            let agent_type = agent.agent_type();
            match agent.check_available() {
                Ok(availability) => {
                    if availability.available {
                        info!("✅ {:?} is available: {}", agent_type, availability.version.as_ref().unwrap_or(&"unknown".to_string()));
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

        // 优先级: Claude > Codex > OpenCode > Gemini
        if available.contains_key(&AgentType::ClaudeCode) {
            return Some(AgentType::ClaudeCode);
        }
        if available.contains_key(&AgentType::Codex) {
            return Some(AgentType::Codex);
        }
        if available.contains_key(&AgentType::OpenCode) {
            return Some(AgentType::OpenCode);
        }
        if available.contains_key(&AgentType::Gemini) {
            return Some(AgentType::Gemini);
        }

        None
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
    }

    #[test]
    fn test_agent_factory_get_default() {
        // 这个测试依赖于系统上是否安装了相应的工具
        let default = AgentFactory::get_default();
        // 不断言结果，因为测试环境可能没有安装这些工具
        println!("Default agent: {:?}", default);
    }
}
