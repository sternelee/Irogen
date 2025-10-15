use anyhow::Result;
use iroh::{Endpoint, NodeAddr, NodeId};
use iroh_base::ticket::NodeTicket;
use iroh_gossip::api::GossipSender; // Keep for backward compatibility
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, broadcast, mpsc};
use tokio::io::AsyncWriteExt;
use tracing::{debug, error, info, warn};

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

/// ALPN for riterm protocol
pub const ALPN: &[u8] = b"RITERMV0";

/// Handshake for terminal connections
pub const HANDSHAKE: &[u8] = b"riterm_hello";

/// Forward compatibility with dumbpipe
// NodeTicket is already imported and available

// === Network Layer Messages ===
// These are transmitted over direct P2P connections

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

    // === Session History ===
    /// Session history data
    HistoryData {
        from: NodeId,
        shell_type: String,
        working_dir: String,
        history: Vec<String>,
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

    // === WebShare Management ===
    /// Create WebShare request
    WebShareCreate {
        from: NodeId,
        local_port: u16,
        public_port: Option<u16>,
        service_name: String,
        terminal_id: Option<String>,
        timestamp: u64,
    },
    /// WebShare status update
    WebShareStatusUpdate {
        from: NodeId,
        public_port: u16,
        status: WebShareStatus,
        timestamp: u64,
    },
    /// Stop WebShare request
    WebShareStop {
        from: NodeId,
        public_port: u16,
        timestamp: u64,
    },
    /// List WebShares request
    WebShareListRequest { from: NodeId, timestamp: u64 },
    /// List WebShares response
    WebShareListResponse {
        from: NodeId,
        webshares: Vec<WebShareInfo>,
        timestamp: u64,
    },

    // === System Statistics ===
    /// Stats request
    StatsRequest { from: NodeId, timestamp: u64 },
    /// Stats response
    StatsResponse {
        from: NodeId,
        terminal_stats: TerminalStats,
        webshare_stats: WebShareStats,
        node_id: String,
        timestamp: u64,
    },
}

/// Simple message wrapper for direct P2P transmission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PMessage {
    pub body: NetworkMessage,
}

impl P2PMessage {
    pub fn new(body: NetworkMessage) -> Self {
        Self { body }
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self).map_err(Into::into)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        bincode::deserialize(bytes).map_err(Into::into)
    }
}

/// Forward compatibility alias
pub type SessionTicket = NodeTicket;

/// Create a session ticket from node address and session info
pub fn create_session_ticket(node_addr: NodeAddr, _session_id: &str) -> Result<NodeTicket> {
    Ok(NodeTicket::new(node_addr))
}

#[derive(Debug)]
pub struct SharedSession {
    pub header: SessionHeader,
    pub participants: Vec<String>,
    pub is_host: bool,
    pub event_sender: broadcast::Sender<TerminalEvent>,
    pub node_id: NodeId,
    pub input_sender: Option<mpsc::UnboundedSender<String>>,
    pub connection_sender: Option<mpsc::UnboundedSender<NetworkMessage>>,
}

pub struct P2PNetwork {
    endpoint: Endpoint,
    sessions: Arc<RwLock<HashMap<String, SharedSession>>>,
    active_connections: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<NetworkMessage>>>>,
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
            sessions: Arc::clone(&self.sessions),
            active_connections: Arc::clone(&self.active_connections),
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
    /// History data
    HistoryData,

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

    // === WebShare Management Events ===
    /// WebShare created
    WebShareCreate {
        local_port: u16,
        public_port: u16,
        service_name: String,
        terminal_id: Option<String>,
    },
    /// WebShare list updated
    WebShareList(Vec<WebShareInfo>),

    // === System Events ===
    /// System statistics
    Stats {
        terminal_stats: TerminalStats,
        webshare_stats: WebShareStats,
    },
}

/// Frontend event with timestamp, event type, and optional data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: u64,
    pub event_type: EventType,
    /// Data field used for simple events (Output, Input, HistoryData)
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
    pub associated_webshares: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TerminalStatus {
    Starting,
    Running,
    Paused,
    Stopped,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalStats {
    pub total: usize,
    pub running: usize,
    pub errors: usize,
    pub stopped: usize,
}

// === WebShare Management Types ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebShareInfo {
    pub local_port: u16,
    pub public_port: u16,
    pub service_name: String,
    pub terminal_id: Option<String>,
    pub status: WebShareStatus,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WebShareStatus {
    Starting,
    Active,
    Error(String),
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebShareStats {
    pub total: usize,
    pub active: usize,
    pub errors: usize,
    pub stopped: usize,
}

impl P2PNetwork {
    pub async fn new(relay_url: Option<String>) -> Result<Self> {
        info!("Initializing iroh P2P network with direct connections...");

        // Create iroh endpoint with riterm ALPN
        let endpoint_builder = Endpoint::builder().alpns(vec![ALPN.to_vec()]);

        // Set custom relay if provided
        if let Some(relay) = relay_url {
            info!("Using custom relay server: {}", relay);
            // For now, use default discovery. Custom relay setup would require more configuration.
        }

        let endpoint = endpoint_builder.discovery_n0().bind().await?;
        let node_id = endpoint.node_id();
        info!("Node ID: {}", node_id);

        let network = Self {
            endpoint,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            active_connections: Arc::new(RwLock::new(HashMap::new())),
            history_callback: Arc::new(RwLock::new(None)),
            terminal_input_callback: Arc::new(RwLock::new(None)),
        };

        Ok(network)
    }

    /// Create a listening session (host mode)
    pub async fn create_shared_session(
        &self,
        header: SessionHeader,
    ) -> Result<(NodeTicket, mpsc::UnboundedSender<NetworkMessage>, mpsc::UnboundedReceiver<String>)> {
        let session_id = header.session_id.clone();
        info!("Creating shared session: {}", session_id);

        // Wait for endpoint to be ready
        self.endpoint.online().await;
        let node_addr = self.endpoint.node_addr();
        let ticket = NodeTicket::new(node_addr);

        let (event_sender, _event_receiver) = broadcast::channel(1000);
        let (input_sender, input_receiver) = mpsc::unbounded_channel();
        let (connection_sender, _connection_receiver) = mpsc::unbounded_channel::<NetworkMessage>();

        let session = SharedSession {
            header: header.clone(),
            participants: vec![self.endpoint.node_id().to_string()],
            is_host: true,
            event_sender: event_sender.clone(),
            node_id: self.endpoint.node_id(),
            input_sender: Some(input_sender),
            connection_sender: Some(connection_sender.clone()),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        let connection_sender_clone = connection_sender.clone();
        self.active_connections
            .write()
            .await
            .insert(session_id.clone(), connection_sender_clone);

        // Start accepting connections
        let network_clone = self.clone();
        let session_id_clone = session_id.clone();
        tokio::spawn(async move {
            network_clone.accept_connections(session_id_clone).await;
        });

        Ok((ticket, connection_sender, input_receiver))
    }

    /// Join an existing session (client mode)
    pub async fn join_session(
        &self,
        ticket: NodeTicket,
    ) -> Result<(mpsc::UnboundedSender<NetworkMessage>, broadcast::Receiver<TerminalEvent>)> {
        info!("Joining session with node: {}", ticket.node_addr().node_id);

        let session_id = format!("session_{}", uuid::Uuid::new_v4());
        let (event_sender, event_receiver) = broadcast::channel(1000);
        let (connection_sender, _connection_receiver) = mpsc::unbounded_channel();

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
            input_sender: None,
            connection_sender: Some(connection_sender.clone()),
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), session);

        let connection_sender_clone = connection_sender.clone();
        self.active_connections
            .write()
            .await
            .insert(session_id.clone(), connection_sender_clone);

        // Connect to the host
        self.connect_to_host(ticket.node_addr().clone(), session_id.clone()).await?;

        // Start handling incoming messages
        let network_clone = self.clone();
        let session_id_clone = session_id.clone();
        tokio::spawn(async move {
            // TODO: Implement connection message handling
        });

        Ok((connection_sender, event_receiver))
    }

    /// Accept incoming connections (host mode)
    async fn accept_connections(&self, session_id: String) {
        info!("Accepting connections for session: {}", session_id);

        loop {
            let Some(connecting) = self.endpoint.accept().await else {
                info!("No more incoming connections for session: {}", session_id);
                break;
            };

            let connection = match connecting.await {
                Ok(conn) => conn,
                Err(e) => {
                    warn!("Error accepting connection: {}", e);
                    continue;
                }
            };

            let remote_node_id = connection.remote_node_id();
            match remote_node_id {
                Ok(node_id) => info!("Accepted connection from: {}", node_id),
                Err(e) => warn!("Accepted connection with invalid node ID: {}", e),
            };

            // Handle this connection in a separate task
            let network_clone = self.clone();
            let session_id_clone = session_id.clone();
            tokio::spawn(async move {
                network_clone.handle_connection(connection, session_id_clone).await;
            });
        }
    }

    /// Handle a single connection
    async fn handle_connection(&self, connection: iroh::endpoint::Connection, session_id: String) {
        // Accept the first bidirectional stream
        let (mut send, mut recv) = match connection.accept_bi().await {
            Ok(stream) => stream,
            Err(e) => {
                warn!("Error accepting stream: {}", e);
                return;
            }
        };

        // Perform handshake
        let mut handshake_buf = [0u8; HANDSHAKE.len()];
        if let Err(e) = recv.read_exact(&mut handshake_buf).await {
            warn!("Error reading handshake: {}", e);
            return;
        }

        if handshake_buf != HANDSHAKE {
            warn!("Invalid handshake received");
            return;
        }

        // Send handshake response
        if let Err(e) = send.write_all(HANDSHAKE).await {
            warn!("Error sending handshake: {}", e);
            return;
        }

        // Handle message exchange
        let network_clone = self.clone();
        let session_id_clone = session_id.clone();
        tokio::spawn(async move {
            network_clone.handle_message_exchange(send, recv, session_id_clone).await;
        });
    }

    /// Connect to a host (client mode)
    async fn connect_to_host(&self, node_addr: NodeAddr, session_id: String) -> Result<()> {
        info!("Connecting to host: {}", node_addr.node_id);

        let connection = self.endpoint.connect(node_addr, ALPN).await?;
        info!("Connected to host successfully");

        let (mut send, mut recv) = connection.open_bi().await?;

        // Send handshake
        send.write_all(HANDSHAKE).await?;
        send.flush().await?;

        // Wait for handshake response
        let mut handshake_buf = [0u8; HANDSHAKE.len()];
        recv.read_exact(&mut handshake_buf).await?;

        if handshake_buf != HANDSHAKE {
            return Err(anyhow::anyhow!("Invalid handshake response"));
        }

        // Handle message exchange
        let network_clone = self.clone();
        let session_id_clone = session_id.clone();
        tokio::spawn(async move {
            network_clone.handle_message_exchange(send, recv, session_id_clone).await;
        });

        Ok(())
    }

    /// Handle message exchange for a connection
    async fn handle_message_exchange(
        &self,
        _send: iroh::endpoint::SendStream,
        mut recv: iroh::endpoint::RecvStream,
        session_id: String,
    ) {
        let network_clone = self.clone();

        // Handle outgoing messages - simplified for now
        let _network_clone = network_clone.clone();
        tokio::spawn(async move {
            // TODO: Implement proper message sending
            // For now, messages will be handled via direct calls
        });

        // Handle incoming messages
        let network_clone = self.clone();
        tokio::spawn(async move {
            loop {
                // Read message length
                let mut len_buf = [0u8; 4];
                match recv.read_exact(&mut len_buf).await {
                    Ok(_) => {},
                    Err(e) => {
                        debug!("Connection closed: {}", e);
                        break;
                    }
                }

                let len = u32::from_be_bytes(len_buf) as usize;
                let mut data = vec![0u8; len];

                // Read message data
                match recv.read_exact(&mut data).await {
                    Ok(_) => {},
                    Err(e) => {
                        warn!("Error reading message data: {}", e);
                        break;
                    }
                }

                // Parse message
                match P2PMessage::from_bytes(&data) {
                    Ok(p2p_msg) => {
                        if let Err(e) = network_clone.handle_network_message(&session_id, p2p_msg.body).await {
                            error!("Error handling network message: {}", e);
                        }
                    }
                    Err(e) => {
                        warn!("Error parsing message: {}", e);
                    }
                }
            }
        });
    }

    /// Handle incoming messages from connection queue
    async fn handle_connection_messages(&self, session_id: String, mut receiver: mpsc::UnboundedReceiver<NetworkMessage>) {
        while let Some(message) = receiver.recv().await {
            if let Err(e) = self.handle_network_message(&session_id, message).await {
                error!("Error handling connection message: {}", e);
            }
        }
    }

    /// Send a message over the P2P connection
    pub async fn send_message(
        &self,
        session_id: &str,
        message: NetworkMessage,
    ) -> Result<()> {
        let connections = self.active_connections.read().await;
        if let Some(sender) = connections.get(session_id) {
            if let Err(_) = sender.send(message) {
                return Err(anyhow::anyhow!("Failed to send message - connection closed"));
            }
        } else {
            return Err(anyhow::anyhow!("No active connection for session"));
        }
        Ok(())
    }

    pub async fn send_input(
        &self,
        session_id: &str,
        _sender: &mpsc::UnboundedSender<NetworkMessage>, // This parameter is kept for compatibility
        data: String,
    ) -> Result<()> {
        debug!("Sending input data");
        let message = NetworkMessage::Input {
            from: self.endpoint.node_id(),
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_directed_message(
        &self,
        session_id: &str,
        _sender: &mpsc::UnboundedSender<NetworkMessage>, // Kept for compatibility
        to: NodeId,
        data: String,
    ) -> Result<()> {
        debug!("Sending directed message to node: {}", to.fmt_short());
        let message = NetworkMessage::DirectedMessage {
            from: self.endpoint.node_id(),
            to,
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_resize_event(
        &self,
        session_id: &str,
        _sender: &mpsc::UnboundedSender<NetworkMessage>, // Kept for compatibility
        width: u16,
        height: u16,
    ) -> Result<()> {
        debug!("Sending resize event");
        let message = NetworkMessage::Resize {
            from: self.endpoint.node_id(),
            width,
            height,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn end_session(&self, session_id: &str, _sender: &mpsc::UnboundedSender<NetworkMessage>) -> Result<()> {
        info!("Ending session: {}", session_id);
        let message = NetworkMessage::SessionEnd {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };

        // Send end session message
        if let Err(e) = self.send_message(session_id, message).await {
            warn!("Failed to send session end message: {}", e);
        }

        // Clean up session
        self.sessions.write().await.remove(session_id);
        self.active_connections.write().await.remove(session_id);
        Ok(())
    }

    pub async fn send_participant_joined(
        &self,
        session_id: &str,
        _sender: &mpsc::UnboundedSender<NetworkMessage>, // Kept for compatibility
    ) -> Result<()> {
        debug!("Sending participant joined notification");
        let message = NetworkMessage::ParticipantJoined {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_history_data(
        &self,
        session_id: &str,
        shell_type: String,
        working_dir: String,
        history: Vec<String>,
    ) -> Result<()> {
        debug!("Sending history data");
        let message = NetworkMessage::HistoryData {
            from: self.endpoint.node_id(),
            shell_type,
            working_dir,
            history,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    /// Handle network messages (replaces gossip message handling)
    async fn handle_network_message(
        &self,
        session_id: &str,
        body: NetworkMessage,
    ) -> Result<()> {
        // Use the existing gossip message handler logic but without encryption
        self.handle_gossip_message(session_id, body).await
    }

    async fn handle_gossip_message(
        &self,
        session_id: &str,
        body: NetworkMessage,
    ) -> Result<()> {
        let sessions_guard = self.sessions.read().await;
        if let Some(session) = sessions_guard.get(session_id) {
            match body {
                NetworkMessage::Output {
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
                NetworkMessage::Input {
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
                NetworkMessage::Resize {
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
                NetworkMessage::SessionEnd { from: _, timestamp } => {
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::End,
                        data: "Session ended".to_string(),
                    };
                    if let Err(_e) = session.event_sender.send(event) {
                        warn!("Failed to send end event to subscribers");
                    }
                }
                NetworkMessage::DirectedMessage {
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
                }
                NetworkMessage::ParticipantJoined { from, timestamp } => {
                    info!("Participant {} joined session", from.fmt_short());
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!("Participant {} joined the session", from.fmt_short()),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for participant joined event, skipping");
                    }

                    // 如果我们是主机，自动发送历史记录
                    if session.is_host {
                        info!("We are the host, attempting to send history data");

                        drop(sessions_guard); // 释放锁

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
                                                session_info.shell,
                                                session_info.cwd,
                                                session_info
                                                    .logs
                                                    .lines()
                                                    .map(|s| s.to_string())
                                                    .collect(),
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
                    }
                }
                NetworkMessage::HistoryData {
                    from,
                    shell_type,
                    working_dir,
                    history,
                    timestamp,
                } => {
                    info!("Received history data from {}", from.fmt_short());

                    // Send session info event
                    let info_event = TerminalEvent {
                        timestamp,
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
                            timestamp: timestamp + (i as u64), // Slight time offset for ordering
                            event_type: EventType::HistoryData,
                            data: line.clone(),
                        };
                        if session.event_sender.send(history_event).is_err() {
                            warn!("No active receivers for history data event, skipping");
                        }
                    }

                    // Send separator
                    let separator_event = TerminalEvent {
                        timestamp: timestamp + (history.len() as u64) + 1,
                        event_type: EventType::Output,
                        data: "=== End of History ===\n".to_string(),
                    };
                    if session.event_sender.send(separator_event).is_err() {
                        warn!("No active receivers for history separator event, skipping");
                    }
                }

                // === Terminal Management Messages ===
                NetworkMessage::TerminalCreate {
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
                NetworkMessage::TerminalStatusUpdate {
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
                NetworkMessage::TerminalOutput {
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
                NetworkMessage::TerminalInput {
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

                            tokio::spawn(async move {
                                // 等待输入处理完成
                                match input_handler.await {
                                    Ok(Ok(Some(response_data))) => {
                                        // 发送终端输出响应
                                        if let Err(e) = network_clone
                                            .send_message(
                                                &session_id_clone,
                                                NetworkMessage::TerminalOutput {
                                                    from: network_clone.endpoint.node_id(),
                                                    terminal_id: terminal_id_for_output,
                                                    data: response_data,
                                                    timestamp: std::time::SystemTime::now()
                                                        .duration_since(std::time::UNIX_EPOCH)
                                                        .unwrap_or_default()
                                                        .as_secs(),
                                                },
                                            )
                                            .await
                                        {
                                            error!(
                                                "Failed to send terminal output response: {}",
                                                e
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
                        } else {
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
                                    .send_message(
                                        &session_id_clone,
                                        NetworkMessage::TerminalOutput {
                                            from: network_clone.endpoint.node_id(),
                                            terminal_id: terminal_id_clone,
                                            data: response_data,
                                            timestamp: std::time::SystemTime::now()
                                                .duration_since(std::time::UNIX_EPOCH)
                                                .unwrap_or_default()
                                                .as_secs(),
                                        },
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
                NetworkMessage::TerminalResize {
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
                NetworkMessage::TerminalDirectoryChanged {
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
                NetworkMessage::TerminalStop {
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
                NetworkMessage::TerminalListRequest { from, timestamp } => {
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
                NetworkMessage::TerminalListResponse {
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

                // === WebShare Management Messages ===
                NetworkMessage::WebShareCreate {
                    from,
                    local_port,
                    public_port,
                    service_name,
                    terminal_id,
                    timestamp,
                } => {
                    info!(
                        "Received webshare create request from {} for port {}",
                        from.fmt_short(),
                        local_port
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::WebShareCreate {
                            local_port,
                            public_port: public_port.unwrap_or(0),
                            service_name,
                            terminal_id,
                        },
                        data: String::new(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for webshare create event, skipping");
                    }
                }
                NetworkMessage::WebShareStatusUpdate {
                    from,
                    public_port,
                    status,
                    timestamp,
                } => {
                    info!(
                        "Received webshare status update from {} for port {}",
                        from.fmt_short(),
                        public_port
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!("[WebShare Status Update: {}] {:?}", public_port, status),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for webshare status update event, skipping");
                    }
                }
                NetworkMessage::WebShareStop {
                    from,
                    public_port,
                    timestamp,
                } => {
                    info!(
                        "Received webshare stop request from {} for port {}",
                        from.fmt_short(),
                        public_port
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: format!("[WebShare Stop Request] {}", public_port),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for webshare stop event, skipping");
                    }
                }
                NetworkMessage::WebShareListRequest { from, timestamp } => {
                    info!("Received webshare list request from {}", from.fmt_short());
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: "[WebShare List Request]".to_string(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for webshare list request event, skipping");
                    }
                }
                NetworkMessage::WebShareListResponse {
                    from,
                    webshares,
                    timestamp,
                } => {
                    info!(
                        "Received webshare list response from {} with {} webshares",
                        from.fmt_short(),
                        webshares.len()
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::WebShareList(webshares),
                        data: String::new(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for webshare list response event, skipping");
                    }
                }
                NetworkMessage::StatsRequest { from, timestamp } => {
                    info!("Received stats request from {}", from.fmt_short());
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Output,
                        data: "[Stats Request]".to_string(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for stats request event, skipping");
                    }
                }
                NetworkMessage::StatsResponse {
                    from,
                    terminal_stats,
                    webshare_stats,
                    node_id,
                    timestamp,
                } => {
                    info!(
                        "Received stats response from {} (node: {})",
                        from.fmt_short(),
                        &node_id[..16]
                    );
                    let event = TerminalEvent {
                        timestamp,
                        event_type: EventType::Stats {
                            terminal_stats,
                            webshare_stats,
                        },
                        data: String::new(),
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for stats response event, skipping");
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn get_node_id(&self) -> String {
        self.endpoint.node_id().to_string()
    }

    /// Get the endpoint node ID for use in messages
    pub fn local_node_id(&self) -> NodeId {
        self.endpoint.node_id()
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
        _ticket: NodeTicket, // Parameter kept for compatibility
        _session_id: &str,
    ) -> Result<NodeTicket> {
        // Get the actual node address with network information
        let node_addr = self.get_node_addr().await?;
        Ok(NodeTicket::new(node_addr))
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
        // Close all active connections
        self.active_connections.write().await.clear();
        self.sessions.write().await.clear();
        Ok(())
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
        _sender: &mpsc::UnboundedSender<NetworkMessage>, // Kept for compatibility
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> Result<()> {
        debug!("Sending terminal create request");
        let message = NetworkMessage::TerminalCreate {
            from: self.endpoint.node_id(),
            name,
            shell_path,
            working_dir,
            size,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_stop(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        terminal_id: String,
    ) -> Result<()> {
        debug!("Sending terminal stop request");
        let message = NetworkMessage::TerminalStop {
            from: self.endpoint.node_id(),
            terminal_id,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_list_request(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
    ) -> Result<()> {
        debug!("Sending terminal list request");
        let message = NetworkMessage::TerminalListRequest {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_list_response(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        terminals: Vec<TerminalInfo>,
    ) -> Result<()> {
        debug!("Sending terminal list response");
        let message = NetworkMessage::TerminalListResponse {
            from: self.endpoint.node_id(),
            terminals,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    // === Additional terminal management methods ===

    pub async fn send_terminal_input(
        &self,
        session_id: &str,
        terminal_id: String,
        data: String,
    ) -> Result<()> {
        debug!("Sending terminal input for terminal {}", terminal_id);
        let message = NetworkMessage::TerminalInput {
            from: self.endpoint.node_id(),
            terminal_id,
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_resize(
        &self,
        session_id: &str,
        terminal_id: String,
        rows: u16,
        cols: u16,
    ) -> Result<()> {
        debug!("Sending terminal resize for terminal {}", terminal_id);
        let message = NetworkMessage::TerminalResize {
            from: self.endpoint.node_id(),
            terminal_id,
            rows,
            cols,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_status_update(
        &self,
        session_id: &str,
        terminal_id: String,
        status: TerminalStatus,
    ) -> Result<()> {
        debug!(
            "Sending terminal status update for terminal {}",
            terminal_id
        );
        let message = NetworkMessage::TerminalStatusUpdate {
            from: self.endpoint.node_id(),
            terminal_id,
            status,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_directory_change(
        &self,
        session_id: &str,
        terminal_id: String,
        new_dir: String,
    ) -> Result<()> {
        debug!(
            "Sending terminal directory change for terminal {}",
            terminal_id
        );
        let message = NetworkMessage::TerminalDirectoryChanged {
            from: self.endpoint.node_id(),
            terminal_id,
            new_dir,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    // === WebShare Management Methods ===

    pub async fn send_webshare_create(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        local_port: u16,
        public_port: Option<u16>,
        service_name: String,
        terminal_id: Option<String>,
    ) -> Result<()> {
        debug!("Sending webshare create request");
        let message = NetworkMessage::WebShareCreate {
            from: self.endpoint.node_id(),
            local_port,
            public_port,
            service_name,
            terminal_id,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_webshare_stop(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        public_port: u16,
    ) -> Result<()> {
        debug!("Sending webshare stop request");
        let message = NetworkMessage::WebShareStop {
            from: self.endpoint.node_id(),
            public_port,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_webshare_list_request(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
    ) -> Result<()> {
        debug!("Sending webshare list request");
        let message = NetworkMessage::WebShareListRequest {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_webshare_list_response(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        webshares: Vec<WebShareInfo>,
    ) -> Result<()> {
        debug!("Sending webshare list response");
        let message = NetworkMessage::WebShareListResponse {
            from: self.endpoint.node_id(),
            webshares,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_stats_request(&self, session_id: &str, _sender: &GossipSender) -> Result<()> {
        debug!("Sending stats request");
        let message = NetworkMessage::StatsRequest {
            from: self.endpoint.node_id(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }

    pub async fn send_stats_response(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        terminal_stats: TerminalStats,
        webshare_stats: WebShareStats,
    ) -> Result<()> {
        debug!("Sending stats response");
        let message = NetworkMessage::StatsResponse {
            from: self.endpoint.node_id(),
            terminal_stats,
            webshare_stats,
            node_id: self.endpoint.node_id().to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };
        self.send_message(session_id, message).await
    }
}
