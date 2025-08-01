use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;
use tauri::{Emitter, State};
use tokio::sync::mpsc;

mod p2p;
mod terminal_events;

use p2p::P2PNetwork;
use terminal_events::{EventType, TerminalEvent};

// Helper function to validate node address format
fn is_valid_node_address(address: &str) -> bool {
    let parts: Vec<&str> = address.split('@').collect();
    if parts.len() != 2 {
        return false;
    }

    let node_id = parts[0];
    let addr_port = parts[1];

    // Node ID should be a hex string of reasonable length (typically 64 chars for ed25519)
    if node_id.len() < 32 || node_id.len() > 128 {
        return false;
    }

    // Check if node_id contains only hex characters
    if !node_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }

    // Address:port should contain a colon and have reasonable format
    if !addr_port.contains(':') {
        return false;
    }

    let addr_parts: Vec<&str> = addr_port.split(':').collect();
    if addr_parts.len() != 2 {
        return false;
    }

    // Validate port is a number
    if addr_parts[1].parse::<u16>().is_err() {
        return false;
    }

    true
}

#[derive(Default)]
pub struct AppState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    network: Mutex<Option<P2PNetwork>>,
}

#[derive(Clone)]
pub struct TerminalSession {
    pub id: String,
    pub event_sender: mpsc::UnboundedSender<TerminalEvent>,
}

#[derive(Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub node_address: String,
    pub session_id: String,
}

#[tauri::command]
async fn initialize_network(state: State<'_, AppState>) -> Result<String, String> {
    let (network, _) = P2PNetwork::new()
        .await
        .map_err(|e| format!("Failed to initialize P2P network: {}", e))?;

    let node_id = network.get_node_id().await;

    let mut network_guard = state.network.lock().unwrap();
    *network_guard = Some(network);

    Ok(node_id)
}

#[tauri::command]
async fn connect_to_peer(
    node_address: String,
    session_id: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Validate inputs
    if node_address.trim().is_empty() {
        return Err("Node address cannot be empty".to_string());
    }
    if session_id.trim().is_empty() {
        return Err("Session ID cannot be empty".to_string());
    }

    // Validate node address format more thoroughly
    if !is_valid_node_address(&node_address) {
        return Err("Invalid node address format. Expected: node_id@address:port".to_string());
    }

    let network = {
        let network_guard = state.network.lock().unwrap();
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => {
                return Err("Network not initialized. Please restart the application.".to_string());
            }
        }
    };

    // Join session
    let mut event_receiver = network
        .join_session(session_id.clone())
        .await
        .map_err(|e| format!("Failed to join session: {}", e))?;

    // Create terminal session
    let (tx, mut rx) = mpsc::unbounded_channel();
    let terminal_session = TerminalSession {
        id: session_id.clone(),
        event_sender: tx,
    };

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(session_id.clone(), terminal_session);
    }

    // Handle incoming terminal events
    let app_handle_clone = app_handle.clone();
    let session_id_clone = session_id.clone();
    tokio::spawn(async move {
        while let Ok(event) = event_receiver.recv().await {
            let _ = app_handle_clone.emit(&format!("terminal-event-{}", session_id_clone), &event);
        }
    });

    // Handle outgoing input events
    let network_clone = network.clone();
    let session_id_clone2 = session_id.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let EventType::Input = event.event_type {
                if let Err(e) = network_clone
                    .send_input(session_id_clone2.clone(), event.data)
                    .await
                {
                    eprintln!("Failed to send input: {}", e);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn send_terminal_input(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&session_id).ok_or("Session not found")?;

    let event = TerminalEvent {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64(),
        event_type: EventType::Input,
        data: input,
    };

    session
        .event_sender
        .send(event)
        .map_err(|e| format!("Failed to send input event: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn disconnect_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);

    Ok(())
}

#[tauri::command]
async fn get_active_sessions(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let sessions = state.sessions.lock().unwrap();
    Ok(sessions.keys().cloned().collect())
}

#[tauri::command]
async fn get_node_info(state: State<'_, AppState>) -> Result<String, String> {
    let network = {
        let network_guard = state.network.lock().unwrap();
        match network_guard.as_ref() {
            Some(n) => n.clone(),
            None => return Err("Network not initialized".to_string()),
        }
    };
    Ok(network.get_node_id().await)
}

#[tauri::command]
async fn parse_node_address(address: String) -> Result<String, String> {
    // Use the same validation function
    if is_valid_node_address(&address) {
        Ok(address)
    } else {
        Err("Invalid node address format. Expected: node_id@address:port".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            initialize_network,
            connect_to_peer,
            send_terminal_input,
            disconnect_session,
            get_active_sessions,
            get_node_info,
            parse_node_address
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
