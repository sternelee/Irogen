//! ACP Permission Handler Integration
//!
//! This module provides integration between PermissionHandler and ACP,
//! enabling automatic and manual tool approval workflows.

use crate::agent::permission_handler::{
    ApprovalDecision, PermissionHandler, PermissionMode, PermissionStatus,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Permission option kind (simplified version)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    DenyOnce,
    DenyAlways,
    Other,
}

/// Permission option for ACP integration
#[derive(Debug, Clone)]
pub struct PermissionOption {
    pub option_id: String,
    pub kind: PermissionOptionKind,
}

/// Permission request entry for ACP integration
#[derive(Debug, Clone)]
pub struct AcpPermissionEntry {
    pub request_id: String,
    pub tool_name: String,
    pub input: Option<serde_json::Value>,
    pub options: Vec<PermissionOption>,
    pub created_at: u64,
}

/// Permission state for ACP sessions
#[derive(Debug, Clone)]
pub struct AcpPermissionState {
    pub mode: PermissionMode,
    pub allowed_tools: Vec<String>,
    pub pending_requests: Vec<AcpPermissionEntry>,
    pub completed_requests: Vec<CompletedAcpPermissionEntry>,
}

/// Completed permission entry
#[derive(Debug, Clone)]
pub struct CompletedAcpPermissionEntry {
    pub request_id: String,
    pub tool_name: String,
    pub status: PermissionStatus,
    pub decision: Option<ApprovalDecision>,
    pub completed_at: u64,
}

/// ACP Permission Handler - wraps PermissionHandler for ACP integration
///
/// `inner` is shared behind an `Arc<RwLock<_>>` so that session-level approvals
/// persist across clones and across `&self` mutations (e.g. `resolve`).
pub struct AcpPermissionHandler {
    inner: Arc<RwLock<PermissionHandler>>,
    pending: Arc<RwLock<HashMap<String, AcpPermissionEntry>>>,
    completed: Arc<RwLock<HashMap<String, CompletedAcpPermissionEntry>>>,
}

impl AcpPermissionHandler {
    /// Create a new ACP permission handler with the given mode
    pub fn new(mode: PermissionMode) -> Self {
        Self {
            inner: Arc::new(RwLock::new(PermissionHandler::new(mode))),
            pending: Arc::new(RwLock::new(HashMap::new())),
            completed: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Get the current permission mode
    pub async fn mode(&self) -> PermissionMode {
        self.inner.read().await.mode()
    }

    /// Set the permission mode
    pub async fn set_mode(&self, mode: PermissionMode) {
        self.inner.write().await.set_mode(mode);
    }

    /// Check if a tool should be auto-approved
    pub async fn should_auto_approve(
        &self,
        tool_name: &str,
        tool_call_id: &str,
    ) -> Option<ApprovalDecision> {
        self.inner
            .read()
            .await
            .should_auto_approve(tool_name, tool_call_id)
            .map(|d| d.decision)
    }

    /// Check auto-approval and return appropriate permission option
    /// Returns None if manual approval is needed
    pub async fn handle_permission_request(
        &self,
        tool_name: &str,
        tool_call_id: &str,
        options: &[PermissionOption],
    ) -> Option<PermissionOption> {
        // Check if should auto-approve
        if let Some(decision) = self.should_auto_approve(tool_name, tool_call_id).await {
            match decision {
                ApprovalDecision::Approved | ApprovalDecision::ApprovedForSession => {
                    // Find AllowOnce or AllowAlways option
                    return options
                        .iter()
                        .find(|opt| {
                            matches!(
                                opt.kind,
                                PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways
                            )
                        })
                        .cloned();
                }
                ApprovalDecision::Abort => {
                    // Return None to indicate cancellation
                    return None;
                }
            }
        }

        // Manual approval needed
        None
    }

    /// Add a pending permission request
    pub async fn add_request(&self, entry: AcpPermissionEntry) {
        let mut pending = self.pending.write().await;
        pending.insert(entry.request_id.clone(), entry);
    }

    /// Resolve a permission request
    pub async fn resolve(
        &self,
        request_id: &str,
        approved: bool,
        decision: Option<ApprovalDecision>,
        _allowed_tools: Option<Vec<String>>,
    ) -> Result<(), String> {
        // Get the pending entry
        let entry = {
            let mut pending = self.pending.write().await;
            pending
                .remove(request_id)
                .ok_or_else(|| format!("Permission request '{}' not found", request_id))?
        };

        // Clone tool_name for later use
        let tool_name = entry.tool_name.clone();

        // Create completed entry
        let completed = CompletedAcpPermissionEntry {
            request_id: request_id.to_string(),
            tool_name,
            status: if approved {
                PermissionStatus::Approved
            } else {
                PermissionStatus::Denied
            },
            decision,
            completed_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };

        // Add to completed
        let mut completed_map = self.completed.write().await;
        completed_map.insert(request_id.to_string(), completed);

        // If approved for session, add to allowed tools
        if approved && matches!(decision, Some(ApprovalDecision::ApprovedForSession)) {
            self.inner
                .write()
                .await
                .add_allowed_tool(entry.tool_name.clone());
        }

        Ok(())
    }

    /// Get all pending requests
    pub async fn get_pending(&self) -> Vec<AcpPermissionEntry> {
        let pending = self.pending.read().await;
        pending.values().cloned().collect()
    }

    /// Get all completed requests
    pub async fn get_completed(&self) -> Vec<CompletedAcpPermissionEntry> {
        let completed = self.completed.read().await;
        completed.values().cloned().collect()
    }

    /// Get the permission state
    pub async fn get_state(&self) -> AcpPermissionState {
        let allowed_tools = {
            let handler = self.inner.read().await;
            handler.allowed_tools().iter().cloned().collect()
        };
        AcpPermissionState {
            mode: self.mode().await,
            allowed_tools,
            pending_requests: self.get_pending().await,
            completed_requests: self.get_completed().await,
        }
    }
}

impl Clone for AcpPermissionHandler {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            pending: self.pending.clone(),
            completed: self.completed.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_acp_permission_handler_creation() {
        let handler = AcpPermissionHandler::new(PermissionMode::AlwaysAsk);
        assert_eq!(handler.mode().await, PermissionMode::AlwaysAsk);
    }

    #[tokio::test]
    async fn test_acp_auto_approve_always_approved() {
        let handler = AcpPermissionHandler::new(PermissionMode::AlwaysAsk);

        assert!(
            handler
                .should_auto_approve("change_title", "tool-123")
                .await
                .is_some()
        );
    }

    #[tokio::test]
    async fn test_acp_approved_for_session_persists() {
        let handler = AcpPermissionHandler::new(PermissionMode::AlwaysAsk);

        let entry = AcpPermissionEntry {
            request_id: "req-session".to_string(),
            tool_name: "bash".to_string(),
            input: None,
            options: vec![],
            created_at: 1234567890,
        };
        handler.add_request(entry).await;

        handler
            .resolve(
                "req-session",
                true,
                Some(ApprovalDecision::ApprovedForSession),
                None,
            )
            .await
            .unwrap();

        // The session-level approval must be persisted on the shared handler,
        // not on a discarded clone.
        let state = handler.get_state().await;
        assert!(
            state.allowed_tools.contains(&"bash".to_string()),
            "ApprovedForSession should persist the tool into allowed_tools"
        );
    }

    #[tokio::test]
    async fn test_acp_add_and_resolve_request() {
        let handler = AcpPermissionHandler::new(PermissionMode::AlwaysAsk);

        let entry = AcpPermissionEntry {
            request_id: "req-123".to_string(),
            tool_name: "bash".to_string(),
            input: None,
            options: vec![],
            created_at: 1234567890,
        };

        handler.add_request(entry).await;
        let pending = handler.get_pending().await;
        assert_eq!(pending.len(), 1);

        handler
            .resolve("req-123", true, Some(ApprovalDecision::Approved), None)
            .await
            .unwrap();

        let pending = handler.get_pending().await;
        assert_eq!(pending.len(), 0);

        let completed = handler.get_completed().await;
        assert_eq!(completed.len(), 1);
    }
}
