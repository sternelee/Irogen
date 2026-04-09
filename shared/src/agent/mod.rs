//! Agent management module
//!
//! This module provides unified agent session management.
//! All external agents are treated as ACP-compatible processes (Zed-style external agents).

pub mod acp;
pub mod acp_errors;
pub mod acp_permission;
pub mod events;
pub mod factory;
pub mod message_adapter;
pub mod openclaw_ws;
pub mod permission_handler;
pub mod slash_commands;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::acp::get_extended_path;
use crate::message_protocol::{AgentHistoryEntry, AgentSessionMetadata, AgentType};
use anyhow::{Context, Result, anyhow};
use tokio::sync::RwLock;
use tokio::task;
use tracing::{debug, info, warn};

pub use acp::{
    AcpSessionStartMode, AcpStreamingSession, SessionOptions, load_codex_session_history,
    load_opencode_session_history,
};
pub use acp_errors::{AcpSessionError, AcpStartupError, AcpTerminalError};
pub use acp_permission::{AcpPermissionHandler, AcpPermissionState};
pub use events::{AgentEvent, AgentTurnEvent, PendingPermission, PermissionResponse};
pub use factory::{Agent, AgentAvailability, AgentFactory};
pub use message_adapter::event_to_message_content;
pub use openclaw_ws::OpenClawWsSession;
pub use permission_handler::{
    ApprovalDecision, AutoApprovalDecision, CompletedPermissionEntry, PendingPermissionEntry,
    PermissionHandler, PermissionHandlerState, PermissionMode, PermissionStatus,
};
pub use slash_commands::{parse_slash_command, process_builtin_command, BuiltinCommandResult};

/// Session kind enum for unified agent management.
///
/// This enum wraps ACP-based external agents and OpenClaw gateway sessions.
#[derive(Clone)]
pub enum SessionKind {
    /// ACP-based session (Claude Agent, Codex CLI, Gemini CLI, OpenCode, etc.)
    Acp(Arc<AcpStreamingSession>),
    /// OpenClaw Gateway WebSocket session
    OpenClawWs(Arc<OpenClawWsSession>),
}

impl SessionKind {
    /// Get session ID.
    pub fn session_id(&self) -> &str {
        match self {
            SessionKind::Acp(s) => s.session_id(),
            SessionKind::OpenClawWs(s) => s.session_id(),
        }
    }

    /// Get agent type.
    pub fn agent_type(&self) -> AgentType {
        match self {
            SessionKind::Acp(s) => s.agent_type(),
            SessionKind::OpenClawWs(s) => s.agent_type(),
        }
    }

    /// Subscribe to agent events.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AgentTurnEvent> {
        match self {
            SessionKind::Acp(s) => s.subscribe(),
            SessionKind::OpenClawWs(s) => s.subscribe(),
        }
    }

    /// Drain buffered events captured before subscribers were ready.
    pub async fn drain_event_buffer(&self) -> Vec<AgentTurnEvent> {
        match self {
            SessionKind::Acp(s) => s.drain_event_buffer().await,
            SessionKind::OpenClawWs(_) => Vec::new(),
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
            SessionKind::OpenClawWs(s) => s.send_message(text, turn_id, attachments).await,
        }
    }

    /// Interrupt current operation.
    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => s.interrupt().await,
            SessionKind::OpenClawWs(s) => s.interrupt().await,
        }
    }

    /// Get pending permission requests.
    pub async fn get_pending_permissions(
        &self,
    ) -> std::result::Result<Vec<PendingPermission>, String> {
        match self {
            SessionKind::Acp(s) => s.get_pending_permissions().await,
            SessionKind::OpenClawWs(s) => s.get_pending_permissions().await,
        }
    }

    /// Respond to a permission request.
    pub async fn respond_to_permission(
        &self,
        request_id: String,
        approved: bool,
        approve_for_session: bool,
        reason: Option<String>,
    ) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => {
                s.respond_to_permission(request_id, approved, approve_for_session, reason)
                    .await
            }
            SessionKind::OpenClawWs(s) => {
                s.respond_to_permission(request_id, approved, approve_for_session, reason)
                    .await
            }
        }
    }

    /// Set permission mode for this session.
    pub async fn set_permission_mode(
        &self,
        mode: PermissionMode,
    ) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => {
                s.set_permission_mode(mode).await;
                Ok(())
            }
            SessionKind::OpenClawWs(s) => s.set_permission_mode(mode).await,
        }
    }

    /// Get permission mode for this session.
    pub async fn get_permission_mode(&self) -> std::result::Result<PermissionMode, String> {
        match self {
            SessionKind::Acp(s) => Ok(s.get_permission_mode().await),
            SessionKind::OpenClawWs(s) => Ok(s.get_permission_mode().await),
        }
    }

    /// Gracefully shut down the session.
    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        match self {
            SessionKind::Acp(s) => s.shutdown().await,
            SessionKind::OpenClawWs(s) => s.shutdown().await,
        }
    }
}

/// Agent manager for managing multiple agent sessions
///
/// The AgentManager is responsible for creating and managing agent sessions.
/// External agents are launched as ACP-compatible processes (Zed-style external agents).
#[derive(Clone)]
pub struct AgentManager {
    /// Active sessions by session ID
    sessions: Arc<RwLock<HashMap<String, Arc<SessionKind>>>>,
    /// Session metadata by session ID
    session_metadata: Arc<RwLock<HashMap<String, AgentSessionMetadata>>>,
}

impl AgentManager {
    /// Create a new agent manager
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            session_metadata: Arc::new(RwLock::new(HashMap::new())),
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
    #[allow(clippy::too_many_arguments)]
    pub async fn start_session(
        &self,
        agent_type: AgentType,
        binary_path: Option<String>,
        extra_args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        mcp_servers: Option<serde_json::Value>,
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
            mcp_servers,
            _source,
        )
        .await?;
        Ok(session_id)
    }

    /// Start an agent session with specific session ID
    ///
    /// For all external agents, this creates an ACP-based session.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_session_with_id(
        &self,
        session_id: String,
        agent_type: AgentType,
        binary_path: Option<String>,
        extra_args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        mcp_servers: Option<serde_json::Value>,
        _source: String,
    ) -> Result<()> {
        info!("Starting {:?} session with ID: {}", agent_type, session_id);

        // Perform availability check before starting to provide better error messages
        let launch_config = AgentFactory::get_acp_launch(agent_type);

        if binary_path.is_none() {
            match AgentFactory::check_available_with_config(agent_type) {
                Ok(availability) => {
                    if !availability.available {
                        let mut error_msg = format!(
                            "Agent {:?} is not available. Please ensure '{}' is installed and in your PATH.",
                            agent_type, availability.executable
                        );

                        // Provide specific instructions for common agents
                        match agent_type {
                            AgentType::ClaudeCode => {
                                let installed = task::spawn_blocking(|| try_install_claude_acp())
                                    .await
                                    .unwrap_or_else(|_| Ok(false))?;

                                if installed {
                                    match AgentFactory::check_available_with_config(agent_type) {
                                        Ok(recheck) if recheck.available => {
                                            info!(
                                                "✅ Claude Agent ACP adapter installed successfully."
                                            );
                                        }
                                        _ => {
                                            error_msg += " Auto-install attempted but still not available. Please ensure claude-agent-acp is on PATH or pass an explicit --binary-path.";
                                            return Err(anyhow!(error_msg));
                                        }
                                    }
                                } else {
                                    error_msg += " Auto-install failed. Install @agentclientprotocol/claude-agent-acp or pass an explicit --binary-path.";
                                    return Err(anyhow!(error_msg));
                                }
                            }
                            AgentType::Codex => {
                                let installed = task::spawn_blocking(|| try_install_codex_acp())
                                    .await
                                    .unwrap_or_else(|_| Ok(false))?;

                                if installed {
                                    match AgentFactory::check_available_with_config(agent_type) {
                                        Ok(recheck) if recheck.available => {
                                            info!("✅ Codex ACP adapter installed successfully.");
                                        }
                                        _ => {
                                            error_msg += " Auto-install attempted but still not available. Please ensure codex-acp is on PATH or pass an explicit --binary-path.";
                                            return Err(anyhow!(error_msg));
                                        }
                                    }
                                } else {
                                    error_msg += " Auto-install failed. Install @zed-industries/codex-acp or pass an explicit --binary-path.";
                                    return Err(anyhow!(error_msg));
                                }
                            }
                            AgentType::Cursor => {
                                error_msg += " Install Cursor CLI so 'cursor-agent acp' is available, or pass an explicit --binary-path.";
                                return Err(anyhow!(error_msg));
                            }
                            AgentType::Gemini => {
                                let installed = task::spawn_blocking(|| try_install_gemini_cli())
                                    .await
                                    .unwrap_or_else(|_| Ok(false))?;

                                if installed {
                                    match AgentFactory::check_available_with_config(agent_type) {
                                        Ok(recheck) if recheck.available => {
                                            info!("✅ Gemini CLI installed successfully.");
                                        }
                                        _ => {
                                            error_msg += " Auto-install attempted but still not available. Please ensure gemini is on PATH or pass an explicit --binary-path.";
                                            return Err(anyhow!(error_msg));
                                        }
                                    }
                                } else {
                                    error_msg += " Auto-install failed. Install @google/gemini-cli or pass an explicit --binary-path.";
                                    return Err(anyhow!(error_msg));
                                }
                            }
                            AgentType::OpenCode => {
                                let installed = task::spawn_blocking(|| try_install_opencode())
                                    .await
                                    .unwrap_or_else(|_| Ok(false))?;

                                if installed {
                                    match AgentFactory::check_available_with_config(agent_type) {
                                        Ok(recheck) if recheck.available => {
                                            info!("✅ OpenCode installed successfully.");
                                        }
                                        _ => {
                                            error_msg += " Auto-install attempted but still not available. Please ensure opencode is on PATH or pass an explicit --binary-path.";
                                            return Err(anyhow!(error_msg));
                                        }
                                    }
                                } else {
                                    error_msg += " Auto-install failed. Install opencode-ai or pass an explicit --binary-path.";
                                    return Err(anyhow!(error_msg));
                                }
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

                    let installed = match agent_type {
                        AgentType::ClaudeCode => task::spawn_blocking(|| try_install_claude_acp())
                            .await
                            .unwrap_or_else(|_| Ok(false))?,
                        AgentType::Codex => task::spawn_blocking(|| try_install_codex_acp())
                            .await
                            .unwrap_or_else(|_| Ok(false))?,
                        AgentType::Cursor => false,
                        AgentType::Gemini => task::spawn_blocking(|| try_install_gemini_cli())
                            .await
                            .unwrap_or_else(|_| Ok(false))?,
                        AgentType::OpenCode => task::spawn_blocking(|| try_install_opencode())
                            .await
                            .unwrap_or_else(|_| Ok(false))?,
                        _ => false,
                    };

                    if installed {
                        match AgentFactory::check_available_with_config(agent_type) {
                            Ok(recheck) if recheck.available => {
                                info!("✅ Agent auto-install succeeded for {:?}", agent_type);
                            }
                            _ => {
                                return Err(anyhow!(
                                    "Agent auto-install attempted but still not available. Please ensure it is on PATH or pass an explicit --binary-path."
                                ));
                            }
                        }
                    } else if matches!(
                        agent_type,
                        AgentType::ClaudeCode
                            | AgentType::Codex
                            | AgentType::Cursor
                            | AgentType::Gemini
                            | AgentType::OpenCode
                    ) {
                        return Err(anyhow!(
                            "Agent auto-install failed. Install the agent CLI or pass an explicit --binary-path."
                        ));
                    }
                }
            }
        }

        let session: Arc<SessionKind> = if agent_type == AgentType::OpenClaw {
            // OpenClaw uses WebSocket Gateway mode
            let command = binary_path.unwrap_or(launch_config.command);
            let mut args = launch_config.args;
            args.extend(extra_args);

            let openclaw_session = OpenClawWsSession::spawn(
                session_id.clone(),
                agent_type,
                command,
                args,
                working_dir.clone(),
                home_dir,
            )
            .await
            .with_context(|| format!("Failed to start OpenClaw WebSocket session"))?;

            Arc::new(SessionKind::OpenClawWs(Arc::new(openclaw_session)))
        } else {
            // All other agents use ACP (external agent model)
            let command = binary_path.unwrap_or(launch_config.command);
            let mut args = launch_config.args;
            args.extend(extra_args);

            let acp_session = AcpStreamingSession::spawn(
                session_id.clone(),
                agent_type,
                command,
                args,
                launch_config.env,
                working_dir.clone(),
                home_dir,
                mcp_servers,
            )
            .await
            .with_context(|| format!("Failed to start ACP session for {:?}", agent_type))?;

            Arc::new(SessionKind::Acp(Arc::new(acp_session)))
        };

        // Store session
        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id.clone(), session);

        // Store session metadata
        let project_path_str = working_dir.to_string_lossy().to_string();
        let hostname = gethostname::gethostname().to_string_lossy().to_string();
        let machine_id = gethostname::gethostname().to_string_lossy().to_string();

        let metadata = AgentSessionMetadata {
            session_id: session_id.clone(),
            agent_type,
            project_path: project_path_str.clone(),
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            active: true,
            controlled_by_remote: false,
            hostname: hostname.clone(),
            os: std::env::consts::OS.to_string(),
            agent_version: None,
            current_dir: project_path_str,
            git_branch: None,
            machine_id,
        };

        drop(sessions); // Release lock before acquiring metadata lock
        let mut metadata_map = self.session_metadata.write().await;
        metadata_map.insert(session_id.clone(), metadata);

        let protocol_name = if agent_type == AgentType::OpenClaw {
            "OpenClaw (WebSocket Gateway)"
        } else {
            "ACP (External Agent)"
        };
        info!("✅ {} session started: {}", protocol_name, session_id);
        Ok(())
    }

    /// Start an agent session from a history entry (ACP load/resume)
    pub async fn start_session_from_history(
        &self,
        agent_type: AgentType,
        history_session_id: String,
        binary_path: Option<String>,
        extra_args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        _source: String,
        resume: bool,
    ) -> Result<String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        self.start_session_from_history_with_id(
            session_id.clone(),
            agent_type,
            history_session_id,
            binary_path,
            extra_args,
            working_dir,
            home_dir,
            _source,
            resume,
        )
        .await?;
        Ok(session_id)
    }

    /// Start an agent session from a history entry with a specific session ID (ACP load/resume)
    pub async fn start_session_from_history_with_id(
        &self,
        session_id: String,
        agent_type: AgentType,
        history_session_id: String,
        binary_path: Option<String>,
        extra_args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        _source: String,
        resume: bool,
    ) -> Result<()> {
        info!(
            "Starting {:?} history session with ID: {} (history={})",
            agent_type, session_id, history_session_id
        );

        let launch_config = AgentFactory::get_acp_launch(agent_type);

        if binary_path.is_none() {
            match AgentFactory::check_available_with_config(agent_type) {
                Ok(availability) => {
                    if !availability.available {
                        let mut error_msg = format!(
                            "Agent {:?} is not available. Please ensure '{}' is installed and in your PATH.",
                            agent_type, availability.executable
                        );
                        match agent_type {
                            AgentType::ClaudeCode => {
                                error_msg += " Install a Claude Agent ACP adapter (e.g. claude-agent-acp) or pass an explicit --binary-path.";
                            }
                            AgentType::Codex => {
                                error_msg += " Install a Codex ACP adapter (e.g. codex-acp) or pass an explicit --binary-path.";
                            }
                            AgentType::Cursor => {
                                error_msg += " Install Cursor CLI so 'cursor-agent acp' is available, or pass an explicit --binary-path.";
                            }
                            AgentType::Gemini => {
                                error_msg += " Install the Gemini CLI (e.g. npm install -g @google/gemini-cli) or pass an explicit --binary-path.";
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

        if agent_type == AgentType::OpenClaw {
            return Err(anyhow!("OpenClaw does not support history load"));
        }

        let command = binary_path.unwrap_or(launch_config.command);
        let mut args = launch_config.args;
        args.extend(extra_args);

        let start_mode = if resume {
            AcpSessionStartMode::Resume {
                session_id: history_session_id,
            }
        } else {
            AcpSessionStartMode::Load {
                session_id: history_session_id,
            }
        };

        let mut sessions = self.sessions.write().await;
        if let Some(existing) = sessions.remove(&session_id) {
            drop(sessions);
            existing.shutdown().await.ok();
            sessions = self.sessions.write().await;
        }
        drop(sessions);

        let acp_session = AcpStreamingSession::spawn_with_start_mode(
            session_id.clone(),
            agent_type,
            command,
            args,
            launch_config.env,
            working_dir.clone(),
            home_dir,
            None,
            start_mode,
            acp::RetryConfig::default(),
        )
        .await
        .with_context(|| format!("Failed to load ACP history session for {:?}", agent_type))?;

        // Store session
        let mut sessions = self.sessions.write().await;
        sessions.insert(
            session_id.clone(),
            Arc::new(SessionKind::Acp(Arc::new(acp_session))),
        );

        let project_path_str = working_dir.to_string_lossy().to_string();
        let hostname = gethostname::gethostname().to_string_lossy().to_string();
        let machine_id = gethostname::gethostname().to_string_lossy().to_string();

        let metadata = AgentSessionMetadata {
            session_id: session_id.clone(),
            agent_type,
            project_path: project_path_str.clone(),
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            active: true,
            controlled_by_remote: false,
            hostname: hostname.clone(),
            os: std::env::consts::OS.to_string(),
            agent_version: None,
            current_dir: project_path_str,
            git_branch: None,
            machine_id,
        };

        drop(sessions);
        let mut metadata_map = self.session_metadata.write().await;
        metadata_map.insert(session_id.clone(), metadata);

        info!("✅ ACP history session started: {}", session_id);
        Ok(())
    }

    pub async fn list_agent_history(
        &self,
        agent_type: AgentType,
        working_dir: PathBuf,
        home_dir: Option<String>,
    ) -> Result<Vec<AgentHistoryEntry>> {
        if agent_type == AgentType::OpenClaw {
            return Ok(Vec::new());
        }
        let launch_config = AgentFactory::get_acp_launch(agent_type);
        acp::list_agent_history(
            agent_type,
            launch_config.command,
            launch_config.args,
            launch_config.env,
            working_dir,
            home_dir,
        )
        .await
    }

    /// Stop an agent session
    ///
    /// This method gracefully shuts down the session and removes metadata.
    pub async fn stop_session(&self, session_id: &str) -> Result<()> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            debug!("Shutting down session: {}", session_id);

            session
                .shutdown()
                .await
                .map_err(|e| anyhow!("Failed to shutdown session {}: {}", session_id, e))?;

            // Remove metadata
            drop(sessions);
            let mut metadata_map = self.session_metadata.write().await;
            metadata_map.remove(session_id);

            info!("✅ Session shut down: {}", session_id);
            Ok(())
        } else {
            warn!("Session not found: {}", session_id);
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Force stop an agent session (immediate termination)
    ///
    /// This method immediately removes the session and metadata without graceful shutdown.
    /// Use this only when graceful shutdown fails or is not needed.
    pub async fn force_stop_session(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.write().await;

        if sessions.remove(session_id).is_some() {
            debug!("Force stopped session: {}", session_id);

            // Remove metadata
            drop(sessions);
            let mut metadata_map = self.session_metadata.write().await;
            metadata_map.remove(session_id);

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

    /// Get session metadata
    pub async fn get_session_metadata(&self, session_id: &str) -> Option<AgentSessionMetadata> {
        let metadata_map = self.session_metadata.read().await;
        metadata_map.get(session_id).cloned()
    }

    /// Get all session metadata
    pub async fn get_all_session_metadata(&self) -> Vec<AgentSessionMetadata> {
        let metadata_map = self.session_metadata.read().await;
        metadata_map.values().cloned().collect()
    }

    /// Subscribe to events from a session
    pub async fn subscribe(
        &self,
        session_id: &str,
    ) -> Option<tokio::sync::broadcast::Receiver<AgentTurnEvent>> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).map(|s| s.subscribe())
    }

    /// Drain buffered events for a session.
    pub async fn drain_event_buffer(&self, session_id: &str) -> Vec<AgentTurnEvent> {
        let sessions = self.sessions.read().await;
        match sessions.get(session_id) {
            Some(session) => session.drain_event_buffer().await,
            None => Vec::new(),
        }
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
        approve_for_session: bool,
        reason: Option<String>,
    ) -> Result<()> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            session
                .respond_to_permission(request_id, approved, approve_for_session, reason)
                .await
                .map_err(|e| anyhow!("Failed to respond to permission: {}", e))
        } else {
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Set permission mode for a session
    pub async fn set_permission_mode(&self, session_id: &str, mode: PermissionMode) -> Result<()> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            session
                .set_permission_mode(mode)
                .await
                .map_err(|e| anyhow!("Failed to set permission mode: {}", e))
        } else {
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Get permission mode for a session
    pub async fn get_permission_mode(&self, session_id: &str) -> Result<PermissionMode> {
        let sessions = self.sessions.read().await;

        if let Some(session) = sessions.get(session_id) {
            session
                .get_permission_mode()
                .await
                .map_err(|e| anyhow!("Failed to get permission mode: {}", e))
        } else {
            Err(anyhow!("Session not found: {}", session_id))
        }
    }

    /// Handle an incoming permission response from the app
    ///
    /// This is called when the app sends back a permission response.
    /// We iterate through all ACP sessions and find the one that has a pending
    /// permission request with the given request_id, then forward the response.
    pub async fn handle_permission_response(
        &self,
        request_id: &str,
        approved: bool,
        reason: Option<String>,
    ) -> Result<()> {
        let sessions = self.sessions.read().await;

        for (session_id, session) in sessions.iter() {
            // Try to respond to permission on this session
            // The correct session will handle it, others will log a warning and do nothing
            match session
                .respond_to_permission(
                    request_id.to_string(),
                    approved,
                    false, // approve_for_session
                    reason.clone(),
                )
                .await
            {
                Ok(()) => {
                    info!(
                        "Successfully routed permission response to session {}",
                        session_id
                    );
                    return Ok(());
                }
                Err(e) => {
                    // This session didn't have this request_id, try next one
                    debug!(
                        "Session {} doesn't have pending permission {}: {}",
                        session_id, request_id, e
                    );
                }
            }
        }

        warn!(
            "No session found with pending permission request_id: {}",
            request_id
        );
        Err(anyhow!(
            "No session found with pending permission request_id: {}",
            request_id
        ))
    }
}

fn command_exists(command: &str) -> bool {
    std::process::Command::new(command)
        .arg("--version")
        .env("PATH", get_extended_path())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn try_install_claude_acp() -> Result<bool> {
    try_install_package("@agentclientprotocol/claude-agent-acp", "Claude Agent ACP")
}

fn try_install_codex_acp() -> Result<bool> {
    try_install_package("@zed-industries/codex-acp", "Codex ACP")
}

fn try_install_gemini_cli() -> Result<bool> {
    try_install_package("@google/gemini-cli", "Gemini CLI")
}

fn try_install_opencode() -> Result<bool> {
    try_install_package("opencode-ai", "OpenCode")
}

pub fn try_install_package(package: &str, label: &str) -> Result<bool> {
    let installers: [(&str, &[&str]); 4] = [
        ("pnpm", &["add", "-g", package]),
        ("npm", &["install", "-g", package]),
        ("bun", &["add", "-g", package]),
        ("yarn", &["global", "add", package]),
    ];

    for (tool, args) in installers {
        if !command_exists(tool) {
            continue;
        }
        info!("Attempting to install {} via {}...", label, tool);
        let output = std::process::Command::new(tool)
            .args(args)
            .env("PATH", get_extended_path())
            .output(); // Use .output() to wait for completion and capture stdout/stderr

        match output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                if output.status.success() {
                    info!("{} installed successfully via {}", label, tool);
                    if !stdout.is_empty() {
                        debug!("Installation stdout: {}", stdout);
                    }
                    return Ok(true);
                } else {
                    warn!(
                        "Installer {} failed with status: {}. stderr: {}",
                        tool, output.status, stderr
                    );
                }
            }
            Err(err) => {
                warn!("Installer {} failed to start: {}", tool, err);
            }
        }
    }

    Ok(false)
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
