//! OpenClaw Gateway WebSocket session implementation.
//!
//! This module provides WebSocket-based communication with OpenClaw Gateway.
//! OpenClaw Gateway is started with `openclaw gateway` and listens on a WebSocket port.
//!
//! # Protocol
//!
//! The Gateway uses JSON frames:
//! - REQUEST: `{type: "req", id: string, method: string, params: object}`
//! - RESPONSE: `{type: "res", id: string, ok: boolean, payload?: object, error?: object}`
//! - EVENT: `{type: "event", event: string, payload: object, seq: number}`

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc, oneshot, RwLock};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::message_protocol::AgentType;
use super::events::{AgentEvent, AgentTurnEvent, PendingPermission};

/// Default port for OpenClaw Gateway
pub const DEFAULT_OPENCLAW_PORT: u16 = 18789;

/// OpenClaw Gateway WebSocket session
pub struct OpenClawWsSession {
    /// Session ID
    session_id: String,
    /// Agent type
    agent_type: AgentType,
    /// Event broadcaster
    event_sender: broadcast::Sender<AgentTurnEvent>,
    /// Command channel for sending requests
    command_tx: mpsc::UnboundedSender<OpenClawCommand>,
    /// Manager channel for internal commands
    manager_tx: mpsc::UnboundedSender<ManagerCommand>,
}

/// Commands sent to the OpenClaw runtime
#[derive(Debug)]
pub enum OpenClawCommand {
    /// Send a prompt to the agent
    Prompt {
        text: String,
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Cancel current operation
    Cancel {
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Shutdown the session
    Shutdown,
}

/// Manager commands for internal control
#[derive(Debug)]
enum ManagerCommand {
    /// Get pending permissions
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
    /// Interrupt current operation
    Interrupt {
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
}

impl OpenClawWsSession {
    /// Spawn a new OpenClaw Gateway WebSocket session
    ///
    /// This will:
    /// 1. Start OpenClaw Gateway as a subprocess
    /// 2. Wait for it to bind to the WebSocket port
    /// 3. Connect to the WebSocket and start the session
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
        let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();

        let runtime_session_id = session_id.clone();
        let runtime_event_sender = event_sender.clone();
        let runtime_command_tx = command_tx.clone();
        let runtime_manager_tx = manager_tx.clone();

        // Spawn the runtime in a separate thread (OpenClaw Gateway needs to bind to a port)
        std::thread::Builder::new()
            .name(format!("clawdchat-openclaw-{}", &session_id[..session_id.len().min(8)]))
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(err) => {
                        let _ = ready_tx.send(Err(format!("Failed to build runtime: {err}")));
                        return;
                    }
                };

                let local_set = tokio::task::LocalSet::new();
                runtime.block_on(local_set.run_until(async move {
                    if let Err(err) = run_openclaw_runtime(OpenClawRuntimeParams {
                        session_id: runtime_session_id,
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
                    })
                    .await
                    {
                        error!("OpenClaw runtime exited with error: {err}");
                    }
                }));
            })
            .context("Failed to spawn OpenClaw thread")?;

        match ready_rx.await {
            Ok(Ok(())) => Ok(Self {
                session_id,
                agent_type,
                event_sender,
                command_tx,
                manager_tx,
            }),
            Ok(Err(err)) => Err(anyhow!(err)),
            Err(_) => Err(anyhow!("OpenClaw startup channel closed")),
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

    /// Send a message to the agent
    pub async fn send_message(
        &self,
        text: String,
        _turn_id: &str,
    ) -> std::result::Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel::<std::result::Result<(), String>>();

        self.command_tx
            .send(OpenClawCommand::Prompt {
                text,
                response_tx,
            })
            .map_err(|e| format!("Failed to send command: {}", e))?;

        response_rx.await.map_err(|e| format!("Command channel closed: {}", e))?
    }

    /// Interrupt current operation
    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel::<std::result::Result<(), String>>();

        self.manager_tx
            .send(ManagerCommand::Interrupt { response_tx })
            .map_err(|e| format!("Failed to send interrupt: {}", e))?;

        response_rx.await.map_err(|e| format!("Interrupt channel closed: {}", e))?
    }

    /// Get pending permission requests
    pub async fn get_pending_permissions(&self) -> std::result::Result<Vec<PendingPermission>, String> {
        let (response_tx, response_rx) = oneshot::channel::<Vec<PendingPermission>>();

        self.manager_tx
            .send(ManagerCommand::GetPendingPermissions { response_tx })
            .map_err(|e| format!("Failed to get permissions: {}", e))?;

        response_rx.await.map_err(|e| format!("Permission channel closed: {}", e))
    }

    /// Respond to a permission request
    pub async fn respond_to_permission(
        &self,
        request_id: String,
        approved: bool,
        reason: Option<String>,
    ) -> std::result::Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel::<std::result::Result<(), String>>();

        self.manager_tx
            .send(ManagerCommand::RespondToPermission {
                request_id,
                approved,
                reason,
                response_tx,
            })
            .map_err(|e| format!("Failed to respond to permission: {}", e))?;

        response_rx.await.map_err(|e| format!("Permission response channel closed: {}", e))?
    }

    /// Gracefully shut down the session
    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        self.command_tx
            .send(OpenClawCommand::Shutdown)
            .map_err(|e| format!("Failed to send shutdown: {}", e))?;

        Ok(())
    }
}

/// Parameters for the OpenClaw runtime
struct OpenClawRuntimeParams {
    session_id: String,
    command: String,
    args: Vec<String>,
    working_dir: PathBuf,
    home_dir: Option<String>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    command_tx: mpsc::UnboundedSender<OpenClawCommand>,
    command_rx: mpsc::UnboundedReceiver<OpenClawCommand>,
    manager_tx: mpsc::UnboundedSender<ManagerCommand>,
    manager_rx: mpsc::UnboundedReceiver<ManagerCommand>,
    ready_tx: oneshot::Sender<Result<(), String>>,
}

/// Request ID counter
struct RequestIdCounter(Arc<RwLock<u64>>);

impl RequestIdCounter {
    fn new() -> Self {
        Self(Arc::new(RwLock::new(0)))
    }

    async fn next(&self) -> String {
        let mut counter = self.0.write().await;
        *counter += 1;
        format!("req-{}", *counter)
    }
}

/// Pending permission requests
struct PermissionState {
    pending: Arc<RwLock<HashMap<String, PendingPermission>>>,
}

impl PermissionState {
    fn new() -> Self {
        Self {
            pending: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn add(&self, permission: PendingPermission) {
        let mut pending = self.pending.write().await;
        pending.insert(permission.request_id.clone(), permission);
    }

    async fn remove(&self, request_id: &str) -> Option<PendingPermission> {
        let mut pending = self.pending.write().await;
        pending.remove(request_id)
    }

    async fn get_all(&self) -> Vec<PendingPermission> {
        let pending = self.pending.read().await;
        pending.values().cloned().collect()
    }
}

/// Main runtime loop for OpenClaw Gateway
async fn run_openclaw_runtime(params: OpenClawRuntimeParams) -> Result<()> {
    info!(
        "Starting OpenClaw Gateway session {} with command: {} {:?}",
        params.session_id, params.command, params.args
    );

    // Spawn the OpenClaw Gateway process
    let mut cmd = tokio::process::Command::new(&params.command);
    cmd.args(&params.args)
        .current_dir(&params.working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(ref home) = params.home_dir {
        cmd.env("HOME", home);
    }

    let mut child = cmd.spawn().with_context(|| {
        format!(
            "Failed to spawn OpenClaw Gateway: {} {:?}",
            params.command, params.args
        )
    })?;

    // Get stdout to parse the port
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("Failed to capture stdout"))?;

    // Wait for the gateway to be ready by reading stdout
    let port = wait_for_gateway_ready(stdout).await.unwrap_or(DEFAULT_OPENCLAW_PORT);

    info!("OpenClaw Gateway ready on port {}", port);

    // Connect to the WebSocket
    let url = format!("ws://127.0.0.1:{}", port);
    let (ws_stream, _) = connect_async(&url)
        .await
        .with_context(|| format!("Failed to connect to OpenClaw Gateway at {}", url))?;

    info!("Connected to OpenClaw Gateway WebSocket");

    let (mut write, mut read) = ws_stream.split();

    // Send session started event
    let _ = params.event_sender.send(AgentTurnEvent {
        turn_id: Uuid::new_v4().to_string(),
        event: AgentEvent::SessionStarted {
            session_id: params.session_id.clone(),
            agent: AgentType::OpenClaw,
        },
    });

    // Mark as ready
    let _ = params.ready_tx.send(Ok(()));

    // State
    let request_id_counter = RequestIdCounter::new();
    let permission_state = PermissionState::new();
    let active_turn = Arc::new(RwLock::new(None::<String>));

    // Handle commands and WebSocket messages
    let mut command_rx = params.command_rx;
    let mut manager_rx = params.manager_rx;
    let event_sender = params.event_sender.clone();
    let session_id = params.session_id.clone();

    loop {
        tokio::select! {
            // Handle command requests
            Some(cmd) = command_rx.recv() => {
                match cmd {
                    OpenClawCommand::Prompt { text, response_tx } => {
                        let request_id = request_id_counter.next().await;
                        *active_turn.write().await = Some(request_id.clone());

                        let request = serde_json::json!({
                            "type": "req",
                            "id": request_id,
                            "method": "prompt",
                            "params": {
                                "prompt": text,
                            }
                        });

                        if let Err(e) = write.send(Message::Text(request.to_string().into())).await {
                            let _ = response_tx.send(Err(format!("Failed to send: {}", e)));
                            continue;
                        }

                        // Send turn started event
                        let _ = event_sender.send(AgentTurnEvent {
                            turn_id: request_id.clone(),
                            event: AgentEvent::TurnStarted {
                                session_id: session_id.clone(),
                                turn_id: request_id.clone(),
                            },
                        });

                        let _ = response_tx.send(Ok(()));
                    }
                    OpenClawCommand::Cancel { response_tx } => {
                        let request_id = request_id_counter.next().await;
                        let request = serde_json::json!({
                            "type": "req",
                            "id": request_id,
                            "method": "cancel",
                            "params": {}
                        });

                        if let Err(e) = write.send(Message::Text(request.to_string().into())).await {
                            let _ = response_tx.send(Err(format!("Failed to send: {}", e)));
                            continue;
                        }

                        *active_turn.write().await = None;
                        let _ = response_tx.send(Ok(()));
                    }
                    OpenClawCommand::Shutdown => {
                        info!("Shutting down OpenClaw session: {}", session_id);
                        let _ = event_sender.send(AgentTurnEvent {
                            turn_id: Uuid::new_v4().to_string(),
                            event: AgentEvent::SessionEnded {
                                session_id: session_id.clone(),
                            },
                        });
                        child.kill().await.ok();
                        break;
                    }
                }
            }

            // Handle manager commands
            Some(manager_cmd) = manager_rx.recv() => {
                match manager_cmd {
                    ManagerCommand::GetPendingPermissions { response_tx } => {
                        let perms = permission_state.get_all().await;
                        let _ = response_tx.send(perms);
                    }
                    ManagerCommand::RespondToPermission { request_id, approved, reason, response_tx } => {
                        // Remove from pending
                        permission_state.remove(&request_id).await;

                        let request_id = request_id_counter.next().await;
                        let request = serde_json::json!({
                            "type": "req",
                            "id": request_id,
                            "method": "respond_to_permission",
                            "params": {
                                "request_id": request_id,
                                "approved": approved,
                                "reason": reason,
                            }
                        });

                        if let Err(e) = write.send(Message::Text(request.to_string().into())).await {
                            let _ = response_tx.send(Err(format!("Failed to send: {}", e)));
                            continue;
                        }

                        let _ = response_tx.send(Ok(()));
                    }
                    ManagerCommand::Interrupt { response_tx } => {
                        let request_id = request_id_counter.next().await;
                        let request = serde_json::json!({
                            "type": "req",
                            "id": request_id,
                            "method": "interrupt",
                            "params": {}
                        });

                        if let Err(e) = write.send(Message::Text(request.to_string().into())).await {
                            let _ = response_tx.send(Err(format!("Failed to send: {}", e)));
                            continue;
                        }

                        *active_turn.write().await = None;
                        let _ = response_tx.send(Ok(()));
                    }
                }
            }

            // Handle WebSocket messages
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_ws_message(
                            &text,
                            &event_sender,
                            &permission_state,
                            &session_id,
                            &active_turn,
                        )
                        .await
                        {
                            warn!("Failed to handle WebSocket message: {}", e);
                        }
                    }
                    Some(Ok(Message::Close(_))) => {
                        info!("OpenClaw Gateway closed connection");
                        let _ = event_sender.send(AgentTurnEvent {
                            turn_id: Uuid::new_v4().to_string(),
                            event: AgentEvent::SessionEnded {
                                session_id: session_id.clone(),
                            },
                        });
                        break;
                    }
                    Some(Err(e)) => {
                        error!("WebSocket error: {}", e);
                        break;
                    }
                    None => {
                        info!("WebSocket stream ended");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    // Cleanup
    child.kill().await.ok();

    Ok(())
}

/// Wait for OpenClaw Gateway to be ready by reading stdout
async fn wait_for_gateway_ready(stdout: tokio::process::ChildStdout) -> Result<u16> {
    use tokio::io::AsyncBufReadExt;

    let mut reader = tokio::io::BufReader::new(stdout);
    let mut line = String::new();

    // Wait up to 30 seconds for the gateway to be ready
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    // Look for port in output
                    // OpenClaw typically outputs something like "Gateway listening on port 18789"
                    debug!("OpenClaw stdout: {}", line.trim());
                    if let Some(port) = parse_port_from_output(&line) {
                        return Some(port);
                    }
                }
                Err(_) => break,
            }
        }
        None
    });

    match timeout.await {
        Ok(port) => Ok(port.unwrap_or(DEFAULT_OPENCLAW_PORT)),
        Err(_) => {
            warn!("Timeout waiting for OpenClaw Gateway, using default port");
            Ok(DEFAULT_OPENCLAW_PORT)
        }
    }
}

/// Parse port from OpenClaw Gateway output
fn parse_port_from_output(line: &str) -> Option<u16> {
    // Look for patterns like "port 18789" or "listening on 18789"
    for part in line.split_whitespace() {
        if let Ok(port) = part.parse::<u16>() {
            if port > 1000 {
                return Some(port);
            }
        }
    }
    None
}

/// Handle incoming WebSocket messages from OpenClaw Gateway
async fn handle_ws_message(
    text: &str,
    event_sender: &broadcast::Sender<AgentTurnEvent>,
    permission_state: &PermissionState,
    session_id: &str,
    active_turn: &Arc<RwLock<Option<String>>>,
) -> Result<()> {
    debug!("OpenClaw WS message: {}", text);

    // Parse the message
    let msg: serde_json::Value = serde_json::from_str(text)
        .with_context(|| format!("Failed to parse OpenClaw message: {}", text))?;

    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "res" => {
            // Response to a request
            let id = msg.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let ok = msg.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

            if ok {
                if let Some(payload) = msg.get("payload") {
                    // Check for tool calls in response
                    if let Some(tool_calls) = payload.get("tool_calls").and_then(|v| v.as_array()) {
                        for tool_call in tool_calls {
                            let tool_name = tool_call
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let tool_input = tool_call.get("input").cloned();

                            let _ = event_sender.send(AgentTurnEvent {
                                turn_id: id.to_string(),
                                event: AgentEvent::ToolStarted {
                                    tool_id: Uuid::new_v4().to_string(),
                                    tool_name: tool_name.clone(),
                                    input: tool_input,
                                    session_id: session_id.to_string(),
                                },
                            });
                        }
                    }

                    // Check for content/text in response
                    if let Some(content) = payload.get("content").and_then(|v| v.as_str()) {
                        let _ = event_sender.send(AgentTurnEvent {
                            turn_id: id.to_string(),
                            event: AgentEvent::TextDelta {
                                text: content.to_string(),
                                session_id: session_id.to_string(),
                            },
                        });
                    }
                }

                // Turn completed
                *active_turn.write().await = None;
                let _ = event_sender.send(AgentTurnEvent {
                    turn_id: id.to_string(),
                    event: AgentEvent::TurnCompleted {
                        session_id: session_id.to_string(),
                        result: None,
                    },
                });
            } else {
                // Error response
                let error = msg.get("error").and_then(|v| v.as_str()).unwrap_or("Unknown error");
                let _ = event_sender.send(AgentTurnEvent {
                    turn_id: id.to_string(),
                    event: AgentEvent::TurnError {
                        session_id: session_id.to_string(),
                        error: error.to_string(),
                        code: None,
                    },
                });
            }
        }
        "event" => {
            // Event from the agent
            let event_name = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
            let payload = msg.get("payload");

            match event_name {
                "tool_started" => {
                    let tool_name = payload
                        .and_then(|p| p.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let input = payload.and_then(|p| p.get("input")).cloned();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::ToolStarted {
                            tool_id: Uuid::new_v4().to_string(),
                            tool_name,
                            input,
                            session_id: session_id.to_string(),
                        },
                    });
                }
                "tool_completed" => {
                    let tool_name = payload
                        .and_then(|p| p.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let output = payload
                        .and_then(|p| p.get("output"))
                        .cloned();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::ToolCompleted {
                            tool_id: Uuid::new_v4().to_string(),
                            tool_name: Some(tool_name),
                            output,
                            session_id: session_id.to_string(),
                            error: None,
                        },
                    });
                }
                "text_delta" => {
                    let text = payload
                        .and_then(|p| p.get("text"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::TextDelta {
                            text,
                            session_id: session_id.to_string(),
                        },
                    });
                }
                "permission_request" => {
                    let request_id = payload
                        .and_then(|p| p.get("request_id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let tool_name = payload
                        .and_then(|p| p.get("tool_name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let message = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let permission = PendingPermission {
                        request_id: request_id.clone(),
                        session_id: session_id.to_string(),
                        tool_name,
                        tool_params: serde_json::Value::Null,
                        message,
                        created_at: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs(),
                        response_tx: None,
                    };

                    permission_state.add(permission).await;

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::ApprovalRequest {
                            session_id: session_id.to_string(),
                            request_id,
                            tool_name: "unknown".to_string(),
                            message: None,
                            input: None,
                        },
                    });
                }
                "error" => {
                    let error = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::TurnError {
                            session_id: session_id.to_string(),
                            error,
                            code: None,
                        },
                    });
                }
                _ => {
                    debug!("Unknown OpenClaw event: {}", event_name);
                }
            }
        }
        _ => {
            debug!("Unknown OpenClaw message type: {}", msg_type);
        }
    }

    Ok(())
}
