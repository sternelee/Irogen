use serde::{Deserialize, Serialize};

/// Application-specific error types
#[derive(Debug, Serialize, Deserialize)]
pub enum AppError {
    NetworkNotInitialized,
    NetworkError(String),
    InvalidAddress(String),
    ConnectionFailed(String),
    SessionNotFound(String),
    SessionNotActive(String),
    InvalidTicket(String),
    JoinFailed(String),
    SendFailed(String),
    ParseError(String),
    IoError(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NetworkNotInitialized => write!(f, "Network not initialized"),
            Self::NetworkError(msg) => write!(f, "Network error: {}", msg),
            Self::InvalidAddress(msg) => write!(f, "Invalid address: {}", msg),
            Self::ConnectionFailed(msg) => write!(f, "Connection failed: {}", msg),
            Self::SessionNotFound(msg) => write!(f, "Session not found: {}", msg),
            Self::SessionNotActive(msg) => write!(f, "Session not active: {}", msg),
            Self::InvalidTicket(msg) => write!(f, "Invalid ticket: {}", msg),
            Self::JoinFailed(msg) => write!(f, "Join failed: {}", msg),
            Self::SendFailed(msg) => write!(f, "Send failed: {}", msg),
            Self::ParseError(msg) => write!(f, "Parse error: {}", msg),
            Self::IoError(msg) => write!(f, "IO error: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

/// Result type for Tauri commands
pub type AppResult<T> = Result<T, AppError>;

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::ParseError(err.to_string())
    }
}

