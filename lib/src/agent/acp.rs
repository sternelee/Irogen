//! ACP-based streaming session implementation.
//!
//! This module hosts ACP client connections to external agent processes
//! and adapts ACP updates into RiTerm AgentEvent messages.
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
//! use riterm_lib::agent::{AgentManager, AgentType};
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

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol as acp;
use agent_client_protocol::Agent;
use anyhow::{anyhow, Context, Result};
use riterm_shared::message_protocol::AgentType;
use tokio::io::AsyncBufReadExt;
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::{Mutex, RwLock, broadcast, mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::events::{AgentEvent, AgentTurnEvent, PendingPermission};

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
    let delay = config.initial_backoff.as_millis() as f64 * config.backoff_multiplier.powi(attempt as i32);
    config.max_backoff.min(Duration::from_millis(delay as u64))
}

/// ACP command types with response channels for bidirectional communication
enum AcpCommand {
    /// Send a prompt/message to the agent
    Prompt {
        text: String,
        turn_id: String,
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Cancel the current operation
    Cancel {
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Shutdown the session
    Shutdown {
        response_tx: oneshot::Sender<()>,
    },
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
    command_tx: mpsc::UnboundedSender<AcpCommand>,
    manager_tx: mpsc::UnboundedSender<PermissionManagerCommand>,
    retry_config: RetryConfig,
}

impl AcpStreamingSession {
    /// Create a new ACP streaming session with default retry configuration
    pub async fn spawn(
        session_id: String,
        agent_type: AgentType,
        command: String,
        args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
    ) -> Result<Self> {
        Self::spawn_with_config(
            session_id,
            agent_type,
            command,
            args,
            working_dir,
            home_dir,
            RetryConfig::default(),
        )
        .await
    }

    /// Create a new ACP streaming session with custom retry configuration
    pub async fn spawn_with_config(
        session_id: String,
        agent_type: AgentType,
        command: String,
        args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
        retry_config: RetryConfig,
    ) -> Result<Self> {
        let (event_sender, _) = broadcast::channel(1024);
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let (manager_tx, manager_rx) = mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = oneshot::channel::<std::result::Result<(), String>>();

        let runtime_session_id = session_id.clone();
        let runtime_event_sender = event_sender.clone();
        let runtime_retry_config = retry_config.clone();
        let runtime_manager_tx = manager_tx.clone();
        let runtime_command_tx = command_tx.clone();

        let thread_name = format!("riterm-acp-{}", &session_id[..session_id.len().min(8)]);

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
                        working_dir,
                        home_dir,
                        event_sender: runtime_event_sender,
                        command_tx: runtime_command_tx,
                        command_rx,
                        manager_tx: runtime_manager_tx,
                        manager_rx,
                        ready_tx,
                        retry_config: runtime_retry_config,
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
                command_tx,
                manager_tx,
                retry_config,
            }),
            Ok(Err(err)) => Err(anyhow!(err)),
            Err(_) => Err(anyhow!(
                "ACP startup channel closed before session became ready"
            )),
        }
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

    /// Query agent capabilities or status
    pub async fn query(&self, query: String) -> std::result::Result<serde_json::Value, String> {
        debug!(
            "ACP query session={} agent={:?} query={}",
            self.session_id, self.agent_type, query
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(AcpCommand::Query {
                query,
                response_tx,
            })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx
            .await
            .map_err(|_| "Query response channel closed".to_string())?
    }

    /// Send a message to the agent
    pub async fn send_message(&self, text: String, turn_id: &str) -> std::result::Result<(), String> {
        debug!(
            "ACP send_message session={} agent={:?}",
            self.session_id, self.agent_type
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(AcpCommand::Prompt {
                text,
                turn_id: turn_id.to_string(),
                response_tx,
            })
            .map_err(|_| String::from(AcpError::CommandChannelClosed))?;

        response_rx
            .await
            .map_err(|_| String::from(AcpError::PromptFailed("Response channel closed".to_string())))?
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

        response_rx
            .await
            .map_err(|_| String::from(AcpError::CancelFailed("Response channel closed".to_string())))?
    }

    /// Get pending permissions
    pub async fn get_pending_permissions(&self) -> std::result::Result<Vec<PendingPermission>, String> {
        debug!("ACP get_pending_permissions for session {}", self.session_id);
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
        reason: Option<String>,
    ) -> std::result::Result<(), String> {
        debug!(
            "ACP permission response for session {}: request_id={}, approved={}",
            self.session_id, request_id, approved
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.manager_tx
            .send(PermissionManagerCommand::RespondToPermission {
                request_id,
                approved,
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
}

/// Parameters for the ACP runtime task
#[allow(dead_code)]
struct AcpRuntimeParams {
    session_id: String,
    agent_type: AgentType,
    command: String,
    args: Vec<String>,
    working_dir: PathBuf,
    home_dir: Option<String>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    command_tx: mpsc::UnboundedSender<AcpCommand>,
    command_rx: mpsc::UnboundedReceiver<AcpCommand>,
    manager_tx: mpsc::UnboundedSender<PermissionManagerCommand>,
    manager_rx: mpsc::UnboundedReceiver<PermissionManagerCommand>,
    ready_tx: oneshot::Sender<std::result::Result<(), String>>,
    retry_config: RetryConfig,
}

/// Get an extended PATH that includes common binary directories.
/// macOS GUI apps don't inherit the user's shell PATH, so we need to
/// explicitly include directories where tools like `claude`, `gemini`, etc. are installed.
fn get_extended_path() -> String {
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

/// Resolve a command name to its full path by searching common directories.
/// Returns the original command if no full path is found (will rely on PATH).
fn resolve_command_path(command: &str) -> String {
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
    if let Ok(output) = std::process::Command::new("which")
        .arg(command)
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                debug!("Resolved command '{}' via which to '{}'", command, path);
                return path;
            }
        }
    }

    debug!(
        "Could not resolve full path for '{}', using as-is",
        command
    );
    command.to_string()
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

    let mut cmd = Command::new(&resolved_command);
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

    let mut child = cmd
        .spawn()
        .with_context(|| {
            format!(
                "Failed to spawn ACP agent command '{}' (resolved: '{}'): {:#?}",
                params.command, resolved_command, params.args
            )
        })?;

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

    let active_turn = Arc::new(RwLock::new(None::<String>));
    let tool_name_map = Arc::new(Mutex::new(HashMap::<String, String>::new()));

    let client = AcpClientHandler {
        session_id: params.session_id.clone(),
        agent_type: params.agent_type,
        event_sender: params.event_sender.clone(),
        active_turn: active_turn.clone(),
        tool_name_map: tool_name_map.clone(),
        command_tx: params.command_tx.clone(),
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
        format!("initialize ACP connection for session {}", params.session_id),
        || async {
            connection
                .initialize(
                    acp::InitializeRequest::new(acp::ProtocolVersion::LATEST)
                        .client_capabilities(
                            acp::ClientCapabilities::new()
                                .fs(acp::FileSystemCapability::new()
                                    .read_text_file(true)
                                    .write_text_file(true))
                                .terminal(false),
                        )
                        .client_info(
                            acp::Implementation::new("riterm-cli", env!("CARGO_PKG_VERSION"))
                                .title("RiTerm CLI"),
                        ),
                )
                .await
        },
    )
    .await;

    if let Err(err) = init_result {
        let error_msg = format!("ACP initialize failed: {err}");
        let _ = params.ready_tx.send(Err(error_msg.clone()));
        return Err(anyhow::anyhow!(error_msg));
    }

    // Create session with retry logic
    let new_session_result = with_retry(
        params.retry_config.clone(),
        format!("create ACP session for {}", params.session_id),
        || async {
            connection
                .new_session(acp::NewSessionRequest::new(params.working_dir.clone()))
                .await
        },
    )
    .await;

    let acp_session_id = match new_session_result {
        Ok(resp) => {
            info!(
                "ACP session created successfully: {} for session {}",
                resp.session_id, params.session_id
            );
            resp.session_id
        }
        Err(err) => {
            let error_msg = format!("ACP new_session failed: {err}");
            let _ = params.ready_tx.send(Err(error_msg.clone()));
            return Err(anyhow::anyhow!(error_msg));
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

    run_command_loop(
        params.session_id.clone(),
        connection,
        acp_session_id,
        active_turn,
        params.event_sender.clone(),
        params.command_rx,
        params.manager_rx,
        params.retry_config.clone(),
    )
    .await;

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
                    info!("Operation '{}' succeeded on attempt {}", operation, attempt + 1);
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

    error!("Operation '{}' failed after {} attempts", operation, config.max_attempts);
    Err(format!(
        "Failed after {} attempts: {}",
        config.max_attempts, last_error
    ))
}

async fn run_command_loop(
    session_id: String,
    connection: acp::ClientSideConnection,
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
    
    let mut pending_permissions: std::collections::HashMap<String, PendingPermissionEntry> = std::collections::HashMap::new();
    
    loop {
        tokio::select! {
            Some(command) = command_rx.recv() => {
                match command {
            AcpCommand::Prompt {
                text,
                turn_id,
                response_tx,
            } => {
                {
                    let mut active = active_turn.write().await;
                    *active = Some(turn_id.clone());
                }

                let _ = event_sender.send(AgentTurnEvent {
                    turn_id: turn_id.clone(),
                    event: AgentEvent::TurnStarted {
                        session_id: session_id.clone(),
                        turn_id: turn_id.clone(),
                    },
                });

                let result = with_retry(
                    retry_config.clone(),
                    format!("prompt for session {}", session_id),
                    || async {
                        connection
                            .prompt(acp::PromptRequest::new(
                                acp_session_id.clone(),
                                vec![acp::ContentBlock::from(text.clone())],
                            ))
                            .await
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
            }
            AcpCommand::Cancel { response_tx } => {
                let result = with_retry(
                    retry_config.clone(),
                    format!("cancel for session {}", session_id),
                    || async {
                        connection
                            .cancel(acp::CancelNotification::new(acp_session_id.clone()))
                            .await
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
                let _ = connection
                    .cancel(acp::CancelNotification::new(acp_session_id.clone()))
                    .await;
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
                    created_at: std::time::Duration::from_secs(0), // TODO: use actual timestamp
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
                                    tool_params: serde_json::Value::Null, // Note: Could parse input if needed
                                    message: None,
                                    created_at: 0,
                                    response_tx: None,
                                }
                            })
                            .collect();
                        let _ = response_tx.send(pending);
                    }
                    PermissionManagerCommand::RespondToPermission { request_id, approved, reason: _reason, response_tx: manager_response_tx } => {
                        // Resolve a pending permission request
                        if let Some(entry) = pending_permissions.remove(&request_id) {
                            debug!("Resolving permission request: {} (approved: {})", request_id, approved);
                            let outcome = if approved {
                                // Find an appropriate permission option from the stored options
                                // If there are Allow* options, use one of them; otherwise use the first available
                                let selected_option = entry.options.iter()
                                    .find(|opt| matches!(opt.kind, acp::PermissionOptionKind::AllowOnce | acp::PermissionOptionKind::AllowAlways))
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

struct AcpClientHandler {
    session_id: String,
    agent_type: AgentType,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    active_turn: Arc<RwLock<Option<String>>>,
    tool_name_map: Arc<Mutex<HashMap<String, String>>>,
    command_tx: mpsc::UnboundedSender<AcpCommand>,
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
        let _ = self.event_sender.send(AgentTurnEvent { turn_id, event });
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
}
