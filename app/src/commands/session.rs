use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

/// Session management Tauri commands
#[tauri::command]
pub async fn get_active_sessions(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let network_state = state.network.lock().await;

    match network_state.as_ref() {
        Some(network) => {
            let sessions = network.get_active_sessions().await;
            Ok(sessions)
        }
        None => Err(crate::error::AppError::NetworkNotInitialized),
    }
}

#[tauri::command]
pub async fn parse_session_ticket(ticket: String) -> AppResult<serde_json::Value> {
    match ticket.parse::<crate::p2p::SessionTicket>() {
        Ok(parsed_ticket) => Ok(serde_json::json!({
            "topic_id": parsed_ticket.topic_id.to_string(),
            "nodes": parsed_ticket.nodes.len(),
            "valid": true
        })),
        Err(e) => Err(crate::error::AppError::InvalidTicket(e.to_string())),
    }
}

#[tauri::command]
pub async fn disconnect_session(session_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let mut sessions_state = state.sessions.lock().await;

    if let Some(session_info) = sessions_state.remove(&session_id) {
        // Perform cleanup for the session
        if let Some(sender) = session_info.sender {
            // Send disconnect message if needed
            drop(sender);
        }
        Ok(())
    } else {
        Err(crate::error::AppError::SessionNotFound(session_id))
    }
}

#[tauri::command]
pub async fn join_session(ticket: String, state: State<'_, AppState>) -> AppResult<String> {
    let network_state = state.network.lock().await;

    match network_state.as_ref() {
        Some(network) => {
            let parsed_ticket = ticket
                .parse::<crate::p2p::SessionTicket>()
                .map_err(|e| crate::error::AppError::InvalidTicket(e.to_string()))?;

            // 保存 topic_id 以便后续使用
            let topic_id = parsed_ticket.topic_id.to_string();

            let (sender, receiver) = network
                .join_session(&parsed_ticket)
                .await
                .map_err(|e| crate::error::AppError::JoinFailed(e.to_string()))?;

            let session_id = format!("session_{}", topic_id);

            // Store session info
            let mut sessions_state = state.sessions.lock().await;
            sessions_state.insert(
                session_id.clone(),
                crate::state::SessionInfo {
                    session_id: session_id.clone(),
                    sender: Some(sender),
                    receiver: Some(receiver),
                    is_host: false,
                },
            );

            Ok(session_id)
        }
        None => Err(crate::error::AppError::NetworkNotInitialized),
    }
}

