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
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast, mpsc};
use tracing::{debug, error, info, warn};
use url::Url;

use crate::string_compressor::StringCompressor;

/// Filter out problematic ANSI escape sequences from terminal output
fn filter_ansi_sequences(input: &str) -> String {
    // Quick check for escape sequences
    if !input.contains('\x1B') {
        return input.to_string();
    }

    // Create regex for problematic sequences
    let ansi_regex = Regex::new(
        r"(?x)
        \x1B\[                    # Start with ESC[
        (?:
            [0-9]*;[0-9]*c        | # Device Status Report response (e.g., 1;2c from vim)
            [0-9]*;[0-9]*R        | # Cursor Position Report response
            \?[0-9]+[hl]          | # Private mode set/reset
            [0-9]*;?[0-9]*;?[0-9]*[ABCDEFGHJKSTfmsu] | # Other CSI sequences
            [0-9]*[ABCDEFGHJKST]    # Simple cursor movement, etc.
        )
        |
        \x1B\]0;[^\x07\x1B]*[\x07\x1B\\] | # Window title sequences
        \x1B[()>][0-9AB]          | # Character set selection
        \x1B[?0-9]*[hl]           | # Mode queries and responses
        \x1B>[0-9]*c              | # Secondary Device Attribute responses
        \x1B\[[>0-9;]*c            # Primary Device Attribute responses
    ",
    )
    .unwrap_or_else(|_| Regex::new("").unwrap());

    let mut filtered = ansi_regex.replace_all(input, "").to_string();

    // Additional cleanup for vim-specific sequences
    let vim_sequences = &[
        "\x1B[?1000h",
        "\x1B[?1000l", // Mouse tracking
        "\x1B[?1002h",
        "\x1B[?1002l", // Cell motion mouse tracking
        "\x1B[?1006h",
        "\x1B[?1006l", // SGR mouse mode
        "\x1B[?2004h",
        "\x1B[?2004l", // Bracketed paste mode
        "\x1B[?25h",
        "\x1B[?25l", // Show/hide cursor
        "\x1B[?1049h",
        "\x1B[?1049l", // Alternative buffer
        "\x1B[?47h",
        "\x1B[?47l", // Alternative buffer (legacy)
        "\x1B[c",
        "\x1B[>c",
        "\x1B[6n", // Device queries
    ];

    for seq in vim_sequences {
        filtered = filtered.replace(seq, "");
    }

    filtered
}

/// Check if a string contains only ANSI escape sequences (no visible content)
fn is_only_ansi_sequences(input: &str) -> bool {
    let filtered = filter_ansi_sequences(input);
    filtered.trim().is_empty()
}

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
    /// Participant joined notification
    ParticipantJoined { from: NodeId, timestamp: u64 },
    /// History data message
    HistoryData {
        from: NodeId,
        shell_type: String,
        working_dir: String,
        history: Vec<String>,
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
}

impl Clone for P2PNetwork {
    fn clone(&self) -> Self {
        Self {
            endpoint: self.endpoint.clone(),
            gossip: self.gossip.clone(),
            router: self.router.clone(),
            sessions: Arc::clone(&self.sessions),
            history_callback: self.history_callback.clone(),
        }
    }
}

// Terminal event types that are shared between cli and app
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventType {
    Output,
    Input,
    Resize { width: u16, height: u16 },
    Start,
    End,
    HistoryData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: f64,
    pub event_type: EventType,
    pub data: String,
}

// Session info for history data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub logs: String,
    pub shell: String,
    pub cwd: String,
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

    pub async fn send_history_data(
        &self,
        session_id: &str,
        sender: &GossipSender,
        shell_type: String,
        working_dir: String,
        history: Vec<String>,
    ) -> Result<()> {
        debug!("Sending history data");
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for history data"))?;

        let body = TerminalMessageBody::HistoryData {
            from: self.endpoint.node_id(),
            shell_type,
            working_dir,
            history,
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
                    // Filter ANSI sequences before creating terminal event
                    if !is_only_ansi_sequences(&data) {
                        let filtered_data = filter_ansi_sequences(&data);
                        if !filtered_data.trim().is_empty() {
                            let event = TerminalEvent {
                                timestamp: timestamp as f64,
                                event_type: EventType::Output,
                                data: filtered_data,
                            };
                            if session.event_sender.send(event).is_err() {
                                warn!("No active receivers for output event, skipping");
                            }
                        }
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
                        event_type: EventType::Input,
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
                        event_type: EventType::Resize { width, height },
                        data: format!("{}x{}", width, height),
                    };
                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send resize event to subscribers");
                    }
                }
                TerminalMessageBody::SessionEnd { from: _, timestamp } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
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
                            timestamp: timestamp as f64,
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
                        timestamp: timestamp as f64,
                        event_type: EventType::Output,
                        data: format!("Participant {} joined the session", from.fmt_short()),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for participant joined event, skipping");
                    }

                    // 如果我们是主机，自动发送历史记录
                    if session.is_host {
                        info!("We are the host, attempting to send history data");

                        // 获取 gossip_sender 的克隆
                        let gossip_sender = session.gossip_sender.clone();
                        drop(sessions_guard); // 释放锁

                        if let Some(sender) = gossip_sender {
                            // 获取历史记录回调
                            let callback = {
                                let history_callback_guard = self.history_callback.read().await;
                                history_callback_guard.as_ref().map(|cb| cb(session_id))
                            };

                            if let Some(receiver) = callback {
                                // 在新的任务中处理历史记录发送，避免阻塞消息处理
                                let network_clone = self.clone();
                                let session_id_clone = session_id.to_string();

                                tokio::spawn(async move {
                                    match receiver.await {
                                        Ok(Some(session_info)) => {
                                            info!("Got history data, sending to new participant");

                                            if let Err(e) = network_clone
                                                .send_history_data(
                                                    &session_id_clone,
                                                    &sender,
                                                    session_info.shell,
                                                    session_info.cwd,
                                                    session_info.logs.lines().map(|s| s.to_string()).collect(),
                                                )
                                                .await
                                            {
                                                error!("Failed to send history data: {}", e);
                                            } else {
                                                info!(
                                                    "✅ Successfully sent history data to new participant"
                                                );
                                            }
                                        }
                                        Ok(None) => {
                                            info!("No history data available to send");
                                        }
                                        Err(_e) => {
                                            error!("Failed to get history data");
                                        }
                                    }
                                });
                            } else {
                                warn!("No history callback set, cannot send history data");
                            }
                        } else {
                            warn!("No gossip sender available for sending history data");
                        }
                    }
                }
                TerminalMessageBody::HistoryData {
                    from,
                    shell_type,
                    working_dir,
                    history,
                    timestamp,
                } => {
                    info!("Received history data from {}", from.fmt_short());

                    // Send session info event
                    let info_event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: EventType::Output,
                        data: format!(
                            "=== Session History ===\nShell: {}\nWorking Directory: {}\n",
                            shell_type, working_dir
                        ),
                    };
                    if session.event_sender.send(info_event).is_err() {
                        warn!("No active receivers for history info event, skipping");
                    }

                    // Send each history line as a separate event
                    for (i, line) in history.iter().enumerate() {
                        let history_event = TerminalEvent {
                            timestamp: (timestamp as f64) + (i as f64 * 0.001), // Slight time offset for ordering
                            event_type: EventType::HistoryData,
                            data: line.clone(),
                        };
                        if session.event_sender.send(history_event).is_err() {
                            warn!("No active receivers for history data event, skipping");
                        }
                    }

                    // Send separator
                    let separator_event = TerminalEvent {
                        timestamp: (timestamp as f64) + (history.len() as f64 * 0.001) + 0.001,
                        event_type: EventType::Output,
                        data: "=== End of History ===\n".to_string(),
                    };
                    if session.event_sender.send(separator_event).is_err() {
                        warn!("No active receivers for history separator event, skipping");
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
        let watcher = self.endpoint.node_addr();
        let mut stream = watcher.stream();
        let node_addr = stream
            .next()
            .await
            .flatten()
            .ok_or_else(|| anyhow::anyhow!("Node address not available from watcher"))?;
        debug!("Got node address: {:?}", node_addr);
        Ok(node_addr)
    }

    pub async fn connect_to_peer(&self, node_addr: NodeAddr) -> Result<()> {
        debug!("Connecting to peer: {}", node_addr.node_id);

        // Add the peer to our endpoint
        self.endpoint.add_node_addr(node_addr.clone())?;
        debug!("Successfully added peer {} to endpoint", node_addr.node_id);

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

    /// 优化的会话密钥获取方法，使用作用域减少锁的持有时间
    async fn get_session_key(&self, session_id: &str) -> Result<EncryptionKey> {
        let key = {
            let sessions = self.sessions.read().await;
            sessions.get(session_id).map(|s| s.key)
        };

        key.ok_or_else(|| anyhow::anyhow!("Session not found"))
    }

    /// 设置历史记录获取回调函数
    pub async fn set_history_callback<F>(&self, callback: F)
    where
        F: Fn(&str) -> tokio::sync::oneshot::Receiver<Option<SessionInfo>> + Send + Sync + 'static,
    {
        let mut history_callback = self.history_callback.write().await;
        *history_callback = Some(Box::new(callback));
    }
}