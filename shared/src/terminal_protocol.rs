//! Custom terminal protocol over QUIC streams
//!
//! This module defines a custom ALPN protocol for terminal sessions that uses
//! direct QUIC streams instead of gossip for low-latency interactive terminal I/O.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// ALPN protocol identifiers
pub const TERMINAL_ALPN: &[u8] = b"com.riterm.terminal/1";
pub const CONTROL_ALPN: &[u8] = b"com.riterm.control/1";

/// Protocol version
pub const PROTOCOL_VERSION: u8 = 1;

/// Maximum frame size (1MB)
pub const MAX_FRAME_SIZE: usize = 1024 * 1024;

/// Frame types for the terminal protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameType {
    /// Terminal data (input/output)
    Data = 0x01,
    /// Terminal control signals (resize, signals)
    Control = 0x02,
    /// Terminal management (create, list, stop)
    Management = 0x03,
    /// Heartbeat/ping
    Heartbeat = 0x04,
    /// Error message
    Error = 0x05,
    /// Session handshake
    Handshake = 0x06,
}

impl TryFrom<u8> for FrameType {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            0x01 => Ok(FrameType::Data),
            0x02 => Ok(FrameType::Control),
            0x03 => Ok(FrameType::Management),
            0x04 => Ok(FrameType::Heartbeat),
            0x05 => Ok(FrameType::Error),
            0x06 => Ok(FrameType::Handshake),
            _ => Err(anyhow::anyhow!("Invalid frame type: {}", value)),
        }
    }
}

/// Protocol frame header (9 bytes)
#[derive(Debug, Clone)]
pub struct FrameHeader {
    pub frame_type: FrameType,
    pub terminal_id: u32,
    pub payload_length: u32,
}

impl FrameHeader {
    pub const SIZE: usize = 9; // 1 + 4 + 4

    pub fn new(frame_type: FrameType, terminal_id: u32, payload_length: u32) -> Self {
        Self {
            frame_type,
            terminal_id,
            payload_length,
        }
    }

    pub fn to_bytes(&self) -> [u8; Self::SIZE] {
        let mut bytes = [0u8; Self::SIZE];
        bytes[0] = self.frame_type as u8;
        bytes[1..5].copy_from_slice(&self.terminal_id.to_be_bytes());
        bytes[5..9].copy_from_slice(&self.payload_length.to_be_bytes());
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < Self::SIZE {
            return Err(anyhow::anyhow!("Frame header too short"));
        }

        let frame_type = FrameType::try_from(bytes[0])?;
        let terminal_id = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
        let payload_length = u32::from_be_bytes([bytes[5], bytes[6], bytes[7], bytes[8]]);

        Ok(Self {
            frame_type,
            terminal_id,
            payload_length,
        })
    }
}

/// Control message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ControlMessage {
    /// Resize terminal
    Resize { rows: u16, cols: u16 },
    /// Send signal to terminal process
    Signal { signal: u32 },
    /// Terminal status update
    Status {
        running: bool,
        exit_code: Option<i32>,
    },
    /// Working directory change
    WorkingDir { path: String },
}

/// Management message types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ManagementMessage {
    /// Create new terminal
    CreateTerminal {
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: (u16, u16),
    },
    /// List available terminals
    ListTerminals,
    /// Terminal info response
    TerminalInfo {
        id: u32,
        name: Option<String>,
        shell_type: String,
        current_dir: String,
        size: (u16, u16),
        running: bool,
    },
    /// Stop terminal
    StopTerminal { id: u32 },
    /// Error response
    Error { message: String },
}

/// Handshake message for session establishment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandshakeMessage {
    pub protocol_version: u8,
    pub session_id: String,
    pub capabilities: Vec<String>,
    pub auth_token: Option<String>,
}

/// Complete protocol frame
#[derive(Debug, Clone)]
pub struct Frame {
    pub header: FrameHeader,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(frame_type: FrameType, terminal_id: u32, payload: Vec<u8>) -> Self {
        let header = FrameHeader::new(frame_type, terminal_id, payload.len() as u32);
        Self { header, payload }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(FrameHeader::SIZE + self.payload.len());
        bytes.extend_from_slice(&self.header.to_bytes());
        bytes.extend_from_slice(&self.payload);
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < FrameHeader::SIZE {
            return Err(anyhow::anyhow!("Frame too short"));
        }

        let header = FrameHeader::from_bytes(&bytes[..FrameHeader::SIZE])?;

        if header.payload_length as usize > MAX_FRAME_SIZE {
            return Err(anyhow::anyhow!(
                "Frame payload too large: {}",
                header.payload_length
            ));
        }

        if bytes.len() < FrameHeader::SIZE + header.payload_length as usize {
            return Err(anyhow::anyhow!("Incomplete frame payload"));
        }

        let payload =
            bytes[FrameHeader::SIZE..FrameHeader::SIZE + header.payload_length as usize].to_vec();

        Ok(Self { header, payload })
    }

    /// Create a data frame with terminal I/O
    pub fn data(terminal_id: u32, data: Vec<u8>) -> Self {
        Self::new(FrameType::Data, terminal_id, data)
    }

    /// Create a control frame
    pub fn control(terminal_id: u32, control: ControlMessage) -> Result<Self> {
        let payload = bincode::serialize(&control)?;
        Ok(Self::new(FrameType::Control, terminal_id, payload))
    }

    /// Create a management frame
    pub fn management(terminal_id: u32, message: ManagementMessage) -> Result<Self> {
        let payload = bincode::serialize(&message)?;
        Ok(Self::new(FrameType::Management, terminal_id, payload))
    }

    /// Create a heartbeat frame
    pub fn heartbeat(terminal_id: u32) -> Self {
        Self::new(FrameType::Heartbeat, terminal_id, vec![])
    }

    /// Create an error frame
    pub fn error(terminal_id: u32, error: String) -> Result<Self> {
        let payload = bincode::serialize(&error)?;
        Ok(Self::new(FrameType::Error, terminal_id, payload))
    }

    /// Create a handshake frame
    pub fn handshake(terminal_id: u32, handshake: HandshakeMessage) -> Result<Self> {
        let payload = bincode::serialize(&handshake)?;
        Ok(Self::new(FrameType::Handshake, terminal_id, payload))
    }

    /// Parse frame payload based on frame type
    pub fn parse_payload<T: for<'de> Deserialize<'de>>(&self) -> Result<T> {
        bincode::deserialize(&self.payload).map_err(Into::into)
    }
}

/// Session ticket for terminal protocol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalTicket {
    pub session_id: String,
    pub endpoint_addr: String,
    pub auth_token: Option<String>,
    pub relay_url: Option<String>,
}

impl std::fmt::Display for TerminalTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let serialized = bincode::serialize(self).map_err(|_| std::fmt::Error)?;
        let base32 = data_encoding::BASE32.encode(&serialized);
        write!(f, "RT_{}", base32)
    }
}

impl std::str::FromStr for TerminalTicket {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let cleaned = s.trim().replace([' ', '\n', '\r', '\t'], "");

        if !cleaned.starts_with("RT_") {
            return Err(anyhow::anyhow!("Invalid ticket format"));
        }

        let base32_part = &cleaned[3..];
        let bytes = data_encoding::BASE32
            .decode(base32_part.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode ticket: {}", e))?;

        let ticket: TerminalTicket = bincode::deserialize(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize ticket: {}", e))?;

        Ok(ticket)
    }
}

/// Terminal session state
#[derive(Debug, Clone)]
pub struct TerminalSession {
    pub id: String,
    pub terminal_id: u32,
    pub name: Option<String>,
    pub shell_type: String,
    pub current_dir: String,
    pub size: (u16, u16),
    pub running: bool,
    pub created_at: std::time::SystemTime,
}

/// Protocol state manager
pub struct ProtocolState {
    sessions: Arc<RwLock<HashMap<String, TerminalSession>>>,
    terminal_counter: Arc<RwLock<u32>>,
}

impl ProtocolState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            terminal_counter: Arc::new(RwLock::new(0)),
        }
    }

    pub async fn allocate_terminal_id(&self) -> u32 {
        let mut counter = self.terminal_counter.write().await;
        *counter += 1;
        *counter
    }

    pub async fn add_session(&self, session: TerminalSession) {
        let mut sessions = self.sessions.write().await;
        sessions.insert(session.id.clone(), session);
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.remove(session_id);
    }

    pub async fn get_session(&self, session_id: &str) -> Option<TerminalSession> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).cloned()
    }

    pub async fn list_sessions(&self) -> Vec<TerminalSession> {
        let sessions = self.sessions.read().await;
        sessions.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_header_serialization() {
        let header = FrameHeader::new(FrameType::Data, 123, 456);
        let bytes = header.to_bytes();
        let parsed = FrameHeader::from_bytes(&bytes).unwrap();

        assert_eq!(parsed.frame_type, FrameType::Data);
        assert_eq!(parsed.terminal_id, 123);
        assert_eq!(parsed.payload_length, 456);
    }

    #[test]
    fn test_frame_serialization() {
        let frame = Frame::data(42, b"Hello, World!".to_vec());
        let bytes = frame.to_bytes();
        let parsed = Frame::from_bytes(&bytes).unwrap();

        assert_eq!(parsed.header.frame_type, FrameType::Data);
        assert_eq!(parsed.header.terminal_id, 42);
        assert_eq!(parsed.payload, b"Hello, World!");
    }

    #[test]
    fn test_control_message_serialization() {
        let control = ControlMessage::Resize { rows: 24, cols: 80 };
        let frame = Frame::control(1, control).unwrap();

        let parsed_control: ControlMessage = frame.parse_payload().unwrap();
        match parsed_control {
            ControlMessage::Resize { rows, cols } => {
                assert_eq!(rows, 24);
                assert_eq!(cols, 80);
            }
            _ => panic!("Expected Resize control message"),
        }
    }

    #[test]
    fn test_terminal_ticket() {
        let ticket = TerminalTicket {
            session_id: "test-session".to_string(),
            endpoint_addr: "node1abcdef".to_string(),
            auth_token: Some("token123".to_string()),
            relay_url: Some("https://relay.example.com".to_string()),
        };

        let ticket_str = ticket.to_string();
        let parsed: TerminalTicket = ticket_str.parse().unwrap();

        assert_eq!(parsed.session_id, "test-session");
        assert_eq!(parsed.endpoint_addr, "node1abcdef");
        assert_eq!(parsed.auth_token, Some("token123".to_string()));
        assert_eq!(
            parsed.relay_url,
            Some("https://relay.example.com".to_string())
        );
    }
}
