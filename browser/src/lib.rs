use std::sync::Arc;

use anyhow::Result;
use riterm_shared::CommunicationManager;
use serde::{Deserialize, Serialize};
use tracing::level_filters::LevelFilter;
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};
use wasm_streams::ReadableStream;

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();

    tracing_subscriber::fmt()
        .with_max_level(LevelFilter::DEBUG)
        .with_writer(
            // To avoide trace events in the browser from showing their JS backtrace
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
    communication_manager: Arc<CommunicationManager>,
    node_id: String,
}

#[wasm_bindgen]
impl TerminalNode {
    /// Spawns a terminal node for web browser.
    pub async fn spawn() -> Result<Self, JsError> {
        let communication_manager = Arc::new(CommunicationManager::new("riterm_browser".to_string()));
        communication_manager
            .initialize()
            .await
            .map_err(to_js_err)?;

        // Generate a node ID for browser client
        let node_id = format!("browser_{}", uuid::Uuid::new_v4());

        Ok(Self {
            communication_manager,
            node_id,
        })
    }

    /// Returns the node id of this browser client.
    pub fn node_id(&self) -> String {
        self.node_id.clone()
    }

    /// Creates a new terminal session
    pub async fn create_session(&self, session_ticket: String) -> Result<TerminalSession, JsError> {
        // Parse session ticket (this would need to be implemented based on your ticket format)
        let session_id = format!("web_session_{}", uuid::Uuid::new_v4());

        // Create a simple stream for now (placeholder implementation)
        let empty_stream = futures::stream::iter(vec![Ok::<JsValue, JsValue>(
            serde_wasm_bindgen::to_value(&TerminalMessage {
                type_: "info",
                terminal_id: "browser".to_string(),
                data: format!("Created session {} with ticket: {}", session_id, session_ticket),
            }).unwrap_or(JsValue::NULL)
        )]);

        let session = TerminalSession {
            session_id: session_id.clone(),
            node_id: self.node_id.clone(),
            message_receiver: ReadableStream::from_stream(empty_stream).into_raw(),
        };

        Ok(session)
    }

    /// Connects to an existing terminal session using a session ticket
    pub async fn connect_to_session(&self, session_ticket: String) -> Result<TerminalSession, JsError> {
        // Implementation similar to create_session but with existing ticket
        self.create_session(session_ticket).await
    }
}

#[wasm_bindgen]
pub struct TerminalSession {
    session_id: String,
    node_id: String,
    message_receiver: wasm_streams::readable::sys::ReadableStream,
}

#[wasm_bindgen]
impl TerminalSession {
    #[wasm_bindgen(getter)]
    pub fn session_id(&self) -> String {
        self.session_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn receiver(&mut self) -> wasm_streams::readable::sys::ReadableStream {
        self.message_receiver.clone()
    }

    /// Send input to a specific terminal
    pub async fn send_input(&self, terminal_id: String, input: String) -> Result<(), JsError> {
        // Create and send input message (placeholder implementation)
        tracing::info!("Sending input to terminal {}: {}", terminal_id, input);

        // In a real implementation, this would send the message via the communication manager
        Ok(())
    }

    /// Create a new terminal
    pub async fn create_terminal(&self, config: JsValue) -> Result<String, JsError> {
        let _config: TerminalConfig = serde_wasm_bindgen::from_value(config)
            .map_err(|e| JsError::new(&format!("Invalid config: {}", e)))?;

        let terminal_id = format!("term_{}", uuid::Uuid::new_v4());
        tracing::info!("Creating terminal with ID: {}", terminal_id);

        // In a real implementation, this would send a terminal creation message
        Ok(terminal_id)
    }

    /// Resize a terminal
    pub async fn resize_terminal(&self, terminal_id: String, rows: u16, cols: u16) -> Result<(), JsError> {
        tracing::info!("Resizing terminal {} to {}x{}", terminal_id, rows, cols);
        // Send resize message (placeholder implementation)
        Ok(())
    }

    /// Close a terminal
    pub async fn close_terminal(&self, terminal_id: String) -> Result<(), JsError> {
        tracing::info!("Closing terminal: {}", terminal_id);
        // Send close message (placeholder implementation)
        Ok(())
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalMessage {
    #[serde(rename = "type")]
    pub type_: &'static str,
    pub terminal_id: String,
    pub data: String,
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