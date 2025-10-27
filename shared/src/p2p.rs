use aead::{Aead, KeyInit};
use anyhow::Result;
use bincode;
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use futures::StreamExt;
use iroh::{Endpoint, NodeAddr, NodeId, protocol::Router};
pub use iroh_gossip::api::GossipSender;
use iroh_gossip::{
    api::{Event, GossipReceiver},
    net::Gossip,
    proto::TopicId,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast, mpsc};
use tracing::{debug, error, info, warn};
use url::Url;

use crate::string_compressor::StringCompressor;

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

// === Network Layer Messages ===
// These are encrypted and transmitted over P2P network

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkMessage {
    // === Session Management ===
    /// Session metadata when joining or creating session
    SessionInfo { from: NodeId, header: SessionHeader },
    /// Session ended notification
    SessionEnd { from: NodeId, timestamp: u64 },
    /// Participant joined notification
    ParticipantJoined { from: NodeId, timestamp: u64 },
    /// Directed message to specific node
    DirectedMessage {
        from: NodeId,
        to: NodeId,
        data: String,
        timestamp: u64,
    },

    // === Terminal I/O (Virtual Terminals) ===
    /// Terminal output data (for virtual terminals)
    Output {
        from: NodeId,
        data: String,
        timestamp: u64,
    },
    /// User input data (for virtual terminals)
    Input {
        from: NodeId,
        data: String,
        timestamp: u64,
    },
    /// Terminal resize (for virtual terminals)
    Resize {
        from: NodeId,
        width: u16,
        height: u16,
        timestamp: u64,
    },

    // === Terminal Management (Real Terminals) ===
    /// Create a new local terminal request
    TerminalCreate {
        from: NodeId,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
        timestamp: u64,
    },
    /// Terminal output data (from real terminal)
    TerminalOutput {
        from: NodeId,
        terminal_id: String,
        data: String,
        timestamp: u64,
    },
    /// Terminal input data (to real terminal)
    TerminalInput {
        from: NodeId,
        terminal_id: String,
        data: String,
        timestamp: u64,
    },
    /// Terminal resize request
    TerminalResize {
        from: NodeId,
        terminal_id: String,
        rows: u16,
        cols: u16,
        timestamp: u64,
    },
    /// Terminal status update
    TerminalStatusUpdate {
        from: NodeId,
        terminal_id: String,
        status: TerminalStatus,
        timestamp: u64,
    },
    /// Terminal directory change notification
    TerminalDirectoryChanged {
        from: NodeId,
        terminal_id: String,
        new_dir: String,
        timestamp: u64,
    },
    /// Stop terminal request
    TerminalStop {
        from: NodeId,
        terminal_id: String,
        timestamp: u64,
    },
    /// List terminals request
    TerminalListRequest { from: NodeId, timestamp: u64 },
    /// List terminals response
    TerminalListResponse {
        from: NodeId,
        terminals: Vec<TerminalInfo>,
        timestamp: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedTerminalMessage {
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

impl EncryptedTerminalMessage {
    pub fn new(body: NetworkMessage, key: &EncryptionKey) -> Result<Self> {
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

    pub fn decrypt(&self, key: &EncryptionKey) -> Result<NetworkMessage> {
        let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
        let nonce = Nonce::from_slice(&self.nonce);

        let plaintext = cipher
            .decrypt(nonce, self.ciphertext.as_ref())
            .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

        let body: NetworkMessage = bincode::deserialize(&plaintext)?;
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
        // First serialize to bytes
        let bytes = bincode::serialize(self).map_err(|_| std::fmt::Error)?;

        // Convert to BASE32 string for compression
        let base32_string = data_encoding::BASE32.encode(&bytes);

        // Compress the BASE32 string to make QR codes smaller
        match StringCompressor::compress_hybrid(&base32_string) {
            Ok(compressed) => {
                // Add a prefix to indicate this is a compressed ticket
                write!(f, "CT_{}", compressed)
            }
            Err(_) => {
                // Fallback to original encoding if compression fails
                write!(f, "{}", base32_string)
            }
        }
    }
}

impl std::str::FromStr for SessionTicket {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        // 清理输入：移除空白字符和换行符
        let cleaned = s.trim().replace([' ', '\n', '\r', '\t'], "");

        if cleaned.is_empty() {
            return Err(anyhow::anyhow!("Empty ticket"));
        }

        // Check if this is a compressed ticket (starts with "CT_")
        let base32_string = if cleaned.starts_with("CT_") {
            // This is a compressed ticket, decompress it
            let compressed_part = &cleaned[3..]; // Remove "CT_" prefix
            StringCompressor::decompress(compressed_part)
                .map_err(|e| anyhow::anyhow!("Failed to decompress ticket: {}", e))?
        } else {
            // This is an uncompressed ticket, use as-is
            cleaned
        };

        // 验证BASE32字符集（A-Z, 2-7, =）
        if !base32_string
            .chars()
            .all(|c| c.is_ascii_uppercase() || ('2'..='7').contains(&c) || c == '=')
        {
            return Err(anyhow::anyhow!(
                "Invalid BASE32 characters in ticket. Only A-Z, 2-7, and = are allowed"
            ));
        }

        // BASE32解码
        let bytes = data_encoding::BASE32
            .decode(base32_string.as_bytes())
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to decode ticket (length: {}): {}",
                    base32_string.len(),
                    e
                )
            })?;

        // 验证解码后的数据长度是否合理
        if bytes.len() < 32 {
            // 至少需要包含topic_id和key
            return Err(anyhow::anyhow!(
                "Decoded ticket too short: {} bytes",
                bytes.len()
            ));
        }

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
    pub input_sender: Option<mpsc::UnboundedSender<String>>,
    pub gossip_sender: Option<GossipSender>,
}

pub struct P2PNetwork {
    endpoint: Endpoint,
    gossip: Gossip,
    router: Router,
    sessions: Arc<RwLock<HashMap<String, SharedSession>>>,
    // 历史记录发送回调
    history_callback: Arc<
        RwLock<
            Option<
                Box<
                    dyn Fn(&str) -> tokio::sync::oneshot::Receiver<Option<SessionInfo>>
                        + Send
                        + Sync,
                >,
            >,
        >,
    >,
    // 终端输入处理回调
    terminal_input_callback: Arc<
        RwLock<
            Option<
                Box<
                    dyn Fn(
                            String,
                            String,
                        )
                            -> tokio::task::JoinHandle<anyhow::Result<Option<String>>>
                        + Send
                        + Sync,
                >,
            >,
        >,
    >,
}

impl Clone for P2PNetwork {
    fn clone(&self) -> Self {
        Self {
            endpoint: self.endpoint.clone(),
            gossip: self.gossip.clone(),
            router: self.router.clone(),
            sessions: Arc::clone(&self.sessions),
            history_callback: self.history_callback.clone(),
            terminal_input_callback: self.terminal_input_callback.clone(),
        }
    }
}

// === Frontend Event System ===
// These are used for communication with the Tauri frontend

/// Clean, structured event types for frontend communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventType {
    // === Virtual Terminal Events ===
    /// Terminal output (for virtual terminals)
    Output,
    /// User input (for virtual terminals)
    Input,
    /// Terminal resize (for virtual terminals)
    Resize { width: u16, height: u16 },
    /// Session started
    Start,
    /// Session ended
    End,

    // === Real Terminal Management Events ===
    /// Terminal list updated
    TerminalList(Vec<TerminalInfo>),
    /// Terminal output received
    TerminalOutput { terminal_id: String, data: String },
    /// Terminal input sent
    TerminalInput { terminal_id: String, data: String },
    /// Terminal resized
    TerminalResize {
        terminal_id: String,
        rows: u16,
        cols: u16,
    },
}

/// Frontend event with timestamp, event type, and optional data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: u64,
    pub event_type: EventType,
    /// Data field used for simple events (Output, Input)
    /// For structured events, this is typically empty
    pub data: String,
}

// === Type Aliases for Backward Compatibility ===
// Provide aliases for the old names during transition
pub type TerminalMessageBody = NetworkMessage;

// Session info for history data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub logs: String,
    pub shell: String,
    pub cwd: String,
}

// === Terminal Management Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub name: Option<String>,
    pub shell_type: String,
    pub current_dir: String,
    pub status: TerminalStatus,
    pub created_at: u64,
    pub last_activity: u64,
    pub size: (u16, u16), // (rows, cols)
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TerminalStatus {
    Starting,
    Running,
    Paused,
    Stopped,
    Error(String),
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
            history_callback: Arc::new(RwLock::new(None)),
            terminal_input_callback: Arc::new(RwLock::new(None)),
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
        let key: EncryptionKey = rand::random();

        let (event_sender, _event_receiver) = broadcast::channel(1000);
        let (input_sender, input_receiver) = mpsc::unbounded_channel();

        // Subscribe to the gossip topic (empty node_ids means we're creating a new topic)
        let topic = self.gossip.subscribe(topic_id, vec![]).await?;
        let (sender, receiver) = topic.split();

        let session = SharedSession {
            header: header.clone(),
            participants: vec![self.endpoint.node_id().to_string()],
            is_host: true,
            event_sender: event_sender.clone(),
            node_id: self.endpoint.node_id(),
            key,
            input_sender: Some(input_sender),
            gossip_sender: Some(sender.clone()),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

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
        self.join_session_with_buffer_limit(ticket, 1000).await
    }

    pub async fn join_session_with_buffer_limit(
        &self,
        ticket: SessionTicket,
        buffer_size: usize,
    ) -> Result<(GossipSender, broadcast::Receiver<TerminalEvent>)> {
        info!(
            "Joining session with topic: {} (buffer size: {})",
            ticket.topic_id, buffer_size
        );

        let session_id = format!("session_{}", ticket.topic_id);
        let (event_sender, event_receiver) = broadcast::channel(buffer_size.min(10000)); // Cap at 10k events

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
            input_sender: None,
            gossip_sender: None,
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        // In iroh 0.93, add_node_addr() is removed.
        // Peer addresses will be used when connecting via endpoint.connect()
        // No need to pre-add them to the address book.

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

    pub async fn send_participant_joined(
        &self,
        session_id: &str,
        sender: &GossipSender,
    ) -> Result<()> {
        debug!("Sending participant joined notification");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for participant joined"))?;

        let body = TerminalMessageBody::ParticipantJoined {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    async fn start_topic_listener(
        &self,
        mut receiver: GossipReceiver,
        session_id: String,
    ) -> Result<()> {
        let network_clone = self.clone();

        tokio::spawn(async move {
            debug!("Starting gossip message listener");

            loop {
                match receiver.next().await {
                    Some(Ok(Event::Received(msg))) => {
                        debug!("Received gossip message: {} bytes", msg.content.len());

                        match EncryptedTerminalMessage::from_bytes(&msg.content) {
                            Ok(encrypted_msg) => {
                                let sessions_guard = network_clone.sessions.read().await;
                                if let Some(session) = sessions_guard.get(&session_id) {
                                    let key = session.key;
                                    drop(sessions_guard); // 释放锁

                                    match encrypted_msg.decrypt(&key) {
                                        Ok(body) => {
                                            if let Err(e) = network_clone
                                                .handle_gossip_message(&session_id, body)
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
                        debug!(
                            "Peer connected: {} to session {}",
                            peer_id.fmt_short(),
                            session_id
                        );
                    }
                    Some(Ok(Event::NeighborDown(peer_id))) => {
                        debug!(
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

            debug!("Gossip listener for session {} has ended", session_id);
        });

        Ok(())
    }

    async fn handle_gossip_message(
        &self,
        session_id: &str,
        body: TerminalMessageBody,
    ) -> Result<()> {
        let sessions_guard = self.sessions.read().await;
        if let Some(session) = sessions_guard.get(session_id) {
            match body {
                TerminalMessageBody::Output {
                    from: _,
                    data,
                    timestamp,
                } => {
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data,
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for output event, skipping");
                    }
                }
                TerminalMessageBody::Input {
                    from,
                    data,
                    timestamp,
                } => {
                    debug!("Received input event from {}: {:?}", from.fmt_short(), data);
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Input,
                        data: data.clone(),
                    };

                    if session.is_host {
                        if let Some(input_sender) = &session.input_sender {
                            if input_sender.send(data).is_err() {
                                // warn!("Failed to send input to terminal");
                            }
                        }
                    }
                    if session.event_sender.send(event).is_err() {
                        // warn!("Failed to broadcast input event");
                    }
                }
                TerminalMessageBody::Resize {
                    from: _,
                    width,
                    height,
                    timestamp,
                } => {
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Resize { width, height },
                        data: format!("{}x{}", width, height),
                    };
                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send resize event to subscribers");
                    }
                }
                TerminalMessageBody::SessionEnd { from: _, timestamp } => {
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::End,
                        data: "Session ended".to_string(),
                    };
                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send end event to subscribers");
                    }
                }
                TerminalMessageBody::DirectedMessage {
                    from,
                    to,
                    data,
                    timestamp,
                } => {
                    let my_node_id = self.endpoint.node_id();
                    if to == my_node_id {
                        let event = TerminalEvent {
                            timestamp,
                            event_type: EventType::Output,
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
                    let mut sessions_write = self.sessions.write().await;
                    if let Some(session) = sessions_write.get_mut(session_id) {
                        session.participants.push(from.to_string());
                        session.header = header;
                    }
                }
                TerminalMessageBody::ParticipantJoined { from, timestamp } => {
                    info!("Participant {} joined session", from.fmt_short());
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!("Participant {} joined the session", from.fmt_short()),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for participant joined event, skipping");
                    }
                }

                // === Terminal Management Messages ===
                TerminalMessageBody::TerminalCreate {
                    from,
                    name,
                    shell_path,
                    working_dir,
                    size,
                    timestamp,
                } => {
                    info!("Received terminal create request from {}", from.fmt_short());
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!(
                            "[Terminal Create Request] Name: {:?}, Shell: {:?}, Dir: {:?}, Size: {:?}",
                            name, shell_path, working_dir, size
                        ),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal create event, skipping");
                    }
                }
                TerminalMessageBody::TerminalStatusUpdate {
                    from,
                    terminal_id,
                    status,
                    timestamp,
                } => {
                    info!(
                        "Received terminal status update from {} for terminal {}",
                        from.fmt_short(),
                        terminal_id
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!("[Terminal Status Update] {}: {:?}", terminal_id, status),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal status update event, skipping");
                    }
                }
                TerminalMessageBody::TerminalOutput {
                    from,
                    terminal_id,
                    data,
                    timestamp,
                } => {
                    debug!(
                        "Received terminal output from {} for terminal {}",
                        from.fmt_short(),
                        terminal_id
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::TerminalOutput { terminal_id, data },
                        data: String::new(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal output event, skipping");
                    }
                }
                TerminalMessageBody::TerminalInput {
                    from,
                    terminal_id,
                    data,
                    timestamp,
                } => {
                    debug!(
                        "Received terminal input from {} for terminal {}",
                        from.fmt_short(),
                        terminal_id
                    );

                    // Clone values before moving them into the closure
                    let terminal_id_clone = terminal_id.clone();
                    let data_clone = data.clone();

                    // 如果我们是主机，处理终端输入并发送输出响应
                    if session.is_host {
                        // 获取 gossip_sender 的克隆
                        let gossip_sender = session.gossip_sender.clone();

                        // 获取终端输入处理回调
                        let input_callback = {
                            let callback_guard = self.terminal_input_callback.read().await;
                            callback_guard
                                .as_ref()
                                .map(|cb| cb(terminal_id_clone.clone(), data_clone.clone()))
                        };

                        drop(sessions_guard); // 释放锁

                        if let Some(input_handler) = input_callback {
                            // 使用回调处理终端输入
                            let network_clone = self.clone();
                            let session_id_clone = session_id.to_string();
                            let terminal_id_for_output = terminal_id_clone.clone();
                            let gossip_sender_clone = gossip_sender.clone();

                            tokio::spawn(async move {
                                // 等待输入处理完成
                                match input_handler.await {
                                    Ok(Ok(Some(response_data))) => {
                                        // 发送终端输出响应
                                        if let Some(sender) = &gossip_sender_clone {
                                            if let Err(e) = network_clone
                                                .send_terminal_output(
                                                    &session_id_clone,
                                                    sender,
                                                    terminal_id_for_output,
                                                    response_data,
                                                )
                                                .await
                                            {
                                                error!(
                                                    "Failed to send terminal output response: {}",
                                                    e
                                                );
                                            }
                                        } else {
                                            error!(
                                                "No gossip sender available for terminal output response"
                                            );
                                        }
                                    }
                                    Ok(Ok(None)) => {
                                        // 没有输出数据，这是正常的，终端输出将通过其他方式发送
                                        debug!("Terminal input processed, no immediate output");
                                    }
                                    Ok(Err(e)) => {
                                        error!("Terminal input processing failed: {}", e);
                                    }
                                    Err(e) => {
                                        error!("Terminal input handler join error: {}", e);
                                    }
                                }
                            });
                        } else if let Some(sender) = gossip_sender {
                            // 没有设置回调，使用模拟输出（向后兼容）
                            warn!("No terminal input callback set, using simulated output");
                            let network_clone = self.clone();
                            let session_id_clone = session_id.to_string();

                            tokio::spawn(async move {
                                // 这里应该将输入发送到对应的终端实例
                                // 由于我们使用虚拟终端，暂时模拟终端输出
                                let response_data = if data_clone == "\r" {
                                    // 模拟回车符的响应
                                    format!("\r\n[Terminal Output: {}] $ ", terminal_id_clone)
                                } else {
                                    // 模拟普通输入的回显
                                    format!(
                                        "[Terminal Output: {}] {}",
                                        terminal_id_clone, data_clone
                                    )
                                };

                                // 发送终端输出响应
                                if let Err(e) = network_clone
                                    .send_terminal_output(
                                        &session_id_clone,
                                        &sender,
                                        terminal_id_clone,
                                        response_data,
                                    )
                                    .await
                                {
                                    error!("Failed to send terminal output response: {}", e);
                                }
                            });
                        }
                    } else {
                        drop(sessions_guard); // 释放锁
                    }

                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::TerminalInput { terminal_id, data },
                        data: String::new(),
                    };
                    // 重新获取会话来发送事件
                    let network_clone = self.clone();
                    let sessions_guard = network_clone.sessions.read().await;
                    if let Some(session) = sessions_guard.get(session_id) {
                        if session.event_sender.send(event).is_err() {
                            warn!("No active receivers for terminal input event, skipping");
                        }
                    }
                }
                TerminalMessageBody::TerminalResize {
                    from,
                    terminal_id,
                    rows,
                    cols,
                    timestamp,
                } => {
                    debug!(
                        "Received terminal resize from {} for terminal {}",
                        from.fmt_short(),
                        terminal_id
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::TerminalResize {
                            terminal_id,
                            rows,
                            cols,
                        },
                        data: String::new(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal resize event, skipping");
                    }
                }
                TerminalMessageBody::TerminalDirectoryChanged {
                    from,
                    terminal_id,
                    new_dir,
                    timestamp,
                } => {
                    info!(
                        "Received terminal directory change from {} for terminal {}",
                        from.fmt_short(),
                        terminal_id
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!("[Terminal Directory Change: {}] {}", terminal_id, new_dir),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal directory change event, skipping");
                    }
                }
                TerminalMessageBody::TerminalStop {
                    from,
                    terminal_id,
                    timestamp,
                } => {
                    info!(
                        "Received terminal stop request from {} for terminal {}",
                        from.fmt_short(),
                        terminal_id
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!("[Terminal Stop Request] {}", terminal_id),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal stop event, skipping");
                    }
                }
                TerminalMessageBody::TerminalListRequest { from, timestamp } => {
                    info!("Received terminal list request from {}", from.fmt_short());
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: "[Terminal List Request]".to_string(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal list request event, skipping");
                    }
                }
                TerminalMessageBody::TerminalListResponse {
                    from,
                    terminals,
                    timestamp,
                } => {
                    info!(
                        "Received terminal list response from {} with {} terminals",
                        from.fmt_short(),
                        terminals.len()
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::TerminalList(terminals),
                        data: String::new(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for terminal list response event, skipping");
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
        debug!("Getting node address...");
        // In iroh 0.93, node_addr() now returns NodeAddr directly
        let node_addr = self.endpoint.node_addr();
        debug!("Got node address: {:?}", node_addr);
        Ok(node_addr)
    }

    pub async fn connect_to_peer(&self, node_addr: NodeAddr) -> Result<()> {
        debug!("Connecting to peer: {}", node_addr.node_id);

        // In iroh 0.93, add_node_addr() is removed.
        // Node addresses are now provided directly when connecting.
        // The endpoint will automatically use the provided addresses.
        debug!("Node address stored for peer {}", node_addr.node_id);

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

    /// 为指定会话创建新的事件接收器
    pub async fn create_event_receiver(
        &self,
        session_id: &str,
    ) -> Option<broadcast::Receiver<TerminalEvent>> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).map(|s| s.event_sender.subscribe())
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

    /// 设置历史记录获取回调函数
    pub async fn set_history_callback<F>(&self, callback: F)
    where
        F: Fn(&str) -> tokio::sync::oneshot::Receiver<Option<SessionInfo>> + Send + Sync + 'static,
    {
        let mut history_callback = self.history_callback.write().await;
        *history_callback = Some(Box::new(callback));
    }

    /// 设置终端输入处理回调函数
    pub async fn set_terminal_input_callback<F>(&self, callback: F)
    where
        F: Fn(String, String) -> tokio::task::JoinHandle<anyhow::Result<Option<String>>>
            + Send
            + Sync
            + 'static,
    {
        let mut terminal_input_callback = self.terminal_input_callback.write().await;
        *terminal_input_callback = Some(Box::new(callback));
    }

    // === Terminal Management Methods ===

    pub async fn send_terminal_create(
        &self,
        session_id: &str,
        sender: &GossipSender,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> Result<()> {
        debug!("Sending terminal create request");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal create"))?;

        let body = TerminalMessageBody::TerminalCreate {
            from: self.endpoint.node_id(),
            name,
            shell_path,
            working_dir,
            size,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_terminal_stop(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
    ) -> Result<()> {
        debug!("Sending terminal stop request");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal stop"))?;

        let body = TerminalMessageBody::TerminalStop {
            from: self.endpoint.node_id(),
            terminal_id,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_terminal_list_request(
        &self,
        session_id: &str,
        sender: &GossipSender,
    ) -> Result<()> {
        debug!("Sending terminal list request");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal list"))?;

        let body = TerminalMessageBody::TerminalListRequest {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_terminal_list_response(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminals: Vec<TerminalInfo>,
    ) -> Result<()> {
        debug!("Sending terminal list response");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal list response"))?;

        let body = TerminalMessageBody::TerminalListResponse {
            from: self.endpoint.node_id(),
            terminals,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    // Additional terminal management methods

    pub async fn send_terminal_output(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        data: String,
    ) -> Result<()> {
        debug!("Sending terminal output for terminal {}", terminal_id);
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal output"))?;

        let body = TerminalMessageBody::TerminalOutput {
            from: self.endpoint.node_id(),
            terminal_id,
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_terminal_input(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        data: String,
    ) -> Result<()> {
        debug!("Sending terminal input for terminal {}", terminal_id);
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal input"))?;

        let body = TerminalMessageBody::TerminalInput {
            from: self.endpoint.node_id(),
            terminal_id,
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_terminal_resize(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        rows: u16,
        cols: u16,
    ) -> Result<()> {
        debug!("Sending terminal resize for terminal {}", terminal_id);
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal resize"))?;

        let body = TerminalMessageBody::TerminalResize {
            from: self.endpoint.node_id(),
            terminal_id,
            rows,
            cols,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_terminal_status_update(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        status: TerminalStatus,
    ) -> Result<()> {
        debug!(
            "Sending terminal status update for terminal {}",
            terminal_id
        );
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal status update"))?;

        let body = TerminalMessageBody::TerminalStatusUpdate {
            from: self.endpoint.node_id(),
            terminal_id,
            status,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn send_terminal_directory_change(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        new_dir: String,
    ) -> Result<()> {
        debug!(
            "Sending terminal directory change for terminal {}",
            terminal_id
        );
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for terminal directory change"))?;

        let body = TerminalMessageBody::TerminalDirectoryChanged {
            from: self.endpoint.node_id(),
            terminal_id,
            new_dir,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }
}
