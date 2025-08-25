use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use tauri::{AppHandle, Manager};
use tauri::{Emitter, State};
use tokio::sync::{RwLock, mpsc};

mod p2p;
mod string_compressor;
mod terminal_events;

use iroh_gossip::api::GossipSender;
use p2p::{P2PNetwork, SessionTicket};
use terminal_events::{EventType, TerminalEvent};

// Helper function to validate session ticket format
fn is_valid_session_ticket(ticket: &str) -> bool {
    ticket.parse::<SessionTicket>().is_ok()
}

#[derive(Default)]
pub struct AppState {
    sessions: RwLock<HashMap<String, TerminalSession>>,
    network: RwLock<Option<P2PNetwork>>,
}

#[derive(Clone)]
pub struct TerminalSession {
    pub id: String,
    pub sender: GossipSender,
    pub event_sender: mpsc::UnboundedSender<TerminalEvent>,
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

    // Join session
    let (sender, mut event_receiver) = network
        .join_session(ticket)
        .await
        .map_err(|e| format!("Failed to join session: {}", e))?;

    // Create terminal session
    let (tx, mut rx) = mpsc::unbounded_channel();
    let terminal_session = TerminalSession {
        id: session_id.clone(),
        sender: sender.clone(),
        event_sender: tx,
    };

    {
        let mut sessions = state.sessions.write().await;
        sessions.insert(session_id.clone(), terminal_session);
    }

    // Handle incoming terminal events
    let app_handle_clone = app_handle.clone();
    let session_id_clone_events = session_id.clone();
    tokio::spawn(async move {
        while let Ok(event) = event_receiver.recv().await {
            let event_name = format!("terminal-event-{}", session_id_clone_events);
            #[cfg(debug_assertions)]
            println!("Broadcasting event to: {}", event_name);
            #[cfg(debug_assertions)]
            println!("Event data: {:?}", event);
            let _ = app_handle_clone.emit(&event_name, &event);
        }
    });

    // Handle outgoing input events
    let network_clone = network.clone();
    let sender_clone = sender.clone();
    let session_id_clone_input = session_id.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
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
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id).ok_or("Session not found")?;

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
    let session = {
        let sessions = state.sessions.read().await;
        sessions.get(&session_id).cloned()
    };

    if let Some(session) = session {
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
    }

    let mut sessions = state.sessions.write().await;
    sessions.remove(&session_id);

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
            parse_session_ticket
        ])
        .setup(|app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
