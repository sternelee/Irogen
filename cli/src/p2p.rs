use aead::{Aead, KeyInit};
use anyhow::Result;
use bincode;
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
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

use crate::terminal::{SessionHeader, TerminalEvent};

pub type EncryptionKey = [u8; 32];

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

#[derive(Debug)]
pub struct SharedSession {
    pub header: SessionHeader,
    pub participants: Vec<String>,
    pub is_host: bool,
    pub event_sender: broadcast::Sender<TerminalEvent>,
    pub input_sender: Option<mpsc::UnboundedSender<String>>,
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
            sessions: self.sessions.clone(),
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

    #[tracing::instrument(skip(self, header), fields(session_id = %header.session_id))]
    pub async fn create_shared_session(
        &self,
        header: SessionHeader,
    ) -> Result<(TopicId, GossipSender, mpsc::UnboundedReceiver<String>)> {
        let session_id = header.session_id.clone();
        info!("Creating shared session");

        // Create topic for this session using random bytes
        let topic_id = TopicId::from_bytes(rand::random());
        let key: EncryptionKey = rand::random();

        let (event_sender, _event_receiver) = broadcast::channel(1000);
        let (input_sender, input_receiver) = mpsc::unbounded_channel();

        let session = SharedSession {
            header: header.clone(),
            participants: vec![self.endpoint.node_id().to_string()],
            is_host: true,
            event_sender: event_sender.clone(),
            input_sender: Some(input_sender),
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

    #[tracing::instrument(skip(self, ticket), fields(topic_id = %ticket.topic_id))]
    pub async fn join_session(
        &self,
        ticket: SessionTicket,
    ) -> Result<(GossipSender, broadcast::Receiver<TerminalEvent>)> {
        info!("Joining session");

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
            input_sender: None, // Joining sessions don't need to handle input this way
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

    pub async fn join_session_with_retry(
        &self,
        ticket: SessionTicket,
        max_retries: u32,
    ) -> Result<(GossipSender, broadcast::Receiver<TerminalEvent>)> {
        info!(
            "Joining session with topic: {} (with retry)",
            ticket.topic_id
        );

        let mut last_error = None;

        for attempt in 1..=max_retries {
            info!("Connection attempt {} of {}", attempt, max_retries);

            match self.join_session(ticket.clone()).await {
                Ok(result) => {
                    info!("✅ Successfully joined session on attempt {}", attempt);
                    return Ok(result);
                }
                Err(e) => {
                    info!("Attempt {} failed: {}", attempt, e);
                    last_error = Some(e);

                    if attempt < max_retries {
                        info!("Waiting before next attempt...");
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    }
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| anyhow::anyhow!("Failed to join session after multiple attempts")))
    }

    pub async fn send_terminal_output(
        &self,
        sender: &GossipSender,
        data: String,
        session_id: &str,
    ) -> Result<()> {
        debug!("Sending terminal output length={}", data.len());
        if data.is_empty() {
            return Ok(());
        }

        let key = self.get_session_key(session_id).await?;
        let body = TerminalMessageBody::Output {
            from: self.endpoint.node_id(),
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_input(
        &self,
        sender: &GossipSender,
        data: String,
        session_id: &str,
    ) -> Result<()> {
        debug!("Sending input data: {:?} (len={})", data, data.len());
        if data.is_empty() {
            return Ok(());
        }

        let key = self.get_session_key(session_id).await?;
        let body = TerminalMessageBody::Input {
            from: self.endpoint.node_id(),
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_resize_event(
        &self,
        sender: &GossipSender,
        width: u16,
        height: u16,
        session_id: &str,
    ) -> Result<()> {
        debug!("Sending resize event");
        let key = self.get_session_key(session_id).await?;
        let body = TerminalMessageBody::Resize {
            from: self.endpoint.node_id(),
            width,
            height,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn end_session(&self, sender: &GossipSender, session_id: String) -> Result<()> {
        info!("Ending session: {}", session_id);

        let key = self.get_session_key(&session_id).await?;
        let body = TerminalMessageBody::SessionEnd {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        self.sessions.write().await.remove(&session_id);
        Ok(())
    }

    #[tracing::instrument(skip(self, receiver), fields(session_id = %session_id))]
    async fn start_topic_listener(
        &self,
        mut receiver: GossipReceiver,
        session_id: String,
    ) -> Result<()> {
        // Use the original sessions reference instead of creating a copy
        let sessions = self.sessions.clone();
        let _node_id = self.endpoint.node_id();

        tokio::spawn(async move {
            info!("Starting gossip message listener");

            loop {
                match receiver.next().await {
                    Some(Ok(Event::Received(msg))) => {
                        debug!("Received gossip message: {} bytes", msg.content.len());

                        match EncryptedTerminalMessage::from_bytes(&msg.content) {
                            Ok(encrypted_msg) => {
                                let sessions_guard = sessions.read().await;
                                if let Some(session) = sessions_guard.get(&session_id) {
                                    match encrypted_msg.decrypt(&session.key) {
                                        Ok(body) => {
                                            if let Err(e) = Self::handle_gossip_message(
                                                &sessions,
                                                &session_id,
                                                body,
                                            )
                                            .await
                                            {
                                                error!("Failed to handle gossip message: {}", e);
                                            }
                                        }
                                        Err(e) => error!("Failed to decrypt message: {}", e),
                                    }
                                } else {
                                    warn!("Session not found for incoming message");
                                }
                            }
                            Err(e) => error!("Failed to deserialize encrypted message: {}", e),
                        }
                    }
                    Some(Ok(Event::NeighborUp(peer_id))) => {
                        info!(
                            "Peer connected: {} to session {}",
                            peer_id.fmt_short(),
                            session_id
                        );
                    }
                    Some(Ok(Event::NeighborDown(peer_id))) => {
                        info!(
                            "Peer disconnected: {} from session {}",
                            peer_id.fmt_short(),
                            session_id
                        );
                    }
                    Some(Ok(Event::Lagged)) => {
                        warn!(
                            "Gossip topic is lagged for session {} (events may have been missed)",
                            session_id
                        );
                    }
                    Some(Err(e)) => {
                        error!("Error in gossip receiver for session {}: {}", session_id, e);
                        // Try to continue instead of breaking
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    }
                    None => {
                        warn!("Gossip receiver stream ended for session {}", session_id);
                        break;
                    }
                }
            }

            info!("Gossip listener for session {} has ended", session_id);
        });

        Ok(())
    }

    #[tracing::instrument(skip(sessions, body), fields(session_id = %session_id))]
    async fn handle_gossip_message(
        sessions: &Arc<RwLock<HashMap<String, SharedSession>>>,
        session_id: &str,
        body: TerminalMessageBody,
    ) -> Result<()> {
        let sessions_guard = sessions.read().await;
        if let Some(session) = sessions_guard.get(session_id) {
            match body {
                TerminalMessageBody::Output {
                    from: _,
                    data,
                    timestamp,
                } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::Output,
                        data,
                    };
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send output event to subscribers: {}", e);
                    }
                }
                TerminalMessageBody::Input {
                    from,
                    data,
                    timestamp,
                } => {
                    debug!("Received input event from {}: {:?}", from.fmt_short(), data);
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::Input,
                        data: data.clone(),
                    };

                    if session.is_host {
                        if let Some(input_sender) = &session.input_sender {
                            if input_sender.send(data).is_err() {
                                warn!("Failed to send input to terminal");
                            }
                        }
                    }
                    if session.event_sender.send(event).is_err() {
                        warn!("Failed to broadcast input event");
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
                        event_type: crate::terminal::EventType::Resize { width, height },
                        data: format!("{}x{}", width, height),
                    };
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send resize event to subscribers: {}", e);
                    }
                }
                TerminalMessageBody::SessionEnd { from: _, timestamp } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::End,
                        data: "Session ended".to_string(),
                    };
                    if let Err(e) = session.event_sender.send(event) {
                        warn!("Failed to send end event to subscribers: {}", e);
                    }
                }
                TerminalMessageBody::SessionInfo { from, header: _ } => {
                    info!(
                        "Received session info from {} for session: {}",
                        from.fmt_short(),
                        session_id
                    );
                }
            }
        }
        Ok(())
    }

    pub async fn get_node_id(&self) -> String {
        self.endpoint.node_id().to_string()
    }

    pub async fn get_node_addr(&self) -> Result<NodeAddr> {
        info!("Getting node address...");
        let watcher = self.endpoint.node_addr();
        let mut stream = watcher.stream();
        let node_addr = stream
            .next()
            .await
            .flatten()
            .ok_or_else(|| anyhow::anyhow!("Node address not available from watcher"))?;
        info!("Got node address: {:?}", node_addr);
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

    pub async fn shutdown(&self) -> Result<()> {
        self.router.shutdown().await.map_err(Into::into)
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

    async fn get_session_key(&self, session_id: &str) -> Result<EncryptionKey> {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .map(|s| s.key)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))
    }

    pub async fn diagnose_connection(&self, ticket: &SessionTicket) -> Result<()> {
        info!(
            "Diagnosing connection to session with topic: {}",
            ticket.topic_id
        );

        for (i, node) in ticket.nodes.iter().enumerate() {
            info!(
                "Testing connection to node {}/{}: {}",
                i + 1,
                ticket.nodes.len(),
                node.node_id
            );

            // Test connection to each direct address
            if node.direct_addresses.is_empty() {
                info!("Node has no direct addresses specified");
            }

            for (j, addr) in node.direct_addresses.iter().enumerate() {
                info!(
                    "Testing direct address {}/{}: {}",
                    j + 1,
                    node.direct_addresses.len(),
                    addr
                );

                // Try to connect to the address
                let result = tokio::net::TcpStream::connect(addr).await;
                match result {
                    Ok(_) => info!("✅ Successfully connected to {}", addr),
                    Err(e) => info!("❌ Failed to connect to {}: {}", addr, e),
                }
            }

            // Test connection through endpoint
            info!("Adding node {} to endpoint", node.node_id);
            if let Err(e) = self.endpoint.add_node_addr(node.clone()) {
                info!("Failed to add node to endpoint: {}", e);
            } else {
                info!("✅ Successfully added node to endpoint");
            }
        }

        Ok(())
    }
}
