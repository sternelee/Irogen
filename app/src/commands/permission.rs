//! Permission management Tauri commands
//!
//! This module provides Tauri commands for managing tool approvals
//! in agent sessions.

use crate::agent_manager::AgentManagerWrapper;
use shared::agent::{ApprovalDecision, PermissionMode};
use tauri::State;
use tracing::{debug, info};

/// Set permission mode for a session
///
/// This command changes the approval mode for tools:
/// - `AlwaysAsk`: Ask for all tool approvals
/// - `AcceptEdits`: Auto-approve file edits, ask for other tools
/// - `AutoApprove`: Auto-approve all tools (dangerous)
/// - `Plan`: Read-only mode, approve reads automatically
#[tauri::command(rename_all = "camelCase")]
pub async fn set_permission_mode(
    session_id: String,
    mode: String,
    manager: State<'_, AgentManagerWrapper>,
) -> Result<(), String> {
    info!(
        "Setting permission mode for session {}: {}",
        session_id, mode
    );

    let _permission_mode = match mode.as_str() {
        "AlwaysAsk" => PermissionMode::AlwaysAsk,
        "AcceptEdits" => PermissionMode::AcceptEdits,
        "AutoApprove" => PermissionMode::AutoApprove,
        "Plan" => PermissionMode::Plan,
        _ => {
            return Err(format!("Invalid permission mode: {}", mode));
        }
    };

    // TODO: Integrate with AgentManager to set permission mode for the session
    debug!(
        "Permission mode set to {:?} for session {}",
        _permission_mode, session_id
    );

    Ok(())
}

/// Approve a pending permission request
///
/// # Arguments
///
/// * `session_id` - The session ID
/// * `request_id` - The permission request ID to approve
/// * `decision` - Optional approval decision:
///   - `Approved`: Approve this tool call once
///   - `ApprovedForSession`: Approve this tool for entire session
///   - `Abort`: Stop current operation
/// * `allowed_tools` - Optional list of tools to allow for session
#[tauri::command(rename_all = "camelCase")]
pub async fn approve_permission(
    session_id: String,
    request_id: String,
    decision: Option<String>,
    allowed_tools: Option<Vec<String>>,
    manager: State<'_, AgentManagerWrapper>,
) -> Result<(), String> {
    info!(
        "Approving permission {} for session {} with decision: {:?}",
        request_id, session_id, decision
    );

    let manager = manager.inner();

    let approve_for_session = decision.as_deref() == Some("ApprovedForSession");

    // Call the respond_to_permission method
    // Note: This is a stub implementation - needs integration with actual ACP session
    manager
        .respond_to_permission(&session_id, request_id.clone(), true, approve_for_session, None)
        .await
        .map_err(|e| {
            debug!("Failed to approve permission {}: {}", request_id, e);
            e
        })?;

    debug!("Permission {} approved (for session: {})", request_id, approve_for_session);

    if let Some(tools) = allowed_tools {
        debug!("Adding {} tools to session allowed list", tools.len());
    }

    Ok(())
}

/// Deny a pending permission request
///
/// # Arguments
///
/// * `session_id` - The session ID
/// * `request_id` - The permission request ID to deny
/// * `reason` - Optional reason for denial
#[tauri::command(rename_all = "camelCase")]
pub async fn deny_permission(
    session_id: String,
    request_id: String,
    reason: Option<String>,
    manager: State<'_, AgentManagerWrapper>,
) -> Result<(), String> {
    info!(
        "Denying permission {} for session {}: reason={:?}",
        request_id, session_id, reason
    );

    let manager = manager.inner();

    manager
        .respond_to_permission(&session_id, request_id.clone(), false, false, reason)
        .await
        .map_err(|e| {
            debug!("Failed to deny permission {}: {}", request_id, e);
            e
        })?;

    debug!("Permission {} denied", request_id);
    Ok(())
}
