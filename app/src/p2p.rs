use anyhow::Result;
use futures::StreamExt;
use iroh::{Endpoint, NodeAddr, NodeId, Watcher, protocol::Router};
use iroh_gossip::{
    api::{Event, GossipReceiver, GossipSender},
    net::Gossip,
    proto::TopicId,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast, mpsc};
use tracing::{debug, error, info, warn};
use url::Url;

use crate::terminal_events::TerminalEvent;

use aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce, aead::OsRng};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHeader {
    pub version: u8,
    pub width: u16,
    pub height: u16,
    pub timestamp: u64,
    pub title: Option<String>,
    pub command: Option<String>,
    pub session_id: String,
}

pub type EncryptionKey = [u8; 32];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalMessageBody {
    /// Session metadata
    SessionInfo { from: NodeId, header: SessionHeader },
    /// Terminal output data
    Output {
        from: NodeId,
        data: String,
        timestamp: u64,
    },
    /// User input data
    Input {
        from: NodeId,
        data: String,
        timestamp: u64,
    },
    /// Resize event
    Resize {
        from: NodeId,
        width: u16,
        height: u16,
        timestamp: u64,
    },
    /// Session ended
    SessionEnd { from: NodeId, timestamp: u64 },
    /// Directed message to specific node
    DirectedMessage {
        from: NodeId,
        to: NodeId,
        data: String,
        timestamp: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedTerminalMessage {
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

impl EncryptedTerminalMessage {
    pub fn new(body: TerminalMessageBody, key: &EncryptionKey) -> Result<Self> {
        let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
        let nonce_bytes: [u8; 12] = rand::random();
        let nonce = Nonce::from_slice(&nonce_bytes);

        let plaintext = bincode::serialize(&body)?;
        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        Ok(Self {
            nonce: nonce_bytes,
            ciphertext,
        })
    }

    pub fn decrypt(&self, key: &EncryptionKey) -> Result<TerminalMessageBody> {
        let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
        let nonce = Nonce::from_slice(&self.nonce);

        let plaintext = cipher
            .decrypt(nonce, self.ciphertext.as_ref())
            .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

        let body: TerminalMessageBody = bincode::deserialize(&plaintext)?;
        Ok(body)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        bincode::deserialize(bytes).map_err(Into::into)
    }

    pub fn to_vec(&self) -> Result<Vec<u8>> {
        bincode::serialize(self).map_err(Into::into)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTicket {
    pub topic_id: TopicId,
    pub nodes: Vec<NodeAddr>,
    pub key: EncryptionKey,
}

impl std::fmt::Display for SessionTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let bytes = bincode::serialize(self).map_err(|_| std::fmt::Error)?;
        let encoded = data_encoding::BASE32.encode(&bytes);
        write!(f, "{}", encoded)
    }
}

impl std::str::FromStr for SessionTicket {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bytes = data_encoding::BASE32
            .decode(s.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode ticket: {}", e))?;
        let ticket: SessionTicket = bincode::deserialize(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize ticket: {}", e))?;
        Ok(ticket)
    }
}

#[derive(Debug)]
pub struct SharedSession {
    pub header: SessionHeader,
    pub participants: Vec<String>,
    pub is_host: bool,
    pub event_sender: broadcast::Sender<TerminalEvent>,
    pub node_id: NodeId, // Store the node ID for this session
    pub key: EncryptionKey,
}

pub struct P2PNetwork {
    endpoint: Endpoint,
    gossip: Gossip,
    router: Router,
    sessions: Arc<RwLock<HashMap<String, SharedSession>>>,
}

impl Clone for P2PNetwork {
    fn clone(&self) -> Self {
        Self {
            endpoint: self.endpoint.clone(),
            gossip: self.gossip.clone(),
            router: self.router.clone(),
            sessions: Arc::clone(&self.sessions),
        }
    }
}

impl P2PNetwork {
    pub async fn new(relay_url: Option<String>) -> Result<Self> {
        info!("Initializing iroh P2P network with gossip...");

        // Create iroh endpoint with optional custom relay
        let endpoint_builder = Endpoint::builder();
        let endpoint = if let Some(relay) = relay_url {
            info!("Using custom relay server: {}", relay);
            // Parse the relay URL and use it for discovery
            let _relay_url: Url = relay.parse()?;
            endpoint_builder
                .discovery_n0() // Use default discovery for now, custom relay setup is more complex
                .bind()
                .await?
        } else {
            info!("Using default n0 relay server");
            endpoint_builder.discovery_n0().bind().await?
        };

        let node_id = endpoint.node_id();
        info!("Node ID: {}", node_id);

        // Create gossip instance
        let gossip = Gossip::builder().spawn(endpoint.clone());

        // Create router with gossip protocol
        let router = Router::builder(endpoint.clone())
            .accept(iroh_gossip::ALPN, gossip.clone())
            .spawn();

        let network = Self {
            endpoint,
            gossip,
            router,
            sessions: Arc::new(RwLock::new(HashMap::new())),
        };

        Ok(network)
    }

    pub async fn create_shared_session(
        &self,
        header: SessionHeader,
    ) -> Result<(TopicId, GossipSender, mpsc::UnboundedReceiver<String>)> {
        let session_id = header.session_id.clone();
        info!("Creating shared session: {}", session_id);

        // Create topic for this session using random bytes
        let topic_id = TopicId::from_bytes(rand::random());
        let key: EncryptionKey = ChaCha20Poly1305::generate_key(&mut OsRng).into();

        let (event_sender, _event_receiver) = broadcast::channel(1000);
        let (_input_sender, input_receiver) = mpsc::unbounded_channel();

        let session = SharedSession {
            header: header.clone(),
            participants: vec![self.endpoint.node_id().to_string()],
            is_host: true,
            event_sender: event_sender.clone(),
            node_id: self.endpoint.node_id(),
            key,
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        // Subscribe to the gossip topic (empty node_ids means we're creating a new topic)
        let topic = self.gossip.subscribe(topic_id, vec![]).await?;
        let (sender, receiver) = topic.split();

        // Start listening for messages on this topic
        self.start_topic_listener(receiver, session_id).await?;

        // Send session info message
        let body = TerminalMessageBody::SessionInfo {
            from: self.endpoint.node_id(),
            header,
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;

        Ok((topic_id, sender, input_receiver))
    }

    pub async fn join_session(
        &self,
        ticket: SessionTicket,
    ) -> Result<(GossipSender, broadcast::Receiver<TerminalEvent>)> {
        info!("Joining session with topic: {}", ticket.topic_id);

        let session_id = format!("session_{}", ticket.topic_id);
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
            node_id: self.endpoint.node_id(),
            key: ticket.key,
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        // Add peer addresses to endpoint's addressbook
        for peer in &ticket.nodes {
            self.endpoint.add_node_addr(peer.clone())?;
        }

        // Subscribe and join the gossip topic with known peers
        let node_ids = ticket.nodes.iter().map(|p| p.node_id).collect();
        let topic = self
            .gossip
            .subscribe_and_join(ticket.topic_id, node_ids)
            .await?;
        let (sender, receiver) = topic.split();

        // Start listening for messages on this topic
        self.start_topic_listener(receiver, session_id).await?;

        Ok((sender, event_receiver))
    }

    pub async fn send_terminal_output(
        &self,
        session_id: &str,
        sender: &GossipSender,
        data: String,
    ) -> Result<()> {
        debug!("Sending terminal output");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for output"))?;

        let body = TerminalMessageBody::Output {
            from: self.endpoint.node_id(),
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_input(
        &self,
        session_id: &str,
        sender: &GossipSender,
        data: String,
    ) -> Result<()> {
        debug!("Sending input data");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for input"))?;

        let body = TerminalMessageBody::Input {
            from: self.endpoint.node_id(),
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_directed_message(
        &self,
        session_id: &str,
        sender: &GossipSender,
        to: NodeId,
        data: String,
    ) -> Result<()> {
        debug!("Sending directed message to node: {}", to.fmt_short());
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for directed message"))?;

        let body = TerminalMessageBody::DirectedMessage {
            from: self.endpoint.node_id(),
            to,
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_resize_event(
        &self,
        session_id: &str,
        sender: &GossipSender,
        width: u16,
        height: u16,
    ) -> Result<()> {
        debug!("Sending resize event");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for resize"))?;

        let body = TerminalMessageBody::Resize {
            from: self.endpoint.node_id(),
            width,
            height,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn end_session(&self, session_id: &str, sender: &GossipSender) -> Result<()> {
        info!("Ending session: {}", session_id);
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for ending"))?;

        let body = TerminalMessageBody::SessionEnd {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        drop(sessions); // Release read lock
        self.sessions.write().await.remove(session_id);
        Ok(())
    }

    async fn start_topic_listener(
        &self,
        mut receiver: GossipReceiver,
        session_id: String,
    ) -> Result<()> {
        let sessions = Arc::clone(&self.sessions);
        let endpoint = self.endpoint.clone();

        tokio::spawn(async move {
            while let Some(event) = receiver.next().await {
                if let Ok(Event::Received(msg)) = event {
                    if let Err(e) =
                        Self::handle_gossip_message(&sessions, &session_id, &msg.content, &endpoint)
                            .await
                    {
                        error!("Failed to handle gossip message: {}", e);
                    }
                }
            }
        });

        Ok(())
    }

    async fn handle_gossip_message(
        sessions: &Arc<RwLock<HashMap<String, SharedSession>>>,
        session_id: &str,
        bytes: &[u8],
        endpoint: &Endpoint,
    ) -> Result<()> {
        let key = {
            let sessions_read = sessions.read().await;
            sessions_read.get(session_id).map(|s| s.key)
        };

        if let Some(key) = key {
            let encrypted_message = EncryptedTerminalMessage::from_bytes(bytes)?;
            let decrypted_body = encrypted_message.decrypt(&key)?;
            let sessions_guard = sessions.read().await;
            if let Some(session) = sessions_guard.get(session_id) {
                let my_node_id = endpoint.node_id();

                match decrypted_body {
                    TerminalMessageBody::Output {
                        from: _,
                        data,
                        timestamp,
                    } => {
                        let event = TerminalEvent {
                            timestamp: timestamp as f64,
                            event_type: crate::terminal_events::EventType::Output,
                            data,
                        };
                        if session.event_sender.send(event).is_err() {
                            warn!("No active receivers for output event, skipping");
                        }
                    }
                    TerminalMessageBody::Input {
                        from: _,
                        data,
                        timestamp,
                    } => {
                        let event = TerminalEvent {
                            timestamp: timestamp as f64,
                            event_type: crate::terminal_events::EventType::Input,
                            data,
                        };
                        if session.event_sender.send(event).is_err() {
                            warn!("No active receivers for input event, skipping");
                        }
                    }
                    TerminalMessageBody::Resize {
                        from: _,
                        width,
                        height,
                        timestamp,
                    } => {
                        let event = TerminalEvent {
                            timestamp: timestamp as f64,
                            event_type: crate::terminal_events::EventType::Resize { width, height },
                            data: format!("{}x{}", width, height),
                        };
                        if session.event_sender.send(event).is_err() {
                            warn!("No active receivers for resize event, skipping");
                        }
                    }
                    TerminalMessageBody::SessionEnd { from: _, timestamp } => {
                        let event = TerminalEvent {
                            timestamp: timestamp as f64,
                            event_type: crate::terminal_events::EventType::End,
                            data: "Session ended".to_string(),
                        };
                        if session.event_sender.send(event).is_err() {
                            warn!("No active receivers for end event, skipping");
                        }
                    }
                    TerminalMessageBody::DirectedMessage {
                        from,
                        to,
                        data,
                        timestamp,
                    } => {
                        if to == my_node_id {
                            let event = TerminalEvent {
                                timestamp: timestamp as f64,
                                event_type: crate::terminal_events::EventType::Output,
                                data: format!("[DM from {}] {}", from.fmt_short(), data),
                            };
                            if session.event_sender.send(event).is_err() {
                                warn!("No active receivers for directed message, skipping");
                            }
                        }
                    }
                    TerminalMessageBody::SessionInfo { from, header } => {
                        info!(
                            "Received session info from {} for session: {}",
                            from.fmt_short(),
                            session_id
                        );
                        drop(sessions_guard); // Release read lock
                        let mut sessions_write = sessions.write().await;
                        if let Some(session) = sessions_write.get_mut(session_id) {
                            session.participants.push(from.to_string());
                            session.header = header;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn get_node_id(&self) -> String {
        self.endpoint.node_id().to_string()
    }

    pub async fn get_node_addr(&self) -> Result<NodeAddr> {
        let watcher = self.endpoint.node_addr();
        let mut stream = watcher.stream();
        let node_addr = stream
            .next()
            .await
            .flatten()
            .ok_or_else(|| anyhow::anyhow!("Failed to get node address"))?;
        Ok(node_addr)
    }

    pub async fn connect_to_peer(&self, node_addr: NodeAddr) -> Result<()> {
        info!("Connecting to peer: {}", node_addr.node_id);

        // Add the peer to our endpoint
        self.endpoint.add_node_addr(node_addr.clone())?;
        info!("Successfully added peer {} to endpoint", node_addr.node_id);

        Ok(())
    }

    pub async fn create_session_ticket(
        &self,
        topic_id: TopicId,
        session_id: &str,
    ) -> Result<SessionTicket> {
        // Get the actual node address with network information
        let me = self.get_node_addr().await?;
        let nodes = vec![me];

        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        Ok(SessionTicket {
            topic_id,
            nodes,
            key: session.key,
        })
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

    pub async fn shutdown(&self) -> Result<()> {
        self.router.shutdown().await.map_err(Into::into)
    }
}
