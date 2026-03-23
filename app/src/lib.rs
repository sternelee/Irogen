use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tauri::{Emitter, State};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::{RwLock, broadcast};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
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
use shared::AgentManager;
use shared::{
    AgentControlAction, AgentPermissionMode, AgentPermissionResponse, AgentType,
    CommunicationManager, DirEntry, Event, EventListener, EventType, FileBrowserAction,
    FileBrowserEntry, MESSAGE_PROTOCOL_VERSION, MentionCandidate, Message as ClawdChatMessage,
    MessageBuilder, MessagePayload, QuicMessageClientHandle, SystemAction, TcpDataType,
    TcpForwardingAction, TcpForwardingType,
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
fn parse_ticket_to_node_addr(
    ticket: &str,
) -> Result<iroh_base::EndpointAddr, Box<dyn std::error::Error>> {
    use base64::Engine as _;
    use base64::engine::general_purpose;
    use data_encoding::BASE32_NOPAD;
    use iroh_base::{EndpointAddr, PublicKey, RelayUrl, TransportAddr};
    use iroh_tickets::endpoint::EndpointTicket;
    use shared::SerializableEndpointAddr;
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
        #[allow(dead_code)]
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

pub struct AppState {
    sessions: RwLock<HashMap<String, ConnectionSession>>,
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
pub struct ConnectionSession {
    pub id: String,
    pub connection_id: String,
    pub node_id: String,
    pub last_activity: Arc<std::sync::Mutex<Instant>>,
    pub cancellation_token: CancellationToken,
    pub event_count: Arc<std::sync::atomic::AtomicUsize>,
    // Note: message_receiver is not included here as it can't be cloned
    // It's managed separately in the connection task
}

#[derive(Serialize)]
struct PendingPermissionDto {
    request_id: String,
    tool_name: String,
    tool_params: Value,
    message: Option<String>,
    created_at: u64,
}

/// App Event Listener that converts events to Tauri emissions
pub struct AppEventListener {
    app_handle: tauri::AppHandle,
    session_id: String,
    last_activity: Arc<std::sync::Mutex<Instant>>,
    event_count: Arc<std::sync::atomic::AtomicUsize>,
}

impl AppEventListener {
    pub fn new(
        app_handle: tauri::AppHandle,
        session_id: String,
        last_activity: Arc<std::sync::Mutex<Instant>>,
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
            let mut activity = self.last_activity.lock().unwrap();
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatusResponse {
    success: bool,
    status: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitDiffResponse {
    success: bool,
    file: Option<String>,
    diff: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileBrowserListResponse {
    success: bool,
    entries: Vec<FileBrowserEntry>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileBrowserReadResponse {
    success: bool,
    path: String,
    content: Option<String>,
    error: Option<String>,
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
        // 移动端使用持久化密钥以支持重连和会话恢复
        match app_handle {
            Some(handle) => {
                let app_data_dir = handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("Failed to get app data directory: {}", e))?;
                std::fs::create_dir_all(&app_data_dir)
                    .map_err(|e| format!("Failed to create app data directory: {}", e))?;
                let path = app_data_dir.join("clawdchat_app_secret_key");
                info!("🔑 Using persistent secret key for mobile: {:?}", path);
                Some(path)
            }
            None => {
                tracing::info!("🔑 Using temporary secret key for mobile (no app handle)");
                None
            }
        }
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
    if let Some(handle) = app_handle {
        start_cleanup_task(state, handle.clone()).await;
    }

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

    let mut stale_session_to_remove: Option<(String, String)> = None;

    // Check if there's already a session to the same node.
    // Reuse only if the existing control connection still passes readiness/protocol checks.
    {
        let sessions = state.sessions.read().await;
        for (existing_session_id, session) in sessions.iter() {
            if session.node_id == node_id_str {
                {
                    let mut last_activity = session.last_activity.lock().unwrap();
                    *last_activity = Instant::now();
                }

                match probe_control_connection(&state, &session.connection_id, existing_session_id)
                    .await
                {
                    Ok(()) => {
                        tracing::info!(
                            "Reusing existing session {} for node {}",
                            existing_session_id,
                            node_id_str
                        );
                        return Ok(existing_session_id.clone());
                    }
                    Err(e) => {
                        tracing::warn!(
                            "Existing session {} failed readiness probe and will be recreated: {}",
                            existing_session_id,
                            e
                        );
                        stale_session_to_remove =
                            Some((existing_session_id.clone(), session.connection_id.clone()));
                        break;
                    }
                }
            }
        }
    }

    if let Some((stale_session_id, stale_connection_id)) = stale_session_to_remove {
        {
            let mut sessions = state.sessions.write().await;
            sessions.remove(&stale_session_id);
        }
        let client_guard = state.quic_client.read().await;
        if let Some(quic_client) = client_guard.as_ref() {
            let _ = quic_client
                .disconnect_from_server(&stale_connection_id)
                .await;
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
                use iroh_base::TransportAddr;
                let direct_addrs: Vec<_> = node_addr
                    .addrs
                    .iter()
                    .filter_map(|a| {
                        if let TransportAddr::Ip(addr) = a {
                            Some(addr.to_string())
                        } else {
                            None
                        }
                    })
                    .collect();
                let relay_url = node_addr
                    .addrs
                    .iter()
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
            let receiver = quic_client.get_message_receiver();

            // Establish actual QUIC connection using full NodeAddr (supports direct addresses and relay)
            let connection_id = match quic_client
                .connect_to_server_with_node_addr(&node_addr)
                .await
            {
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

    // Hard readiness check: connect_to_host only succeeds after control-plane RTT succeeds.
    if let Err(probe_err) = probe_control_connection(&state, &connection_id, &session_id).await {
        // Best-effort disconnect of the half-ready connection.
        let client_guard = state.quic_client.read().await;
        if let Some(quic_client) = client_guard.as_ref() {
            let _ = quic_client.disconnect_from_server(&connection_id).await;
        }
        return Err(format!(
            "Connection established but not ready for control messages: {}",
            probe_err
        ));
    }

    // Create terminal session with enhanced tracking
    let cancellation_token = CancellationToken::new();
    let terminal_session = ConnectionSession {
        id: session_id.clone(),
        connection_id: connection_id.clone(),
        node_id: node_id_str.clone(),
        last_activity: Arc::new(std::sync::Mutex::new(Instant::now())),
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
    let _connection_id_clone = connection_id.clone();
    let cancellation_token_receiver = cancellation_token.clone();
    let last_activity_receiver = terminal_session.last_activity.clone();
    let event_count_receiver = terminal_session.event_count.clone();
    let tcp_forwarding_manager = state.tcp_forwarding_manager.clone();
    let _quic_client_for_receiver = {
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
                                let mut activity = last_activity_receiver.lock().unwrap();
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

                            // 拦截健康监控发出的连接状态信号
                            if let MessagePayload::Heartbeat(hb) = &message.payload {
                                if message.sender_id == "system" {
                                    match hb.status.as_str() {
                                        "connection_lost" => {
                                            tracing::info!("Connection lost for session {}", session_id_clone);
                                            let _ = app_handle_clone.emit(
                                                "peer-disconnected",
                                                serde_json::json!({ "sessionId": session_id_clone }),
                                            );
                                            let _ = app_handle_clone.emit(
                                                "connection-state-changed",
                                                serde_json::json!({
                                                    "sessionId": session_id_clone,
                                                    "state": "disconnected"
                                                }),
                                            );
                                            continue;
                                        }
                                        "reconnecting" => {
                                            let _ = app_handle_clone.emit(
                                                "connection-state-changed",
                                                serde_json::json!({
                                                    "sessionId": session_id_clone,
                                                    "state": "reconnecting"
                                                }),
                                            );
                                            continue;
                                        }
                                        "connected" => {
                                            tracing::info!("Connection restored for session {}", session_id_clone);
                                            let _ = app_handle_clone.emit(
                                                "connection-state-changed",
                                                serde_json::json!({
                                                    "sessionId": session_id_clone,
                                                    "state": "connected"
                                                }),
                                            );
                                            continue;
                                        }
                                        _ => {} // 普通心跳，继续处理
                                    }
                                }
                            }

                            // Convert message to event and emit to frontend
                            match &message.payload {
                                MessagePayload::Response(response) => {
                                    // Handle response messages
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Received response for session {}: success={}",
                                        session_id_clone, response.success);

                                    // Check response data type
                                    if let Some(ref data_str) = response.data {
                                        if let Ok(data_json) = serde_json::from_str::<serde_json::Value>(data_str) {
                                            if data_json.get("entries").is_some() && data_json.get("terminal_id").is_none() {
                                                // This is a directory listing response
                                                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                                tracing::info!("Received directory listing response");

                                                let mut normalized = data_json.clone();
                                                if let Some(entries) = normalized.get_mut("entries") {
                                                    if let Some(entries_array) = entries.as_array() {
                                                        let mut normalized_entries = Vec::with_capacity(entries_array.len());
                                                        for entry in entries_array {
                                                            match entry {
                                                                serde_json::Value::String(name) => {
                                                                    if !name.starts_with('.') {
                                                                        normalized_entries.push(serde_json::json!({
                                                                            "name": name,
                                                                            "is_dir": true
                                                                        }));
                                                                    }
                                                                }
                                                                serde_json::Value::Object(obj) => {
                                                                    let is_dir = obj
                                                                        .get("is_dir")
                                                                        .or_else(|| obj.get("isDir"))
                                                                        .and_then(|v| v.as_bool())
                                                                        .unwrap_or(false);
                                                                    let name_val = obj.get("name");
                                                                    let name = match name_val {
                                                                        Some(serde_json::Value::String(s)) => Some(s.clone()),
                                                                        Some(serde_json::Value::Object(map)) => map
                                                                            .get("Unix")
                                                                            .and_then(|v| v.as_array())
                                                                            .map(|arr| {
                                                                                let bytes: Vec<u8> = arr
                                                                                    .iter()
                                                                                    .filter_map(|v| v.as_u64().map(|n| n as u8))
                                                                                    .collect();
                                                                                String::from_utf8_lossy(&bytes).to_string()
                                                                            }),
                                                                        _ => None,
                                                                    };
                                                                    if let Some(name) = name {
                                                                        if !name.starts_with('.') {
                                                                            let mut item = serde_json::Map::new();
                                                                            item.insert("name".into(), serde_json::Value::String(name));
                                                                            item.insert("is_dir".into(), serde_json::Value::Bool(is_dir));
                                                                            if let Some(size) = obj.get("size") {
                                                                                item.insert("size".into(), size.clone());
                                                                            }
                                                                            normalized_entries.push(serde_json::Value::Object(item));
                                                                        }
                                                                    }
                                                                }
                                                                _ => {}
                                                            }
                                                        }
                                                        *entries = serde_json::Value::Array(normalized_entries);
                                                    }
                                                }

                                                // Emit directory listing to frontend
                                                let _ = app_handle_clone.emit(
                                                    &format!("remote-directory-listing-{}", session_id_clone),
                                                    &normalized,
                                                );
                                                let _ = app_handle_clone.emit(
                                                    "remote-directory-listing",
                                                    &normalized,
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
                                MessagePayload::AgentMessage(agent_msg) => {
                                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                    tracing::info!(
                                        "Received AgentMessage for session {}: {:?}",
                                        agent_msg.session_id,
                                        agent_msg.content
                                    );

                                    // Transform AgentMessageContent to frontend-expected format
                                    let event_payload = match &agent_msg.content {
                                        shared::message_protocol::AgentMessageContent::AgentResponse {
                                            content, thinking, message_id
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "response",
                                            "content": content,
                                            "thinking": thinking,
                                            "messageId": message_id,
                                        }),
                                        shared::message_protocol::AgentMessageContent::ToolCallUpdate {
                                            tool_name, status, output
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "tool_call",
                                            "toolName": tool_name,
                                            "status": format!("{:?}", status),
                                            "output": output,
                                        }),
                                        shared::message_protocol::AgentMessageContent::SystemNotification {
                                            level, message
                                        } => {
                                            // Send notification for non-empty system notifications (e.g., session ended)
                                            if !message.is_empty() {
                                                let _ = app_handle_clone
                                                    .notification()
                                                    .builder()
                                                    .title(format!("System {:?}", level))
                                                    .body(message.clone())
                                                    .show();
                                            }

                                            serde_json::json!({
                                                "sessionId": agent_msg.session_id,
                                                "type": "notification",
                                                "level": format!("{:?}", level),
                                                "message": message,
                                            })
                                        },
                                        shared::message_protocol::AgentMessageContent::UserMessage {
                                            content, attachments
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "user_message",
                                            "content": content,
                                            "attachments": attachments,
                                        }),
                                        shared::message_protocol::AgentMessageContent::TurnStarted {
                                            turn_id
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "turn_started",
                                            "turnId": turn_id,
                                        }),
                                        shared::message_protocol::AgentMessageContent::TextDelta {
                                            text, thinking
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "text_delta",
                                            "content": text,
                                            "thinking": thinking,
                                        }),
                                        shared::message_protocol::AgentMessageContent::TurnCompleted {
                                            content
                                        } => {
                                            // Send notification when agent completes response
                                            let _ = app_handle_clone
                                                .notification()
                                                .builder()
                                                .title("Agent Response Complete")
                                                .body(content.clone().unwrap_or_else(|| "Agent has completed its response".to_string()))
                                                .show();

                                            serde_json::json!({
                                                "sessionId": agent_msg.session_id,
                                                "type": "turn_completed",
                                                "content": content,
                                            })
                                        },
                                        shared::message_protocol::AgentMessageContent::TurnError {
                                            error
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": "turn_error",
                                            "error": error,
                                        }),
                                        shared::message_protocol::AgentMessageContent::RawEvent {
                                            event_type,
                                            data,
                                        } => serde_json::json!({
                                            "sessionId": agent_msg.session_id,
                                            "type": event_type,
                                            "data": data,
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
                                    if let shared::message_protocol::AgentPermissionMessageInner::Request(request) = &perm_msg.inner {
                                        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                        tracing::info!(
                                            "Received PermissionRequest for session {}: tool={}",
                                            request.session_id,
                                            request.tool_name
                                        );

                                        // Send notification for permission request
                                        let _ = app_handle_clone
                                            .notification()
                                            .builder()
                                            .title("Permission Required")
                                            .body(format!("{}: {}", request.tool_name, request.description.as_deref().unwrap_or("Needs your approval")))
                                            .show();

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
                                                "requestedAt": request.requested_at,
                                            })
                                        );
                                    }
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
                                _ => {
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Unhandled message type: {:?}", message.message_type);
                                }
                            }
                        }
                        Err(_) => {
                            tracing::info!("Message receiver closed for session: {}", session_id_clone);
                            // 通知前端连接断开
                            let _ = app_handle_clone.emit(
                                "peer-disconnected",
                                serde_json::json!({ "sessionId": session_id_clone }),
                            );
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

    // Sync existing TCP forwarding sessions from CLI
    // This allows the app to restore TCP sessions created by other clients
    let session_id_for_sync = session_id.clone();
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

        // For now, we'll emit an event to frontend to trigger the list
        let _ = app_handle_for_sync.emit(
            &format!("sync-tcp-sessions-{}", session_id_for_sync),
            &serde_json::json!({
                "action": "list",
                "session_id": session_id_for_sync,
            }),
        );
    });

    // Session is now ready to handle agent operations

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

// Helper function to send a message and wait for a ResponseMessage with matching request_id
async fn send_message_via_client_with_response(
    state: &State<'_, AppState>,
    connection_id: &str,
    message: ClawdChatMessage,
    request_id: &str,
    operation_name: &str,
    timeout_secs: u64,
) -> Result<shared::message_protocol::ResponseMessage, String> {
    let client_guard = state.quic_client.read().await;
    let Some(quic_client) = client_guard.as_ref() else {
        return Err("QUIC client not available".to_string());
    };

    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::info!(
        "[send_message_via_client_with_response] sending: operation={}, connection_id={}, request_id={}, message_id={}, message_type={:?}",
        operation_name,
        connection_id,
        request_id,
        message.id,
        message.message_type
    );

    let direct_response = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        quic_client.send_message_to_server_with_response(connection_id, message),
    )
    .await
    .map_err(|_| format!("Timed out waiting for {} response", operation_name))?
    .map_err(|e| format!("Failed to send {} message: {}", operation_name, e))?;

    let Some(msg) = direct_response else {
        return Err(format!(
            "No response received for {} (request_id={})",
            operation_name, request_id
        ));
    };

    match msg.payload {
        MessagePayload::Response(resp) => {
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::info!(
                "[send_message_via_client_with_response] direct response: operation={}, expected_request_id={}, actual_request_id={}, success={}",
                operation_name,
                request_id,
                resp.request_id,
                resp.success
            );

            if resp.request_id == request_id {
                Ok(resp)
            } else {
                Err(format!(
                    "Mismatched {} response request_id: expected {}, got {}",
                    operation_name, request_id, resp.request_id
                ))
            }
        }
        other => Err(format!(
            "Unexpected {} response payload: {:?}",
            operation_name, other
        )),
    }
}

async fn probe_control_connection(
    state: &State<'_, AppState>,
    connection_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let mut probe_err = String::new();

    for attempt in 1..=3 {
        let request_id = uuid::Uuid::new_v4().to_string();
        let probe_message = MessageBuilder::system_control(
            "clawdchat_app".to_string(),
            SystemAction::GetStatus,
            Some(request_id.clone()),
        )
        .with_session(session_id.to_string());

        match send_message_via_client_with_response(
            state,
            connection_id,
            probe_message,
            &request_id,
            "connect readiness probe",
            8,
        )
        .await
        {
            Ok(resp) if resp.success => {
                let remote_protocol_version = resp
                    .data
                    .as_deref()
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                    .and_then(|json| {
                        json.get("message_protocol_version")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as u8)
                    });

                if remote_protocol_version != Some(MESSAGE_PROTOCOL_VERSION) {
                    probe_err = format!(
                        "Remote CLI protocol mismatch. Expected version {}, got {}.",
                        MESSAGE_PROTOCOL_VERSION,
                        remote_protocol_version
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "<missing>".to_string())
                    );
                } else {
                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                    tracing::info!(
                        "connect_to_host readiness probe passed on attempt {}/3: session_id={}, connection_id={}",
                        attempt,
                        session_id,
                        connection_id
                    );
                    return Ok(());
                }
            }
            Ok(resp) => {
                probe_err = resp
                    .message
                    .unwrap_or_else(|| "probe response not successful".to_string());
            }
            Err(e) => {
                probe_err = e;
            }
        }

        if attempt < 3 {
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        }
    }

    Err(probe_err)
}

#[tauri::command]
#[allow(dead_code)]
async fn send_directed_message(
    _request: DirectedMessageRequest,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    Err("Directed messages are deprecated. Use terminal commands instead.".to_string())
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
    shared::list_directory(&path)
}

#[tauri::command(rename_all = "camelCase")]
async fn list_mention_candidates(
    base_path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<MentionCandidate>, String> {
    shared::list_mention_candidates(&base_path, &query, limit)
}

#[tauri::command]
async fn file_browser_list(path: String) -> FileBrowserListResponse {
    match shared::file_browser_list(&path) {
        Ok(entries) => FileBrowserListResponse {
            success: true,
            entries,
            error: None,
        },
        Err(error) => FileBrowserListResponse {
            success: false,
            entries: Vec::new(),
            error: Some(error),
        },
    }
}

#[tauri::command]
async fn file_browser_read(path: String) -> FileBrowserReadResponse {
    match shared::file_browser_read(&path) {
        Ok(content) => FileBrowserReadResponse {
            success: true,
            path,
            content: Some(content),
            error: None,
        },
        Err(error) => FileBrowserReadResponse {
            success: false,
            path,
            content: None,
            error: Some(error),
        },
    }
}

#[tauri::command]
async fn git_status(path: String) -> GitStatusResponse {
    match shared::git_status(&path) {
        Ok(status) => GitStatusResponse {
            success: true,
            status: Some(status),
            error: None,
        },
        Err(error) => GitStatusResponse {
            success: false,
            status: None,
            error: Some(error),
        },
    }
}

#[tauri::command]
async fn git_diff(path: String, file: String) -> GitDiffResponse {
    match shared::git_diff(&path, &file) {
        Ok(diff) => GitDiffResponse {
            success: true,
            file: Some(file),
            diff: Some(diff),
            error: None,
        },
        Err(error) => GitDiffResponse {
            success: false,
            file: Some(file),
            diff: None,
            error: Some(error),
        },
    }
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
async fn start_cleanup_task(state: &State<'_, AppState>, app_handle: tauri::AppHandle) {
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

    let cleanup_token = token;
    tokio::spawn(async move {
        let interval = std::time::Duration::from_secs(CLEANUP_INTERVAL_SECS);
        let stale_timeout = std::time::Duration::from_secs(1800); // 30 minutes

        loop {
            tokio::select! {
                _ = cleanup_token.cancelled() => {
                    tracing::info!("Session cleanup task cancelled");
                    break;
                }
                _ = tokio::time::sleep(interval) => {
                    let app_state = app_handle.state::<AppState>();
                    let now = std::time::Instant::now();
                    let mut stale_ids = Vec::new();

                    {
                        let sessions = app_state.sessions.read().await;
                        for (id, session) in sessions.iter() {
                            let last = *session.last_activity.lock().unwrap();
                            if now.duration_since(last) > stale_timeout {
                                tracing::info!(
                                    "Session {} idle for {:?}, marking stale",
                                    id, now.duration_since(last)
                                );
                                stale_ids.push(id.clone());
                            }
                        }
                    }

                    if !stale_ids.is_empty() {
                        tracing::info!("Cleaning up {} stale sessions", stale_ids.len());
                        let mut sessions = app_state.sessions.write().await;
                        for id in &stale_ids {
                            if let Some(session) = sessions.remove(id) {
                                session.cancellation_token.cancel();
                                tracing::info!("Cleaned up stale session: {}", id);
                            }
                        }
                    }
                }
            }
        }
    });
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
    let action = FileBrowserAction::ListDirectory { path: path.clone() };

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

#[tauri::command(rename_all = "camelCase")]
async fn list_remote_mention_candidates(
    session_id: String,
    base_path: String,
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<MentionCandidate>, String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    let request_id = uuid::Uuid::new_v4().to_string();
    let action = FileBrowserAction::ListMentionCandidates {
        base_path,
        query,
        limit,
    };
    let message = MessageBuilder::file_browser(
        "clawdchat_app".to_string(),
        action,
        Some(request_id.clone()),
    )
    .with_session(session_id);

    let response = send_message_via_client_with_response(
        &state,
        &session.connection_id,
        message,
        &request_id,
        "list mention candidates",
        10,
    )
    .await?;

    if !response.success {
        return Err(response
            .message
            .unwrap_or_else(|| "Failed to list mention candidates".to_string()));
    }

    let data = response
        .data
        .ok_or_else(|| "Missing mention candidates response data".to_string())?;
    let payload: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("Invalid response data: {}", e))?;

    let value = payload
        .get("candidates")
        .cloned()
        .unwrap_or(serde_json::Value::Array(Vec::new()));
    serde_json::from_value::<Vec<MentionCandidate>>(value)
        .map_err(|e| format!("Invalid mention candidates payload: {}", e))
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
    let _fwd_type = match forwarding_type.as_str() {
        "ListenToRemote" | "listen-to-remote" => TcpForwardingType::ListenToRemote,
        _ => {
            return Err("Invalid forwarding type. Only 'ListenToRemote' is supported".to_string());
        }
    };

    let remote_host = remote_host.ok_or("Remote host is required")?;
    let remote_port = remote_port.ok_or("Remote port is required")?;

    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session_id_result = {
        let manager = state.tcp_forwarding_manager.lock().await;
        manager
            .create_session_pending(local_addr.clone(), remote_host.clone(), remote_port)
            .await
            .map_err(|e| format!("Failed to create TCP forwarding session: {}", e))?
    };

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
        session_id: Some(session_id_result.clone()),
    };

    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        action,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

    let connection_id = session.connection_id;

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

    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        TcpForwardingAction::ListSessions,
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

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

    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        TcpForwardingAction::StopSession {
            session_id: tcp_session_id,
        },
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

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

    let message = MessageBuilder::tcp_forwarding(
        "clawdchat_app".to_string(),
        TcpForwardingAction::GetSessionInfo {
            session_id: tcp_session_id,
        },
        Some(session_id.clone()),
    )
    .with_session(session_id.clone());

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

    let message = MessageBuilder::tcp_data(
        "clawdchat_app".to_string(),
        tcp_session_id,
        connection_id,
        dt_type,
        data,
    )
    .with_session(session_id.clone());

    send_message_via_client(&state, &session.connection_id, message, "TCP data").await?;

    Ok(())
}

// ============================================================================
// AI Agent Commands - Slash Command Support
// ============================================================================

/// Send a slash command to an AI agent session
/// Commands are forwarded directly to the agent (ACP) for processing
#[tauri::command(rename_all = "camelCase")]
async fn send_slash_command(
    session_id: String,
    command: String,
    control_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let connection_id = if let Some(cs_id) = control_session_id {
        let sessions = state.sessions.read().await;
        sessions
            .get(&cs_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Control session not found: {}", cs_id))?
    } else {
        let sessions = state.sessions.read().await;
        if let Some(first_session) = sessions.values().next() {
            first_session.connection_id.clone()
        } else {
            return Err("No active connection available".to_string());
        }
    };

    // Forward slash commands directly to the agent as input
    // The agent (ACP) will handle command parsing
    let control_message = ClawdChatMessage::new(
        shared::MessageType::AgentControl,
        "app".to_string(),
        shared::MessagePayload::AgentControl(shared::AgentControlMessage {
            session_id: session_id.clone(),
            action: AgentControlAction::SendInput {
                content: command,
                attachments: vec![],
            },
            request_id: None,
        }),
    )
    .requires_response();

    send_message_via_client(&state, &connection_id, control_message, "agent command").await?;
    Ok("command_sent".to_string())
}

/// Send agent control message to remote session
#[tauri::command(rename_all = "camelCase")]
async fn send_agent_control(
    connection_session_id: String,
    agent_session_id: String,
    action_str: String,
    action_params: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&connection_session_id)
            .ok_or_else(|| format!("Connection session not found: {}", connection_session_id))?
            .clone()
    };

    let action: AgentControlAction = match action_str.as_str() {
        "list_history" => {
            let params =
                action_params.ok_or_else(|| "Missing params for list_history".to_string())?;
            AgentControlAction::ListHistory {
                agent_type: params["agentType"]
                    .as_str()
                    .ok_or_else(|| "Missing agentType".to_string())?
                    .to_string(),
                project_path: params["projectPath"]
                    .as_str()
                    .ok_or_else(|| "Missing projectPath".to_string())?
                    .to_string(),
            }
        }
        "load_history" => {
            let params =
                action_params.ok_or_else(|| "Missing params for load_history".to_string())?;
            AgentControlAction::LoadHistory {
                agent_type: params["agentType"]
                    .as_str()
                    .ok_or_else(|| "Missing agentType".to_string())?
                    .to_string(),
                history_session_id: params["historySessionId"]
                    .as_str()
                    .ok_or_else(|| "Missing historySessionId".to_string())?
                    .to_string(),
                project_path: params["projectPath"]
                    .as_str()
                    .ok_or_else(|| "Missing projectPath".to_string())?
                    .to_string(),
                target_session_id: params["targetSessionId"]
                    .as_str()
                    .ok_or_else(|| "Missing targetSessionId".to_string())?
                    .to_string(),
            }
        }
        _ => {
            return Err(format!("Unsupported agent control action: {}", action_str));
        }
    };

    let req_id = uuid::Uuid::new_v4().to_string();

    let control_message = ClawdChatMessage::new(
        shared::MessageType::AgentControl,
        "app".to_string(),
        shared::MessagePayload::AgentControl(shared::AgentControlMessage {
            session_id: agent_session_id.clone(),
            action: action.clone(),
            request_id: Some(req_id.clone()),
        }),
    )
    .requires_response();

    let response = send_message_via_client_with_response(
        &state,
        &session.connection_id,
        control_message,
        &req_id,
        "agent control",
        30,
    )
    .await?;

    if response.success {
        if let Some(data) = response.data {
            Ok(data)
        } else {
            Ok(serde_json::json!({
                "success": true,
                "data": null
            })
            .to_string())
        }
    } else {
        Ok(serde_json::json!({
            "success": false,
            "message": response.message
        })
        .to_string())
    }
}

// ============================================================================

/// Spawn a remote AI agent session
#[tauri::command(rename_all = "camelCase")]
async fn remote_spawn_session(
    connection_session_id: String,
    agent_type: String,
    project_path: String,
    args: Vec<String>,
    mcp_servers: Option<serde_json::Value>,
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
        "opencode" | "open" | "openai" => AgentType::OpenCode,
        "codex" => AgentType::Codex,
        "gemini" | "gemini-cli" => AgentType::Gemini,
        "openclaw" | "open-claw" => AgentType::OpenClaw,
        _ => return Err(format!("Unknown agent type: {}", agent_type)),
    };

    // Platform-based agent availability check
    #[cfg(mobile)]
    {
        // On mobile platforms, check if agent is available
        // All agents in the codebase are available on mobile
    }
    #[cfg(not(mobile))]
    {
        // On desktop platforms, all agent types are available
    }

    let has_mcp_servers = mcp_servers.is_some();

    // Create RemoteSpawn message
    let request_id = uuid::Uuid::new_v4().to_string();
    let spawn_message = ClawdChatMessage::new(
        shared::MessageType::RemoteSpawn,
        "app".to_string(),
        shared::MessagePayload::RemoteSpawn(shared::RemoteSpawnMessage {
            action: shared::RemoteSpawnAction::SpawnSession {
                session_id: agent_session_id.clone(),
                agent_type,
                project_path: project_path.clone(),
                args,
                mcp_servers: mcp_servers.map(|v| v.to_string()),
            },
            request_id: Some(request_id.clone()),
        }),
    )
    .requires_response();

    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::info!(
        "[remote_spawn_session] sending RemoteSpawn: connection_session_id={}, agent_session_id={}, connection_id={}, agent_type={:?}, project_path={}, has_mcp_servers={}, message_id={}",
        connection_session_id,
        agent_session_id,
        session.connection_id,
        agent_type,
        project_path,
        has_mcp_servers,
        spawn_message.id
    );

    // Log wire size for diagnostic purposes
    if let Ok(wire) = shared::MessageSerializer::serialize_for_network(&spawn_message) {
        tracing::info!(
            "[remote_spawn_session] wire_size={} bytes (frame), body={} bytes, mcp_servers={}",
            wire.len(),
            wire.len().saturating_sub(4),
            has_mcp_servers
        );

        // Debug: Log the message structure
        if let shared::MessagePayload::RemoteSpawn(ref msg) = spawn_message.payload {
            if let shared::RemoteSpawnAction::SpawnSession {
                session_id,
                agent_type,
                project_path,
                args,
                mcp_servers,
            } = &msg.action
            {
                tracing::info!(
                    "[remote_spawn_session] SpawnSession: session_id_len={}, agent_type={:?}, project_path_len={}, args_len={}, mcp_servers_len={:?}",
                    session_id.len(),
                    agent_type,
                    project_path.len(),
                    args.len(),
                    mcp_servers.as_ref().map(|s| s.len())
                );
            }
        }
    }

    // Wait for explicit remote ACK so UI only enters agent flow when transport/session is truly ready.
    // Retry a few times to absorb first-connection jitter.
    let mut last_err: Option<String> = None;
    for attempt in 1..=3 {
        match send_message_via_client_with_response(
            &state,
            &session.connection_id,
            spawn_message.clone(),
            &request_id,
            "remote spawn",
            15,
        )
        .await
        {
            Ok(response) => {
                if response.success {
                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                    tracing::info!(
                        "[remote_spawn_session] spawn acknowledged on attempt {}: request_id={}",
                        attempt,
                        request_id
                    );
                    return Ok("spawn_request_sent".to_string());
                }

                let message = response
                    .message
                    .unwrap_or_else(|| "Remote spawn failed".to_string());
                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::warn!(
                    "[remote_spawn_session] spawn response unsuccessful on attempt {}: request_id={}, message={}",
                    attempt,
                    request_id,
                    message
                );
                last_err = Some(message);
            }
            Err(e) => {
                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::warn!(
                    "[remote_spawn_session] attempt {} failed before ack: request_id={}, error={}",
                    attempt,
                    request_id,
                    e
                );
                last_err = Some(e);
            }
        }

        if attempt < 3 {
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::warn!(
                "[remote_spawn_session] retrying spawn (attempt {}/3), request_id={}",
                attempt + 1,
                request_id
            );
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        }
    }

    Err(last_err.unwrap_or_else(|| "Remote spawn failed after retries".to_string()))
}

/// List all active remote agent sessions from connected CLI
#[tauri::command(rename_all = "camelCase")]
async fn remote_list_agents(
    control_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<shared::message_protocol::AgentSessionMetadata>, String> {
    let connection_id = if let Some(cs_id) = control_session_id {
        let sessions = state.sessions.read().await;
        sessions
            .get(&cs_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Control session not found: {}", cs_id))?
    } else {
        let sessions = state.sessions.read().await;
        if let Some(first_session) = sessions.values().next() {
            first_session.connection_id.clone()
        } else {
            return Ok(Vec::new());
        }
    };

    let request_id = uuid::Uuid::new_v4().to_string();
    let list_message = ClawdChatMessage::new(
        shared::MessageType::RemoteSpawn,
        "app".to_string(),
        shared::MessagePayload::RemoteSpawn(shared::RemoteSpawnMessage {
            action: shared::RemoteSpawnAction::ListSessions,
            request_id: Some(request_id.clone()),
        }),
    )
    .requires_response();

    let response = send_message_via_client_with_response(
        &state,
        &connection_id,
        list_message,
        &request_id,
        "list remote agents",
        10,
    )
    .await?;

    if !response.success {
        return Err(response
            .message
            .unwrap_or_else(|| "Failed to list remote agents".to_string()));
    }

    let data = response
        .data
        .ok_or_else(|| "Missing remote agents response data".to_string())?;

    if let Ok(metadata) =
        serde_json::from_str::<Vec<shared::message_protocol::AgentSessionMetadata>>(&data)
    {
        return Ok(metadata);
    }

    // Backward-compatibility guard: old CLI may return session_id[] instead of metadata[]
    if let Ok(value) = serde_json::from_str::<Value>(&data) {
        if let Some(arr) = value.as_array() {
            if arr.iter().all(|v| v.is_string()) {
                return Err(
                    "Remote CLI is outdated: remote_list_agents expects metadata but got session IDs. Please update remote CLI/App to the same version."
                        .to_string(),
                );
            }
        }
    }

    Err("Invalid remote agents response data".to_string())
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

    use shared::PermissionMode;

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
        shared::MessageType::AgentPermission,
        "app".to_string(),
        shared::MessagePayload::AgentPermission(shared::AgentPermissionMessage {
            inner: shared::AgentPermissionMessageInner::Response(permission_response),
        }),
    )
    .with_session(session_id);

    send_message_via_client(
        &state,
        &connection_id,
        permission_message,
        "permission response",
    )
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
    approve_for_session: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    manager
        .respond_to_permission(
            &session_id,
            permission_id,
            approved,
            approve_for_session,
            None,
        )
        .await
        .map_err(|e| format!("Failed to respond to local agent permission: {}", e))
}

/// Send a message to an AI agent session
#[tauri::command(rename_all = "camelCase")]
async fn send_agent_message(
    session_id: String,
    content: String,
    attachments: Vec<String>,
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
        shared::MessageType::AgentControl,
        "app".to_string(),
        shared::MessagePayload::AgentControl(shared::AgentControlMessage {
            session_id: session_id,
            action: AgentControlAction::SendInput {
                content,
                attachments,
            },
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
        shared::MessageType::AgentControl,
        "app".to_string(),
        shared::MessagePayload::AgentControl(shared::AgentControlMessage {
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
// ACP Package Installation Commands
// ============================================================================

/// Install or upgrade ACP package for specified agent (local mode)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn install_acp_package_local(agent_type: String) -> Result<String, String> {
    tracing::info!(
        "[install_acp_package_local] Installing ACP for agent: {}",
        agent_type
    );

    // Determine of ACP package name based on agent type
    let acp_package = match agent_type.as_str() {
        "codex" => "@zed-industries/codex-acp",
        "opencode" => "opencode-ai",
        "claude" => "@zed-industries/claude-agent-acp",
        "gemini" => "@google/gemini-cli",
        "openclaw" => return Err("OpenClaw does not require ACP installation".to_string()),
        _ => return Err(format!("Unsupported agent type for ACP: {}", agent_type)),
    };

    // Install package using shared agent module's install logic
    let installed = tokio::task::spawn_blocking(move || {
        shared::try_install_package(acp_package, &format!("{} ACP", agent_type))
            .map_err(|e| format!("Installation error: {}", e))
    })
    .await
    .map_err(|e| format!("Failed to spawn install task: {}", e))??;

    if installed {
        Ok(format!("{} installed successfully", acp_package))
    } else {
        Err(format!(
            "Installation failed. Please install {} manually or ensure a package manager is available.",
            acp_package
        ))
    }
}

/// Install or upgrade ACP package on remote CLI host via P2P
#[tauri::command]
async fn install_acp_package_remote(
    session_id: String,
    agent_type: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    tracing::info!(
        "[install_acp_package_remote] Installing ACP for agent: {} on remote session: {}",
        agent_type,
        session_id
    );

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    // Generate a request_id for tracking the response
    let request_id = uuid::Uuid::new_v4().to_string();

    // Create system control message for installing ACP
    let action = SystemAction::InstallAcp {
        agent_type: agent_type.clone(),
    };

    let message = MessageBuilder::system_control(
        "clawdchat_app".to_string(),
        action,
        Some(request_id.clone()),
    );

    // Send message via QUIC client and wait for response
    let response = send_message_via_client_with_response(
        &state,
        &session.connection_id,
        message,
        &request_id,
        "install ACP",
        120, // 2 minute timeout for installation
    )
    .await?;

    if response.success {
        Ok(response
            .message
            .unwrap_or_else(|| "ACP installed successfully".to_string()))
    } else {
        Err(response
            .message
            .unwrap_or_else(|| "Failed to install ACP".to_string()))
    }
}

// ============================================================================

/// Start a local AI agent session (in-app, no P2P)
/// Desktop only
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_start_agent(
    agent_type_str: String,
    project_path: String,
    session_id: Option<String>,
    extra_args: Option<Vec<String>>,
    mcp_servers: Option<serde_json::Value>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Log the received parameters
    tracing::info!(
        "[local_start_agent] agent_type_str: {}, project_path: {}",
        agent_type_str,
        project_path
    );

    // Parse agent type
    let agent_type = match agent_type_str.as_str() {
        "claude" | "claudecode" | "claude-code" => AgentType::ClaudeCode,
        "opencode" | "open" | "openai" => AgentType::OpenCode,
        "codex" => AgentType::Codex,
        "gemini" | "gemini-cli" => AgentType::Gemini,
        "openclaw" | "open-claw" => AgentType::OpenClaw,
        _ => return Err(format!("Unknown agent type: {}", agent_type_str)),
    };

    // Platform-based agent availability check
    #[cfg(mobile)]
    {
        // On mobile platforms, check if agent is available
        // All agents in the codebase are available on mobile
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
            mcp_servers,                    // mcp_servers
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
                let event_payload = match &event.event {
                    shared::agent::AgentEvent::ApprovalRequest {
                        request_id,
                        tool_name,
                        input,
                        message,
                        ..
                    } => serde_json::json!({
                        "type": "approval_request",
                        "request_id": request_id,
                        "tool_name": tool_name,
                        "input": input,
                        "message": message,
                    }),
                    _ => serde_json::to_value(shared::message_adapter::event_to_message_content(
                        &event.event,
                        None,
                    ))
                    .unwrap_or_else(|_| serde_json::json!({ "type": "unknown" })),
                };
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

/// Send a message to a local agent
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_send_agent_message(
    session_id: String,
    content: String,
    attachments: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    manager
        .send_message(&session_id, content, attachments)
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

/// Stop a local agent session (backward-compatible command used by sidebar)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_stop_agent(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    match manager.stop_session(&session_id).await {
        Ok(()) => Ok(()),
        Err(stop_err) => manager
            .force_stop_session(&session_id)
            .await
            .map_err(|force_err| {
                format!(
                    "Failed to stop local agent (graceful: {}; force: {})",
                    stop_err, force_err
                )
            }),
    }
}

/// List all active local agent sessions
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_list_agents(
    state: State<'_, AppState>,
) -> Result<Vec<shared::message_protocol::AgentSessionMetadata>, String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = match agent_manager_guard.as_ref() {
        Some(m) => m.clone(),
        None => return Ok(Vec::new()),
    };

    // Get all session metadata including project_path
    Ok(manager.get_all_session_metadata().await)
}

/// Get pending permission requests for a local agent session
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_get_pending_permissions(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<PendingPermissionDto>, String> {
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    let pending = manager
        .get_pending_permissions(&session_id)
        .await
        .map_err(|e| format!("Failed to get pending permissions: {}", e))?;

    Ok(pending
        .into_iter()
        .map(|p| PendingPermissionDto {
            request_id: p.request_id,
            tool_name: p.tool_name,
            tool_params: p.tool_params,
            message: p.message,
            created_at: p.created_at,
        })
        .collect())
}

/// List external agent history sessions (ACP list_sessions)
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_list_agent_history(
    agent_type_str: String,
    project_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<shared::message_protocol::AgentHistoryEntry>, String> {
    let agent_type = match agent_type_str.as_str() {
        "claude" | "claudecode" | "claude-code" => AgentType::ClaudeCode,
        "opencode" | "open" | "openai" => AgentType::OpenCode,
        "codex" => AgentType::Codex,
        "gemini" | "gemini-cli" => AgentType::Gemini,
        "openclaw" | "open-claw" => AgentType::OpenClaw,
        _ => return Err(format!("Unknown agent type: {}", agent_type_str)),
    };

    {
        let mut agent_manager_guard = state.agent_manager.write().await;
        if agent_manager_guard.is_none() {
            let manager = Arc::new(AgentManager::new());
            *agent_manager_guard = Some(manager.clone());
        }
    }

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
    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    let home_dir = std::env::var("HOME")
        .ok()
        .or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()));

    manager
        .list_agent_history(agent_type, working_dir, home_dir)
        .await
        .map_err(|e| format!("Failed to list agent history: {}", e))
}

/// Load or resume an external agent history session
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn local_load_agent_history(
    agent_type_str: String,
    history_session_id: String,
    project_path: String,
    resume: bool,
    extra_args: Option<Vec<String>>,
    target_session_id: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let agent_type = match agent_type_str.as_str() {
        "claude" | "claudecode" | "claude-code" => AgentType::ClaudeCode,
        "opencode" | "open" | "openai" => AgentType::OpenCode,
        "codex" => AgentType::Codex,
        "gemini" | "gemini-cli" => AgentType::Gemini,
        "openclaw" | "open-claw" => AgentType::OpenClaw,
        _ => return Err(format!("Unknown agent type: {}", agent_type_str)),
    };

    {
        let mut agent_manager_guard = state.agent_manager.write().await;
        if agent_manager_guard.is_none() {
            let manager = Arc::new(AgentManager::new());
            *agent_manager_guard = Some(manager.clone());
        }
    }

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

    let agent_manager_guard = state.agent_manager.read().await;
    let manager = agent_manager_guard
        .as_ref()
        .ok_or("Agent manager not initialized")?
        .clone();

    let session_id = if let Some(target_session_id) = target_session_id.clone() {
        let history_id = history_session_id.clone();
        manager
            .start_session_from_history_with_id(
                target_session_id.clone(),
                agent_type,
                history_id,
                None,
                extra_args.unwrap_or_default(),
                working_dir,
                None,
                "local".to_string(),
                resume,
            )
            .await
            .map_err(|e| format!("Failed to load agent history: {}", e))?;
        target_session_id
    } else {
        let history_id = history_session_id.clone();
        manager
            .start_session_from_history(
                agent_type,
                history_id,
                None,
                extra_args.unwrap_or_default(),
                working_dir,
                None,
                "local".to_string(),
                resume,
            )
            .await
            .map_err(|e| format!("Failed to load agent history: {}", e))?
    };

    // For Codex and OpenCode, load history since ACP adapter might not support resume_session
    if agent_type == AgentType::Codex || agent_type == AgentType::OpenCode {
        let history_id = history_session_id.clone();

        let result = if agent_type == AgentType::Codex {
            // Codex: load from JSONL files
            shared::agent::load_codex_session_history(&history_id).await
        } else {
            // OpenCode: use opencode export command
            shared::agent::load_opencode_session_history(&history_id).await
        };

        let agent_name = if agent_type == AgentType::Codex {
            "Codex"
        } else {
            "OpenCode"
        };

        match result {
            Ok(messages) => {
                info!(
                    "[{}] Loaded {} history messages",
                    agent_name,
                    messages.len()
                );
                for msg in messages {
                    // Send each message as a text_delta event to the frontend
                    let event_payload = serde_json::json!({
                        "type": "text_delta",
                        "content": msg.content,
                    });
                    let frontend_event = serde_json::json!({
                        "sessionId": session_id.clone(),
                        "turnId": uuid::Uuid::new_v4().to_string(),
                        "event": event_payload,
                    });
                    let _ = app_handle.emit("local-agent-event", &frontend_event);
                }
                // Send turn_completed to reset streaming state after loading history
                let complete_payload = serde_json::json!({
                    "type": "turn_completed",
                });
                let complete_event = serde_json::json!({
                    "sessionId": session_id.clone(),
                    "turnId": uuid::Uuid::new_v4().to_string(),
                    "event": complete_payload,
                });
                let _ = app_handle.emit("local-agent-event", &complete_event);
            }
            Err(e) => {
                warn!("[{}] Failed to load history: {}", agent_name, e);
            }
        }
    }

    let buffered_events = manager.drain_event_buffer(&session_id).await;
    for event in buffered_events {
        let event_payload = shared::message_adapter::event_to_message_content(&event.event, None);
        let frontend_event = serde_json::json!({
            "sessionId": session_id.clone(),
            "turnId": event.turn_id,
            "event": event_payload,
        });

        let _ = app_handle.emit("local-agent-event", &frontend_event);
    }

    if let Some(mut event_rx) = manager.subscribe(&session_id).await {
        let session_id_for_spawn = session_id.clone();
        tokio::spawn(async move {
            while let Ok(event) = event_rx.recv().await {
                let event_payload =
                    shared::message_adapter::event_to_message_content(&event.event, None);
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

/// Set permission mode for a session
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn set_permission_mode(
    session_id: String,
    mode: String,
    control_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!(
        "Setting permission mode for session {}: {}",
        session_id, mode
    );

    let permission_mode = match mode.as_str() {
        "AlwaysAsk" => shared::agent::PermissionMode::AlwaysAsk,
        "AcceptEdits" => shared::agent::PermissionMode::AcceptEdits,
        "AutoApprove" => shared::agent::PermissionMode::AutoApprove,
        "Plan" => shared::agent::PermissionMode::Plan,
        _ => return Err(format!("Invalid permission mode: {}", mode)),
    };

    if let Some(manager) = state.agent_manager.read().await.as_ref().cloned() {
        if manager
            .set_permission_mode(&session_id, permission_mode)
            .await
            .is_ok()
        {
            return Ok(());
        }
    }

    let connection_id = if let Some(cs_id) = control_session_id {
        let sessions = state.sessions.read().await;
        sessions
            .get(&cs_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Control session not found: {}", cs_id))?
    } else {
        let sessions = state.sessions.read().await;
        if let Some(first_session) = sessions.values().next() {
            first_session.connection_id.clone()
        } else {
            return Err("No active connection available".to_string());
        }
    };

    let mode_for_remote = match permission_mode {
        shared::agent::PermissionMode::AlwaysAsk => AgentPermissionMode::AlwaysAsk,
        shared::agent::PermissionMode::AcceptEdits => AgentPermissionMode::AcceptEdits,
        shared::agent::PermissionMode::AutoApprove => AgentPermissionMode::AutoApprove,
        shared::agent::PermissionMode::Plan => AgentPermissionMode::Plan,
    };

    let control_message = ClawdChatMessage::new(
        shared::MessageType::AgentControl,
        "app".to_string(),
        shared::MessagePayload::AgentControl(shared::AgentControlMessage {
            session_id: session_id.clone(),
            action: AgentControlAction::SetPermissionMode {
                mode: mode_for_remote,
            },
            request_id: Some(uuid::Uuid::new_v4().to_string()),
        }),
    );

    send_message_via_client(
        &state,
        &connection_id,
        control_message,
        "set permission mode",
    )
    .await?;
    Ok(())
}

/// Get permission mode for a session
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
async fn get_permission_mode(
    session_id: String,
    control_session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if let Some(manager) = state.agent_manager.read().await.as_ref().cloned() {
        if let Ok(mode) = manager.get_permission_mode(&session_id).await {
            return Ok(format!("{:?}", mode));
        }
    }

    let connection_id = if let Some(cs_id) = control_session_id {
        let sessions = state.sessions.read().await;
        sessions
            .get(&cs_id)
            .map(|s| s.connection_id.clone())
            .ok_or_else(|| format!("Control session not found: {}", cs_id))?
    } else {
        let sessions = state.sessions.read().await;
        if let Some(first_session) = sessions.values().next() {
            first_session.connection_id.clone()
        } else {
            return Err("No active connection available".to_string());
        }
    };

    let request_id = uuid::Uuid::new_v4().to_string();
    let control_message = ClawdChatMessage::new(
        shared::MessageType::AgentControl,
        "app".to_string(),
        shared::MessagePayload::AgentControl(shared::AgentControlMessage {
            session_id: session_id.clone(),
            action: AgentControlAction::GetPermissionMode,
            request_id: Some(request_id.clone()),
        }),
    )
    .requires_response();

    let response = send_message_via_client_with_response(
        &state,
        &connection_id,
        control_message,
        &request_id,
        "get permission mode",
        10,
    )
    .await?;

    let data = response
        .data
        .ok_or_else(|| "Missing permission mode response data".to_string())?;
    let parsed: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("Invalid response data: {}", e))?;
    let mode = parsed
        .get("permission_mode")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing permission_mode in response".to_string())?;

    Ok(mode.to_string())
}

/// Initialize tracing with conditional log levels based on build configuration
fn init_tracing() {
    // Set different log levels based on build profile and features
    #[cfg(all(not(debug_assertions), feature = "release-logging"))]
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "error".into());

    #[cfg(not(all(not(debug_assertions), feature = "release-logging")))]
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    // On other platforms, use standard fmt layer
    #[cfg(not(target_os = "android"))]
    {
        tracing_subscriber::registry()
            .with(tracing_subscriber::fmt::layer().with_filter(filter))
            .init();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing based on build configuration
    init_tracing();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_shell::init())
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
            disconnect_session,
            get_active_sessions,
            get_node_info,
            parse_session_ticket,
            list_directory,
            list_mention_candidates,
            file_browser_list,
            file_browser_read,
            git_status,
            git_diff,
            list_remote_directory, // List remote directory via P2P
            list_remote_mention_candidates,
            // TCP Forwarding Management
            create_tcp_forwarding_session,
            list_tcp_forwarding_sessions,
            stop_tcp_forwarding_session,
            get_tcp_forwarding_session_info,
            send_tcp_data,
            // AI Agent Commands
            send_slash_command,
            remote_spawn_session,
            remote_list_agents,
            send_agent_message,
            abort_agent_action,
            respond_to_agent_permission,
            // Permission Management Commands
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            set_permission_mode,
            // ACP Package Installation
            install_acp_package_remote,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            install_acp_package_local,
            // Local Agent Commands (desktop only)
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_start_agent,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_send_agent_message,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_abort_agent_action,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_stop_agent,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_respond_to_agent_permission,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_list_agents,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_get_pending_permissions,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_list_agent_history,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            local_load_agent_history,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            get_permission_mode,
            // Remote Agent Control Commands
            send_agent_control,
            // macOS Panel Commands
            #[cfg(target_os = "macos")]
            show_panel,
            #[cfg(target_os = "macos")]
            hide_panel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
