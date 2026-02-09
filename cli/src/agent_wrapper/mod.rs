//! AI Agent 管理模块
//!
//! 此模块负责启动和管理各种 AI 编码代理（Claude Code, OpenCode, Gemini 等），
//! 并处理与它们的 stdin/stdout 通信。

pub mod claude;
pub mod codex;
pub mod factory;
pub mod gemini;
pub mod opencode;

pub use claude::ClaudeOutputParser;
pub use codex::CodexOutputParser;
pub use factory::{Agent, AgentAvailability, AgentFactory, ClaudeCodeAgent, CodexAgent, GeminiAgent, OpenCodeAgent};
pub use gemini::GeminiOutputParser;
pub use opencode::OpenCodeOutputParser;

use anyhow::{Context, Result};
use riterm_shared::message_protocol::{
    AgentControlAction, AgentMessageContent, AgentSessionMetadata, AgentType,
};
use std::collections::HashMap;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// AI Agent 管理器
///
/// 负责启动和管理 AI Agent 进程，处理消息转发
pub struct AgentManager {
    /// 活跃的 Agent 会话
    sessions: Arc<RwLock<HashMap<String, AgentSession>>>,
    /// 会话 ID 到 Agent ID 的映射
    session_to_agent: Arc<RwLock<HashMap<String, String>>>,
}

/// Agent 会话信息
#[derive(Clone)]
struct AgentSession {
    /// 会话 ID
    session_id: String,
    /// Agent 类型
    agent_type: AgentType,
    /// 子进程
    child: Arc<Mutex<Option<AgentChild>>>,
    /// 会话元数据
    metadata: AgentSessionMetadata,
    /// 是否被远程控制
    controlled_by_remote: Arc<RwLock<bool>>,
    /// 权限请求等待响应
    pending_permissions: Arc<RwLock<HashMap<String, PendingPermission>>>,
}

/// Agent 子进程包装
struct AgentChild {
    /// 子进程句柄
    child: Child,
    /// stdin 写入器
    stdin: ChildStdin,
}

/// 待处理的权限请求
struct PendingPermission {
    request_id: String,
    tool_name: String,
    tool_params: serde_json::Value,
    created_at: u64,
}

impl AgentManager {
    /// 创建新的 AgentManager
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_to_agent: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 启动 AI Agent 会话
    ///
    /// # Arguments
    /// * `agent_type` - AI Agent 类型
    /// * `project_path` - 项目路径
    /// * `args` - 额外的命令行参数
    ///
    /// # Returns
    /// 返回会话 ID 和元数据
    pub async fn start_session(
        &self,
        agent_type: AgentType,
        project_path: String,
        args: Vec<String>,
    ) -> Result<(String, AgentSessionMetadata)> {
        info!("Starting AI Agent session: {:?} in {}", agent_type, project_path);

        let session_id = Uuid::new_v4().to_string();
        let (agent_id, command) = self.build_agent_command(&agent_type, &project_path, args)?;

        debug!("Spawning agent: {:?}", command);

        // Get the program name before moving command
        let program_name = command.get_program().to_string_lossy().to_string();

        // Check if the command exists before spawning
        if let Err(e) = std::process::Command::new(&program_name)
            .arg("--version")
            .output()
        {
            error!("Agent command '{}' not found or not executable: {}", program_name, e);
            return Err(anyhow::anyhow!(
                "Agent command '{}' not found. Please install the AI agent CLI tool first.\n\
                 - Claude Code: https://claude.ai/code\n\
                 - Codex: https://github.com/openai/openai-codex\n\
                 - OpenCode: npm install -g @openai/openai-codex\n\
                 - Gemini: npm install -g @google-cloud/generative-ai-cli\n\
                 - Error: {}",
                program_name,
                e
            ));
        }

        let mut command_mut = command;
        let mut child = command_mut
            .spawn()
            .with_context(|| format!("Failed to spawn agent process '{}'. Please ensure the command is installed and in PATH.", program_name))?;

        let stdin = child
            .stdin
            .take()
            .context("Failed to get stdin handle")?;

        let agent_child = AgentChild {
            child,
            stdin,
        };

        // 获取系统信息构建元数据
        let metadata = self.build_session_metadata(
            session_id.clone(),
            agent_type,
            project_path,
        ).await;

        // 创建会话
        let session = AgentSession {
            session_id: session_id.clone(),
            agent_type,
            child: Arc::new(Mutex::new(Some(agent_child))),
            metadata: metadata.clone(),
            controlled_by_remote: Arc::new(RwLock::new(false)),
            pending_permissions: Arc::new(RwLock::new(HashMap::new())),
        };

        // 注册会话
        {
            let mut sessions = self.sessions.write().await;
            let mut session_map = self.session_to_agent.write().await;
            sessions.insert(session_id.clone(), session);
            session_map.insert(session_id.clone(), agent_id);
        }

        // 启动 stdout 处理任务
        self.start_stdout_handler(session_id.clone()).await;

        info!("AI Agent session started: {}", session_id);
        Ok((session_id, metadata))
    }

    /// 构建 Agent 命令
    fn build_agent_command(
        &self,
        agent_type: &AgentType,
        project_path: &str,
        extra_args: Vec<String>,
    ) -> Result<(String, Command)> {
        let agent_id = Uuid::new_v4().to_string();

        let mut command = match agent_type {
            AgentType::ClaudeCode => {
                // Use -p for non-interactive mode (reads from stdin, writes to stdout)
                let mut cmd = Command::new("claude");
                cmd.arg("-p")  // --print for non-interactive output
                   .current_dir(project_path);
                cmd
            }
            AgentType::OpenCode => {
                let mut cmd = Command::new("opencode");
                cmd.arg("--non-interactive")
                   .current_dir(project_path);
                cmd
            }
            AgentType::Codex => {
                // Use 'exec' subcommand for non-interactive mode
                let mut cmd = Command::new("codex");
                cmd.arg("exec")  // Run non-interactively
                   .current_dir(project_path);
                cmd
            }
            AgentType::Gemini => {
                let mut cmd = Command::new("gemini");
                cmd.arg("chat")
                   .arg("--non-interactive")
                   .current_dir(project_path);
                cmd
            }
            AgentType::Custom => {
                // 自定义 agent 由用户提供完整命令
                if extra_args.is_empty() {
                    return Err(anyhow::anyhow!("Custom agent requires command"));
                }
                let mut cmd = Command::new(&extra_args[0]);
                if extra_args.len() > 1 {
                    cmd.args(&extra_args[1..]);
                }
                cmd.current_dir(project_path);
                cmd
            }
        };

        // 添加额外参数
        if !matches!(agent_type, AgentType::Custom) {
            command.args(extra_args);
        }

        // 配置 stdio
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        Ok((agent_id, command))
    }

    /// 构建会话元数据
    async fn build_session_metadata(
        &self,
        session_id: String,
        agent_type: AgentType,
        project_path: String,
    ) -> AgentSessionMetadata {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 获取 git 分支
        let git_branch = self.get_git_branch(&project_path).await;

        // 获取系统信息
        let hostname = gethostname::gethostname()
            .to_string_lossy()
            .to_string();
        let os = std::env::consts::OS.to_string();

        // 获取 agent 版本
        let agent_version = self.get_agent_version(&agent_type).await;

        // 获取当前目录
        let current_dir = std::env::current_dir()
            .ok()
            .and_then(|p| p.to_str().map(String::from))
            .unwrap_or_else(|| project_path.clone());

        AgentSessionMetadata {
            session_id,
            agent_type,
            project_path,
            started_at: now,
            active: true,
            controlled_by_remote: false,
            hostname,
            os,
            agent_version,
            current_dir,
            git_branch,
            machine_id: gethostname::gethostname().to_string_lossy().to_string(),
        }
    }

    /// 获取 git 分支
    async fn get_git_branch(&self, project_path: &str) -> Option<String> {
        let output = tokio::process::Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(project_path)
            .output()
            .await;

        output.ok().and_then(|o| {
            let branch = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if branch.is_empty() || branch == "HEAD" {
                None
            } else {
                Some(branch)
            }
        })
    }

    /// 获取 agent 版本
    async fn get_agent_version(&self, agent_type: &AgentType) -> Option<String> {
        let cmd = match agent_type {
            AgentType::ClaudeCode => "claude",
            AgentType::OpenCode => "opencode",
            AgentType::Codex => "codex",
            AgentType::Gemini => "gemini",
            AgentType::Custom => return None,
        };

        let output = tokio::process::Command::new(cmd)
            .arg("--version")
            .output()
            .await;

        output.ok().and_then(|o| {
            let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if version.is_empty() {
                None
            } else {
                Some(version)
            }
        })
    }

    /// 启动 stdout 处理任务
    async fn start_stdout_handler(&self, session_id: String) {
        let sessions = self.sessions.clone();

        tokio::spawn(async move {
            let _stdout_rx = {
                let session_lock = sessions.read().await;
                let session = session_lock.get(&session_id);
                if session.is_none() {
                    error!("Session not found for stdout handler: {}", session_id);
                    return;
                }
                let _session = session.unwrap();

                // 获取 stdout 读取器
                // 注意：这里需要重新设计，因为 ChildStdout 需要被移动
                // 我们将在 AgentSession 中使用 mpsc channel 来转发输出
                return;
            };
        });
    }

    /// 发送消息到 Agent
    pub async fn send_to_agent(
        &self,
        session_id: &str,
        content: String,
    ) -> Result<()> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        let mut child_guard = session.child.lock().await;
        let child = child_guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Agent process not available"))?;

        // 添加换行符，因为交互式 CLI 程序需要
        let message = format!("{}\n", content);

        use std::io::Write;
        child.stdin
            .write_all(message.as_bytes())
            .context("Failed to write to agent stdin")?;
        child.stdin.flush().context("Failed to flush agent stdin")?;

        debug!("Sent message to agent {}: {}", session_id, content);
        Ok(())
    }

    /// 发送控制命令到 Agent
    pub async fn send_control(
        &self,
        session_id: &str,
        action: AgentControlAction,
    ) -> Result<()> {
        match action {
            AgentControlAction::SendInput { content } => {
                self.send_to_agent(session_id, content).await?;
            }
            AgentControlAction::SendInterrupt => {
                // 发送 Ctrl+C (ASCII 3)
                self.send_to_agent(session_id, "\x03".to_string()).await?;
            }
            AgentControlAction::Pause => {
                // 设置暂停状态
                let sessions = self.sessions.read().await;
                if let Some(session) = sessions.get(session_id) {
                    *session.controlled_by_remote.write().await = true;
                }
            }
            AgentControlAction::Resume => {
                // 恢复状态
                let sessions = self.sessions.read().await;
                if let Some(session) = sessions.get(session_id) {
                    *session.controlled_by_remote.write().await = false;
                }
            }
            AgentControlAction::Terminate => {
                self.stop_session(session_id).await?;
            }
            AgentControlAction::GetStatus => {
                // 返回状态信息，不执行操作
            }
        }

        Ok(())
    }

    /// 处理权限请求
    pub async fn handle_permission_request(
        &self,
        session_id: &str,
        tool_name: String,
        tool_params: serde_json::Value,
    ) -> Result<String> {
        let request_id = Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        let permission = PendingPermission {
            request_id: request_id.clone(),
            tool_name: tool_name.clone(),
            tool_params: tool_params.clone(),
            created_at: now,
        };

        // 存储待处理的权限请求
        session.pending_permissions.write().await.insert(
            request_id.clone(),
            permission,
        );

        info!(
            "Permission request created: {} for tool {} in session {}",
            request_id, tool_name, session_id
        );

        Ok(request_id)
    }

    /// 处理权限响应
    pub async fn handle_permission_response(
        &self,
        session_id: &str,
        request_id: &str,
        approved: bool,
        reason: Option<String>,
    ) -> Result<()> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        // 移除待处理的权限请求
        session.pending_permissions.write().await.remove(request_id);

        // 将响应发送回 Agent
        let response = if approved {
            "y\n".to_string()  // 批准
        } else {
            let msg = reason.unwrap_or_else(|| "n".to_string());
            format!("{}\n", msg)
        };

        drop(sessions); // 释放读锁

        self.send_to_agent(session_id, response).await?;

        info!(
            "Permission response sent: {} approved={}",
            request_id, approved
        );

        Ok(())
    }

    /// 停止会话
    pub async fn stop_session(&self, session_id: &str) -> Result<()> {
        info!("Stopping session: {}", session_id);

        let mut sessions = self.sessions.write().await;
        let mut session_map = self.session_to_agent.write().await;

        if let Some(session) = sessions.remove(session_id) {
            session_map.remove(session_id);

            let mut child_guard = session.child.lock().await;
            if let Some(mut agent_child) = child_guard.take() {
                // 尝试优雅关闭
                if let Err(e) = agent_child.child.kill() {
                    warn!("Failed to kill agent process: {}", e);
                }
                let _ = agent_child.child.wait();
            }

            info!("Session stopped: {}", session_id);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Session not found: {}", session_id))
        }
    }

    /// 获取会话元数据
    pub async fn get_session_metadata(&self, session_id: &str) -> Option<AgentSessionMetadata> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).map(|s| s.metadata.clone())
    }

    /// 获取所有活跃会话
    pub async fn list_sessions(&self) -> Vec<AgentSessionMetadata> {
        let sessions = self.sessions.read().await;
        sessions.values().map(|s| s.metadata.clone()).collect()
    }

    /// 检查会话是否存在
    pub async fn session_exists(&self, session_id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions.contains_key(session_id)
    }

    /// 设置远程控制状态
    pub async fn set_remote_control(&self, session_id: &str, controlled: bool) -> Result<()> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        *session.controlled_by_remote.write().await = controlled;

        Ok(())
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Agent 输出处理器
///
/// 从 Agent stdout 读取输出并转换为 RiTerm 消息
pub struct AgentOutputHandler {
    session_id: String,
    agent_type: AgentType,
}

impl AgentOutputHandler {
    pub fn new(session_id: String, agent_type: AgentType) -> Self {
        Self {
            session_id,
            agent_type,
        }
    }

    /// 解析 Agent 输出
    pub fn parse_output(&self, line: &str) -> Option<AgentMessageContent> {
        // 这里需要根据不同的 agent 类型解析输出
        // Claude Code, OpenCode, Codex, Gemini 的输出格式不同

        match self.agent_type {
            AgentType::ClaudeCode => self.parse_claude_output(line),
            AgentType::OpenCode => self.parse_opencode_output(line),
            AgentType::Codex => self.parse_codex_output(line),
            AgentType::Gemini => self.parse_gemini_output(line),
            AgentType::Custom => self.parse_custom_output(line),
        }
    }

    fn parse_claude_output(&self, line: &str) -> Option<AgentMessageContent> {
        // 使用 ClaudeOutputParser 解析输出
        let parser = claude::ClaudeOutputParser::new().ok()?;
        let parse_result = parser.parse_line(line);
        Some(parse_result.to_message_content())
    }

    fn parse_opencode_output(&self, line: &str) -> Option<AgentMessageContent> {
        // 使用 OpenCodeOutputParser 解析输出
        let parser = opencode::OpenCodeOutputParser::new().ok()?;
        let parse_result = parser.parse_line(line);
        Some(parse_result.to_message_content())
    }

    fn parse_codex_output(&self, line: &str) -> Option<AgentMessageContent> {
        // 使用 CodexOutputParser 解析输出
        let parser = codex::CodexOutputParser::new().ok()?;
        let parse_result = parser.parse_line(line);
        Some(parse_result.to_message_content())
    }

    fn parse_gemini_output(&self, line: &str) -> Option<AgentMessageContent> {
        // 使用 GeminiOutputParser 解析输出
        let parser = gemini::GeminiOutputParser::new().ok()?;
        let parse_result = parser.parse_line(line);
        Some(parse_result.to_message_content())
    }

    fn parse_custom_output(&self, line: &str) -> Option<AgentMessageContent> {
        // 自定义 agent 输出解析
        Some(AgentMessageContent::AgentResponse {
            content: line.to_string(),
            thinking: false,
            message_id: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_agent_manager_creation() {
        let manager = AgentManager::new();
        assert_eq!(manager.list_sessions().await.len(), 0);
    }

    #[tokio::test]
    async fn test_session_not_exists() {
        let manager = AgentManager::new();
        assert!(!manager.session_exists("fake-id").await);
    }
}
