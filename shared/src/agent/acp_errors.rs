//! Specialized error types for ACP operations.
//!
//! This module provides structured error types for common ACP failure scenarios,
//! enabling better error handling and user-facing error messages.

use std::fmt;

/// Errors that can occur during ACP agent startup
#[derive(Debug, Clone)]
pub enum AcpStartupError {
    /// Gemini ACP startup timed out
    GeminiStartupTimeout {
        /// The command that was attempted
        command: String,
        /// Timeout duration in seconds
        timeout_secs: u64,
    },

    /// Claude ACP session creation timed out
    ClaudeSessionCreateTimeout {
        /// The session ID that was being created
        session_id: String,
        /// Timeout duration in seconds
        timeout_secs: u64,
    },

    /// Agent does not support the requested feature
    UnsupportedFeature {
        /// Name of the unsupported feature
        feature: String,
        /// Agent type that lacks the feature
        agent_type: String,
    },

    /// Agent process failed to start
    ProcessStartFailed {
        /// The command that failed
        command: String,
        /// Error message from the system
        error: String,
    },

    /// Agent process exited unexpectedly
    UnexpectedExit {
        /// Exit code if available
        exit_code: Option<i32>,
        /// stderr output if available
        stderr: Option<String>,
    },
}

impl fmt::Display for AcpStartupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GeminiStartupTimeout {
                command,
                timeout_secs,
            } => {
                write!(
                    f,
                    "Gemini ACP startup timed out after {}s. Command: '{}'. Ensure Gemini CLI is installed and supports ACP mode.",
                    timeout_secs, command
                )
            }
            Self::ClaudeSessionCreateTimeout {
                session_id,
                timeout_secs,
            } => {
                write!(
                    f,
                    "Claude ACP session creation timed out after {}s. Session ID: '{}'. The session may have been created but not responded in time.",
                    timeout_secs, session_id
                )
            }
            Self::UnsupportedFeature {
                feature,
                agent_type,
            } => {
                write!(
                    f,
                    "Agent '{}' does not support feature '{}'. Check agent version and capabilities.",
                    agent_type, feature
                )
            }
            Self::ProcessStartFailed { command, error } => {
                write!(
                    f,
                    "Failed to start agent process: '{}'. Error: {}",
                    command, error
                )
            }
            Self::UnexpectedExit { exit_code, stderr } => {
                let exit_info = exit_code
                    .map(|c| format!("exit code {}", c))
                    .unwrap_or_else(|| "unknown exit status".to_string());
                let stderr_info = stderr
                    .as_ref()
                    .map(|s| format!(" Stderr: {}", s))
                    .unwrap_or_default();
                write!(
                    f,
                    "Agent process exited unexpectedly: {}.{}",
                    exit_info, stderr_info
                )
            }
        }
    }
}

impl std::error::Error for AcpStartupError {}

/// Errors that can occur during ACP session operations
#[derive(Debug, Clone)]
pub enum AcpSessionError {
    /// Session update draining failed
    DrainTimeout {
        /// Number of updates that were pending
        pending_count: u64,
        /// Timeout duration in milliseconds
        timeout_ms: u64,
    },

    /// Permission response failed
    PermissionError {
        /// Request ID that failed
        request_id: String,
        /// Error message
        error: String,
    },

    /// Session was interrupted
    Interrupted {
        /// Reason for interruption if known
        reason: Option<String>,
    },
}

impl fmt::Display for AcpSessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DrainTimeout {
                pending_count,
                timeout_ms,
            } => {
                write!(
                    f,
                    "Session update draining timed out after {}ms with {} updates still pending",
                    timeout_ms, pending_count
                )
            }
            Self::PermissionError { request_id, error } => {
                write!(
                    f,
                    "Permission response failed for request '{}': {}",
                    request_id, error
                )
            }
            Self::Interrupted { reason } => {
                let reason_info = reason.as_deref().unwrap_or("unknown reason");
                write!(f, "Session was interrupted: {}", reason_info)
            }
        }
    }
}

impl std::error::Error for AcpSessionError {}

/// Errors related to terminal operations
#[derive(Debug, Clone)]
pub enum AcpTerminalError {
    /// PTY creation failed
    PtyCreationFailed {
        /// Error message from the system
        error: String,
    },

    /// Terminal not found
    TerminalNotFound {
        /// Terminal ID that was not found
        terminal_id: String,
    },

    /// Terminal output encoding error
    EncodingError {
        /// Description of the encoding issue
        details: String,
    },
}

impl fmt::Display for AcpTerminalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PtyCreationFailed { error } => {
                write!(f, "Failed to create PTY: {}", error)
            }
            Self::TerminalNotFound { terminal_id } => {
                write!(f, "Terminal '{}' not found", terminal_id)
            }
            Self::EncodingError { details } => {
                write!(f, "Terminal output encoding error: {}", details)
            }
        }
    }
}

impl std::error::Error for AcpTerminalError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_startup_error_display() {
        let err = AcpStartupError::GeminiStartupTimeout {
            command: "gemini --acp".to_string(),
            timeout_secs: 10,
        };
        assert!(err.to_string().contains("10s"));
        assert!(err.to_string().contains("gemini --acp"));
    }

    #[test]
    fn test_unsupported_feature_error() {
        let err = AcpStartupError::UnsupportedFeature {
            feature: "load_session".to_string(),
            agent_type: "Gemini".to_string(),
        };
        assert!(err.to_string().contains("load_session"));
        assert!(err.to_string().contains("Gemini"));
    }

    #[test]
    fn test_session_error_display() {
        let err = AcpSessionError::DrainTimeout {
            pending_count: 5,
            timeout_ms: 5000,
        };
        assert!(err.to_string().contains("5000ms"));
        assert!(err.to_string().contains("5 updates"));
    }

    #[test]
    fn test_terminal_error_display() {
        let err = AcpTerminalError::TerminalNotFound {
            terminal_id: "term-123".to_string(),
        };
        assert!(err.to_string().contains("term-123"));
    }
}
