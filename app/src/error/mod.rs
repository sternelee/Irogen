use serde::{Deserialize, Serialize};

/// Application-specific error types
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum AppError {
    #[error("Network not initialized")]
    NetworkNotInitialized,

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Invalid address: {0}")]
    InvalidAddress(String),

    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Session not active: {0}")]
    SessionNotActive(String),

    #[error("Invalid ticket: {0}")]
    InvalidTicket(String),

    #[error("Join failed: {0}")]
    JoinFailed(String),

    #[error("Send failed: {0}")]
    SendFailed(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("IO error: {0}")]
    IoError(String),
}

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

