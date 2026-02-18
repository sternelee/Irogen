use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tauri::{Emitter, State};
use tokio::sync::{RwLock, broadcast};
use tokio_util::sync::CancellationToken;
use tracing::info;
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt, PanelBuilder, PanelLevel, StyleMask};

#[cfg(target_os = "macos")]
pub mod macos_panel {
    use tauri::Manager;
    use tauri_nspanel::tauri_panel;
    tauri_panel!(FloatingPanel {});
}

mod tcp_forwarding;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use clawdchat_shared::AgentManager;
use clawdchat_shared::{
    AgentControlAction, AgentPermissionResponse, AgentType, CommunicationManager, DirEntry,
    Event, EventListener, EventType, FileBrowserAction, IODataType, Message as ClawdChatMessage, MessageBuilder,
    MessagePayload, QuicMessageClientHandle, SerializableEndpointAddr, TcpDataType,
    TcpForwardingAction, TcpForwardingType, TerminalAction,
};

use crate::tcp_forwarding::TcpForwardingManager;

/// Maximum number of concurrent sessions to prevent memory exhaustion
const MAX_CONCURRENT_SESSIONS: usize = 50;
/// Maximum events per session buffer
const MAX_EVENTS_PER_SESSION: usize = 5000;
/// Memory cleanup interval in seconds
const CLEANUP_INTERVAL_SECS: u64 = 300; // 5 minutes

// Helper function to validate session ticket format
fn is_valid_session_ticket(ticket: &str) -> bool {
    // iroh-tickets format is typically 44-52 characters (base64)
    // JSON format can be much longer (up to 500 chars for base64-encoded JSON)
    ticket.len() > 20 && ticket.len() < 500
}

// Parse ticket and extract EndpointAddr (includes direct addresses and relay URL)
// Supports full address info for direct connection
fn parse_ticket_to_node_addr(ticket: &str) -> Result<iroh_base::EndpointAddr, Box<dyn std::error::Error>> {
    use base64::Engine as _;
    use base64::engine::general_purpose;
    use data_encoding::BASE32_NOPAD;
    use iroh_base::{EndpointAddr, PublicKey, RelayUrl, TransportAddr};
    use iroh_tickets::endpoint::EndpointTicket;
    use clawdchat_shared::SerializableEndpointAddr;
    use std::collections::BTreeSet;

    // Handle old format with "ticket:" prefix
    let ticket_str = if let Some(stripped) = ticket.strip_prefix("ticket:") {
        stripped
    } else {
        ticket
    };

    // Try new iroh-tickets format first (base64, shorter)
    if let Ok(endpoint_ticket) = EndpointTicket::from_str(ticket_str) {
        return Ok(endpoint_ticket.endpoint_addr().clone());
    }

    // Try base64-encoded JSON format
    #[derive(Deserialize)]
    struct JsonTicket {
        node_id: String,
        relay_url: Option<String>,
        direct_addresses: Option<Vec<String>>,
        alpn: Option<String>,
    }

    // Try both URL_SAFE and STANDARD base64 encoding
    for engine in [general_purpose::URL_SAFE, general_purpose::STANDARD] {
        if let Ok(ticket_json_bytes) = engine.decode(ticket_str) {
            if let Ok(ticket_json) = String::from_utf8(ticket_json_bytes.clone()) {
                if let Ok(json_ticket) = serde_json::from_str::<JsonTicket>(&ticket_json) {
                    // Create EndpointAddr from parsed ticket
                    if let Ok(public_key) = PublicKey::from_str(&json_ticket.node_id) {
                        let mut addrs = BTreeSet::new();

                        // Add direct addresses
                        if let Some(direct_addrs) = json_ticket.direct_addresses {
                            for addr_str in direct_addrs {
                                if let Ok(addr) = addr_str.parse() {
                                    addrs.insert(TransportAddr::Ip(addr));
                                }
                            }
                        }

                        // Add relay URL
                        if let Some(relay_url_str) = json_ticket.relay_url {
                            if let Ok(url) = relay_url_str.parse::<RelayUrl>() {
                                addrs.insert(TransportAddr::Relay(url));
                            }
                        }

                        return Ok(EndpointAddr::from_parts(public_key, addrs));
                    }
                }
            }
        }
    }

    // Fall back to legacy custom format (base32 + JSON)
    let ticket_json_bytes = BASE32_NOPAD.decode(ticket_str.to_ascii_uppercase().as_bytes())?;
    let ticket_json = String::from_utf8(ticket_json_bytes)?;

    // Parse JSON directly as SerializableEndpointAddr
    let serializable_addr: SerializableEndpointAddr = serde_json::from_str(&ticket_json)?;

    // Use the new method to create EndpointAddr
    Ok(serializable_addr.try_to_node_addr()?)
}

// Parse ticket and extract EndpointId (legacy compatibility)
fn parse_ticket_node_addr(ticket: &str) -> Result<iroh::EndpointId, Box<dyn std::error::Error>> {
    use base64::Engine as _;
    use base64::engine::general_purpose;
    use data_encoding::BASE32_NOPAD;
    use iroh_tickets::endpoint::EndpointTicket;
    use serde::Deserialize;

    // Handle old format with "ticket:" prefix
    let ticket_str = if let Some(stripped) = ticket.strip_prefix("ticket:") {
        stripped
    } else {
        ticket
    };

    // Try new iroh-tickets format first (base64, shorter)
    if let Ok(endpoint_ticket) = EndpointTicket::from_str(ticket_str) {
        let node_addr = endpoint_ticket.endpoint_addr();
        return Ok(node_addr.id);
    }

    // Try base64-encoded JSON format with node_id field
    #[derive(Deserialize)]
    struct JsonTicket {
        node_id: String,
        #[allow(dead_code)]
        relay_url: Option<String>,
        #[allow(dead_code)]
        direct_addresses: Option<Vec<String>>,
        #[allow(dead_code)]
        alpn: Option<String>,
    }

    // Try both URL_SAFE and STANDARD base64 encoding
    for engine in [general_purpose::URL_SAFE, general_purpose::STANDARD] {
        if let Ok(ticket_json_bytes) = engine.decode(ticket_str) {
            if let Ok(ticket_json) = String::from_utf8(ticket_json_bytes.clone()) {
                if let Ok(json_ticket) = serde_json::from_str::<JsonTicket>(&ticket_json) {
                    if let Ok(node_id) = iroh::EndpointId::from_str(&json_ticket.node_id) {
                        return Ok(node_id);
                    }
                }
            }
        }
    }

    // Fall back to legacy custom format (base32 + JSON)
    // Decode base32 (convert to uppercase for decoding)
    let ticket_json_bytes = BASE32_NOPAD.decode(ticket_str.to_ascii_uppercase().as_bytes())?;
    let ticket_json = String::from_utf8(ticket_json_bytes)?;

    // Parse JSON directly as SerializableEndpointAddr
    let serializable_addr: SerializableEndpointAddr = serde_json::from_str(&ticket_json)?;

    // Try to reconstruct EndpointId from SerializableEndpointAddr
    Ok(serializable_addr.try_to_endpoint_id()?)
}

pub struct AppState {
    sessions: RwLock<HashMap<String, TerminalSession>>,
    communication_manager: RwLock<Option<Arc<CommunicationManager>>>,
    quic_client: RwLock<Option<QuicMessageClientHandle>>,
    cleanup_token: RwLock<Option<CancellationToken>>,
    tcp_forwarding_manager: Arc<tokio::sync::Mutex<TcpForwardingManager>>,
    // Local agent manager for in-app agent sessions (desktop only)
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    agent_manager: Arc<RwLock<Option<Arc<AgentManager>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            communication_manager: RwLock::new(None),
            quic_client: RwLock::new(None),
            cleanup_token: RwLock::new(None),
            tcp_forwarding_manager: Arc::new(tokio::sync::Mutex::new(TcpForwardingManager::new())),
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            agent_manager: Arc::new(RwLock::new(None)),
        }
    }
}

#[derive(Clone)]
pub struct TerminalSession {
    pub id: String,
    pub connection_id: String,
    pub node_id: String,
    pub last_activity: Arc<RwLock<Instant>>,
    pub cancellation_token: CancellationToken,
    pub event_count: Arc<std::sync::atomic::AtomicUsize>,
    // Note: message_receiver is not included here as it can't be cloned
    // It's managed separately in the connection task
}

/// App Event Listener that converts events to Tauri emissions
pub struct AppEventListener {
    app_handle: tauri::AppHandle,
    session_id: String,
    last_activity: Arc<RwLock<Instant>>,
    event_count: Arc<std::sync::atomic::AtomicUsize>,
}

impl AppEventListener {
    pub fn new(
        app_handle: tauri::AppHandle,
        session_id: String,
        last_activity: Arc<RwLock<Instant>>,
        event_count: Arc<std::sync::atomic::AtomicUsize>,
    ) -> Self {
        Self {
            app_handle,
            session_id,
            last_activity,
            event_count,
        }
    }
}

#[async_trait::async_trait]
impl EventListener for AppEventListener {
    async fn handle_event(&self, event: &Event) -> anyhow::Result<()> {
        // Update activity tracking
        {
            let mut activity = self.last_activity.write().await;
            *activity = std::time::Instant::now();
        }

        // Increment event counter
        let current_count = self
            .event_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        // Check if we're approaching event limit and warn
        if current_count > MAX_EVENTS_PER_SESSION * 9 / 10 {
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::warn!(
                "Session {} approaching event limit: {}/{}",
                self.session_id,
                current_count,
                MAX_EVENTS_PER_SESSION
            );
        }

        // Convert events to Tauri emissions
        match event.event_type {
            EventType::TerminalCreated => {
                let _ = self.app_handle.emit(
                    &format!("terminal-created-{}", self.session_id),
                    &event.data,
                );
            }
            EventType::TerminalStopped => {
                let _ = self.app_handle.emit(
                    &format!("terminal-stopped-{}", self.session_id),
                    &event.data,
                );
            }
            EventType::TerminalInput => {
                let _ = self
                    .app_handle
                    .emit(&format!("terminal-input-{}", self.session_id), &event.data);
            }
            EventType::TerminalOutput => {
                let _ = self
                    .app_handle
                    .emit(&format!("terminal-output-{}", self.session_id), &event.data);
            }
            EventType::TerminalError => {
                let _ = self
                    .app_handle
                    .emit(&format!("terminal-error-{}", self.session_id), &event.data);
            }
            EventType::TcpSessionCreated => {
                let _ = self.app_handle.emit(
                    &format!("tcp-session-created-{}", self.session_id),
                    &event.data,
                );
            }
            EventType::TcpSessionStopped => {
                let _ = self.app_handle.emit(
                    &format!("tcp-session-stopped-{}", self.session_id),
                    &event.data,
                );
            }
            EventType::PeerConnected => {
                let _ = self
                    .app_handle
                    .emit(&format!("peer-connected-{}", self.session_id), &event.data);
            }
            EventType::PeerDisconnected => {
                let _ = self.app_handle.emit(
                    &format!("peer-disconnected-{}", self.session_id),
                    &event.data,
                );
                // Also emit a global event for the session store to handle
                let _ = self.app_handle.emit(
                    "peer-disconnected",
                    &serde_json::json!({
                        "sessionId": self.session_id,
                    }),
                );
            }
            _ => {}
        }

        Ok(())
    }

    fn name(&self) -> &str {
        &self.session_id
    }

    fn supported_events(&self) -> Vec<EventType> {
        vec![
            EventType::TerminalCreated,
            EventType::TerminalStopped,
            EventType::TerminalInput,
            EventType::TerminalOutput,
            EventType::TerminalError,
            EventType::TcpSessionCreated,
            EventType::TcpSessionStopped,
            EventType::PeerConnected,
            EventType::PeerDisconnected,
        ]
    }
}

#[derive(Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub node_address: String,
    pub session_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct NetworkConfig {
    pub relay_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct DirectedMessageRequest {
    pub session_id: String,
    pub target_node_id: String,
    pub message: String,
}

// === Terminal Management Commands ===

/// Internal version of initialize_network that works with State references
async fn initialize_network_internal(
    state: &State<'_, AppState>,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<String, String> {
    initialize_network_with_relay_internal(None, state, app_handle).await
}

/// Internal version of initialize_network_with_relay that works with State references
async fn initialize_network_with_relay_internal(
    relay_url: Option<String>,
    state: &State<'_, AppState>,
    app_handle: Option<&tauri::AppHandle>,
) -> Result<String, String> {
    // Check if already initialized - reuse existing client
    {
        let client_guard = state.quic_client.read().await;
        if let Some(quic_client) = client_guard.as_ref() {
            let node_id = quic_client.get_node_id().await.to_string();
            tracing::info!(
                "Network already initialized, reusing existing client: {}",
                node_id
            );
            return Ok(node_id);
        }
    }

    // Create communication manager
    let communication_manager = Arc::new(CommunicationManager::new("clawdchat_app".to_string()));
    communication_manager
        .initialize()
        .await
        .map_err(|e| format!("Failed to initialize communication manager: {}", e))?;

    // Handle secret key storage differently for mobile platforms
    let secret_key_path = if cfg!(mobile) {
        // On mobile platforms, use None to generate temporary keys
        // This avoids file system permission issues and is appropriate for mobile apps
        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!("🔑 Using temporary secret key for mobile platform (no persistent storage)");
        None
    } else {
        // On desktop platforms, use persistent secret key storage
        // Use Tauri's app data directory instead of current_dir() to avoid read-only filesystem errors
        match app_handle {
            Some(handle) => {
                let app_data_dir = handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("Failed to get app data directory: {}", e))?;

                // Ensure the directory exists
                std::fs::create_dir_all(&app_data_dir)
                    .map_err(|e| format!("Failed to create app data directory: {}", e))?;

                let path = app_data_dir.join("clawdchat_app_secret_key");
                info!(
                    "🔑 Using persistent secret key in app data directory: {:?}",
                    path
                );
                Some(path)
            }
            None => {
                // Fallback for testing or contexts without app_handle
                let app_data_dir =
                    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
                let path = app_data_dir.join("clawdchat_app_secret_key");
                info!(
                    "🔑 Using persistent secret key in current directory (fallback): {:?}",
                    path
                );
                Some(path)
            }
        }
    };

    // Create QUIC client with secret key (temporary on mobile, persistent on desktop)
    let quic_client = QuicMessageClientHandle::new_with_secret_key(
        relay_url,
        communication_manager.clone(),
        secret_key_path.as_deref(),
    )
    .await
    .map_err(|e| format!("Failed to initialize QUIC client: {}", e))?;

    // Get node ID
    let node_id = quic_client.get_node_id().await.to_string();

    // Store in state
    {
        let mut comm_guard = state.communication_manager.write().await;
        *comm_guard = Some(communication_manager);
    }
    {
        let mut client_guard = state.quic_client.write().await;
        *client_guard = Some(quic_client);
    }

    // Start cleanup task if not already running
    start_cleanup_task(state).await;

    Ok(node_id)
}

#[tauri::command]
async fn initialize_network_with_relay(
    relay_url: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    initialize_network_with_relay_internal(relay_url, &state, Some(&app_handle)).await
}

#[tauri::command]
async fn initialize_network(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    initialize_network_internal(&state, Some(&app_handle)).await
}

/// Connect to host (alias for connect_to_peer)
/// This provides the command name that the frontend expects
#[tauri::command]
async fn connect_to_host(
    session_ticket: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    connect_to_peer(session_ticket, state, app_handle).await
}

#[tauri::command]
async fn connect_to_peer(
    session_ticket: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Validate inputs
    if session_ticket.trim().is_empty() {
        return Err("Session ticket cannot be empty".to_string());
    }

    // Validate session ticket format
    if !is_valid_session_ticket(&session_ticket) {
        return Err("Invalid session ticket format".to_string());
    }

    let _quic_client = ensure_quic_client_initialized(&state).await?;

    let communication_manager = {
        let comm_guard = state.communication_manager.read().await;
        match comm_guard.as_ref() {
            Some(cm) => cm.clone(),
            None => {
                return Err(
                    "Communication manager not initialized. Please restart the application."
                        .to_string(),
                );
            }
        }
    };

    // Parse the ticket to extract full NodeAddr (includes direct addresses and relay URL for direct connection)
    let node_addr = parse_ticket_to_node_addr(&session_ticket)
        .map_err(|e| format!("Failed to parse session ticket: {}", e))?;

    let node_id_str = node_addr.id.to_string();

    // Check if there's already a session to the same node - reuse it
    {
        let sessions = state.sessions.read().await;
        for (existing_session_id, session) in sessions.iter() {
            if session.node_id == node_id_str {
                // Update last activity for the existing session
                {
                    let mut last_activity = session.last_activity.write().await;
                    *last_activity = Instant::now();
                }
                tracing::info!(
                    "Reusing existing session {} for node {}",
                    existing_session_id,
                    node_id_str
                );
                return Ok(existing_session_id.clone());
            }
        }
    }

    let session_id = format!("session_{}", uuid::Uuid::new_v4());

    // Check session limits before creating new session
    {
        let sessions = state.sessions.read().await;
        if sessions.len() >= MAX_CONCURRENT_SESSIONS {
            return Err(format!(
                "Maximum number of sessions ({}) reached. Please disconnect some sessions first.",
                MAX_CONCURRENT_SESSIONS
            ));
        }
    }

    // Establish QUIC connection to the CLI server using full NodeAddr (includes relay info and direct addresses)
    let (connection_id, message_receiver) = {
        let client_guard = state.quic_client.read().await;
        if let Some(quic_client) = client_guard.as_ref() {
            #[cfg(debug_assertions)]
            tracing::info!("🔗 Establishing connection to server via NodeAddr");
            #[cfg(debug_assertions)]
            tracing::info!("🔗 Node ID: {:?}", node_addr.id);

            // 提取 direct addresses 和 relay URL
            #[cfg(debug_assertions)]
            {
                use iroh_base::{TransportAddr};
                let direct_addrs: Vec<_> = node_addr.addrs.iter()
                    .filter_map(|a| {
                        if let TransportAddr::Ip(addr) = a {
                            Some(addr.to_string())
                        } else {
                            None
                        }
                    })
                    .collect();
                let relay_url = node_addr.addrs.iter()
                    .filter_map(|a| {
                        if let TransportAddr::Relay(url) = a {
                            Some(url.to_string())
                        } else {
                            None
                        }
                    })
                    .next();
                tracing::info!("🔗 Direct addresses: {:?}", direct_addrs);
                tracing::info!("🔗 Relay URL: {:?}", relay_url);
            }

            // Get message receiver
            let receiver = quic_client.get_message_receiver().await;

            // Establish actual QUIC connection using full NodeAddr (supports direct addresses and relay)
            let connection_id = match quic_client.connect_to_server_with_node_addr(&node_addr).await {
                Ok(actual_connection_id) => {
                    #[cfg(debug_assertions)]
                    tracing::info!(
                        "🎉 Real QUIC connection established with ID: {}",
                        actual_connection_id
                    );
                    actual_connection_id
                }
                Err(e) => {
                    #[cfg(debug_assertions)]
                    tracing::error!("❌ Failed to establish QUIC connection: {}", e);
                    return Err(format!("Failed to connect to server: {}", e));
                }
            };

            (connection_id, receiver)
        } else {
            return Err("QUIC client not available".to_string());
        }
    };

    // Create terminal session with enhanced tracking
    let cancellation_token = CancellationToken::new();
    let terminal_session = TerminalSession {
        id: session_id.clone(),
        connection_id: connection_id.clone(),
        node_id: node_id_str.clone(),
        last_activity: Arc::new(RwLock::new(Instant::now())),
        cancellation_token: cancellation_token.clone(),
        event_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
    };

    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), terminal_session.clone());
    }

    // Set CLI endpoint ID on TCP forwarding manager for P2P stream opening
    {
        let mut tcp_manager = state.tcp_forwarding_manager.lock().await;
        tcp_manager.set_cli_endpoint_id(node_id_str.clone()).await;
        // Also set the quic_client reference
        if let Some(quic_client) = (*state.quic_client.read().await).clone() {
            tcp_manager.set_quic_client(quic_client);
        }
    }

    // Create and register event listener for this session
    let event_listener = Arc::new(AppEventListener::new(
        app_handle.clone(),
        session_id.clone(),
        terminal_session.last_activity.clone(),
        terminal_session.event_count.clone(),
    ));

    communication_manager
        .register_event_listener(event_listener.clone())
        .await;

    // Start message receiver task
    let app_handle_clone = app_handle.clone();
    let session_id_clone = session_id.clone();
    let connection_id_clone = connection_id.clone();
    let cancellation_token_receiver = cancellation_token.clone();
    let last_activity_receiver = terminal_session.last_activity.clone();
    let event_count_receiver = terminal_session.event_count.clone();
    let tcp_forwarding_manager = state.tcp_forwarding_manager.clone();
    let quic_client_for_receiver = {
        let client_guard = state.quic_client.read().await;
        client_guard.as_ref().cloned()
    };

    tokio::spawn(async move {
        let mut receiver = message_receiver;
        #[cfg(debug_assertions)]
        tracing::info!(
            "Starting message receiver task for session: {}",
            session_id_clone
        );

        loop {
            tokio::select! {
                message_result = receiver.recv() => {
                    match message_result {
                        Ok(message) => {
                            // Update activity tracking
                            {
                                let mut activity = last_activity_receiver.write().await;
                                *activity = Instant::now();
                            }

                            // Increment event counter
                            let current_count = event_count_receiver.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                            // Check if we're approaching event limit and warn
                            if current_count > MAX_EVENTS_PER_SESSION * 9 / 10 {
                                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                tracing::warn!("Session {} approaching event limit: {}/{}",
                                    session_id_clone, current_count, MAX_EVENTS_PER_SESSION);
                            }

                            // Process incoming message
                            #[cfg(debug_assertions)]
                            tracing::debug!("Received message for session {}: type={:?}",
                                session_id_clone, message.message_type);

                            // Convert message to event and emit to frontend
                            match &message.payload {
                                MessagePayload::Response(response) => {
                                    // Handle response messages
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Received response for session {}: success={}",
                                        session_id_clone, response.success);

                                    // Check if this is a terminals list response
                                    if let Some(ref data_str) = response.data {
                                        if let Ok(data_json) = serde_json::from_str::<serde_json::Value>(data_str) {
                                            if data_json.get("terminals").is_some() {
                                                // This is a terminals list response - fetch logs for each
                                                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                                tracing::info!("Received terminals list, fetching logs...");

                                                // Emit terminals list to frontend
                                                let _ = app_handle_clone.emit(
                                                    &format!("terminals-list-{}", session_id_clone),
                                                    &data_json,
                                                );

                                                // Fetch logs for each terminal
                                                if let Some(terminals_array) = data_json["terminals"].as_array() {
                                                    for terminal_obj in terminals_array {
                                                        if let Some(terminal_id) = terminal_obj["id"].as_str() {
                                                            // Send get_terminal_logs request
                                                            if let Some(ref quic_client) = quic_client_for_receiver {
                                                                let logs_message = MessageBuilder::terminal_management(
                                                                    "clawdchat_app".to_string(),
                                                                    TerminalAction::GetLogs {
                                                                        terminal_id: terminal_id.to_string(),
                                                                    },
                                                                    Some(session_id_clone.clone()),
                                                                )
                                                                .with_session(session_id_clone.clone());

                                                                let _ = quic_client.send_message_to_server(
                                                                    &connection_id_clone,
                                                                    logs_message,
                                                                ).await;
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            else if data_json.get("entries").is_some() && data_json.get("terminal_id").is_some() {
                                                // This is a terminal logs response
                                                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                                tracing::info!("Received terminal logs for: {}", data_json["terminal_id"]);

                                                // Emit terminal logs to frontend
                                                let _ = app_handle_clone.emit(
                                                    &format!("terminal-logs-{}", session_id_clone),
                                                    &data_json,
                                                );
                                            }
                                            else if data_json.get("entries").is_some() && data_json.get("terminal_id").is_none() {
                                                // This is a directory listing response
                                                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                                tracing::info!("Received directory listing response");

                                                // Emit directory listing to frontend
                                                let _ = app_handle_clone.emit(
                                                    &format!("remote-directory-listing-{}", session_id_clone),
                                                    &data_json,
                                                );
                                            }
                                            // Check if this is a TCP forwarding session creation response
                                            // NOTE: This must be checked BEFORE the sessions-only check because
                                            // session creation responses include both session_id+status AND sessions
                                            else if data_json.get("session_id").is_some() && data_json.get("status").and_then(|s: &serde_json::Value| s.as_str()) == Some("created") {
                                                if let Some(tcp_session_id) = data_json["session_id"].as_str() {
                                                    // Start the listener for this session
                                                    match tcp_forwarding_manager.lock().await.start_session_listener(tcp_session_id).await {
                                                        Ok(()) => {
                                                            tracing::info!("TCP listener started for session: {}", tcp_session_id);
                                                        }
                                                        Err(e) => {
                                                            tracing::error!("Failed to start TCP listener for session {}: {}", tcp_session_id, e);
                                                        }
                                                    }
                                                }
                                            }
                                            // Check if this is a RemoteSpawn response (contains session_id + agent_type + project_path)
                                            else if data_json.get("session_id").is_some() && data_json.get("agent_type").is_some() {
                                                // This is an AI agent session creation response
                                                if let Some(agent_session_id) = data_json["session_id"].as_str() {
                                                    tracing::info!("Received agent session creation response: session_id={}", agent_session_id);



                                                    // Emit agent session created event to frontend
                                                    let _ = app_handle_clone.emit(
                                                        "agent-session-created",
                                                        &serde_json::json!({
                                                            "session_id": agent_session_id,
                                                            "agent_type": data_json.get("agent_type"),
                                                            "project_path": data_json.get("project_path"),
                                                            "control_session_id": session_id_clone,
                                                        })
                                                    );
                                                }
                                            }
                                            else if data_json.get("sessions").is_some() {
                                                // This is a TCP sessions list response (no session_id+status=created)
                                                if let Some(sessions_array) = data_json["sessions"].as_array() {
                                                    for session_obj in sessions_array {
                                                        if let (Some(session_id), Some(local_addr), Some(remote_target), Some(fwd_type)) = (
                                                            session_obj["id"].as_str(),
                                                            session_obj["local_addr"].as_str(),
                                                            session_obj["remote_target"].as_str(),
                                                            session_obj["forwarding_type"].as_str(),
                                                        ) {
                                                            // Parse remote_target (format: "host:port")
                                                            let (remote_host, remote_port) = if let Some(colon_pos) = remote_target.find(':') {
                                                                (
                                                                    remote_target[..colon_pos].to_string(),
                                                                    remote_target[colon_pos + 1..].parse::<u16>().unwrap_or(0)
                                                                )
                                                            } else {
                                                                tracing::warn!("Invalid remote_target format: {}", remote_target);
                                                                continue;
                                                            };

                                                            // Restore the session (ListenToRemote or local-to-remote)
                                                            if fwd_type == "ListenToRemote" || fwd_type == "local-to-remote" {
                                                                if let Err(e) = tcp_forwarding_manager.lock().await.restore_session(
                                                                    session_id.to_string(),
                                                                    local_addr.to_string(),
                                                                    remote_host,
                                                                    remote_port,
                                                                ).await {
                                                                    tracing::error!("Failed to restore TCP session {}: {}", session_id, e);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    // Emit response to frontend
                                    let _ = app_handle_clone.emit(
                                        &format!("session-response-{}", session_id_clone),
                                        &serde_json::json!({
                                            "request_id": response.request_id,
                                            "success": response.success,
                                            "data": response.data,
                                            "message": response.message,
                                        })
                                    );
                                }
                                MessagePayload::Error(error) => {
                                    let _ = app_handle_clone.emit(
                                        &format!("session-error-{}", session_id_clone),
                                        &serde_json::json!({
                                            "code": error.code,
                                            "message": error.message,
                                            "details": error.details,
                                        })
                                    );
                                }
                                MessagePayload::TerminalIO(io_message) => {
                                    match &io_message.data_type {
                                        IODataType::Output => {
                                            let _ = app_handle_clone.emit(
                                                &format!("terminal-output-{}", session_id_clone),
                                                &serde_json::json!({
                                                    "terminal_id": io_message.terminal_id,
                                                    "data": String::from_utf8_lossy(&io_message.data),
                                                })
                                            );
                                        }
                                        IODataType::Error => {
                                            let _ = app_handle_clone.emit(
                                                &format!("terminal-error-{}", session_id_clone),
                                                &serde_json::json!({
                                                    "terminal_id": io_message.terminal_id,
                                                    "error": String::from_utf8_lossy(&io_message.data),
                                                })
                                            );
                                        }
                                        _ => {}
                                    }
                                }
                                MessagePayload::TerminalManagement(mgmt_message) => {
                                    // Handle terminal management messages (created, stopped, etc.)
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Received terminal management message: {:?}", mgmt_message.action);

                                    // Emit management event to frontend
                                    let _ = app_handle_clone.emit(
                                        &format!("terminal-management-{}", session_id_clone),
                                        &serde_json::json!({
                                            "action": format!("{:?}", mgmt_message.action),
                                            "request_id": mgmt_message.request_id,
                                        })
                                    );
                                }
                                MessagePayload::TcpForwarding(tcp_msg) => {
                                    // Handle TCP forwarding messages
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Received TCP forwarding message: {:?}", tcp_msg.action);

                                    // Emit TCP forwarding event to frontend
                                    let _ = app_handle_clone.emit(
                                        &format!("tcp-forwarding-{}", session_id_clone),
                                        &serde_json::json!({
                                            "action": format!("{:?}", tcp_msg.action),
                                            "request_id": tcp_msg.request_id,
                                        })
                                    );
                                }
                                MessagePayload::TcpData(tcp_data_msg) => {
                                    // Handle TCP data messages from CLI
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Received TCP data message: session_id={}, connection_id={}, data_type={:?}",
                                        tcp_data_msg.session_id, tcp_data_msg.connection_id, tcp_data_msg.data_type);

                                    // Forward data to TcpForwardingManager
                                    if let Err(e) = tcp_forwarding_manager.lock().await.handle_tcp_data_from_cli(
                                        &tcp_data_msg.session_id,
                                        &tcp_data_msg.connection_id,
                                        &tcp_data_msg.data,
                                        &tcp_data_msg.data_type,
                                    ).await {
                                        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                        tracing::error!("Failed to handle TCP data from CLI: {}", e);
                                    }

                                    // Emit TCP data event to frontend for UI updates
                                    let _ = app_handle_clone.emit(
                                        &format!("tcp-data-{}", session_id_clone),
                                        &serde_json::json!({
                                            "session_id": tcp_data_msg.session_id,
                                            "connection_id": tcp_data_msg.connection_id,
                                            "data_type": format!("{:?}", tcp_data_msg.data_type),
                                            "data_length": tcp_data_msg.data.len(),
                                        })
                                    );
                                }
                                MessagePayload::AgentMessage(agent_msg) => {
                                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                    tracing::info!(
                                        "Received AgentMessage for session {}: {:?}",
                                        agent_msg.session_id,
                                        agent_msg.content
                                    );

                                    // Transform AgentMessageContent to frontend-expected format
                                    let event_payload = match &agent_msg.content {
                                        clawdchat_shared::message_protocol::AgentMessageContent::AgentResponse {
                                            content, thinking, message_id
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "response",
                                            "content": content,
                                            "thinking": thinking,
                                            "messageId": message_id,
                                        }),
                                        clawdchat_shared::message_protocol::AgentMessageContent::ToolCallUpdate {
                                            tool_name, status, output
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "tool_call",
                                            "toolName": tool_name,
                                            "status": format!("{:?}", status),
                                            "output": output,
                                        }),
                                        clawdchat_shared::message_protocol::AgentMessageContent::SystemNotification {
                                            level, message
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "notification",
                                            "level": format!("{:?}", level),
                                            "message": message,
                                        }),
                                        clawdchat_shared::message_protocol::AgentMessageContent::UserMessage {
                                            content, attachments
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "user_message",
                                            "content": content,
                                            "attachments": attachments,
                                        }),
                                        clawdchat_shared::message_protocol::AgentMessageContent::TurnStarted {
                                            turn_id
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "turn_started",
                                            "turnId": turn_id,
                                        }),
                                        clawdchat_shared::message_protocol::AgentMessageContent::TextDelta {
                                            text, thinking
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "text_delta",
                                            "content": text,
                                            "thinking": thinking,
                                        }),
                                        clawdchat_shared::message_protocol::AgentMessageContent::TurnCompleted {
                                            content
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "turn_completed",
                                            "content": content,
                                        }),
                                        clawdchat_shared::message_protocol::AgentMessageContent::TurnError {
                                            error
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "turn_error",
                                            "error": error,
                                        }),
                                    };

                                    // Emit agent message event to frontend
                                    match app_handle_clone.emit("agent-message", &event_payload) {
                                        Ok(_) => {
                                            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                            tracing::info!("Successfully emitted agent-message event: {:?}", event_payload);
                                        }
                                        Err(e) => {
                                            tracing::error!("Failed to emit agent-message event: {}", e);
                                        }
                                    }
                                }
                                MessagePayload::AgentPermission(perm_msg) => {
                                    // Handle permission request from CLI
                                    if let clawdchat_shared::message_protocol::AgentPermissionMessageInner::Request(request) = &perm_msg.inner {
                                        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                        tracing::info!(
                                            "Received PermissionRequest for session {}: tool={}",
                                            request.session_id,
                                            request.tool_name
                                        );

                                        // Emit permission request event to frontend
                                        let _ = app_handle_clone.emit(
                                            "agent-message",
                                            &serde_json::json!({
                                                "sessionId": request.session_id,
                                                "type": "permission_request",
                                                "requestId": request.request_id,
                                                "toolName": request.tool_name,
                                                "toolParams": request.tool_params,
                                                "description": request.description,
                                            })
                                        );
                                    }
                                }
                                _ => {
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Unhandled message type: {:?}", message.message_type);
                                }
                            }
                        }
                        Err(_) => {
                            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                            tracing::info!("Message receiver closed for session: {}", session_id_clone);
                            break;
                        }
                    }
                }
                _ = cancellation_token_receiver.cancelled() => {
                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                    tracing::info!("Message receiver task cancelled for session: {}", session_id_clone);
                    break;
                }
            }
        }

        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!(
            "Message receiver task ended for session: {}",
            session_id_clone
        );
    });

    // Start TCP message forwarding task
    // This task listens on the TcpForwardingManager's message channel
    // and forwards messages to the CLI via P2P network
    let connection_id_for_tcp = connection_id.clone();
    let session_id_for_tcp = session_id.clone();
    let tcp_manager_for_tcp = state.tcp_forwarding_manager.clone();
    let cancellation_token_for_tcp = cancellation_token.clone();

    // Create a channel to send messages from the listener task to the sender task
    let (tcp_msg_tx, mut tcp_msg_rx) = tokio::sync::mpsc::unbounded_channel::<ClawdChatMessage>();

    // Get a clone of the quic_client handle for sending messages
    let quic_client_handle_opt = {
        let client_guard = state.quic_client.read().await;
        client_guard.as_ref().cloned()
    };

    // Spawn the message sender task
    let session_id_for_sender = session_id_for_tcp.clone();
    let cancellation_token_for_sender = cancellation_token.clone();

    tokio::spawn(async move {
        #[cfg(debug_assertions)]
        tracing::info!(
            "Starting TCP message sender task for session: {}",
            session_id_for_sender
        );

        let Some(quic_client_handle) = quic_client_handle_opt else {
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::error!("QUIC client not available for TCP message forwarding");
            return;
        };

        loop {
            tokio::select! {
                result = tcp_msg_rx.recv() => {
                    match result {
                        Some(message) => {
                            // Send message via QUIC client handle
                            if let Err(e) = quic_client_handle.send_message_to_server(
                                &connection_id_for_tcp,
                                message,
                            ).await {
                                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                tracing::error!("Failed to send TCP message to CLI: {}", e);
                            }
                        }
                        None => {
                            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                            tracing::info!("TCP message sender channel closed for session: {}", session_id_for_sender);
                            break;
                        }
                    }
                }
                _ = cancellation_token_for_sender.cancelled() => {
                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                    tracing::info!("TCP message sender task cancelled for session: {}", session_id_for_sender);
                    break;
                }
            }
        }

        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!(
            "TCP message sender task ended for session: {}",
            session_id_for_sender
        );
    });

    // Spawn the message listener task
    let session_id_for_listener = session_id_for_tcp.clone();
    tokio::spawn(async move {
        #[cfg(debug_assertions)]
        tracing::info!(
            "Starting TCP message listener task for session: {}",
            session_id_for_listener
        );

        // Subscribe to the TCP message channel
        let mut tcp_message_receiver = {
            tcp_manager_for_tcp
                .lock()
                .await
                .subscribe_message_receiver()
        };

        loop {
            tokio::select! {
                result = tcp_message_receiver.recv() => {
                    match result {
                        Ok(msg) => {
                            #[cfg(debug_assertions)]
                            tracing::debug!("TCP message to forward: session_id={}, connection_id={}, data_type={:?}",
                                msg.session_id, msg.connection_id, msg.data_type);

                            // Convert TcpMessageRequest to ClawdChatMessage and send to sender task
                            let message = MessageBuilder::tcp_data(
                                "clawdchat_app".to_string(),
                                msg.session_id,
                                msg.connection_id,
                                msg.data_type,
                                msg.data,
                            ).with_session(session_id_for_listener.clone());

                            // Send to the sender task
                            let _ = tcp_msg_tx.send(message);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                            tracing::info!("TCP message channel closed for session: {}", session_id_for_listener);
                            break;
                        }
                        Err(broadcast::error::RecvError::Lagged(count)) => {
                            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                            tracing::warn!("TCP message channel lagged by {} messages for session: {}", count, session_id_for_listener);
                        }
                    }
                }
                _ = cancellation_token_for_tcp.cancelled() => {
                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                    tracing::info!(
                        "TCP message listener task cancelled for session: {}",
                        session_id_for_listener
                    );
                    break;
                }
            }
        }

        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!(
            "TCP message listener task ended for session: {}",
            session_id_for_listener
        );
    });

    // Sync existing terminals and their logs from CLI
    // This allows the app to restore terminal sessions with their history
    let session_id_for_terminal_sync = session_id.clone();
    let connection_id_for_terminal_sync = connection_id.clone();
    let cancellation_token_for_terminal_sync = cancellation_token.clone();
    let _app_handle_for_terminal_sync = app_handle.clone();
    let quic_client_for_terminal_sync = {
        let client_guard = state.quic_client.read().await;
        client_guard.as_ref().cloned()
    };

    tokio::spawn(async move {
        // Wait a short delay to ensure the connection is stable
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        if cancellation_token_for_terminal_sync.is_cancelled() {
            return;
        }

        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!(
            "Syncing existing terminals for session: {}",
            session_id_for_terminal_sync
        );

        // Send list_terminals request to CLI
        if let Some(quic_client) = quic_client_for_terminal_sync {
            let list_message = MessageBuilder::terminal_management(
                "clawdchat_app".to_string(),
                TerminalAction::List,
                Some(session_id_for_terminal_sync.clone()),
            )
            .with_session(session_id_for_terminal_sync.clone());

            if let Err(e) = quic_client
                .send_message_to_server(&connection_id_for_terminal_sync, list_message)
                .await
            {
                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::error!("Failed to send list_terminals request: {}", e);
            }
        }
    });

    // Sync existing TCP forwarding sessions from CLI
    // This allows the app to restore TCP sessions created by other clients
    let session_id_for_sync = session_id.clone();
    let _connection_id_for_sync = connection_id.clone();
    let _tcp_manager_for_sync = state.tcp_forwarding_manager.clone();
    let cancellation_token_for_sync = cancellation_token.clone();
    let app_handle_for_sync = app_handle.clone();

    tokio::spawn(async move {
        // Wait a short delay to ensure the connection is stable
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

        if cancellation_token_for_sync.is_cancelled() {
            return;
        }

        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!(
            "Syncing existing TCP sessions for session: {}",
            session_id_for_sync
        );

        // Send list request to CLI
        let _list_message = MessageBuilder::tcp_forwarding(
            "clawdchat_app".to_string(),
            TcpForwardingAction::ListSessions,
            Some(session_id_for_sync.clone()),
        )
        .with_session(session_id_for_sync.clone());

        // Send the message and wait for response
        // We'll handle the response in the message receiver task
        // But we need to store a pending sync request

        // For now, we'll emit an event to frontend to trigger the list
        let _ = app_handle_for_sync.emit(
            &format!("sync-tcp-sessions-{}", session_id_for_sync),
            &serde_json::json!({
                "action": "list",
                "session_id": session_id_for_sync,
            }),
        );
    });

    // Session is now ready to handle terminal operations
    // Terminal input/output will be handled through the new message protocol

    Ok(session_id)
}

// Helper function to send messages via QUIC client
async fn send_message_via_client(
    state: &State<'_, AppState>,
    connection_id: &str,
    message: ClawdChatMessage,
    operation_name: &str,
) -> Result<(), String> {
    let client_guard = state.quic_client.read().await;
    if let Some(quic_client) = client_guard.as_ref() {
        if let Err(e) = quic_client
            .send_message_to_server(connection_id, message)
            .await
        {
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::error!("Failed to send {} message: {}", operation_name, e);

            // 如果是连接不存在的错误，提供更友好的错误信息
            let error_str = e.to_string();
            if error_str.contains("Connection not found") {
                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::warn!(
                    "Connection {} not found. This indicates the placeholder connection was not established properly.",
                    connection_id
                );

                Err(format!(
                    "Failed to send {} message: Connection '{}' is not properly established. This is a known limitation of the current placeholder connection system. The terminal session is created, but actual message sending requires a real QUIC connection implementation.",
                    operation_name, connection_id
                ))
            } else {
                Err(format!("Failed to send {} message: {}", operation_name, e))
            }
        } else {
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::info!("{} message sent successfully", operation_name);
            Ok(())
        }
    } else {
        Err("QUIC client not available".to_string())
    }
}

#[tauri::command]
#[allow(dead_code)]
async fn send_directed_message(
    _request: DirectedMessageRequest,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    Err("Directed messages are deprecated. Use terminal commands instead.".to_string())
}

#[tauri::command(rename_all = "camelCase")]
async fn execute_remote_command(
    command: String,
    session_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Convert to use the new terminal input protocol
    send_terminal_input_to_terminal(session_id, terminal_id, format!("{}\n", command), state).await
}

#[tauri::command]
async fn disconnect_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::info!("Disconnecting session: {}", session_id);

    let session = {
        let mut sessions = state.sessions.write().await;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        // Cancel all async tasks for this session
        session.cancellation_token.cancel();

        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!("Cancelled async tasks for session: {}", session_id);

        let quic_client = {
            let client_guard = state.quic_client.read().await;
            client_guard.as_ref().cloned()
        };

        // Disconnect from QUIC server
        if let Some(quic_client) = quic_client {
            if let Err(e) = quic_client
                .disconnect_from_server(&session.connection_id)
                .await
            {
                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::error!("Failed to disconnect from QUIC server: {}", e);
            } else {
                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::info!("Successfully disconnected from QUIC server");
            }
        }

        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!("Session {} disconnected successfully", session_id);
    } else {
        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
        tracing::info!("Session {} not found during disconnect", session_id);
    }

    Ok(())
}

#[tauri::command]
async fn get_active_sessions(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let sessions = state.sessions.read().await;
    Ok(sessions.keys().cloned().collect())
}

#[tauri::command]
async fn get_node_info(state: State<'_, AppState>) -> Result<String, String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };
    Ok(format!("{:?}", quic_client.get_node_id().await))
}

#[tauri::command]
async fn parse_session_ticket(ticket: String) -> Result<String, String> {
    // Use the same validation function
    if is_valid_session_ticket(&ticket) {
        Ok(ticket)
    } else {
        Err("Invalid session ticket format".to_string())
    }
}

#[tauri::command]
async fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    clawdchat_shared::list_directory(&path)
}

/// Helper function to check and initialize QUIC client if needed
async fn ensure_quic_client_initialized(
    state: &State<'_, AppState>,
) -> Result<QuicMessageClientHandle, String> {
    let client_guard = state.quic_client.read().await;
    match client_guard.as_ref() {
        Some(c) => Ok(c.clone()),
        None => {
            // Try to auto-initialize
            drop(client_guard); // Release the read lock
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::info!("QUIC client not initialized, attempting auto-initialization...");

            // Initialize network - use internal function that works with references
            // Note: passing None for app_handle as this is auto-initialization path
            initialize_network_internal(state, None).await?;

            // Try again
            let client_guard = state.quic_client.read().await;
            match client_guard.as_ref() {
                Some(c) => Ok(c.clone()),
                None => {
                    return Err(
                        "QUIC client initialization failed. Please restart the application."
                            .to_string(),
                    );
                }
            }
        }
    }
}

/// Start background cleanup task for session management
async fn start_cleanup_task(state: &State<'_, AppState>) {
    let cleanup_guard = state.cleanup_token.read().await;

    // Don't start multiple cleanup tasks
    if cleanup_guard.is_some() {
        return;
    }
    drop(cleanup_guard);

    let token = CancellationToken::new();
    {
        let mut cleanup_guard = state.cleanup_token.write().await;
        *cleanup_guard = Some(token.clone());
    }

    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::info!(
        "Starting session cleanup task with interval: {}s",
        CLEANUP_INTERVAL_SECS
    );
}

// === Terminal Management Commands ===

#[tauri::command(rename_all = "camelCase")]
async fn create_terminal(
    session_id: String,
    name: Option<String>,
    shell_path: Option<String>,
    working_dir: Option<String>,
    size: Option<(u16, u16)>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message
    let action = TerminalAction::Create {
        name,
        shell_path,
        working_dir,
        size: size.unwrap_or((24, 80)),
    };

    let message = MessageBuilder::terminal_management(
        "clawdchat_app".to_string(),
        action,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal creation").await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn stop_terminal(
    session_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message for stopping terminal
    let action = TerminalAction::Stop {
        terminal_id: terminal_id.clone(),
    };

    let message = MessageBuilder::terminal_management(
        "clawdchat_app".to_string(),
        action,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal stop").await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn list_terminals(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message for listing terminals
    let message = MessageBuilder::terminal_management(
        "clawdchat_app".to_string(),
        TerminalAction::List,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal list").await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn send_terminal_input_to_terminal(
    session_id: String,
    terminal_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal I/O message
    let message = MessageBuilder::terminal_io(
        "clawdchat_app".to_string(),
        terminal_id,
        IODataType::Input,
        input.as_bytes().to_vec(),
    )
    .with_session(session_id.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal input").await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn resize_terminal(
    session_id: String,
    terminal_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message for resizing terminal
    let action = TerminalAction::Resize {
        terminal_id: terminal_id.clone(),
        rows,
        cols,
    };

    let message = MessageBuilder::terminal_management(
        "clawdchat_app".to_string(),
        action,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal resize").await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn get_terminal_list(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    list_terminals(session_id, state).await
}

#[tauri::command(rename_all = "camelCase")]
async fn connect_to_terminal(
    session_id: String,
    terminal_id: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::info!(
        "connect_to_terminal called for session {} terminal {} (now a no-op)",
        session_id,
        terminal_id
    );

    Ok(())
}

/// 获取终端日志
#[tauri::command(rename_all = "camelCase")]
async fn get_terminal_logs(
    session_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message for getting logs
    let action = TerminalAction::GetLogs {
        terminal_id: terminal_id.clone(),
    };

    let message = MessageBuilder::terminal_management(
        "clawdchat_app".to_string(),
        action,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // Send message via QUIC client
    send_message_via_client(
        &state,
        &session.connection_id,
        message,
        "terminal logs request",
    )
    .await?;

    Ok(())
}

#[tauri::command]
async fn list_remote_directory(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Generate a request_id for tracking the response
    let request_id = uuid::Uuid::new_v4().to_string();

    // Create file browser message for listing directory
    let action = FileBrowserAction::ListDirectory {
        path: path.clone(),
    };

    let message = MessageBuilder::file_browser(
        "clawdchat_app".to_string(),
        action,
        Some(request_id.clone()),
    )
    .with_session(session_id.clone());

    // Send message via QUIC client
    send_message_via_client(
        &state,
        &session.connection_id,
        message,
        "list directory request",
    )
    .await?;

    // Return the request_id so frontend can match the response
    Ok(request_id)
}

#[tauri::command]
#[cfg(target_os = "macos")]
async fn show_panel(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Create panel if it doesn't exist
    if app_handle.get_webview_panel("main").is_err() {
        let _panel = PanelBuilder::<_, macos_panel::FloatingPanel<_>>::new(&app_handle, "main")
            .style_mask(
                StyleMask::default()
                    .titled()
                    .closable()
                    .resizable()
                    .full_size_content_view()
                    .nonactivating_panel(),
            )
            .level(PanelLevel::Floating)
            .build();
    }

    let panel = app_handle
        .get_webview_panel("main")
        .map_err(|e| format!("Panel error: {:?}", e))?;
    panel.show();

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "macos")]
async fn hide_panel(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Ok(panel) = app_handle.get_webview_panel("main") {
        panel.hide();
    }
    Ok(())
}

// === TCP Forwarding Management Commands ===

#[tauri::command(rename_all = "camelCase")]
async fn create_tcp_forwarding_session(
    session_id: String,
    local_addr: String,
    remote_host: Option<String>,
    remote_port: Option<u16>,
    forwarding_type: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // 验证转发类型 - 只支持 ListenToRemote
    let _fwd_type = match forwarding_type.as_str() {
        "ListenToRemote" | "listen-to-remote" => TcpForwardingType::ListenToRemote,
        _ => {
            return Err("Invalid forwarding type. Only 'ListenToRemote' is supported".to_string());
        }
    };

    // 获取远程主机和端口
    let remote_host = remote_host.ok_or("Remote host is required")?;
    let remote_port = remote_port.ok_or("Remote port is required")?;

    // 获取 QUIC 客户端用于发送数据
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    // 在本地创建 TCP 转发会话（pending 状态，不启动监听器）
    let session_id_result = {
        let manager = state.tcp_forwarding_manager.lock().await;
        manager
            .create_session_pending(local_addr.clone(), remote_host.clone(), remote_port)
            .await
            .map_err(|e| format!("Failed to create TCP forwarding session: {}", e))?
    };

    // 发送会话创建通知给 CLI 端（携带我们的 session_id）
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    let action = TcpForwardingAction::CreateSession {
        local_addr,
        remote_host: Some(remote_host),
        remote_port: Some(remote_port),
        forwarding_type: TcpForwardingType::ListenToRemote,
        session_id: Some(session_id_result.clone()), // 发送我们的 session_id 给 CLI
    };

    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        action,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // 获取正确的 connection_id
    let connection_id = session.connection_id;

    // 使用直接发送
    if let Err(e) = quic_client
        .send_message_to_server(&connection_id, message)
        .await
    {
        return Err(format!("Failed to notify CLI about TCP session: {}", e));
    }

    Ok(session_id_result)
}

#[tauri::command(rename_all = "camelCase")]
async fn list_tcp_forwarding_sessions(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // 创建列出 TCP 转发会话的消息
    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        TcpForwardingAction::ListSessions,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // 发送消息 via QUIC 客户端
    send_message_via_client(
        &state,
        &session.connection_id,
        message,
        "TCP forwarding sessions list",
    )
    .await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn stop_tcp_forwarding_session(
    session_id: String,
    tcp_session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // 创建停止 TCP 转发会话的消息
    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        TcpForwardingAction::StopSession {
            session_id: tcp_session_id,
        },
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // 发送消息 via QUIC 客户端
    send_message_via_client(
        &state,
        &session.connection_id,
        message,
        "TCP forwarding session stop",
    )
    .await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn get_tcp_forwarding_session_info(
    session_id: String,
    tcp_session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // 创建获取 TCP 转发会话信息的消息
    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        TcpForwardingAction::GetSessionInfo {
            session_id: tcp_session_id,
        },
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    // 发送消息 via QUIC 客户端
    send_message_via_client(
        &state,
        &session.connection_id,
        message,
        "TCP forwarding session info",
    )
    .await?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn send_tcp_data(
    session_id: String,
    tcp_session_id: String,
    connection_id: String,
    data: Vec<u8>,
    data_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // 解析数据类型
    let dt_type =
        match data_type.as_str() {
            "Data" | "data" => TcpDataType::Data,
            "ConnectionOpen" | "connection-open" => TcpDataType::ConnectionOpen,
            "ConnectionClose" | "connection-close" => TcpDataType::ConnectionClose,
            "Error" | "error" => TcpDataType::Error,
            _ => return Err(
                "Invalid data type. Use 'Data', 'ConnectionOpen', 'ConnectionClose', or 'Error'"
                    .to_string(),
            ),
        };

    // 创建 TCP 数据消息
    let message = MessageBuilder::tcp_data(
        "clawdchat_app".to_string(),
        tcp_session_id,
        connection_id,
        dt_type,
        data,
    )
    .with_session(session_id.clone());

    // 发送消息 via QUIC 客户端
    send_message_via_client(&state, &session.connection_id, message, "TCP data").await?;

    Ok(())
}

// ============================================================================
// AI Agent Commands - Slash Command Support
// ============================================================================

/// Send a slash command to an AI agent session
#[tauri::command(rename_all = "camelCase")]
async fn send_slash_command(
    session_id: String,
    command: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?
            .clone()
    };

    // Parse the command to determine if it's a builtin or passthrough
    let (command_type, raw_command) = if command.starts_with('/') {
        let parts: Vec<&str> = command.trim().split_whitespace().collect();
        let cmd = parts.first().copied().unwrap_or("");

        // Check if it's a ClawdChat builtin command
        match cmd {
            "/list" => {
                // This is handled by a different flow - send as passthrough for now
                ("passthrough", command.as_str())
            }
            "/spawn" => {
                // Extract parameters and send a RemoteSpawn message
                if parts.len() >= 3 {
                    let agent_type_str = parts.get(1).copied().unwrap_or("claude");
                    let project_path = parts.get(2).copied().unwrap_or(".");
                    let agent_type = match agent_type_str {
                        "claude" | "claudecode" => AgentType::ClaudeCode,
                        "claude_acp" | "claudeacp" => AgentType::ClaudeAcp,
                        "opencode" | "open" => AgentType::OpenCode,
                        "codex" => AgentType::Codex,
                        "gemini" => AgentType::Gemini,
                        "zeroclaw" => AgentType::ZeroClaw,
                        _ => AgentType::Custom,
                    };

                    let args = if parts.len() > 3 {
                        parts[3..].iter().map(|s| s.to_string()).collect()
                    } else {
                        vec![]
                    };

                    // Create RemoteSpawn message
                    let spawn_message = ClawdChatMessage::new(
                        clawdchat_shared::MessageType::RemoteSpawn,
                        "app".to_string(),
                        clawdchat_shared::MessagePayload::RemoteSpawn(
                            clawdchat_shared::RemoteSpawnMessage {
                                action: clawdchat_shared::RemoteSpawnAction::SpawnSession {
                                    session_id: session_id.clone(),
                                    agent_type,
                                    project_path: project_path.to_string(),
                                    args,
                                },
                                request_id: None,
                            },
                        ),
                    )
                    .requires_response();

                    send_message_via_client(
                        &state,
                        &session.connection_id,
                        spawn_message,
                        "remote spawn",
                    )
                    .await?;
                    return Ok("spawn_request_sent".to_string());
                }
                ("passthrough", command.as_str())
            }
            "/stop" => {
                // Stop session command
                if parts.len() >= 2 {
                    let target_session_id = parts.get(1).copied().unwrap_or(&session_id.as_str());
                    disconnect_session(target_session_id.to_string(), state).await?;
                    return Ok("session_stopped".to_string());
                }
                ("passthrough", command.as_str())
            }
            _ => ("passthrough", command.as_str()),
        }
    } else {
        ("passthrough", command.as_str())
    };

    match command_type {
        "passthrough" => {
            // Send as AgentControl::SendInput
            let control_message = ClawdChatMessage::new(
                clawdchat_shared::MessageType::AgentControl,
                "app".to_string(),
                clawdchat_shared::MessagePayload::AgentControl(
                    clawdchat_shared::AgentControlMessage {
                        session_id: session_id.clone(),
                        action: AgentControlAction::SendInput {
                            content: raw_command.to_string(),
                        },
                        request_id: None,
                    },
                ),
            )
            .requires_response();

            send_message_via_client(
                &state,
                &session.connection_id,
                control_message,
                "agent command",
            )
            .await?;
            Ok("command_sent".to_string())
        }
        _ => Ok("unknown_command".to_string()),
    }
}

/// Spawn a remote AI agent session
#[tauri::command(rename_all = "camelCase")]
async fn remote_spawn_session(
    connection_session_id: String,
    agent_type: String,
    project_path: String,
    args: Vec<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&connection_session_id)
            .ok_or_else(|| format!("Connection session not found: {}", connection_session_id))?
            .clone()
    };

    // Generate a new unique session ID for the agent
    let agent_session_id = format!("agent_{}", uuid::Uuid::new_v4());

    // Parse agent type
    let agent_type = match agent_type.to_lowercase().as_str() {
        "claude" | "claudecode" | "claude-code" => AgentType::ClaudeCode,
        "claude_acp" | "claudeacp" => AgentType::ClaudeAcp,
        "opencode" | "open" | "openai" => AgentType::OpenCode,
        "codex" => AgentType::Codex,
        "gemini" | "gemini-cli" => AgentType::Gemini,
        "zeroclaw" => AgentType::ZeroClaw,
        "custom" => AgentType::Custom,
        _ => return Err(format!("Unknown agent type: {}", agent_type)),
    };

    // Platform-based agent availability check
    #[cfg(mobile)]
    {
        // On mobile platforms, only ZeroClaw is supported (for remote P2P agent management)
        match agent_type {
            AgentType::ZeroClaw | AgentType::Custom => {}
            _ => {
                return Err(format!(
                    "{:?} is not available on mobile platform. Only ZeroClaw is supported.",
                    agent_type
                ));
            }
        }
    }
    #[cfg(not(mobile))]
    {
        // On desktop platforms, all agent types are available
    }

    // Create RemoteSpawn message
    let spawn_message = ClawdChatMessage::new(
        clawdchat_shared::MessageType::RemoteSpawn,
        "app".to_string(),
        clawdchat_shared::MessagePayload::RemoteSpawn(clawdchat_shared::RemoteSpawnMessage {
            action: clawdchat_shared::RemoteSpawnAction::SpawnSession {
                session_id: agent_session_id.clone(),
                agent_type,
                project_path: project_path,
                args,
            },
            request_id: None,
        }),
    )
    .requires_response();

    send_message_via_client(
        &state,
        &session.connection_id,
        spawn_message,
        "remote spawn",
    )
    .await?;
    Ok("spawn_request_sent".to_string())
}

/// Respond to an agent permission request
#[tauri::command(rename_all = "camelCase")]
async fn respond_to_agent_permission(
    session_id: String,
    permission_id: String,
    approved: bool,
    approve_for_session: bool,
    control_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // For AI agent sessions, we need to find the correct connection to the CLI
    let connection_id = if let Some(cs_id) = control_session_id {
        let sessions = state.sessions.read().await;
        sessions
            .get(&cs_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Control session not found: {}", cs_id))?
    } else {
        // Fallback to the first available connection ID
        let sessions = state.sessions.read().await;
        if let Some(first_session) = sessions.values().next() {
            first_session.connection_id.clone()
        } else {
            return Err("No active connection available".to_string());
        }
    };

    use clawdchat_shared::PermissionMode;

    let response_mode = if !approved {
        PermissionMode::Deny
    } else if approve_for_session {
        PermissionMode::ApproveForSession
    } else {
        PermissionMode::AlwaysAsk
    };

    let permission_response = AgentPermissionResponse {
        request_id: permission_id,
        approved,
        permission_mode: response_mode,
        decided_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        reason: None,
    };

    let permission_message = ClawdChatMessage::new(
        clawdchat_shared::MessageType::AgentPermission,
        "app".to_string(),
        clawdchat_shared::MessagePayload::AgentPermission(
            clawdchat_shared::AgentPermissionMessage {
                inner: clawdchat_shared::AgentPermissionMessageInner::Response(permission_response),
            },
        ),
    )
    .with_session(session_id);

    send_message_via_client(&state, &connection_id, permission_message, "permission response")
        .await?;
    Ok(())
}

/// Respond to a local agent permission request
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_respond_to_agent_permission(
    session_id: String,
    permission_id: String,
    approved: bool,
    _approve_for_session: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    manager
        .respond_to_permission(&session_id, permission_id, approved, None)
        .await
        .map_err(|e| format!("Failed to respond to local agent permission: {}", e))
}

/// Send a message to an AI agent session
#[tauri::command(rename_all = "camelCase")]
async fn send_agent_message(
    session_id: String,
    content: String,
    control_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // For AI agent sessions, we need to find the correct connection to the CLI
    let connection_id = if let Some(cs_id) = control_session_id {
        let sessions = state.sessions.read().await;
        sessions
            .get(&cs_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Control session not found: {}", cs_id))?
    } else {
        // Fallback to the first available connection ID
        let sessions = state.sessions.read().await;
        if let Some(first_session) = sessions.values().next() {
            first_session.connection_id.clone()
        } else {
            return Err("No active connection available".to_string());
        }
    };

    // Send as AgentControl::SendInput
    let control_message = ClawdChatMessage::new(
        clawdchat_shared::MessageType::AgentControl,
        "app".to_string(),
        clawdchat_shared::MessagePayload::AgentControl(clawdchat_shared::AgentControlMessage {
            session_id: session_id,
            action: AgentControlAction::SendInput { content },
            request_id: None,
        }),
    )
    .requires_response();

    send_message_via_client(&state, &connection_id, control_message, "agent message").await?;
    Ok(())
}

/// Abort an action in an AI agent session
#[tauri::command(rename_all = "camelCase")]
async fn abort_agent_action(
    session_id: String,
    control_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // For AI agent sessions, we need to find the correct connection to the CLI
    let connection_id = if let Some(cs_id) = control_session_id {
        let sessions = state.sessions.read().await;
        sessions
            .get(&cs_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Control session not found: {}", cs_id))?
    } else {
        // Fallback to the first available connection ID
        let sessions = state.sessions.read().await;
        if let Some(first_session) = sessions.values().next() {
            first_session.connection_id.clone()
        } else {
            return Err("No active connection available".to_string());
        }
    };

    // Send as AgentControl::SendInterrupt
    let control_message = ClawdChatMessage::new(
        clawdchat_shared::MessageType::AgentControl,
        "app".to_string(),
        clawdchat_shared::MessagePayload::AgentControl(clawdchat_shared::AgentControlMessage {
            session_id,
            action: AgentControlAction::SendInterrupt,
            request_id: None,
        }),
    )
    .requires_response();

    send_message_via_client(&state, &connection_id, control_message, "agent interrupt").await?;
    Ok(())
}

// ============================================================================
// Local Agent Management Commands
// ============================================================================

/// Start a local AI agent session (in-app, no P2P)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_start_agent(
    agent_type_str: String,
    project_path: String,
    session_id: Option<String>,
    extra_args: Option<Vec<String>>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Parse agent type
    let agent_type = match agent_type_str.as_str() {
        "claude" => AgentType::ClaudeCode,
        "claude_acp" | "claudeacp" => AgentType::ClaudeAcp,
        "opencode" => AgentType::OpenCode,
        "gemini" => AgentType::Gemini,
        "copilot" => AgentType::Copilot,
        "qwen" => AgentType::Qwen,
        "codex" => AgentType::Codex,
        "zeroclaw" => AgentType::ZeroClaw,
        "custom" => AgentType::Custom,
        _ => return Err(format!("Unknown agent type: {}", agent_type_str)),
    };

    // Platform-based agent availability check
    #[cfg(mobile)]
    {
        // On mobile platforms, only ZeroClaw is supported (for remote P2P agent management)
        match agent_type {
            AgentType::ZeroClaw | AgentType::Custom => {}
            _ => {
                return Err(format!(
                    "{} is not available on mobile platform. Only ZeroClaw is supported.",
                    agent_type_str
                ));
            }
        }
    }
    #[cfg(not(mobile))]
    {
        // On desktop platforms, all agent types are available
    }

    // Ensure agent manager is initialized
    {
        let mut agent_manager_guard = state.agent_manager.write().await;
        if agent_manager_guard.is_none() {
            let manager = Arc::new(AgentManager::new());
            *agent_manager_guard = Some(manager.clone());
            drop(agent_manager_guard);

            // Start event broadcasting task
            // Events are handled per-session via the subscribe() call below
            tracing::info!("Local agent manager initialized");
        } else {
            drop(agent_manager_guard);
        }
    }

    // Get or create session ID
    let session_id = if let Some(sid) = session_id.clone() {
        sid
    } else {
        uuid::Uuid::new_v4().to_string()
    };

    // Start the agent session
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    // Expand ~ in project path to HOME directory
    let expanded_project_path = if project_path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            format!("{}{}", home, &project_path[1..])
        } else {
            project_path.clone()
        }
    } else if project_path == "~" {
        std::env::var("HOME").unwrap_or(project_path.clone())
    } else {
        project_path.clone()
    };

    let working_dir = std::path::PathBuf::from(&expanded_project_path);
    if !working_dir.exists() {
        return Err(format!(
            "Project path does not exist: {}",
            expanded_project_path
        ));
    }

    manager
        .start_session_with_id(
            session_id.clone(),
            agent_type,
            None,                           // binary_path
            extra_args.unwrap_or_default(), // extra_args
            working_dir,                    // working_dir
            None,                           // home_dir
            "local".to_string(),            // source
        )
        .await
        .map_err(|e| format!("Failed to start local agent: {}", e))?;

    // Subscribe to agent events for broadcasting to frontend
    if let Some(mut event_rx) = manager.subscribe(&session_id).await {
        // Clone session_id for use in the spawn closure
        let session_id_for_spawn = session_id.clone();
        tokio::spawn(async move {
            // Convert agent events to frontend format
            while let Ok(event) = event_rx.recv().await {
                // Convert AgentTurnEvent to frontend-expected JSON
                let event_payload =
                    clawdchat_shared::message_adapter::event_to_message_content(&event.event, None);
                let session_id_clone = session_id_for_spawn.clone();
                let frontend_event = serde_json::json!({
                    "sessionId": session_id_clone.clone(),
                    "turnId": event.turn_id,
                    "event": event_payload,
                });

                let _ = app_handle.emit("local-agent-event", &frontend_event);
            }
        });
    }

    Ok(session_id)
}

/// Stop a local agent session
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_stop_agent(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    manager
        .stop_session(&session_id)
        .await
        .map_err(|e| format!("Failed to stop local agent: {}", e))
}

/// Send a message to a local agent
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_send_agent_message(
    session_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    manager
        .send_message(&session_id, content)
        .await
        .map_err(|e| format!("Failed to send message to local agent: {}", e))
}

/// Abort a local agent action
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_abort_agent_action(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    manager
        .interrupt_session(&session_id)
        .await
        .map_err(|e| format!("Failed to interrupt local agent: {}", e))
}

/// List all active local agent sessions
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_list_agents(
    state: State<'_, AppState>,
) -> Result<Vec<clawdchat_shared::message_protocol::AgentSessionMetadata>, String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = match agent_manager_guard.as_ref() {
        Some(m) => m.clone(),
        None => return Ok(Vec::new()),
    };

    let session_ids = manager.list_sessions().await;
    let mut sessions = Vec::new();
    for sid in session_ids {
        let agent_type = manager
            .get_session_agent_type(&sid)
            .await
            .unwrap_or(AgentType::Custom);
        sessions.push(clawdchat_shared::message_protocol::AgentSessionMetadata {
            session_id: sid,
            agent_type,
            project_path: String::new(),
            started_at: 0,
            active: true,
            controlled_by_remote: false,
            hostname: String::new(),
            os: String::new(),
            agent_version: None,
            current_dir: String::new(),
            git_branch: None,
            machine_id: String::new(),
        });
    }
    Ok(sessions)
}

/// Get agent session metadata (for session info display)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_get_agent_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<clawdchat_shared::message_protocol::AgentSessionMetadata>, String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = match agent_manager_guard.as_ref() {
        Some(m) => m.clone(),
        None => return Ok(Vec::new()),
    };

    let session_ids = manager.list_sessions().await;
    let mut sessions = Vec::new();
    for sid in session_ids {
        let agent_type = manager
            .get_session_agent_type(&sid)
            .await
            .unwrap_or(AgentType::Custom);
        sessions.push(clawdchat_shared::message_protocol::AgentSessionMetadata {
            session_id: sid,
            agent_type,
            project_path: String::new(),
            started_at: 0,
            active: true,
            controlled_by_remote: false,
            hostname: String::new(),
            os: String::new(),
            agent_version: None,
            current_dir: String::new(),
            git_branch: None,
            machine_id: String::new(),
        });
    }
    Ok(sessions)
}

/// Initialize tracing with conditional log levels based on build configuration
fn init_tracing() {
    // Set different log levels based on build profile and features
    #[cfg(all(not(debug_assertions), feature = "release-logging"))]
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "error".into());

    #[cfg(not(all(not(debug_assertions), feature = "release-logging")))]
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(filter))
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing based on build configuration
    init_tracing();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    #[cfg(desktop)]
    {
        builder = builder
            // .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                let _ = app
                    .get_webview_window("main")
                    .expect("no main window")
                    .set_focus();
            }));
    }

    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    }

    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            initialize_network_with_relay,
            initialize_network,
            connect_to_host,
            connect_to_peer,
            execute_remote_command, // Kept for compatibility but redirects to terminal input
            disconnect_session,
            get_active_sessions,
            get_node_info,
            parse_session_ticket,
            list_directory,
            // Terminal Management
            create_terminal,
            stop_terminal,
            list_terminals,
            get_terminal_list,
            send_terminal_input_to_terminal,
            resize_terminal,
            connect_to_terminal, // Kept as no-op for compatibility
            get_terminal_logs,   // Get terminal logs from CLI
            list_remote_directory, // List remote directory via P2P
            // TCP Forwarding Management
            create_tcp_forwarding_session,
            list_tcp_forwarding_sessions,
            stop_tcp_forwarding_session,
            get_tcp_forwarding_session_info,
            send_tcp_data,
            // AI Agent Commands
            send_slash_command,
            remote_spawn_session,
            send_agent_message,
            abort_agent_action,
            respond_to_agent_permission,
            // Local Agent Commands (desktop only)
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_start_agent,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_stop_agent,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_send_agent_message,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_abort_agent_action,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_respond_to_agent_permission,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_list_agents,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_get_agent_sessions,
            // macOS Panel Commands
            #[cfg(target_os = "macos")]
            show_panel,
            #[cfg(target_os = "macos")]
            hide_panel,
        ])
        .setup(|_app| {
            // No additional setup needed - ensure_quic_client_initialized handles auto-initialization
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
