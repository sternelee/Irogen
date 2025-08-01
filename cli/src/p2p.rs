use anyhow::Result;
use iroh::{NodeAddr, NodeId};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{debug, error, info, warn};

use crate::terminal::{SessionHeader, TerminalEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ShareMessage {
    SessionStart {
        session_id: String,
        header: SessionHeader,
    },
    SessionData {
        session_id: String,
        event: TerminalEvent,
    },
    SessionEnd {
        session_id: String,
    },
    JoinRequest {
        session_id: String,
        node_id: String,
    },
    JoinResponse {
        session_id: String,
        accepted: bool,
        reason: Option<String>,
    },
    InputData {
        session_id: String,
        data: String,
    },
}

#[derive(Debug)]
pub struct SharedSession {
    pub header: SessionHeader,
    pub participants: Vec<String>,
    pub is_host: bool,
    pub event_sender: broadcast::Sender<TerminalEvent>,
}

pub struct P2PNetwork {
    node_id: NodeId,
    sessions: RwLock<HashMap<String, SharedSession>>,
    message_sender: mpsc::UnboundedSender<ShareMessage>,
}

impl Clone for P2PNetwork {
    fn clone(&self) -> Self {
        Self {
            node_id: self.node_id,
            sessions: RwLock::new(HashMap::new()),
            message_sender: self.message_sender.clone(),
        }
    }
}

impl P2PNetwork {
    pub async fn new() -> Result<(Self, mpsc::UnboundedReceiver<ShareMessage>)> {
        info!("Initializing iroh P2P network...");

        // For now, use a random node ID
        let node_id = NodeId::from_bytes(&rand::random::<[u8; 32]>())?;

        info!("Node ID: {}", node_id);

        let (message_sender, message_receiver) = mpsc::unbounded_channel();

        let network = Self {
            node_id,
            sessions: RwLock::new(HashMap::new()),
            message_sender,
        };

        Ok((network, message_receiver))
    }

    pub async fn create_shared_session(
        &self,
        header: SessionHeader,
    ) -> Result<mpsc::UnboundedReceiver<String>> {
        let session_id = header.session_id.clone();
        info!("Creating shared session: {}", session_id);

        let (event_sender, _event_receiver) = broadcast::channel(1000);
        let (_input_sender, input_receiver) = mpsc::unbounded_channel();

        let session = SharedSession {
            header: header.clone(),
            participants: vec![self.node_id.to_string()],
            is_host: true,
            event_sender: event_sender.clone(),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        let message = ShareMessage::SessionStart {
            session_id: session_id.clone(),
            header,
        };

        self.broadcast_message(message).await?;

        Ok(input_receiver)
    }

    pub async fn join_session(
        &self,
        session_id: String,
    ) -> Result<broadcast::Receiver<TerminalEvent>> {
        info!("Joining session: {}", session_id);

        let (event_sender, event_receiver) = broadcast::channel(1000);

        // Create session entry for this joined session
        let session = SharedSession {
            header: SessionHeader {
                version: 2,
                width: 80,
                height: 24,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_secs(),
                title: None,
                command: None,
                session_id: session_id.clone(),
            },
            participants: vec![],
            is_host: false,
            event_sender: event_sender.clone(),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        let join_message = ShareMessage::JoinRequest {
            session_id: session_id.clone(),
            node_id: self.node_id.to_string(),
        };

        self.broadcast_message(join_message).await?;

        Ok(event_receiver)
    }

    pub async fn send_terminal_event(
        &self,
        session_id: String,
        event: TerminalEvent,
    ) -> Result<()> {
        debug!("Sending terminal event for session: {}", session_id);

        let message = ShareMessage::SessionData {
            session_id: session_id.clone(),
            event: event.clone(),
        };

        self.broadcast_message(message).await?;

        let sessions = self.sessions.read().await;
        if let Some(session) = sessions.get(&session_id) {
            if let Err(e) = session.event_sender.send(event) {
                warn!("Failed to send event to local subscribers: {}", e);
            }
        }

        Ok(())
    }

    pub async fn send_input(&self, session_id: String, data: String) -> Result<()> {
        debug!("Sending input data for session: {}", session_id);

        let message = ShareMessage::InputData { session_id, data };

        self.broadcast_message(message).await?;
        Ok(())
    }

    pub async fn end_session(&self, session_id: String) -> Result<()> {
        info!("Ending session: {}", session_id);

        let message = ShareMessage::SessionEnd {
            session_id: session_id.clone(),
        };

        self.broadcast_message(message).await?;

        self.sessions.write().await.remove(&session_id);
        Ok(())
    }

    async fn broadcast_message(&self, message: ShareMessage) -> Result<()> {
        let _message_bytes = serde_json::to_vec(&message)?;
        info!("Broadcasting message: {:?}", message);

        // For now, just handle locally for development
        // In a real implementation, you would broadcast to connected peers via iroh

        Ok(())
    }

    pub async fn handle_message(&self, message: ShareMessage) -> Result<()> {
        match message {
            ShareMessage::SessionStart { session_id, header } => {
                info!("Received session start: {}", session_id);

                let (event_sender, _) = broadcast::channel(1000);
                let session = SharedSession {
                    header,
                    participants: vec![],
                    is_host: false,
                    event_sender,
                };

                self.sessions.write().await.insert(session_id, session);
            }

            ShareMessage::SessionData { session_id, event } => {
                let sessions = self.sessions.read().await;
                if let Some(session) = sessions.get(&session_id) {
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send event to subscribers: {}", e);
                    }
                }
            }

            ShareMessage::JoinRequest {
                session_id,
                node_id,
            } => {
                let mut sessions = self.sessions.write().await;
                if let Some(session) = sessions.get_mut(&session_id) {
                    if session.is_host {
                        session.participants.push(node_id.clone());

                        let _response = ShareMessage::JoinResponse {
                            session_id: session_id.clone(),
                            accepted: true,
                            reason: None,
                        };

                        // TODO: Send response to requesting node
                        info!("Node {} joined session {}", node_id, session_id);
                    }
                }
            }

            ShareMessage::JoinResponse {
                session_id,
                accepted,
                reason,
            } => {
                if accepted {
                    info!("Successfully joined session: {}", session_id);
                } else {
                    warn!("Failed to join session {}: {:?}", session_id, reason);
                }
            }

            ShareMessage::InputData {
                session_id,
                data: _,
            } => {
                debug!("Received input data for session: {}", session_id);
                let input_message = ShareMessage::InputData {
                    session_id,
                    data: "".to_string(),
                };
                if let Err(e) = self.message_sender.send(input_message) {
                    error!("Failed to forward input message: {}", e);
                }
            }

            ShareMessage::SessionEnd { session_id } => {
                info!("Session ended: {}", session_id);
                self.sessions.write().await.remove(&session_id);
            }
        }

        Ok(())
    }

    pub async fn get_node_id(&self) -> String {
        self.node_id.to_string()
    }

    pub async fn get_node_addr(&self) -> Result<NodeAddr> {
        // For now, return a simple NodeAddr without real network addresses
        Ok(NodeAddr::new(self.node_id))
    }

    pub async fn connect_to_peer(&self, node_addr: NodeAddr) -> Result<()> {
        info!("Would connect to peer: {}", node_addr.node_id);
        // TODO: Implement actual peer connection
        Ok(())
    }

    pub async fn get_active_sessions(&self) -> Vec<String> {
        self.sessions.read().await.keys().cloned().collect()
    }

    pub async fn is_session_host(&self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.read().await.get(session_id) {
            session.is_host
        } else {
            false
        }
    }
}
