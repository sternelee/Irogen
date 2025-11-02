//! Flutter bridge for QUIC terminal protocol - DEPRECATED
//!
//! This file has been deprecated and replaced by the new message-based architecture.
//! Please use message_bridge.rs instead.

use anyhow::Result;
use flutter_rust_bridge::frb;

/// DEPRECATED: This module is no longer supported
///
/// All QUIC terminal functionality has been migrated to the new message-based architecture.
/// Please use the functions in message_bridge.rs instead.
#[frb]
pub async fn legacy_quic_deprecated_notice() -> Result<String, String> {
    Err("This QUIC bridge has been deprecated. Please use the new message-based architecture with FlutterMessageClient.".to_string())
}

// All functions and types from this file have been removed.
// The new message-based architecture provides:
// - Better performance and reliability
// - Unified message protocol for all operations
// - Enhanced security and error handling
// - TCP forwarding capabilities
// - Mobile app integration

// Please migrate to:
// - FlutterMessageClient for client connections
// - FlutterSessionManager for session management
// - FlutterTerminalManager for terminal operations
// - FlutterTcpForwardingManager for TCP forwarding