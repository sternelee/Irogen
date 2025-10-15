use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tauri::{Emitter, State};
use tokio::sync::{RwLock, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{info, error, warn};
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};
use base64::Engine;

use riterm_shared::{EventType, P2PNetwork, TerminalEvent, NodeTicket, p2p::NetworkMessage};

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

// Parse structured events from terminal data
fn parse_structured_event(data: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    // Handle terminal list response
    if data.starts_with("[Terminal List Response:") {
        if let Some(start) = data.find('[') {
            if let Some(json_part) = data.get(start..) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_part) {
                    return Ok(serde_json::json!({
                        "type": "terminal_list_response",
                        "data": parsed
                    }));
                }
            }
        }
    }

    // Handle webshare list response
    if data.starts_with("[WebShare List Response:") {
        if let Some(start) = data.find('[') {
            if let Some(json_part) = data.get(start..) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_part) {
                    return Ok(serde_json::json!({
                        "type": "webshare_list_response",
                        "data": parsed
                    }));
                }
            }
        }
    }

    // Handle terminal status updates
    if data.starts_with("[Terminal Status Update:") {
        if let Some(start) = data.find('[') {
            if let Some(end) = data.find(']') {
                let status_part = &data[start + 1..end];
                let parts: Vec<&str> = status_part.split(": ").collect();
                if parts.len() >= 2 {
                    return Ok(serde_json::json!({
                        "type": "terminal_status_update",
                        "terminal_id": parts.get(0).unwrap_or(&"unknown"),
                        "status": parts.get(1).unwrap_or(&"unknown")
                    }));
                }
            }
        }
    }

    // Handle terminal output
    if data.starts_with("[Terminal Output:") {
        if let Some(start) = data.find('[') {
            if let Some(end) = data.find(']') {
                let output_part = &data[start + 1..end];
                let parts: Vec<&str> = output_part.split("] ").collect();
                if parts.len() >= 2 {
                    return Ok(serde_json::json!({
                        "type": "terminal_output",
                        "terminal_id": parts.get(0).unwrap_or(&"unknown"),
                        "data": parts.get(1).unwrap_or(&"")
                    }));
                }
            }
        }
    }

    // Handle terminal input
    if data.starts_with("[Terminal Input:") {
        if let Some(start) = data.find('[') {
            if let Some(end) = data.find(']') {
                let input_part = &data[start + 1..end];
                let parts: Vec<&str> = input_part.split("] ").collect();
                if parts.len() >= 2 {
                    return Ok(serde_json::json!({
                        "type": "terminal_input",
                        "terminal_id": parts.get(0).unwrap_or(&"unknown"),
                        "data": parts.get(1).unwrap_or(&"")
                    }));
                }
            }
        }
    }

    // Handle terminal resize
    if data.starts_with("[Terminal Resize:") {
        if let Some(start) = data.find('[') {
            if let Some(end) = data.find(']') {
                let resize_part = &data[start + 1..end];
                let parts: Vec<&str> = resize_part.split("] ").collect();
                if parts.len() >= 2 {
                    return Ok(serde_json::json!({
                        "type": "terminal_resize",
                        "terminal_id": parts.get(0).unwrap_or(&"unknown"),
                        "size": parts.get(1).unwrap_or(&"")
                    }));
                }
            }
        }
    }

    // Handle WebShare status updates
    if data.starts_with("[WebShare Status Update:") {
        if let Some(start) = data.find('[') {
            if let Some(end) = data.find(']') {
                let status_part = &data[start + 1..end];
                let parts: Vec<&str> = status_part.split(": ").collect();
                if parts.len() >= 2 {
                    return Ok(serde_json::json!({
                        "type": "webshare_status_update",
                        "public_port": parts.get(0).unwrap_or(&"0"),
                        "status": parts.get(1).unwrap_or(&"unknown")
                    }));
                }
            }
        }
    }

    // Handle stats response
    if data.starts_with("[Stats Response:") {
        if let Some(start) = data.find('[') {
            if let Some(end) = data.find(']') {
                let stats_part = &data[start + 1..end];
                return Ok(serde_json::json!({
                    "type": "stats_response",
                    "node_info": stats_part
                }));
            }
        }
    }

    // Handle TCP Forward messages
    if data.starts_with("[TCP Forward Create Request]") {
        let parts: Vec<&str> = data.splitn(2, ']').collect();
        if parts.len() >= 2 {
            let config_part = parts[1].trim();
            return Ok(serde_json::json!({
                "type": "tcp_forward_create",
                "config": config_part
            }));
        }
    }

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

    Err("No structured event found".into())
}

#[derive(Default)]
pub struct AppState {
    sessions: RwLock<HashMap<String, TerminalSession>>,
    network: RwLock<Option<P2PNetwork>>,
    cleanup_token: RwLock<Option<CancellationToken>>,
    tcp_clients: RwLock<HashMap<String, Arc<riterm_shared::TcpForwardClient>>>,
}

#[derive(Clone)]
pub struct TerminalSession {
    pub id: String,
    pub sender: mpsc::UnboundedSender<NetworkMessage>,
    pub event_sender: mpsc::UnboundedSender<TerminalEvent>,
    pub last_activity: Arc<RwLock<Instant>>,
    pub cancellation_token: CancellationToken,
    pub event_count: Arc<std::sync::atomic::AtomicUsize>,
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

    let node_id = network.get_node_id().await;

    let mut network_guard = state.network.write().await;
    *network_guard = Some(network);

    // Start cleanup task if not already running
    start_cleanup_task(&state).await;

    Ok(node_id)
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

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => {
                return Err("Network not initialized. Please restart the application.".to_string());
            }
        }
    };

    // Generate unique session ID using the node address
    let session_id = format!("session_{}", ticket.node_addr().node_id);

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

                // End the P2P session
                if let Some(network) = &*state.network.read().await {
                    if let Err(e) = network
                        .end_session(&session_id, &existing_session.sender)
                        .await
                    {
                        #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                        tracing::error!("Failed to end existing P2P session: {}", e);
                    }
                }

                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::info!("Cleaned up existing session: {}", session_id);
            }
            // Release write lock before continuing
            drop(sessions);

            // Wait a moment to ensure cleanup is complete
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    // Join session
    let (sender, mut event_receiver) = network
        .join_session(ticket)
        .await
        .map_err(|e| format!("Failed to join session: {}", e))?;

    // Create terminal session with enhanced tracking
    let (tx, mut rx) = mpsc::unbounded_channel();
    let cancellation_token = CancellationToken::new();
    let terminal_session = TerminalSession {
        id: session_id.clone(),
        sender: sender.clone(),
        event_sender: tx,
        last_activity: Arc::new(RwLock::new(Instant::now())),
        cancellation_token: cancellation_token.clone(),
        event_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
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
                            if let Ok(structured_event) = parse_structured_event(&event.data) {
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
    let sender_clone = sender.clone();
    let session_id_clone_input = session_id.clone();
    let cancellation_token_input = cancellation_token.clone();
    let last_activity_input = terminal_session.last_activity.clone();

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

                            if let EventType::Input = event.event_type {
                                if let Err(e) = network_clone
                                    .send_input(&session_id_clone_input, &sender_clone, event.data)
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
        event_type: EventType::Input,
        data: input.clone(), // Clone for logging
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
    // Clone the session sender to avoid holding the lock across await
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    // Parse target node ID
    let target_node_id = request
        .target_node_id
        .parse()
        .map_err(|e| format!("Invalid target node ID: {}", e))?;

    // Send directed message
    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    if let Err(e) = network
        .send_directed_message(
            &request.session_id,
            &session_sender,
            target_node_id,
            request.message,
        )
        .await
    {
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
        event_type: EventType::Input,
        data: format!("{}\n", command),
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

        let network = {
            let network_guard = state.network.read().await;
            network_guard.as_ref().cloned()
        };

        if let Some(network) = network {
            if let Err(e) = network.end_session(&session_id, &session.sender).await {
                #[cfg(any(debug_assertions, not(feature = "release-logging")))]
                tracing::error!("Failed to end P2P session gracefully: {}", e);
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
    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };
    Ok(network.get_node_id().await)
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
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_message(
            &request.session_id,
            NetworkMessage::TerminalCreate {
                from: network.local_node_id(),
                name: request.name,
                shell_path: request.shell_path,
                working_dir: request.working_dir,
                size: request.size,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
        .await
        .map_err(|e| format!("Failed to create terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn stop_terminal(
    request: TerminalStopRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_message(
            &request.session_id,
            NetworkMessage::TerminalStop {
                from: network.local_node_id(),
                terminal_id: request.terminal_id,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
        .await
        .map_err(|e| format!("Failed to stop terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn list_terminals(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_message(
            &session_id,
            NetworkMessage::TerminalListRequest {
                from: network.local_node_id(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
        .await
        .map_err(|e| format!("Failed to list terminals: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn send_terminal_input_to_terminal(
    request: TerminalInputRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_terminal_input(
            &request.session_id,
            request.terminal_id,
            request.input,
        )
        .await
        .map_err(|e| format!("Failed to send terminal input: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    request: TerminalResizeRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_terminal_resize(
            &request.session_id,
            request.terminal_id,
            request.rows,
            request.cols,
        )
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
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_message(
            &request.session_id,
            NetworkMessage::WebShareCreate {
                from: network.local_node_id(),
                local_port: request.local_port,
                public_port: request.public_port,
                service_name: request.service_name,
                terminal_id: request.terminal_id,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
        .await
        .map_err(|e| format!("Failed to create webshare: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn stop_webshare(
    request: WebShareStopRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_message(
            &request.session_id,
            NetworkMessage::WebShareStop {
                from: network.local_node_id(),
                public_port: request.public_port,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
        .await
        .map_err(|e| format!("Failed to stop webshare: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn list_webshares(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_message(
            &session_id,
            NetworkMessage::WebShareListRequest {
                from: network.local_node_id(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
        .await
        .map_err(|e| format!("Failed to list webshares: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_system_stats(request: StatsRequest, state: State<'_, AppState>) -> Result<(), String> {
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&request.session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    network
        .send_message(
            &request.session_id,
            NetworkMessage::StatsRequest {
                from: network.local_node_id(),
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
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
    // This command tells the remote CLI that we want to connect to a specific terminal
    let session_sender = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .map(|s| s.sender.clone())
            .ok_or("Session not found")?
    };

    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Send a directed message to connect to the specific terminal
    // This is a placeholder - the actual implementation depends on how the CLI handles terminal selection
    let connect_message = format!("CONNECT_TO_TERMINAL:{}", terminal_id);

    network
        .send_message(
            &session_id,
            NetworkMessage::DirectedMessage {
                from: network.local_node_id(),
                to: network.local_node_id(),
                data: connect_message,
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        )
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

// === TCP Forwarding Commands ===

/// Create TCP forwarding connection (like dumbpipe connect-tcp)
#[tauri::command]
async fn create_tcp_forward(
    local_port: u16,
    remote_port: u16,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let network = {
        let network_guard = state.network.read().await;
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };

    // Create TCP forward client
    let client = Arc::new(riterm_shared::TcpForwardClient::new(local_port, remote_port));

    // Store client in state for later use
    {
        let mut tcp_clients = state.tcp_clients.write().await;
        tcp_clients.insert(session_id.clone(), client.clone());
    }

    // Send TCP forward create request
    if let Err(e) = network.create_tcp_forward(
        &session_id,
        local_port,
        remote_port,
        format!("TCP Forward {} -> {}", local_port, remote_port),
    ).await {
        return Err(format!("Failed to create TCP forward: {}", e));
    }

    // Don't start the TCP client immediately
    // Wait for CLI to send TcpForwardConnected notification
    info!("TCP forward client created for session {}, waiting for CLI confirmation", session_id);

    Ok(())
}

/// Handle TCP forward connected event
#[tauri::command]
async fn handle_tcp_forward_connected(
    remote_port: u16,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    info!("TCP forward connected on port {} for session {}", remote_port, session_id);

    // Get the TCP client for this session and start it
    let tcp_clients = state.tcp_clients.read().await;
    if let Some(client) = tcp_clients.get(&session_id) {
        let client_clone = client.clone();
        let session_id_clone = session_id.clone();

        // Start the TCP forward client to listen for local connections
        tokio::spawn(async move {
            info!("Starting TCP forward client for session {} on local port", session_id_clone);
            if let Err(e) = client_clone.start().await {
                error!("TCP forward client error for session {}: {}", session_id_clone, e);
            } else {
                info!("TCP forward client started successfully for session {}", session_id_clone);
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
            info!("Received {} bytes of TCP data for port {} in session {}",
                  decoded_data.len(), remote_port, session_id);

            // Get the TCP client for this session
            let tcp_clients = state.tcp_clients.read().await;
            if let Some(client) = tcp_clients.get(&session_id) {
                // Forward data to the local TCP connections
                if let Err(e) = client.forward_data(&decoded_data).await {
                    error!("Failed to forward data to TCP client: {}", e);
                    return Err(format!("Failed to forward TCP data: {}", e));
                }
                info!("Successfully forwarded {} bytes to TCP client", decoded_data.len());
            } else {
                warn!("No TCP client found for session {}", session_id);
                return Err("TCP client not found".to_string());
            }

            Ok(())
        }
        Err(e) => Err(format!("Failed to decode TCP data: {}", e))
    }
}

/// Stop TCP forwarding
#[tauri::command]
async fn stop_tcp_forward(
    remote_port: u16,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
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

    if let Err(e) = network.send_tcp_forward_stopped(&session_id, remote_port).await {
        return Err(format!("Failed to stop TCP forward: {}", e));
    }

    info!("TCP forwarding stopped for session {} on port {}", session_id, remote_port);
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
            stop_tcp_forward
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
