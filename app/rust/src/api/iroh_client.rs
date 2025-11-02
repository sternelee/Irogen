//! 已弃用的Iroh客户端API
//!
//! 此文件已被新的消息架构替代。
//! 请使用 message_bridge.rs 中的新功能。

use anyhow::Result;
use flutter_rust_bridge::frb;
use serde::{Deserialize, Serialize};
use tracing::warn;

/// 已弃用的会话信息
/// 请使用 FlutterMessageClient 替代
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrohSessionInfo {
    pub node_id: String,
    pub node_addr: String,
    pub relay_url: Option<String>,
    pub is_connected: bool,
}

/// 已弃用的终端信息
/// 请使用 FlutterTerminalSession 替代
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub name: Option<String>,
    pub shell_type: String,
    pub current_dir: String,
    pub status: String,
    pub created_at: u64,
    pub size: (u16, u16),
}

/// 已弃用的终端输出
/// 请使用 FlutterTerminal 的事件系统替代
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
    pub timestamp: u64,
}

/// 已弃用的终端输入
/// 请使用 FlutterTerminal 的输入方法替代
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInput {
    pub terminal_id: String,
    pub data: String,
}


#[frb]
pub async fn create_iroh_client(_relay_url: Option<String>) -> Result<IrohSessionInfo, String> {
    warn!("create_iroh_client is deprecated. Use FlutterMessageClient instead.");
    Err("This function has been deprecated. Please use the new message-based architecture with FlutterMessageClient.".to_string())
}

#[frb]
pub async fn connect_to_peer(_ticket: String) -> Result<String, String> {
    warn!("connect_to_peer is deprecated. Use connect_to_cli_server instead.");
    Err("This function has been deprecated. Please use the new message-based architecture with connect_to_cli_server.".to_string())
}

#[frb]
pub async fn create_terminal(
    _name: Option<String>,
    _shell_path: Option<String>,
    _working_dir: Option<String>,
    _rows: Option<u16>,
    _cols: Option<u16>,
) -> Result<String, String> {
    warn!("create_terminal is deprecated. Use create_remote_terminal instead.");
    Err("This function has been deprecated. Please use the new message-based architecture with create_remote_terminal.".to_string())
}

#[frb]
pub async fn send_terminal_input(_terminal_id: String, _input: String) -> Result<(), String> {
    warn!("send_terminal_input is deprecated. Use send_terminal_input instead.");
    Err("This function has been deprecated. Please use the new message-based architecture with send_terminal_input.".to_string())
}

#[frb]
pub async fn resize_terminal(_terminal_id: String, _rows: u16, _cols: u16) -> Result<(), String> {
    warn!("resize_terminal is deprecated. Use resize_remote_terminal instead.");
    Err("This function has been deprecated. Please use the new message-based architecture with resize_remote_terminal.".to_string())
}

#[frb]
pub async fn stop_terminal(_terminal_id: String) -> Result<(), String> {
    warn!("stop_terminal is deprecated. Use stop_remote_terminal instead.");
    Err("This function has been deprecated. Please use the new message-based architecture with stop_remote_terminal.".to_string())
}

#[frb]
pub async fn disconnect_session(_session_id: String) -> Result<(), String> {
    warn!("disconnect_session is deprecated. Use disconnect_from_cli_server instead.");
    Err("This function has been deprecated. Please use the new message-based architecture with disconnect_from_cli_server.".to_string())
}


#[frb]
pub fn generate_qr_code(_data: String) -> Result<String, String> {
    warn!("generate_qr_code is deprecated. Use proper QR code generation libraries.");
    Err("This function has been deprecated. Please use a proper QR code generation library.".to_string())
}

// 为了向后兼容保留这些类型定义，但所有功能都已迁移到新架构