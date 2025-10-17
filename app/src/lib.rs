use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tauri::{Emitter, State};
use tokio::sync::{RwLock, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

use riterm_shared::{EventType, NodeTicket, P2PNetwork, TerminalEvent, p2p::*};
use iroh::NodeId;

/// Maximum number of concurrent sessions to prevent memory exhaustion
const MAX_CONCURRENT_SESSIONS: usize = 50;
/// Maximum events per session buffer
const MAX_EVENTS_PER_SESSION: usize = 5000;
/// Session timeout in seconds (cleanup inactive sessions)
const SESSION_TIMEOUT_SECS: u64 = 3600; // 1 hour
/// Memory cleanup interval in seconds
const CLEANUP_INTERVAL_SECS: u64 = 300; // 5 minutes

// Helper function to validate session ticket format
fn is_valid_session_ticket(ticket: &str) -> bool {
    // Check if it's a valid NodeTicket
    ticket.parse::<NodeTicket>().is_ok()
}

// Parse structured events from EventType enum
fn parse_structured_event(event_type: &EventType) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    match event_type {
        // Terminal management events
        EventType::TerminalList { terminals } => {
            Ok(serde_json::json!({
                "type": "terminal_list_response",
                "data": terminals
            }))
        }
        EventType::TerminalOutput { terminal_id, data } => {
            Ok(serde_json::json!({
                "type": "terminal_output",
                "terminal_id": terminal_id,
                "data": data
            }))
        }
        EventType::TerminalInput { terminal_id, data } => {
            Ok(serde_json::json!({
                "type": "terminal_input",
                "terminal_id": terminal_id,
                "data": data
            }))
        }
        EventType::TerminalResize { terminal_id, rows, cols } => {
            Ok(serde_json::json!({
                "type": "terminal_resize",
                "terminal_id": terminal_id,
                "rows": rows,
                "cols": cols
            }))
        }

        // WebShare management events
        EventType::WebShareCreate { local_port, public_port, service_name, terminal_id } => {
            Ok(serde_json::json!({
                "type": "webshare_create",
                "local_port": local_port,
                "public_port": public_port,
                "service_name": service_name,
                "terminal_id": terminal_id
            }))
        }
        EventType::WebShareList { webshares } => {
            Ok(serde_json::json!({
                "type": "webshare_list_response",
                "data": webshares
            }))
        }

        // System events
        EventType::Stats { terminal_stats, webshare_stats } => {
            Ok(serde_json::json!({
                "type": "stats_response",
                "terminal_stats": terminal_stats,
                "webshare_stats": webshare_stats
            }))
        }

        // File transfer events
        EventType::FileTransferStart { terminal_id, file_name, file_size } => {
            Ok(serde_json::json!({
                "type": "file_transfer_start",
                "terminal_id": terminal_id,
                "file_name": file_name,
                "file_size": file_size
            }))
        }
        EventType::FileTransferProgress { terminal_id, file_name, progress } => {
            Ok(serde_json::json!({
                "type": "file_transfer_progress",
                "terminal_id": terminal_id,
                "file_name": file_name,
                "progress": progress
            }))
        }
        EventType::FileTransferComplete { terminal_id, file_name, file_path } => {
            Ok(serde_json::json!({
                "type": "file_transfer_complete",
                "terminal_id": terminal_id,
                "file_name": file_name,
                "file_path": file_path
            }))
        }
        EventType::FileTransferError { terminal_id, file_name, error } => {
            Ok(serde_json::json!({
                "type": "file_transfer_error",
                "terminal_id": terminal_id,
                "file_name": file_name,
                "error": error
            }))
        }

        // Handle Output events that might contain structured data
        EventType::Output { data } => {
            // Parse TCP forward messages from Output events
            if data.starts_with("[TCP Forward Connected]") {
                if let Some(port_str) = data.split(' ').last() {
                    return Ok(serde_json::json!({
                        "type": "tcp_forward_connected",
                        "port": port_str.trim().parse::<u16>().unwrap_or(0)
                    }));
                }
            }

            if data.starts_with("[TCP Forward Data:") {
                let parts: Vec<&str> = data.splitn(2, ']').collect();
                if parts.len() >= 2 {
                    let data_part = parts[1].trim();
                    return Ok(serde_json::json!({
                        "type": "tcp_forward_data",
                        "data": data_part
                    }));
                }
            }

            if data.starts_with("[TCP Forward Stopped]") {
                if let Some(port_str) = data.split(' ').last() {
                    return Ok(serde_json::json!({
                        "type": "tcp_forward_stopped",
                        "port": port_str.trim().parse::<u16>().unwrap_or(0)
                    }));
                }
            }

            // Return generic output event
            Ok(serde_json::json!({
                "type": "output",
                "data": data
            }))
        }

        // Input events are handled internally, no need to expose to frontend
        EventType::Input { .. } => {
            Err("Input event not exposed to frontend".into())
        }

        // Other events that don't need special handling
        _ => {
            Err("No structured event found".into())
        }
    }
}

#[derive(Default)]
pub struct AppState {
    sessions: RwLock<HashMap<String, TerminalSession>>,
    network: RwLock<Option<P2PNetwork>>,
    cleanup_token: RwLock<Option<CancellationToken>>,
    tcp_clients: RwLock<HashMap<String, Arc<riterm_shared::TcpForwardClient>>>,
    message_router: Arc<MessageRouter>,
    node_id: RwLock<Option<NodeId>>,
}

#[derive(Clone)]
pub struct TerminalSession {
    pub id: String,
    pub sender: mpsc::UnboundedSender<NetworkMessage>,
    pub event_sender: mpsc::UnboundedSender<TerminalEvent>,
    pub last_activity: Arc<RwLock<Instant>>,
    pub cancellation_token: CancellationToken,
    pub event_count: Arc<std::sync::atomic::AtomicUsize>,
    pub connected_node_id: NodeId,
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

// === Terminal Management Types ===

#[derive(Serialize, Deserialize)]
pub struct TerminalCreateRequest {
    pub session_id: String,
    pub name: Option<String>,
    pub shell_path: Option<String>,
    pub working_dir: Option<String>,
    pub size: Option<(u16, u16)>,
}

#[derive(Serialize, Deserialize)]
pub struct TerminalStopRequest {
    pub session_id: String,
    pub terminal_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct TerminalInputRequest {
    pub session_id: String,
    pub terminal_id: String,
    pub input: String,
}

#[derive(Serialize, Deserialize)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub terminal_id: String,
    pub rows: u16,
    pub cols: u16,
}

// === WebShare Management Types ===

#[derive(Serialize, Deserialize)]
pub struct WebShareCreateRequest {
    pub session_id: String,
    pub local_port: u16,
    pub public_port: Option<u16>,
    pub service_name: String,
    pub terminal_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct WebShareStopRequest {
    pub session_id: String,
    pub public_port: u16,
}

#[derive(Serialize, Deserialize)]
pub struct StatsRequest {
    pub session_id: String,
}

#[tauri::command]
async fn initialize_network(state: State<'_, AppState>) -> Result<String, String> {
    initialize_network_with_relay(None, state).await
}

#[tauri::command]
async fn initialize_network_with_relay(
    relay_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let network = P2PNetwork::new(relay_url)
        .await
        .map_err(|e| format!("Failed to initialize P2P network: {}", e))?;

    let node_id = network.get_node_id();
    let node_id_string = node_id.to_string();

    // Store network and node ID in global state
    let mut network_guard = state.network.write().await;
    *network_guard = Some(network);
    drop(network_guard);

    let mut node_id_guard = state.node_id.write().await;
    *node_id_guard = Some(node_id);
    drop(node_id_guard);

    // Start cleanup task if not already running
    start_cleanup_task(&state).await;

    Ok(node_id_string)
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

    // Parse session ticket
    let ticket = session_ticket
        .parse::<NodeTicket>()
        .map_err(|e| format!("Invalid session ticket format: {}", e))?;

    // Extract the host node ID from the ticket
    let host_node_id = ticket.node_addr().node_id;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => {
                return Err("Network not initialized. Please restart the application.".to_string());
            }
        }
    };

    // Generate a single session ID for both P2P layer and app use
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

        // Check if session already exists and clean it up
        if sessions.contains_key(&session_id) {
            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
            tracing::info!(
                "Session {} already exists, cleaning up and reconnecting...",
                session_id
            );
            // Remove the existing session to allow reconnection
            drop(sessions); // Drop the read lock before acquiring write lock
            let mut sessions = state.sessions.write().await;
            if let Some(existing_session) = sessions.remove(&session_id) {
                // Cancel all async tasks for the existing session
                existing_session.cancellation_token.cancel();

                // P2P session cleanup will be handled by the cancellation token
                // The new Node ID-based architecture doesn't require explicit session ending

                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::info!("Cleaned up existing session: {}", session_id);
            }
            // Release write lock before continuing
            drop(sessions);

            // Wait a moment to ensure cleanup is complete
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    // Join session - simplified flow without waiting for SessionInfo
    let (sender, mut event_receiver) = network
        .join_session(ticket)
        .await
        .map_err(|e| format!("Failed to join session: {}", e))?;

    info!("✅ Connected to host successfully");
    info!("🔗 Using session ID based on node_id: {}", session_id);

    // Wait a moment for the connection to be established in the P2P network layer
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Verify the connection is properly established
    let connected_nodes = network.get_active_node_ids().await;
    info!("P2P network active connections: {:?}", connected_nodes);

    // Check if the CLI's Node ID is in active_connections
    if !connected_nodes.contains(&host_node_id) {
        warn!("CLI Node ID not found in active_connections, checking again...");
        // Give it a bit more time
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let connected_nodes_retry = network.get_active_node_ids().await;
        info!("P2P network active connections (retry): {:?}", connected_nodes_retry);

        if !connected_nodes_retry.contains(&host_node_id) {
            return Err(format!("P2P connection to CLI (Node ID: {}) was not established", host_node_id));
        }
    }

    // Create terminal session with simplified tracking
    let (tx, mut rx) = mpsc::unbounded_channel();
    let cancellation_token = CancellationToken::new();
    let terminal_session = TerminalSession {
        id: session_id.clone(),
        sender: sender.clone(),
        event_sender: tx,
        last_activity: Arc::new(RwLock::new(Instant::now())),
        cancellation_token: cancellation_token.clone(),
        event_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        connected_node_id: host_node_id,
    };

    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), terminal_session.clone());
    }

    // Handle incoming terminal events with cancellation support
    let app_handle_clone = app_handle.clone();
    let session_id_clone_events = session_id.clone();
    let cancellation_token_events = cancellation_token.clone();
    let last_activity_events = terminal_session.last_activity.clone();
    let event_count_events = terminal_session.event_count.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                event_result = event_receiver.recv() => {
                    match event_result {
                        Ok(event) => {
                            // Update activity tracking
                            {
                                let mut activity = last_activity_events.write().await;
                                *activity = Instant::now();
                            }

                            // Increment event counter
                            let current_count = event_count_events.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

                            // Check if we're approaching event limit and warn
                            if current_count > MAX_EVENTS_PER_SESSION * 9 / 10 {
                                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                tracing::warn!("Session {} approaching event limit: {}/{}",
                                    session_id_clone_events, current_count, MAX_EVENTS_PER_SESSION);
                            }

                            // Parse structured events for terminal and WebShare management
                            if let Ok(structured_event) = parse_structured_event(&event.event_type) {
                                // Handle TCP forwarding events - emit to frontend for processing
                                if let Some(event_type) = structured_event.get("type").and_then(|v| v.as_str()) {
                                    match event_type {
                                        "tcp_forward_connected" => {
                                            info!("TCP forward connected event for session {}", session_id_clone_events);
                                            let _ = app_handle_clone.emit("tcp-forward-connected", &structured_event);
                                        }
                                        "tcp_forward_data" => {
                                            info!("TCP forward data event for session {}", session_id_clone_events);
                                            let _ = app_handle_clone.emit("tcp-forward-data", &structured_event);
                                        }
                                        "tcp_forward_stopped" => {
                                            info!("TCP forward stopped event for session {}", session_id_clone_events);
                                            let _ = app_handle_clone.emit("tcp-forward-stopped", &structured_event);
                                        }
                                        _ => {
                                            // Other structured events
                                        }
                                    }
                                }

                                let structured_event_name = format!("structured-event-{}", session_id_clone_events);
                                let _ = app_handle_clone.emit(&structured_event_name, &structured_event);
                            }

                            // Handle SessionInfo messages to update session ID mapping
                            if let EventType::HistoryData { data } = &event.event_type {
                                if data.contains("SessionInfo received") {
                                    // This is a SessionInfo response from CLI
                                    info!("📨 Received SessionInfo response from CLI for session {}", session_id_clone_events);
                                    // In a real implementation, we would extract the correct session ID from the response
                                    // and update our session mappings. For now, the current session ID should work.
                                }
                            }

                            // Route NetworkMessage through message router if available
                            // This will handle both structured and legacy messages
                            if let Some(_network) = &*app_handle_clone.state::<AppState>().network.read().await {
                                // Get the message router from app state
                                if let Some(state_guard) = app_handle_clone.try_state::<AppState>() {
                                    let _message_router = &state_guard.message_router;

                                    // Create a temporary network message for routing (if we have the data)
                                    // This is a simplified approach - in practice, we'd need to extract
                                    // the actual NetworkMessage from the TerminalEvent
                                    // For now, we'll emit the event as before
                                }
                            }

                            let event_name = format!("terminal-event-{}", session_id_clone_events);
                            #[cfg(debug_assertions)]
                            // println!("Broadcasting event to: {}", event_name);
                            let _ = app_handle_clone.emit(&event_name, &event);
                        }
                        Err(_) => {
                            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                            tracing::info!("Event receiver closed for session: {}", session_id_clone_events);
                            break;
                        }
                    }
                }
                _ = cancellation_token_events.cancelled() => {
                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                    tracing::info!("Event handling task cancelled for session: {}", session_id_clone_events);
                    break;
                }
            }
        }
    });

    // Handle outgoing input events with cancellation support
    let network_clone = network.clone();
    let session_id_clone_input = session_id.clone();
    let cancellation_token_input = cancellation_token.clone();
    let last_activity_input = terminal_session.last_activity.clone();
    let connected_node_id_input = terminal_session.connected_node_id;

    tokio::spawn(async move {
        loop {
            tokio::select! {
                event_opt = rx.recv() => {
                    match event_opt {
                        Some(event) => {
                            // Update activity tracking
                            {
                                let mut activity = last_activity_input.write().await;
                                *activity = Instant::now();
                            }

                            if let EventType::Input { data } = &event.event_type {
                                // Create a structured input message
                                let input_message = MessageBuilder::new()
                                    .from_node(network_clone.get_node_id())
                                    .for_session(session_id_clone_input.clone())
                                    .with_domain(MessageDomain::Terminal)
                                    .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Input {
                                        terminal_id: "default".to_string(), // Use default terminal ID
                                        data: data.clone(),
                                    }));

                                if let Err(e) = network_clone
                                    .send_message(connected_node_id_input, input_message)
                                    .await
                                {
                                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                                    tracing::error!("Failed to send input: {}", e);
                                }
                            }
                        }
                        None => {
                            #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                            tracing::info!("Input receiver closed for session: {}", session_id_clone_input);
                            break;
                        }
                    }
                }
                _ = cancellation_token_input.cancelled() => {
                    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                    tracing::info!("Input handling task cancelled for session: {}", session_id_clone_input);
                    break;
                }
            }
        }
    });

    Ok(session_id)
}

#[tauri::command]
async fn send_terminal_input(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::debug!(
        "send_terminal_input called with session_id: {}, input: {:?}",
        session_id,
        input
    );

    // Update activity and check session limits
    let session_exists = {
        let sessions = state.sessions.read().await;
        if let Some(session) = sessions.get(&session_id) {
            // Update last activity
            {
                let mut activity = session.last_activity.write().await;
                *activity = Instant::now();
            }

            // Check event count limit
            let current_count = session
                .event_count
                .load(std::sync::atomic::Ordering::Relaxed);
            if current_count >= MAX_EVENTS_PER_SESSION {
                return Err(format!(
                    "Session event limit reached ({}/{}). Session will be disconnected.",
                    current_count, MAX_EVENTS_PER_SESSION
                ));
            }

            true
        } else {
            false
        }
    };

    if !session_exists {
        return Err("Session not found".to_string());
    }

    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id).unwrap(); // We know it exists from above

    let event = TerminalEvent {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        event_type: EventType::Input { data: input.clone() },
    };

    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::debug!("Sending event: {:?}", event);
    session
        .event_sender
        .send(event)
        .map_err(|e| format!("Failed to send input event: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn send_directed_message(
    request: DirectedMessageRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    // Parse target node ID - in the new architecture, messages are routed through the connected node
    // The target node ID is not directly used in this implementation
    let _target_node_id = request.target_node_id; // Keep for potential future use

    // Send directed message using the new API
    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create a generic message with the directed message content
    let message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::System)
        .build(StructuredPayload::System(SystemMessage::Error {
            code: SystemErrorCode::InternalError,
            message: request.message,
            details: None,
        }));

    if let Err(e) = network.send_message(connected_node_id, message).await {
        return Err(format!("Failed to send directed message: {}", e));
    }

    Ok(())
}

#[tauri::command]
async fn execute_remote_command(
    command: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;

    let event = TerminalEvent {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        event_type: EventType::Input { data: format!("{}\n", command) },
    };

    session
        .event_sender
        .send(event)
        .map_err(|e| format!("Failed to send command event: {}", e))?;

    Ok(())
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

        // In the new Node ID architecture, session cleanup is handled by cancellation token
        // No explicit end_session call needed

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
    let node_id_guard = state.node_id.read().await;
    match node_id_guard.as_ref() {
        Some(node_id) => Ok(node_id.to_string()),
        None => {
            // Fallback to network if not in global state
            let network = {
                let network_guard = state.network.read().await;
                match network_guard.as_ref() {
                    Some(n) => n.clone(),
                    None => return Err("Network not initialized".to_string()),
                }
            };
            Ok(network.get_node_id().to_string())
        }
    }
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

/// Get the connected node ID for a session
async fn get_connected_node_id(
    session_id: &str,
    state: &State<'_, AppState>,
) -> Result<NodeId, String> {
    let sessions = state.sessions.read().await;
    sessions
        .get(session_id)
        .map(|session| session.connected_node_id)
        .ok_or("Session not found".to_string())
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

#[tauri::command]
async fn create_terminal(
    request: TerminalCreateRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create new structured terminal create message
    let terminal_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::Terminal)
        .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Create {
            name: request.name,
            shell_path: request.shell_path,
            working_dir: request.working_dir,
            size: request.size,
        }));

    network
        .send_message(connected_node_id, terminal_message)
        .await
        .map_err(|e| format!("Failed to create terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn stop_terminal(
    request: TerminalStopRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create new structured terminal stop message
    let terminal_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::Terminal)
        .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Stop {
            terminal_id: request.terminal_id,
        }));

    network
        .send_message(connected_node_id, terminal_message)
        .await
        .map_err(|e| format!("Failed to stop terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn list_terminals(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create new structured terminal list request message
    let terminal_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(session_id.clone())
        .with_domain(MessageDomain::Terminal)
        .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::ListRequest));

    network
        .send_message(connected_node_id, terminal_message)
        .await
        .map_err(|e| format!("Failed to list terminals: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn send_terminal_input_to_terminal(
    request: TerminalInputRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create a structured terminal input message
    let input_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::Terminal)
        .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Input {
            terminal_id: request.terminal_id,
            data: request.input,
        }));

    network
        .send_message(connected_node_id, input_message)
        .await
        .map_err(|e| format!("Failed to send terminal input: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    request: TerminalResizeRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create a structured terminal resize message
    let resize_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::Terminal)
        .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Resize {
            terminal_id: request.terminal_id,
            rows: request.rows,
            cols: request.cols,
        }));

    network
        .send_message(connected_node_id, resize_message)
        .await
        .map_err(|e| format!("Failed to resize terminal: {}", e))?;

    Ok(())
}

// === WebShare Management Commands ===

#[tauri::command]
async fn create_webshare(
    request: WebShareCreateRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create unified port forwarding message for WebShare (which is now a type of port forwarding)
    let service_id = format!("webshare_{}", request.public_port.unwrap_or(request.local_port));
    let port_forward_message = MessageFactory::create_web_service(
        network.get_node_id(),
        service_id,
        request.local_port,
        request.public_port,
        request.service_name,
        request.terminal_id,
    );

    network
        .send_message(connected_node_id, port_forward_message)
        .await
        .map_err(|e| format!("Failed to create webshare: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn stop_webshare(
    request: WebShareStopRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create unified port forwarding stop message for WebShare
    let service_id = format!("webshare_{}", request.public_port);
    let port_forward_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::PortForward)
        .build(StructuredPayload::PortForward(PortForwardMessage::Stopped {
            service_id,
            reason: Some("WebShare stopped by user".to_string()),
        }));

    network
        .send_message(connected_node_id, port_forward_message)
        .await
        .map_err(|e| format!("Failed to stop webshare: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn list_webshares(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create unified port forwarding list request message
    let port_forward_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(session_id.clone())
        .with_domain(MessageDomain::PortForward)
        .build(StructuredPayload::PortForward(PortForwardMessage::ListRequest));

    network
        .send_message(connected_node_id, port_forward_message)
        .await
        .map_err(|e| format!("Failed to list webshares: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_system_stats(request: StatsRequest, state: State<'_, AppState>) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create new structured system stats request message
    let system_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::System)
        .build(StructuredPayload::System(SystemMessage::StatsRequest));

    network
        .send_message(connected_node_id, system_message)
        .await
        .map_err(|e| format!("Failed to get system stats: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_terminal_list(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    list_terminals(session_id, state).await
}

#[tauri::command]
async fn get_webshare_list(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    list_webshares(session_id, state).await
}

#[tauri::command]
async fn connect_to_terminal(
    session_id: String,
    terminal_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create a terminal input message to connect to specific terminal
    let terminal_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(session_id.clone())
        .with_domain(MessageDomain::Terminal)
        .build(StructuredPayload::TerminalManagement(TerminalManagementMessage::Input {
            terminal_id: terminal_id.clone(),
            data: format!("CONNECT_TO_TERMINAL:{}", terminal_id),
        }));

    network
        .send_message(connected_node_id, terminal_message)
        .await
        .map_err(|e| format!("Failed to connect to terminal: {}", e))?;

    Ok(())
}

/// Get session statistics for monitoring
#[tauri::command]
async fn get_session_stats(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let sessions = state.sessions.read().await;
    let mut total_events = 0;
    let mut session_details = Vec::new();

    for (session_id, session) in sessions.iter() {
        let event_count = session
            .event_count
            .load(std::sync::atomic::Ordering::Relaxed);
        let last_activity = session.last_activity.read().await;
        let inactive_duration = Instant::now().duration_since(*last_activity);

        total_events += event_count;
        session_details.push(serde_json::json!({
            "id": session_id,
            "event_count": event_count,
            "inactive_duration_secs": inactive_duration.as_secs()
        }));
    }

    Ok(serde_json::json!({
        "total_sessions": sessions.len(),
        "max_sessions": MAX_CONCURRENT_SESSIONS,
        "total_events": total_events,
        "max_events_per_session": MAX_EVENTS_PER_SESSION,
        "session_timeout_secs": SESSION_TIMEOUT_SECS,
        "sessions": session_details
    }))
}

// === File Transfer Types ===

#[derive(Serialize, Deserialize)]
pub struct FileTransferRequest {
    pub session_id: String,
    pub terminal_id: String,
    pub file_path: String, // Local file path to send
}

#[derive(Serialize, Deserialize)]
pub struct FileTransferDataRequest {
    pub session_id: String,
    pub terminal_id: String,
    pub file_name: String,
    pub file_data: Vec<u8>, // Base64 encoded file content
}

// === TCP Forwarding Commands ===

/// Create TCP forwarding connection (like dumbpipe connect-tcp)
#[tauri::command]
async fn create_tcp_forward(
    local_port: u16,
    remote_port: u16,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create TCP forward client
    let client = Arc::new(riterm_shared::TcpForwardClient::new(
        local_port,
        remote_port,
    ));

    // Store client in state for later use
    {
        let mut tcp_clients = state.tcp_clients.write().await;
        tcp_clients.insert(session_id.clone(), client.clone());
    }

    // Send TCP forward create request using generic message
    let port_forward_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(session_id.clone())
        .with_domain(MessageDomain::PortForward)
        .build(StructuredPayload::PortForward(PortForwardMessage::Create {
            service_id: format!("tcp_{}", remote_port),
            local_port,
            remote_port: Some(remote_port),
            service_type: PortForwardType::Tcp,
            service_name: format!("TCP Forward {} -> {}", local_port, remote_port),
            terminal_id: None,
            metadata: None,
        }));

    if let Err(e) = network.send_message(connected_node_id, port_forward_message).await {
        return Err(format!("Failed to create TCP forward: {}", e));
    }

    // Don't start the TCP client immediately
    // Wait for CLI to send TcpForwardConnected notification
    info!(
        "TCP forward client created for session {}, waiting for CLI confirmation",
        session_id
    );

    Ok(())
}

/// Handle TCP forward connected event
#[tauri::command]
async fn handle_tcp_forward_connected(
    remote_port: u16,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!(
        "TCP forward connected on port {} for session {}",
        remote_port, session_id
    );

    // Get the TCP client for this session and start it
    let tcp_clients = state.tcp_clients.read().await;
    if let Some(client) = tcp_clients.get(&session_id) {
        let client_clone = client.clone();
        let session_id_clone = session_id.clone();

        // Start the TCP forward client to listen for local connections
        tokio::spawn(async move {
            info!(
                "Starting TCP forward client for session {} on local port",
                session_id_clone
            );
            if let Err(e) = client_clone.start().await {
                error!(
                    "TCP forward client error for session {}: {}",
                    session_id_clone, e
                );
            } else {
                info!(
                    "TCP forward client started successfully for session {}",
                    session_id_clone
                );
            }
        });

        Ok(())
    } else {
        Err(format!("No TCP client found for session {}", session_id))
    }
}

/// Handle TCP forward data event
#[tauri::command]
async fn handle_tcp_forward_data(
    remote_port: u16,
    data: String, // base64 encoded data
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Decode base64 data and forward it to the local TCP connection
    use base64::Engine;

    match base64::engine::general_purpose::STANDARD.decode(&data) {
        Ok(decoded_data) => {
            info!(
                "Received {} bytes of TCP data for port {} in session {}",
                decoded_data.len(),
                remote_port,
                session_id
            );

            // Get the TCP client for this session
            let tcp_clients = state.tcp_clients.read().await;
            if let Some(client) = tcp_clients.get(&session_id) {
                // Forward data to the local TCP connections
                if let Err(e) = client.forward_data(&decoded_data).await {
                    error!("Failed to forward data to TCP client: {}", e);
                    return Err(format!("Failed to forward TCP data: {}", e));
                }
                info!(
                    "Successfully forwarded {} bytes to TCP client",
                    decoded_data.len()
                );
            } else {
                warn!("No TCP client found for session {}", session_id);
                return Err("TCP client not found".to_string());
            }

            Ok(())
        }
        Err(e) => Err(format!("Failed to decode TCP data: {}", e)),
    }
}

/// Stop TCP forwarding
#[tauri::command]
async fn stop_tcp_forward(
    remote_port: u16,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Remove TCP client from state
    {
        let mut tcp_clients = state.tcp_clients.write().await;
        tcp_clients.remove(&session_id);
    }

    // Send TCP forward stop message using generic message
    let port_forward_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(session_id.clone())
        .with_domain(MessageDomain::PortForward)
        .build(StructuredPayload::PortForward(PortForwardMessage::Stopped {
            service_id: format!("tcp_{}", remote_port),
            reason: Some("TCP forward stopped by user".to_string()),
        }));

    if let Err(e) = network.send_message(connected_node_id, port_forward_message).await {
        return Err(format!("Failed to stop TCP forward: {}", e));
    }

    info!(
        "TCP forwarding stopped for session {} on port {}",
        session_id, remote_port
    );
    Ok(())
}

// === File Transfer Commands ===

/// Send a file from App to CLI terminal
#[tauri::command]
async fn send_file_to_terminal(
    request: FileTransferRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Read file content
    let file_content = tokio::fs::read(&request.file_path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let file_name = std::path::Path::new(&request.file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown_file")
        .to_string();

    info!(
        "Sending file {} ({} bytes) to terminal {}",
        file_name,
        file_content.len(),
        request.terminal_id
    );

    // Send file transfer start message using generic message
    let file_transfer_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::FileTransfer)
        .build(StructuredPayload::FileTransfer(FileTransferMessage::Start {
            terminal_id: request.terminal_id.clone(),
            file_name: file_name.clone(),
            file_size: file_content.len() as u64,
            chunk_count: Some(1), // Single chunk for simplicity
            mime_type: Some("application/octet-stream".to_string()),
        }));

    if let Err(e) = network.send_message(connected_node_id, file_transfer_message).await {
        return Err(format!("Failed to send file transfer start: {}", e));
    }

    info!(
        "File transfer initiated for {} to terminal {}",
        file_name, request.terminal_id
    );
    Ok(())
}

/// Send file data directly (for files already read by frontend)
#[tauri::command]
async fn send_file_data_to_terminal(
    request: FileTransferDataRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Get the connected node ID for this session
    let connected_node_id = get_connected_node_id(&request.session_id, &state).await?;

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    info!(
        "Sending file data {} ({} bytes) to terminal {}",
        request.file_name,
        request.file_data.len(),
        request.terminal_id
    );

    // Send file transfer start message using generic message
    let file_transfer_message = MessageBuilder::new()
        .from_node(network.get_node_id())
        .for_session(request.session_id.clone())
        .with_domain(MessageDomain::FileTransfer)
        .build(StructuredPayload::FileTransfer(FileTransferMessage::Start {
            terminal_id: request.terminal_id.clone(),
            file_name: request.file_name.clone(),
            file_size: request.file_data.len() as u64,
            chunk_count: Some(1), // Single chunk for simplicity
            mime_type: Some("application/octet-stream".to_string()),
        }));

    if let Err(e) = network.send_message(connected_node_id, file_transfer_message).await {
        return Err(format!("Failed to send file transfer start: {}", e));
    }

    info!(
        "File transfer initiated for {} to terminal {}",
        request.file_name, request.terminal_id
    );
    Ok(())
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
            initialize_network,
            initialize_network_with_relay,
            connect_to_peer,
            send_terminal_input,
            send_directed_message,
            execute_remote_command,
            disconnect_session,
            get_active_sessions,
            get_node_info,
            parse_session_ticket,
            get_session_stats,
            // Terminal Management
            create_terminal,
            stop_terminal,
            list_terminals,
            get_terminal_list,
            send_terminal_input_to_terminal,
            resize_terminal,
            connect_to_terminal,
            // WebShare Management
            create_webshare,
            stop_webshare,
            list_webshares,
            get_webshare_list,
            get_system_stats,
            // TCP Forwarding
            create_tcp_forward,
            handle_tcp_forward_connected,
            handle_tcp_forward_data,
            stop_tcp_forward,
            // File Transfer
            send_file_to_terminal,
            send_file_data_to_terminal
        ])
        .setup(|app| {
            // Setup message handlers
            let app_handle = app.handle().clone();

            // Register message handlers in background task
            let terminal_handler = Arc::new(AppTerminalMessageHandler::new(app_handle.clone()));
            let app_handle1 = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                // Get the message router from the app handle state
                if let Some(state) = app_handle1.try_state::<AppState>() {
                    state.message_router.register_handler(terminal_handler).await;
                }
            });

            let port_forward_handler = Arc::new(AppPortForwardMessageHandler::new(app_handle.clone()));
            let app_handle2 = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                // Get the message router from the app handle state
                if let Some(state) = app_handle2.try_state::<AppState>() {
                    state.message_router.register_handler(port_forward_handler).await;
                }
            });

            let file_transfer_handler = Arc::new(AppFileTransferMessageHandler::new(app_handle.clone()));
            let app_handle3 = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                // Get the message router from the app handle state
                if let Some(state) = app_handle3.try_state::<AppState>() {
                    state.message_router.register_handler(file_transfer_handler).await;
                }
            });

            let system_handler = Arc::new(AppSystemMessageHandler::new(app_handle.clone()));
            let app_handle4 = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                // Get the message router from the app handle state
                if let Some(state) = app_handle4.try_state::<AppState>() {
                    state.message_router.register_handler(system_handler).await;
                }
            });

            info!("✅ App message handlers registration initiated");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// === App Message Handlers ===

/// App Terminal Message Handler
pub struct AppTerminalMessageHandler {
    app_handle: tauri::AppHandle,
}

impl AppTerminalMessageHandler {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl MessageHandler for AppTerminalMessageHandler {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + '_>> {
        Box::pin(async move {
            match message {
                NetworkMessage::Structured { payload, .. } => {
                    match payload {
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::Output {
                            terminal_id,
                            data,
                        }) => {
                            info!("Received terminal output from structured message: {} -> {}", terminal_id, data);
                            // Emit to frontend
                            let _ = self.app_handle.emit("terminal-output", serde_json::json!({
                                "terminal_id": terminal_id,
                                "data": data
                            }));
                        }
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::StatusUpdate {
                            terminal_id,
                            status,
                        }) => {
                            info!("Terminal status update: {} -> {:?}", terminal_id, status);
                            let _ = self.app_handle.emit("terminal-status-update", serde_json::json!({
                                "terminal_id": terminal_id,
                                "status": status
                            }));
                        }
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::DirectoryChanged {
                            terminal_id,
                            new_dir,
                        }) => {
                            info!("Terminal directory changed: {} -> {}", terminal_id, new_dir);
                            let _ = self.app_handle.emit("terminal-directory-changed", serde_json::json!({
                                "terminal_id": terminal_id,
                                "new_dir": new_dir
                            }));
                        }
                        StructuredPayload::TerminalManagement(TerminalManagementMessage::ListResponse {
                            terminals,
                        }) => {
                            info!("Received terminal list: {} terminals", terminals.len());
                            let _ = self.app_handle.emit("terminal-list-response", serde_json::json!({
                                "terminals": terminals
                            }));
                        }
                        _ => {
                            debug!("Ignoring non-terminal-management message in terminal handler");
                        }
                    }
                }
                _ => {
                    debug!("Received non-structured message in terminal handler");
                }
            }
            Ok(())
        })
    }

    fn domain(&self) -> MessageDomain {
        MessageDomain::Terminal
    }
}

/// App Port Forward Message Handler (unified TCP + WebShare)
pub struct AppPortForwardMessageHandler {
    app_handle: tauri::AppHandle,
}

impl AppPortForwardMessageHandler {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl MessageHandler for AppPortForwardMessageHandler {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + '_>> {
        let app_handle = self.app_handle.clone();
        Box::pin(async move {
            match message {
                NetworkMessage::Structured { payload, .. } => {
                    match payload {
                        StructuredPayload::PortForward(PortForwardMessage::Connected {
                            service_id,
                            assigned_remote_port,
                            access_url,
                        }) => {
                            info!("Port forwarding service {} connected on port {}", service_id, assigned_remote_port);
                            let _ = app_handle.emit("port-forward-connected", serde_json::json!({
                                "service_id": service_id,
                                "assigned_remote_port": assigned_remote_port,
                                "access_url": access_url
                            }));
                        }
                        StructuredPayload::PortForward(PortForwardMessage::StatusUpdate {
                            service_id,
                            status,
                        }) => {
                            info!("Port forwarding service {} status: {:?}", service_id, status);
                            let _ = app_handle.emit("port-forward-status-update", serde_json::json!({
                                "service_id": service_id,
                                "status": status
                            }));
                        }
                        StructuredPayload::PortForward(PortForwardMessage::Stopped {
                            service_id,
                            reason,
                        }) => {
                            info!("Port forwarding service {} stopped", service_id);
                            let _ = app_handle.emit("port-forward-stopped", serde_json::json!({
                                "service_id": service_id,
                                "reason": reason
                            }));
                        }
                        StructuredPayload::PortForward(PortForwardMessage::ListResponse { services }) => {
                            info!("Received port forwarding services list: {} services", services.len());
                            let _ = app_handle.emit("port-forward-list-response", serde_json::json!({
                                "services": services
                            }));
                        }
                        _ => {
                            debug!("Ignoring port forward message type in App handler");
                        }
                    }
                }
                _ => {
                    debug!("Received non-structured message in port forward handler");
                }
            }
            Ok(())
        })
    }

    fn domain(&self) -> MessageDomain {
        MessageDomain::PortForward
    }
}

/// App File Transfer Message Handler
pub struct AppFileTransferMessageHandler {
    app_handle: tauri::AppHandle,
}

impl AppFileTransferMessageHandler {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl MessageHandler for AppFileTransferMessageHandler {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + '_>> {
        let app_handle = self.app_handle.clone();
        Box::pin(async move {
            match message {
                NetworkMessage::Structured { payload, .. } => {
                    match payload {
                        StructuredPayload::FileTransfer(FileTransferMessage::Start {
                            terminal_id,
                            file_name,
                            file_size,
                            chunk_count,
                            mime_type,
                        }) => {
                            info!("File transfer started: {} ({} bytes) for terminal {}", file_name, file_size, terminal_id);
                            let _ = app_handle.emit("file-transfer-start", serde_json::json!({
                                "terminal_id": terminal_id,
                                "file_name": file_name,
                                "file_size": file_size,
                                "chunk_count": chunk_count,
                                "mime_type": mime_type
                            }));
                        }
                        StructuredPayload::FileTransfer(FileTransferMessage::Progress {
                            terminal_id,
                            file_name,
                            bytes_transferred,
                            total_bytes,
                        }) => {
                            let progress = if total_bytes > 0 {
                                (bytes_transferred * 100) / total_bytes
                            } else {
                                0
                            };
                            info!("File transfer progress: {} - {}% ({}/{})", file_name, progress, bytes_transferred, total_bytes);
                            let _ = app_handle.emit("file-transfer-progress", serde_json::json!({
                                "terminal_id": terminal_id,
                                "file_name": file_name,
                                "bytes_transferred": bytes_transferred,
                                "total_bytes": total_bytes,
                                "progress": progress
                            }));
                        }
                        StructuredPayload::FileTransfer(FileTransferMessage::Complete {
                            terminal_id,
                            file_name,
                            file_path,
                            file_hash,
                        }) => {
                            info!("File transfer completed: {} -> {}", file_name, file_path);
                            let _ = app_handle.emit("file-transfer-complete", serde_json::json!({
                                "terminal_id": terminal_id,
                                "file_name": file_name,
                                "file_path": file_path,
                                "file_hash": file_hash
                            }));
                        }
                        StructuredPayload::FileTransfer(FileTransferMessage::Error {
                            terminal_id,
                            file_name,
                            error_message,
                            error_code,
                        }) => {
                            error!("File transfer error: {} - {} (code: {:?})", file_name, error_message, error_code);
                            let _ = app_handle.emit("file-transfer-error", serde_json::json!({
                                "terminal_id": terminal_id,
                                "file_name": file_name,
                                "error_message": error_message,
                                "error_code": error_code
                            }));
                        }
                        _ => {
                            debug!("Ignoring file transfer message type in App handler");
                        }
                    }
                }
                _ => {
                    debug!("Received non-structured message in file transfer handler");
                }
            }
            Ok(())
        })
    }

    fn domain(&self) -> MessageDomain {
        MessageDomain::FileTransfer
    }
}

/// App System Message Handler
pub struct AppSystemMessageHandler {
    app_handle: tauri::AppHandle,
}

impl AppSystemMessageHandler {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl MessageHandler for AppSystemMessageHandler {
    fn handle_message(&self, message: NetworkMessage) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + '_>> {
        let app_handle = self.app_handle.clone();
        Box::pin(async move {
            match message {
                NetworkMessage::Structured { payload, .. } => {
                    match payload {
                        StructuredPayload::System(SystemMessage::StatsResponse {
                            terminal_stats,
                            port_forward_stats,
                            node_id,
                            timestamp: _,
                        }) => {
                            info!("Received system stats from node: {}", node_id);
                            let _ = app_handle.emit("system-stats-response", serde_json::json!({
                                "terminal_stats": terminal_stats,
                                "port_forward_stats": port_forward_stats,
                                "node_id": node_id
                            }));
                        }
                        StructuredPayload::System(SystemMessage::Ping { sequence }) => {
                            info!("Received ping: {}", sequence);
                            // Send pong response
                            let _ = app_handle.emit("system-ping", serde_json::json!({
                                "sequence": sequence
                            }));
                        }
                        StructuredPayload::System(SystemMessage::Error { code, message, details }) => {
                            error!("System error: {:?} - {} (details: {:?})", code, message, details);
                            let _ = app_handle.emit("system-error", serde_json::json!({
                                "code": code,
                                "message": message,
                                "details": details
                            }));
                        }
                        _ => {
                            debug!("Ignoring system message type in App handler");
                        }
                    }
                }
                _ => {
                    debug!("Received non-structured message in system handler");
                }
            }
            Ok(())
        })
    }

    fn domain(&self) -> MessageDomain {
        MessageDomain::System
    }
}
