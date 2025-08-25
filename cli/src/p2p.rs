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

use crate::string_compressor::StringCompressor;
use crate::terminal::{SessionHeader, SessionInfo, TerminalEvent};

pub type EncryptionKey = [u8; 32];

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
    /// New participant joined, request history
    ParticipantJoined { from: NodeId, timestamp: u64 },
    /// History data sent to new participant
    HistoryData {
        from: NodeId,
        session_info: SessionInfo,
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

#[derive(Debug)]
pub struct SharedSession {
    pub header: SessionHeader,
    pub participants: Vec<String>,
    pub is_host: bool,
    pub event_sender: broadcast::Sender<TerminalEvent>,
    pub input_sender: Option<mpsc::UnboundedSender<String>>,
    pub key: EncryptionKey,
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
            sessions: self.sessions.clone(),
            history_callback: self.history_callback.clone(),
        }
    }
}

impl P2PNetwork {
    pub async fn new(relay_url: Option<String>) -> Result<Self> {
        debug!("Initializing iroh P2P network with gossip...");

        // Create iroh endpoint with optional custom relay
        let endpoint_builder = Endpoint::builder();
        let endpoint = if let Some(relay) = relay_url {
            debug!("Using custom relay server: {}", relay);
            // Parse the relay URL and use it for discovery
            let _relay_url: Url = relay.parse()?;
            endpoint_builder
                .discovery_n0() // Use default discovery for now, custom relay setup is more complex
                .bind()
                .await?
        } else {
            debug!("Using default n0 relay server");
            endpoint_builder.discovery_n0().bind().await?
        };

        let _node_id = endpoint.node_id();
        debug!("Node ID: {}", _node_id);

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
        debug!("Creating shared session");

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
            input_sender: Some(input_sender),
            key,
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
        debug!("Joining session");

        let session_id = format!("session_{}", ticket.topic_id);
        let (event_sender, event_receiver) = broadcast::channel(1000);

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
            gossip_sender: Some(sender.clone()),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        // Start listening for messages on this topic
        self.start_topic_listener(receiver, session_id).await?;

        Ok((sender, event_receiver))
    }

    pub async fn join_session_with_retry(
        &self,
        ticket: SessionTicket,
        max_retries: u32,
    ) -> Result<(GossipSender, broadcast::Receiver<TerminalEvent>)> {
        debug!(
            "Joining session with topic: {} (with retry)",
            ticket.topic_id
        );

        let mut last_error = None;

        for attempt in 1..=max_retries {
            debug!("Connection attempt {} of {}", attempt, max_retries);

            match self.join_session(ticket.clone()).await {
                Ok(result) => {
                    debug!("✅ Successfully joined session on attempt {}", attempt);
                    return Ok(result);
                }
                Err(e) => {
                    debug!("Attempt {} failed: {}", attempt, e);
                    last_error = Some(e);

                    if attempt < max_retries {
                        debug!("Waiting before next attempt...");
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

    /// 发送参与者加入通知
    pub async fn send_participant_joined(
        &self,
        sender: &GossipSender,
        session_id: &str,
    ) -> Result<()> {
        debug!("Sending participant joined notification");
        let key = self.get_session_key(session_id).await?;
        let body = TerminalMessageBody::ParticipantJoined {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    /// 发送历史记录数据给新参与者
    pub async fn send_history_data(
        &self,
        sender: &GossipSender,
        session_info: SessionInfo,
        session_id: &str,
    ) -> Result<()> {
        debug!(
            "Sending history data: {} logs, shell: {}, cwd: {}",
            session_info.logs.len(),
            session_info.shell,
            session_info.cwd
        );
        let key = self.get_session_key(session_id).await?;
        let body = TerminalMessageBody::HistoryData {
            from: self.endpoint.node_id(),
            session_info,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;
        Ok(())
    }

    pub async fn end_session(&self, sender: &GossipSender, session_id: String) -> Result<()> {
        debug!("Ending session: {}", session_id);

        // 获取会话密钥
        let key = self.get_session_key(&session_id).await?;

        let body = TerminalMessageBody::SessionEnd {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        let message = EncryptedTerminalMessage::new(body, &key)?;
        sender.broadcast(message.to_vec()?.into()).await?;

        // 移除会话时只短暂持有写锁
        {
            let mut sessions = self.sessions.write().await;
            sessions.remove(&session_id);
        }

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
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::Output,
                        data,
                    };
                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send output event to subscribers");
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
                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send resize event to subscribers");
                    }
                }
                TerminalMessageBody::SessionEnd { from: _, timestamp } => {
                    let event = TerminalEvent {
                        timestamp: timestamp as f64,
                        event_type: crate::terminal::EventType::End,
                        data: "Session ended".to_string(),
                    };
                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send end event to subscribers");
                    }
                }
                TerminalMessageBody::SessionInfo { from, header: _ } => {
                    debug!(
                        "Received session info from {} for session: {}",
                        from.fmt_short(),
                        session_id
                    );
                }
                TerminalMessageBody::ParticipantJoined { from, timestamp: _ } => {
                    debug!(
                        "New participant {} joined session {}",
                        from.fmt_short(),
                        session_id
                    );

                    // 如果我们是主机，自动发送历史记录
                    if session.is_host {
                        debug!("We are the host, attempting to send history data");

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
                                            debug!("Got history data, sending to new participant");

                                            if let Err(e) = network_clone
                                                .send_history_data(
                                                    &sender,
                                                    session_info,
                                                    &session_id_clone,
                                                )
                                                .await
                                            {
                                                error!("Failed to send history data: {}", e);
                                            } else {
                                                debug!(
                                                    "✅ Successfully sent history data to new participant"
                                                );
                                            }
                                        }
                                        Ok(None) => {
                                            debug!("No history data available to send");
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
                    session_info,
                    timestamp: _,
                } => {
                    debug!(
                        "Received history data from {}: {} logs, shell: {}, cwd: {}",
                        from.fmt_short(),
                        session_info.logs.len(),
                        session_info.shell,
                        session_info.cwd
                    );

                    // 将历史记录作为输出事件发送给订阅者
                    let event = TerminalEvent {
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as f64,
                        event_type: crate::terminal::EventType::Output,
                        data: format!(
                            "\r\n📜 Session History (Shell: {}, CWD: {})\r\n{}\r\n--- End of History ---\r\n",
                            session_info.shell, session_info.cwd, session_info.logs
                        ),
                    };

                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send history event to subscribers");
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

    pub async fn shutdown(&self) -> Result<()> {
        self.router.shutdown().await.map_err(Into::into)
    }

    /// 批量获取活跃会话，减少锁的获取次数
    pub async fn get_active_sessions(&self) -> Vec<String> {
        self.sessions.read().await.keys().cloned().collect()
    }

    /// 检查是否为会话主机，使用短暂的读锁
    pub async fn is_session_host(&self, session_id: &str) -> bool {
        self.sessions
            .read()
            .await
            .get(session_id)
            .map(|s| s.is_host)
            .unwrap_or(false)
    }

    /// 优化的会话密钥获取方法，使用作用域减少锁的持有时间
    async fn get_session_key(&self, session_id: &str) -> Result<EncryptionKey> {
        let key = {
            let sessions = self.sessions.read().await;
            sessions.get(session_id).map(|s| s.key)
        };

        key.ok_or_else(|| anyhow::anyhow!("Session not found"))
    }

    /// 批量操作：获取会话统计信息
    pub async fn get_session_stats(&self) -> (usize, usize) {
        let sessions = self.sessions.read().await;
        let total = sessions.len();
        let hosted = sessions.values().filter(|s| s.is_host).count();
        (total, hosted)
    }

    /// 检查会话是否存在
    pub async fn session_exists(&self, session_id: &str) -> bool {
        self.sessions.read().await.contains_key(session_id)
    }

    /// 设置历史记录获取回调函数
    pub async fn set_history_callback<F>(&self, callback: F)
    where
        F: Fn(&str) -> tokio::sync::oneshot::Receiver<Option<SessionInfo>> + Send + Sync + 'static,
    {
        let mut history_callback = self.history_callback.write().await;
        *history_callback = Some(Box::new(callback));
    }

    /// 自动发送历史记录给新参与者
    pub async fn auto_send_history(&self, sender: &GossipSender, session_id: &str) -> Result<()> {
        // 检查是否为主机
        if !self.is_session_host(session_id).await {
            return Ok(());
        }

        // 获取历史记录回调
        let callback = {
            let history_callback = self.history_callback.read().await;
            history_callback.as_ref().map(|cb| cb(session_id))
        };

        if let Some(receiver) = callback {
            // 等待历史记录数据
            match receiver.await {
                Ok(Some(session_info)) => {
                    debug!("Auto-sending history data to new participant");
                    self.send_history_data(sender, session_info, session_id)
                        .await?;
                }
                Ok(None) => {
                    debug!("No history data available to send");
                }
                Err(_e) => {
                    error!("Failed to get history data");
                }
            }
        } else {
            warn!("No history callback set, cannot send history data");
        }

        Ok(())
    }

    pub async fn diagnose_connection(&self, ticket: &SessionTicket) -> Result<()> {
        debug!(
            "Diagnosing connection to session with topic: {}",
            ticket.topic_id
        );

        for (i, node) in ticket.nodes.iter().enumerate() {
            debug!(
                "Testing connection to node {}/{}: {}",
                i + 1,
                ticket.nodes.len(),
                node.node_id
            );

            // Test connection to each direct address
            if node.direct_addresses.is_empty() {
                debug!("Node has no direct addresses specified");
            }

            for (j, addr) in node.direct_addresses.iter().enumerate() {
                debug!(
                    "Testing direct address {}/{}: {}",
                    j + 1,
                    node.direct_addresses.len(),
                    addr
                );

                // Try to connect to the address
                let result = tokio::net::TcpStream::connect(addr).await;
                match result {
                    Ok(_) => debug!("✅ Successfully connected to {}", addr),
                    Err(e) => debug!("❌ Failed to connect to {}: {}", addr, e),
                }
            }

            // Test connection through endpoint
            debug!("Adding node {} to endpoint", node.node_id);
            if let Err(e) = self.endpoint.add_node_addr(node.clone()) {
                debug!("Failed to add node to endpoint: {}", e);
            } else {
                debug!("✅ Successfully added node to endpoint");
            }
        }

        Ok(())
    }
}
