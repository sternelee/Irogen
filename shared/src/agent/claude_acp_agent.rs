//! Rust implementation of an ACP Agent that backs onto the Claude SDK.
//!
//! This is the in-repo equivalent of @zed-industries/claude-agent-acp: it implements
//! the ACP Agent interface and drives the Claude CLI via the SDK Control Protocol,
//! translating SDK events to ACP session updates and permission requests to the client.

use std::sync::atomic::{AtomicBool, Ordering};

use agent_client_protocol as acp;
use acp::Client;
use async_trait::async_trait;
use tokio::sync::{broadcast, mpsc, oneshot};
use tracing::{info, warn};

use crate::message_protocol::AgentType;

use super::claude_sdk::ClaudeSdkSession;
use super::events::{AgentEvent, AgentTurnEvent};

/// Messages the agent sends to the connection runner (session_notification, request_permission).
pub enum ToConnMessage {
    SessionNotification(acp::SessionNotification),
    RequestPermission(
        acp::RequestPermissionRequest,
        oneshot::Sender<acp::Result<acp::RequestPermissionResponse>>,
    ),
}

/// Per-session state: SDK session and event subscription.
struct SessionState {
    session: std::sync::Arc<ClaudeSdkSession>,
    event_rx: broadcast::Receiver<AgentTurnEvent>,
}

/// ACP Agent that backs onto Claude SDK (one session per process).
pub struct ClaudeAcpAgent {
    to_conn_tx: mpsc::UnboundedSender<ToConnMessage>,
    session_state: tokio::sync::RwLock<Option<SessionState>>,
    cancel_requested: AtomicBool,
}

impl ClaudeAcpAgent {
    pub fn new(to_conn_tx: mpsc::UnboundedSender<ToConnMessage>) -> Self {
        Self {
            to_conn_tx,
            session_state: tokio::sync::RwLock::new(None),
            cancel_requested: AtomicBool::new(false),
        }
    }

    async fn request_permission(
        &self,
        req: acp::RequestPermissionRequest,
    ) -> acp::Result<acp::RequestPermissionResponse> {
        let (tx, rx) = oneshot::channel();
        self.to_conn_tx
            .send(ToConnMessage::RequestPermission(req, tx))
            .map_err(|_| acp::Error::internal_error().data("agent channel closed"))?;
        rx.await.map_err(|_| acp::Error::internal_error().data("permission response channel closed"))?
    }

    fn prompt_text_from_blocks(prompt: &[acp::ContentBlock]) -> String {
        let mut text = String::new();
        for block in prompt {
            if let acp::ContentBlock::Text(t) = block {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(&t.text);
            }
        }
        if text.is_empty() {
            text.push_str("(no text content)");
        }
        text
    }
}

#[async_trait(?Send)]
impl acp::Agent for ClaudeAcpAgent {
    async fn initialize(&self, args: acp::InitializeRequest) -> acp::Result<acp::InitializeResponse> {
        info!("[ClaudeAcp] initialize request");
        Ok(acp::InitializeResponse::new(args.protocol_version)
            .agent_info(
                acp::Implementation::new("clawdchat-claude-acp", env!("CARGO_PKG_VERSION"))
                    .title("Claude (ACP)"),
            ))
    }

    async fn authenticate(&self, _args: acp::AuthenticateRequest) -> acp::Result<acp::AuthenticateResponse> {
        Ok(acp::AuthenticateResponse::default())
    }

    async fn new_session(&self, args: acp::NewSessionRequest) -> acp::Result<acp::NewSessionResponse> {
        let cwd = args.cwd.clone();
        info!("[ClaudeAcp] new_session cwd={}", cwd.display());

        let session_id = uuid::Uuid::new_v4().to_string();
        let acp_session_id = acp::SessionId::new(session_id.clone());

        let session = ClaudeSdkSession::spawn(
            session_id,
            AgentType::ClaudeCode,
            "claude".to_string(),
            vec![],
            cwd,
            None,
        )
        .await
        .map_err(|e| acp::Error::internal_error().data(format!("Failed to spawn Claude SDK: {e}")))?;

        let event_rx = session.subscribe();
        let mut state = self.session_state.write().await;
        *state = Some(SessionState {
            session: std::sync::Arc::new(session),
            event_rx,
        });

        Ok(acp::NewSessionResponse::new(acp_session_id))
    }

    async fn prompt(&self, args: acp::PromptRequest) -> acp::Result<acp::PromptResponse> {
        self.cancel_requested.store(false, Ordering::SeqCst);
        let session_id = args.session_id.clone();
        let text = Self::prompt_text_from_blocks(&args.prompt);
        let turn_id = uuid::Uuid::new_v4().to_string();

        let state_guard = self.session_state.read().await;
        let Some(ref state) = *state_guard else {
            return Err(acp::Error::invalid_params().data("No session; call new_session first"));
        };
        let session = state.session.clone();
        let mut event_rx = state.event_rx.resubscribe();
        drop(state_guard);

        let send_fut = session.send_message(text, &turn_id);
        tokio::pin!(send_fut);
        let to_conn_tx = self.to_conn_tx.clone();
        let mut stop_reason = acp::StopReason::EndTurn;

        loop {
            tokio::select! {
                result = &mut send_fut => {
                    if let Err(e) = result {
                        warn!("[ClaudeAcp] send_message failed: {}", e);
                        stop_reason = acp::StopReason::Refusal;
                    }
                    break;
                }
                ev = event_rx.recv() => {
                    let Ok(ev) = ev else { break };
                    if self.cancel_requested.load(Ordering::SeqCst) {
                        stop_reason = acp::StopReason::Cancelled;
                        break;
                    }
                    let sid = session_id.clone();
                    match ev.event {
                        AgentEvent::TextDelta { text: t, .. } => {
                            let chunk = acp::ContentChunk::new(acp::ContentBlock::from(t));
                            to_conn_tx.send(ToConnMessage::SessionNotification(
                                acp::SessionNotification::new(sid, acp::SessionUpdate::AgentMessageChunk(chunk)),
                            )).ok();
                        }
                        AgentEvent::ReasoningDelta { text: t, .. } => {
                            let chunk = acp::ContentChunk::new(acp::ContentBlock::from(t));
                            to_conn_tx.send(ToConnMessage::SessionNotification(
                                acp::SessionNotification::new(sid, acp::SessionUpdate::AgentThoughtChunk(chunk)),
                            )).ok();
                        }
                        AgentEvent::ToolStarted { tool_id, tool_name, input, .. } => {
                            let tool_call = acp::ToolCall::new(tool_id.clone(), tool_name.clone())
                                .status(acp::ToolCallStatus::InProgress)
                                .raw_input(input);
                            to_conn_tx.send(ToConnMessage::SessionNotification(
                                acp::SessionNotification::new(sid, acp::SessionUpdate::ToolCall(tool_call)),
                            )).ok();
                        }
                        AgentEvent::ToolInputUpdated { tool_id, tool_name, input, .. } => {
                            let fields = acp::ToolCallUpdateFields::new()
                                .title(tool_name.clone().unwrap_or_else(|| tool_id.clone()))
                                .raw_input(input)
                                .status(acp::ToolCallStatus::InProgress);
                            to_conn_tx.send(ToConnMessage::SessionNotification(
                                acp::SessionNotification::new(sid, acp::SessionUpdate::ToolCallUpdate(
                                    acp::ToolCallUpdate::new(tool_id, fields),
                                )),
                            )).ok();
                        }
                        AgentEvent::ToolCompleted { tool_id, tool_name, output, error, .. } => {
                            let status = if error.is_some() {
                                acp::ToolCallStatus::Failed
                            } else {
                                acp::ToolCallStatus::Completed
                            };
                            let raw_output: Option<serde_json::Value> = error
                                .map(serde_json::Value::String)
                                .or(output);
                            let fields = acp::ToolCallUpdateFields::new()
                                .title(tool_name.clone().unwrap_or_else(|| tool_id.clone()))
                                .status(status)
                                .raw_output(raw_output);
                            to_conn_tx.send(ToConnMessage::SessionNotification(
                                acp::SessionNotification::new(sid, acp::SessionUpdate::ToolCallUpdate(
                                    acp::ToolCallUpdate::new(tool_id, fields),
                                )),
                            )).ok();
                        }
                        AgentEvent::ApprovalRequest {
                            request_id,
                            tool_name,
                            input,
                            ..
                        } => {
                            let options = vec![
                                acp::PermissionOption::new("allow", "Allow", acp::PermissionOptionKind::AllowOnce),
                                acp::PermissionOption::new("allow_always", "Always Allow", acp::PermissionOptionKind::AllowAlways),
                                acp::PermissionOption::new("reject", "Reject", acp::PermissionOptionKind::RejectOnce),
                            ];
                            let tool_call = acp::ToolCallUpdate::new(
                                request_id.clone(),
                                acp::ToolCallUpdateFields::new()
                                    .title(tool_name.clone())
                                    .raw_input(input),
                            );
                            let req = acp::RequestPermissionRequest::new(session_id.clone(), tool_call, options);
                            let response = self.request_permission(req).await?;
                            let approved = matches!(
                                response.outcome,
                                acp::RequestPermissionOutcome::Selected(ref s)
                                    if s.option_id.0.as_ref() == "allow" || s.option_id.0.as_ref() == "allow_always"
                            );
                            let _ = session.respond_to_permission(request_id, approved, None).await;
                        }
                        AgentEvent::TurnCompleted { .. } => {
                            stop_reason = acp::StopReason::EndTurn;
                            break;
                        }
                        AgentEvent::TurnError { code, .. } => {
                            stop_reason = if code.as_deref() == Some("error_max_turns") {
                                acp::StopReason::MaxTurnRequests
                            } else {
                                acp::StopReason::Refusal
                            };
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        Ok(acp::PromptResponse::new(stop_reason))
    }

    async fn cancel(&self, _args: acp::CancelNotification) -> acp::Result<()> {
        self.cancel_requested.store(true, Ordering::SeqCst);
        let state = self.session_state.read().await;
        if let Some(ref s) = *state {
            let _ = s.session.interrupt().await;
        }
        Ok(())
    }
}

/// Run the Claude ACP agent over the given async stdin/stdout.
///
/// Must be run inside a `tokio::task::LocalSet` (e.g. `current_thread` runtime + `LocalSet`),
/// since the ACP crate uses `!Send` futures. The agent speaks ACP JSON-RPC on the given streams.
pub async fn run_claude_acp_agent(
    incoming: impl tokio::io::AsyncRead + Unpin,
    outgoing: impl tokio::io::AsyncWrite + Unpin,
    spawn: impl Fn(futures::future::LocalBoxFuture<'static, ()>) + 'static,
) -> anyhow::Result<()> {
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    let (to_conn_tx, mut to_conn_rx) = mpsc::unbounded_channel::<ToConnMessage>();
    let agent = ClaudeAcpAgent::new(to_conn_tx.clone());

    let (conn, io_task) = acp::AgentSideConnection::new(
        agent,
        outgoing.compat_write(),
        incoming.compat(),
        spawn,
    );

    let conn = std::sync::Arc::new(conn);
    let conn_recv = conn.clone();
    let recv_fut = async move {
        while let Some(msg) = to_conn_rx.recv().await {
            match msg {
                ToConnMessage::SessionNotification(n) => {
                    if let Err(e) = conn_recv.session_notification(n).await {
                        warn!("[ClaudeAcp] session_notification failed: {:?}", e);
                    }
                }
                ToConnMessage::RequestPermission(req, tx) => {
                    let r = conn_recv.request_permission(req).await;
                    let _ = tx.send(r);
                }
            }
        }
    };

    tokio::select! {
        res = io_task => res.map_err(|e| anyhow::anyhow!("ACP I/O task failed: {:?}", e)),
        _ = recv_fut => Ok(()),
    }
}
