use anyhow::Result;
use futures::StreamExt;
use iroh::{Endpoint, NodeAddr, NodeId, protocol::Router};
use iroh_gossip::{
    api::{Event, GossipReceiver, GossipSender},
    net::Gossip,
    proto::TopicId,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast};
#[cfg(debug_assertions)]
use tracing::{debug, error, info, warn};

#[cfg(not(debug_assertions))]
use tracing::{debug, error};
#[cfg(not(debug_assertions))]
macro_rules! info {
    ($($arg:tt)*) => {};
}
#[cfg(not(debug_assertions))]
macro_rules! warn {
    ($($arg:tt)*) => {};
}
use url::Url;

use crate::crossterm_context::CrosstermContext;
use crate::string_compressor::StringCompressor;
use crate::terminal_events::TerminalEvent;

use aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};

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
        \x1B\[>[0-9;]*c            # Primary Device Attribute responses
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

/// Session information containing logs, shell type and current working directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub logs: String,
    pub shell: String,
    pub cwd: String,
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
    /// History data message (using SessionInfo structure like CLI)
    HistoryData {
        from: NodeId,
        session_info: SessionInfo,
        timestamp: u64,
    },
    /// Terminal configuration broadcast
    Configuration {
        from: NodeId,
        config_data: serde_json::Value,
        timestamp: u64,
    },
    /// Crossterm context broadcast
    CrosstermContext {
        from: NodeId,
        context: CrosstermContext,
        timestamp: u64,
    },
    /// Request crossterm context
    RequestCrosstermContext { from: NodeId, timestamp: u64 },
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
                        // Filter ANSI sequences before creating terminal event
                        if !is_only_ansi_sequences(&data) {
                            let filtered_data = filter_ansi_sequences(&data);
                            if !filtered_data.trim().is_empty() {
                                let event = TerminalEvent {
                                    timestamp: timestamp as f64,
                                    event_type: crate::terminal_events::EventType::Output,
                                    data: filtered_data,
                                };
                                if session.event_sender.send(event).is_err() {
                                    warn!("No active receivers for output event, skipping");
                                }
                            }
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
                    TerminalMessageBody::HistoryData {
                        from,
                        session_info,
                        timestamp,
                    } => {
                        info!(
                            "Received history data from {} - Shell: {}, CWD: {}, {} chars of logs",
                            from.fmt_short(),
                            session_info.shell,
                            session_info.cwd,
                            session_info.logs.len()
                        );

                        // Send welcome message with context info
                        let welcome_event = TerminalEvent {
                            timestamp: timestamp as f64,
                            event_type: crate::terminal_events::EventType::Output,
                            data: format!(
                                "\r\n🔗 Connected to remote terminal session\r\n📍 Shell: {} | Directory: {}\r\n📜 Restoring session history...\r\n\r\n",
                                session_info.shell, session_info.cwd
                            ),
                        };
                        if session.event_sender.send(welcome_event).is_err() {
                            warn!("No active receivers for welcome event, skipping");
                        }

                        // Send the complete session logs as history data
                        if !session_info.logs.trim().is_empty() {
                            let history_event = TerminalEvent {
                                timestamp: timestamp as f64 - 1.0, // Past timestamp
                                event_type: crate::terminal_events::EventType::HistoryData,
                                data: session_info.logs.clone(),
                            };
                            if session.event_sender.send(history_event).is_err() {
                                warn!("No active receivers for history data event, skipping");
                            }
                        }

                        // Send current prompt to show we're ready
                        let prompt_event = TerminalEvent {
                            timestamp: timestamp as f64 + 0.1,
                            event_type: crate::terminal_events::EventType::Output,
                            data: format!("\r\n📡 Remote session active - ready for input\r\n"),
                        };
                        if session.event_sender.send(prompt_event).is_err() {
                            warn!("No active receivers for prompt event, skipping");
                        }
                    }
                    TerminalMessageBody::Configuration {
                        from,
                        config_data,
                        timestamp,
                    } => {
                        info!("Received terminal configuration from {}", from.fmt_short());

                        // Parse and display configuration in a structured way
                        if let Ok(_config_str) = serde_json::to_string_pretty(&config_data) {
                            let event = TerminalEvent {
                                timestamp: timestamp as f64,
                                event_type: crate::terminal_events::EventType::Output,
                                data: format!(
                                    "\r\n⚙️  Terminal Configuration from {}\r\n{}\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n",
                                    from.fmt_short(),
                                    Self::format_config_display(&config_data)
                                ),
                            };

                            if session.event_sender.send(event).is_err() {
                                warn!("No active receivers for configuration event, skipping");
                            }
                        } else {
                            debug!("Failed to serialize configuration data: {:?}", config_data);
                        }
                    }
                    TerminalMessageBody::CrosstermContext {
                        from,
                        context,
                        timestamp,
                    } => {
                        use crate::crossterm_context::CrosstermContextProcessor;

                        info!(
                            "Received crossterm context from {}: {}",
                            from.fmt_short(),
                            CrosstermContextProcessor::generate_context_summary(&context)
                        );

                        // 应用上下文到当前环境（如果需要）
                        if let Err(e) =
                            CrosstermContextProcessor::apply_context_to_environment(&context)
                        {
                            warn!("Failed to apply crossterm context: {}", e);
                        }

                        // 创建格式化的显示事件
                        let event = TerminalEvent {
                            timestamp: timestamp as f64,
                            event_type: crate::terminal_events::EventType::Output,
                            data: format!(
                                "\r\n🖥️  Crossterm Context from {}\r\n{}\r\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\r\n",
                                from.fmt_short(),
                                CrosstermContextProcessor::format_context_display(&context)
                            ),
                        };

                        if session.event_sender.send(event).is_err() {
                            warn!("No active receivers for crossterm context event, skipping");
                        }
                    }
                    TerminalMessageBody::RequestCrosstermContext { from, timestamp: _ } => {
                        info!(
                            "Received crossterm context request from {}",
                            from.fmt_short()
                        );

                        // 移动端通常不作为主机，但可以显示请求信息
                        let event = TerminalEvent {
                            timestamp: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs() as f64,
                            event_type: crate::terminal_events::EventType::Output,
                            data: format!(
                                "\r\n🔍 {} requested terminal context information\r\n",
                                from.fmt_short()
                            ),
                        };

                        if session.event_sender.send(event).is_err() {
                            warn!("No active receivers for context request event, skipping");
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

    /// Format terminal configuration for display
    fn format_config_display(config_data: &serde_json::Value) -> String {
        let mut display = String::new();

        if let Some(obj) = config_data.as_object() {
            // Terminal type
            if let Some(terminal_type) = obj.get("terminal_type").and_then(|v| v.as_str()) {
                display.push_str(&format!("🖥️  Terminal: {}\r\n", terminal_type));
            }

            // Shell configuration
            if let Some(shell_config) = obj.get("shell_config").and_then(|v| v.as_object()) {
                if let Some(shell_type) = shell_config.get("shell_type").and_then(|v| v.as_str()) {
                    display.push_str(&format!("🐚 Shell: {}", shell_type));

                    if let Some(shell_path) =
                        shell_config.get("shell_path").and_then(|v| v.as_str())
                    {
                        display.push_str(&format!(" ({})", shell_path));
                    }
                    display.push_str("\r\n");
                }

                // Theme
                if let Some(theme) = shell_config.get("theme").and_then(|v| v.as_str()) {
                    display.push_str(&format!("🎨 Theme: {}\r\n", theme));
                }

                // Plugins
                if let Some(plugins) = shell_config.get("plugins").and_then(|v| v.as_array()) {
                    if !plugins.is_empty() {
                        display.push_str("🔌 Plugins: ");
                        let plugin_names: Vec<String> = plugins
                            .iter()
                            .filter_map(|v| v.as_str())
                            .map(|s| s.to_string())
                            .collect();
                        display.push_str(&plugin_names.join(", "));
                        display.push_str("\r\n");
                    }
                }
            }

            // Terminal size
            if let Some(terminal_size) = obj.get("terminal_size").and_then(|v| v.as_object()) {
                if let (Some(width), Some(height)) = (
                    terminal_size.get("width").and_then(|v| v.as_u64()),
                    terminal_size.get("height").and_then(|v| v.as_u64()),
                ) {
                    display.push_str(&format!("📏 Size: {}×{}\r\n", width, height));
                }
            }

            // System info
            if let Some(system_info) = obj.get("system_info").and_then(|v| v.as_object()) {
                if let (Some(os), Some(arch)) = (
                    system_info.get("os").and_then(|v| v.as_str()),
                    system_info.get("arch").and_then(|v| v.as_str()),
                ) {
                    display.push_str(&format!("💻 System: {} ({})", os, arch));

                    if let Some(hostname) = system_info.get("hostname").and_then(|v| v.as_str()) {
                        display.push_str(&format!(" @ {}", hostname));
                    }
                    display.push_str("\r\n");
                }

                if let Some(cwd) = system_info
                    .get("working_directory")
                    .and_then(|v| v.as_str())
                {
                    display.push_str(&format!("📁 Directory: {}\r\n", cwd));
                }
            }
        }

        if display.is_empty() {
            "Configuration data received but could not be parsed".to_string()
        } else {
            display
        }
    }
}
