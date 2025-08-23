use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

/// Network-related Tauri commands
#[tauri::command]
pub async fn initialize_network(state: State<'_, AppState>) -> AppResult<String> {
    let mut network = state.network.lock().await;
    
    if network.is_some() {
        return Err(crate::error::AppError::NetworkError("Network already initialized".to_string()));
    }
    
    let p2p_network = crate::p2p::P2PNetwork::new(None)
        .await
        .map_err(|e| crate::error::AppError::NetworkError(e.to_string()))?;
    
    let node_id = p2p_network.get_node_id().await;
    *network = Some(p2p_network);
    
    Ok(node_id)
}

#[tauri::command]
pub async fn initialize_network_with_relay(
    relay_url: String,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let mut network = state.network.lock().await;
    
    if network.is_some() {
        return Err(crate::error::AppError::NetworkError("Network already initialized".to_string()));
    }
    
    let p2p_network = crate::p2p::P2PNetwork::new(Some(relay_url))
        .await
        .map_err(|e| crate::error::AppError::NetworkError(e.to_string()))?;
    
    let node_id = p2p_network.get_node_id().await;
    *network = Some(p2p_network);
    
    Ok(node_id)
}

#[tauri::command]
pub async fn get_node_info(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    let network = state.network.lock().await;
    
    match network.as_ref() {
        Some(network) => {
            let node_id = network.get_node_id().await;
            let node_addr = network.get_node_addr().await.ok();
            
            Ok(serde_json::json!({
                "node_id": node_id,
                "node_addr": node_addr.map(|addr| format!("{:?}", addr)),
                "status": "connected"
            }))
        }
        None => Err(crate::error::AppError::NetworkNotInitialized),
    }
}

#[tauri::command]
pub async fn connect_to_peer(sessionTicket: String, state: State<'_, AppState>) -> AppResult<String> {
    let network = state.network.lock().await;
    
    match network.as_ref() {
        Some(network) => {
            // 解析会话票据
            let ticket = sessionTicket.parse::<crate::p2p::SessionTicket>()
                .map_err(|e| crate::error::AppError::InvalidTicket(e.to_string()))?;
            
            // 获取票据中的节点地址
            if ticket.nodes.is_empty() {
                return Err(crate::error::AppError::InvalidTicket("No nodes in ticket".to_string()));
            }
            
            // 连接到票据中的第一个节点
            let addr = ticket.nodes[0].clone();
            network.connect_to_peer(addr).await
                .map_err(|e| crate::error::AppError::ConnectionFailed(e.to_string()))?;
            
            // 保存 topic_id 以便后续使用
            let topic_id = ticket.topic_id.to_string();
            
            // 加入会话
            let (sender, receiver) = network
                .join_session(&ticket)
                .await
                .map_err(|e| crate::error::AppError::JoinFailed(e.to_string()))?;
            
            // 生成会话ID
            let session_id = format!("session_{}", topic_id);
            
            // 存储会话信息
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

#[tauri::command]
pub async fn get_network_stats(state: State<'_, AppState>) -> AppResult<serde_json::Value> {
    let network = state.network.lock().await;
    
    match network.as_ref() {
        Some(network) => {
            let sessions = network.get_active_sessions().await;
            
            Ok(serde_json::json!({
                "total_sessions": sessions.len(),
                "status": "connected"
            }))
        }
        None => Err(crate::error::AppError::NetworkNotInitialized),
    }
}
