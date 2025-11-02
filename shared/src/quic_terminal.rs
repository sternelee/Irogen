//! QUIC-based terminal protocol implementation
//!
//! This module implements the terminal protocol using direct QUIC connections
//! with custom ALPN protocols for low-latency interactive terminal sessions.

use crate::terminal_protocol::*;
use anyhow::Result;
use futures_util::{AsyncReadExt, AsyncWriteExt};
use iroh::endpoint::{Connecting, Connection, RecvStream, SendStream};
use iroh::protocol::AcceptError;
use iroh::{Endpoint, EndpointAddr, EndpointId, discovery::dns::DnsDiscovery, protocol::Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc, oneshot};
use tracing::{debug, error, info, warn};
use url::Url;
use uuid::Uuid;

/// QUIC terminal server configuration
#[derive(Debug, Clone)]
pub struct TerminalServerConfig {
    pub relay_url: Option<String>,
    pub bind_addr: Option<std::net::SocketAddr>,
    pub auth_required: bool,
    pub max_connections: usize,
    pub heartbeat_interval: std::time::Duration,
}

impl Default for TerminalServerConfig {
    fn default() -> Self {
        Self {
            relay_url: None,
            bind_addr: None,
            auth_required: false,
            max_connections: 100,
            heartbeat_interval: std::time::Duration::from_secs(30),
        }
    }
}

/// Terminal connection state
#[derive(Debug, Clone)]
pub struct TerminalConnection {
    pub id: String,
    pub endpoint_id: EndpointId,
    pub session_id: String,
    pub established_at: std::time::SystemTime,
    pub last_activity: std::time::SystemTime,
    pub terminal_streams: HashMap<u32, TerminalStream>,
}

/// Terminal stream information
#[derive(Debug, Clone)]
pub struct TerminalStream {
    pub terminal_id: u32,
    pub connection_id: String,
    pub name: Option<String>,
    pub shell_type: String,
    pub current_dir: String,
    pub size: (u16, u16),
    pub running: bool,
}

/// Terminal server using QUIC
pub struct TerminalServer {
    endpoint: Endpoint,
    router: Router,
    connections: Arc<RwLock<HashMap<String, TerminalConnection>>>,
    config: TerminalServerConfig,
    terminal_manager: Arc<dyn TerminalManager + Send + Sync>,
    shutdown_tx: mpsc::Sender<()>,
}

/// Trait for terminal management implementations
#[async_trait::async_trait]
pub trait TerminalManager {
    /// Create a new terminal session
    async fn create_terminal(
        &self,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: (u16, u16),
    ) -> Result<(u32, mpsc::Receiver<Vec<u8>>, mpsc::Sender<Vec<u8>>)>;

    /// List active terminals
    async fn list_terminals(&self) -> Result<Vec<TerminalStream>>;

    /// Stop a terminal session
    async fn stop_terminal(&self, terminal_id: u32) -> Result<()>;

    /// Resize a terminal
    async fn resize_terminal(&self, terminal_id: u32, rows: u16, cols: u16) -> Result<()>;

    /// Send input to a terminal
    async fn send_input(&self, terminal_id: u32, data: Vec<u8>) -> Result<()>;

    /// Get terminal info
    async fn get_terminal_info(&self, terminal_id: u32) -> Result<Option<TerminalStream>>;
}

/// Frame parser for handling incoming data
pub struct FrameParser {
    buffer: Vec<u8>,
}

impl FrameParser {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    pub fn add_data(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    pub fn try_parse_frame(&mut self) -> Option<Result<Frame>> {
        if self.buffer.len() < FrameHeader::SIZE {
            return None;
        }

        // Try to parse header first
        match FrameHeader::from_bytes(&self.buffer[..FrameHeader::SIZE]) {
            Ok(header) => {
                let total_size = FrameHeader::SIZE + header.payload_length as usize;
                if self.buffer.len() < total_size {
                    return None; // Not enough data yet
                }

                // Extract frame data
                let frame_data = self.buffer.drain(..total_size).collect::<Vec<_>>();

                // Parse frame
                match Frame::from_bytes(&frame_data) {
                    Ok(frame) => Some(Ok(frame)),
                    Err(e) => Some(Err(e)),
                }
            }
            Err(e) => Some(Err(e)),
        }
    }

    pub fn reset(&mut self) {
        self.buffer.clear();
    }
}

impl TerminalServer {
    pub async fn new(
        config: TerminalServerConfig,
        terminal_manager: Arc<dyn TerminalManager + Send + Sync>,
    ) -> Result<Self> {
        info!("Initializing QUIC terminal server...");

        // Create endpoint
        let mut endpoint_builder = Endpoint::builder();

        if let Some(relay) = &config.relay_url {
            info!("Using custom relay: {}", relay);
            let _relay_url: Url = relay.parse()?;
            endpoint_builder.discovery(DnsDiscovery::n0_dns());
        } else {
            info!("Using default relay");
            endpoint_builder.discovery(DnsDiscovery::n0_dns());
        }

        let endpoint = endpoint_builder.bind().await?;
        let node_id = endpoint.id();
        info!("Server node ID: {}", node_id);

        // Create router
        let router = Router::builder(endpoint.clone()).spawn();

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);

        let server = Self {
            endpoint,
            router,
            connections: Arc::new(RwLock::new(HashMap::new())),
            config,
            terminal_manager,
            shutdown_tx,
        };

        // Start accepting connections
        server.start_accepting_connections(shutdown_rx).await?;

        Ok(server)
    }

    async fn start_accepting_connections(&self, mut shutdown_rx: mpsc::Receiver<()>) -> Result<()> {
        let endpoint = self.endpoint.clone();
        let connections = self.connections.clone();
        let terminal_manager = self.terminal_manager.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Accept incoming connections
                    connection_result = endpoint.accept() => {
                        match connection_result {
                            Ok(mut connecting) => {
                                let alpn = connecting.alpn().to_vec();
                                debug!("Incoming connection with ALPN: {:?}", String::from_utf8_lossy(&alpn));

                                // Handle based on ALPN
                                if alpn == TERMINAL_ALPN {
                                    let conn = connections.clone();
                                    let tm = terminal_manager.clone();
                                    let cfg = config.clone();

                                    tokio::spawn(async move {
                                        if let Err(e) = Self::handle_terminal_connection(
                                            connecting,
                                            conn,
                                            tm,
                                            cfg,
                                        ).await {
                                            error!("Error handling terminal connection: {}", e);
                                        }
                                    });
                                } else if alpn == CONTROL_ALPN {
                                    let conn = connections.clone();
                                    let tm = terminal_manager.clone();

                                    tokio::spawn(async move {
                                        if let Err(e) = Self::handle_control_connection(
                                            connecting,
                                            conn,
                                            tm,
                                        ).await {
                                            error!("Error handling control connection: {}", e);
                                        }
                                    });
                                } else {
                                    warn!("Unsupported ALPN: {:?}", alpn);
                                    drop(connecting);
                                }
                            }
                            Err(e) => {
                                error!("Error accepting connection: {}", e);
                            }
                        }
                    }
                    // Handle shutdown
                    _ = shutdown_rx.recv() => {
                        info!("Shutting down connection acceptor");
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    async fn handle_terminal_connection(
        mut connecting: Connecting,
        connections: Arc<RwLock<HashMap<String, TerminalConnection>>>,
        terminal_manager: Arc<dyn TerminalManager + Send + Sync>,
        config: TerminalServerConfig,
    ) -> Result<()> {
        // Perform handshake
        let connection = connecting.await?;
        let remote_node_id = connection.remote_node_id();
        info!("Terminal connection established with: {}", remote_node_id);

        // Create connection state
        let connection_id = Uuid::new_v4().to_string();
        let session_id = format!("session_{}", Uuid::new_v4());

        let conn_state = TerminalConnection {
            id: connection_id.clone(),
            endpoint_id: remote_node_id,
            session_id: session_id.clone(),
            established_at: std::time::SystemTime::now(),
            last_activity: std::time::SystemTime::now(),
            terminal_streams: HashMap::new(),
        };

        // Store connection
        {
            let mut conns = connections.write().await;
            conns.insert(connection_id.clone(), conn_state);
        }

        // Handle the connection
        Self::handle_terminal_streams(
            connection,
            connection_id,
            session_id,
            terminal_manager,
            config,
        )
        .await
    }

    async fn handle_terminal_streams(
        connection: Connection,
        connection_id: String,
        session_id: String,
        terminal_manager: Arc<dyn TerminalManager + Send + Sync>,
        config: TerminalServerConfig,
    ) -> Result<()> {
        // Accept incoming streams
        loop {
            match connection.accept_uni().await {
                Ok(mut recv_stream) => {
                    let conn_id = connection_id.clone();
                    let session = session_id.clone();
                    let tm = terminal_manager.clone();
                    let cfg = config.clone();

                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_unidirectional_stream(
                            recv_stream,
                            conn_id,
                            session,
                            tm,
                            cfg,
                        )
                        .await
                        {
                            error!("Error handling unidirectional stream: {}", e);
                        }
                    });
                }
                Err(AcceptError::StreamClosed) => {
                    debug!("Connection closed");
                    break;
                }
                Err(e) => {
                    error!("Error accepting stream: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    async fn handle_unidirectional_stream(
        mut recv_stream: RecvStream,
        connection_id: String,
        session_id: String,
        terminal_manager: Arc<dyn TerminalManager + Send + Sync>,
        config: TerminalServerConfig,
    ) -> Result<()> {
        let mut parser = FrameParser::new();
        let mut buffer = vec![0u8; 8192];

        loop {
            match recv_stream.read(&mut buffer).await {
                Ok(0) => {
                    debug!("Stream closed");
                    break;
                }
                Ok(n) => {
                    parser.add_data(&buffer[..n]);

                    while let Some(frame_result) = parser.try_parse_frame() {
                        match frame_result {
                            Ok(frame) => {
                                if let Err(e) = Self::handle_frame(
                                    frame,
                                    &connection_id,
                                    &session_id,
                                    &terminal_manager,
                                    &config,
                                )
                                .await
                                {
                                    error!("Error handling frame: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("Error parsing frame: {}", e);
                                parser.reset();
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Error reading from stream: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    async fn handle_frame(
        frame: Frame,
        connection_id: &str,
        session_id: &str,
        terminal_manager: &Arc<dyn TerminalManager + Send + Sync>,
        config: &TerminalServerConfig,
    ) -> Result<()> {
        debug!(
            "Received frame: type={:?}, terminal_id={}",
            frame.header.frame_type, frame.header.terminal_id
        );

        match frame.header.frame_type {
            FrameType::Data => {
                // Handle terminal I/O data
                // This is typically bidirectional, so we need a response stream
                info!(
                    "Received data frame for terminal {}: {} bytes",
                    frame.header.terminal_id,
                    frame.payload.len()
                );

                // Forward to terminal manager
                if let Err(e) = terminal_manager
                    .send_input(frame.header.terminal_id, frame.payload)
                    .await
                {
                    error!("Failed to send input to terminal: {}", e);
                }
            }
            FrameType::Control => {
                // Handle control messages
                if let Ok(control_msg) = frame.parse_payload::<ControlMessage>() {
                    Self::handle_control_message(
                        frame.header.terminal_id,
                        control_msg,
                        terminal_manager,
                    )
                    .await?;
                }
            }
            FrameType::Management => {
                // Handle management messages
                if let Ok(mgmt_msg) = frame.parse_payload::<ManagementMessage>() {
                    Self::handle_management_message(
                        frame.header.terminal_id,
                        mgmt_msg,
                        terminal_manager,
                    )
                    .await?;
                }
            }
            FrameType::Heartbeat => {
                debug!(
                    "Received heartbeat from terminal {}",
                    frame.header.terminal_id
                );
            }
            FrameType::Error => {
                if let Ok(error_msg) = frame.parse_payload::<String>() {
                    error!(
                        "Received error from terminal {}: {}",
                        frame.header.terminal_id, error_msg
                    );
                }
            }
            FrameType::Handshake => {
                if let Ok(handshake) = frame.parse_payload::<HandshakeMessage>() {
                    info!(
                        "Received handshake: session_id={}, version={}",
                        handshake.session_id, handshake.protocol_version
                    );

                    // Validate handshake
                    if handshake.protocol_version != PROTOCOL_VERSION {
                        let error_frame = Frame::error(
                            frame.header.terminal_id,
                            format!(
                                "Unsupported protocol version: {}",
                                handshake.protocol_version
                            ),
                        )?;
                        // Send error response (need to establish a stream)
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_control_message(
        terminal_id: u32,
        control: ControlMessage,
        terminal_manager: &Arc<dyn TerminalManager + Send + Sync>,
    ) -> Result<()> {
        match control {
            ControlMessage::Resize { rows, cols } => {
                terminal_manager
                    .resize_terminal(terminal_id, rows, cols)
                    .await?;
            }
            ControlMessage::Signal { signal } => {
                // TODO: Implement signal handling
                warn!("Signal handling not implemented: signal={}", signal);
            }
            ControlMessage::Status { running, exit_code } => {
                info!(
                    "Terminal {} status update: running={}, exit_code={:?}",
                    terminal_id, running, exit_code
                );
            }
            ControlMessage::WorkingDir { path } => {
                info!("Terminal {} working directory: {}", terminal_id, path);
            }
        }
        Ok(())
    }

    async fn handle_management_message(
        terminal_id: u32,
        message: ManagementMessage,
        terminal_manager: &Arc<dyn TerminalManager + Send + Sync>,
    ) -> Result<()> {
        match message {
            ManagementMessage::CreateTerminal {
                name,
                shell_path,
                working_dir,
                size,
            } => {
                let (new_terminal_id, _output_rx, _input_tx) = terminal_manager
                    .create_terminal(name, shell_path, working_dir, size)
                    .await?;

                info!("Created terminal: {}", new_terminal_id);

                // TODO: Send terminal info response back to client
            }
            ManagementMessage::ListTerminals => {
                let terminals = terminal_manager.list_terminals().await?;
                info!("Listing {} terminals", terminals.len());

                // TODO: Send terminal list response back to client
            }
            ManagementMessage::TerminalInfo {
                id,
                name,
                shell_type,
                current_dir,
                size,
                running,
            } => {
                info!(
                    "Terminal info: id={}, name={:?}, shell={}, dir={}, size={:?}, running={}",
                    id, name, shell_type, current_dir, size, running
                );
            }
            ManagementMessage::StopTerminal { id } => {
                terminal_manager.stop_terminal(id).await?;
                info!("Stopped terminal: {}", id);
            }
            ManagementMessage::Error { message } => {
                error!("Management error: {}", message);
            }
        }
        Ok(())
    }

    async fn handle_control_connection(
        mut connecting: Connecting,
        connections: Arc<RwLock<HashMap<String, TerminalConnection>>>,
        terminal_manager: Arc<dyn TerminalManager + Send + Sync>,
    ) -> Result<()> {
        // Handle control plane connections
        let connection = connecting.await?;
        let remote_node_id = connection.remote_node_id();
        info!("Control connection established with: {}", remote_node_id);

        // Accept bidirectional streams for control messages
        loop {
            match connection.accept_bi().await {
                Ok((mut send_stream, mut recv_stream)) => {
                    let tm = terminal_manager.clone();

                    tokio::spawn(async move {
                        if let Err(e) =
                            Self::handle_control_stream(send_stream, recv_stream, tm).await
                        {
                            error!("Error handling control stream: {}", e);
                        }
                    });
                }
                Err(AcceptError::StreamClosed) => {
                    debug!("Control connection closed");
                    break;
                }
                Err(e) => {
                    error!("Error accepting control stream: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    async fn handle_control_stream(
        mut send_stream: SendStream,
        mut recv_stream: RecvStream,
        terminal_manager: Arc<dyn TerminalManager + Send + Sync>,
    ) -> Result<()> {
        let mut parser = FrameParser::new();
        let mut buffer = vec![0u8; 8192];

        loop {
            match recv_stream.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => {
                    parser.add_data(&buffer[..n]);

                    while let Some(frame_result) = parser.try_parse_frame() {
                        match frame_result {
                            Ok(frame) => {
                                // Handle control frames and send responses
                                let response =
                                    Self::process_control_frame(frame, &terminal_manager).await?;

                                if let Some(resp_frame) = response {
                                    let data = resp_frame.to_bytes();
                                    send_stream.write_all(&data).await?;
                                }
                            }
                            Err(e) => {
                                error!("Error parsing control frame: {}", e);
                                parser.reset();
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("Error reading control stream: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    async fn process_control_frame(
        frame: Frame,
        terminal_manager: &Arc<dyn TerminalManager + Send + Sync>,
    ) -> Result<Option<Frame>> {
        match frame.header.frame_type {
            FrameType::Management => {
                if let Ok(mgmt_msg) = frame.parse_payload::<ManagementMessage>() {
                    Self::handle_management_message_async(
                        frame.header.terminal_id,
                        mgmt_msg,
                        terminal_manager,
                    )
                    .await?;
                }
            }
            _ => {
                warn!(
                    "Unexpected frame type in control stream: {:?}",
                    frame.header.frame_type
                );
            }
        }
        Ok(None) // Control frames typically don't need immediate responses
    }

    async fn handle_management_message_async(
        terminal_id: u32,
        message: ManagementMessage,
        terminal_manager: &Arc<dyn TerminalManager + Send + Sync>,
    ) -> Result<()> {
        // This is similar to the synchronous version but can be called from async contexts
        Self::handle_management_message(terminal_id, message, terminal_manager).await
    }

    /// Generate a ticket for clients to connect
    pub async fn generate_ticket(&self) -> Result<TerminalTicket> {
        let endpoint_addr = self.endpoint.addr();
        let session_id = Uuid::new_v4().to_string();

        Ok(TerminalTicket {
            session_id,
            endpoint_addr: endpoint_addr.to_string(),
            auth_token: None, // TODO: Implement authentication
            relay_url: self.config.relay_url.clone(),
        })
    }

    /// Get server endpoint address
    pub async fn get_endpoint_addr(&self) -> Result<EndpointAddr> {
        Ok(self.endpoint.addr())
    }

    /// Get server node ID
    pub fn node_id(&self) -> EndpointId {
        self.endpoint.id()
    }

    /// Shutdown the server
    pub async fn shutdown(&self) -> Result<()> {
        let _ = self.shutdown_tx.send(()).await;
        self.router.shutdown().await?;
        Ok(())
    }
}

/// QUIC terminal client
pub struct TerminalClient {
    endpoint: Endpoint,
    connections: Arc<RwLock<HashMap<String, Connection>>>,
}

impl TerminalClient {
    pub async fn new(relay_url: Option<String>) -> Result<Self> {
        info!("Initializing QUIC terminal client...");

        let mut endpoint_builder = Endpoint::builder();

        if let Some(relay) = relay_url {
            let _relay_url: Url = relay.parse()?;
            endpoint_builder.discovery(DnsDiscovery::n0_dns());
        } else {
            endpoint_builder.discovery(DnsDiscovery::n0_dns());
        }

        let endpoint = endpoint_builder.bind().await?;
        let node_id = endpoint.id();
        info!("Client node ID: {}", node_id);

        Ok(Self {
            endpoint,
            connections: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Connect to a terminal server
    pub async fn connect(&self, ticket: &TerminalTicket) -> Result<TerminalSession> {
        info!("Connecting to terminal server...");

        // Parse endpoint address
        let endpoint_addr: EndpointAddr = ticket
            .endpoint_addr
            .parse()
            .map_err(|e| anyhow::anyhow!("Invalid endpoint address: {}", e))?;

        // Connect to server
        let connection = self.endpoint.connect(endpoint_addr, TERMINAL_ALPN).await?;
        let remote_node_id = connection.remote_node_id();
        info!("Connected to server: {}", remote_node_id);

        // Perform handshake
        let session_id = ticket.session_id.clone();
        let handshake = HandshakeMessage {
            protocol_version: PROTOCOL_VERSION,
            session_id: session_id.clone(),
            capabilities: vec!["terminal".to_string(), "control".to_string()],
            auth_token: ticket.auth_token.clone(),
        };

        let handshake_frame = Frame::handshake(0, handshake)?;
        let mut send_stream = connection.open_uni().await?;
        send_stream.write_all(&handshake_frame.to_bytes()).await?;
        send_stream.finish().await?;

        // Store connection
        {
            let mut connections = self.connections.write().await;
            connections.insert(session_id.clone(), connection);
        }

        Ok(TerminalSession {
            id: session_id,
            terminal_id: 0, // Will be assigned by server
            name: None,
            shell_type: "unknown".to_string(),
            current_dir: "/".to_string(),
            size: (24, 80),
            running: false,
            created_at: std::time::SystemTime::now(),
        })
    }

    /// Create a new terminal on the server
    pub async fn create_terminal(
        &self,
        session_id: &str,
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: (u16, u16),
    ) -> Result<u32> {
        let connections = self.connections.read().await;
        let connection = connections
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let message = ManagementMessage::CreateTerminal {
            name,
            shell_path,
            working_dir,
            size,
        };

        let frame = Frame::management(0, message)?;
        let mut send_stream = connection.open_uni().await?;
        send_stream.write_all(&frame.to_bytes()).await?;
        send_stream.finish().await?;

        // TODO: Wait for response with terminal ID
        Ok(1) // Placeholder
    }

    /// Send input to a terminal
    pub async fn send_terminal_input(
        &self,
        session_id: &str,
        terminal_id: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        let connections = self.connections.read().await;
        let connection = connections
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found"))?;

        let frame = Frame::data(terminal_id, data);
        let mut send_stream = connection.open_uni().await?;
        send_stream.write_all(&frame.to_bytes()).await?;
        send_stream.finish().await?;

        Ok(())
    }

    /// Disconnect from a session
    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        let mut connections = self.connections.write().await;
        if let Some(connection) = connections.remove(session_id) {
            connection.close(0u8.into(), b"Client disconnect");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // TODO: Add integration tests for the QUIC terminal protocol
}
