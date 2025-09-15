use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tauri::Manager;
use tauri::{Emitter, State};
use tokio::sync::{RwLock, mpsc};
use tokio_util::sync::CancellationToken;

use iroh_gossip::api::GossipSender;
use riterm_shared::{EventType, P2PNetwork, SessionTicket, TerminalEvent};

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
    ticket.parse::<SessionTicket>().is_ok()
}

#[derive(Default)]
pub struct AppState {
    sessions: RwLock<HashMap<String, TerminalSession>>,
    network: RwLock<Option<P2PNetwork>>,
    cleanup_token: RwLock<Option<CancellationToken>>,
}

#[derive(Clone)]
pub struct TerminalSession {
    pub id: String,
    pub sender: GossipSender,
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
        .parse::<SessionTicket>()
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

    let session_id = format!("session_{}", ticket.topic_id);

    // Check session limits before creating new session
    {
        let sessions = state.sessions.read().await;
        if sessions.len() >= MAX_CONCURRENT_SESSIONS {
            return Err(format!(
                "Maximum number of sessions ({}) reached. Please disconnect some sessions first.",
                MAX_CONCURRENT_SESSIONS
            ));
        }

        // Check if session already exists
        if sessions.contains_key(&session_id) {
            return Err("Session already exists. Please disconnect first.".to_string());
        }
    }

    // Join session
    let (sender, mut event_receiver) = network
        .join_session_with_buffer_limit(ticket, MAX_EVENTS_PER_SESSION)
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
                                #[cfg(debug_assertions)]
                                println!("Session {} approaching event limit: {}/{}",
                                    session_id_clone_events, current_count, MAX_EVENTS_PER_SESSION);
                            }

                            let event_name = format!("terminal-event-{}", session_id_clone_events);
                            #[cfg(debug_assertions)]
                            // println!("Broadcasting event to: {}", event_name);
                            let _ = app_handle_clone.emit(&event_name, &event);
                        }
                        Err(_) => {
                            #[cfg(debug_assertions)]
                            println!("Event receiver closed for session: {}", session_id_clone_events);
                            break;
                        }
                    }
                }
                _ = cancellation_token_events.cancelled() => {
                    #[cfg(debug_assertions)]
                    println!("Event handling task cancelled for session: {}", session_id_clone_events);
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
                                    #[cfg(debug_assertions)]
                                    eprintln!("Failed to send input: {}", e);
                                }
                            }
                        }
                        None => {
                            #[cfg(debug_assertions)]
                            println!("Input receiver closed for session: {}", session_id_clone_input);
                            break;
                        }
                    }
                }
                _ = cancellation_token_input.cancelled() => {
                    #[cfg(debug_assertions)]
                    println!("Input handling task cancelled for session: {}", session_id_clone_input);
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
    #[cfg(debug_assertions)]
    println!(
        "send_terminal_input called with session_id: {}, input: {:?}",
        session_id, input
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
            .as_secs_f64(),
        event_type: EventType::Input,
        data: input.clone(), // Clone for logging
    };

    #[cfg(debug_assertions)]
    println!("Sending event: {:?}", event);
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
            .as_secs_f64(),
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
    #[cfg(debug_assertions)]
    println!("Disconnecting session: {}", session_id);

    let session = {
        let mut sessions = state.sessions.write().await;
        sessions.remove(&session_id)
    };

    if let Some(session) = session {
        // Cancel all async tasks for this session
        session.cancellation_token.cancel();

        #[cfg(debug_assertions)]
        println!("Cancelled async tasks for session: {}", session_id);

        let network = {
            let network_guard = state.network.read().await;
            network_guard.as_ref().cloned()
        };

        if let Some(network) = network {
            if let Err(e) = network.end_session(&session_id, &session.sender).await {
                #[cfg(debug_assertions)]
                eprintln!("Failed to end P2P session gracefully: {}", e);
            }
        }

        #[cfg(debug_assertions)]
        println!("Session {} disconnected successfully", session_id);
    } else {
        #[cfg(debug_assertions)]
        println!("Session {} not found during disconnect", session_id);
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

    #[cfg(debug_assertions)]
    println!(
        "Starting session cleanup task with interval: {}s",
        CLEANUP_INTERVAL_SECS
    );
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    {
        builder = builder
            // .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
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
            get_session_stats
        ])
        .setup(|app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
