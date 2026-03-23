//! ACP-based streaming session implementation.
//!
//! This module hosts ACP client connections to external agent processes
//! and adapts ACP updates into ClawdChat AgentEvent messages.
//!
//! # ACP Protocol Overview
//!
//! The Agent Client Protocol (ACP) is a JSON-RPC 2.0 based protocol for
//! bidirectional communication between code editors and AI coding assistants.
//!
//! ## Key Features
//!
//! - **Bidirectional JSON-RPC 2.0**: Both frontend and backend can initiate commands
//! - **Stdio-based communication**: Uses stdin/stdout for JSON-RPC message streaming
//! - **Tool execution**: Agents can request to run tools (file operations, terminal commands, etc.)
//! - **Permission system**: Fine-grained permission requests with user approval workflow
//! - **Event streaming**: Real-time updates via session notifications
//!
//! # Usage Example
//!
//! ```no_run
//! use crate::agent::{AgentManager, AgentType};
//!
//! # async fn example() -> anyhow::Result<()> {
//! let mut manager = AgentManager::new();
//!
//! // Start an ACP-based agent session
//! let session_id = manager.start_session_with_id(
//!     AgentType::Claude,
//!     "claude".to_string(),
//!     vec!["--stdio".to_string()],
//!     "/workspace".into(),
//!     None,
//!     "local".to_string(),
//! ).await?;
//!
//! // Subscribe to agent events
//! let mut events = manager.subscribe(&session_id)?;
//!
//! // Send a message to the agent
//! manager.send_message(&session_id, "Help me refactor this code".to_string()).await?;
//!
//! // Process events as they arrive
//! while let Ok(event) = events.recv().await {
//!     println!("Agent event: {:?}", event);
//! }
//! # Ok(())
//! # }
//! ```
//!
//! # Architecture
//!
//! The ACP implementation consists of several key components:
//!
//! - **AcpStreamingSession**: Main session type implementing `StreamingAgentSession`
//! - **AcpCommand**: Command enum for session control (Prompt, Cancel, Shutdown)
//! - **AcpClientHandler**: Implements the `acp::Client` trait for ACP callbacks
//! - **run_acp_runtime**: Runtime task managing the ACP connection and command loop
//!
//! # Error Handling
//!
//! The implementation uses structured error handling with automatic retry for transient
//! failures. All errors are logged with session context for debugging.

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use crate::message_protocol::AgentType;
use agent_client_protocol as acp;
use agent_client_protocol::Agent;
use anyhow::{Context, Result, anyhow};
use base64::Engine;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use tokio::io::AsyncBufReadExt;
use tokio::io::BufReader;
use tokio::process::Command as TokioCommand;
use tokio::sync::{Mutex, RwLock, broadcast, mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::events::{AgentEvent, AgentTurnEvent, PendingPermission};
use super::permission_handler::{ApprovalDecision, PermissionHandler, PermissionMode};
use crate::message_protocol::AgentHistoryEntry;

/// Session options for agent-specific configuration
#[derive(Debug, Clone, Default)]
pub struct SessionOptions {
    /// Model identifier to use (agent-specific)
    pub model: Option<String>,
    /// List of allowed tools for this session
    pub allowed_tools: Option<Vec<String>>,
    /// Maximum number of turns in the session
    pub max_turns: Option<u32>,
    /// Agent-specific options passed via _meta
    pub agent_specific: Option<serde_json::Map<String, serde_json::Value>>,
}

impl SessionOptions {
    /// Create new session options
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the model
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    /// Set the allowed tools
    pub fn with_allowed_tools(mut self, tools: Vec<String>) -> Self {
        self.allowed_tools = Some(tools);
        self
    }

    /// Set the maximum turns
    pub fn with_max_turns(mut self, max_turns: u32) -> Self {
        self.max_turns = Some(max_turns);
        self
    }

    /// Add an agent-specific option
    pub fn with_agent_option(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.agent_specific
            .get_or_insert_with(serde_json::Map::new)
            .insert(key.into(), value);
        self
    }

    /// Convert to _meta JSON map for ACP protocol
    pub fn to_meta(&self) -> Option<serde_json::Map<String, serde_json::Value>> {
        if self.model.is_none()
            && self.allowed_tools.is_none()
            && self.max_turns.is_none()
            && self.agent_specific.is_none()
        {
            return None;
        }

        let mut meta = serde_json::Map::new();

        if let Some(ref model) = self.model {
            meta.insert("model".to_string(), serde_json::json!(model));
        }

        if let Some(ref tools) = self.allowed_tools {
            meta.insert("allowedTools".to_string(), serde_json::json!(tools));
        }

        if let Some(max_turns) = self.max_turns {
            meta.insert("maxTurns".to_string(), serde_json::json!(max_turns));
        }

        if let Some(ref specific) = self.agent_specific {
            for (key, value) in specific {
                meta.insert(key.clone(), value.clone());
            }
        }

        Some(meta)
    }
}

struct AcpListClient;

#[async_trait::async_trait(?Send)]
impl acp::Client for AcpListClient {
    async fn request_permission(
        &self,
        _args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn write_text_file(
        &self,
        _args: acp::WriteTextFileRequest,
    ) -> acp::Result<acp::WriteTextFileResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn read_text_file(
        &self,
        _args: acp::ReadTextFileRequest,
    ) -> acp::Result<acp::ReadTextFileResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn session_notification(&self, _args: acp::SessionNotification) -> acp::Result<()> {
        Ok(())
    }

    async fn create_terminal(
        &self,
        _args: acp::CreateTerminalRequest,
    ) -> acp::Result<acp::CreateTerminalResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn kill_terminal_command(
        &self,
        _args: acp::KillTerminalCommandRequest,
    ) -> acp::Result<acp::KillTerminalCommandResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn ext_method(&self, _args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn ext_notification(&self, _args: acp::ExtNotification) -> acp::Result<()> {
        Err(acp::Error::method_not_found())
    }

    async fn release_terminal(
        &self,
        _args: acp::ReleaseTerminalRequest,
    ) -> acp::Result<acp::ReleaseTerminalResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn terminal_output(
        &self,
        _args: acp::TerminalOutputRequest,
    ) -> acp::Result<acp::TerminalOutputResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn wait_for_terminal_exit(
        &self,
        _args: acp::WaitForTerminalExitRequest,
    ) -> acp::Result<acp::WaitForTerminalExitResponse> {
        Err(acp::Error::method_not_found())
    }
}

/// Command types for permission management (sent to command loop)
#[derive(Debug)]
pub enum PermissionManagerCommand {
    /// Get all pending permission requests
    GetPendingPermissions {
        response_tx: oneshot::Sender<Vec<PendingPermission>>,
    },
    /// Respond to a permission request
    RespondToPermission {
        request_id: String,
        approved: bool,
        approve_for_session: bool,
        reason: Option<String>,
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
}

/// Error types specific to ACP operations
#[derive(Debug, thiserror::Error)]
pub enum AcpError {
    /// Session initialization failed
    #[error("Failed to initialize ACP session: {0}")]
    InitializationFailed(String),

    /// Command channel closed
    #[error("Command channel closed")]
    CommandChannelClosed,

    /// Runtime startup failed
    #[error("Failed to start ACP runtime: {0}")]
    RuntimeStartupFailed(String),

    /// I/O operation failed
    #[error("I/O error: {0}")]
    IoError(String),

    /// Prompt operation failed
    #[error("Prompt failed: {0}")]
    PromptFailed(String),

    /// Cancel operation failed
    #[error("Cancel failed: {0}")]
    CancelFailed(String),

    /// Agent process exited unexpectedly
    #[error("Agent process exited: {0}")]
    AgentProcessExited(String),

    /// Permission response failed
    #[error("Permission response failed: {0}")]
    PermissionResponseError(String),

    /// Startup error from acp_errors module
    #[error("{0}")]
    StartupError(#[from] super::acp_errors::AcpStartupError),

    /// Session error from acp_errors module
    #[error("{0}")]
    SessionError(#[from] super::acp_errors::AcpSessionError),

    /// Terminal error from acp_errors module
    #[error("{0}")]
    TerminalError(#[from] super::acp_errors::AcpTerminalError),
}

impl From<AcpError> for String {
    fn from(err: AcpError) -> Self {
        err.to_string()
    }
}

/// Configuration for ACP session retry behavior
#[derive(Clone, Debug)]
pub struct RetryConfig {
    /// Maximum number of retry attempts
    pub max_attempts: u32,
    /// Initial backoff duration
    pub initial_backoff: Duration,
    /// Maximum backoff duration
    pub max_backoff: Duration,
    /// Backoff multiplier for exponential backoff
    pub backoff_multiplier: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            initial_backoff: Duration::from_millis(100),
            max_backoff: Duration::from_secs(5),
            backoff_multiplier: 2.0,
        }
    }
}

/// Calculate exponential backoff delay
fn calculate_backoff(attempt: u32, config: &RetryConfig) -> Duration {
    let delay =
        config.initial_backoff.as_millis() as f64 * config.backoff_multiplier.powi(attempt as i32);
    config.max_backoff.min(Duration::from_millis(delay as u64))
}

/// ACP command types with response channels for bidirectional communication
enum AcpCommand {
    /// Send a prompt/message to the agent
    Prompt {
        text: String,
        turn_id: String,
        attachments: Vec<String>,
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Cancel the current operation
    Cancel {
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Shutdown the session
    Shutdown { response_tx: oneshot::Sender<()> },
    /// Query agent capabilities or status
    Query {
        query: String,
        response_tx: oneshot::Sender<std::result::Result<serde_json::Value, String>>,
    },
    /// Permission request from agent - stores the response sender for later resolution
    PermissionRequest {
        request_id: String,
        tool_name: String,
        input: serde_json::Value,
        options: Vec<acp::PermissionOption>,
        response_tx: oneshot::Sender<acp::RequestPermissionOutcome>,
    },
}

#[allow(dead_code)]
pub struct AcpStreamingSession {
    session_id: String,
    agent_type: AgentType,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    event_buffer: Arc<Mutex<VecDeque<AgentTurnEvent>>>,
    command_tx: mpsc::UnboundedSender<AcpCommand>,
    manager_tx: mpsc::UnboundedSender<PermissionManagerCommand>,
    retry_config: RetryConfig,
    permission_handler: Arc<RwLock<PermissionHandler>>,
    pending_tool_names: Arc<RwLock<HashMap<String, String>>>,
    /// Number of session updates observed by the session notification handler
    session_update_count: Arc<AtomicU64>,
    /// Number of session updates that have been fully processed
    processed_update_count: Arc<AtomicU64>,
    /// Whether to suppress new session update notifications during drain
    suppress_session_updates: Arc<AtomicBool>,
}

#[derive(Debug, Clone)]
pub enum AcpSessionStartMode {
    New,
    Load { session_id: String },
    Resume { session_id: String },
}

impl AcpStreamingSession {
    /// Create a new ACP streaming session with default retry configuration
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn(
        session_id: String,
        agent_type: AgentType,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        mcp_servers: Option<serde_json::Value>,
    ) -> Result<Self> {
        Self::spawn_with_options(
            session_id,
            agent_type,
            command,
            args,
            env,
            working_dir,
            home_dir,
            mcp_servers,
            None,
            AcpSessionStartMode::New,
            RetryConfig::default(),
        )
        .await
    }

    /// Create a new ACP streaming session with custom retry configuration and options
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_with_options(
        session_id: String,
        agent_type: AgentType,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        mcp_servers: Option<serde_json::Value>,
        session_options: Option<SessionOptions>,
        start_mode: AcpSessionStartMode,
        retry_config: RetryConfig,
    ) -> Result<Self> {
        let (event_sender, _) = broadcast::channel(1024);
        let event_buffer = Arc::new(Mutex::new(VecDeque::new()));
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let (manager_tx, manager_rx) = mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = oneshot::channel::<std::result::Result<(), String>>();
        let permission_handler = Arc::new(RwLock::new(PermissionHandler::new(
            PermissionMode::AlwaysAsk,
        )));
        let pending_tool_names = Arc::new(RwLock::new(HashMap::<String, String>::new()));

        // Session update draining state
        let session_update_count = Arc::new(AtomicU64::new(0));
        let processed_update_count = Arc::new(AtomicU64::new(0));
        let suppress_session_updates = Arc::new(AtomicBool::new(false));

        let runtime_session_id = session_id.clone();
        let runtime_event_sender = event_sender.clone();
        let runtime_event_buffer = event_buffer.clone();
        let runtime_retry_config = retry_config.clone();
        let runtime_manager_tx = manager_tx.clone();
        let runtime_command_tx = command_tx.clone();
        let runtime_permission_handler = permission_handler.clone();
        let runtime_pending_tool_names = pending_tool_names.clone();
        let runtime_session_update_count = session_update_count.clone();
        let runtime_processed_update_count = processed_update_count.clone();
        let runtime_suppress_session_updates = suppress_session_updates.clone();
        let runtime_session_options = session_options.clone();

        let thread_name = format!("clawdpilot-acp-{}", &session_id[..session_id.len().min(8)]);

        std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(err) => {
                        let _ = ready_tx.send(Err(format!("Failed to build ACP runtime: {err}")));
                        return;
                    }
                };

                let local_set = tokio::task::LocalSet::new();
                runtime.block_on(local_set.run_until(async move {
                    if let Err(err) = run_acp_runtime(AcpRuntimeParams {
                        session_id: runtime_session_id,
                        agent_type,
                        command,
                        args,
                        env,
                        working_dir,
                        home_dir,
                        mcp_servers,
                        start_mode,
                        event_sender: runtime_event_sender,
                        event_buffer: runtime_event_buffer,
                        command_tx: runtime_command_tx,
                        command_rx,
                        manager_tx: runtime_manager_tx,
                        manager_rx,
                        ready_tx,
                        retry_config: runtime_retry_config,
                        permission_handler: runtime_permission_handler,
                        pending_tool_names: runtime_pending_tool_names,
                        session_update_count: runtime_session_update_count,
                        processed_update_count: runtime_processed_update_count,
                        suppress_session_updates: runtime_suppress_session_updates,
                        session_options: runtime_session_options,
                    })
                    .await
                    {
                        error!("ACP runtime exited with error: {err}");
                    }
                }));
            })
            .with_context(|| format!("Failed to spawn ACP thread for session {session_id}"))?;

        match ready_rx.await {
            Ok(Ok(())) => Ok(Self {
                session_id,
                agent_type,
                event_sender,
                event_buffer,
                command_tx,
                manager_tx,
                retry_config,
                permission_handler,
                pending_tool_names,
                session_update_count,
                processed_update_count,
                suppress_session_updates,
            }),
            Ok(Err(err)) => Err(anyhow!(err)),
            Err(_) => Err(anyhow!(
                "ACP startup channel closed before session became ready"
            )),
        }
    }

    /// Create a new ACP streaming session with custom retry configuration
    /// (backward compatible with previous API)
    #[allow(clippy::too_many_arguments)]
    pub async fn spawn_with_start_mode(
        session_id: String,
        agent_type: AgentType,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        mcp_servers: Option<serde_json::Value>,
        start_mode: AcpSessionStartMode,
        retry_config: RetryConfig,
    ) -> Result<Self> {
        Self::spawn_with_options(
            session_id,
            agent_type,
            command,
            args,
            env,
            working_dir,
            home_dir,
            mcp_servers,
            None,
            start_mode,
            retry_config,
        )
        .await
    }

    /// Get session ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Get agent type
    pub fn agent_type(&self) -> AgentType {
        self.agent_type
    }

    /// Subscribe to agent events
    pub fn subscribe(&self) -> broadcast::Receiver<AgentTurnEvent> {
        self.event_sender.subscribe()
    }

    /// Drain buffered events captured before a subscriber was ready.
    pub async fn drain_event_buffer(&self) -> Vec<AgentTurnEvent> {
        let mut buffer = self.event_buffer.lock().await;
        buffer.drain(..).collect()
    }

    /// Set permission mode for this session
    pub async fn set_permission_mode(&self, mode: PermissionMode) {
        let mut handler = self.permission_handler.write().await;
        handler.set_mode(mode);
    }

    /// Get permission mode for this session
    pub async fn get_permission_mode(&self) -> PermissionMode {
        let handler = self.permission_handler.read().await;
        handler.mode()
    }

    /// Query agent capabilities or status
    pub async fn query(&self, query: String) -> std::result::Result<serde_json::Value, String> {
        debug!(
            "ACP query session={} agent={:?} query={}",
            self.session_id, self.agent_type, query
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(AcpCommand::Query { query, response_tx })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx
            .await
            .map_err(|_| "Query response channel closed".to_string())?
    }

    /// Send a message to the agent
    pub async fn send_message(
        &self,
        text: String,
        turn_id: &str,
        attachments: Vec<String>,
    ) -> std::result::Result<(), String> {
        debug!(
            "ACP send_message session={} agent={:?} attachments={:?}",
            self.session_id, self.agent_type, attachments
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(AcpCommand::Prompt {
                text,
                turn_id: turn_id.to_string(),
                attachments,
                response_tx,
            })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx.await.map_err(|_| {
            String::from(AcpError::PromptFailed(
                "Response channel closed".to_string(),
            ))
        })?
    }

    /// Interrupt current operation
    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        debug!(
            "ACP interrupt session={} agent={:?}",
            self.session_id, self.agent_type
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(AcpCommand::Cancel { response_tx })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx.await.map_err(|_| {
            String::from(AcpError::CancelFailed(
                "Response channel closed".to_string(),
            ))
        })?
    }

    /// Get pending permissions
    pub async fn get_pending_permissions(
        &self,
    ) -> std::result::Result<Vec<PendingPermission>, String> {
        debug!(
            "ACP get_pending_permissions for session {}",
            self.session_id
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.manager_tx
            .send(PermissionManagerCommand::GetPendingPermissions { response_tx })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx
            .await
            .map_err(|_| "Get pending permissions response channel closed".to_string())
    }

    /// Respond to a permission request
    pub async fn respond_to_permission(
        &self,
        request_id: String,
        approved: bool,
        approve_for_session: bool,
        reason: Option<String>,
    ) -> std::result::Result<(), String> {
        if approved && approve_for_session {
            if let Some(tool_name) = self.pending_tool_names.write().await.remove(&request_id) {
                let mut handler = self.permission_handler.write().await;
                handler.add_allowed_tool(tool_name);
            }
        } else {
            let _ = self.pending_tool_names.write().await.remove(&request_id);
        }

        debug!(
            "ACP permission response for session {}: request_id={}, approved={}",
            self.session_id, request_id, approved
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.manager_tx
            .send(PermissionManagerCommand::RespondToPermission {
                request_id,
                approved,
                approve_for_session,
                reason,
                response_tx,
            })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx
            .await
            .map_err(|_| "Permission response channel closed".to_string())?
    }

    /// Gracefully shut down the ACP session
    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        debug!("ACP shutdown for session {}", self.session_id);
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(AcpCommand::Shutdown { response_tx })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx
            .await
            .map_err(|_| "Shutdown response channel closed".to_string())?;

        Ok(())
    }

    /// Wait for all pending session updates to be processed
    ///
    /// This is called after `load_session` to ensure all replay messages are
    /// fully processed before the session is considered ready.
    pub async fn wait_for_session_update_drain(&self) -> std::result::Result<(), String> {
        let start = std::time::Instant::now();
        let timeout = Duration::from_millis(REPLAY_DRAIN_TIMEOUT_MS);
        let idle_threshold = Duration::from_millis(REPLAY_IDLE_MS);
        let poll_interval = Duration::from_millis(DRAIN_POLL_INTERVAL_MS);

        let mut last_update_time = std::time::Instant::now();
        let mut last_observed = 0u64;

        debug!(
            "Waiting for session update drain for session {}",
            self.session_id
        );

        loop {
            let observed = self.session_update_count.load(Ordering::SeqCst);
            let processed = self.processed_update_count.load(Ordering::SeqCst);

            // If observed equals processed, check if we've been idle long enough
            if observed == processed {
                let now = std::time::Instant::now();
                if observed != last_observed {
                    // New updates came in, reset idle timer
                    last_update_time = now;
                    last_observed = observed;
                }

                let idle_duration = now.duration_since(last_update_time);
                if idle_duration >= idle_threshold {
                    debug!(
                        "Session update drain complete for session {} ({} updates)",
                        self.session_id, observed
                    );
                    return Ok(());
                }
            } else {
                // Updates are being processed, reset idle timer
                last_update_time = std::time::Instant::now();
                last_observed = observed;
            }

            if start.elapsed() >= timeout {
                let pending = observed.saturating_sub(processed);
                warn!(
                    "Session update drain timed out for session {} after {:?} ({} pending)",
                    self.session_id,
                    start.elapsed(),
                    pending
                );
                return Err(format!(
                    "Session update drain timed out after {}ms with {} pending updates",
                    REPLAY_DRAIN_TIMEOUT_MS, pending
                ));
            }

            tokio::time::sleep(poll_interval).await;
        }
    }
}

/// Parameters for the ACP runtime task
#[allow(dead_code)]
struct AcpRuntimeParams {
    session_id: String,
    agent_type: AgentType,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    working_dir: PathBuf,
    home_dir: Option<String>,
    mcp_servers: Option<serde_json::Value>,
    start_mode: AcpSessionStartMode,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    event_buffer: Arc<Mutex<VecDeque<AgentTurnEvent>>>,
    command_tx: mpsc::UnboundedSender<AcpCommand>,
    command_rx: mpsc::UnboundedReceiver<AcpCommand>,
    manager_tx: mpsc::UnboundedSender<PermissionManagerCommand>,
    manager_rx: mpsc::UnboundedReceiver<PermissionManagerCommand>,
    ready_tx: oneshot::Sender<std::result::Result<(), String>>,
    retry_config: RetryConfig,
    permission_handler: Arc<RwLock<PermissionHandler>>,
    pending_tool_names: Arc<RwLock<HashMap<String, String>>>,
    /// Number of session updates observed
    session_update_count: Arc<AtomicU64>,
    /// Number of session updates processed
    processed_update_count: Arc<AtomicU64>,
    /// Whether to suppress session updates during drain
    suppress_session_updates: Arc<AtomicBool>,
    /// Session options for agent-specific configuration
    session_options: Option<SessionOptions>,
}

/// Get an extended PATH that includes common binary directories.
/// macOS GUI apps don't inherit the user's shell PATH, so we need to
/// explicitly include directories where tools like `claude`, `gemini`, etc. are installed.
pub(crate) fn get_extended_path() -> String {
    let current_path = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());

    let extra_dirs = [
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/sbin".to_string(),
        "/usr/bin".to_string(),
        "/usr/sbin".to_string(),
        "/bin".to_string(),
        "/sbin".to_string(),
        // npm global installs
        format!("{home}/.npm-global/bin"),
        format!("{home}/.nvm/versions/node/current/bin"),
        // volta
        format!("{home}/.volta/bin"),
    ];

    let mut parts: Vec<&str> = current_path.split(':').collect();
    for dir in &extra_dirs {
        if !parts.contains(&dir.as_str()) {
            parts.push(dir);
        }
    }
    parts.join(":")
}

pub async fn list_agent_history(
    agent_type: AgentType,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    cwd: PathBuf,
    home_dir: Option<String>,
) -> Result<Vec<AgentHistoryEntry>> {
    let home_dir = home_dir.or_else(|| std::env::var("HOME").ok());
    let resolved_command = resolve_command_path(&command);
    let extended_path = get_extended_path();
    info!(
        "[ACP history] list_agent_history agent={:?} command={} args={:?} cwd={:?} home={:?}",
        agent_type, command, args, cwd, home_dir
    );
    info!(
        "[ACP history] resolved command '{}' -> '{}'",
        command, resolved_command
    );
    info!("[ACP history] PATH={}", extended_path);
    let mut cmd = TokioCommand::new(&resolved_command);
    cmd.args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    cmd.env("PATH", &extended_path);
    if let Some(ref home) = home_dir {
        cmd.env("HOME", home);
    }
    for (key, value) in &env {
        cmd.env(key, value);
    }

    let mut child = cmd.spawn().with_context(|| {
        format!(
            "Failed to spawn ACP agent command '{}' for history",
            command
        )
    })?;
    info!("[ACP history] spawned pid={:?}", child.id());

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow::anyhow!("Failed to capture ACP agent stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("Failed to capture ACP agent stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow::anyhow!("Failed to capture ACP agent stderr"))?;

    tokio::spawn(async move {
        let mut stderr_reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            if !line.trim().is_empty() {
                warn!("[ACP history][stderr] {}", line);
            }
        }
    });

    let thread_name = format!("clawdpilot-acp-history-{}", Uuid::new_v4());
    let (result_tx, result_rx) = oneshot::channel();

    std::thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    let _ = result_tx.send(Err(anyhow::anyhow!(
                        "Failed to build history runtime: {err}"
                    )));
                    return;
                }
            };

            let local_set = tokio::task::LocalSet::new();
            runtime.block_on(local_set.run_until(async move {
                info!("[ACP history] initializing connection");
                let (connection, io_task) = acp::ClientSideConnection::new(
                    AcpListClient,
                    stdin.compat_write(),
                    stdout.compat(),
                    |f| {
                        tokio::task::spawn_local(f);
                    },
                );

                tokio::task::spawn_local(async move {
                    if let Err(err) = io_task.await {
                        warn!("ACP history IO task error: {err}");
                    }
                });

                let init_response = tokio::time::timeout(
                    std::time::Duration::from_secs(10),
                    connection.initialize(
                        acp::InitializeRequest::new(acp::ProtocolVersion::LATEST)
                            .client_capabilities(
                                acp::ClientCapabilities::new()
                                    .fs(acp::FileSystemCapability::new()
                                        .read_text_file(true)
                                        .write_text_file(true))
                                    .terminal(true),
                            )
                            .client_info(
                                acp::Implementation::new(
                                    "clawdpilot-cli",
                                    env!("CARGO_PKG_VERSION"),
                                )
                                .title("ClawdChat CLI"),
                            ),
                    ),
                )
                .await;

                let init_response = match init_response {
                    Ok(Ok(resp)) => resp,
                    Ok(Err(err)) => {
                        warn!("[ACP history] initialize failed: {}", err);
                        let _ = result_tx
                            .send(Err(anyhow::anyhow!("ACP history initialize failed: {err}")));
                        return;
                    }
                    Err(_) => {
                        warn!("[ACP history] initialize timed out");
                        let _ = result_tx
                            .send(Err(anyhow::anyhow!("ACP history initialize timed out")));
                        return;
                    }
                };

                info!(
                    "[ACP history] initialize ok, session capabilities: list={:?} resume={:?}",
                    init_response.agent_capabilities.session_capabilities.list,
                    init_response.agent_capabilities.session_capabilities.resume
                );

                if init_response
                    .agent_capabilities
                    .session_capabilities
                    .list
                    .is_none()
                {
                    warn!("[ACP history] list_sessions not supported by agent");
                    let _ = result_tx.send(Ok(Vec::new()));
                    return;
                }

                info!("[ACP history] calling list_sessions");
                let response = tokio::time::timeout(
                    std::time::Duration::from_secs(10),
                    connection.list_sessions(acp::ListSessionsRequest::new().cwd(cwd)),
                )
                .await;

                let response = match response {
                    Ok(Ok(resp)) => resp,
                    Ok(Err(err)) => {
                        warn!("[ACP history] list_sessions failed: {}", err);
                        let _ = result_tx.send(Err(anyhow::anyhow!(
                            "ACP history list_sessions failed: {err}"
                        )));
                        return;
                    }
                    Err(_) => {
                        warn!("[ACP history] list_sessions timed out");
                        let _ = result_tx
                            .send(Err(anyhow::anyhow!("ACP history list_sessions timed out")));
                        return;
                    }
                };

                info!(
                    "[ACP history] list_sessions ok: {} sessions",
                    response.sessions.len()
                );

                let entries = response
                    .sessions
                    .into_iter()
                    .map(|session| AgentHistoryEntry {
                        agent_type,
                        session_id: session.session_id.to_string(),
                        title: session.title,
                        updated_at: session.updated_at,
                        cwd: Some(session.cwd.to_string_lossy().to_string()),
                        meta: session.meta.map(serde_json::Value::Object),
                    })
                    .collect();

                let _ = result_tx.send(Ok(entries));
            }));
        })
        .with_context(|| "Failed to spawn history thread")?;

    let result = tokio::time::timeout(std::time::Duration::from_secs(12), result_rx)
        .await
        .map_err(|_| anyhow::anyhow!("History result timed out"))?
        .map_err(|_| anyhow::anyhow!("History result channel closed"))?;

    let _ = child.kill().await;
    result
}

/// Load Codex session messages from the JSONL file in ~/.codex/sessions/
/// Codex ACP adapter doesn't support resume_session, so we read the session file directly.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexHistoryMessage {
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

pub async fn load_codex_session_history(session_id: &str) -> Result<Vec<CodexHistoryMessage>> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
    let sessions_dir = format!("{}/.codex/sessions", home);

    info!(
        "[Codex history] Searching for session {} in {}",
        session_id, sessions_dir
    );

    // Search for the JSONL file matching the session ID
    let session_dir = std::path::Path::new(&sessions_dir);
    if !session_dir.exists() {
        return Ok(Vec::new());
    }

    // Find the JSONL file containing our session
    let mut matching_file: Option<std::path::PathBuf> = None;
    let entries = std::fs::read_dir(session_dir)
        .map_err(|e| anyhow::anyhow!("Failed to read sessions directory: {}", e))?;

    for year_entry in entries.flatten() {
        let year_path = year_entry.path();
        if !year_path.is_dir() {
            continue;
        }

        let month_entries = std::fs::read_dir(&year_path).ok();
        for month_entry in month_entries.into_iter().flatten().flatten() {
            let day_path = month_entry.path();
            if !day_path.is_dir() {
                continue;
            }

            if let Ok(files) = std::fs::read_dir(&day_path) {
                for file in files.flatten() {
                    let file_name = file.file_name().to_string_lossy().to_string();
                    if file_name.ends_with(".jsonl") && file_name.contains(session_id) {
                        matching_file = Some(file.path());
                        break;
                    }
                }
            }
            if matching_file.is_some() {
                break;
            }
        }
        if matching_file.is_some() {
            break;
        }
    }

    let file_path = match matching_file {
        Some(p) => p,
        None => {
            warn!("[Codex history] Session file not found for {}", session_id);
            return Ok(Vec::new());
        }
    };

    info!("[Codex history] Loading from {:?}", file_path);

    // Read and parse the JSONL file
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| anyhow::anyhow!("Failed to read session file: {}", e))?;

    let mut messages = Vec::new();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        // Parse the JSON line
        let json: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = json.get("payload");

        match entry_type {
            "response_item" => {
                if let Some(p) = payload {
                    let role = p.get("role").and_then(|v| v.as_str()).unwrap_or("");
                    let content = p.get("content").and_then(|v| v.as_array());

                    if let Some(contents) = content {
                        for item in contents {
                            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                                // Create appropriate message based on role
                                let msg = CodexHistoryMessage {
                                    role: if role == "developer" {
                                        "assistant".to_string()
                                    } else {
                                        role.to_string()
                                    },
                                    content: text.to_string(),
                                    timestamp: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs()
                                        as i64,
                                };
                                messages.push(msg);
                            }
                        }
                    }
                }
            }
            _ => {
                // Skip other types for now
            }
        }
    }

    info!(
        "[Codex history] Loaded {} messages from session {}",
        messages.len(),
        session_id
    );
    Ok(messages)
}

/// Load OpenCode session messages using `opencode export` command
pub async fn load_opencode_session_history(session_id: &str) -> Result<Vec<CodexHistoryMessage>> {
    info!(
        "[OpenCode history] Loading session {} via opencode export",
        session_id
    );

    // Use tokio::process::Command to run opencode export
    let output = tokio::process::Command::new("opencode")
        .arg("export")
        .arg(session_id)
        .output()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to run opencode export: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!("opencode export failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse the JSON output - with fallback for large strings that may cause parsing issues
    let json: serde_json::Value = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(e) => {
            // Try to recover by truncating extremely long strings
            warn!(
                "[OpenCode] Full JSON parse failed: {}, attempting recovery",
                e
            );
            let truncated = truncate_large_strings(&stdout, 50000);
            serde_json::from_str(&truncated).map_err(|e2| {
                anyhow::anyhow!(
                    "Failed to parse opencode export output: {} (recovery also failed: {})",
                    e,
                    e2
                )
            })?
        }
    };

    let messages: Vec<CodexHistoryMessage> = json
        .get("messages")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|msg| {
                    let role = msg.get("info")?.get("role")?.as_str()?;
                    let content = msg
                        .get("parts")?
                        .as_array()?
                        .iter()
                        .filter_map(|part| {
                            if part.get("type")?.as_str() == Some("text") {
                                part.get("text")?.as_str().map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n");

                    if content.is_empty() {
                        None
                    } else {
                        Some(CodexHistoryMessage {
                            role: role.to_string(),
                            content,
                            timestamp: msg
                                .get("info")?
                                .get("time")?
                                .get("created")?
                                .as_i64()
                                .unwrap_or(0),
                        })
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    info!(
        "[OpenCode history] Loaded {} messages from session {}",
        messages.len(),
        session_id
    );
    Ok(messages)
}

/// Truncate extremely long strings in JSON to allow parsing to succeed.
/// This handles cases where opencode export produces very large strings that cause parsing failures.
fn truncate_large_strings(input: &str, max_len: usize) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_string = false;
    let mut current_string = String::new();
    let mut escape_next = false;

    for c in input.chars() {
        if escape_next {
            current_string.push(c);
            escape_next = false;
            continue;
        }

        match c {
            '\\' if in_string => {
                escape_next = true;
                current_string.push(c);
            }
            '"' if in_string => {
                // End of string - check if too long
                if current_string.len() > max_len {
                    result.push_str(&format!(
                        "\"{}... [truncated]\"",
                        &current_string[..max_len.min(current_string.len())]
                    ));
                } else {
                    result.push('"');
                    result.push_str(&current_string);
                    result.push('"');
                }
                current_string.clear();
                in_string = false;
            }
            '"' => {
                in_string = true;
            }
            _ => {
                if in_string {
                    current_string.push(c);
                } else {
                    result.push(c);
                }
            }
        }
    }

    // Handle any remaining string
    if in_string && !current_string.is_empty() {
        if current_string.len() > max_len {
            result.push_str(&format!(
                "\"{}... [truncated]\"",
                &current_string[..max_len.min(current_string.len())]
            ));
        } else {
            result.push('"');
            result.push_str(&current_string);
            result.push('"');
        }
    }

    result
}

/// Resolve a command name to its full path by searching common directories.
/// Returns the original command if no full path is found (will rely on PATH).
pub(super) fn resolve_command_path(command: &str) -> String {
    // If already an absolute path, return as-is
    if command.starts_with('/') {
        return command.to_string();
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());

    let search_dirs = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        &format!("{home}/.local/bin"),
        &format!("{home}/.cargo/bin"),
        &format!("{home}/.npm-global/bin"),
        &format!("{home}/.volta/bin"),
        "/usr/bin",
        "/bin",
    ];

    for dir in search_dirs {
        let full_path = format!("{dir}/{command}");
        if std::path::Path::new(&full_path).exists() {
            debug!("Resolved command '{}' to '{}'", command, full_path);
            return full_path;
        }
    }

    // Fallback: try `which` command
    if let Ok(output) = StdCommand::new("which").arg(command).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                debug!("Resolved command '{}' via which to '{}'", command, path);
                return path;
            }
        }
    }

    debug!("Could not resolve full path for '{}', using as-is", command);
    command.to_string()
}

fn parse_mcp_servers(value: Option<serde_json::Value>) -> Vec<acp::McpServer> {
    let Some(value) = value else {
        return Vec::new();
    };

    match serde_json::from_value::<Vec<acp::McpServer>>(value) {
        Ok(servers) => servers,
        Err(err) => {
            warn!("Invalid MCP server config, ignoring: {}", err);
            Vec::new()
        }
    }
}

async fn run_acp_runtime(params: AcpRuntimeParams) -> Result<()> {
    info!(
        "Starting ACP runtime for session {} ({:?}) with command: {} {:?}",
        params.session_id, params.agent_type, params.command, params.args
    );

    // Resolve command to full path (GUI apps on macOS may not have PATH set)
    let resolved_command = resolve_command_path(&params.command);
    info!(
        "Resolved command '{}' -> '{}'",
        params.command, resolved_command
    );

    let mut cmd = TokioCommand::new(&resolved_command);
    cmd.args(&params.args)
        .current_dir(&params.working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Ensure PATH includes common binary directories for GUI app context
    let extended_path = get_extended_path();
    cmd.env("PATH", &extended_path);

    // Set HOME directory if specified
    if let Some(ref home) = params.home_dir {
        cmd.env("HOME", home);
        debug!("Setting HOME environment variable: {}", home);
    }

    for (key, value) in &params.env {
        cmd.env(key, value);
    }

    let mut child = cmd.spawn().with_context(|| {
        format!(
            "Failed to spawn ACP agent command '{}' (resolved: '{}'): {:#?}",
            params.command, resolved_command, params.args
        )
    })?;

    let stdin = child.stdin.take().ok_or_else(|| {
        let _ = child.start_kill();
        anyhow::anyhow!("Failed to capture ACP agent stdin")
    })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        let _ = child.start_kill();
        anyhow::anyhow!("Failed to capture ACP agent stdout")
    })?;

    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.start_kill();
        anyhow::anyhow!("Failed to capture ACP agent stderr")
    })?;

    let active_turn = Arc::new(RwLock::new(None::<String>));
    let tool_name_map = Arc::new(Mutex::new(HashMap::<String, String>::new()));
    let terminals = Arc::new(Mutex::new(HashMap::<acp::TerminalId, TerminalState>::new()));

    let client = AcpClientHandler {
        session_id: params.session_id.clone(),
        agent_type: params.agent_type,
        event_sender: params.event_sender.clone(),
        event_buffer: params.event_buffer.clone(),
        active_turn: active_turn.clone(),
        tool_name_map: tool_name_map.clone(),
        command_tx: params.command_tx.clone(),
        terminals: terminals.clone(),
        permission_handler: params.permission_handler.clone(),
        pending_tool_names: params.pending_tool_names.clone(),
        session_update_count: params.session_update_count.clone(),
        processed_update_count: params.processed_update_count.clone(),
        suppress_session_updates: params.suppress_session_updates.clone(),
    };

    let session_id_for_stderr = params.session_id.clone();
    tokio::task::spawn_local(async move {
        let mut stderr_reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            debug!("[ACP stderr][{}] {}", session_id_for_stderr, line);
            warn!("ACP agent stderr: {}", line);
        }
    });

    let (connection, io_task) =
        acp::ClientSideConnection::new(client, stdin.compat_write(), stdout.compat(), |future| {
            tokio::task::spawn_local(future);
        });

    let session_id_for_io_error = params.session_id.clone();
    let event_sender_for_io_error = params.event_sender.clone();
    tokio::task::spawn_local(async move {
        if let Err(err) = io_task.await {
            error!(
                "[ACP IO Error] Session {}: Connection lost - {}",
                session_id_for_io_error, err
            );
            let _ = event_sender_for_io_error.send(AgentTurnEvent {
                turn_id: Uuid::new_v4().to_string(),
                event: AgentEvent::TurnError {
                    session_id: session_id_for_io_error,
                    error: format!("ACP I/O task exited: {err}"),
                    code: None,
                },
            });
        }
    });

    // Initialize connection with retry logic
    let init_result = with_retry(
        params.retry_config.clone(),
        format!(
            "initialize ACP connection for session {}",
            params.session_id
        ),
        || async {
            connection
                .initialize(
                    acp::InitializeRequest::new(acp::ProtocolVersion::LATEST)
                        .client_capabilities(
                            acp::ClientCapabilities::new()
                                .fs(acp::FileSystemCapability::new()
                                    .read_text_file(true)
                                    .write_text_file(true))
                                .terminal(true),
                        )
                        .client_info(
                            acp::Implementation::new("clawdpilot-cli", env!("CARGO_PKG_VERSION"))
                                .title("ClawdChat CLI"),
                        ),
                )
                .await
        },
    )
    .await;

    let init_response = match init_result {
        Ok(response) => response,
        Err(err) => {
            let mut error_msg = format!("ACP initialize failed: {err}");

            // Check if the agent process exited prematurely
            if let Ok(Some(status)) = child.try_wait() {
                error_msg = format!(
                    "ACP initialize failed: Agent process exited with status {}. Please check if the command '{} {:?}' is installed and correct. Details: {}",
                    status, params.command, params.args, err
                );
            }

            // Kill the child process on initialization failure
            let _ = child.start_kill();
            let _ = child.wait().await;

            let _ = params.ready_tx.send(Err(error_msg.clone()));
            return Err(anyhow::anyhow!(error_msg));
        }
    };

    let supports_load = init_response.agent_capabilities.load_session;
    let supports_resume = init_response
        .agent_capabilities
        .session_capabilities
        .resume
        .is_some();
    let mcp_servers = parse_mcp_servers(params.mcp_servers.clone());

    let acp_session_id = match &params.start_mode {
        AcpSessionStartMode::New => {
            // Build new session request with optional _meta
            let mut request = acp::NewSessionRequest::new(params.working_dir.clone())
                .mcp_servers(mcp_servers.clone());

            // Add _meta if session options are provided
            if let Some(ref options) = params.session_options {
                if let Some(meta) = options.to_meta() {
                    debug!("Adding _meta to new_session request: {:?}", meta);
                    request = request.meta(meta);
                }
            }

            let new_session_result = with_retry(
                params.retry_config.clone(),
                format!("create ACP session for {}", params.session_id),
                || {
                    let connection = &connection;
                    let request = &request;
                    async move { connection.new_session(request.clone()).await }
                },
            )
            .await;

            match new_session_result {
                Ok(resp) => {
                    info!(
                        "ACP session created successfully: {} for session {}",
                        resp.session_id, params.session_id
                    );
                    resp.session_id
                }
                Err(err) => {
                    let error_msg = format!("ACP new_session failed: {err}");
                    // Kill the child process on session creation failure
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    let _ = params.ready_tx.send(Err(error_msg.clone()));
                    return Err(anyhow::anyhow!(error_msg));
                }
            }
        }
        AcpSessionStartMode::Load { session_id } => {
            if !supports_load {
                let error_msg = "Agent does not support load_session".to_string();
                // Kill the child process on failure
                let _ = child.start_kill();
                let _ = child.wait().await;
                let _ = params.ready_tx.send(Err(error_msg.clone()));
                return Err(anyhow::anyhow!(error_msg));
            }

            let load_result = with_retry(
                params.retry_config.clone(),
                format!("load ACP session for {}", params.session_id),
                || async {
                    connection
                        .load_session(acp::LoadSessionRequest::new(
                            session_id.clone(),
                            params.working_dir.clone(),
                        ))
                        .await
                },
            )
            .await;

            match load_result {
                Ok(_resp) => {
                    info!(
                        "ACP session loaded successfully: {} for session {}",
                        session_id, params.session_id
                    );
                    acp::SessionId::new(session_id.clone())
                }
                Err(err) => {
                    let error_msg = format!("ACP load_session failed: {err}");
                    // Kill the child process on failure
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    let _ = params.ready_tx.send(Err(error_msg.clone()));
                    return Err(anyhow::anyhow!(error_msg));
                }
            }
        }
        AcpSessionStartMode::Resume { session_id } => {
            if !supports_resume {
                let error_msg = "Agent does not support resume_session".to_string();
                // Kill the child process on failure
                let _ = child.start_kill();
                let _ = child.wait().await;
                let _ = params.ready_tx.send(Err(error_msg.clone()));
                return Err(anyhow::anyhow!(error_msg));
            }

            let resume_result = with_retry(
                params.retry_config.clone(),
                format!("resume ACP session for {}", params.session_id),
                || async {
                    connection
                        .resume_session(acp::ResumeSessionRequest::new(
                            session_id.clone(),
                            params.working_dir.clone(),
                        ))
                        .await
                },
            )
            .await;

            match resume_result {
                Ok(_resp) => acp::SessionId::new(session_id.clone()),
                Err(err) => {
                    let error_msg = format!("ACP resume_session failed: {err}");
                    // Kill the child process on failure
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    let _ = params.ready_tx.send(Err(error_msg.clone()));
                    return Err(anyhow::anyhow!(error_msg));
                }
            }
        }
    };

    let _ = params.ready_tx.send(Ok(()));

    let _ = params.event_sender.send(AgentTurnEvent {
        turn_id: Uuid::new_v4().to_string(),
        event: AgentEvent::SessionStarted {
            session_id: params.session_id.clone(),
            agent: params.agent_type,
        },
    });

    let connection = Arc::new(tokio::sync::Mutex::new(connection));

    run_command_loop(
        params.session_id.clone(),
        params.working_dir.clone(),
        connection,
        acp_session_id,
        active_turn,
        params.event_sender.clone(),
        params.command_rx,
        params.manager_rx,
        params.retry_config.clone(),
    )
    .await;

    // Cleanup all terminal processes when the session is shut down
    {
        let mut terms = terminals.lock().await;
        for (_, term) in terms.drain() {
            if let Some(pid) = term.pid {
                kill_process_force(pid);
            }
        }
    }

    info!(
        "ACP runtime shutting down for session {}, killing agent process",
        params.session_id
    );
    let _ = child.start_kill();
    let _ = child.wait().await;

    Ok(())
}

/// Execute an async operation with retry logic
async fn with_retry<F, Fut, T>(
    config: RetryConfig,
    operation: String,
    mut op: F,
) -> std::result::Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = acp::Result<T>>,
{
    let mut last_error = String::new();

    for attempt in 0..config.max_attempts {
        if attempt > 0 {
            let delay = calculate_backoff(attempt - 1, &config);
            debug!(
                "Retry attempt {} for '{}' after {:?}",
                attempt + 1,
                operation,
                delay
            );
            tokio::time::sleep(delay).await;
        }

        match op().await {
            Ok(result) => {
                if attempt > 0 {
                    info!(
                        "Operation '{}' succeeded on attempt {}",
                        operation,
                        attempt + 1
                    );
                }
                return Ok(result);
            }
            Err(err) => {
                last_error = format!("{:?}", err);
                warn!(
                    "Operation '{}' failed on attempt {}: {}",
                    operation,
                    attempt + 1,
                    last_error
                );
            }
        }
    }

    error!(
        "Operation '{}' failed after {} attempts",
        operation, config.max_attempts
    );
    Err(format!(
        "Failed after {} attempts: {}",
        config.max_attempts, last_error
    ))
}

fn normalize_path(path: &str, working_dir: &Path) -> Option<PathBuf> {
    if path.trim().is_empty() {
        return None;
    }
    let expanded = if path.starts_with("~/") {
        std::env::var("HOME")
            .ok()
            .map(|home| format!("{}{}", home, &path[1..]))
            .unwrap_or_else(|| path.to_string())
    } else {
        path.to_string()
    };
    let path_buf = PathBuf::from(expanded);
    if path_buf.is_absolute() {
        Some(path_buf)
    } else {
        Some(working_dir.join(path_buf))
    }
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tiff" | "svg"
            )
        })
        .unwrap_or(false)
}

fn guess_mime_type(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "md" => "text/markdown",
        "json" => "application/json",
        "rs" => "text/rust",
        "ts" => "text/typescript",
        "tsx" => "text/tsx",
        "js" => "text/javascript",
        "jsx" => "text/jsx",
        "py" => "text/x-python",
        "toml" => "application/toml",
        "yaml" | "yml" => "application/yaml",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn extract_mention_paths(text: &str, working_dir: &Path) -> Vec<PathBuf> {
    let mut mentions = Vec::new();
    for token in text.split_whitespace() {
        if !token.starts_with('@') || token.len() < 2 {
            continue;
        }
        let raw = token.trim_start_matches('@').trim_matches(|c: char| {
            c == ')' || c == '(' || c == '[' || c == ']' || c == ',' || c == '"' || c == '\''
        });
        if let Some(path) = normalize_path(raw, working_dir) {
            if path.exists() {
                mentions.push(path);
            }
        }
    }
    mentions
}

fn add_resource_block_from_path(blocks: &mut Vec<acp::ContentBlock>, path: &Path) {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    let uri = format!("file://{}", path.display());
    let mime_type = guess_mime_type(path);
    if let Ok(content) = std::fs::read_to_string(path) {
        let text_resource =
            acp::TextResourceContents::new(content, uri.clone()).mime_type(Some(mime_type));
        blocks.push(acp::ContentBlock::Resource(acp::EmbeddedResource::new(
            acp::EmbeddedResourceResource::TextResourceContents(text_resource),
        )));
    } else {
        blocks.push(acp::ContentBlock::ResourceLink(
            acp::ResourceLink::new(name.to_string(), uri).mime_type(Some(mime_type)),
        ));
    }
}

fn add_image_block_from_path(blocks: &mut Vec<acp::ContentBlock>, path: &Path) {
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    let mime_type = guess_mime_type(path);
    let base64_data = base64::engine::general_purpose::STANDARD.encode(bytes);
    let uri = Some(format!("file://{}", path.display()));
    blocks.push(acp::ContentBlock::Image(
        acp::ImageContent::new(base64_data, mime_type).uri(uri),
    ));
}

fn build_prompt_blocks(
    text: String,
    attachments: Vec<String>,
    working_dir: &Path,
) -> Vec<acp::ContentBlock> {
    let mut blocks = vec![acp::ContentBlock::from(text.clone())];

    for mention in extract_mention_paths(&text, working_dir) {
        add_resource_block_from_path(&mut blocks, &mention);
    }

    for attachment in attachments {
        let Some(path) = normalize_path(&attachment, working_dir) else {
            continue;
        };
        if !path.exists() {
            continue;
        }
        if is_image_path(&path) {
            add_image_block_from_path(&mut blocks, &path);
        } else {
            add_resource_block_from_path(&mut blocks, &path);
        }
    }

    blocks
}

#[allow(clippy::too_many_arguments)]
async fn run_command_loop(
    session_id: String,
    working_dir: PathBuf,
    connection: Arc<tokio::sync::Mutex<acp::ClientSideConnection>>,
    acp_session_id: acp::SessionId,
    active_turn: Arc<RwLock<Option<String>>>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    mut command_rx: mpsc::UnboundedReceiver<AcpCommand>,
    mut manager_rx: mpsc::UnboundedReceiver<PermissionManagerCommand>,
    retry_config: RetryConfig,
) {
    // Store pending permissions and their response channels
    #[allow(dead_code)]
    struct PendingPermissionEntry {
        tool_name: String,
        input: serde_json::Value,
        options: Vec<acp::PermissionOption>,
        response_tx: oneshot::Sender<acp::RequestPermissionOutcome>,
        created_at: std::time::Duration,
    }

    let mut pending_permissions: std::collections::HashMap<String, PendingPermissionEntry> =
        std::collections::HashMap::new();

    loop {
        tokio::select! {
            Some(command) = command_rx.recv() => {
                match command {
            AcpCommand::Prompt {
                text,
                turn_id,
                attachments,
                response_tx,
            } => {
                {
                    let mut active = active_turn.write().await;
                    *active = Some(turn_id.clone());
                }

                // Log attachments for now (ACP protocol may handle differently)
                if !attachments.is_empty() {
                    debug!("[ACP][{}] Attachments received: {:?}", session_id, attachments);
                }

                let _ = event_sender.send(AgentTurnEvent {
                    turn_id: turn_id.clone(),
                    event: AgentEvent::TurnStarted {
                        session_id: session_id.clone(),
                        turn_id: turn_id.clone(),
                    },
                });

                let connection = connection.clone();
                let acp_session_id = acp_session_id.clone();
                let text = text.clone();
                let event_sender = event_sender.clone();
                let retry_config = retry_config.clone();
                let session_id = session_id.clone();
                let active_turn = active_turn.clone();
                let working_dir = working_dir.clone();

                tokio::task::spawn_local(async move {
                    let prompt_blocks =
                        build_prompt_blocks(text.clone(), attachments.clone(), &working_dir);
                    let result = with_retry(
                        retry_config,
                        format!("prompt for session {}", session_id),
                        || {
                            let connection = connection.clone();
                            let acp_session_id = acp_session_id.clone();
                            let prompt_blocks = prompt_blocks.clone();
                            async move {
                                let conn = connection.lock().await;
                                conn.prompt(acp::PromptRequest::new(
                                    acp_session_id,
                                    prompt_blocks,
                                ))
                                .await
                            }
                        },
                    )
                    .await;

                    match result {
                        Ok(response) => {
                            let _ = event_sender.send(AgentTurnEvent {
                                turn_id: turn_id.clone(),
                                event: AgentEvent::TurnCompleted {
                                    session_id: session_id.clone(),
                                    result: Some(serde_json::json!({
                                        "stopReason": stop_reason_to_string(response.stop_reason),
                                    })),
                                },
                            });
                            let _ = response_tx.send(Ok(()));
                        }
                        Err(err) => {
                            let error_text = format!("ACP prompt failed: {err}");
                            let _ = event_sender.send(AgentTurnEvent {
                                turn_id: turn_id.clone(),
                                event: AgentEvent::TurnError {
                                    session_id: session_id.clone(),
                                    error: error_text.clone(),
                                    code: None,
                                },
                            });
                            let _ = response_tx.send(Err(error_text));
                        }
                    }

                    let mut active = active_turn.write().await;
                    *active = None;
                });
            }
            AcpCommand::Cancel { response_tx } => {
                let result = with_retry(
                    retry_config.clone(),
                    format!("cancel for session {}", session_id),
                    || {
                        let connection = connection.clone();
                        let acp_session_id = acp_session_id.clone();
                        async move {
                            let conn = connection.lock().await;
                            conn.cancel(acp::CancelNotification::new(acp_session_id)).await
                        }
                    },
                )
                .await;

                let result = result.map_err(|err| format!("ACP cancel failed: {err}"));
                let _ = response_tx.send(result.map(|_| ()));
            }
            AcpCommand::Query {
                query,
                response_tx,
            } => {
                // Handle query requests - currently returns basic session info
                // This can be extended to support more complex queries
                let result = serde_json::json!({
                    "session_id": session_id,
                    "agent_type": "acp",
                    "query": query,
                    "status": "active"
                });
                let _ = response_tx.send(Ok(result));
            }
            AcpCommand::Shutdown { response_tx } => {
                let _ = {
                    let conn = connection.lock().await;
                    conn.cancel(acp::CancelNotification::new(acp_session_id.clone()))
                        .await
                };
                let _ = response_tx.send(());
                break;
            }
            AcpCommand::PermissionRequest { request_id, tool_name, input, options, response_tx } => {
                // Store the permission request and response channel for later resolution
                debug!("Storing permission request for later resolution: {}", request_id);
                pending_permissions.insert(request_id, PendingPermissionEntry {
                    tool_name: tool_name.clone(),
                    input: input.clone(),
                    options,
                    response_tx,
                    created_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default(),
                });
            }
        }
            }
            Some(manager_command) = manager_rx.recv() => {
                match manager_command {
                    PermissionManagerCommand::GetPendingPermissions { response_tx } => {
                        // Build list of pending permissions for external inspection using stored details
                        let pending: Vec<PendingPermission> = pending_permissions
                            .iter()
                            .map(|(request_id, entry)| {
                                PendingPermission {
                                    request_id: request_id.clone(),
                                    session_id: session_id.clone(),
                                    tool_name: entry.tool_name.clone(),
                                    tool_params: entry.input.clone(),
                                    message: None,
                                    created_at: entry.created_at.as_secs(),
                                    response_tx: None,
                                }
                            })
                            .collect();
                        let _ = response_tx.send(pending);
                    }
                    PermissionManagerCommand::RespondToPermission { request_id, approved, approve_for_session, reason: _reason, response_tx: manager_response_tx } => {
                        // Resolve a pending permission request
                        if let Some(entry) = pending_permissions.remove(&request_id) {
                            debug!("Resolving permission request: {} (approved: {})", request_id, approved);
                            let outcome = if approved {
                                // Find an appropriate permission option from the stored options
                                // If ApproveForSession, prefer AllowAlways; otherwise prefer AllowOnce.
                                let selected_option = if approve_for_session {
                                    entry
                                        .options
                                        .iter()
                                        .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowAlways))
                                        .or_else(|| {
                                            entry
                                                .options
                                                .iter()
                                                .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowOnce))
                                        })
                                } else {
                                    entry
                                        .options
                                        .iter()
                                        .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowOnce))
                                        .or_else(|| {
                                            entry
                                                .options
                                                .iter()
                                                .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowAlways))
                                        })
                                }
                                    .or(entry.options.first());

                                match selected_option {
                                    Some(option) => acp::RequestPermissionOutcome::Selected(
                                        acp::SelectedPermissionOutcome::new(option.option_id.clone()),
                                    ),
                                    None => {
                                        warn!("No permission options available for approved request: {}", request_id);
                                        acp::RequestPermissionOutcome::Cancelled
                                    }
                                }
                            } else {
                                acp::RequestPermissionOutcome::Cancelled
                            };
                            match entry.response_tx.send(outcome) {
                                Ok(_) => {
                                    // Successfully resolved the permission request
                                    let _ = manager_response_tx.send(Ok(()));
                                }
                                Err(_) => {
                                    warn!("Failed to send permission outcome for {} - channel closed", request_id);
                                    let _ = manager_response_tx.send(Err("Permission channel closed".to_string()));
                                }
                            }
                        } else {
                            warn!("Received response for unknown permission request: {}", request_id);
                            let _ = manager_response_tx.send(Err("Permission request not found".to_string()));
                        }
                    }
                }
            }
        }
    }

    let _ = event_sender.send(AgentTurnEvent {
        turn_id: Uuid::new_v4().to_string(),
        event: AgentEvent::SessionEnded { session_id },
    });
}

fn stop_reason_to_string(reason: acp::StopReason) -> &'static str {
    match reason {
        acp::StopReason::EndTurn => "end_turn",
        acp::StopReason::MaxTokens => "max_tokens",
        acp::StopReason::MaxTurnRequests => "max_turn_requests",
        acp::StopReason::Refusal => "refusal",
        acp::StopReason::Cancelled => "cancelled",
        _ => "unknown",
    }
}

fn kill_process_force(pid: u32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }

    #[cfg(windows)]
    {
        let _ = StdCommand::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .output();
    }
}

struct TerminalState {
    _master: Box<dyn portable_pty::MasterPty + Send>,
    output_buffer: Arc<Mutex<Vec<u8>>>,
    exit_status: Arc<Mutex<Option<acp::TerminalExitStatus>>>,
    exit_signal: Arc<tokio::sync::Notify>,
    pid: Option<u32>,
}

struct AcpClientHandler {
    session_id: String,
    agent_type: AgentType,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    event_buffer: Arc<Mutex<VecDeque<AgentTurnEvent>>>,
    active_turn: Arc<RwLock<Option<String>>>,
    tool_name_map: Arc<Mutex<HashMap<String, String>>>,
    command_tx: mpsc::UnboundedSender<AcpCommand>,
    terminals: Arc<Mutex<HashMap<acp::TerminalId, TerminalState>>>,
    permission_handler: Arc<RwLock<PermissionHandler>>,
    pending_tool_names: Arc<RwLock<HashMap<String, String>>>,
    /// Number of session updates observed
    session_update_count: Arc<AtomicU64>,
    /// Number of session updates processed
    processed_update_count: Arc<AtomicU64>,
    /// Whether to suppress session updates during drain
    suppress_session_updates: Arc<AtomicBool>,
}

impl AcpClientHandler {
    async fn current_turn_id(&self) -> String {
        self.active_turn
            .read()
            .await
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string())
    }

    async fn emit_event(&self, event: AgentEvent) {
        let turn_id = self.current_turn_id().await;
        let event = AgentTurnEvent { turn_id, event };
        {
            let mut buffer = self.event_buffer.lock().await;
            buffer.push_back(event.clone());
            if buffer.len() > 5000 {
                buffer.pop_front();
            }
        }
        let _ = self.event_sender.send(event);

        // Increment processed counter after event is emitted
        self.processed_update_count.fetch_add(1, Ordering::SeqCst);
    }

    fn content_block_text(block: &acp::ContentBlock) -> String {
        match block {
            acp::ContentBlock::Text(text) => text.text.clone(),
            acp::ContentBlock::Image(_) => "[image]".to_string(),
            acp::ContentBlock::Audio(_) => "[audio]".to_string(),
            acp::ContentBlock::ResourceLink(link) => {
                format!("[resource:{}]", link.uri)
            }
            acp::ContentBlock::Resource(resource) => match &resource.resource {
                acp::EmbeddedResourceResource::TextResourceContents(text) => text.text.clone(),
                acp::EmbeddedResourceResource::BlobResourceContents(blob) => {
                    format!("[blob:{} bytes]", blob.blob.len())
                }
                _ => "[resource]".to_string(),
            },
            _ => "[content]".to_string(),
        }
    }

    fn choose_permission_option(
        options: &[acp::PermissionOption],
    ) -> acp::RequestPermissionOutcome {
        let selected = options
            .iter()
            .find(|option| {
                matches!(
                    option.kind,
                    acp::PermissionOptionKind::AllowOnce | acp::PermissionOptionKind::AllowAlways
                )
            })
            .or_else(|| options.first());

        match selected {
            Some(option) => acp::RequestPermissionOutcome::Selected(
                acp::SelectedPermissionOutcome::new(option.option_id.clone()),
            ),
            None => acp::RequestPermissionOutcome::Cancelled,
        }
    }

    async fn emit_tool_call_update(&self, update: acp::ToolCallUpdate) {
        let tool_id = update.tool_call_id.0.to_string();

        if let Some(title) = update.fields.title.clone() {
            self.tool_name_map
                .lock()
                .await
                .insert(tool_id.clone(), title);
        }

        let cached_tool_name = self.tool_name_map.lock().await.get(&tool_id).cloned();
        let tool_name = update
            .fields
            .title
            .clone()
            .or(cached_tool_name)
            .unwrap_or_else(|| "tool".to_string());

        if let Some(raw_input) = update.fields.raw_input.clone() {
            self.emit_event(AgentEvent::ToolInputUpdated {
                session_id: self.session_id.clone(),
                tool_id: tool_id.clone(),
                tool_name: Some(tool_name.clone()),
                input: Some(raw_input),
            })
            .await;
        }

        let has_following = update
            .fields
            .locations
            .as_ref()
            .map(|locs| !locs.is_empty())
            .unwrap_or(false);
        let has_content = update
            .fields
            .content
            .as_ref()
            .map(|c| !c.is_empty())
            .unwrap_or(false);

        if has_following || has_content {
            self.emit_event(AgentEvent::Raw {
                session_id: self.session_id.clone(),
                agent: self.agent_type,
                data: serde_json::json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": tool_id.clone(),
                    "title": tool_name.clone(),
                    "status": update.fields.status,
                    "locations": update.fields.locations,
                    "content": update.fields.content,
                }),
            })
            .await;
        }

        if let Some(status) = update.fields.status {
            match status {
                acp::ToolCallStatus::Pending | acp::ToolCallStatus::InProgress => {
                    self.emit_event(AgentEvent::ToolInputUpdated {
                        session_id: self.session_id.clone(),
                        tool_id,
                        tool_name: Some(tool_name),
                        input: update.fields.raw_input.clone(),
                    })
                    .await;
                }
                acp::ToolCallStatus::Completed => {
                    self.emit_event(AgentEvent::ToolCompleted {
                        session_id: self.session_id.clone(),
                        tool_id,
                        tool_name: Some(tool_name),
                        output: update.fields.raw_output.clone(),
                        error: None,
                    })
                    .await;
                }
                acp::ToolCallStatus::Failed => {
                    let error_message = update
                        .fields
                        .raw_output
                        .as_ref()
                        .map(|value| {
                            value
                                .as_str()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| value.to_string())
                        })
                        .unwrap_or_else(|| "Tool call failed".to_string());

                    self.emit_event(AgentEvent::ToolCompleted {
                        session_id: self.session_id.clone(),
                        tool_id,
                        tool_name: Some(tool_name),
                        output: update.fields.raw_output.clone(),
                        error: Some(error_message),
                    })
                    .await;
                }
                _ => {}
            }
        }
    }
}

const MAX_TERMINAL_OUTPUT_BUFFER_SIZE: usize = 1024 * 1024; // 1MB

/// Constants for session update draining
/// Time to wait with no updates before considering drain complete
const REPLAY_IDLE_MS: u64 = 80;
/// Maximum time to wait for drain before timing out
const REPLAY_DRAIN_TIMEOUT_MS: u64 = 5000;
/// Poll interval when checking drain status
const DRAIN_POLL_INTERVAL_MS: u64 = 20;

/// Trim a byte buffer to a maximum size while respecting UTF-8 character boundaries.
/// This prevents cutting multi-byte UTF-8 characters in the middle.
fn trim_to_utf8_boundary(buffer: &[u8], max_size: usize) -> usize {
    if buffer.len() <= max_size {
        return buffer.len();
    }

    let start = buffer.len() - max_size;

    // Skip UTF-8 continuation bytes (0b10xxxxxx) to find the start of a valid character
    let mut actual_start = start;
    while actual_start < buffer.len() && (buffer[actual_start] & 0b1100_0000) == 0b1000_0000 {
        actual_start += 1;
    }

    buffer.len() - actual_start
}

#[async_trait::async_trait(?Send)]
impl acp::Client for AcpClientHandler {
    async fn request_permission(
        &self,
        args: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        let tool_name = args
            .tool_call
            .fields
            .title
            .clone()
            .unwrap_or_else(|| "tool".to_string());

        let request_id = args.tool_call.tool_call_id.0.to_string();
        let input = args.tool_call.fields.raw_input.clone();

        if let Some(auto) = {
            let handler = self.permission_handler.read().await;
            handler.should_auto_approve(&tool_name, &request_id)
        } {
            let decision = auto.decision;
            let selected_option = match decision {
                ApprovalDecision::Approved => args
                    .options
                    .iter()
                    .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowOnce))
                    .or_else(|| {
                        args.options
                            .iter()
                            .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowAlways))
                    }),
                ApprovalDecision::ApprovedForSession => args
                    .options
                    .iter()
                    .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowAlways))
                    .or_else(|| {
                        args.options
                            .iter()
                            .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowOnce))
                    }),
                ApprovalDecision::Abort => None,
            };

            if let ApprovalDecision::ApprovedForSession = decision {
                let mut handler = self.permission_handler.write().await;
                handler.add_allowed_tool(tool_name.clone());
            }

            let outcome = match (decision, selected_option) {
                (ApprovalDecision::Abort, _) => acp::RequestPermissionOutcome::Cancelled,
                (_, Some(option)) => acp::RequestPermissionOutcome::Selected(
                    acp::SelectedPermissionOutcome::new(option.option_id.clone()),
                ),
                _ => acp::RequestPermissionOutcome::Cancelled,
            };

            return Ok(acp::RequestPermissionResponse::new(outcome));
        }

        // Emit approval request event
        self.emit_event(AgentEvent::ApprovalRequest {
            session_id: self.session_id.clone(),
            request_id: request_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
            message: Some("Agent requested permission".to_string()),
        })
        .await;

        // Create oneshot channel to receive permission outcome from external responder
        let (outcome_tx, outcome_rx) = oneshot::channel::<acp::RequestPermissionOutcome>();

        {
            let mut map = self.pending_tool_names.write().await;
            map.insert(request_id.clone(), tool_name.clone());
        }

        // Send permission request to command loop for storage and later resolution
        let send_result = self.command_tx.send(AcpCommand::PermissionRequest {
            request_id: request_id.clone(),
            tool_name,
            input: input.unwrap_or_else(|| serde_json::Value::Null),
            options: args.options.clone(),
            response_tx: outcome_tx,
        });

        if send_result.is_err() {
            // Command channel closed, fall back to auto-approval
            warn!("Permission request channel closed, auto-approving");
            let _ = self.pending_tool_names.write().await.remove(&request_id);
            return Ok(acp::RequestPermissionResponse::new(
                Self::choose_permission_option(&args.options),
            ));
        }

        // Wait for permission outcome from external response
        match outcome_rx.await {
            Ok(outcome) => Ok(acp::RequestPermissionResponse::new(outcome)),
            Err(_) => {
                // Outcome channel closed, fall back to auto-approval
                warn!("Permission outcome channel closed, auto-approving");
                Ok(acp::RequestPermissionResponse::new(
                    Self::choose_permission_option(&args.options),
                ))
            }
        }
    }

    async fn session_notification(&self, args: acp::SessionNotification) -> acp::Result<()> {
        // Check if we should suppress updates during drain
        if self.suppress_session_updates.load(Ordering::SeqCst) {
            debug!("Suppressing session update for session {}", self.session_id);
            return Ok(());
        }

        // Increment observed counter for each session update
        self.session_update_count.fetch_add(1, Ordering::SeqCst);

        match args.update {
            acp::SessionUpdate::UserMessageChunk(_) => {}
            acp::SessionUpdate::AgentMessageChunk(chunk) => {
                self.emit_event(AgentEvent::TextDelta {
                    session_id: self.session_id.clone(),
                    text: Self::content_block_text(&chunk.content),
                })
                .await;
            }
            acp::SessionUpdate::AgentThoughtChunk(chunk) => {
                self.emit_event(AgentEvent::ReasoningDelta {
                    session_id: self.session_id.clone(),
                    text: Self::content_block_text(&chunk.content),
                })
                .await;
            }
            acp::SessionUpdate::ToolCall(tool_call) => {
                let tool_id = tool_call.tool_call_id.0.to_string();
                self.tool_name_map
                    .lock()
                    .await
                    .insert(tool_id.clone(), tool_call.title.clone());

                self.emit_event(AgentEvent::ToolStarted {
                    session_id: self.session_id.clone(),
                    tool_id: tool_id.clone(),
                    tool_name: tool_call.title.clone(),
                    input: tool_call.raw_input.clone(),
                })
                .await;

                if !tool_call.locations.is_empty() || !tool_call.content.is_empty() {
                    self.emit_event(AgentEvent::Raw {
                        session_id: self.session_id.clone(),
                        agent: self.agent_type,
                        data: serde_json::json!({
                            "sessionUpdate": "tool_call",
                            "toolCallId": tool_id,
                            "title": tool_call.title.clone(),
                            "status": tool_call.status,
                            "locations": tool_call.locations.clone(),
                            "content": tool_call.content.clone(),
                        }),
                    })
                    .await;
                }

                match tool_call.status {
                    acp::ToolCallStatus::Pending | acp::ToolCallStatus::InProgress => {
                        if let Some(raw_input) = tool_call.raw_input {
                            self.emit_event(AgentEvent::ToolInputUpdated {
                                session_id: self.session_id.clone(),
                                tool_id,
                                tool_name: Some(tool_call.title),
                                input: Some(raw_input),
                            })
                            .await;
                        }
                    }
                    acp::ToolCallStatus::Completed => {
                        self.emit_event(AgentEvent::ToolCompleted {
                            session_id: self.session_id.clone(),
                            tool_id,
                            tool_name: Some(tool_call.title),
                            output: tool_call.raw_output,
                            error: None,
                        })
                        .await;
                    }
                    acp::ToolCallStatus::Failed => {
                        let error_message = tool_call
                            .raw_output
                            .as_ref()
                            .map(|value| {
                                value
                                    .as_str()
                                    .map(ToString::to_string)
                                    .unwrap_or_else(|| value.to_string())
                            })
                            .unwrap_or_else(|| "Tool call failed".to_string());

                        self.emit_event(AgentEvent::ToolCompleted {
                            session_id: self.session_id.clone(),
                            tool_id,
                            tool_name: Some(tool_call.title),
                            output: tool_call.raw_output,
                            error: Some(error_message),
                        })
                        .await;
                    }
                    _ => {}
                }
            }
            acp::SessionUpdate::ToolCallUpdate(update) => {
                self.emit_tool_call_update(update).await;
            }
            update => {
                self.emit_event(AgentEvent::Raw {
                    session_id: self.session_id.clone(),
                    agent: self.agent_type,
                    data: serde_json::to_value(update).unwrap_or_else(|_| serde_json::json!({})),
                })
                .await;
            }
        }

        Ok(())
    }

    async fn write_text_file(
        &self,
        args: acp::WriteTextFileRequest,
    ) -> acp::Result<acp::WriteTextFileResponse> {
        tokio::fs::write(&args.path, args.content)
            .await
            .map_err(|err| {
                acp::Error::internal_error().data(format!("write_text_file failed: {err}"))
            })?;

        Ok(acp::WriteTextFileResponse::new())
    }

    async fn read_text_file(
        &self,
        args: acp::ReadTextFileRequest,
    ) -> acp::Result<acp::ReadTextFileResponse> {
        let content = tokio::fs::read_to_string(&args.path).await.map_err(|err| {
            acp::Error::internal_error().data(format!("read_text_file failed: {err}"))
        })?;

        let content = if args.line.is_some() || args.limit.is_some() {
            let start_line = args.line.unwrap_or(1).max(1) as usize;
            let limit = args.limit.unwrap_or(u32::MAX) as usize;

            content
                .lines()
                .skip(start_line.saturating_sub(1))
                .take(limit)
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            content
        };

        Ok(acp::ReadTextFileResponse::new(content))
    }

    async fn create_terminal(
        &self,
        args: acp::CreateTerminalRequest,
    ) -> acp::Result<acp::CreateTerminalResponse> {
        let pty_system = NativePtySystem::default();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| acp::Error::internal_error().data(format!("Failed to open PTY: {e}")))?;

        let mut cmd = CommandBuilder::new(args.command);
        for arg in args.args {
            cmd.arg(arg);
        }
        for env_var in args.env {
            cmd.env(env_var.name, env_var.value);
        }
        // Disable pager to prevent agents from getting stuck in interactive prompts
        cmd.env("PAGER", "");
        if let Some(cwd) = args.cwd {
            cmd.cwd(cwd);
        }

        let child = pty_pair.slave.spawn_command(cmd).map_err(|e| {
            acp::Error::internal_error().data(format!("Failed to spawn command: {e}"))
        })?;

        let terminal_id = acp::TerminalId::from(Uuid::new_v4().to_string());
        let output_buffer = Arc::new(Mutex::new(Vec::new()));
        let exit_status = Arc::new(Mutex::new(None));
        let exit_signal = Arc::new(tokio::sync::Notify::new());
        let pid = child.process_id();

        let mut reader = pty_pair.master.try_clone_reader().map_err(|e| {
            acp::Error::internal_error().data(format!("Failed to clone PTY reader: {e}"))
        })?;

        let output_buffer_clone = output_buffer.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 1024];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut output = output_buffer_clone.blocking_lock();
                output.extend_from_slice(&buf[..n]);

                // Trim buffer if it exceeds maximum size, respecting UTF-8 boundaries
                if output.len() > MAX_TERMINAL_OUTPUT_BUFFER_SIZE {
                    let current_len = output.len();
                    let new_size = trim_to_utf8_boundary(&output, MAX_TERMINAL_OUTPUT_BUFFER_SIZE);
                    let drain_amount = current_len - new_size;
                    drop(output); // Release borrow before drain

                    let mut output = output_buffer_clone.blocking_lock();
                    output.drain(0..drain_amount);
                }
            }
        });

        let exit_status_clone = exit_status.clone();
        let exit_signal_clone = exit_signal.clone();
        let mut child_wait = child;
        thread::spawn(move || match child_wait.wait() {
            Ok(status) => {
                let mut exit = exit_status_clone.blocking_lock();
                let mut exit_status_struct = acp::TerminalExitStatus::new();
                exit_status_struct.exit_code = Some(status.exit_code());
                *exit = Some(exit_status_struct);
                exit_signal_clone.notify_waiters();
            }
            Err(_) => {
                exit_signal_clone.notify_waiters();
            }
        });

        let mut terminals = self.terminals.lock().await;
        terminals.insert(
            terminal_id.clone(),
            TerminalState {
                _master: pty_pair.master,
                output_buffer,
                exit_status,
                exit_signal,
                pid,
            },
        );

        Ok(acp::CreateTerminalResponse::new(terminal_id))
    }

    async fn terminal_output(
        &self,
        args: acp::TerminalOutputRequest,
    ) -> acp::Result<acp::TerminalOutputResponse> {
        let terminals = self.terminals.lock().await;
        let term = terminals
            .get(&args.terminal_id)
            .ok_or_else(|| acp::Error::invalid_params().data("Terminal not found"))?;

        let output = term.output_buffer.lock().await;
        let data = String::from_utf8_lossy(&output).to_string();

        let exit_status = term.exit_status.lock().await.clone();

        Ok(acp::TerminalOutputResponse::new(data, false).exit_status(exit_status))
    }

    async fn wait_for_terminal_exit(
        &self,
        args: acp::WaitForTerminalExitRequest,
    ) -> acp::Result<acp::WaitForTerminalExitResponse> {
        let (exit_signal, exit_status) = {
            let terminals = self.terminals.lock().await;
            let term = terminals
                .get(&args.terminal_id)
                .ok_or_else(|| acp::Error::invalid_params().data("Terminal not found"))?;
            (term.exit_signal.clone(), term.exit_status.clone())
        };

        exit_signal.notified().await;

        let status = exit_status.lock().await.clone().ok_or_else(|| {
            acp::Error::internal_error().data("Terminal exited but status not found")
        })?;

        Ok(acp::WaitForTerminalExitResponse::new(status))
    }

    async fn release_terminal(
        &self,
        args: acp::ReleaseTerminalRequest,
    ) -> acp::Result<acp::ReleaseTerminalResponse> {
        let mut terminals = self.terminals.lock().await;
        if let Some(term) = terminals.remove(&args.terminal_id) {
            if let Some(pid) = term.pid {
                kill_process_force(pid);
            }
        }
        Ok(acp::ReleaseTerminalResponse::new())
    }

    async fn kill_terminal_command(
        &self,
        args: acp::KillTerminalCommandRequest,
    ) -> acp::Result<acp::KillTerminalCommandResponse> {
        let terminals = self.terminals.lock().await;
        let term = terminals
            .get(&args.terminal_id)
            .ok_or_else(|| acp::Error::invalid_params().data("Terminal not found"))?;

        if let Some(pid) = term.pid {
            kill_process_force(pid);
        }
        Ok(acp::KillTerminalCommandResponse::new())
    }

    async fn ext_method(&self, _args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        Ok(acp::ExtResponse::new(serde_json::from_str("null").unwrap()))
    }

    async fn ext_notification(&self, _args: acp::ExtNotification) -> acp::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_options_builder() {
        let options = SessionOptions::new()
            .with_model("claude-3-opus")
            .with_allowed_tools(vec!["read_file".to_string(), "write_file".to_string()])
            .with_max_turns(10);

        assert_eq!(options.model, Some("claude-3-opus".to_string()));
        assert_eq!(
            options.allowed_tools,
            Some(vec!["read_file".to_string(), "write_file".to_string()])
        );
        assert_eq!(options.max_turns, Some(10));
    }

    #[test]
    fn test_session_options_to_meta() {
        let options = SessionOptions::new()
            .with_model("claude-3-opus")
            .with_max_turns(5);

        let meta = options.to_meta().expect("Should have meta");
        assert_eq!(meta.get("model").unwrap(), &serde_json::json!("claude-3-opus"));
        assert_eq!(meta.get("maxTurns").unwrap(), &serde_json::json!(5));
    }

    #[test]
    fn test_session_options_to_meta_empty() {
        let options = SessionOptions::new();
        assert!(options.to_meta().is_none());
    }

    #[test]
    fn test_session_options_agent_specific() {
        let options =
            SessionOptions::new().with_agent_option("customOption", serde_json::json!("value"));

        let meta = options.to_meta().expect("Should have meta");
        assert_eq!(meta.get("customOption").unwrap(), &serde_json::json!("value"));
    }

    #[test]
    fn test_trim_to_utf8_boundary() {
        // Test with ASCII only
        let ascii: Vec<u8> = b"hello world".to_vec();
        assert_eq!(trim_to_utf8_boundary(&ascii, 5), 5);

        // Test with UTF-8 multi-byte characters
        // "hello世界" - "世界" is 6 bytes (3 bytes each)
        let utf8 = "hello世界".as_bytes().to_vec();
        // If we cut at position 6 (in the middle of "世"), we should skip to "界"
        let result = trim_to_utf8_boundary(&utf8, 3);
        assert!(result <= 3);
    }

    #[test]
    fn test_trim_to_utf8_boundary_no_trim_needed() {
        let data: Vec<u8> = b"short".to_vec();
        assert_eq!(trim_to_utf8_boundary(&data, 100), data.len());
    }
}
