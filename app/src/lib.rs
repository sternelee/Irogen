use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tauri::{Emitter, State};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tracing::info;
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

use riterm_shared::{
    CommunicationManager, Event, EventListener, EventType, IODataType, Message, MessageBuilder,
    MessagePayload, QuicMessageClientHandle, SerializableEndpointAddr, TcpDataType,
    TcpForwardingAction, TcpForwardingType, TerminalAction,
};

/// Maximum number of concurrent sessions to prevent memory exhaustion
const MAX_CONCURRENT_SESSIONS: usize = 50;
/// Maximum events per session buffer
const MAX_EVENTS_PER_SESSION: usize = 5000;
/// Memory cleanup interval in seconds
const CLEANUP_INTERVAL_SECS: u64 = 300; // 5 minutes

// Helper function to validate session ticket format
fn is_valid_session_ticket(ticket: &str) -> bool {
    // Basic validation for the new ticket format
    ticket.starts_with("ticket:") && ticket.len() > 20
}

// Parse ticket and extract EndpointId
fn parse_ticket_node_addr(
    ticket: &str,
) -> Result<iroh::EndpointId, Box<dyn std::error::Error>> {
    use data_encoding::BASE32;
    use serde_json;

    // Remove "ticket:" prefix
    let encoded = ticket
        .strip_prefix("ticket:")
        .ok_or("Invalid ticket format")?;

    // Decode base32
    let ticket_json_bytes = BASE32.decode(encoded.as_bytes())?;
    let ticket_json = String::from_utf8(ticket_json_bytes)?;

    // Parse JSON
    let ticket_data: serde_json::Value = serde_json::from_str(&ticket_json)?;

    // Extract endpoint_addr
    let endpoint_addr_b64 = ticket_data
        .get("endpoint_addr")
        .and_then(|v| v.as_str())
        .ok_or("Missing endpoint_addr in ticket")?;

    // Parse the SerializableEndpointAddr from base64
    let serializable_addr = SerializableEndpointAddr::from_base64(endpoint_addr_b64)?;

    // Try to reconstruct EndpointId from SerializableEndpointAddr
    Ok(serializable_addr.try_to_endpoint_id()?)
}

// Parse structured events from terminal data - DEPRECATED
// Events are now structured in EventType enum
#[allow(dead_code)]
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
        if let Some(captures) = Regex::new(r"\[Terminal Output: ([^]]+)\] (.*)")
            .unwrap()
            .captures(data)
        {
            if let (Some(terminal_id), Some(output_data)) = (captures.get(1), captures.get(2)) {
                return Ok(serde_json::json!({
                    "type": "terminal_output",
                    "terminal_id": terminal_id.as_str(),
                    "data": output_data.as_str()
                }));
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

    Err("No structured event found".into())
}

#[derive(Default)]
pub struct AppState {
    sessions: RwLock<HashMap<String, TerminalSession>>,
    communication_manager: RwLock<Option<Arc<CommunicationManager>>>,
    quic_client: RwLock<Option<QuicMessageClientHandle>>,
    cleanup_token: RwLock<Option<CancellationToken>>,
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

#[tauri::command]
async fn initialize_network_with_relay(
    relay_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Create communication manager
    let communication_manager = Arc::new(CommunicationManager::new("riterm_app".to_string()));
    communication_manager
        .initialize()
        .await
        .map_err(|e| format!("Failed to initialize communication manager: {}", e))?;

    // Get secret key path for persistent node ID - use app startup directory
    let app_data_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let secret_key_path = app_data_dir.join("riterm_app_secret_key");
    info!(
        "🔑 Using app secret key in startup directory: {:?}",
        secret_key_path
    );

    // Create QUIC client with persistent secret key
    let quic_client = QuicMessageClientHandle::new_with_secret_key(
        relay_url,
        communication_manager.clone(),
        Some(&secret_key_path),
    )
    .await
    .map_err(|e| format!("Failed to initialize QUIC client: {}", e))?;

    let node_id = format!("{:?}", quic_client.get_node_id().await);

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
    start_cleanup_task(&state).await;

    Ok(node_id)
}

#[tauri::command]
async fn initialize_network(state: State<'_, AppState>) -> Result<String, String> {
    initialize_network_with_relay(None, state).await
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

    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => {
                return Err(
                    "QUIC client not initialized. Please restart the application.".to_string(),
                );
            }
        }
    };

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

    // Parse the ticket to extract EndpointId
    let node_addr = parse_ticket_node_addr(&session_ticket)
        .map_err(|e| format!("Failed to parse session ticket: {}", e))?;

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

    // Establish QUIC connection to the CLI server using NodeAddr (包含relay信息)
    let (connection_id, message_receiver) = {
        let client_guard = state.quic_client.read().await;
        if let Some(quic_client) = client_guard.as_ref() {
            #[cfg(debug_assertions)]
            tracing::info!("🔗 Establishing connection to server via NodeAddr");
            #[cfg(debug_assertions)]
            tracing::info!("🔗 Node ID: {:?}", node_addr);

            // Get message receiver
            let receiver = quic_client.get_message_receiver().await;

            // Establish actual QUIC connection using EndpointId
            let connection_id = match quic_client
                .connect_to_server(&node_addr)
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

    // Create terminal session with enhanced tracking
    let cancellation_token = CancellationToken::new();
    let terminal_session = TerminalSession {
        id: session_id.clone(),
        connection_id: connection_id.clone(),
        node_id: node_addr.to_string(),
        last_activity: Arc::new(RwLock::new(Instant::now())),
        cancellation_token: cancellation_token.clone(),
        event_count: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
    };

    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), terminal_session.clone());
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
    let cancellation_token_receiver = cancellation_token.clone();
    let last_activity_receiver = terminal_session.last_activity.clone();
    let event_count_receiver = terminal_session.event_count.clone();

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
                                    // Handle TCP data messages
                                    #[cfg(debug_assertions)]
                                    tracing::debug!("Received TCP data message: session_id={}, connection_id={}, data_type={:?}",
                                        tcp_data_msg.session_id, tcp_data_msg.connection_id, tcp_data_msg.data_type);

                                    // Emit TCP data event to frontend
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

    // Session is now ready to handle terminal operations
    // Terminal input/output will be handled through the new message protocol

    Ok(session_id)
}

// Helper function to send messages via QUIC client
async fn send_message_via_client(
    state: &State<'_, AppState>,
    connection_id: &str,
    message: Message,
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

// DEPRECATED: This command is no longer needed with the new message protocol
// Use send_terminal_input_to_terminal instead

// DEPRECATED: These commands are no longer needed with the new message protocol
// Terminal commands are now handled through send_terminal_input_to_terminal

#[tauri::command]
async fn send_directed_message(
    _request: DirectedMessageRequest,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    Err("Directed messages are deprecated. Use terminal commands instead.".to_string())
}

#[tauri::command]
async fn execute_remote_command(
    command: String,
    sessionId: String,
    terminalId: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Convert to use the new terminal input protocol
    send_terminal_input_to_terminal(sessionId, terminalId, format!("{}\n", command), state).await
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
    sessionId: String,
    name: Option<String>,
    shell_path: Option<String>,
    working_dir: Option<String>,
    size: Option<(u16, u16)>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
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
        "riterm_app".to_string(),
        action,
        Some(sessionId.clone()),
    )
    .with_session(sessionId.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal creation").await?;

    Ok(())
}

#[tauri::command]
async fn stop_terminal(
    sessionId: String,
    terminalId: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message for stopping terminal
    let action = TerminalAction::Stop {
        terminal_id: terminalId.clone(),
    };

    let message = MessageBuilder::terminal_management(
        "riterm_app".to_string(),
        action,
        Some(sessionId.clone()),
    )
    .with_session(sessionId.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal stop").await?;

    Ok(())
}

#[tauri::command]
async fn list_terminals(sessionId: String, state: State<'_, AppState>) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message for listing terminals
    let message = MessageBuilder::terminal_management(
        "riterm_app".to_string(),
        TerminalAction::List,
        Some(sessionId.clone()),
    )
    .with_session(sessionId.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal list").await?;

    Ok(())
}

#[tauri::command]
async fn send_terminal_input_to_terminal(
    sessionId: String,
    terminalId: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal I/O message
    let message = MessageBuilder::terminal_io(
        "riterm_app".to_string(),
        terminalId,
        IODataType::Input,
        input.as_bytes().to_vec(),
    )
    .with_session(sessionId.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal input").await?;

    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    sessionId: String,
    terminalId: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // Create terminal management message for resizing terminal
    let action = TerminalAction::Resize {
        terminal_id: terminalId.clone(),
        rows,
        cols,
    };

    let message = MessageBuilder::terminal_management(
        "riterm_app".to_string(),
        action,
        Some(sessionId.clone()),
    )
    .with_session(sessionId.clone());

    // Send message via QUIC client
    send_message_via_client(&state, &session.connection_id, message, "terminal resize").await?;

    Ok(())
}

#[tauri::command]
async fn get_terminal_list(sessionId: String, state: State<'_, AppState>) -> Result<(), String> {
    list_terminals(sessionId, state).await
}

// DEPRECATED: Terminal connection is now implicit with the new message protocol
// No separate connection step is needed

#[tauri::command]
async fn connect_to_terminal(
    sessionId: String,
    terminalId: String,
    _state: State<'_, AppState>,
) -> Result<(), String> {
    #[cfg(any(debug_assertions, not(feature = "release-logging")))]
    tracing::info!(
        "connect_to_terminal called for session {} terminal {} (now a no-op)",
        sessionId,
        terminalId
    );

    Ok(())
}

// === TCP Forwarding Management Commands ===

#[tauri::command]
async fn create_tcp_forwarding_session(
    sessionId: String,
    local_addr: String,
    remote_host: Option<String>,
    remote_port: Option<u16>,
    forwarding_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // 解析转发类型
    let fwd_type = match forwarding_type.as_str() {
        "ListenToRemote" | "listen-to-remote" => TcpForwardingType::ListenToRemote,
        "ConnectToRemote" | "connect-to-remote" => TcpForwardingType::ConnectToRemote,
        _ => {
            return Err(
                "Invalid forwarding type. Use 'ListenToRemote' or 'ConnectToRemote'".to_string(),
            );
        }
    };

    // 创建 TCP 转发管理消息
    let action = TcpForwardingAction::CreateSession {
        local_addr,
        remote_host,
        remote_port,
        forwarding_type: fwd_type,
    };

    let message =
        MessageBuilder::tcp_forwarding("riterm_app".to_string(), action, Some(sessionId.clone()))
            .with_session(sessionId.clone());

    // 发送消息 via QUIC 客户端
    send_message_via_client(
        &state,
        &session.connection_id,
        message,
        "TCP forwarding session creation",
    )
    .await?;

    Ok(())
}

#[tauri::command]
async fn list_tcp_forwarding_sessions(
    sessionId: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // 创建列出 TCP 转发会话的消息
    let message = MessageBuilder::tcp_forwarding(
        "riterm_app".to_string(),
        TcpForwardingAction::ListSessions,
        Some(sessionId.clone()),
    )
    .with_session(sessionId.clone());

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

#[tauri::command]
async fn stop_tcp_forwarding_session(
    sessionId: String,
    tcp_session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // 创建停止 TCP 转发会话的消息
    let message = MessageBuilder::tcp_forwarding(
        "riterm_app".to_string(),
        TcpForwardingAction::StopSession {
            session_id: tcp_session_id,
        },
        Some(sessionId.clone()),
    )
    .with_session(sessionId.clone());

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

#[tauri::command]
async fn get_tcp_forwarding_session_info(
    sessionId: String,
    tcp_session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
            .cloned()
            .ok_or("Session not found")?
    };

    // 创建获取 TCP 转发会话信息的消息
    let message = MessageBuilder::tcp_forwarding(
        "riterm_app".to_string(),
        TcpForwardingAction::GetSessionInfo {
            session_id: tcp_session_id,
        },
        Some(sessionId.clone()),
    )
    .with_session(sessionId.clone());

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

#[tauri::command]
async fn send_tcp_data(
    sessionId: String,
    tcp_session_id: String,
    connection_id: String,
    data: Vec<u8>,
    data_type: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&sessionId)
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
        "riterm_app".to_string(),
        tcp_session_id,
        connection_id,
        dt_type,
        data,
    )
    .with_session(sessionId.clone());

    // 发送消息 via QUIC 客户端
    send_message_via_client(&state, &session.connection_id, message, "TCP data").await?;

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
            initialize_network_with_relay,
            initialize_network,
            connect_to_peer,
            execute_remote_command, // Kept for compatibility but redirects to terminal input
            disconnect_session,
            get_active_sessions,
            get_node_info,
            parse_session_ticket,
            // Terminal Management
            create_terminal,
            stop_terminal,
            list_terminals,
            get_terminal_list,
            send_terminal_input_to_terminal,
            resize_terminal,
            connect_to_terminal, // Kept as no-op for compatibility
            // TCP Forwarding Management
            create_tcp_forwarding_session,
            list_tcp_forwarding_sessions,
            stop_tcp_forwarding_session,
            get_tcp_forwarding_session_info,
            send_tcp_data,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
