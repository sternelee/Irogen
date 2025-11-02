//! TCP forwarding protocol for RiTerm
//!
//! This module implements TCP port forwarding capabilities similar to dumbpipe,
//! allowing local TCP services to be accessible through P2P connections.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// TCP forwarding configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpForwardingConfig {
    /// Local address to bind (for connect-tcp)
    pub local_addr: String,
    /// Remote host to connect to (for listen-tcp)
    pub remote_host: Option<String>,
    /// Remote port to connect to (for listen-tcp)
    pub remote_port: Option<u16>,
    /// Enable connection tracking
    pub enable_tracking: bool,
    /// Maximum concurrent connections
    pub max_connections: usize,
    /// Connection timeout in seconds
    pub connection_timeout: u64,
}

/// TCP forwarding session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpForwardingSession {
    pub id: String,
    pub local_addr: SocketAddr,
    pub remote_endpoint: String,
    pub created_at: std::time::SystemTime,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub active_connections: u32,
}

/// TCP forwarding ticket for sharing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpForwardingTicket {
    pub session_id: String,
    pub endpoint_addr: String,
    pub forwarding_type: TcpForwardingType,
    pub local_addr: String,
    pub relay_url: Option<String>,
}

/// TCP forwarding type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TcpForwardingType {
    /// Listen on local TCP, forward to remote
    ListenToRemote,
    /// Connect from local TCP, forward to remote
    ConnectToRemote,
}

/// TCP forwarding message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TcpForwardingMessage {
    /// Connection establishment request
    ConnectionRequest {
        session_id: String,
        local_addr: String,
    },
    /// Connection establishment response
    ConnectionResponse {
        session_id: String,
        success: bool,
        error: Option<String>,
    },
    /// Data forwarding
    DataForward {
        session_id: String,
        connection_id: String,
        data: Vec<u8>,
    },
    /// Connection close notification
    ConnectionClose {
        session_id: String,
        connection_id: String,
    },
    /// Session status update
    SessionStatus {
        session_id: String,
        active_connections: u32,
        bytes_sent: u64,
        bytes_received: u64,
    },
    /// Heartbeat
    Heartbeat { session_id: String },
}

/// TCP forwarding frame types
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TcpFrameType {
    /// TCP forwarding message
    TcpForwarding = 0x10,
    /// Connection management
    Connection = 0x11,
    /// Data transfer
    Data = 0x12,
    /// Control signal
    Control = 0x13,
}

/// TCP forwarding frame
#[derive(Debug, Clone)]
pub struct TcpForwardingFrame {
    pub frame_type: TcpFrameType,
    pub session_id: String,
    pub connection_id: Option<String>,
    pub payload: Vec<u8>,
}

impl TcpForwardingFrame {
    pub fn new(
        frame_type: TcpFrameType,
        session_id: String,
        connection_id: Option<String>,
        payload: Vec<u8>,
    ) -> Self {
        Self {
            frame_type,
            session_id,
            connection_id,
            payload,
        }
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut bytes = Vec::new();

        // Frame header (1 + session_id + optional connection_id + payload length)
        bytes.push(self.frame_type as u8);

        // Session ID length + session ID
        let session_id_bytes = self.session_id.as_bytes();
        bytes.push(session_id_bytes.len() as u8);
        bytes.extend_from_slice(&session_id_bytes);

        // Connection ID (optional)
        if let Some(ref conn_id) = self.connection_id {
            let conn_id_bytes = conn_id.as_bytes();
            bytes.push(conn_id_bytes.len() as u8);
            bytes.extend_from_slice(&conn_id_bytes);
        } else {
            bytes.push(0);
        }

        // Payload length + payload
        bytes.push((self.payload.len() >> 8) as u8);
        bytes.push((self.payload.len() & 0xFF) as u8);
        bytes.extend_from_slice(&self.payload);

        Ok(bytes)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 5 {
            return Err(anyhow::anyhow!("Frame too short"));
        }

        let frame_type = match bytes[0] {
            0x10 => TcpFrameType::TcpForwarding,
            0x11 => TcpFrameType::Connection,
            0x12 => TcpFrameType::Data,
            0x13 => TcpFrameType::Control,
            _ => return Err(anyhow::anyhow!("Invalid frame type: {}", bytes[0])),
        };

        let mut pos = 1;

        // Read session ID
        let session_id_len = bytes[pos] as usize;
        pos += 1;
        if pos + session_id_len > bytes.len() {
            return Err(anyhow::anyhow!("Invalid session ID length"));
        }
        let session_id = String::from_utf8(bytes[pos..pos + session_id_len].to_vec())
            .map_err(|_| anyhow::anyhow!("Invalid session ID encoding"))?;
        pos += session_id_len;

        // Read connection ID (optional)
        let conn_id_len = bytes[pos] as usize;
        pos += 1;
        let connection_id = if conn_id_len > 0 {
            if pos + conn_id_len > bytes.len() {
                return Err(anyhow::anyhow!("Invalid connection ID length"));
            }
            let conn_id = String::from_utf8(bytes[pos..pos + conn_id_len].to_vec())
                .map_err(|_| anyhow::anyhow!("Invalid connection ID encoding"))?;
            pos += conn_id_len;
            Some(conn_id)
        } else {
            pos += 1;
            None
        };

        // Read payload length
        if pos + 2 > bytes.len() {
            return Err(anyhow::anyhow!("Invalid payload length"));
        }
        let payload_len = ((bytes[pos] as usize) << 8) | (bytes[pos + 1] as usize);
        pos += 2;

        // Read payload
        if pos + payload_len > bytes.len() {
            return Err(anyhow::anyhow!("Invalid payload"));
        }
        let payload = bytes[pos..pos + payload_len].to_vec();

        Ok(Self {
            frame_type,
            session_id,
            connection_id,
            payload,
        })
    }

    /// Create a frame from a message
    pub fn from_message(
        frame_type: TcpFrameType,
        session_id: String,
        connection_id: Option<String>,
        message: TcpForwardingMessage,
    ) -> Result<Self> {
        let payload = bincode::serialize(&message)?;
        Ok(Self::new(frame_type, session_id, connection_id, payload))
    }

    /// Parse frame payload as message
    pub fn parse_payload<M: for<'de> Deserialize<'de>>(&self) -> Result<M> {
        bincode::deserialize(&self.payload).map_err(Into::into)
    }
}

/// TCP forwarding session manager
pub struct TcpForwardingManager {
    sessions: Arc<RwLock<HashMap<String, TcpForwardingSession>>>,
    connections: Arc<RwLock<HashMap<String, HashMap<String, tokio::net::TcpStream>>>>,
    config: TcpForwardingConfig,
}

impl TcpForwardingManager {
    pub fn new(config: TcpForwardingConfig) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            connections: Arc::new(RwLock::new(HashMap::new())),
            config,
        }
    }

    /// Create a new forwarding session
    pub async fn create_session(
        &self,
        forwarding_type: TcpForwardingType,
        local_addr: String,
        remote_endpoint: String,
    ) -> Result<(String, TcpForwardingTicket)> {
        let session_id = Uuid::new_v4().to_string();

        let session = TcpForwardingSession {
            id: session_id.clone(),
            local_addr: local_addr.parse()?,
            remote_endpoint: remote_endpoint.clone(),
            created_at: std::time::SystemTime::now(),
            bytes_sent: 0,
            bytes_received: 0,
            active_connections: 0,
        };

        // Store session
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
        }

        // Initialize connection map
        {
            let mut connections = self.connections.write().await;
            connections.insert(session_id.clone(), HashMap::new());
        }

        // Create ticket
        let ticket = TcpForwardingTicket {
            session_id: session_id.clone(),
            endpoint_addr: remote_endpoint,
            forwarding_type,
            local_addr,
            relay_url: None, // TODO: Add relay URL support
        };

        info!(
            "Created TCP forwarding session: {} -> {}",
            local_addr, remote_endpoint
        );
        Ok((session_id, ticket))
    }

    /// Handle incoming TCP connection
    pub async fn handle_connection(
        &self,
        session_id: &str,
        tcp_stream: tokio::net::TcpStream,
        connection_id: String,
        _quic_sender: mpsc::Sender<TcpForwardingFrame>,
    ) -> Result<()> {
        let connection_id_clone = connection_id.clone();
        let session_id_clone = session_id.to_string();

        // Store the TCP stream
        {
            let mut connections = self.connections.write().await;
            if let Some(session_connections) = connections.get_mut(session_id) {
                session_connections.insert(connection_id.clone(), tcp_stream);
            } else {
                warn!("Session {} not found", session_id);
                return Ok(());
            }
        }

        // For now, just keep the connection alive
        // In a real implementation, this would handle bidirectional data forwarding
        info!(
            "TCP connection {} established for session {}",
            connection_id, session_id
        );

        // Simulate keeping the connection alive
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        // Clean up connection
        {
            let mut connections = self.connections.write().await;
            if let Some(session_connections) = connections.get_mut(session_id) {
                session_connections.remove(&connection_id);
            }
        }

        // Update session statistics
        self.update_session_stats(session_id).await;

        Ok(())
    }

    /// Close a forwarding session
    pub async fn close_session(&self, session_id: &str) -> Result<()> {
        info!("Closing TCP forwarding session: {}", session_id);

        // Close all active connections
        {
            let mut connections = self.connections.write().await;
            if let Some(session_connections) = connections.remove(session_id) {
                for (conn_id, mut tcp_stream) in session_connections {
                    debug!("Closing TCP connection: {}", conn_id);
                    let _ = tcp_stream.shutdown().await;
                }
            }
        }

        // Remove session
        {
            let mut sessions = self.sessions.write().await;
            sessions.remove(session_id);
        }

        Ok(())
    }

    /// Get session information
    pub async fn get_session(&self, session_id: &str) -> Option<TcpForwardingSession> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).cloned()
    }

    /// List all active sessions
    pub async fn list_sessions(&self) -> Vec<TcpForwardingSession> {
        let sessions = self.sessions.read().await;
        sessions.values().cloned().collect()
    }

    /// Update session statistics
    async fn update_session_stats(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(session_id) {
            // Count active connections
            let connections = self.connections.read().await;
            if let Some(session_connections) = connections.get(session_id) {
                session.active_connections = session_connections.len() as u32;
            }
        }
    }

    /// Get connection count for a session
    pub async fn get_connection_count(&self, session_id: &str) -> usize {
        let connections = self.connections.read().await;
        connections
            .get(session_id)
            .map(|conns| conns.len())
            .unwrap_or(0)
    }
}

impl TcpForwardingTicket {
    pub fn to_string(&self) -> Result<String> {
        let serialized = bincode::serialize(self)?;
        let base32 = data_encoding::BASE32.encode(&serialized);
        Ok(format!("TF_{}", base32))
    }

    pub fn from_str(s: &str) -> Result<Self> {
        let cleaned = s.trim().replace([' ', '\n', '\r', '\t'], "");

        if !cleaned.starts_with("TF_") {
            return Err(anyhow::anyhow!("Invalid ticket format"));
        }

        let base32_part = &cleaned[3..];
        let bytes = data_encoding::BASE32.decode(base32_part.as_bytes())?;

        let ticket: TcpForwardingTicket = bincode::deserialize(&bytes)?;
        Ok(ticket)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tcp_forwarding_frame_serialization() {
        let frame = TcpForwardingFrame::new(
            TcpFrameType::Data,
            "session123".to_string(),
            Some("conn456".to_string()),
            b"hello world".to_vec(),
        );

        let bytes = frame.to_bytes().unwrap();
        let parsed = TcpForwardingFrame::from_bytes(&bytes).unwrap();

        assert_eq!(parsed.frame_type, TcpFrameType::Data);
        assert_eq!(parsed.session_id, "session123");
        assert_eq!(parsed.connection_id, Some("conn456".to_string()));
        assert_eq!(parsed.payload, b"hello world");
    }

    #[test]
    fn test_tcp_forwarding_ticket() {
        let ticket = TcpForwardingTicket {
            session_id: "test-session".to_string(),
            endpoint_addr: "node123".to_string(),
            forwarding_type: TcpForwardingType::ListenToRemote,
            local_addr: "localhost:8080".to_string(),
            relay_url: Some("https://relay.example.com".to_string()),
        };

        let ticket_str = ticket.to_string().unwrap();
        let parsed: TcpForwardingTicket = ticket_str.parse().unwrap();

        assert_eq!(parsed.session_id, "test-session");
        assert_eq!(parsed.endpoint_addr, "node123");
        assert_eq!(parsed.forwarding_type, TcpForwardingType::ListenToRemote);
        assert_eq!(parsed.local_addr, "localhost:8080");
        assert_eq!(
            parsed.relay_url,
            Some("https://relay.example.com".to_string())
        );
    }

    #[tokio::test]
    async fn test_tcp_forwarding_manager() {
        let config = TcpForwardingConfig {
            local_addr: "localhost:0".to_string(),
            remote_host: None,
            remote_port: None,
            enable_tracking: true,
            max_connections: 10,
            connection_timeout: 300,
        };

        let manager = TcpForwardingManager::new(config);

        // Create a session
        let (session_id, ticket) = manager
            .create_session(
                TcpForwardingType::ListenToRemote,
                "localhost:8080".to_string(),
                "node123".to_string(),
            )
            .await
            .unwrap();

        assert_eq!(ticket.session_id, session_id);
        assert!(manager.get_session(&session_id).await.is_some());

        // List sessions
        let sessions = manager.list_sessions().await;
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, session_id);

        // Close session
        manager.close_session(&session_id).await.unwrap();
        assert!(manager.get_session(&session_id).await.is_none());
    }
}
