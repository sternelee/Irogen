use anyhow::Result;
use iroh::{Endpoint, NodeAddr, NodeId};
use iroh_base::ticket::NodeTicket;
use iroh_gossip::api::GossipSender; // Keep for backward compatibility
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::{RwLock, broadcast, mpsc};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

// === Refactored Message System ===
// Organized by functional domains with proper versioning

/// Message version for compatibility and migration
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, PartialOrd)]
pub enum MessageVersion {
    V1 = 1, // Legacy format
    V2 = 2, // New structured format
}

impl Default for MessageVersion {
    fn default() -> Self {
        MessageVersion::V2
    }
}

/// Message domains for categorization and routing
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum MessageDomain {
    Session,
    Terminal,
    FileTransfer,
    PortForward, // Unified: TCP Forward + WebShare
    System,
}

/// Base message header with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageHeader {
    pub version: MessageVersion,
    pub domain: MessageDomain,
    pub from: NodeId,
    pub timestamp: u64,
    pub message_id: String, // UUID for tracking and deduplication
    pub session_id: Option<String>, // For session routing
}

impl Default for MessageHeader {
    fn default() -> Self {
        Self {
            version: MessageVersion::default(),
            domain: MessageDomain::Session,
            from: NodeId::from_bytes(&[0u8; 32]).expect("Valid NodeId"), // Will be overwritten
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            message_id: Uuid::new_v4().to_string(),
            session_id: None,
        }
    }
}

// === Domain-Specific Message Types ===

/// Session management messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionMessage {
    /// Session metadata when joining or creating session
    SessionInfo { header: SessionHeader },
    /// Session ended notification
    SessionEnd,
    /// Participant joined notification
    ParticipantJoined,
    /// Directed message to specific node
    DirectedMessage { to: NodeId, data: String },
    /// Session history data
    HistoryData { shell_type: String, working_dir: String, history: Vec<String> },
}

/// Terminal I/O messages (for virtual terminals)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalIOMessage {
    /// Terminal output data
    Output { data: String },
    /// User input data
    Input { data: String },
    /// Terminal resize
    Resize { width: u16, height: u16 },
}

/// Terminal management messages (for real terminals)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalManagementMessage {
    /// Create a new terminal request
    Create {
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    },
    /// Terminal output data
    Output { terminal_id: String, data: String },
    /// Terminal input data
    Input { terminal_id: String, data: String },
    /// Terminal resize request
    Resize { terminal_id: String, rows: u16, cols: u16 },
    /// Terminal status update
    StatusUpdate { terminal_id: String, status: TerminalStatus },
    /// Terminal directory change notification
    DirectoryChanged { terminal_id: String, new_dir: String },
    /// Stop terminal request
    Stop { terminal_id: String },
    /// List terminals request
    ListRequest,
    /// List terminals response
    ListResponse { terminals: Vec<TerminalInfo> },
}

/// File transfer messages - improved for large files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileTransferMessage {
    /// File transfer metadata (separate from actual data)
    Start {
        terminal_id: String,
        file_name: String,
        file_size: u64,
        chunk_count: Option<u32>, // For chunked transfers
        mime_type: Option<String>, // Content type hint
    },
    /// File transfer chunk data
    Chunk {
        terminal_id: String,
        file_name: String,
        chunk_index: u32,
        chunk_data: Vec<u8>,
        is_last: bool,
    },
    /// File transfer progress notification
    Progress {
        terminal_id: String,
        file_name: String,
        bytes_transferred: u64,
        total_bytes: u64,
    },
    /// File transfer completion
    Complete {
        terminal_id: String,
        file_name: String,
        file_path: String,
        file_hash: Option<String>, // For integrity verification
    },
    /// File transfer error
    Error {
        terminal_id: String,
        file_name: String,
        error_message: String,
        error_code: Option<u32>, // For machine-readable errors
    },
    /// Request to pause/resume transfer
    Control {
        terminal_id: String,
        file_name: String,
        action: TransferControlAction,
    },
}

/// Transfer control actions
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransferControlAction {
    Pause,
    Resume,
    Cancel,
}

/// Unified Port Forwarding messages (replaces separate TCP and WebShare)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PortForwardMessage {
    /// Create port forwarding service
    Create {
        service_id: String, // Unique service identifier
        local_port: u16,
        remote_port: Option<u16>, // None = auto-assign
        service_type: PortForwardType,
        service_name: String,
        terminal_id: Option<String>, // Associated terminal (if any)
        metadata: Option<HashMap<String, String>>, // Additional config
    },
    /// Port forwarding connection established
    Connected {
        service_id: String,
        assigned_remote_port: u16,
        access_url: Option<String>, // For web services
    },
    /// Port forwarding data
    Data {
        service_id: String,
        data: Vec<u8>,
    },
    /// Port forwarding status update
    StatusUpdate {
        service_id: String,
        status: PortForwardStatus,
    },
    /// Port forwarding stopped
    Stopped {
        service_id: String,
        reason: Option<String>,
    },
    /// List port forwarding services request
    ListRequest,
    /// List port forwarding services response
    ListResponse { services: Vec<PortForwardInfo> },
}

/// Types of port forwarding services
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PortForwardType {
    /// Generic TCP forwarding
    Tcp,
    /// HTTP/HTTPS service with automatic web interface
    Web,
    /// Static file serving
    Static,
    /// Reverse proxy
    Proxy,
}

impl std::fmt::Display for PortForwardType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PortForwardType::Tcp => write!(f, "TCP"),
            PortForwardType::Web => write!(f, "Web"),
            PortForwardType::Static => write!(f, "Static"),
            PortForwardType::Proxy => write!(f, "Proxy"),
        }
    }
}

/// Port forwarding status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PortForwardStatus {
    Starting,
    Active,
    Paused,
    Error(String),
    Stopped,
}

/// Port forwarding service information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardInfo {
    pub service_id: String,
    pub service_type: PortForwardType,
    pub service_name: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub access_url: Option<String>,
    pub status: PortForwardStatus,
    pub terminal_id: Option<String>,
    pub created_at: u64,
    pub connection_count: u32,
    pub bytes_transferred: u64,
}

/// System messages for health checks, stats, and errors
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SystemMessage {
    /// Stats request
    StatsRequest,
    /// Stats response
    StatsResponse {
        terminal_stats: TerminalStats,
        port_forward_stats: PortForwardStats, // Unified stats
        node_id: String,
        timestamp: u64,
    },
    /// Ping for connection health check
    Ping { sequence: u64 },
    /// Pong response to ping
    Pong { sequence: u64, timestamp: u64 },
    /// Error response
    Error {
        code: SystemErrorCode,
        message: String,
        details: Option<HashMap<String, String>>,
    },
    /// Heartbeat for connection keep-alive
    Heartbeat,
}

/// System error codes
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SystemErrorCode {
    InvalidMessage,
    UnsupportedVersion,
    SessionNotFound,
    TerminalNotFound,
    ServiceNotFound,
    PermissionDenied,
    InternalError,
    NetworkError,
}

/// Port forwarding statistics (replaces separate WebShare stats)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardStats {
    pub total: usize,
    pub active: usize,
    pub errors: usize,
    pub stopped: usize,
    pub total_connections: u32,
    pub total_bytes_transferred: u64,
}

// === Legacy Support Layer ===

/// Legacy NetworkMessage for backward compatibility
/// Contains all original message types before refactoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LegacyNetworkMessage {
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

    // === TCP Port Forwarding ===
    /// TCP forwarding request (like dumbpipe listen-tcp)
    TcpForwardCreate {
        from: NodeId,
        session_id: String,
        local_port: u16,
        remote_port: u16,
        service_name: String,
        timestamp: u64,
    },
    /// TCP forwarding connection established
    TcpForwardConnected {
        from: NodeId,
        session_id: String,
        remote_port: u16,
        timestamp: u64,
    },
    /// TCP forwarding data
    TcpForwardData {
        from: NodeId,
        session_id: String,
        remote_port: u16,
        data: Vec<u8>,
        timestamp: u64,
    },
    /// TCP forwarding stopped
    TcpForwardStopped {
        from: NodeId,
        session_id: String,
        remote_port: u16,
        timestamp: u64,
    },

    // === File Transfer ===
    /// File transfer start - contains file metadata
    FileTransferStart {
        from: NodeId,
        terminal_id: String,
        file_name: String,
        file_size: u64,
        file_data: Vec<u8>, // Base64 encoded file content
        timestamp: u64,
    },
    /// File transfer progress notification
    FileTransferProgress {
        from: NodeId,
        terminal_id: String,
        file_name: String,
        bytes_transferred: u64,
        total_bytes: u64,
        timestamp: u64,
    },
    /// File transfer completion
    FileTransferComplete {
        from: NodeId,
        terminal_id: String,
        file_name: String,
        file_path: String, // Path where file was saved on CLI side
        timestamp: u64,
    },
    /// File transfer error
    FileTransferError {
        from: NodeId,
        terminal_id: String,
        file_name: String,
        error_message: String,
        timestamp: u64,
    },

    // === WebShare Management (Legacy - now merged into PortForward) ===
    /// Create WebShare request (deprecated, use TcpForwardCreate)
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

// === Main Network Message ===

/// Network message - organized by domain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkMessage {
    /// Structured format with metadata and payload
    Structured {
        header: MessageHeader,
        payload: StructuredPayload,
    },
}

/// Structured payloads organized by domain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StructuredPayload {
    Session(SessionMessage),
    TerminalIO(TerminalIOMessage),
    TerminalManagement(TerminalManagementMessage),
    FileTransfer(FileTransferMessage),
    PortForward(PortForwardMessage),
    System(SystemMessage),
}

impl NetworkMessage {
    /// Get the message domain
    pub fn domain(&self) -> MessageDomain {
        match self {
            NetworkMessage::Structured { header, .. } => header.domain,
        }
    }

    /// Get the message header
    pub fn header(&self) -> &MessageHeader {
        match self {
            NetworkMessage::Structured { header, .. } => header,
        }
    }

    /// Get the sender node ID
    pub fn from(&self) -> NodeId {
        self.header().from
    }

    /// Get the timestamp
    pub fn timestamp(&self) -> u64 {
        self.header().timestamp
    }

    /// Get the message ID
    pub fn message_id(&self) -> &str {
        &self.header().message_id
    }

    /// Get the session ID if available
    pub fn session_id(&self) -> Option<&String> {
        self.header().session_id.as_ref()
    }

    /// Check if message is compatible with given version
    pub fn is_compatible_with(&self, version: MessageVersion) -> bool {
        self.header().version <= version
    }

    /// Create a new structured message
    pub fn new_structured<T: Into<MessageDomain>>(
        domain: T,
        from: NodeId,
        session_id: Option<String>,
        payload: StructuredPayload,
    ) -> Self {
        let header = MessageHeader {
            domain: domain.into(),
            from,
            session_id,
            ..Default::default()
        };

        NetworkMessage::Structured { header, payload }
    }

    /// Create a simple response message
    pub fn create_response(&self, payload: StructuredPayload) -> Self {
        Self::new_structured(
            self.domain(),
            self.from(),
            self.session_id().cloned(),
            payload,
        )
    }

    /// Create an error response
    pub fn create_error(
        &self,
        code: SystemErrorCode,
        message: String,
        details: Option<HashMap<String, String>>,
    ) -> Self {
        let payload = StructuredPayload::System(SystemMessage::Error { code, message, details });
        self.create_response(payload)
    }
}

// === Message Router and Handler Infrastructure ===

/// Message handler trait for processing domain-specific messages
pub trait MessageHandler: Send + Sync {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + '_>>;
    fn domain(&self) -> MessageDomain;
}

/// Message router for handling different message types
pub struct MessageRouter {
    handlers: Arc<RwLock<HashMap<MessageDomain, Arc<dyn MessageHandler>>>>,
}

impl MessageRouter {
    pub fn new() -> Self {
        Self {
            handlers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register_handler(&self, handler: Arc<dyn MessageHandler>) {
        let domain = handler.domain();
        let mut handlers = self.handlers.write().await;
        handlers.insert(domain, handler);
        info!("Registered handler for domain: {:?}", domain);
    }

    pub async fn route_message(&self, message: NetworkMessage) -> Result<()> {
        let domain = message.domain();
        let handlers = self.handlers.read().await;
        if let Some(handler) = handlers.get(&domain) {
            debug!("Routing message to handler for domain: {:?}", domain);
            handler.handle_message(message).await
        } else {
            warn!("No handler registered for domain: {:?}", domain);
            Err(anyhow::anyhow!("No handler registered for domain: {:?}", domain))
        }
    }

    pub async fn unregister_handler(&self, domain: MessageDomain) {
        let mut handlers = self.handlers.write().await;
        handlers.remove(&domain);
        info!("Unregistered handler for domain: {:?}", domain);
    }

    pub async fn list_registered_domains(&self) -> Vec<MessageDomain> {
        let handlers = self.handlers.read().await;
        handlers.keys().cloned().collect()
    }
}

impl Default for MessageRouter {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience macro for creating message handlers
#[macro_export]
macro_rules! create_message_handler {
    ($domain:expr, $handler_name:ident, $message_var:ident, $handler_body:block) => {
        struct $handler_name;
        impl $crate::p2p::MessageHandler for $handler_name {
            fn handle_message(&self, message: $crate::p2p::NetworkMessage) -> $crate::anyhow::Result<()> {
                if let $crate::p2p::NetworkMessage::Structured { payload: $message_var, .. } = message {
                    if let Some(domain_match) = $crate::p2p::match_payload_domain!($message_var, $domain) {
                        $handler_body
                        Ok(())
                    } else {
                        Err($crate::anyhow::anyhow!("Message domain mismatch"))
                    }
                } else {
                    Err($crate::anyhow::anyhow!("Expected structured message"))
                }
            }

            fn domain(&self) -> $crate::p2p::MessageDomain {
                $domain
            }
        }
    };
}

/// Macro for matching payload domains
#[macro_export]
macro_rules! match_payload_domain {
    ($payload:expr, $domain:expr) => {
        match ($payload, $domain) {
            ($crate::p2p::StructuredPayload::Session(_), $crate::p2p::MessageDomain::Session) => Some(true),
            ($crate::p2p::StructuredPayload::TerminalIO(_), $crate::p2p::MessageDomain::Terminal) => Some(true),
            ($crate::p2p::StructuredPayload::TerminalManagement(_), $crate::p2p::MessageDomain::Terminal) => Some(true),
            ($crate::p2p::StructuredPayload::FileTransfer(_), $crate::p2p::MessageDomain::FileTransfer) => Some(true),
            ($crate::p2p::StructuredPayload::PortForward(_), $crate::p2p::MessageDomain::PortForward) => Some(true),
            ($crate::p2p::StructuredPayload::System(_), $crate::p2p::MessageDomain::System) => Some(true),
            _ => None,
        }
    };
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

/// ALPN for riterm protocol
pub const ALPN: &[u8] = b"RITERMV0";

/// Handshake for terminal connections
pub const HANDSHAKE: &[u8] = b"riterm_hello";

/// Forward compatibility with dumbpipe
// NodeTicket is already imported and available

// === Network Layer Messages ===
// These are transmitted over direct P2P connections
// Legacy NetworkMessage has been moved to LegacyNetworkMessage above

/// Enhanced message wrapper for direct P2P transmission with version support
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2PMessage {
    pub body: NetworkMessage,
    pub version: MessageVersion,
    pub compression: Option<String>, // Future: compression algorithm
}

impl P2PMessage {
    pub fn new(body: NetworkMessage) -> Self {
        Self {
            body,
            version: MessageVersion::V2,
            compression: None,
        }
    }

    pub fn with_version(body: NetworkMessage, version: MessageVersion) -> Self {
        Self {
            body,
            version,
            compression: None,
        }
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self).map_err(Into::into)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        bincode::deserialize(bytes).map_err(Into::into)
    }

    /// Check if message is compatible with current version
    pub fn is_compatible(&self) -> bool {
        self.body.is_compatible_with(self.version)
    }

    /// Get the message domain
    pub fn domain(&self) -> MessageDomain {
        self.body.domain()
    }

    /// Get message timestamp
    pub fn timestamp(&self) -> u64 {
        self.body.timestamp()
    }

    /// Get message ID
    pub fn message_id(&self) -> &str {
        self.body.message_id()
    }
}

impl Default for P2PMessage {
    fn default() -> Self {
        Self {
            body: NetworkMessage::Structured {
                header: MessageHeader::default(),
                payload: StructuredPayload::System(SystemMessage::Heartbeat),
            },
            version: MessageVersion::V2,
            compression: None,
        }
    }
}

// === Migration and Compatibility Tools ===


// === Message Builder for Convenience ===

/// Builder pattern for creating structured messages
pub struct MessageBuilder {
    header: MessageHeader,
}

impl MessageBuilder {
    pub fn new() -> Self {
        Self {
            header: MessageHeader::default(),
        }
    }

    pub fn from_node(mut self, node_id: NodeId) -> Self {
        self.header.from = node_id;
        self
    }

    pub fn for_session(mut self, session_id: String) -> Self {
        self.header.session_id = Some(session_id);
        self
    }

    pub fn with_domain(mut self, domain: MessageDomain) -> Self {
        self.header.domain = domain;
        self
    }

    pub fn with_version(mut self, version: MessageVersion) -> Self {
        self.header.version = version;
        self
    }

    pub fn build(self, payload: StructuredPayload) -> NetworkMessage {
        NetworkMessage::Structured {
            header: self.header,
            payload,
        }
    }

    pub fn build_p2p(self, payload: StructuredPayload) -> P2PMessage {
        P2PMessage::new(self.build(payload))
    }
}

impl Default for MessageBuilder {
    fn default() -> Self {
        Self::new()
    }
}

// === Common Message Patterns ===

/// Common message creation utilities
pub struct MessageFactory;

impl MessageFactory {
    /// Create a session info message
    pub fn session_info(from: NodeId, header: SessionHeader) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::Session)
            .build(StructuredPayload::Session(SessionMessage::SessionInfo { header }))
    }

    /// Create a terminal output message
    pub fn terminal_output(from: NodeId, terminal_id: String, data: String) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Output {
                terminal_id,
                data,
            }))
    }

    /// Create a file transfer start message
    pub fn file_transfer_start(
        from: NodeId,
        terminal_id: String,
        file_name: String,
        file_size: u64,
    ) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::FileTransfer)
            .build(StructuredPayload::FileTransfer(FileTransferMessage::Start {
                terminal_id,
                file_name,
                file_size,
                chunk_count: None,
                mime_type: None,
            }))
    }

    /// Create a port forwarding service (unified TCP + WebShare)
    pub fn create_port_forward(
        from: NodeId,
        service_id: String,
        local_port: u16,
        remote_port: Option<u16>,
        service_type: PortForwardType,
        service_name: String,
    ) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Create {
                service_id,
                local_port,
                remote_port,
                service_type,
                service_name,
                terminal_id: None,
                metadata: None,
            }))
    }

    /// Create a web service (convenience method)
    pub fn create_web_service(
        from: NodeId,
        service_id: String,
        local_port: u16,
        public_port: Option<u16>,
        service_name: String,
        terminal_id: Option<String>,
    ) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Create {
                service_id,
                local_port,
                remote_port: public_port,
                service_type: PortForwardType::Web,
                service_name,
                terminal_id,
                metadata: None,
            }))
    }

    /// Create a system error message
    pub fn system_error(
        from: NodeId,
        code: SystemErrorCode,
        message: String,
        details: Option<HashMap<String, String>>,
    ) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::System)
            .build(StructuredPayload::System(SystemMessage::Error {
                code,
                message,
                details,
            }))
    }

    /// Create a ping message for health checks
    pub fn ping(from: NodeId, sequence: u64) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::System)
            .build(StructuredPayload::System(SystemMessage::Ping { sequence }))
    }

    /// Create a terminal input message
    pub fn terminal_input(from: NodeId, data: String) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalIO(TerminalIOMessage::Input { data }))
    }

    /// Create a terminal resize message
    pub fn terminal_resize(from: NodeId, terminal_id: String, rows: u16, cols: u16) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .for_session(terminal_id)
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalIO(TerminalIOMessage::Resize {
                width: cols,
                height: rows
            }))
    }

    /// Create a session info request message (using SessionInfo with empty header)
    pub fn session_info_request(from: NodeId, session_id: String) -> NetworkMessage {
        let header = SessionHeader {
            version: 2,
            width: 80,
            height: 24,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            title: None,
            command: None,
            session_id: session_id.clone(),
        };
        MessageBuilder::new()
            .from_node(from)
            .for_session(session_id)
            .with_domain(MessageDomain::Session)
            .build(StructuredPayload::Session(SessionMessage::SessionInfo { header }))
    }

    /// Create a terminal create request
    pub fn terminal_create_request(
        from: NodeId,
        session_id: String,
        name: Option<String>,
        shell: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    ) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .for_session(session_id)
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Create {
                name,
                shell_path: shell,
                working_dir,
                size,
            }))
    }

    /// Create a terminal stop request
    pub fn terminal_stop_request(from: NodeId, session_id: String, terminal_id: String) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .for_session(session_id)
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Stop {
                terminal_id
            }))
    }

    /// Create a terminal list request
    pub fn terminal_list_request(from: NodeId, session_id: String) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .for_session(session_id)
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::ListRequest))
    }

    /// Create a terminal list response
    pub fn terminal_list_response(from: NodeId, session_id: String, terminals: Vec<TerminalInfo>) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .for_session(session_id)
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::ListResponse { terminals }))
    }

    /// Create a web service stop request
    pub fn stop_web_service(from: NodeId, public_port: u16) -> NetworkMessage {
        let service_id = format!("webshare_{}", public_port);
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Stopped {
                service_id,
                reason: Some("Web service stopped by request".to_string()),
            }))
    }

    /// Create a port forwarding service stop request
    pub fn stop_port_forward_service(
        from: NodeId,
        service_id: String,
        reason: Option<String>,
    ) -> NetworkMessage {
        MessageBuilder::new()
            .from_node(from)
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Stopped {
                service_id,
                reason,
            }))
    }
}

// === Usage Examples and Migration Guide ===

///
/// # Message System Refactoring - Usage Examples
///
/// ## Creating New Messages
///
/// ```rust
/// use riterm_shared::p2p::*;
/// use iroh::NodeId;
///
/// let node_id = NodeId::from_bytes([1u8; 32]);
///
/// // Create a terminal output message
/// let message = MessageFactory::terminal_output(
///     node_id,
///     "terminal_123".to_string(),
///     "Hello, World!".to_string(),
/// );
///
/// // Create a port forwarding service (replaces both TCP and WebShare)
/// let port_forward = MessageFactory::create_port_forward(
///     node_id,
///     "service_456".to_string(),
///     3000,
///     Some(8080),
///     PortForwardType::Web,
///     "My Web Service".to_string(),
/// );
///
/// // Create using builder pattern
/// let custom_message = MessageBuilder::new()
///     .from_node(node_id)
///     .for_session("session_789".to_string())
///     .with_domain(MessageDomain::FileTransfer)
///     .build(StructuredPayload::FileTransfer(FileTransferMessage::Start {
///         terminal_id: "terminal_123".to_string(),
///         file_name: "example.txt".to_string(),
///         file_size: 1024,
///         chunk_count: Some(1),
///         mime_type: Some("text/plain".to_string()),
///     }));
/// ```
///
/// ## Message Routing and Handling
///
/// ```rust
/// use riterm_shared::p2p::*;
/// use std::sync::Arc;
///
/// // Create a message router
/// let router = MessageRouter::new();
///
/// // Register handlers for different domains
/// let terminal_handler = Arc::new(TerminalMessageHandler);
/// router.register_handler(terminal_handler).await;
///
/// // Route messages
/// if let Some(domain) = message.domain() {
///     router.route_message(message).await?;
/// }
/// ```
///
/// ## Migration from Legacy Messages
///
/// ```rust
/// // Convert legacy messages to new format
/// let legacy_message = LegacyNetworkMessage::TerminalOutput {
///     from: node_id,
///     terminal_id: "term_123".to_string(),
///     data: "output".to_string(),
///     timestamp: 1234567890,
/// };
///
/// let new_message = NetworkMessage::from_legacy(legacy_message, node_id);
///
/// // Or use P2PMessage wrapper
/// let p2p_message = P2PMessage::new_legacy(legacy_message, node_id);
/// ```
///
/// ## Port Forwarding Unification
///
/// The new system unifies TCP forwarding and WebShare:
///
/// ```rust
/// // Old way (separate)
/// let tcp_forward = LegacyNetworkMessage::TcpForwardCreate { ... };
/// let webshare = LegacyNetworkMessage::WebShareCreate { ... };
///
/// // New way (unified)
/// let port_forward = PortForwardMessage::Create {
///     service_id: "service_123".to_string(),
///     local_port: 3000,
///     remote_port: Some(8080),
///     service_type: PortForwardType::Web, // or PortForwardType::Tcp
///     service_name: "My Service".to_string(),
///     terminal_id: None,
///     metadata: None,
/// };
/// ```
///
/// ## Version Compatibility
///
/// ```rust
/// // Create versioned messages
/// let message_v2 = P2PMessage::with_version(
///     NetworkMessage::Structured { ... },
///     MessageVersion::V2,
/// );
///
/// // Check compatibility
/// if message_v2.is_compatible() {
///     // Process message
/// }
///
/// // Ensure structured format
/// let structured = message_v2.ensure_structured(node_id)?;
/// ```
///
/// # Migration Checklist
///
/// 1. Replace individual TCP/WebShare messages with unified PortForwardMessage
/// 2. Update message creation to use MessageFactory or MessageBuilder
/// 3. Implement MessageHandler traits for each domain
/// 4. Use MessageRouter for message distribution
/// 5. Update serialization/deserialization to handle new format
/// 6. Set up proper error handling with SystemMessage::Error
/// 7. Add version checking for backward compatibility
/// 8. Test with both legacy and new message formats
/// 9. Update any existing P2P network code to use new message types
/// 10. Remove old TCP/WebShare specific code after migration is complete
///

/// Forward compatibility alias
pub type SessionTicket = NodeTicket;

/// Create a session ticket from node address and session info
pub fn create_session_ticket(node_addr: NodeAddr, _session_id: &str) -> Result<NodeTicket> {
    Ok(NodeTicket::new(node_addr))
}

pub struct SharedSession {
    pub header: SessionHeader,
    pub participants: Vec<String>,
    pub is_host: bool,
    pub event_sender: broadcast::Sender<TerminalEvent>,
    pub node_id: NodeId,
    pub input_sender: Option<mpsc::UnboundedSender<String>>,
    pub connection_sender: Option<mpsc::UnboundedSender<NetworkMessage>>,
    // Add callback fields that handlers expect
    pub history_callback: Option<Box<dyn Fn(&str) + Send + Sync>>,
    pub terminal_input_callback: Option<Box<dyn Fn(String) + Send + Sync>>,
}

pub struct P2PNetwork {
    endpoint: Endpoint,
    sessions: Arc<RwLock<HashMap<String, SharedSession>>>,
    active_connections: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<NetworkMessage>>>>,
    // Session remapping tracking
    session_mappings: Arc<RwLock<HashMap<String, String>>>, // temp_id -> host_id
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
            session_mappings: Arc::clone(&self.session_mappings),
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
    Output { data: String },
    /// User input (for virtual terminals)
    Input { data: String },
    /// Terminal resize (for virtual terminals)
    Resize { width: u16, height: u16 },
    /// Session started
    Start,
    /// Session ended
    End,
    /// History data
    HistoryData { data: String },

    // === Real Terminal Management Events ===
    /// Terminal list updated
    TerminalList { terminals: Vec<TerminalInfo> },
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
    WebShareList { webshares: Vec<WebShareInfo> },

    // === System Events ===
    /// System statistics
    Stats {
        terminal_stats: TerminalStats,
        webshare_stats: WebShareStats,
    },

    // === File Transfer Events ===
    /// File transfer started
    FileTransferStart {
        terminal_id: String,
        file_name: String,
        file_size: u64,
    },
    /// File transfer progress update
    FileTransferProgress {
        terminal_id: String,
        file_name: String,
        progress: u8,
    },
    /// File transfer completed successfully
    FileTransferComplete {
        terminal_id: String,
        file_name: String,
        file_path: String,
    },
    /// File transfer failed with error
    FileTransferError {
        terminal_id: String,
        file_name: String,
        error: String,
    },
}

/// Frontend event with timestamp and event type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: u64,
    pub event_type: EventType,
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
            session_mappings: Arc::new(RwLock::new(HashMap::new())),
            history_callback: Arc::new(RwLock::new(None)),
            terminal_input_callback: Arc::new(RwLock::new(None)),
        };

        Ok(network)
    }

    /// Create a listening session (host mode)
    pub async fn create_shared_session(
        &self,
        header: SessionHeader,
    ) -> Result<(
        NodeTicket,
        mpsc::UnboundedSender<NetworkMessage>,
        mpsc::UnboundedReceiver<String>,
    )> {
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
            history_callback: None,
            terminal_input_callback: None,
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
    ) -> Result<(
        mpsc::UnboundedSender<NetworkMessage>,
        broadcast::Receiver<TerminalEvent>,
    )> {
        info!("Joining session with node: {}", ticket.node_addr().node_id);

        // Create a temporary session ID that will be replaced when we receive SessionInfo from host
        let temp_session_id = format!("session_{}", uuid::Uuid::new_v4());
        let (event_sender, event_receiver) = broadcast::channel(1000);
        let (connection_sender, _connection_receiver) = mpsc::unbounded_channel();

        // Create session entry for this joined session with temporary session_id
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
                session_id: temp_session_id.clone(),
            },
            participants: vec![],
            is_host: false,
            event_sender: event_sender.clone(),
            node_id: self.endpoint.node_id(),
            input_sender: None,
            connection_sender: Some(connection_sender.clone()),
            history_callback: None,
            terminal_input_callback: None,
        };

        self.sessions
            .write()
            .await
            .insert(temp_session_id.clone(), session);

        let connection_sender_clone = connection_sender.clone();
        self.active_connections
            .write()
            .await
            .insert(temp_session_id.clone(), connection_sender_clone);

        // Connect to the host
        self.connect_to_host(ticket.node_addr().clone(), temp_session_id.clone())
            .await?;

        // Send ParticipantJoined message to host
        info!(
            "Sending ParticipantJoined message to host for session: {}",
            temp_session_id
        );
        self.send_participant_joined(&temp_session_id, &connection_sender)
            .await?;
        info!("✅ ParticipantJoined message sent successfully");

        // Start handling incoming messages
        let _network_clone = self.clone();
        let _session_id_clone = temp_session_id.clone();
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
                network_clone
                    .handle_connection(connection, session_id_clone)
                    .await;
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
            network_clone
                .handle_message_exchange(send, recv, session_id_clone)
                .await;
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
            network_clone
                .handle_message_exchange(send, recv, session_id_clone)
                .await;
        });

        Ok(())
    }

    /// Resolve the actual session ID (handles session remapping)
    pub async fn resolve_session_id(&self, session_id: &str) -> String {
        let mappings = self.session_mappings.read().await;
        if let Some(mapped_id) = mappings.get(session_id) {
            mapped_id.clone()
        } else {
            session_id.to_string()
        }
    }

    /// Get the remapped session ID for a temporary session ID (if any)
    pub async fn get_remapped_session_id(&self, temp_session_id: &str) -> Option<String> {
        let mappings = self.session_mappings.read().await;
        mappings.get(temp_session_id).cloned()
    }

    /// Handle message exchange for a connection
    async fn handle_message_exchange(
        &self,
        send: iroh::endpoint::SendStream,
        recv: iroh::endpoint::RecvStream,
        session_id: String,
    ) {
        let network_clone = self.clone();

        // Create a channel for outgoing messages
        let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<NetworkMessage>();

        // Store the outgoing sender for this session
        let mut connections = self.active_connections.write().await;
        connections.insert(session_id.clone(), outgoing_tx.clone());
        drop(connections);

        // Handle outgoing messages in a separate task
        let mut send = send;
        tokio::spawn(async move {
            while let Some(message) = outgoing_rx.recv().await {
                // Serialize the message
                match P2PMessage::new(message).to_bytes() {
                    Ok(data) => {
                        // Send message length first
                        let len = data.len() as u32;
                        if let Err(e) = send.write_all(&len.to_be_bytes()).await {
                            warn!("Failed to send message length: {}", e);
                            break;
                        }

                        // Send message data
                        if let Err(e) = send.write_all(&data).await {
                            warn!("Failed to send message data: {}", e);
                            break;
                        }

                        if let Err(e) = send.flush().await {
                            warn!("Failed to flush message: {}", e);
                            break;
                        }
                    }
                    Err(e) => {
                        warn!("Failed to serialize message: {}", e);
                    }
                }
            }
        });

        // Handle incoming messages
        let mut recv = recv;
        tokio::spawn(async move {
            loop {
                // Read message length
                let mut len_buf = [0u8; 4];
                match recv.read_exact(&mut len_buf).await {
                    Ok(_) => {}
                    Err(e) => {
                        debug!("Connection closed while reading message length: {}", e);
                        break;
                    }
                }

                let len = u32::from_be_bytes(len_buf) as usize;
                if len > 10 * 1024 * 1024 {
                    // 10MB limit
                    warn!("Message too large: {} bytes", len);
                    break;
                }

                let mut data = vec![0u8; len];

                // Read message data
                match recv.read_exact(&mut data).await {
                    Ok(_) => {}
                    Err(e) => {
                        warn!("Error reading message data: {}", e);
                        break;
                    }
                }

                // Resolve the actual session ID (in case of remapping)
                let actual_session_id = network_clone.resolve_session_id(&session_id).await;

                // Parse and handle message
                match P2PMessage::from_bytes(&data) {
                    Ok(p2p_msg) => {
                        if let Err(e) = network_clone
                            .handle_network_message(&actual_session_id, p2p_msg.body)
                            .await
                        {
                            error!("Error handling network message: {}", e);
                        }
                    }
                    Err(e) => {
                        warn!("Error parsing message: {}", e);
                    }
                }
            }

            // Clean up connection when done - check both original and remapped session IDs
            let remapped_id = network_clone.get_remapped_session_id(&session_id).await;
            let mut connections = network_clone.active_connections.write().await;

            // Try to remove by original session ID first
            let removed = connections.remove(&session_id).is_some();

            // If not found and we have a remapped ID, try removing by that too
            if !removed {
                if let Some(mapped_id) = remapped_id {
                    connections.remove(&mapped_id);
                    debug!(
                        "Connection cleaned up for remapped session: {} (original: {})",
                        mapped_id, session_id
                    );
                } else {
                    debug!("Connection cleaned up for session: {}", session_id);
                }
            } else {
                debug!("Connection cleaned up for session: {}", session_id);
            }
        });
    }

  
    /// Send a message over the P2P connection
    pub async fn send_message(&self, session_id: &str, message: NetworkMessage) -> Result<()> {
        // Resolve the actual session ID (in case of remapping)
        let actual_session_id = self.resolve_session_id(session_id).await;
        let connections = self.active_connections.read().await;
        if let Some(sender) = connections.get(&actual_session_id) {
            if let Err(_) = sender.send(message) {
                return Err(anyhow::anyhow!(
                    "Failed to send message - connection closed"
                ));
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
        let message = MessageFactory::terminal_input(self.endpoint.node_id(), data);
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
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .build(StructuredPayload::Session(SessionMessage::DirectedMessage { to, data }));
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
        let message = MessageFactory::terminal_resize(
            self.endpoint.node_id(),
            session_id.to_string(),
            height,
            width
        );
        self.send_message(session_id, message).await
    }

    pub async fn end_session(
        &self,
        session_id: &str,
        _sender: &mpsc::UnboundedSender<NetworkMessage>,
    ) -> Result<()> {
        info!("Ending session: {}", session_id);
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .build(StructuredPayload::Session(SessionMessage::SessionEnd));

        // Send end session message
        if let Err(e) = self.send_message(session_id, message).await {
            warn!("Failed to send session end message: {}", e);
        }

        // Clean up session - check both original and remapped session IDs
        let actual_session_id = self.resolve_session_id(session_id).await;
        self.sessions.write().await.remove(&actual_session_id);
        self.active_connections
            .write()
            .await
            .remove(&actual_session_id);

        // Also try to remove by original session ID if different
        if session_id != actual_session_id {
            self.sessions.write().await.remove(session_id);
            self.active_connections.write().await.remove(session_id);
        }
        Ok(())
    }

    pub async fn send_participant_joined(
        &self,
        session_id: &str,
        _sender: &mpsc::UnboundedSender<NetworkMessage>, // Kept for compatibility
    ) -> Result<()> {
        debug!("Sending participant joined notification");
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .build(StructuredPayload::Session(SessionMessage::ParticipantJoined));
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
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .build(StructuredPayload::Session(SessionMessage::HistoryData {
                shell_type,
                working_dir,
                history
            }));
        self.send_message(session_id, message).await
    }

    /// Handle network messages (replaces gossip message handling)
    async fn handle_network_message(&self, session_id: &str, body: NetworkMessage) -> Result<()> {
        // Use the existing gossip message handler logic but without encryption
        self.handle_gossip_message(session_id, body).await
    }

    async fn handle_gossip_message(&self, session_id: &str, body: NetworkMessage) -> Result<()> {
        let sessions_guard = self.sessions.read().await;
        if let Some(session) = sessions_guard.get(session_id) {
            match body {
                NetworkMessage::Structured { header, payload } => {
                    // Handle structured messages based on domain
                    match header.domain {
                        MessageDomain::Terminal => self.handle_terminal_message(session, header, payload).await?,
                        MessageDomain::Session => self.handle_session_message(session, header, payload).await?,
                        MessageDomain::FileTransfer => self.handle_file_transfer_message(session, header, payload).await?,
                        MessageDomain::PortForward => self.handle_port_forward_message(session, header, payload).await?,
                        MessageDomain::System => self.handle_system_message(session, header, payload).await?,
                    }
                }
            }
        } else {
            warn!("Received message for unknown session: {}", session_id);
        }
        Ok(())
    }

    async fn handle_terminal_message(&self, session: &SharedSession, header: MessageHeader, payload: StructuredPayload) -> Result<()> {
        if let StructuredPayload::TerminalIO(msg) = payload {
            match msg {
                TerminalIOMessage::Output { data } => {
                    let event = TerminalEvent {
                        timestamp: header.timestamp,
                        event_type: EventType::Output { data },
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for output event, skipping");
                    }
                }
                TerminalIOMessage::Input { data } => {
                    // Handle terminal input
                    if let Some(ref callback) = session.terminal_input_callback {
                        callback(data);
                    }
                }
                TerminalIOMessage::Resize { width, height } => {
                    // Handle terminal resize
                    debug!("Terminal resize request: {}x{}", width, height);
                }
            }
        } else if let StructuredPayload::TerminalManagement(ref msg) = payload {
            match msg {
                TerminalManagementMessage::Output { terminal_id: _, data } => {
                    let event = TerminalEvent {
                        timestamp: header.timestamp,
                        event_type: EventType::Output { data: data.clone() },
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for output event, skipping");
                    }
                }
                TerminalManagementMessage::StatusUpdate { terminal_id, status } => {
                    debug!("Terminal status update: {} -> {:?}", terminal_id, status);
                }
                TerminalManagementMessage::ListResponse { terminals } => {
                    info!("Received terminal list with {} terminals", terminals.len());
                }
                _ => {
                    debug!("Unhandled terminal management message: {:?}", msg);
                }
            }
        }
        Ok(())
    }

    async fn handle_session_message(&self, session: &SharedSession, header: MessageHeader, payload: StructuredPayload) -> Result<()> {
        if let StructuredPayload::Session(ref msg) = payload {
            match msg {
                SessionMessage::SessionInfo { header: session_header } => {
                    info!("Received session info: {:?}", session_header);
                }
                SessionMessage::SessionEnd => {
                    let event = TerminalEvent {
                        timestamp: header.timestamp,
                        event_type: EventType::End,
                    };
                    if session.event_sender.send(event).is_err() {
                        warn!("No active receivers for session end event, skipping");
                    }
                }
                SessionMessage::ParticipantJoined => {
                    info!("Participant joined - sending SessionInfo response");

                    // Send SessionInfo response with the correct session ID
                    let session_info_message = MessageBuilder::new()
                        .from_node(self.endpoint.node_id())
                        .for_session(session.header.session_id.clone())
                        .with_domain(MessageDomain::Session)
                        .build(StructuredPayload::Session(SessionMessage::SessionInfo {
                            header: session.header.clone()
                        }));

                    // Get the connection sender for this session and send the response
                    if let Some(connection_sender) = &session.connection_sender {
                        if let Err(e) = connection_sender.send(session_info_message) {
                            error!("Failed to send SessionInfo response: {}", e);
                        } else {
                            info!("✅ SessionInfo response sent successfully");
                        }
                    }
                }
                SessionMessage::HistoryData { shell_type, working_dir, history } => {
                    debug!("Received history data: {} entries", history.len());
                    // Note: history_callback handling needs to be updated
                    if let Some(ref callback) = session.history_callback {
                        // Convert to string format expected by callback
                        let data = format!("Shell: {}, Dir: {}", shell_type, working_dir);
                        callback(&data);
                    }
                }
                _ => {
                    debug!("Unhandled session message: {:?}", msg);
                }
            }
        }
        Ok(())
    }

    async fn handle_file_transfer_message(&self, _session: &SharedSession, _header: MessageHeader, payload: StructuredPayload) -> Result<()> {
        if let StructuredPayload::FileTransfer(msg) = payload {
            match msg {
                FileTransferMessage::Start { terminal_id: _, file_name, file_size, .. } => {
                    info!("File transfer started: {} ({} bytes)", file_name, file_size);
                }
                FileTransferMessage::Progress { terminal_id: _, file_name, bytes_transferred, total_bytes, .. } => {
                    let progress = (bytes_transferred * 100) / total_bytes;
                    debug!("File transfer progress: {} - {}%", file_name, progress);
                }
                FileTransferMessage::Complete { terminal_id: _, file_name, file_path, file_hash: _ } => {
                    info!("File transfer completed: {} (saved to {})", file_name, file_path);
                }
                FileTransferMessage::Error { terminal_id: _, file_name, error_message, error_code } => {
                    error!("File transfer error: {} - {} ({:?})", file_name, error_message, error_code);
                }
                _ => {}
            }
        }
        Ok(())
    }

    async fn handle_port_forward_message(&self, _session: &SharedSession, _header: MessageHeader, payload: StructuredPayload) -> Result<()> {
        if let StructuredPayload::PortForward(msg) = payload {
            match msg {
                PortForwardMessage::Create { service_id, local_port, remote_port, service_type, service_name: _, .. } => {
                    info!("Port forward created: {} ({:?}) {} -> {:?}", service_id, service_type, local_port, remote_port);
                }
                PortForwardMessage::StatusUpdate { service_id, status, .. } => {
                    info!("Port forward status update: {} -> {:?}", service_id, status);
                }
                PortForwardMessage::Stopped { service_id, .. } => {
                    info!("Port forward stopped: {}", service_id);
                }
                PortForwardMessage::Data { service_id, data } => {
                    debug!("Port forward data: {} ({} bytes)", service_id, data.len());
                }
                _ => {}
            }
        }
        Ok(())
    }

    async fn handle_system_message(&self, _session: &SharedSession, _header: MessageHeader, payload: StructuredPayload) -> Result<()> {
        if let StructuredPayload::System(msg) = payload {
            match msg {
                SystemMessage::Error { code, message, details } => {
                    error!("System error: {:?} - {} {:?}", code, message, details);
                }
                SystemMessage::Ping { sequence } => {
                    debug!("Received ping: {}", sequence);
                }
                SystemMessage::Pong { sequence, timestamp: _ } => {
                    debug!("Received pong: {}", sequence);
                }
                SystemMessage::Heartbeat => {
                    debug!("Received heartbeat");
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Get the endpoint node ID for use in messages
    pub fn local_node_id(&self) -> NodeId {
        self.endpoint.node_id()
    }

    /// Get the endpoint node ID (alias for local_node_id)
    pub async fn get_node_id(&self) -> NodeId {
        self.local_node_id()
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
        let message = MessageFactory::terminal_create_request(
            self.endpoint.node_id(),
            session_id.to_string(),
            name,
            shell_path,
            working_dir,
            size,
        );
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_stop(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        terminal_id: String,
    ) -> Result<()> {
        debug!("Sending terminal stop request");
        let message = MessageFactory::terminal_stop_request(
            self.endpoint.node_id(),
            session_id.to_string(),
            terminal_id,
        );
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_list_request(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
    ) -> Result<()> {
        debug!("Sending terminal list request");
        let message = MessageFactory::terminal_list_request(
            self.endpoint.node_id(),
            session_id.to_string(),
        );
        self.send_message(session_id, message).await
    }

    pub async fn send_terminal_list_response(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        terminals: Vec<TerminalInfo>,
    ) -> Result<()> {
        debug!("Sending terminal list response");
        let message = MessageFactory::terminal_list_response(
            self.endpoint.node_id(),
            session_id.to_string(),
            terminals,
        );
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
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Input {
                terminal_id,
                data,
            }));
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
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Resize {
                terminal_id,
                rows,
                cols,
            }));
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
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::StatusUpdate {
                terminal_id,
                status,
            }));
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
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::Terminal)
            .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::DirectoryChanged {
                terminal_id,
                new_dir,
            }));
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
        let service_id = format!("webshare_{}", &uuid::Uuid::new_v4().to_string()[..8]);
        let message = MessageFactory::create_web_service(
            self.endpoint.node_id(),
            service_id,
            local_port,
            public_port,
            service_name,
            terminal_id,
        );
        self.send_message(session_id, message).await
    }

    pub async fn send_webshare_stop(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        public_port: u16,
    ) -> Result<()> {
        debug!("Sending webshare stop request for port {}", public_port);
        let service_id = format!("webshare_{}", public_port);
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Stopped {
                service_id,
                reason: Some("WebShare stopped by request".to_string()),
            }));
        self.send_message(session_id, message).await
    }

    pub async fn send_webshare_list_request(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
    ) -> Result<()> {
        debug!("Sending webshare list request");
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::ListRequest));
        self.send_message(session_id, message).await
    }

    pub async fn send_webshare_list_response(
        &self,
        session_id: &str,
        _sender: &GossipSender, // Kept for compatibility
        webshares: Vec<WebShareInfo>,
    ) -> Result<()> {
        debug!("Sending webshare list response");
        // Convert WebShareInfo to PortForwardInfo
        let services = webshares.into_iter().map(|ws| PortForwardInfo {
            service_id: format!("webshare_{}", ws.public_port),
            service_type: PortForwardType::Web,
            service_name: ws.service_name,
            local_port: ws.local_port,
            remote_port: ws.public_port,
            access_url: Some(format!("http://localhost:{}", ws.public_port)),
            status: match ws.status {
                WebShareStatus::Starting => PortForwardStatus::Starting,
                WebShareStatus::Active => PortForwardStatus::Active,
                WebShareStatus::Error(msg) => PortForwardStatus::Error(msg),
                WebShareStatus::Stopped => PortForwardStatus::Stopped,
            },
            terminal_id: ws.terminal_id,
            created_at: ws.created_at,
            connection_count: 0, // Not tracked in old WebShareInfo
            bytes_transferred: 0, // Not tracked in old WebShareInfo
        }).collect();

        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::ListResponse { services }));
        self.send_message(session_id, message).await
    }

    pub async fn send_stats_request(&self, session_id: &str, _sender: &GossipSender) -> Result<()> {
        debug!("Sending stats request");
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::System)
            .build(StructuredPayload::System(SystemMessage::StatsRequest));
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
        // Convert WebShareStats to PortForwardStats
        let port_forward_stats = PortForwardStats {
            total: webshare_stats.total,
            active: webshare_stats.active,
            errors: webshare_stats.errors,
            stopped: webshare_stats.stopped,
            total_connections: 0, // Not tracked in old WebShareStats
            total_bytes_transferred: 0, // Not tracked in old WebShareStats
        };

        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::System)
            .build(StructuredPayload::System(SystemMessage::StatsResponse {
                terminal_stats,
                port_forward_stats,
                node_id: self.endpoint.node_id().to_string(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            }));
        self.send_message(session_id, message).await
    }

    // === TCP Port Forwarding Methods ===

    pub async fn create_tcp_forward(
        &self,
        session_id: &str,
        local_port: u16,
        remote_port: u16,
        service_name: String,
    ) -> Result<()> {
        debug!(
            "Creating TCP forward from port {} to remote port {}",
            local_port, remote_port
        );
        let service_id = format!("tcp_{}", local_port);
        let message = MessageFactory::create_port_forward(
            self.endpoint.node_id(),
            service_id,
            local_port,
            Some(remote_port),
            PortForwardType::Tcp,
            service_name,
        );
        self.send_message(session_id, message).await
    }

    pub async fn send_tcp_forward_connected(
        &self,
        session_id: &str,
        remote_port: u16,
    ) -> Result<()> {
        debug!(
            "Notifying TCP forward connected for remote port {}",
            remote_port
        );
        let service_id = format!("tcp_{}", remote_port);
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Connected {
                service_id,
                assigned_remote_port: remote_port,
                access_url: None,
            }));
        self.send_message(session_id, message).await
    }

    pub async fn send_tcp_forward_data(
        &self,
        session_id: &str,
        remote_port: u16,
        data: Vec<u8>,
    ) -> Result<()> {
        debug!(
            "Sending TCP forward data for remote port {} ({} bytes)",
            remote_port,
            data.len()
        );
        let service_id = format!("tcp_{}", remote_port);
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Data {
                service_id,
                data,
            }));
        self.send_message(session_id, message).await
    }

    pub async fn send_tcp_forward_stopped(&self, session_id: &str, remote_port: u16) -> Result<()> {
        debug!(
            "Notifying TCP forward stopped for remote port {}",
            remote_port
        );
        let service_id = format!("tcp_{}", remote_port);
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::PortForward)
            .build(StructuredPayload::PortForward(PortForwardMessage::Stopped {
                service_id,
                reason: Some("TCP forward stopped".to_string()),
            }));
        self.send_message(session_id, message).await
    }

    // === File Transfer Methods ===

    pub async fn send_file_transfer_start(
        &self,
        session_id: &str,
        terminal_id: String,
        file_name: String,
        file_data: Vec<u8>,
    ) -> Result<()> {
        debug!(
            "Sending file transfer start for {} to terminal {}",
            file_name, terminal_id
        );
        let file_size = file_data.len() as u64;
        let message = MessageFactory::file_transfer_start(
            self.endpoint.node_id(),
            terminal_id.clone(),
            file_name.clone(),
            file_size,
        );
        self.send_message(session_id, message).await
    }

    pub async fn send_file_transfer_progress(
        &self,
        session_id: &str,
        terminal_id: String,
        file_name: String,
        bytes_transferred: u64,
        total_bytes: u64,
    ) -> Result<()> {
        debug!(
            "Sending file transfer progress for {} to terminal {} ({}/{})",
            file_name, terminal_id, bytes_transferred, total_bytes
        );
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::FileTransfer)
            .build(StructuredPayload::FileTransfer(FileTransferMessage::Progress {
                terminal_id,
                file_name,
                bytes_transferred,
                total_bytes,
            }));
        self.send_message(session_id, message).await
    }

    pub async fn send_file_transfer_complete(
        &self,
        session_id: &str,
        terminal_id: String,
        file_name: String,
        file_path: String,
    ) -> Result<()> {
        debug!(
            "Sending file transfer complete for {} to terminal {} (saved to {})",
            file_name, terminal_id, file_path
        );
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::FileTransfer)
            .build(StructuredPayload::FileTransfer(FileTransferMessage::Complete {
                terminal_id,
                file_name,
                file_path,
                file_hash: None,
            }));
        self.send_message(session_id, message).await
    }

    pub async fn send_file_transfer_error(
        &self,
        session_id: &str,
        terminal_id: String,
        file_name: String,
        error_message: String,
    ) -> Result<()> {
        debug!(
            "Sending file transfer error for {} to terminal {}: {}",
            file_name, terminal_id, error_message
        );
        let message = MessageBuilder::new()
            .from_node(self.endpoint.node_id())
            .for_session(session_id.to_string())
            .with_domain(MessageDomain::FileTransfer)
            .build(StructuredPayload::FileTransfer(FileTransferMessage::Error {
                terminal_id,
                file_name,
                error_message,
                error_code: None,
            }));
        self.send_message(session_id, message).await
    }

    /// Get a receiver for all network messages (for CLI message handlers)
    pub async fn get_message_receiver(&self) -> Result<mpsc::UnboundedReceiver<NetworkMessage>> {
        let (_sender, receiver) = mpsc::unbounded_channel();

        // Create a new message receiver task that monitors all active connections
        let _connections = self.active_connections.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(100));

            loop {
                interval.tick().await;

                // This is a simplified implementation
                // In a real implementation, we would need to monitor all active connections
                // and forward their messages to the sender
                // For now, this serves as a placeholder
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        });

        Ok(receiver)
    }
}
