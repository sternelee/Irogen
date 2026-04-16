//! Irogen Browser WASM Client
//!
//! WebAssembly client for connecting to Irogen agent sessions from the browser.
//! Uses iroh for P2P connectivity over QUIC.

use anyhow::Result;
use js_sys::Date;
use n0_future::StreamExt as N0StreamExt;
use serde::{Deserialize, Serialize};
use tracing::level_filters::LevelFilter;
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};
use wasm_bindgen_futures::spawn_local;
use wasm_streams::ReadableStream;

// ============================================================================
// ID Generation
// ============================================================================

/// Generate a unique ID using timestamp and random suffix
fn generate_id() -> String {
    let timestamp = Date::now();
    let random = (timestamp * 1000.0) as u64;
    format!("id_{:x}", random)
}

// ============================================================================
// Initialization
// ============================================================================

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();

    tracing_subscriber::fmt()
        .with_max_level(LevelFilter::DEBUG)
        .with_writer(
            // To avoid trace events in the browser from showing their JS backtrace
            MakeConsoleWriter::default().map_trace_level_to(tracing::Level::DEBUG),
        )
        // If we don't do this in the browser, we get a runtime error.
        .without_time()
        .with_ansi(false)
        .init();

    tracing::info!("Irogen browser WASM initialized");
}

// ============================================================================
// Agent Event Types (adapted from shared/src/agent/events.rs)
// ============================================================================

/// Notification severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NotificationLevel {
    Info,
    Warning,
    Error,
    Success,
}

/// File operation types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileOperationType {
    Read,
    Write,
    Create,
    Delete,
    Move,
    Copy,
}

/// Agent type identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentType {
    ClaudeCode,
    OpenCode,
    Codex,
    Gemini,
    OpenClaw,
}

/// Unified agent event for browser client
///
/// This mirrors the AgentEvent from shared/src/agent/events.rs
/// but excludes TCP-related events which are not needed for web.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentEvent {
    /// Session/conversation started
    #[serde(rename = "session:started")]
    SessionStarted {
        session_id: String,
        agent: AgentType,
    },

    /// Turn/response started
    #[serde(rename = "turn:started")]
    TurnStarted { session_id: String, turn_id: String },

    /// Text content delta (streaming)
    #[serde(rename = "text:delta")]
    TextDelta { session_id: String, text: String },

    /// Reasoning/thinking content (for models that expose it)
    #[serde(rename = "reasoning:delta")]
    ReasoningDelta { session_id: String, text: String },

    /// Tool use started
    #[serde(rename = "tool:started")]
    ToolStarted {
        session_id: String,
        tool_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<serde_json::Value>,
    },

    /// Tool use completed
    #[serde(rename = "tool:completed")]
    ToolCompleted {
        session_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// Tool input updated (streaming arguments)
    #[serde(rename = "tool:inputUpdated")]
    ToolInputUpdated {
        session_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<serde_json::Value>,
    },

    /// Approval request from agent
    #[serde(rename = "approval:request")]
    ApprovalRequest {
        session_id: String,
        request_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    /// Turn/response completed
    #[serde(rename = "turn:completed")]
    TurnCompleted {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
    },

    /// Turn/response error
    #[serde(rename = "turn:error")]
    TurnError {
        session_id: String,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },

    /// Session ended
    #[serde(rename = "session:ended")]
    SessionEnded { session_id: String },

    /// Usage/token information
    #[serde(rename = "usage:update")]
    UsageUpdate {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cached_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model_context_window: Option<i64>,
    },

    /// Progress update for long-running operations
    #[serde(rename = "progress:update")]
    ProgressUpdate {
        session_id: String,
        operation: String,
        progress: f32, // 0.0 to 1.0
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    /// General notification with severity level
    #[serde(rename = "notification")]
    Notification {
        session_id: String,
        level: NotificationLevel,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        details: Option<serde_json::Value>,
    },

    /// File operation notification
    #[serde(rename = "file:operation")]
    FileOperation {
        session_id: String,
        operation: FileOperationType,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<String>,
    },

    /// Terminal output from shell operations
    #[serde(rename = "terminal:output")]
    TerminalOutput {
        session_id: String,
        command: String,
        output: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },

    /// Raw agent-specific event (passthrough)
    #[serde(rename = "raw")]
    Raw {
        session_id: String,
        agent: AgentType,
        data: serde_json::Value,
    },
}

impl AgentEvent {
    /// Get the session ID for this event
    pub fn session_id(&self) -> &str {
        match self {
            AgentEvent::SessionStarted { session_id, .. } => session_id,
            AgentEvent::TurnStarted { session_id, .. } => session_id,
            AgentEvent::TextDelta { session_id, .. } => session_id,
            AgentEvent::ReasoningDelta { session_id, .. } => session_id,
            AgentEvent::ToolStarted { session_id, .. } => session_id,
            AgentEvent::ToolCompleted { session_id, .. } => session_id,
            AgentEvent::ToolInputUpdated { session_id, .. } => session_id,
            AgentEvent::ApprovalRequest { session_id, .. } => session_id,
            AgentEvent::TurnCompleted { session_id, .. } => session_id,
            AgentEvent::TurnError { session_id, .. } => session_id,
            AgentEvent::SessionEnded { session_id } => session_id,
            AgentEvent::UsageUpdate { session_id, .. } => session_id,
            AgentEvent::ProgressUpdate { session_id, .. } => session_id,
            AgentEvent::Notification { session_id, .. } => session_id,
            AgentEvent::FileOperation { session_id, .. } => session_id,
            AgentEvent::TerminalOutput { session_id, .. } => session_id,
            AgentEvent::Raw { session_id, .. } => session_id,
        }
    }

    /// Check if this is a terminal event (turn completed or error)
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            AgentEvent::TurnCompleted { .. } | AgentEvent::TurnError { .. }
        )
    }

    /// Check if this event requires user action
    pub fn requires_action(&self) -> bool {
        matches!(self, AgentEvent::ApprovalRequest { .. })
    }

    /// Get the turn ID if this is a turn-scoped event
    pub fn turn_id(&self) -> Option<&str> {
        match self {
            AgentEvent::TurnStarted { turn_id, .. } => Some(turn_id),
            _ => None,
        }
    }
}

// ============================================================================
// Permission Response
// ============================================================================

/// Permission response from browser client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub request_id: String,
    pub approved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

// ============================================================================
// Agent Node (Browser Client)
// ============================================================================

/// Web Agent Node for remote agent sessions
#[wasm_bindgen]
pub struct AgentNode {
    node_id: String,
}

#[wasm_bindgen]
impl AgentNode {
    /// Spawns an agent node for web browser.
    pub async fn spawn() -> Result<Self, JsError> {
        let node_id = format!("browser_{}", generate_id());

        tracing::info!("Browser agent node initialized with node ID: {}", node_id);

        Ok(Self { node_id })
    }

    /// Returns the node id of this browser client.
    pub fn node_id(&self) -> String {
        self.node_id.clone()
    }

    /// Connects to an agent session using a session ticket
    pub async fn connect_to_session(
        &self,
        session_ticket: String,
    ) -> Result<AgentSession, JsError> {
        tracing::info!(
            "Connecting to session with ticket: {}",
            &session_ticket[..20.min(session_ticket.len())]
        );

        let session_id = format!("web_session_{}", generate_id());

        let (tx, rx) = futures::channel::mpsc::unbounded::<AgentEvent>();

        tracing::info!("Created session with ID: {}", session_id);

        let message_receiver = create_event_stream(rx, &session_id).await;

        let session = AgentSession {
            session_id: session_id.clone(),
            node_id: self.node_id.clone(),
            receiver: message_receiver,
            event_sender: tx,
        };

        // Start mock event processing for demonstration
        start_mock_event_processing(session_id, session.event_sender.clone());

        Ok(session)
    }
}

// ============================================================================
// Agent Session
// ============================================================================

#[wasm_bindgen]
pub struct AgentSession {
    session_id: String,
    node_id: String,
    receiver: wasm_streams::readable::sys::ReadableStream,
    event_sender: futures::channel::mpsc::UnboundedSender<AgentEvent>,
}

#[wasm_bindgen]
impl AgentSession {
    #[wasm_bindgen(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn node_id(&self) -> String {
        self.node_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn receiver(&mut self) -> wasm_streams::readable::sys::ReadableStream {
        self.receiver.clone()
    }

    /// Send a message to the agent session
    pub async fn send_message(&self, content: String) -> Result<(), JsError> {
        tracing::info!(
            "Sending message to session {}: {}",
            self.session_id,
            content
        );
        Ok(())
    }

    /// Respond to a permission request
    pub async fn respond_to_permission(
        &self,
        request_id: String,
        approved: bool,
        reason: Option<String>,
    ) -> Result<(), JsError> {
        tracing::info!(
            "Responding to permission request {}: approved={}",
            request_id,
            approved
        );

        let _response = PermissionResponse {
            request_id,
            approved,
            reason,
        };

        // In a real implementation, this would send the response to the agent
        // via the P2P connection

        Ok(())
    }

    /// Interrupt the current turn
    pub async fn interrupt(&self) -> Result<(), JsError> {
        tracing::info!("Interrupting session {}", self.session_id);
        Ok(())
    }

    /// Close the session
    pub async fn close(&self) -> Result<(), JsError> {
        tracing::info!("Closing session {}", self.session_id);

        // Send session ended event
        let event = AgentEvent::SessionEnded {
            session_id: self.session_id.clone(),
        };
        let _ = self.event_sender.unbounded_send(event);

        Ok(())
    }
}

// ============================================================================
// Event Stream Creation
// ============================================================================

/// Create a readable stream from an event channel
async fn create_event_stream(
    mut receiver: futures::channel::mpsc::UnboundedReceiver<AgentEvent>,
    _session_id: &str,
) -> wasm_streams::readable::sys::ReadableStream {
    let stream = async_stream::stream! {
        while let Some(event) = N0StreamExt::next(&mut receiver).await {
            if let Ok(js_value) = serde_wasm_bindgen::to_value(&event) {
                yield Ok(js_value);
            } else {
                // Fallback: serialize as JSON string
                if let Ok(json) = serde_json::to_string(&event) {
                    yield Ok(JsValue::from_str(&json));
                }
            }
        }
    };

    ReadableStream::from_stream(stream).into_raw()
}

// ============================================================================
// Mock Event Processing (for development/testing)
// ============================================================================

/// Start mock event processing for a session
fn start_mock_event_processing(
    session_id: String,
    sender: futures::channel::mpsc::UnboundedSender<AgentEvent>,
) {
    spawn_local(async move {
        // Session started
        let session_started = AgentEvent::SessionStarted {
            session_id: session_id.clone(),
            agent: AgentType::ClaudeCode,
        };
        let _ = sender.unbounded_send(session_started);

        gloo_timers::future::sleep(std::time::Duration::from_millis(500)).await;

        // Turn started
        let turn_id = format!("turn_{}", generate_id());
        let turn_started = AgentEvent::TurnStarted {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
        };
        let _ = sender.unbounded_send(turn_started);

        gloo_timers::future::sleep(std::time::Duration::from_millis(300)).await;

        // Text delta (streaming)
        let text_delta = AgentEvent::TextDelta {
            session_id: session_id.clone(),
            text: "Welcome to Irogen Browser! (Mock Mode - Real integration in progress!)"
                .to_string(),
        };
        let _ = sender.unbounded_send(text_delta);

        gloo_timers::future::sleep(std::time::Duration::from_millis(500)).await;

        // Turn completed
        let turn_completed = AgentEvent::TurnCompleted {
            session_id: session_id.clone(),
            result: None,
        };
        let _ = sender.unbounded_send(turn_completed);

        // Usage update
        let usage = AgentEvent::UsageUpdate {
            session_id: session_id.clone(),
            input_tokens: Some(10),
            output_tokens: Some(20),
            cached_tokens: None,
            model_context_window: Some(200000),
        };
        let _ = sender.unbounded_send(usage);

        tracing::info!("Mock event processing completed for session {}", session_id);
    });
}

// ============================================================================
// Utility Functions
// ============================================================================

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[allow(dead_code)]
fn to_js_err(err: impl Into<anyhow::Error>) -> JsError {
    let err: anyhow::Error = err.into();
    JsError::new(&err.to_string())
}

#[allow(unused_imports)]
use async_stream::stream;
