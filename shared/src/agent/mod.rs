//! Agent management module
//!
//! This module provides unified agent session management.
//! ClaudeCode uses SDK Control Protocol directly, other agents use ACP.

pub mod acp;
pub mod claude_sdk;
pub mod codex_acp;
pub mod events;
pub mod factory;
pub mod message_adapter;
pub mod openclaw_ws;
pub mod zeroclaw_session;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::message_protocol::AgentType;
use anyhow::{Context, Result, anyhow};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

pub use acp::AcpStreamingSession;
pub use claude_sdk::ClaudeSdkSession;
pub use codex_acp::CodexAcpSession;
pub use events::{
    AgentEvent, AgentTurnEvent, PendingPermission, PermissionMode, PermissionResponse,
};
pub use factory::{Agent, AgentAvailability, AgentFactory};
pub use message_adapter::event_to_message_content;
pub use openclaw_ws::OpenClawWsSession;
pub use zeroclaw_session::ZeroClawSession;

/// Session kind enum for unified agent management.
///
/// This enum wraps both ACP and SDK session types, providing
/// a unified interface through delegation methods.
#[derive(Clone)]
pub enum SessionKind {
    /// ACP-based session (for OpenCode, Gemini, etc.)
    Acp(Arc<AcpStreamingSession>),
    /// SDK Control Protocol session (for Claude Code)
    Sdk(Arc<ClaudeSdkSession>),
    /// Codex session via codex-core directly
    CodexAcp(Arc<CodexAcpSession>),
    /// ZeroClaw built-in agent (multi-provider LLM)
    ZeroClaw(Arc<ZeroClawSession>),
    /// OpenClaw Gateway WebSocket session
    OpenClawWs(Arc<OpenClawWsSession>),
}

impl SessionKind {
    /// Get session ID.
    pub fn session_id(&self) -> &str {
        match self {
            SessionKind::Acp(s) => s.session_id(),
            SessionKind::Sdk(s) => s.session_id(),
            SessionKind::CodexAcp(s) => s.session_id(),
            SessionKind::ZeroClaw(s) => s.session_id(),
            SessionKind::OpenClawWs(s) => s.session_id(),
        }
    }

    /// Get agent type.
    pub fn agent_type(&self) -> AgentType {
        match self {
            SessionKind::Acp(s) => s.agent_type(),
            SessionKind::Sdk(s) => s.agent_type(),
            SessionKind::CodexAcp(s) => s.agent_type(),
            SessionKind::ZeroClaw(s) => s.agent_type(),
            SessionKind::OpenClawWs(s) => s.agent_type(),
        }
    }

    /// Subscribe to agent events.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AgentTurnEvent> {
        match self {
            SessionKind::Acp(s) => s.subscribe(),
            SessionKind::Sdk(s) => s.subscribe(),
            SessionKind::CodexAcp(s) => s.subscribe(),
            SessionKind::ZeroClaw(s) => s.subscribe(),
            SessionKind::OpenClawWs(s) => s.subscribe(),
        }
    }

    /// Send a message to the agent.
    pub async fn send_message(
        &self,
        text: String,
        turn_id: &str,
        attachments: Vec<String>,
    ) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => s.send_message(text, turn_id, attachments).await,
            SessionKind::Sdk(s) => s.send_message(text, turn_id, attachments).await,
            SessionKind::CodexAcp(s) => s.send_message(text, turn_id, attachments).await,
            SessionKind::ZeroClaw(s) => s.send_message(text, turn_id, attachments).await,
            SessionKind::OpenClawWs(s) => s.send_message(text, turn_id, attachments).await,
        }
    }

    /// Interrupt current operation.
    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => s.interrupt().await,
            SessionKind::Sdk(s) => s.interrupt().await,
            SessionKind::CodexAcp(s) => s.interrupt().await,
            SessionKind::ZeroClaw(s) => s.interrupt().await,
            SessionKind::OpenClawWs(s) => s.interrupt().await,
        }
    }

    /// Get pending permission requests.
    pub async fn get_pending_permissions(
        &self,
    ) -> std::result::Result<Vec<PendingPermission>, String> {
        match self {
            SessionKind::Acp(s) => s.get_pending_permissions().await,
            SessionKind::Sdk(s) => s.get_pending_permissions().await,
            SessionKind::CodexAcp(s) => s.get_pending_permissions().await,
            SessionKind::ZeroClaw(s) => s.get_pending_permissions().await,
            SessionKind::OpenClawWs(s) => s.get_pending_permissions().await,
        }
    }

    /// Respond to a permission request.
    pub async fn respond_to_permission(
        &self,
        request_id: String,
        approved: bool,
        reason: Option<String>,
    ) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => s.respond_to_permission(request_id, approved, reason).await,
            SessionKind::Sdk(s) => s.respond_to_permission(request_id, approved, reason).await,
            SessionKind::CodexAcp(s) => s.respond_to_permission(request_id, approved, reason).await,
            SessionKind::ZeroClaw(s) => s.respond_to_permission(request_id, approved, reason).await,
            SessionKind::OpenClawWs(s) => {
                s.respond_to_permission(request_id, approved, reason).await
            }
        }
    }

    /// Gracefully shut down the session.
    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => s.shutdown().await,
            SessionKind::Sdk(s) => s.shutdown().await,
            SessionKind::CodexAcp(s) => s.shutdown().await,
            SessionKind::ZeroClaw(s) => s.shutdown().await,
            SessionKind::OpenClawWs(s) => s.shutdown().await,
        }
    }
}

/// Agent manager for managing multiple agent sessions
///
/// The AgentManager is responsible for creating and managing agent sessions.
/// ClaudeCode uses SDK Control Protocol; other agents use ACP.
#[derive(Clone)]
pub struct AgentManager {
    /// Active sessions by session ID
    sessions: Arc<RwLock<HashMap<String, Arc<SessionKind>>>>,
}

impl AgentManager {
    /// Create a new agent manager
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Start an agent session with automatic session ID generation
    ///
    /// # Arguments
    /// * `agent_type` - Type of agent to start
    /// * `binary_path` - Override path to agent binary (optional)
    /// * `extra_args` - Additional command-line arguments
    /// * `working_dir` - Working directory for agent
    /// * `home_dir` - Override home directory (optional)
    /// * `source` - Source identifier (e.g., "local", "remote")
    ///
    /// # Returns
    /// Session ID if successful, error otherwise
    pub async fn start_session(
        &self,
        agent_type: AgentType,
        binary_path: Option<String>,
        extra_args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        _source: String,
    ) -> Result<String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        self.start_session_with_id(
            session_id.clone(),
            agent_type,
            binary_path,
            extra_args,
            working_dir,
            home_dir,
            _source,
        )
        .await?;
        Ok(session_id)
    }

    /// Start an agent session with specific session ID
    ///
    /// For ClaudeCode, this creates a SDK Control Protocol session.
    /// For other agents, this creates an ACP-based session.
    pub async fn start_session_with_id(
        &self,
        session_id: String,
        agent_type: AgentType,
        binary_path: Option<String>,
        extra_args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        _source: String,
    ) -> Result<()> {
        info!("Starting {:?} session with ID: {}", agent_type, session_id);

        // Perform availability check before starting to provide better error messages
        if binary_path.is_none() {
            let agent = AgentFactory::create(agent_type);
            match agent.check_available() {
                Ok(availability) => {
                    if !availability.available {
                        let mut error_msg = format!(
                            "Agent {:?} is not available. Please ensure '{}' is installed and in your PATH.",
                            agent_type,
                            agent.command()
                        );

                        // Provide specific instructions for common agents
                        match agent_type {
                            AgentType::ClaudeCode => {
                                error_msg += " You can install it with: npm install -g @anthropic-ai/claude-code";
                            }
                            AgentType::Copilot => {
                                error_msg += " You can install the Copilot extension with: gh extension install github/gh-copilot";
                            }
                            AgentType::Gemini => {
                                error_msg += " You can install the Gemini CLI with: npm install -g @google/gemini-code-cli";
                            }
                            _ => {}
                        }

                        return Err(anyhow!(error_msg));
                    }
                }
                Err(err) => {
                    warn!(
                        "Pre-start availability check failed for {:?}: {}",
                        agent_type, err
                    );
                }
            }
        }

        let session: Arc<SessionKind> = if agent_type == AgentType::ClaudeCode {
            // Claude Code uses SDK Control Protocol
            let (command, _default_args) = AgentFactory::get_sdk_command(agent_type)
                .ok_or_else(|| anyhow!("No SDK command available for ClaudeCode"))?;

            // Only pass extra_args; run_sdk_runtime adds the SDK flags itself
            let args = extra_args;

            let sdk_session = ClaudeSdkSession::spawn(
                session_id.clone(),
                agent_type,
                binary_path.unwrap_or(command),
                args,
                working_dir,
                home_dir,
            )
            .await
            .with_context(|| format!("Failed to start SDK session for {:?}", agent_type))?;

            Arc::new(SessionKind::Sdk(Arc::new(sdk_session)))
        } else if agent_type == AgentType::Codex {
            // Codex uses codex-core directly (in-process)
            let codex_session =
                CodexAcpSession::spawn(session_id.clone(), agent_type, working_dir, home_dir)
                    .await
                    .with_context(|| format!("Failed to start Codex session"))?;

            Arc::new(SessionKind::CodexAcp(Arc::new(codex_session)))
        } else if agent_type == AgentType::ZeroClaw {
            // ZeroClaw built-in agent (in-process, multi-provider LLM)
            let zeroclaw_session =
                ZeroClawSession::spawn(session_id.clone(), agent_type, working_dir, extra_args)
                    .await
                    .with_context(|| "Failed to start ZeroClaw session".to_string())?;

            Arc::new(SessionKind::ZeroClaw(Arc::new(zeroclaw_session)))
        } else if agent_type == AgentType::OpenClaw {
            // OpenClaw uses WebSocket Gateway mode
            let (command, default_args) = AgentFactory::get_acp_command(agent_type);

            let mut args = default_args;
            args.extend(extra_args);

            let openclaw_session = OpenClawWsSession::spawn(
                session_id.clone(),
                agent_type,
                binary_path.unwrap_or(command),
                args,
                working_dir,
                home_dir,
            )
            .await
            .with_context(|| format!("Failed to start OpenClaw WebSocket session"))?;

            Arc::new(SessionKind::OpenClawWs(Arc::new(openclaw_session)))
        } else {
            // Other agents use ACP
            let (command, default_args) = AgentFactory::get_acp_command(agent_type);

            let mut args = default_args;
            args.extend(extra_args);

            let acp_session = AcpStreamingSession::spawn(
                session_id.clone(),
                agent_type,
                binary_path.unwrap_or(command),
                args,
                working_dir,
                home_dir,
            )
            .await
            .with_context(|| format!("Failed to start ACP session for {:?}", agent_type))?;

            Arc::new(SessionKind::Acp(Arc::new(acp_session)))
        };

        // Store session
        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id.clone(), session);

        let protocol_name = if agent_type == AgentType::ClaudeCode {
            "SDK Control Protocol"
        } else if agent_type == AgentType::Codex {
            "Codex (codex-core)"
        } else if agent_type == AgentType::ZeroClaw {
            "ZeroClaw (built-in)"
        } else if agent_type == AgentType::OpenClaw {
            "OpenClaw (WebSocket Gateway)"
        } else {
            "ACP"
        };
        info!("✅ {} session started: {}", protocol_name, session_id);
        Ok(())
    }

    /// Stop an agent session
    ///
    /// This method gracefully shuts down the session by calling shutdown().
    pub async fn stop_session(&self, session_id: &str) -> Result<()> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            debug!("Shutting down session: {}", session_id);

            session
                .shutdown()
                .await
                .map_err(|e| anyhow!("Failed to shutdown session {}: {}", session_id, e))?;

            info!("✅ Session shut down: {}", session_id);
            Ok(())
        } else {
            warn!("Session not found: {}", session_id);
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Force stop an agent session (immediate termination)
    ///
    /// This method immediately removes the session without graceful shutdown.
    /// Use this only when graceful shutdown fails or is not needed.
    pub async fn force_stop_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().await;

        if sessions.remove(session_id).is_some() {
            debug!("Force stopped session: {}", session_id);
            info!("✅ Session force stopped: {}", session_id);
            Ok(())
        } else {
            warn!("Session not found: {}", session_id);
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Send a message to an agent session
    pub async fn send_message(
        &self,
        session_id: &str,
        message: String,
        attachments: Vec<String>,
    ) -> Result<()> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            let turn_id = uuid::Uuid::new_v4().to_string();
            session
                .send_message(message, turn_id.as_str(), attachments)
                .await
                .map_err(|e| anyhow!("Failed to send message: {}", e))
        } else {
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Interrupt current operation in a session
    pub async fn interrupt_session(&self, session_id: &str) -> Result<()> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            session
                .interrupt()
                .await
                .map_err(|e| anyhow!("Failed to interrupt session: {}", e))
        } else {
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Get list of active session IDs
    pub async fn list_sessions(&self) -> Vec<String> {
        let sessions = self.sessions.read().await;
        sessions.keys().cloned().collect()
    }

    /// Check if a session exists
    pub async fn has_session(&self, session_id: &str) -> bool {
        let sessions = self.sessions.read().await;
        sessions.contains_key(session_id)
    }

    /// Get agent type for a session
    pub async fn get_session_agent_type(&self, session_id: &str) -> Option<AgentType> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).map(|s| s.agent_type())
    }

    /// Subscribe to events from a session
    pub async fn subscribe(
        &self,
        session_id: &str,
    ) -> Option<tokio::sync::broadcast::Receiver<AgentTurnEvent>> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).map(|s| s.subscribe())
    }

    /// Get a session reference
    pub async fn get_session(&self, session_id: &str) -> Option<Arc<SessionKind>> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).cloned()
    }

    /// Get pending permissions for a session
    ///
    /// This method retrieves all pending permission requests for the specified session.
    /// These are permissions that the agent has requested but that haven't been approved or denied yet.
    ///
    /// # Arguments
    /// * `session_id` - The session ID to get permissions for
    ///
    /// # Returns
    /// List of pending permissions, or an error if the session doesn't exist
    pub async fn get_pending_permissions(
        &self,
        session_id: &str,
    ) -> Result<Vec<PendingPermission>> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            session
                .get_pending_permissions()
                .await
                .map_err(|e| anyhow!("Failed to get pending permissions: {}", e))
        } else {
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Respond to a permission request
    ///
    /// This method allows you to approve or deny a pending permission request.
    ///
    /// # Arguments
    /// * `session_id` - The session ID
    /// * `request_id` - The ID of the permission request
    /// * `approved` - Whether to approve the request
    /// * `reason` - Optional reason for the decision
    ///
    /// # Returns
    /// Ok(()) if successful, or an error otherwise
    pub async fn respond_to_permission(
        &self,
        session_id: &str,
        request_id: String,
        approved: bool,
        reason: Option<String>,
    ) -> Result<()> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            session
                .respond_to_permission(request_id, approved, reason)
                .await
                .map_err(|e| anyhow!("Failed to respond to permission: {}", e))
        } else {
            Err(anyhow!("Session not found: {}", session_id))
        }
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
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
    async fn test_agent_manager_default() {
        let manager = AgentManager::default();
        assert_eq!(manager.list_sessions().await.len(), 0);
    }
}
