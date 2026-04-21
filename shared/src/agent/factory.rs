//! 统一 AI Agent 接口
//!
//! 此模块定义了统一的 AI Agent 接口，用于管理不同类型的 AI 编码工具。
//!
//! # ACP-Based Architecture
//!
//! 所有 agent 类型都通过 ACP (Agent Client Protocol) 接入。
//! 不同 agent 类型只是提供不同的命令和配置参数。

use crate::message_protocol::AgentType;
use anyhow::Result;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use tracing::{debug, info, warn};

use super::acp::get_extended_path;

/// Minimum Gemini CLI version that supports `--acp` flag
/// Versions before this use `--experimental-acp`
const GEMINI_ACP_FLAG_VERSION: [u32; 3] = [0, 33, 0];

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

#[derive(Debug, Clone, Default)]
pub struct AgentLaunchConfig {
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AgentConfigFile {
    agents: HashMap<String, AgentConfigEntry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct AgentConfigEntry {
    command: Option<String>,
    args: Option<Vec<String>>,
    env: Option<HashMap<String, String>>,
}

fn agent_config_path() -> Option<std::path::PathBuf> {
    if let Some(config_dir) = dirs::config_dir() {
        return Some(config_dir.join("irogen").join("agents.json"));
    }
    if let Ok(home) = std::env::var("HOME") {
        return Some(
            std::path::PathBuf::from(home)
                .join(".irogen")
                .join("agents.json"),
        );
    }
    None
}

fn load_agent_config() -> Option<AgentConfigFile> {
    let path = agent_config_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn agent_key(agent_type: AgentType) -> &'static str {
    match agent_type {
        AgentType::ClaudeCode => "claude",
        AgentType::OpenCode => "opencode",
        AgentType::Codex => "codex",
        AgentType::Cursor => "cursor",
        AgentType::Gemini => "gemini",
        AgentType::Cline => "cline",
        AgentType::Pi => "pi",
        AgentType::QwenCode => "qwen-code",
        AgentType::OpenClaw => "openclaw",
    }
}

fn resolve_launch_config(agent_type: AgentType) -> AgentLaunchConfig {
    let agent = AgentFactory::create(agent_type);
    let mut config = AgentLaunchConfig {
        command: agent.command().to_string(),
        args: agent.default_args(),
        env: HashMap::new(),
    };

    if let Some(entry) =
        load_agent_config().and_then(|cfg| cfg.agents.get(agent_key(agent_type)).cloned())
    {
        if let Some(command) = entry.command {
            config.command = command;
        }
        if let Some(args) = entry.args {
            config.args.extend(args);
        }
        if let Some(env) = entry.env {
            config.env.extend(env);
        }
    }

    config
}

fn command_exists(command: &str, env: &HashMap<String, String>) -> bool {
    let output = Command::new("which")
        .arg(command)
        .env("PATH", get_extended_path())
        .envs(env)
        .output();

    match output {
        Ok(out) => out.status.success() && !out.stdout.is_empty(),
        Err(_) => false,
    }
}

/// Parse a version string like "0.33.0" into [0, 33, 0]
fn parse_gemini_version(output: &str) -> Option<[u32; 3]> {
    // Version string is typically "gemini X.Y.Z" or just "X.Y.Z"
    let version_str = output.trim();

    // Extract version number from the string
    let version_part = version_str
        .split_whitespace()
        .find(|part| {
            part.chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        })
        .unwrap_or(version_str);

    let parts: Vec<u32> = version_part
        .split('.')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    if parts.len() >= 3 {
        Some([parts[0], parts[1], parts[2]])
    } else if parts.len() == 2 {
        Some([parts[0], parts[1], 0])
    } else if parts.len() == 1 {
        Some([parts[0], 0, 0])
    } else {
        None
    }
}

/// Compare two version arrays. Returns negative if left < right, 0 if equal, positive if left > right
fn compare_version_parts(left: &[u32], right: &[u32]) -> i32 {
    for i in 0..3 {
        let l = left.get(i).copied().unwrap_or(0);
        let r = right.get(i).copied().unwrap_or(0);
        if l != r {
            return l.cmp(&r) as i32;
        }
    }
    0
}

/// Detect Gemini CLI version with a timeout
fn detect_gemini_version(command: &str) -> Option<[u32; 3]> {
    let output = Command::new(command)
        .arg("--version")
        .env("PATH", get_extended_path())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let version_str = String::from_utf8_lossy(&output.stdout);
    parse_gemini_version(&version_str)
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

/// Claude Agent (ACP-compatible)
///
/// Runs a Claude Agent ACP adapter process (external agent model).
pub struct ClaudeCodeAgent;

impl Agent for ClaudeCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn command(&self) -> &str {
        "claude-agent-acp"
    }

    fn default_args(&self) -> Vec<String> {
        vec![]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;
        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "Failed to get Claude Agent ACP adapter version. Ensure 'claude-agent-acp' is installed."
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// OpenCode Agent (ACP compatible)
///
/// OpenCode is an ACP-compatible agent that communicates via JSON-RPC 2.0.
/// Uses "acp" subcommand to enable ACP mode.
pub struct OpenCodeAgent;

impl Agent for OpenCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenCode
    }

    fn command(&self) -> &str {
        "opencode"
    }

    fn default_args(&self) -> Vec<String> {
        // OpenCode uses "acp" subcommand for ACP communication
        vec!["acp".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get OpenCode version"));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// Gemini CLI Agent (ACP compatible)
///
/// Gemini CLI is an ACP-compatible agent that communicates via JSON-RPC 2.0.
/// Version >= 0.33.0 uses `--acp`, earlier versions use `--experimental-acp`.
pub struct GeminiAgent;

impl Agent for GeminiAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Gemini
    }

    fn command(&self) -> &str {
        "gemini"
    }

    fn default_args(&self) -> Vec<String> {
        // Detect version and choose appropriate flag
        let acp_flag = match detect_gemini_version(self.command()) {
            Some(version) => {
                if compare_version_parts(&version, &GEMINI_ACP_FLAG_VERSION) >= 0 {
                    debug!(
                        "Gemini version {}.{}.{} >= 0.33.0, using --acp",
                        version[0], version[1], version[2]
                    );
                    "--acp"
                } else {
                    debug!(
                        "Gemini version {}.{}.{} < 0.33.0, using --experimental-acp",
                        version[0], version[1], version[2]
                    );
                    "--experimental-acp"
                }
            }
            None => {
                // Fallback to --experimental-acp if version detection fails
                warn!("Could not detect Gemini version, falling back to --experimental-acp");
                "--experimental-acp"
            }
        };
        vec![acp_flag.to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

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
        "codex-acp"
    }

    fn default_args(&self) -> Vec<String> {
        vec![]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "Failed to get Codex ACP adapter version. Ensure 'codex-acp' is installed."
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// Cursor CLI Agent (ACP compatible)
///
/// Cursor exposes ACP through the native `cursor-agent acp` command.
pub struct CursorAgent;

impl Agent for CursorAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Cursor
    }

    fn command(&self) -> &str {
        "cursor-agent"
    }

    fn default_args(&self) -> Vec<String> {
        vec!["acp".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "Failed to get Cursor CLI version. Ensure 'cursor-agent' is installed."
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// Cline CLI Agent (ACP compatible)
pub struct ClineAgent;

impl Agent for ClineAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Cline
    }

    fn command(&self) -> &str {
        "cline"
    }

    fn default_args(&self) -> Vec<String> {
        vec!["acp".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "Failed to get Cline CLI version. Ensure 'cline' is installed."
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// Pi CLI Agent (ACP compatible)
pub struct PiAgent;

impl Agent for PiAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::Pi
    }

    fn command(&self) -> &str {
        "pi"
    }

    fn default_args(&self) -> Vec<String> {
        vec!["acp".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "Failed to get Pi CLI version. Ensure 'pi' is installed."
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// Qwen Code CLI Agent (ACP compatible)
pub struct QwenCodeAgent;

impl Agent for QwenCodeAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::QwenCode
    }

    fn command(&self) -> &str {
        "qwen"
    }

    fn default_args(&self) -> Vec<String> {
        vec!["acp".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "Failed to get Qwen Code CLI version. Ensure 'qwen' is installed."
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

/// OpenClaw Agent — WebSocket Gateway mode
///
/// OpenClaw uses WebSocket Gateway mode to communicate.
/// Requires running `openclaw gateway` to start the gateway.
pub struct OpenClawAgent;

impl Agent for OpenClawAgent {
    fn agent_type(&self) -> AgentType {
        AgentType::OpenClaw
    }

    fn command(&self) -> &str {
        "openclaw"
    }

    fn default_args(&self) -> Vec<String> {
        // OpenClaw uses "gateway" subcommand for WebSocket Gateway mode
        vec!["gateway".to_string()]
    }

    fn check_available(&self) -> Result<AgentAvailability> {
        let output = Command::new(self.command())
            .arg("--version")
            .env("PATH", get_extended_path())
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
            .env("PATH", get_extended_path())
            .output()?;

        if !output.status.success() {
            return Err(anyhow::anyhow!("Failed to get OpenClaw version"));
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
            AgentType::Cursor => Box::new(CursorAgent),
            AgentType::Gemini => Box::new(GeminiAgent),
            AgentType::Cline => Box::new(ClineAgent),
            AgentType::Pi => Box::new(PiAgent),
            AgentType::QwenCode => Box::new(QwenCodeAgent),
            AgentType::OpenClaw => Box::new(OpenClawAgent),
        }
    }

    /// 检查所有可用的 agent
    pub fn check_all_available() -> Result<HashMap<AgentType, AgentAvailability>> {
        let mut results = HashMap::new();

        let agent_types = [
            AgentType::ClaudeCode,
            AgentType::OpenCode,
            AgentType::Codex,
            AgentType::Cursor,
            AgentType::Gemini,
            AgentType::Cline,
            AgentType::Pi,
            AgentType::QwenCode,
            AgentType::OpenClaw,
        ];

        for agent_type in agent_types {
            match Self::check_available_with_config(agent_type) {
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

        // Priority: ClaudeCode > Codex > Cursor > Cline > Pi > QwenCode > OpenCode > OpenClaw > Gemini
        if available.contains_key(&AgentType::ClaudeCode) {
            return Some(AgentType::ClaudeCode);
        }
        if available.contains_key(&AgentType::Codex) {
            return Some(AgentType::Codex);
        }
        if available.contains_key(&AgentType::Cursor) {
            return Some(AgentType::Cursor);
        }
        if available.contains_key(&AgentType::Cline) {
            return Some(AgentType::Cline);
        }
        if available.contains_key(&AgentType::Pi) {
            return Some(AgentType::Pi);
        }
        if available.contains_key(&AgentType::QwenCode) {
            return Some(AgentType::QwenCode);
        }
        if available.contains_key(&AgentType::OpenCode) {
            return Some(AgentType::OpenCode);
        }
        if available.contains_key(&AgentType::OpenClaw) {
            return Some(AgentType::OpenClaw);
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
        let config = resolve_launch_config(agent_type);
        (config.command, config.args)
    }

    pub fn get_acp_launch(agent_type: AgentType) -> AgentLaunchConfig {
        resolve_launch_config(agent_type)
    }

    pub fn check_available_with_config(agent_type: AgentType) -> Result<AgentAvailability> {
        let config = resolve_launch_config(agent_type);
        let output = Command::new(&config.command)
            .arg("--version")
            .env("PATH", get_extended_path())
            .envs(&config.env)
            .output()?;

        let version = if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None
        };
        let available = output.status.success() || command_exists(&config.command, &config.env);

        Ok(AgentAvailability {
            available,
            version,
            executable: config.command,
        })
    }

    // All supported agents use ACP; SDK Control Protocol is not used here.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_factory_create() {
        let claude = AgentFactory::create(AgentType::ClaudeCode);
        assert_eq!(claude.agent_type(), AgentType::ClaudeCode);
        assert_eq!(claude.command(), "claude-agent-acp");
        assert!(claude.default_args().is_empty());
    }

    #[test]
    fn test_acp_command() {
        let (cmd, args) = AgentFactory::get_acp_command(AgentType::ClaudeCode);
        assert_eq!(cmd, "claude-agent-acp");
        assert!(args.is_empty());
    }

    #[test]
    fn test_agent_factory_get_default() {
        // 这个测试依赖于系统上是否安装了相应的工具
        let default = AgentFactory::get_default();
        println!("Default agent: {:?}", default);
    }

    #[test]
    fn test_parse_gemini_version() {
        assert_eq!(parse_gemini_version("gemini 0.33.0"), Some([0, 33, 0]));
        assert_eq!(parse_gemini_version("0.32.5"), Some([0, 32, 5]));
        assert_eq!(parse_gemini_version("gemini 1.0.0"), Some([1, 0, 0]));
        assert_eq!(parse_gemini_version("0.33"), Some([0, 33, 0]));
        assert_eq!(parse_gemini_version("1"), Some([1, 0, 0]));
        assert_eq!(parse_gemini_version("invalid"), None);
    }

    #[test]
    fn test_compare_version_parts() {
        assert!(compare_version_parts(&[0, 33, 0], &[0, 32, 0]) > 0);
        assert!(compare_version_parts(&[0, 32, 0], &[0, 33, 0]) < 0);
        assert_eq!(compare_version_parts(&[0, 33, 0], &[0, 33, 0]), 0);
        assert!(compare_version_parts(&[1, 0, 0], &[0, 33, 0]) > 0);
        assert!(compare_version_parts(&[0, 33, 1], &[0, 33, 0]) > 0);
    }

    #[test]
    fn test_gemini_acp_flag_threshold() {
        // Test the threshold version
        assert!(compare_version_parts(&GEMINI_ACP_FLAG_VERSION, &[0, 33, 0]) == 0);
        assert!(compare_version_parts(&[0, 33, 0], &GEMINI_ACP_FLAG_VERSION) == 0);
    }
}
