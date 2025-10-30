use aead::{Aead, KeyInit};
use anyhow::Result;
use bincode;
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use futures::StreamExt;
use iroh::{Endpoint, EndpointAddr, EndpointId, discovery::dns::DnsDiscovery, protocol::Router};
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

// === Terminal Command/Response System ===
// Clean separation of commands (requests) and responses

/// Terminal commands sent from client to host
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalCommand {
    /// Create a new terminal
    Create {
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    },
    /// Send input to terminal
    Input {
        terminal_id: String,
        data: Vec<u8>,
    },
    /// Resize terminal
    Resize {
        terminal_id: String,
        rows: u16,
        cols: u16,
    },
    /// Stop terminal
    Stop {
        terminal_id: String,
    },
    /// Request terminal list
    List,
}

/// Terminal responses sent from host to client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalResponse {
    /// Terminal created successfully
    Created {
        terminal_id: String,
        info: TerminalInfo,
    },
    /// Terminal output data
    Output {
        terminal_id: String,
        data: Vec<u8>,
    },
    /// Terminal list
    List {
        terminals: Vec<TerminalInfo>,
    },
    /// Terminal status update
    StatusUpdate {
        terminal_id: String,
        status: TerminalStatus,
    },
    /// Working directory changed
    DirectoryChanged {
        terminal_id: String,
        new_dir: String,
    },
    /// Terminal stopped
    Stopped {
        terminal_id: String,
    },
    /// Error response
    Error {
        terminal_id: Option<String>,
        message: String,
    },
}

// === Network Layer Messages ===
// These are encrypted and transmitted over P2P network

/// Unified network message format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkMessage {
    // === Session Management ===
    /// Session metadata when joining or creating session
    SessionInfo {
        from: EndpointId,
        header: SessionHeader,
    },
    /// Session ended notification
    SessionEnd {
        from: EndpointId,
    },
    
    // === Terminal Operations ===
    /// Terminal command (request)
    Command {
        from: EndpointId,
        command: TerminalCommand,
        request_id: Option<String>,
    },
    /// Terminal response
    Response {
        from: EndpointId,
        response: TerminalResponse,
        request_id: Option<String>,
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
    pub nodes: Vec<EndpointAddr>,
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
    pub node_id: EndpointId, // Store the node ID for this session
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
    // === Session Events ===
    /// Session started
    SessionStarted,
    /// Session ended
    SessionEnded,
    
    // === Terminal Events ===
    /// Terminal created successfully
    TerminalCreated {
        terminal_id: String,
        info: TerminalInfo,
    },
    /// Terminal output received (data in event.data)
    TerminalOutput {
        terminal_id: String,
    },
    /// Terminal stopped
    TerminalStopped {
        terminal_id: String,
    },
    /// Terminal error
    TerminalError {
        terminal_id: Option<String>,
        error: String,
    },
    /// Terminal status updated
    TerminalStatusUpdate {
        terminal_id: String,
        status: TerminalStatus,
    },
    /// Working directory changed
    TerminalDirectoryChanged {
        terminal_id: String,
        new_dir: String,
    },
    /// Terminal list updated
    TerminalList {
        terminals: Vec<TerminalInfo>,
    },
}

/// Frontend event with timestamp, event type, and optional binary data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: u64,
    pub event_type: EventType,
    /// Binary data (e.g., terminal output)
    /// Use Vec<u8> to avoid UTF-8 conversion issues
    pub data: Vec<u8>,
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
        let endpoint: Endpoint = if let Some(relay) = relay_url {
            info!("Using custom relay server: {}", relay);
            // Parse the relay URL and use it for discovery
            let _relay_url: Url = relay.parse()?;
            endpoint_builder
                .discovery(DnsDiscovery::n0_dns()) // Use n0 DNS discovery
                .bind()
                .await?
        } else {
            info!("Using default n0 relay server");
            endpoint_builder
                .discovery(DnsDiscovery::n0_dns())
                .bind()
                .await?
        };

        let node_id = endpoint.id();
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
            participants: vec![self.endpoint.id().to_string()],
            is_host: true,
            event_sender: event_sender.clone(),
            node_id: self.endpoint.id(),
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
        let body = NetworkMessage::SessionInfo {
            from: self.endpoint.id(),
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
            node_id: self.endpoint.id(),
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
        let node_ids = ticket.nodes.iter().map(|p| p.id).collect();
        let topic = self
            .gossip
            .subscribe_and_join(ticket.topic_id, node_ids)
            .await?;
        let (sender, receiver) = topic.split();

        // Start listening for messages on this topic
        self.start_topic_listener(receiver, session_id).await?;

        Ok((sender, event_receiver))
    }

    // DEPRECATED: Virtual terminal methods - to be replaced with Command/Response
    // pub async fn send_input(
    //     &self,
    //     session_id: &str,
    //     sender: &GossipSender,
    //     data: String,
    // ) -> Result<()> {
    //     // Use send_terminal_command instead
    //     unimplemented!("Use send_terminal_command with TerminalCommand::Input")
    // }

    // pub async fn send_directed_message(
    //     &self,
    //     session_id: &str,
    //     sender: &GossipSender,
    //     to: EndpointId,
    //     data: String,
    // ) -> Result<()> {
    //     // Directed messages removed - use terminal-specific commands
    //     unimplemented!("Use terminal-specific commands")
    // }

    // pub async fn send_participant_joined(
    //     &self,
    //     session_id: &str,
    //     sender: &GossipSender,
    // ) -> Result<()> {
    //     // Participant notifications removed
    //     unimplemented!("Participant notifications removed")
    // }

    pub async fn end_session(&self, session_id: &str, sender: &GossipSender) -> Result<()> {
        info!("Ending session: {}", session_id);
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found for ending"))?;

        let body = NetworkMessage::SessionEnd {
            from: self.endpoint.id(),
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        drop(sessions); // Release read lock
        self.sessions.write().await.remove(session_id);
        Ok(())
    }

    // === New Unified Command/Response Methods ===

    /// Send a terminal command (from client to host)
    pub async fn send_command(
        &self,
        session_id: &str,
        sender: &GossipSender,
        command: TerminalCommand,
        request_id: Option<String>,
    ) -> Result<()> {
        debug!("Sending terminal command: {:?}", command);
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let body = NetworkMessage::Command {
            from: self.endpoint.id(),
            command,
            request_id,
        };
        let message = EncryptedTerminalMessage::new(body, &session.key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    /// Send a terminal response (from host to client)
    pub async fn send_response(
        &self,
        session_id: &str,
        sender: &GossipSender,
        response: TerminalResponse,
        request_id: Option<String>,
    ) -> Result<()> {
        debug!("Sending terminal response: {:?}", response);
        let sessions = self.sessions.read().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let body = NetworkMessage::Response {
            from: self.endpoint.id(),
            response,
            request_id,
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
        body: NetworkMessage,
    ) -> Result<()> {
        let sessions_guard = self.sessions.read().await;
        let session = match sessions_guard.get(session_id) {
            Some(s) => s,
            None => {
                warn!("Session {} not found", session_id);
                return Ok(());
            }
        };

        match body {
            // === Session Management ===
            NetworkMessage::SessionInfo { from, header } => {
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
                
                // Send session started event
                let event = TerminalEvent {
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)?
                        .as_secs(),
                    event_type: EventType::SessionStarted,
                    data: Vec::new(),
                };
                
                let sessions_read = self.sessions.read().await;
                if let Some(session) = sessions_read.get(session_id) {
                    let _ = session.event_sender.send(event);
                }
            }

            NetworkMessage::SessionEnd { from } => {
                info!("Session ended by {}", from.fmt_short());
                let event = TerminalEvent {
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)?
                        .as_secs(),
                    event_type: EventType::SessionEnded,
                    data: Vec::new(),
                };
                if let Err(_e) = session.event_sender.send(event) {
                    warn!("Failed to send end event to subscribers");
                }
            }

            // === Terminal Commands ===
            NetworkMessage::Command {
                from,
                command,
                request_id: _,
            } => {
                // Only host processes commands
                if !session.is_host {
                    return Ok(());
                }

                drop(sessions_guard); // Release lock before async operations

                info!(
                    "Received terminal command from {}: {:?}",
                    from.fmt_short(),
                    command
                );

                // Get callback and process command
                let callback_guard = self.terminal_input_callback.read().await;
                if let Some(callback) = &*callback_guard {
                    match command {
                        TerminalCommand::Input { terminal_id, data } => {
                            // Convert bytes to string for backward compatibility
                            let data_str = String::from_utf8_lossy(&data).to_string();
                            let _ = callback(terminal_id, data_str);
                        }
                        _ => {
                            // Other commands should be handled by dedicated callbacks
                            // For now, we'll rely on the existing event system
                            debug!("Command {:?} requires dedicated handler", command);
                        }
                    }
                }
            }

            // === Terminal Responses ===
            NetworkMessage::Response {
                from: _,
                response,
                request_id: _,
            } => {
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_secs();

                let (event_type, data) = match response {
                    TerminalResponse::Created { terminal_id, info } => {
                        info!("Terminal created: {}", terminal_id);
                        (
                            EventType::TerminalCreated {
                                terminal_id,
                                info,
                            },
                            Vec::new(),
                        )
                    }

                    TerminalResponse::Output { terminal_id, data } => {
                        debug!("Terminal output for {}: {} bytes", terminal_id, data.len());
                        (
                            EventType::TerminalOutput { terminal_id },
                            data,
                        )
                    }

                    TerminalResponse::List { terminals } => {
                        info!("Received terminal list with {} terminals", terminals.len());
                        (
                            EventType::TerminalList { terminals },
                            Vec::new(),
                        )
                    }

                    TerminalResponse::StatusUpdate { terminal_id, status } => {
                        info!("Terminal {} status: {:?}", terminal_id, status);
                        (
                            EventType::TerminalStatusUpdate {
                                terminal_id,
                                status,
                            },
                            Vec::new(),
                        )
                    }

                    TerminalResponse::DirectoryChanged { terminal_id, new_dir } => {
                        info!("Terminal {} directory changed to: {}", terminal_id, new_dir);
                        (
                            EventType::TerminalDirectoryChanged {
                                terminal_id,
                                new_dir,
                            },
                            Vec::new(),
                        )
                    }

                    TerminalResponse::Stopped { terminal_id } => {
                        info!("Terminal stopped: {}", terminal_id);
                        (
                            EventType::TerminalStopped { terminal_id },
                            Vec::new(),
                        )
                    }

                    TerminalResponse::Error { terminal_id, message } => {
                        error!("Terminal error: {:?} - {}", terminal_id, message);
                        (
                            EventType::TerminalError {
                                terminal_id,
                                error: message,
                            },
                            Vec::new(),
                        )
                    }
                };

                let event = TerminalEvent {
                    timestamp,
                    event_type,
                    data,
                };

                if session.event_sender.send(event).is_err() {
                    warn!("No active receivers for terminal response event, skipping");
                }
            }
        }

        Ok(())
    }

    pub async fn get_node_id(&self) -> String {
        self.endpoint.id().to_string()
    }

    pub async fn get_node_addr(&self) -> Result<EndpointAddr> {
        debug!("Getting node address...");
        // In iroh 0.93, node_addr() now returns NodeAddr directly
        let endpoint_addr = self.endpoint.addr();
        debug!("Got endpoint address: {:?}", endpoint_addr);
        Ok(endpoint_addr)
    }

    pub async fn connect_to_peer(&self, endpoint_addr: EndpointAddr) -> Result<()> {
        debug!("Connecting to peer: {}", endpoint_addr.id);

        // In iroh 0.93, add_node_addr() is removed.
        // Node addresses are now provided directly when connecting.
        // The endpoint will automatically use the provided addresses.
        debug!("Node address stored for peer {}", endpoint_addr.id);

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

    // === Convenience Methods (using new Command/Response system) ===

    pub async fn send_terminal_create(
        &self,
        session_id: &str,
        sender: &GossipSender,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> Result<()> {
        let command = TerminalCommand::Create {
            name,
            shell_path,
            working_dir,
            size,
        };
        self.send_command(session_id, sender, command, None).await
    }

    pub async fn send_terminal_stop(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
    ) -> Result<()> {
        let command = TerminalCommand::Stop { terminal_id };
        self.send_command(session_id, sender, command, None).await
    }

    pub async fn send_terminal_list_request(
        &self,
        session_id: &str,
        sender: &GossipSender,
    ) -> Result<()> {
        let command = TerminalCommand::List;
        self.send_command(session_id, sender, command, None).await
    }

    pub async fn send_terminal_list_response(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminals: Vec<TerminalInfo>,
    ) -> Result<()> {
        let response = TerminalResponse::List { terminals };
        self.send_response(session_id, sender, response, None).await
    }

    pub async fn send_terminal_output(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        data: Vec<u8>,
    ) -> Result<()> {
        let response = TerminalResponse::Output { terminal_id, data };
        self.send_response(session_id, sender, response, None).await
    }

    pub async fn send_terminal_input(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        data: Vec<u8>,
    ) -> Result<()> {
        let command = TerminalCommand::Input { terminal_id, data };
        self.send_command(session_id, sender, command, None).await
    }

    pub async fn send_terminal_resize(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        rows: u16,
        cols: u16,
    ) -> Result<()> {
        let command = TerminalCommand::Resize {
            terminal_id,
            rows,
            cols,
        };
        self.send_command(session_id, sender, command, None).await
    }

    pub async fn send_terminal_status_update(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        status: TerminalStatus,
    ) -> Result<()> {
        let response = TerminalResponse::StatusUpdate {
            terminal_id,
            status,
        };
        self.send_response(session_id, sender, response, None).await
    }

    pub async fn send_terminal_directory_change(
        &self,
        session_id: &str,
        sender: &GossipSender,
        terminal_id: String,
        new_dir: String,
    ) -> Result<()> {
        let response = TerminalResponse::DirectoryChanged {
            terminal_id,
            new_dir,
        };
        self.send_response(session_id, sender, response, None).await
    }
}
