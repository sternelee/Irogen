use anyhow::Result;
use js_sys::Date;
use n0_future::StreamExt as N0StreamExt;
use serde::{Deserialize, Serialize};
use tracing::level_filters::LevelFilter;
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{JsError, JsValue, prelude::wasm_bindgen};
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

    tracing::info!("RiTerm browser WASM initialized");
}

/// Web Terminal Node for remote terminal sessions
#[wasm_bindgen]
pub struct TerminalNode {
    node_id: String,
}

#[wasm_bindgen]
impl TerminalNode {
    /// Spawns a terminal node for web browser.
    pub async fn spawn() -> Result<Self, JsError> {
        // Generate a node ID for browser client
        let node_id = format!("browser_{}", generate_id());

        tracing::info!("Browser terminal node initialized with node ID: {}", node_id);

        Ok(Self { node_id })
    }

    /// Returns the node id of this browser client.
    pub fn node_id(&self) -> String {
        self.node_id.clone()
    }

    /// Connects to a terminal session using a session ticket
    pub async fn connect_to_session(&self, session_ticket: String) -> Result<TerminalSession, JsError> {
        tracing::info!("Connecting to session with ticket: {}", &session_ticket[..20.min(session_ticket.len())]);

        // For now, create a mock session since iroh integration requires more work
        let session_id = format!("web_session_{}", generate_id());

        // Create message channels for the session
        let (tx, rx) = futures::channel::mpsc::unbounded::<SessionMessage>();

        tracing::info!("Created mock session with ID: {}", session_id);

        // Start message processing loop
        let message_receiver = create_message_stream(rx, &session_id).await;

        let session = TerminalSession {
            session_id: session_id.clone(),
            node_id: self.node_id.clone(),
            receiver: message_receiver,
        };

        // Start background message processing (mock for now)
        start_mock_message_processing(session_id, tx);

        Ok(session)
    }
}

#[wasm_bindgen]
pub struct TerminalSession {
    session_id: String,
    node_id: String,
    receiver: wasm_streams::readable::sys::ReadableStream,
}

#[wasm_bindgen]
impl TerminalSession {
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

    /// Send input to a specific terminal
    pub async fn send_input(&self, terminal_id: String, input: String) -> Result<(), JsError> {
        tracing::info!("Sending input to terminal {}: {}", terminal_id, input);

        // Mock implementation - just log the input
        tracing::info!("Mock: Would send input to terminal {}", terminal_id);
        Ok(())
    }

    /// Create a new terminal
    pub async fn create_terminal(&self, config: JsValue) -> Result<String, JsError> {
        let config: TerminalConfig = serde_wasm_bindgen::from_value(config)
            .map_err(|e| JsError::new(&format!("Invalid config: {}", e)))?;

        let terminal_id = format!("term_{}", generate_id());
        tracing::info!("Creating terminal with ID: {}", terminal_id);

        // Mock implementation - just log the creation
        tracing::info!("Mock: Would create terminal with config: {:?}", config);
        Ok(terminal_id)
    }

    /// Resize a terminal
    pub async fn resize_terminal(&self, terminal_id: String, rows: u16, cols: u16) -> Result<(), JsError> {
        tracing::info!("Resizing terminal {} to {}x{}", terminal_id, rows, cols);

        // Mock implementation - just log the resize
        tracing::info!("Mock: Would resize terminal");
        Ok(())
    }

    /// Close a terminal
    pub async fn close_terminal(&self, terminal_id: String) -> Result<(), JsError> {
        tracing::info!("Closing terminal: {}", terminal_id);

        // Mock implementation - just log the close
        tracing::info!("Mock: Would close terminal");
        Ok(())
    }
}

/// Messages sent within a session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub terminal_id: Option<String>,
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
            // Convert SessionMessage to JsValue
            if let Ok(js_value) = serde_wasm_bindgen::to_value(&message) {
                yield Ok(js_value);
            } else {
                // Fallback to a simple object
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
        // Send a mock welcome message after a short delay
        gloo_timers::future::sleep(std::time::Duration::from_millis(500)).await;

        let welcome_message = SessionMessage {
            message_type: "terminal_output".to_string(),
            terminal_id: None,
            data: "Welcome to RiTerm Browser (Mock Mode - Real iroh integration in progress!)".to_string(),
            timestamp: (Date::now() * 1000.0) as u64,
        };

        let _ = sender.unbounded_send(welcome_message);

        // Send periodic mock terminal output
        let mut counter = 1;
        loop {
            gloo_timers::future::sleep(std::time::Duration::from_secs(3)).await;

            let mock_message = SessionMessage {
                message_type: "terminal_output".to_string(),
                terminal_id: None,
                data: format!("Mock output #{} - Simulated terminal activity", counter),
                timestamp: (Date::now() * 1000.0) as u64,
            };

            if sender.unbounded_send(mock_message).is_err() {
                break; // Channel closed
            }
            counter += 1;
        }
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalConfig {
    pub name: Option<String>,
    pub shell_path: Option<String>,
    pub working_dir: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
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

fn to_js_err(err: impl Into<anyhow::Error>) -> JsError {
    let err: anyhow::Error = err.into();
    JsError::new(&err.to_string())
}

// Macro for creating async streams
#[allow(unused_imports)]
use async_stream::stream;