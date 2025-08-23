use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

/// Terminal-related Tauri commands
#[tauri::command]
pub async fn send_terminal_input(
    session_id: String,
    input: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let sessions_state = state.sessions.lock().await;
    let network_state = state.network.lock().await;

    match (sessions_state.get(&session_id), network_state.as_ref()) {
        (Some(session_info), Some(network)) => {
            if let Some(sender) = &session_info.sender {
                network
                    .send_input(sender, input, &session_id)
                    .await
                    .map_err(|e| crate::error::AppError::SendFailed(e.to_string()))?;
                Ok(())
            } else {
                Err(crate::error::AppError::SessionNotActive(session_id))
            }
        }
        (None, _) => Err(crate::error::AppError::SessionNotFound(session_id)),
        (_, None) => Err(crate::error::AppError::NetworkNotInitialized),
    }
}

#[tauri::command]
pub async fn send_directed_message(
    session_id: String,
    message: String,
    _target_node: Option<String>, // 添加下划线前缀表示有意未使用
    state: State<'_, AppState>,
) -> AppResult<()> {
    let sessions_state = state.sessions.lock().await;
    let network_state = state.network.lock().await;

    match (sessions_state.get(&session_id), network_state.as_ref()) {
        (Some(session_info), Some(network)) => {
            if let Some(sender) = &session_info.sender {
                // For now, send as regular terminal output
                // In the future, this could be extended for directed messaging
                network
                    .send_terminal_output(sender, message, &session_id)
                    .await
                    .map_err(|e| crate::error::AppError::SendFailed(e.to_string()))?;
                Ok(())
            } else {
                Err(crate::error::AppError::SessionNotActive(session_id))
            }
        }
        (None, _) => Err(crate::error::AppError::SessionNotFound(session_id)),
        (_, None) => Err(crate::error::AppError::NetworkNotInitialized),
    }
}

#[tauri::command]
pub async fn execute_remote_command(
    session_id: String,
    command: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let sessions_state = state.sessions.lock().await;
    let network_state = state.network.lock().await;

    match (sessions_state.get(&session_id), network_state.as_ref()) {
        (Some(session_info), Some(network)) => {
            if let Some(sender) = &session_info.sender {
                // Send command as input with newline
                let command_with_newline = format!("{}\n", command);
                network
                    .send_input(sender, command_with_newline, &session_id)
                    .await
                    .map_err(|e| crate::error::AppError::SendFailed(e.to_string()))?;
                Ok(())
            } else {
                Err(crate::error::AppError::SessionNotActive(session_id))
            }
        }
        (None, _) => Err(crate::error::AppError::SessionNotFound(session_id)),
        (_, None) => Err(crate::error::AppError::NetworkNotInitialized),
    }
}

