//! Codex ACP Session Implementation (direct codex-core integration).
//!
//! This module drives Codex via `codex-core`'s `ThreadManager`/`CodexThread`
//! directly (in-process), bypassing the ACP Agent/Client protocol layer.
//! Events from `CodexThread::next_event()` are translated to `AgentTurnEvent`.
//!
//! # Architecture
//!
//! The implementation follows the same pattern as `ClaudeSdkSession`:
//!
//! 1. `spawn()` creates channels and spawns a dedicated thread with a `LocalSet`
//! 2. The runtime creates a `ThreadManager`, starts a `CodexThread`
//! 3. Commands are sent via `mpsc::UnboundedSender<CodexCommand>`
//! 4. Permission management via `mpsc::UnboundedSender<PermissionManagerCommand>`
//! 5. Events emitted via `broadcast::Sender<AgentTurnEvent>`
//!
//! # Usage
//!
//! ```no_run
//! use riterm_lib::agent::codex_acp::CodexAcpSession;
//! use riterm_shared::message_protocol::AgentType;
//!
//! # async fn example() -> anyhow::Result<()> {
//! let session = CodexAcpSession::spawn(
//!     "session-1".to_string(),
//!     AgentType::Codex,
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
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use codex_apply_patch::StdFs;
use codex_core::{
    AuthManager, CodexThread, NewThread, ThreadManager,
    config::{Config, ConfigOverrides},
    protocol::{EventMsg, Op, ReviewDecision, SessionSource},
};
use codex_protocol::user_input::UserInput;
use riterm_shared::message_protocol::AgentType;
use tokio::sync::{broadcast, mpsc, oneshot};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use super::acp::PermissionManagerCommand;
use super::events::{AgentEvent, AgentTurnEvent, PendingPermission};

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

/// Commands sent to the Codex runtime loop.
enum CodexCommand {
    /// Send a user message prompt to the Codex agent.
    Prompt {
        text: String,
        turn_id: String,
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Cancel / interrupt the current operation.
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

// ---------------------------------------------------------------------------
// Pending approval tracking
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApprovalKind {
    Exec,
    Patch,
}

#[allow(dead_code)]
struct PendingApproval {
    call_id: String,
    approval_kind: ApprovalKind,
    tool_name: String,
    input: serde_json::Value,
}

// ---------------------------------------------------------------------------
// CodexAcpSession (public API)
// ---------------------------------------------------------------------------

/// A session that drives Codex via codex-core's ThreadManager/CodexThread directly.
///
/// This implementation mirrors ClaudeSdkSession's public API for SessionKind
/// compatibility, but communicates with codex-core in-process rather than
/// via an external process + ndJSON protocol.
#[allow(dead_code)]
pub struct CodexAcpSession {
    session_id: String,
    agent_type: AgentType,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    command_tx: mpsc::UnboundedSender<CodexCommand>,
    manager_tx: mpsc::UnboundedSender<PermissionManagerCommand>,
}

impl CodexAcpSession {
    /// Spawn a new Codex session backed by codex-core directly.
    ///
    /// This creates channels, spawns a dedicated thread with a single-threaded
    /// tokio runtime + `LocalSet`, and starts the codex-core thread inside it.
    pub async fn spawn(
        session_id: String,
        agent_type: AgentType,
        working_dir: PathBuf,
        home_dir: Option<String>,
    ) -> Result<Self> {
        let (event_sender, _) = broadcast::channel(1024);
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let (manager_tx, manager_rx) = mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = oneshot::channel::<std::result::Result<(), String>>();

        let runtime_session_id = session_id.clone();
        let runtime_event_sender = event_sender.clone();

        let thread_name = format!("riterm-codex-{}", &session_id[..session_id.len().min(8)]);

        std::thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(err) => {
                        let _ = ready_tx.send(Err(format!("Failed to build Codex runtime: {err}")));
                        return;
                    }
                };

                let local_set = tokio::task::LocalSet::new();
                runtime.block_on(local_set.run_until(async move {
                    if let Err(err) = run_codex_runtime(CodexRuntimeParams {
                        session_id: runtime_session_id,
                        agent_type,
                        working_dir,
                        home_dir,
                        event_sender: runtime_event_sender,
                        command_rx,
                        manager_rx,
                        ready_tx,
                    })
                    .await
                    {
                        error!("Codex runtime exited with error: {err}");
                    }
                }));
            })
            .with_context(|| format!("Failed to spawn Codex thread for session {session_id}"))?;

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
                "Codex startup channel closed before session became ready"
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

    /// Send a user message to the Codex agent.
    pub async fn send_message(
        &self,
        text: String,
        turn_id: &str,
    ) -> std::result::Result<(), String> {
        debug!(
            "Codex send_message session={} agent={:?}",
            self.session_id, self.agent_type
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(CodexCommand::Prompt {
                text,
                turn_id: turn_id.to_string(),
                response_tx,
            })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Prompt response channel closed".to_string())?
    }

    /// Interrupt the current operation.
    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        debug!(
            "Codex interrupt session={} agent={:?}",
            self.session_id, self.agent_type
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(CodexCommand::Cancel { response_tx })
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
            "Codex get_pending_permissions for session {}",
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
            "Codex permission response for session {}: request_id={}, approved={}",
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
        debug!("Codex shutdown for session {}", self.session_id);
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(CodexCommand::Shutdown { response_tx })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Shutdown response channel closed".to_string())?;

        Ok(())
    }

    /// Query session status or capabilities.
    pub async fn query(&self, query: String) -> std::result::Result<serde_json::Value, String> {
        debug!(
            "Codex query session={} agent={:?} query={}",
            self.session_id, self.agent_type, query
        );
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(CodexCommand::Query { query, response_tx })
            .map_err(|_| "Command channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Query response channel closed".to_string())?
    }
}

// ---------------------------------------------------------------------------
// Runtime parameters
// ---------------------------------------------------------------------------

struct CodexRuntimeParams {
    session_id: String,
    agent_type: AgentType,
    working_dir: PathBuf,
    home_dir: Option<String>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    command_rx: mpsc::UnboundedReceiver<CodexCommand>,
    manager_rx: mpsc::UnboundedReceiver<PermissionManagerCommand>,
    ready_tx: oneshot::Sender<std::result::Result<(), String>>,
}

// ---------------------------------------------------------------------------
// Codex Runtime
// ---------------------------------------------------------------------------

/// Main runtime function.  Creates ThreadManager + CodexThread and enters event loop.
async fn run_codex_runtime(params: CodexRuntimeParams) -> Result<()> {
    info!(
        "Starting Codex runtime for session {} ({:?}) in {}",
        params.session_id,
        params.agent_type,
        params.working_dir.display()
    );

    // Set HOME directory if specified
    if let Some(ref home) = params.home_dir {
        unsafe { std::env::set_var("HOME", home) };
        debug!("Setting HOME environment variable: {}", home);
    }

    // Load and configure codex-core Config
    let mut config =
        Config::load_with_cli_overrides_and_harness_overrides(vec![], ConfigOverrides::default())
            .await
            .map_err(|e| anyhow!("Failed to load codex config: {e}"))?;
    config.cwd = params.working_dir.clone();
    config.include_apply_patch_tool = true;

    // Create AuthManager
    let auth_manager = AuthManager::shared(
        config.codex_home.clone(),
        false,
        config.cli_auth_credentials_store_mode,
    );

    // Create ThreadManager with StdFs (local execution, no sandboxing needed)
    let thread_manager = ThreadManager::new_with_fs(
        config.codex_home.clone(),
        auth_manager.clone(),
        SessionSource::Unknown,
        Box::new(move |_thread_id| Arc::new(StdFs) as Arc<dyn codex_core::codex::Fs>),
    );

    // Start a codex thread
    let NewThread {
        thread_id: _,
        thread,
        session_configured: _,
    } = Box::pin(thread_manager.start_thread(config.clone()))
        .await
        .map_err(|e| anyhow!("Failed to start codex thread: {e}"))?;

    // Signal ready
    let _ = params.ready_tx.send(Ok(()));

    // Emit SessionStarted
    let _ = params.event_sender.send(AgentTurnEvent {
        turn_id: Uuid::new_v4().to_string(),
        event: AgentEvent::SessionStarted {
            session_id: params.session_id.clone(),
            agent: params.agent_type,
        },
    });

    // Run event loop
    run_codex_event_loop(
        params.session_id.clone(),
        params.agent_type,
        thread,
        params.event_sender.clone(),
        params.command_rx,
        params.manager_rx,
    )
    .await;

    // Emit SessionEnded
    let _ = params.event_sender.send(AgentTurnEvent {
        turn_id: Uuid::new_v4().to_string(),
        event: AgentEvent::SessionEnded {
            session_id: params.session_id.clone(),
        },
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Event loop
// ---------------------------------------------------------------------------

/// Main event loop: select between codex-core events, commands, and permission responses.
async fn run_codex_event_loop(
    session_id: String,
    agent_type: AgentType,
    thread: Arc<CodexThread>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    mut command_rx: mpsc::UnboundedReceiver<CodexCommand>,
    mut manager_rx: mpsc::UnboundedReceiver<PermissionManagerCommand>,
) {
    let mut pending_permissions: HashMap<String, PendingApproval> = HashMap::new();
    let mut pending_prompt_tx: Option<oneshot::Sender<std::result::Result<(), String>>> = None;
    let mut current_turn_id = Uuid::new_v4().to_string();
    let mut seen_message_deltas = false;
    // Track the submission_id returned by thread.submit() for approval Ops.
    let mut current_submission_id: Option<String> = None;

    let emit = |turn_id: &str, event: AgentEvent| {
        let _ = event_sender.send(AgentTurnEvent {
            turn_id: turn_id.to_string(),
            event,
        });
    };

    loop {
        tokio::select! {
            // --- Branch 1: Events from codex-core ---
            event_result = thread.next_event() => {
                match event_result {
                    Ok(event) => {
                        let event_msg = event.msg;
                        handle_codex_event(
                            &session_id,
                            &current_turn_id,
                            event_msg,
                            &emit,
                            &mut pending_permissions,
                            &mut pending_prompt_tx,
                            &mut seen_message_deltas,
                            &current_submission_id,
                        );
                    }
                    Err(err) => {
                        error!("[Codex][{}] Event stream error: {}", session_id, err);
                        // Resolve any pending prompt with error
                        if let Some(tx) = pending_prompt_tx.take() {
                            let _ = tx.send(Err(format!("Codex event stream error: {err}")));
                        }
                        break;
                    }
                }
            }

            // --- Branch 2: Commands from the public API ---
            Some(command) = command_rx.recv() => {
                match command {
                    CodexCommand::Prompt { text, turn_id, response_tx } => {
                        info!("[Codex][{}] Received Prompt command, turn_id={}", session_id, turn_id);

                        current_turn_id = turn_id.clone();
                        seen_message_deltas = false;

                        // Emit TurnStarted
                        emit(
                            &turn_id,
                            AgentEvent::TurnStarted {
                                session_id: session_id.clone(),
                                turn_id: turn_id.clone(),
                            },
                        );

                        // Submit user input to codex-core
                        match thread.submit(Op::UserInput {
                            items: vec![UserInput::Text {
                                text,
                                text_elements: vec![],
                            }],
                            final_output_json_schema: None,
                        }).await {
                            Ok(submission_id) => {
                                info!("[Codex][{}] Submitted user input, submission_id={}", session_id, submission_id);
                                current_submission_id = Some(submission_id);
                                pending_prompt_tx = Some(response_tx);
                            }
                            Err(err) => {
                                let error_msg = format!("Failed to submit user input: {err}");
                                error!("[Codex][{}] {}", session_id, error_msg);
                                let _ = response_tx.send(Err(error_msg));
                            }
                        }
                    }

                    CodexCommand::Cancel { response_tx } => {
                        info!("[Codex][{}] Received Cancel command", session_id);
                        match thread.submit(Op::Interrupt).await {
                            Ok(_) => {
                                let _ = response_tx.send(Ok(()));
                            }
                            Err(err) => {
                                let _ = response_tx.send(Err(format!("Failed to interrupt: {err}")));
                            }
                        }
                    }

                    CodexCommand::Query { query, response_tx } => {
                        let result = serde_json::json!({
                            "session_id": session_id,
                            "agent_type": format!("{:?}", agent_type),
                            "protocol": "codex_core",
                            "query": query,
                            "status": "active",
                        });
                        let _ = response_tx.send(Ok(result));
                    }

                    CodexCommand::Shutdown { response_tx } => {
                        info!("[Codex][{}] Received Shutdown command", session_id);
                        let _ = thread.submit(Op::Interrupt).await;
                        let _ = response_tx.send(());
                        break;
                    }
                }
            }

            // --- Branch 3: Permission manager commands ---
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
                        if let Some(approval) = pending_permissions.remove(&request_id) {
                            debug!(
                                "[Codex][{}] Resolving permission {}: approved={}, kind={:?}",
                                session_id, request_id, approved, approval.approval_kind
                            );

                            let submission_id = current_submission_id.clone().unwrap_or_default();

                            let op = match approval.approval_kind {
                                ApprovalKind::Exec => Op::ExecApproval {
                                    id: submission_id,
                                    turn_id: None,
                                    decision: if approved {
                                        ReviewDecision::Approved
                                    } else {
                                        ReviewDecision::Abort
                                    },
                                },
                                ApprovalKind::Patch => Op::PatchApproval {
                                    id: submission_id,
                                    decision: if approved {
                                        ReviewDecision::Approved
                                    } else {
                                        ReviewDecision::Abort
                                    },
                                },
                            };

                            match thread.submit(op).await {
                                Ok(_) => {
                                    let _ = manager_response_tx.send(Ok(()));
                                }
                                Err(err) => {
                                    warn!(
                                        "[Codex][{}] Failed to submit approval: {}",
                                        session_id, err
                                    );
                                    let _ = manager_response_tx.send(Err(format!(
                                        "Failed to submit approval: {err}"
                                    )));
                                }
                            }
                        } else {
                            warn!(
                                "[Codex][{}] Unknown permission request: {}",
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
                info!("[Codex][{}] All channels closed, exiting event loop", session_id);
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Event mapping: codex-core EventMsg -> AgentEvent
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn handle_codex_event(
    session_id: &str,
    current_turn_id: &str,
    event_msg: EventMsg,
    emit: &impl Fn(&str, AgentEvent),
    pending_permissions: &mut HashMap<String, PendingApproval>,
    pending_prompt_tx: &mut Option<oneshot::Sender<std::result::Result<(), String>>>,
    seen_message_deltas: &mut bool,
    _current_submission_id: &Option<String>,
) {
    match event_msg {
        // --- Text streaming ---
        EventMsg::AgentMessageContentDelta(event) => {
            *seen_message_deltas = true;
            emit(
                current_turn_id,
                AgentEvent::TextDelta {
                    session_id: session_id.to_string(),
                    text: event.delta,
                },
            );
        }

        // --- Full agent message (fallback if no deltas seen) ---
        EventMsg::AgentMessage(event) => {
            if !*seen_message_deltas {
                emit(
                    current_turn_id,
                    AgentEvent::TextDelta {
                        session_id: session_id.to_string(),
                        text: event.message,
                    },
                );
            }
        }

        // --- Reasoning streaming ---
        EventMsg::ReasoningContentDelta(event) => {
            emit(
                current_turn_id,
                AgentEvent::ReasoningDelta {
                    session_id: session_id.to_string(),
                    text: event.delta,
                },
            );
        }
        EventMsg::ReasoningRawContentDelta(event) => {
            emit(
                current_turn_id,
                AgentEvent::ReasoningDelta {
                    session_id: session_id.to_string(),
                    text: event.delta,
                },
            );
        }

        // --- Exec command lifecycle ---
        EventMsg::ExecCommandBegin(event) => {
            let command_str = format!("{:?}", event.command);
            emit(
                current_turn_id,
                AgentEvent::ToolStarted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: format!("exec: {}", command_str),
                    input: Some(serde_json::json!({"command": command_str})),
                },
            );
        }
        EventMsg::ExecCommandEnd(event) => {
            emit(
                current_turn_id,
                AgentEvent::ToolCompleted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: Some("exec".to_string()),
                    output: Some(serde_json::json!({"exit_code": event.exit_code})),
                    error: if event.exit_code != 0 {
                        Some(format!("Command exited with code {}", event.exit_code))
                    } else {
                        None
                    },
                },
            );
        }

        // --- Exec command output delta ---
        EventMsg::ExecCommandOutputDelta(event) => {
            emit(
                current_turn_id,
                AgentEvent::ToolInputUpdated {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: Some("exec".to_string()),
                    input: Some(serde_json::json!({"output_delta": event.chunk})),
                },
            );
        }

        // --- MCP tool call lifecycle ---
        EventMsg::McpToolCallBegin(event) => {
            let tool_name = format!("{}:{}", event.invocation.server, event.invocation.tool);
            emit(
                current_turn_id,
                AgentEvent::ToolStarted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name,
                    input: None,
                },
            );
        }
        EventMsg::McpToolCallEnd(event) => {
            let result_value = event
                .result
                .as_ref()
                .ok()
                .and_then(|r| serde_json::to_value(r).ok());
            emit(
                current_turn_id,
                AgentEvent::ToolCompleted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: Some(format!(
                        "{}:{}",
                        event.invocation.server, event.invocation.tool
                    )),
                    output: result_value,
                    error: event.result.as_ref().err().cloned(),
                },
            );
        }

        // --- Patch apply lifecycle ---
        EventMsg::PatchApplyBegin(event) => {
            emit(
                current_turn_id,
                AgentEvent::ToolStarted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: "apply_patch".to_string(),
                    input: None,
                },
            );
        }
        EventMsg::PatchApplyEnd(event) => {
            emit(
                current_turn_id,
                AgentEvent::ToolCompleted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: Some("apply_patch".to_string()),
                    output: Some(serde_json::json!({"success": event.success})),
                    error: if !event.success {
                        Some("Patch apply failed".to_string())
                    } else {
                        None
                    },
                },
            );
        }

        // --- Approval requests ---
        EventMsg::ExecApprovalRequest(event) => {
            let request_id = Uuid::new_v4().to_string();
            let command_str = format!("{:?}", event.command);
            info!(
                "[Codex][{}] ExecApprovalRequest: call_id={}, command={}",
                session_id, event.call_id, command_str
            );

            emit(
                current_turn_id,
                AgentEvent::ApprovalRequest {
                    session_id: session_id.to_string(),
                    request_id: request_id.clone(),
                    tool_name: "exec".to_string(),
                    input: Some(serde_json::json!({"command": command_str})),
                    message: Some(format!("Execute command: {}", command_str)),
                },
            );

            pending_permissions.insert(
                request_id,
                PendingApproval {
                    call_id: event.call_id,
                    approval_kind: ApprovalKind::Exec,
                    tool_name: "exec".to_string(),
                    input: serde_json::json!({"command": command_str}),
                },
            );
        }
        EventMsg::ApplyPatchApprovalRequest(event) => {
            let request_id = Uuid::new_v4().to_string();
            info!(
                "[Codex][{}] ApplyPatchApprovalRequest: call_id={}",
                session_id, event.call_id
            );

            emit(
                current_turn_id,
                AgentEvent::ApprovalRequest {
                    session_id: session_id.to_string(),
                    request_id: request_id.clone(),
                    tool_name: "apply_patch".to_string(),
                    input: None,
                    message: Some("Apply code patch".to_string()),
                },
            );

            pending_permissions.insert(
                request_id,
                PendingApproval {
                    call_id: event.call_id,
                    approval_kind: ApprovalKind::Patch,
                    tool_name: "apply_patch".to_string(),
                    input: serde_json::Value::Null,
                },
            );
        }

        // --- Turn lifecycle ---
        EventMsg::TurnComplete(_event) => {
            emit(
                current_turn_id,
                AgentEvent::TurnCompleted {
                    session_id: session_id.to_string(),
                    result: Some(serde_json::json!({"stopReason": "end_turn"})),
                },
            );

            if let Some(tx) = pending_prompt_tx.take() {
                let _ = tx.send(Ok(()));
            }
            *seen_message_deltas = false;
        }
        EventMsg::TurnAborted(_event) => {
            emit(
                current_turn_id,
                AgentEvent::TurnCompleted {
                    session_id: session_id.to_string(),
                    result: Some(serde_json::json!({"stopReason": "cancelled"})),
                },
            );

            if let Some(tx) = pending_prompt_tx.take() {
                let _ = tx.send(Ok(()));
            }
            *seen_message_deltas = false;
        }
        EventMsg::Error(event) => {
            error!("[Codex][{}] Error: {}", session_id, event.message);

            emit(
                current_turn_id,
                AgentEvent::TurnError {
                    session_id: session_id.to_string(),
                    error: event.message.clone(),
                    code: None,
                },
            );

            if let Some(tx) = pending_prompt_tx.take() {
                let _ = tx.send(Err(event.message));
            }
            *seen_message_deltas = false;
        }
        EventMsg::StreamError(event) => {
            warn!("[Codex][{}] Stream error: {}", session_id, event.message);
            // Stream errors are non-fatal, don't resolve the prompt
        }

        // --- Web search events ---
        EventMsg::WebSearchBegin(event) => {
            emit(
                current_turn_id,
                AgentEvent::ToolStarted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: "web_search".to_string(),
                    input: None,
                },
            );
        }
        EventMsg::WebSearchEnd(event) => {
            emit(
                current_turn_id,
                AgentEvent::ToolCompleted {
                    session_id: session_id.to_string(),
                    tool_id: event.call_id.clone(),
                    tool_name: Some("web_search".to_string()),
                    output: Some(serde_json::json!({"query": event.query})),
                    error: None,
                },
            );
        }

        // --- Turn started ---
        EventMsg::TurnStarted(_event) => {
            // Already emitted TurnStarted in the Prompt command handler
        }

        // --- Shutdown ---
        EventMsg::ShutdownComplete => {
            info!("[Codex][{}] Shutdown complete", session_id);
            if let Some(tx) = pending_prompt_tx.take() {
                let _ = tx.send(Ok(()));
            }
        }

        // --- Events we log but don't translate ---
        EventMsg::TokenCount(_)
        | EventMsg::TurnDiff(_)
        | EventMsg::BackgroundEvent(_)
        | EventMsg::ContextCompacted(_)
        | EventMsg::ThreadNameUpdated(_)
        | EventMsg::PlanUpdate(_)
        | EventMsg::PlanDelta(_)
        | EventMsg::UndoStarted(_)
        | EventMsg::UndoCompleted(_)
        | EventMsg::Warning(_)
        | EventMsg::McpStartupUpdate(_)
        | EventMsg::McpStartupComplete(_)
        | EventMsg::ItemStarted(_)
        | EventMsg::ItemCompleted(_)
        | EventMsg::UserMessage(_)
        | EventMsg::AgentReasoning(_)
        | EventMsg::AgentReasoningSectionBreak(_)
        | EventMsg::SessionConfigured(_)
        | EventMsg::TerminalInteraction(_)
        | EventMsg::ViewImageToolCall(_)
        | EventMsg::EnteredReviewMode(_)
        | EventMsg::ExitedReviewMode(_)
        | EventMsg::ThreadRolledBack(_)
        | EventMsg::SkillsUpdateAvailable
        | EventMsg::DeprecationNotice(_) => {
            debug!("[Codex][{}] Unhandled event (logged only)", session_id);
        }

        // --- Catch-all for remaining events ---
        _ => {
            debug!("[Codex][{}] Unknown/ignored event", session_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_approval_kind_eq() {
        assert_eq!(ApprovalKind::Exec, ApprovalKind::Exec);
        assert_eq!(ApprovalKind::Patch, ApprovalKind::Patch);
        assert_ne!(ApprovalKind::Exec, ApprovalKind::Patch);
    }
}
