use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use iroh::{Endpoint, NodeAddr, SecretKey};
use iroh_tickets::Ticket;
use n0_future::{StreamExt, boxed::BoxStream};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex as TokioMutex;
use tracing::{debug, info, warn};
use uuid;

use super::SerializableEndpointAddr;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TerminalTicket {
    pub node_addr: NodeAddr,
}

impl TerminalTicket {
    pub fn new(node_addr: NodeAddr) -> Self {
        Self { node_addr }
    }

    pub fn deserialize(input: &str) -> Result<Self> {
        <Self as Ticket>::deserialize(input).map_err(Into::into)
    }

    pub fn serialize(&self) -> String {
        <Self as Ticket>::serialize(self)
    }
}

impl Ticket for TerminalTicket {
    const KIND: &'static str = "terminal";

    fn to_bytes(&self) -> Vec<u8> {
        postcard::to_stdvec(&self).unwrap()
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self, iroh_tickets::ParseError> {
        let ticket = postcard::from_bytes(bytes)?;
        Ok(ticket)
    }
}

pub struct TerminalNode {
    secret_key: SecretKey,
    endpoint: Arc<Endpoint>,
}

impl TerminalNode {
    pub async fn spawn() -> Result<Self> {
        let secret_key = SecretKey::generate(&mut rand::rng());

        let endpoint = iroh::Endpoint::builder()
            .secret_key(secret_key.clone())
            .alpns(vec![b"riterm".to_vec()])
            .discovery(iroh::discovery::dns::DnsDiscovery::n0_dns())
            .bind()
            .await?;

        let endpoint_id = endpoint.id();
        info!("Terminal endpoint bound with id: {endpoint_id:?}");

        Ok(Self {
            secret_key,
            endpoint: Arc::new(endpoint),
        })
    }

    pub async fn connect(
        &self,
        ticket: &TerminalTicket,
    ) -> Result<(TerminalSender, BoxStream<Result<TerminalEvent>>)> {
        info!(
            "Connecting to terminal host at: {:?}",
            ticket.node_addr.node_id
        );

        let connection = self
            .endpoint
            .connect(ticket.node_addr.clone(), b"riterm")
            .await?;

        info!("Connected to terminal host");

        let sender = TerminalSender {
            connection: connection.clone(),
            terminal_id: None,
        };

        // Create a stream of events by listening for incoming data
        let receiver = n0_future::stream::try_unfold(connection, move |mut connection| {
            async move {
                match connection.accept_bi().await {
                    Ok((_send_stream, recv_stream)) => {
                        match recv_stream.read_to_end(usize::MAX).await {
                            Ok(data) => {
                                if let Ok(message_str) = String::from_utf8(data) {
                                    let event = TerminalEvent::Output {
                                        terminal_id: None,
                                        data: message_str,
                                        timestamp: std::time::SystemTime::now(),
                                    };
                                    Ok(Some((event, connection)))
                                } else {
                                    // Non-UTF8 data
                                    let event = TerminalEvent::Error {
                                        message: "Received non-UTF8 data".to_string(),
                                    };
                                    Ok(Some((event, connection)))
                                }
                            }
                            Err(e) => {
                                warn!("Error reading from stream: {}", e);
                                Ok(None)
                            }
                        }
                    }
                    Err(e) => {
                        debug!("Connection closed: {}", e);
                        Ok(None)
                    }
                }
            }
        });

        Ok((sender, Box::pin(receiver)))
    }

    pub fn node_addr(&self) -> NodeAddr {
        // In iroh 0.95, we need to create NodeAddr from endpoint
        let node_id = self.endpoint.node_id();
        // Note: This is a simplified approach - real implementation would need proper ALPN and relay info
        NodeAddr::new(node_id)
    }

    pub async fn shutdown(&self) {
        info!("Shutting down terminal node");
        self.endpoint.close().await;
    }
}

#[derive(Debug, Clone)]
pub struct TerminalSender {
    connection: iroh::endpoint::Connection,
    terminal_id: Option<String>,
}

impl TerminalSender {
    pub async fn send_input(&self, terminal_id: String, input: String) -> Result<()> {
        let message = format!("INPUT:{}:{}", terminal_id, input);
        self.send_message(message).await
    }

    pub async fn create_terminal(&self, config: TerminalConfig) -> Result<String> {
        let terminal_id = format!("term_{}", uuid::Uuid::new_v4());
        let config_json = serde_json::to_string(&config)?;
        let message = format!("CREATE:{}:{}", terminal_id, config_json);
        self.send_message(message).await?;
        Ok(terminal_id)
    }

    pub async fn resize_terminal(&self, terminal_id: String, rows: u16, cols: u16) -> Result<()> {
        let message = format!("RESIZE:{}:{}x{}", terminal_id, rows, cols);
        self.send_message(message).await
    }

    pub async fn close_terminal(&self, terminal_id: String) -> Result<()> {
        let message = format!("CLOSE:{}", terminal_id);
        self.send_message(message).await
    }

    async fn send_message(&self, message: String) -> Result<()> {
        let (mut send_stream, _recv_stream) = self.connection.open_bi().await?;
        send_stream.write_all(message.as_bytes()).await?;
        send_stream.finish().await?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    #[serde(rename_all = "camelCase")]
    Output {
        terminal_id: Option<String>,
        data: String,
        timestamp: std::time::SystemTime,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        message: String,
    },
    Connected {
        terminal_id: String,
    },
    Disconnected {
        terminal_id: String,
    },
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

