use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

/// Network-related Tauri commands
#[tauri::command]
pub async fn initialize_network(state: State<'_, AppState>) -> AppResult<String> {
    state.network_service.initialize(None).await
}

#[tauri::command]
pub async fn initialize_network_with_relay(
    relay_url: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    state.network_service.initialize(Some(relay_url)).await
}

#[tauri::command]
pub async fn get_node_info(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    state.network_service.get_node_info().await
}

#[tauri::command]
pub async fn connect_to_peer(peer_addr: String, state: State<'_, AppState>) -> AppResult<()> {
    state.network_service.connect_to_peer(peer_addr).await
}

#[tauri::command]
pub async fn get_network_stats(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    state.network_service.get_stats().await
}
