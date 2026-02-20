use anyhow::Result;
use js_sys::Date;
use n0_future::StreamExt as N0StreamExt;
use serde::{Deserialize, Serialize};
use tracing::level_filters::LevelFilter;
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};
use wasm_bindgen_futures::spawn_local;
use wasm_streams::ReadableStream;

// Simple ID generator using timestamp and random number
fn generate_id() -> String {
    let timestamp = Date::now();
    let random = (timestamp * 1000.0) as u64;
    format!("id_{:x}", random)
}

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

    tracing::info!("ClawdChat browser WASM initialized");
}

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

        let (tx, rx) = futures::channel::mpsc::unbounded::<SessionMessage>();

        tracing::info!("Created session with ID: {}", session_id);

        let message_receiver = create_message_stream(rx, &session_id).await;

        let session = AgentSession {
            session_id: session_id.clone(),
            node_id: self.node_id.clone(),
            receiver: message_receiver,
        };

        start_mock_message_processing(session_id, tx);

        Ok(session)
    }
}

#[wasm_bindgen]
pub struct AgentSession {
    session_id: String,
    node_id: String,
    receiver: wasm_streams::readable::sys::ReadableStream,
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
}

/// Messages sent within a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub session_id: Option<String>,
    pub data: String,
    pub timestamp: u64,
}

/// Create a readable stream from a message channel
async fn create_message_stream(
    mut receiver: futures::channel::mpsc::UnboundedReceiver<SessionMessage>,
    _session_id: &str,
) -> wasm_streams::readable::sys::ReadableStream {
    let stream = async_stream::stream! {
        while let Some(message) = N0StreamExt::next(&mut receiver).await {
            if let Ok(js_value) = serde_wasm_bindgen::to_value(&message) {
                yield Ok(js_value);
            } else {
                yield Ok(JsValue::from_str(&format!(
                    "{{\"type\":\"{}\",\"data\":\"{}\",\"timestamp\":{}}}",
                    message.message_type,
                    message.data,
                    message.timestamp
                )));
            }
        }
    };

    ReadableStream::from_stream(stream).into_raw()
}

/// Start mock message processing for a session
fn start_mock_message_processing(
    _session_id: String,
    sender: futures::channel::mpsc::UnboundedSender<SessionMessage>,
) {
    spawn_local(async move {
        gloo_timers::future::sleep(std::time::Duration::from_millis(500)).await;

        let welcome_message = SessionMessage {
            message_type: "agent_message".to_string(),
            session_id: None,
            data: "Welcome to ClawdChat Browser (Mock Mode - Real integration in progress!)"
                .to_string(),
            timestamp: (Date::now() * 1000.0) as u64,
        };

        let _ = sender.unbounded_send(welcome_message);
    });
}

/// Utility functions
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
