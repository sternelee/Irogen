use std::str::FromStr;

use anyhow::Result;
use riterm_shared::{
    p2p::{P2PNetwork, SessionHeader, TerminalEvent},
    SessionTicket,
};
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
            // To avoid trace events in the browser from showing their JS backtrace
            MakeConsoleWriter::default().map_trace_level_to(tracing::Level::DEBUG),
        )
        // If we don't do this in the browser, we get a runtime error.
        .without_time()
        .with_ansi(false)
        .init();

    tracing::info!("Riterm WASM module initialized");
}

/// Node for terminal sessions over P2P networking
#[wasm_bindgen]
pub struct RitermNode(P2PNetwork);

#[wasm_bindgen]
impl RitermNode {
    /// Spawns a P2P node.
    pub async fn spawn() -> Result<Self, JsError> {
        let node = P2PNetwork::new(None).await.map_err(to_js_err)?;

        tracing::info!("our node id: {}", node.get_node_id().await);

        Ok(Self(node))
    }

    /// Returns the node id of this node.
    pub async fn node_id(&self) -> String {
        self.0.get_node_id().await
    }

    /// Returns information about all the remote nodes this node knows about.
    pub fn remote_info(&self) -> Vec<JsValue> {
        // This would need to be implemented in the P2PNetwork
        // For now, return empty vector
        Vec::new()
    }

    /// Creates a new terminal session.
    pub async fn create(&self) -> Result<Session, JsError> {
        let header = SessionHeader {
            version: 2,
            width: 80,
            height: 24,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(to_js_err)?
                .as_secs(),
            title: Some("Browser Terminal".to_string()),
            command: None,
            session_id: format!("browser_{}", uuid::Uuid::new_v4()),
        };

        let (topic_id, gossip_sender, input_receiver) = self
            .0
            .create_shared_session(header.clone())
            .await
            .map_err(to_js_err)?;

        // Create session ticket
        let ticket = self
            .0
            .create_session_ticket(topic_id, &header.session_id)
            .await
            .map_err(to_js_err)?;

        Session::new(
            header.session_id,
            ticket,
            gossip_sender,
            Some(input_receiver),
            self.0.clone(),
        )
        .await
    }

    /// Joins a terminal session from a ticket.
    pub async fn join(&self, ticket: String) -> Result<Session, JsError> {
        let ticket = SessionTicket::from_str(&ticket).map_err(to_js_err)?;
        let session_id = format!("joined_{}", ticket.topic_id);

        let (gossip_sender, event_receiver) = self
            .0
            .join_session(ticket.clone())
            .await
            .map_err(to_js_err)?;

        Session::new_joined(
            session_id,
            ticket,
            gossip_sender,
            event_receiver,
            self.0.clone(),
        )
        .await
    }
}

type SessionReceiver = wasm_streams::readable::sys::ReadableStream;

#[wasm_bindgen]
pub struct Session {
    session_id: String,
    ticket: SessionTicket,
    gossip_sender: iroh_gossip::api::GossipSender,
    receiver: Option<SessionReceiver>,
    network: P2PNetwork,
}

impl Session {
    async fn new(
        session_id: String,
        ticket: SessionTicket,
        gossip_sender: iroh_gossip::api::GossipSender,
        input_receiver: Option<tokio::sync::mpsc::UnboundedReceiver<String>>,
        network: P2PNetwork,
    ) -> Result<Self, JsError> {
        let receiver = if let Some(mut input_receiver) = input_receiver {
            Some(
                ReadableStream::from_stream(async_stream::stream! {
                    while let Some(input) = input_receiver.recv().await {
                        tracing::info!("🟢 Received input: {}", input);
                        let bytes = input.as_bytes();
                        let array = js_sys::Uint8Array::from(bytes);
                        yield Ok(array.into());
                    }
                })
                .into_raw(),
            )
        } else {
            None
        };

        Ok(Self {
            session_id,
            ticket,
            gossip_sender,
            receiver,
            network,
        })
    }

    async fn new_joined(
        session_id: String,
        ticket: SessionTicket,
        gossip_sender: iroh_gossip::api::GossipSender,
        mut event_receiver: tokio::sync::broadcast::Receiver<TerminalEvent>,
        network: P2PNetwork,
    ) -> Result<Self, JsError> {
        let receiver = Some(
            ReadableStream::from_stream(async_stream::stream! {
                while let Ok(event) = event_receiver.recv().await {
                    tracing::debug!("Received terminal event: {:?}", event);

                    // Convert terminal event to bytes
                    let event_json = serde_json::to_string(&event).unwrap_or_default();
                    let bytes = event_json.as_bytes();
                    let array = js_sys::Uint8Array::from(bytes);
                    yield Ok(array.into());
                }
            })
            .into_raw(),
        );

        Ok(Self {
            session_id,
            ticket,
            gossip_sender,
            receiver,
            network,
        })
    }
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(getter)]
    pub fn sender(&self) -> SessionSender {
        SessionSender {
            gossip_sender: self.gossip_sender.clone(),
            session_id: self.session_id.clone(),
            network: self.network.clone(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn receiver(&mut self) -> Option<SessionReceiver> {
        self.receiver.take()
    }

    pub fn ticket(&self, _include_self: bool) -> Result<String, JsError> {
        // For now, we'll just return the ticket as-is
        // In a real implementation, you might want to modify it based on include_self
        Ok(self.ticket.to_string())
    }

    pub fn id(&self) -> String {
        self.session_id.clone()
    }

    pub fn encryption_key(&self) -> String {
        hex::encode(self.ticket.key)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct SessionSender {
    gossip_sender: iroh_gossip::api::GossipSender,
    session_id: String,
    network: P2PNetwork,
}

#[wasm_bindgen]
impl SessionSender {
    /// Send terminal output data
    pub async fn send_output(&self, data: String) -> Result<(), JsError> {
        self.network
            .send_terminal_output(
                &self.session_id,
                &self.gossip_sender,
                self.session_id.clone(),
                data,
            )
            .await
            .map_err(to_js_err)?;
        Ok(())
    }

    /// Send input data
    pub async fn send_input(&self, data: String) -> Result<(), JsError> {
        self.network
            .send_input(&self.session_id, &self.gossip_sender, data)
            .await
            .map_err(to_js_err)?;
        Ok(())
    }

    /// Send resize event
    pub async fn resize(&self, width: u16, height: u16) -> Result<(), JsError> {
        self.network
            .send_resize_event(&self.session_id, &self.gossip_sender, width, height)
            .await
            .map_err(to_js_err)?;
        Ok(())
    }

    /// End the session
    pub async fn end_session(&self) -> Result<(), JsError> {
        self.network
            .end_session(&self.session_id, &self.gossip_sender)
            .await
            .map_err(to_js_err)?;
        Ok(())
    }

    /// Send raw bytes (for compatibility with original API)
    pub async fn send(&self, data: Vec<u8>) -> Result<(), JsError> {
        let data_str = String::from_utf8(data).map_err(to_js_err)?;
        self.send_output(data_str).await
    }
}

fn to_js_err(err: impl Into<anyhow::Error>) -> JsError {
    let err: anyhow::Error = err.into();
    JsError::new(&err.to_string())
}
