//! Agent session trait and process state management
#![allow(dead_code)]
//!
//! Provides the foundation for managing AI agent sessions with
//! async process handling and event broadcasting.

use anyhow::Result;
use riterm_shared::message_protocol::AgentType;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::process::Child;
use tokio::sync::{Mutex, RwLock, broadcast};

use super::events::{AgentEvent, AgentTurnEvent, PendingPermission, PermissionMode};

/// Configuration for agent sessions
#[derive(Debug, Clone, Default)]
pub struct AgentConfig {
    /// Custom binary path (optional)
    pub bin_path: Option<String>,
    /// Custom home directory (optional)
    pub home_dir: Option<String>,
    /// Additional CLI arguments
    pub custom_args: Option<String>,
    /// Permission mode
    pub permission_mode: PermissionMode,
}

/// Trait for managing agent sessions
pub trait AgentSession: Send + Sync {
    /// Get the session ID
    fn session_id(&self) -> &str;

    /// Get the agent type
    fn agent_type(&self) -> AgentType;

    /// Subscribe to agent events
    fn subscribe(&self) -> broadcast::Receiver<AgentTurnEvent>;

    /// Send a message to the agent and stream the response
    fn send_message(
        &self,
        text: String,
        turn_id: &str,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;

    /// Interrupt the current operation
    fn interrupt(&self) -> impl std::future::Future<Output = Result<(), String>> + Send;

    /// Get pending permission requests
    fn get_pending_permissions(
        &self,
    ) -> impl std::future::Future<Output = Vec<PendingPermission>> + Send;

    /// Respond to a permission request
    fn respond_to_permission(
        &self,
        request_id: &str,
        approved: bool,
        reason: Option<String>,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;
}

/// Shared state for managing agent processes
pub struct AgentProcessState {
    /// Active child processes by turn ID
    pub active_processes: Mutex<HashMap<String, Child>>,
    /// Interrupted flag
    pub interrupted: AtomicBool,
    /// Event broadcaster
    pub event_sender: broadcast::Sender<AgentTurnEvent>,
    /// Session ID
    pub session_id: String,
    /// Tool name tracking by ID
    pub tool_name_by_id: std::sync::Mutex<HashMap<String, String>>,
    /// Tool input buffer tracking by ID
    pub tool_input_by_id: std::sync::Mutex<HashMap<String, String>>,
    /// Block index to tool ID mapping
    pub tool_id_by_block_index: std::sync::Mutex<HashMap<i64, String>>,
    /// Last emitted text for delta computation
    pub last_emitted_text: std::sync::Mutex<String>,
    /// Pending permission requests
    pub pending_permissions: RwLock<HashMap<String, PendingPermission>>,
}

impl AgentProcessState {
    /// Create a new process state
    pub fn new(session_id: String) -> Self {
        let (event_sender, _) = broadcast::channel(1024);
        Self {
            active_processes: Mutex::new(HashMap::new()),
            interrupted: AtomicBool::new(false),
            event_sender,
            session_id,
            tool_name_by_id: std::sync::Mutex::new(HashMap::new()),
            tool_input_by_id: std::sync::Mutex::new(HashMap::new()),
            tool_id_by_block_index: std::sync::Mutex::new(HashMap::new()),
            last_emitted_text: std::sync::Mutex::new(String::new()),
            pending_permissions: RwLock::new(HashMap::new()),
        }
    }

    /// Emit an event to all subscribers
    pub fn emit_event(&self, turn_id: &str, event: AgentEvent) {
        let result = self.event_sender.send(AgentTurnEvent {
            turn_id: turn_id.to_string(),
            event,
        });
        match result {
            Ok(n) => tracing::info!("[emit_event] Event sent to {} receivers", n),
            Err(e) => tracing::warn!("[emit_event] Failed to send event: {} (no receivers?)", e),
        }
    }

    /// Emit an error event
    pub fn emit_error(&self, turn_id: &str, error: String) {
        self.emit_event(
            turn_id,
            AgentEvent::TurnError {
                session_id: self.session_id.clone(),
                error,
                code: None,
            },
        );
    }

    /// Reset cumulative text tracker for a new turn
    pub fn reset_text_tracker(&self) {
        if let Ok(mut last) = self.last_emitted_text.lock() {
            last.clear();
        }
    }

    /// Compute the true delta from cumulative text
    /// If the cumulative text starts with previously emitted text,
    /// return only the new portion.
    pub fn compute_text_delta(&self, cumulative: &str) -> String {
        if let Ok(mut last) = self.last_emitted_text.lock() {
            if cumulative.starts_with(last.as_str()) {
                let delta = cumulative[last.len()..].to_string();
                *last = cumulative.to_string();
                return delta;
            }
            // Cumulative text doesn't extend the previous — emit full text
            *last = cumulative.to_string();
        }
        cumulative.to_string()
    }

    /// Cache a tool name by ID
    pub fn cache_tool_name(&self, tool_id: &str, tool_name: &str) {
        if tool_id.is_empty() || tool_name.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_name_by_id.lock() {
            map.insert(tool_id.to_string(), tool_name.to_string());
        }
    }

    /// Get and remove a cached tool name
    pub fn take_tool_name(&self, tool_id: &str) -> Option<String> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_name_by_id
            .lock()
            .ok()
            .and_then(|mut map| map.remove(tool_id))
    }

    /// Peek at a cached tool name without removing
    pub fn peek_tool_name(&self, tool_id: &str) -> Option<String> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_name_by_id
            .lock()
            .ok()
            .and_then(|map| map.get(tool_id).cloned())
    }

    /// Cache a block index to tool ID mapping
    pub fn cache_tool_block_index(&self, index: i64, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_id_by_block_index.lock() {
            map.insert(index, tool_id.to_string());
        }
    }

    /// Get tool ID for a block index
    pub fn tool_id_for_block_index(&self, index: Option<i64>) -> Option<String> {
        let index = index?;
        self.tool_id_by_block_index
            .lock()
            .ok()
            .and_then(|map| map.get(&index).cloned())
    }

    /// Clear a block index mapping
    pub fn clear_tool_block_index(&self, index: Option<i64>) {
        if let Some(index) = index {
            if let Ok(mut map) = self.tool_id_by_block_index.lock() {
                map.remove(&index);
            }
        }
    }

    /// Append partial tool input JSON
    pub fn append_tool_input(&self, tool_id: &str, partial: &str) -> Option<Value> {
        if tool_id.is_empty() || partial.is_empty() {
            return None;
        }
        if let Ok(mut map) = self.tool_input_by_id.lock() {
            let entry = map.entry(tool_id.to_string()).or_default();
            entry.push_str(partial);
            if let Ok(value) = serde_json::from_str::<Value>(entry) {
                return Some(value);
            }
        }
        None
    }

    /// Clear tool input buffer
    pub fn clear_tool_input(&self, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_input_by_id.lock() {
            map.remove(tool_id);
        }
    }

    /// Register a pending permission request
    pub async fn register_permission_request(
        &self,
        request_id: String,
        tool_name: String,
        tool_params: Value,
        message: Option<String>,
    ) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let permission = PendingPermission {
            request_id: request_id.clone(),
            session_id: self.session_id.clone(),
            tool_name,
            tool_params,
            message,
            created_at: now,
            response_tx: None,
        };

        let mut pending = self.pending_permissions.write().await;
        pending.insert(request_id, permission);
    }

    /// Get all pending permission requests
    pub async fn get_pending_permissions(&self) -> Vec<PendingPermission> {
        let pending = self.pending_permissions.read().await;
        pending.values().cloned().collect()
    }

    /// Remove and return a pending permission request
    pub async fn remove_pending_permission(&self, request_id: &str) -> Option<PendingPermission> {
        let mut pending = self.pending_permissions.write().await;
        pending.remove(request_id)
    }

    /// Check if interrupted flag is set
    pub fn is_interrupted(&self) -> bool {
        self.interrupted.load(Ordering::SeqCst)
    }

    /// Set interrupted flag
    pub fn set_interrupted(&self, value: bool) {
        self.interrupted.store(value, Ordering::SeqCst);
    }

    /// Register an active process
    pub async fn register_process(&self, turn_id: String, child: Child) {
        let mut active = self.active_processes.lock().await;
        active.insert(turn_id, child);
    }

    /// Remove and return an active process
    pub async fn remove_process(&self, turn_id: &str) -> Option<Child> {
        let mut active = self.active_processes.lock().await;
        active.remove(turn_id)
    }

    /// Kill all active processes
    pub async fn kill_all_processes(&self) -> Result<(), String> {
        self.set_interrupted(true);
        let mut active = self.active_processes.lock().await;
        for child in active.values_mut() {
            child
                .kill()
                .await
                .map_err(|e| format!("Failed to kill process: {}", e))?;
        }
        active.clear();
        Ok(())
    }
}

/// Helper functions for extracting values from JSON
pub fn extract_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(raw) = value.get(*key).and_then(|v| v.as_str()) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Extract text from tool result content
pub fn extract_tool_result_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(obj) = value.as_object() {
        if obj
            .get("type")
            .and_then(|t| t.as_str())
            .map(|t| t == "text")
            .unwrap_or(false)
        {
            if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    if let Some(arr) = value.as_array() {
        let parts: Vec<String> = arr
            .iter()
            .filter_map(|item| {
                let kind = item.get("type").and_then(|t| t.as_str());
                if kind == Some("text") {
                    item.get("text")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
            .filter(|text| !text.trim().is_empty())
            .collect();
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

/// Extract text from content blocks
pub fn extract_text_from_content(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(obj) = value.as_object() {
        if obj
            .get("type")
            .and_then(|t| t.as_str())
            .map(|t| t == "text")
            .unwrap_or(false)
        {
            if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    if let Some(arr) = value.as_array() {
        let parts: Vec<String> = arr
            .iter()
            .filter_map(|item| {
                let kind = item.get("type").and_then(|t| t.as_str());
                if kind == Some("text") {
                    item.get("text")
                        .and_then(|t| t.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                } else {
                    None
                }
            })
            .collect();
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_state_creation() {
        let state = AgentProcessState::new("test-session".to_string());
        assert_eq!(state.session_id, "test-session");
    }

    #[test]
    fn test_text_delta_computation() {
        let state = AgentProcessState::new("test".to_string());

        // First delta should be full text
        let delta1 = state.compute_text_delta("Hello");
        assert_eq!(delta1, "Hello");

        // Second delta should only be new content
        let delta2 = state.compute_text_delta("Hello World");
        assert_eq!(delta2, " World");

        // Non-extending text should emit full content
        let delta3 = state.compute_text_delta("Different text");
        assert_eq!(delta3, "Different text");
    }

    #[test]
    fn test_tool_name_caching() {
        let state = AgentProcessState::new("test".to_string());

        state.cache_tool_name("tool-1", "bash");
        assert_eq!(state.peek_tool_name("tool-1"), Some("bash".to_string()));
        assert_eq!(state.take_tool_name("tool-1"), Some("bash".to_string()));
        assert_eq!(state.peek_tool_name("tool-1"), None);
    }

    #[tokio::test]
    async fn test_permission_request_registration() {
        let state = AgentProcessState::new("test".to_string());

        state
            .register_permission_request(
                "req-1".to_string(),
                "bash".to_string(),
                serde_json::json!({"command": "ls"}),
                Some("Run ls?".to_string()),
            )
            .await;

        let pending = state.get_pending_permissions().await;
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].tool_name, "bash");

        let removed = state.remove_pending_permission("req-1").await;
        assert!(removed.is_some());

        let pending = state.get_pending_permissions().await;
        assert!(pending.is_empty());
    }
}
