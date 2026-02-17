//! Claude SDK Control Protocol streaming session implementation.
//!
//! This module drives Claude Code CLI directly via the SDK Control Protocol,
//! communicating over ndJSON (newline-delimited JSON) on stdin/stdout.
//!
//! # SDK Control Protocol Overview
//!
//! The SDK Control Protocol is an ndJSON-based protocol for bidirectional
//! communication with the Claude Code CLI process:
//!
//! - **User messages** are written to stdin as JSON lines
//! - **Output messages** are read from stdout as JSON lines
//! - **Permission requests** arrive on stdout and are responded to on stdin
//! - **Interruption** is performed by sending SIGINT to the child process
//!
//! # Architecture
//!
//! The implementation follows the same pattern as `AcpStreamingSession`:
//!
//! 1. `spawn()` creates channels and spawns a dedicated thread with a `LocalSet`
//! 2. The runtime spawns the claude process, sets up stdin/stdout readers
//! 3. Commands are sent via `mpsc::UnboundedSender<SdkCommand>`
//! 4. Permission management via `mpsc::UnboundedSender<PermissionManagerCommand>`
//! 5. Events emitted via `broadcast::Sender<AgentTurnEvent>`
//!
//! # Usage
//!
//! ```no_run
//! use crate::agent::claude_sdk::ClaudeSdkSession;
//! use crate::message_protocol::AgentType;
//!
//! # async fn example() -> anyhow::Result<()> {
//! let session = ClaudeSdkSession::spawn(
//!     "session-1".to_string(),
//!     AgentType::ClaudeCode,
//!     "claude".to_string(),
//!     vec![],
//!     "/workspace".into(),
//!     None,
//! ).await?;
//!
//! let mut events = session.subscribe();
//! session.send_message("Hello".to_string(), "turn-1").await?;
//! # Ok(())
//! # }
//! ```

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use crate::message_protocol::AgentType;
use anyhow::{Context, Result, anyhow};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::acp::{PermissionManagerCommand, get_extended_path};
use super::events::{AgentEvent, AgentTurnEvent, PendingPermission};

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

/// Commands sent to the SDK runtime loop.
enum SdkCommand {
    /// Send a user message prompt to the Claude CLI.
    Prompt {
        text: String,
        turn_id: String,
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Cancel / interrupt the current operation (sends SIGINT).
    Cancel {
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Gracefully shut down the session.
    Shutdown { response_tx: oneshot::Sender<()> },
    /// Query session info.
    Query {
        query: String,
        response_tx: oneshot::Sender<std::result::Result<serde_json::Value, String>>,
    },
}

/// Internal message from the stdout reader to the command loop when a
/// permission request arrives from the Claude CLI.
struct PermissionRequestMsg {
    request_id: String,
    tool_name: String,
    input: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Content block tracking
// ---------------------------------------------------------------------------

/// Tracks a content block being streamed from the CLI output.
#[derive(Debug, Clone)]
enum ContentBlockKind {
    Text,
    Thinking,
    ToolUse {
        tool_id: String,
        tool_name: String,
        accumulated_input: String,
    },
}

// ---------------------------------------------------------------------------
// ClaudeSdkSession (public API)
// ---------------------------------------------------------------------------

/// A streaming session that drives Claude Code CLI via the SDK Control Protocol.
///
/// The session spawns a `claude` process with the appropriate flags and
/// communicates over ndJSON on stdin/stdout.
#[allow(dead_code)]
pub struct ClaudeSdkSession {
    session_id: String,
    agent_type: AgentType,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    command_tx: mpsc::UnboundedSender<SdkCommand>,
    manager_tx: mpsc::UnboundedSender<PermissionManagerCommand>,
}

impl ClaudeSdkSession {
    /// Spawn a new Claude SDK session.
    ///
    /// This creates channels, spawns a dedicated thread with a single-threaded
    /// tokio runtime + `LocalSet`, and starts the claude process inside it.
    pub async fn spawn(
        session_id: String,
        agent_type: AgentType,
        command: String,
        args: Vec<String>,
        working_dir: PathBuf,
        home_dir: Option<String>,
    ) -> Result<Self> {
        let (event_sender, _) = broadcast::channel(1024);
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let (manager_tx, manager_rx) = mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = oneshot::channel::<std::result::Result<(), String>>();

        let runtime_session_id = session_id.clone();
        let runtime_event_sender = event_sender.clone();

        let thread_name = format!("clawdchat-sdk-{}", &session_id[..session_id.len().min(8)]);

        std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(err) => {
                        let _ = ready_tx.send(Err(format!("Failed to build SDK runtime: {err}")));
                        return;
                    }
                };

                let local_set = tokio::task::LocalSet::new();
                runtime.block_on(local_set.run_until(async move {
                    if let Err(err) = run_sdk_runtime(SdkRuntimeParams {
                        session_id: runtime_session_id,
                        agent_type,
                        command,
                        args,
                        working_dir,
                        home_dir,
                        event_sender: runtime_event_sender,
                        command_rx,
                        manager_rx,
                        ready_tx,
                    })
                    .await
                    {
                        error!("SDK runtime exited with error: {err}");
                    }
                }));
            })
            .with_context(|| format!("Failed to spawn SDK thread for session {session_id}"))?;

        match ready_rx.await {
            Ok(Ok(())) => Ok(Self {
                session_id,
                agent_type,
                event_sender,
                command_tx,
                manager_tx,
            }),
            Ok(Err(err)) => Err(anyhow!(err)),
            Err(_) => Err(anyhow!(
                "SDK startup channel closed before session became ready"
            )),
        }
    }

    /// Get session ID.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Get agent type.
    pub fn agent_type(&self) -> AgentType {
        self.agent_type
    }

    /// Subscribe to agent events.
    pub fn subscribe(&self) -> broadcast::Receiver<AgentTurnEvent> {
        self.event_sender.subscribe()
    }

    /// Send a user message to the Claude CLI.
    pub async fn send_message(
        &self,
        text: String,
        turn_id: &str,
    ) -> std::result::Result<(), String> {
        debug!(
            "SDK send_message session={} agent={:?}",
            self.session_id, self.agent_type
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(SdkCommand::Prompt {
                text,
                turn_id: turn_id.to_string(),
                response_tx,
            })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Prompt response channel closed".to_string())?
    }

    /// Interrupt the current operation (sends SIGINT to the child process).
    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        debug!(
            "SDK interrupt session={} agent={:?}",
            self.session_id, self.agent_type
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(SdkCommand::Cancel { response_tx })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Cancel response channel closed".to_string())?
    }

    /// Get pending permission requests.
    pub async fn get_pending_permissions(
        &self,
    ) -> std::result::Result<Vec<PendingPermission>, String> {
        debug!(
            "SDK get_pending_permissions for session {}",
            self.session_id
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.manager_tx
            .send(PermissionManagerCommand::GetPendingPermissions { response_tx })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Get pending permissions response channel closed".to_string())
    }

    /// Respond to a pending permission request.
    pub async fn respond_to_permission(
        &self,
        request_id: String,
        approved: bool,
        reason: Option<String>,
    ) -> std::result::Result<(), String> {
        debug!(
            "SDK permission response for session {}: request_id={}, approved={}",
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
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Permission response channel closed".to_string())?
    }

    /// Gracefully shut down the session.
    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        debug!("SDK shutdown for session {}", self.session_id);
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(SdkCommand::Shutdown { response_tx })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Shutdown response channel closed".to_string())?;

        Ok(())
    }

    /// Query session status or capabilities.
    pub async fn query(&self, query: String) -> std::result::Result<serde_json::Value, String> {
        debug!(
            "SDK query session={} agent={:?} query={}",
            self.session_id, self.agent_type, query
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(SdkCommand::Query { query, response_tx })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Query response channel closed".to_string())?
    }
}

// ---------------------------------------------------------------------------
// Runtime parameters
// ---------------------------------------------------------------------------

struct SdkRuntimeParams {
    session_id: String,
    agent_type: AgentType,
    command: String,
    args: Vec<String>,
    working_dir: PathBuf,
    home_dir: Option<String>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    command_rx: mpsc::UnboundedReceiver<SdkCommand>,
    manager_rx: mpsc::UnboundedReceiver<PermissionManagerCommand>,
    ready_tx: oneshot::Sender<std::result::Result<(), String>>,
}

// ---------------------------------------------------------------------------
// Resolve command path (local helper, mirrors logic in acp.rs)
// ---------------------------------------------------------------------------

/// Resolve a command name to its full path by searching common directories.
fn resolve_command_path(command: &str) -> String {
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

    // Fallback: try `which`
    if let Ok(output) = std::process::Command::new("which").arg(command).output() {
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

// ---------------------------------------------------------------------------
// SDK Runtime
// ---------------------------------------------------------------------------

/// Main runtime function.  Spawns the claude process and enters the event loop.
async fn run_sdk_runtime(params: SdkRuntimeParams) -> Result<()> {
    info!(
        "Starting SDK runtime for session {} ({:?}) with command: {} {:?}",
        params.session_id, params.agent_type, params.command, params.args
    );

    let resolved_command = resolve_command_path(&params.command);
    info!(
        "Resolved command '{}' -> '{}'",
        params.command, resolved_command
    );

    // Build the default SDK flags.  The caller may supply additional args
    // (e.g. `--model`), but we always ensure the SDK-mode flags are present.
    let sdk_flags: Vec<String> = vec![
        "-p".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--permission-prompt-tool".to_string(),
        "stdio".to_string(),
    ];

    let mut all_args = sdk_flags;
    all_args.extend(params.args);

    let mut cmd = Command::new(&resolved_command);
    cmd.args(&all_args)
        .current_dir(&params.working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Extend PATH so GUI-spawned processes can find the binary.
    let extended_path = get_extended_path();
    cmd.env("PATH", &extended_path);

    if let Some(ref home) = params.home_dir {
        cmd.env("HOME", home);
        debug!("Setting HOME environment variable: {}", home);
    }

    let mut child = cmd.spawn().with_context(|| {
        format!(
            "Failed to spawn SDK agent command '{}' (resolved: '{}'): {:?}",
            params.command, resolved_command, all_args
        )
    })?;

    let child_pid = child.id();

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Failed to capture SDK agent stdin"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Failed to capture SDK agent stdout"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Failed to capture SDK agent stderr"))?;

    // Shared writer: the command loop and permission response writer both need
    // to write to stdin.
    let stdin_writer = Arc::new(Mutex::new(stdin));

    // Channel for permission requests flowing from the stdout reader to the
    // command loop.
    let (perm_req_tx, perm_req_rx) = mpsc::unbounded_channel::<PermissionRequestMsg>();

    // Channel for the stdout reader to notify the command loop that a turn
    // result has been received.
    let (turn_result_tx, turn_result_rx) =
        mpsc::unbounded_channel::<std::result::Result<serde_json::Value, String>>();

    // Signal the caller that the process started successfully.
    let _ = params.ready_tx.send(Ok(()));

    // Emit SessionStarted
    let _ = params.event_sender.send(AgentTurnEvent {
        turn_id: Uuid::new_v4().to_string(),
        event: AgentEvent::SessionStarted {
            session_id: params.session_id.clone(),
            agent: params.agent_type,
        },
    });

    // ---- Stderr reader task ----
    let session_id_for_stderr = params.session_id.clone();
    tokio::task::spawn_local(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            debug!("[SDK stderr][{}] {}", session_id_for_stderr, line);
        }
    });

    // ---- Stdout reader task ----
    let session_id_for_stdout = params.session_id.clone();
    let event_sender_for_stdout = params.event_sender.clone();
    tokio::task::spawn_local(async move {
        run_stdout_reader(
            session_id_for_stdout,
            stdout,
            event_sender_for_stdout,
            perm_req_tx,
            turn_result_tx,
        )
        .await;
    });

    // ---- Command loop ----
    run_command_loop(
        params.session_id.clone(),
        params.agent_type,
        stdin_writer,
        child_pid,
        params.event_sender.clone(),
        params.command_rx,
        params.manager_rx,
        perm_req_rx,
        turn_result_rx,
    )
    .await;

    // Cleanup
    info!(
        "SDK runtime shutting down for session {}, killing agent process",
        params.session_id
    );
    let _ = child.start_kill();
    let _ = child.wait().await;

    Ok(())
}

// ---------------------------------------------------------------------------
// Stdout reader
// ---------------------------------------------------------------------------

/// Reads ndJSON lines from the claude process stdout and dispatches events.
async fn run_stdout_reader(
    session_id: String,
    stdout: tokio::process::ChildStdout,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    perm_req_tx: mpsc::UnboundedSender<PermissionRequestMsg>,
    turn_result_tx: mpsc::UnboundedSender<std::result::Result<serde_json::Value, String>>,
) {
    let mut reader = BufReader::new(stdout).lines();

    // Track active content blocks by index.
    let mut content_blocks: HashMap<u64, ContentBlockKind> = HashMap::new();

    // Current turn ID (updated from TurnStarted, or a default).
    let mut current_turn_id = Uuid::new_v4().to_string();

    let emit = |turn_id: &str, event: AgentEvent| {
        let _ = event_sender.send(AgentTurnEvent {
            turn_id: turn_id.to_string(),
            event,
        });
    };

    while let Ok(Some(line)) = reader.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        info!("[SDK stdout][{}] Received: {}", session_id, line);

        let msg: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(err) => {
                debug!(
                    "[SDK stdout][{}] non-JSON line ({}): {}",
                    session_id, err, line
                );
                continue;
            }
        };

        let msg_type = msg
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        match msg_type.as_str() {
            // ----- system init -----
            "system" => {
                let subtype = msg.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
                if subtype == "init" {
                    let sdk_session_id = msg
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let model = msg
                        .get("model")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let tools = msg.get("tools").cloned().unwrap_or_default();
                    info!(
                        "[SDK][{}] Initialized: session={}, model={}, tools={}",
                        session_id, sdk_session_id, model, tools
                    );
                }
            }

            // ----- assistant message (full message) -----
            "assistant" => {
                debug!("[SDK][{}] assistant message received", session_id);

                // The assistant message may contain content blocks.
                // Try content array from /message/content
                let content_array = msg.pointer("/message/content").and_then(|v| v.as_array());

                if let Some(content) = content_array {
                    debug!(
                        "[SDK][{}] Found {} content blocks",
                        session_id,
                        content.len()
                    );
                    for block in content {
                        let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        if block_type == "text" {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    debug!(
                                        "[SDK][{}] assistant text block ({} chars)",
                                        session_id,
                                        text.len()
                                    );
                                    emit(
                                        &current_turn_id,
                                        AgentEvent::TextDelta {
                                            session_id: session_id.clone(),
                                            text: text.to_string(),
                                        },
                                    );
                                }
                            }
                        } else if block_type == "thinking" {
                            if let Some(thinking) = block.get("thinking").and_then(|v| v.as_str()) {
                                if !thinking.is_empty() {
                                    debug!(
                                        "[SDK][{}] assistant thinking block ({} chars)",
                                        session_id,
                                        thinking.len()
                                    );
                                    emit(
                                        &current_turn_id,
                                        AgentEvent::ReasoningDelta {
                                            session_id: session_id.clone(),
                                            text: thinking.to_string(),
                                        },
                                    );
                                }
                            }
                        }
                    }
                } else {
                    warn!(
                        "[SDK][{}] Could not parse assistant message content",
                        session_id
                    );
                }
            }

            // ----- content_block_start -----
            "content_block_start" => {
                let index = msg.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                let block = msg.get("content_block").unwrap_or(&serde_json::Value::Null);
                let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match block_type {
                    "text" => {
                        content_blocks.insert(index, ContentBlockKind::Text);
                    }
                    "thinking" => {
                        content_blocks.insert(index, ContentBlockKind::Thinking);
                    }
                    "tool_use" => {
                        let tool_id = block
                            .get("id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let tool_name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool")
                            .to_string();

                        content_blocks.insert(
                            index,
                            ContentBlockKind::ToolUse {
                                tool_id: tool_id.clone(),
                                tool_name: tool_name.clone(),
                                accumulated_input: String::new(),
                            },
                        );

                        emit(
                            &current_turn_id,
                            AgentEvent::ToolStarted {
                                session_id: session_id.clone(),
                                tool_id,
                                tool_name,
                                input: None,
                            },
                        );
                    }
                    _ => {
                        debug!(
                            "[SDK][{}] Unknown content_block_start type: {}",
                            session_id, block_type
                        );
                    }
                }
            }

            // ----- content_block_delta -----
            "content_block_delta" => {
                let index = msg.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                let delta = msg.get("delta").unwrap_or(&serde_json::Value::Null);
                let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or("");

                match delta_type {
                    "text_delta" => {
                        if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                            emit(
                                &current_turn_id,
                                AgentEvent::TextDelta {
                                    session_id: session_id.clone(),
                                    text: text.to_string(),
                                },
                            );
                        }
                    }
                    "thinking_delta" => {
                        if let Some(thinking) = delta.get("thinking").and_then(|v| v.as_str()) {
                            emit(
                                &current_turn_id,
                                AgentEvent::ReasoningDelta {
                                    session_id: session_id.clone(),
                                    text: thinking.to_string(),
                                },
                            );
                        }
                    }
                    "input_json_delta" => {
                        if let Some(partial_json) =
                            delta.get("partial_json").and_then(|v| v.as_str())
                        {
                            if let Some(block) = content_blocks.get_mut(&index) {
                                if let ContentBlockKind::ToolUse {
                                    tool_id,
                                    tool_name,
                                    accumulated_input,
                                } = block
                                {
                                    accumulated_input.push_str(partial_json);

                                    // Try parsing accumulated JSON; emit whatever
                                    // we have so far as a partial update.
                                    let parsed = serde_json::from_str::<serde_json::Value>(
                                        accumulated_input,
                                    )
                                    .ok();

                                    emit(
                                        &current_turn_id,
                                        AgentEvent::ToolInputUpdated {
                                            session_id: session_id.clone(),
                                            tool_id: tool_id.clone(),
                                            tool_name: Some(tool_name.clone()),
                                            input: parsed,
                                        },
                                    );
                                }
                            }
                        }
                    }
                    _ => {
                        debug!("[SDK][{}] Unknown delta type: {}", session_id, delta_type);
                    }
                }
            }

            // ----- content_block_stop -----
            "content_block_stop" => {
                let index = msg.get("index").and_then(|v| v.as_u64()).unwrap_or(0);

                if let Some(block) = content_blocks.remove(&index) {
                    if let ContentBlockKind::ToolUse {
                        tool_id,
                        tool_name,
                        accumulated_input,
                    } = block
                    {
                        let parsed_input =
                            serde_json::from_str::<serde_json::Value>(&accumulated_input).ok();

                        emit(
                            &current_turn_id,
                            AgentEvent::ToolCompleted {
                                session_id: session_id.clone(),
                                tool_id,
                                tool_name: Some(tool_name),
                                output: parsed_input,
                                error: None,
                            },
                        );
                    }
                }
            }

            // ----- permission_request -----
            "permission_request" => {
                let permission = msg.get("permission").unwrap_or(&serde_json::Value::Null);
                let tool_name = permission
                    .get("tool_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool")
                    .to_string();
                let input = permission
                    .get("input")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);

                let request_id = Uuid::new_v4().to_string();

                // Emit approval request event.
                emit(
                    &current_turn_id,
                    AgentEvent::ApprovalRequest {
                        session_id: session_id.clone(),
                        request_id: request_id.clone(),
                        tool_name: tool_name.clone(),
                        input: Some(input.clone()),
                        message: Some(format!("Permission requested for tool: {}", tool_name)),
                    },
                );

                // Forward to command loop for storage and later resolution.
                let _ = perm_req_tx.send(PermissionRequestMsg {
                    request_id,
                    tool_name,
                    input,
                });
            }

            // ----- result -----
            "result" => {
                let subtype = msg
                    .get("subtype")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                match subtype.as_str() {
                    "success" => {
                        let result_val = msg
                            .get("result")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let cost_usd = msg.get("cost_usd").and_then(|v| v.as_f64());
                        let duration_ms = msg.get("duration_ms").and_then(|v| v.as_u64());
                        let sdk_session_id = msg
                            .get("session_id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        debug!(
                            "[SDK][{}] Turn completed: cost={:?}, duration={:?}ms, sdk_session={:?}",
                            session_id, cost_usd, duration_ms, sdk_session_id
                        );

                        emit(
                            &current_turn_id,
                            AgentEvent::TurnCompleted {
                                session_id: session_id.clone(),
                                result: Some(serde_json::json!({
                                    "stopReason": "end_turn",
                                    "cost_usd": cost_usd,
                                    "duration_ms": duration_ms,
                                    "result": result_val,
                                })),
                            },
                        );

                        let _ = turn_result_tx.send(Ok(serde_json::json!({
                            "subtype": "success",
                            "cost_usd": cost_usd,
                            "duration_ms": duration_ms,
                        })));
                    }
                    _ => {
                        // Error subtypes: error_max_turns, error, etc.
                        let is_error = msg
                            .get("is_error")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(true);
                        let error_msg = msg
                            .get("error")
                            .and_then(|v| v.as_str())
                            .or_else(|| msg.get("result").and_then(|v| v.as_str()))
                            .unwrap_or("Unknown error")
                            .to_string();

                        if is_error {
                            emit(
                                &current_turn_id,
                                AgentEvent::TurnError {
                                    session_id: session_id.clone(),
                                    error: format!("{}: {}", subtype, error_msg),
                                    code: Some(subtype.clone()),
                                },
                            );
                        }

                        let _ = turn_result_tx.send(Err(format!("{}: {}", subtype, error_msg)));
                    }
                }

                // Reset content blocks for next turn.
                content_blocks.clear();
                current_turn_id = Uuid::new_v4().to_string();
            }

            // ----- message_start (alternative streaming envelope) -----
            "message_start" | "message_delta" | "message_stop" => {
                // Some versions of the SDK protocol may emit these; pass through
                // as raw events.
                emit(
                    &current_turn_id,
                    AgentEvent::Raw {
                        session_id: session_id.clone(),
                        agent: AgentType::ClaudeCode,
                        data: msg.clone(),
                    },
                );
            }

            _ => {
                debug!(
                    "[SDK][{}] Unhandled message type '{}': {}",
                    session_id,
                    msg_type,
                    serde_json::to_string(&msg).unwrap_or_default()
                );
            }
        }
    }

    info!(
        "[SDK][{}] Stdout reader finished (process likely exited)",
        session_id
    );
}

// ---------------------------------------------------------------------------
// Command loop
// ---------------------------------------------------------------------------

/// Pending permission entry stored in the command loop.
struct PendingPermissionEntry {
    tool_name: String,
    input: serde_json::Value,
    /// Channel to write the permission_response JSON on stdin.
    response_tx: Option<oneshot::Sender<bool>>,
}

#[allow(clippy::too_many_arguments)]
async fn run_command_loop(
    session_id: String,
    agent_type: AgentType,
    stdin_writer: Arc<Mutex<tokio::process::ChildStdin>>,
    child_pid: Option<u32>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    mut command_rx: mpsc::UnboundedReceiver<SdkCommand>,
    mut manager_rx: mpsc::UnboundedReceiver<PermissionManagerCommand>,
    mut perm_req_rx: mpsc::UnboundedReceiver<PermissionRequestMsg>,
    mut turn_result_rx: mpsc::UnboundedReceiver<std::result::Result<serde_json::Value, String>>,
) {
    let mut pending_permissions: HashMap<String, PendingPermissionEntry> = HashMap::new();

    // Optional: a pending prompt's response channel, waiting for the turn result.
    let mut pending_prompt_tx: Option<oneshot::Sender<std::result::Result<(), String>>> = None;

    loop {
        tokio::select! {
            // --- Incoming commands from the public API ---
            Some(command) = command_rx.recv() => {
                match command {
                    SdkCommand::Prompt { text, turn_id, response_tx } => {
                        info!("[SDK][{}] Received Prompt command, turn_id={}", session_id, turn_id);

                        // Emit TurnStarted
                        let _ = event_sender.send(AgentTurnEvent {
                            turn_id: turn_id.clone(),
                            event: AgentEvent::TurnStarted {
                                session_id: session_id.clone(),
                                turn_id: turn_id.clone(),
                            },
                        });

                        // Write the user message as ndJSON to stdin.
                        let user_msg = serde_json::json!({
                            "type": "user",
                            "message": {
                                "role": "user",
                                "content": text,
                            },
                            "session_id": turn_id,
                        });

                        let mut line = serde_json::to_string(&user_msg)
                            .unwrap_or_default();
                        line.push('\n');

                        info!("[SDK][{}] Writing to stdin: {}",
                              session_id,
                              line.trim()
                        );

                        let write_result = {
                            let mut writer = stdin_writer.lock().await;
                            writer.write_all(line.as_bytes()).await
                                .and_then(|_| {
                                    // We cannot call flush().await here directly
                                    // because we hold the lock, but write_all
                                    // with a newline should be sufficient for
                                    // line-buffered ndJSON.
                                    Ok(())
                                })
                        };

                        // Additionally flush outside the lock.
                        {
                            let mut writer = stdin_writer.lock().await;
                            let _ = writer.flush().await;
                        }

                        match write_result {
                            Ok(()) => {
                                info!("[SDK][{}] Successfully wrote user message to stdin", session_id);
                                // Store the response channel; it will be resolved
                                // when we receive a `result` message from stdout.
                                pending_prompt_tx = Some(response_tx);
                            }
                            Err(err) => {
                                let error_msg = format!("Failed to write prompt to stdin: {err}");
                                error!("[SDK][{}] {}", session_id, error_msg);
                                let _ = response_tx.send(Err(error_msg));
                            }
                        }
                    }

                    SdkCommand::Cancel { response_tx } => {
                        // Send SIGINT to the child process.
                        let result = send_sigint(child_pid);
                        let _ = response_tx.send(result);
                    }

                    SdkCommand::Query { query, response_tx } => {
                        let result = serde_json::json!({
                            "session_id": session_id,
                            "agent_type": format!("{:?}", agent_type),
                            "protocol": "sdk_control",
                            "query": query,
                            "status": "active",
                        });
                        let _ = response_tx.send(Ok(result));
                    }

                    SdkCommand::Shutdown { response_tx } => {
                        // Send SIGINT first to allow graceful shutdown.
                        let _ = send_sigint(child_pid);
                        let _ = response_tx.send(());
                        break;
                    }
                }
            }

            // --- Permission requests arriving from the stdout reader ---
            Some(perm_req) = perm_req_rx.recv() => {
                debug!(
                    "[SDK][{}] Storing permission request: {} for tool {}",
                    session_id, perm_req.request_id, perm_req.tool_name
                );
                // Create a oneshot so that when the user responds, we can
                // write the permission_response to stdin.
                let (resp_tx, resp_rx) = oneshot::channel::<bool>();

                pending_permissions.insert(
                    perm_req.request_id.clone(),
                    PendingPermissionEntry {
                        tool_name: perm_req.tool_name,
                        input: perm_req.input,
                        response_tx: Some(resp_tx),
                    },
                );

                // Spawn a local task to wait for the user response and write
                // the permission_response JSON to stdin.
                let stdin_clone = stdin_writer.clone();
                let sid = session_id.clone();
                tokio::task::spawn_local(async move {
                    match resp_rx.await {
                        Ok(approved) => {
                            let permission_value = if approved {
                                "allow"
                            } else {
                                "deny"
                            };
                            let resp_json = serde_json::json!({
                                "type": "permission_response",
                                "permission_response": {
                                    "permission": permission_value,
                                }
                            });
                            let mut line = serde_json::to_string(&resp_json)
                                .unwrap_or_default();
                            line.push('\n');

                            let mut writer = stdin_clone.lock().await;
                            if let Err(err) = writer.write_all(line.as_bytes()).await {
                                error!(
                                    "[SDK][{}] Failed to write permission response: {}",
                                    sid, err
                                );
                            }
                            let _ = writer.flush().await;
                        }
                        Err(_) => {
                            warn!(
                                "[SDK][{}] Permission response channel closed",
                                sid
                            );
                        }
                    }
                });
            }

            // --- Turn results arriving from the stdout reader ---
            Some(result) = turn_result_rx.recv() => {
                if let Some(tx) = pending_prompt_tx.take() {
                    match result {
                        Ok(_) => {
                            let _ = tx.send(Ok(()));
                        }
                        Err(err) => {
                            let _ = tx.send(Err(err));
                        }
                    }
                }
            }

            // --- Permission manager commands (from public API) ---
            Some(manager_cmd) = manager_rx.recv() => {
                match manager_cmd {
                    PermissionManagerCommand::GetPendingPermissions { response_tx } => {
                        let pending: Vec<PendingPermission> = pending_permissions
                            .iter()
                            .map(|(request_id, entry)| PendingPermission {
                                request_id: request_id.clone(),
                                session_id: session_id.clone(),
                                tool_name: entry.tool_name.clone(),
                                tool_params: entry.input.clone(),
                                message: None,
                                created_at: 0,
                                response_tx: None,
                            })
                            .collect();
                        let _ = response_tx.send(pending);
                    }

                    PermissionManagerCommand::RespondToPermission {
                        request_id,
                        approved,
                        reason: _reason,
                        response_tx: manager_response_tx,
                    } => {
                        if let Some(mut entry) = pending_permissions.remove(&request_id) {
                            debug!(
                                "[SDK][{}] Resolving permission {}: approved={}",
                                session_id, request_id, approved
                            );
                            if let Some(tx) = entry.response_tx.take() {
                                match tx.send(approved) {
                                    Ok(()) => {
                                        let _ = manager_response_tx.send(Ok(()));
                                    }
                                    Err(_) => {
                                        warn!(
                                            "[SDK][{}] Permission channel already closed for {}",
                                            session_id, request_id
                                        );
                                        let _ = manager_response_tx.send(Err(
                                            "Permission channel closed".to_string(),
                                        ));
                                    }
                                }
                            } else {
                                let _ = manager_response_tx.send(Err(
                                    "No response channel for permission request"
                                        .to_string(),
                                ));
                            }
                        } else {
                            warn!(
                                "[SDK][{}] Unknown permission request: {}",
                                session_id, request_id
                            );
                            let _ = manager_response_tx.send(Err(
                                "Permission request not found".to_string(),
                            ));
                        }
                    }
                }
            }

            // --- All channels closed ---
            else => {
                info!("[SDK][{}] All channels closed, exiting command loop", session_id);
                break;
            }
        }
    }

    // Emit SessionEnded.
    let _ = event_sender.send(AgentTurnEvent {
        turn_id: Uuid::new_v4().to_string(),
        event: AgentEvent::SessionEnded {
            session_id: session_id.clone(),
        },
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Send SIGINT to a child process.
///
/// On Unix, this uses `libc::kill` with `SIGINT`.
/// On other platforms, we fall back to logging a warning (SIGINT is
/// not directly available).
fn send_sigint(child_pid: Option<u32>) -> std::result::Result<(), String> {
    let Some(pid) = child_pid else {
        return Err("No child PID available for SIGINT".to_string());
    };

    #[cfg(unix)]
    {
        // SAFETY: We are sending a signal to a process we own.
        let ret = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
        if ret == 0 {
            debug!("Sent SIGINT to child process {}", pid);
            Ok(())
        } else {
            let err = std::io::Error::last_os_error();
            Err(format!("Failed to send SIGINT to {}: {}", pid, err))
        }
    }

    #[cfg(not(unix))]
    {
        warn!(
            "SIGINT not supported on this platform; cannot interrupt child {}",
            pid
        );
        Err("SIGINT not supported on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_command_path_absolute() {
        let result = resolve_command_path("/usr/bin/env");
        assert_eq!(result, "/usr/bin/env");
    }

    #[test]
    fn test_resolve_command_path_relative() {
        // This will either resolve or fall back to as-is.
        let result = resolve_command_path("this_command_does_not_exist_12345");
        assert_eq!(result, "this_command_does_not_exist_12345");
    }

    #[test]
    fn test_send_sigint_no_pid() {
        let result = send_sigint(None);
        assert!(result.is_err());
    }
}
