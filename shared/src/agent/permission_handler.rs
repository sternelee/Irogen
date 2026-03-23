//! Permission handler for agent tool approval workflow.
//!
//! This module provides a unified permission management system that:
//! - Handles pending permission requests
//! - Implements auto-approval logic based on permission mode
//! - Manages session-level allowed tools
//! - Resolves permission requests with appropriate outcomes
//!
//! # Example
//!
//! ```no_run
//! use crate::agent::{PermissionHandler, PermissionMode, ApprovalDecision};
//!
//! let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);
//!
//! // Check if a tool should be auto-approved
//! if let Some(decision) = handler.should_auto_approve("read_file") {
//!     // Tool is auto-approved
//! }
//!
//! // Add a pending permission request
//! handler.add_request(PendingPermissionEntry { ... });
//!
//! // Resolve a request
//! handler.resolve("req-123", true, ApprovalDecision::Approved);
//! ```

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tracing::debug;

/// Semantic tool kind for improved permission decisions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolKind {
    /// Read operations (file read, search, grep)
    Read,
    /// Search operations (find, glob, search in files)
    Search,
    /// Edit operations (file write, patch, create)
    Edit,
    /// Delete operations (file delete, directory remove)
    Delete,
    /// Move/rename operations
    Move,
    /// Execute operations (bash, shell commands)
    Execute,
    /// Fetch operations (web fetch, API calls)
    Fetch,
    /// Think/reasoning operations (no side effects)
    Think,
    /// Other operations (uncategorized)
    Other,
}

impl Default for ToolKind {
    fn default() -> Self {
        Self::Other
    }
}

/// Infer tool kind from tool name and title
///
/// Uses semantic analysis to categorize tools for better permission decisions.
/// The title (from ACP tool_call.title) provides more context than the tool name.
pub fn infer_tool_kind(tool_name: &str, tool_title: Option<&str>) -> ToolKind {
    let lower_name = tool_name.to_lowercase();

    // Use title if available (more descriptive)
    if let Some(title) = tool_title {
        let lower_title = title.to_lowercase();

        // Think/reasoning tools - always auto-approved
        if lower_title.contains("reasoning")
            || lower_title.contains("think")
            || lower_title.contains("planning")
        {
            return ToolKind::Think;
        }

        // Read operations
        if lower_title.contains("read file")
            || lower_title.contains("view file")
            || lower_title.contains("cat")
            || lower_title.contains("get file")
        {
            return ToolKind::Read;
        }

        // Search operations
        if lower_title.contains("search")
            || lower_title.contains("find")
            || lower_title.contains("grep")
            || lower_title.contains("glob")
            || lower_title.contains("list file")
        {
            return ToolKind::Search;
        }

        // Edit operations
        if lower_title.contains("write file")
            || lower_title.contains("edit file")
            || lower_title.contains("patch")
            || lower_title.contains("create file")
            || lower_title.contains("modify")
        {
            return ToolKind::Edit;
        }

        // Delete operations
        if lower_title.contains("delete")
            || lower_title.contains("remove")
            || lower_title.contains("unlink")
        {
            return ToolKind::Delete;
        }

        // Move operations
        if lower_title.contains("move")
            || lower_title.contains("rename")
            || lower_title.contains("copy")
        {
            return ToolKind::Move;
        }

        // Execute operations
        if lower_title.contains("bash")
            || lower_title.contains("shell")
            || lower_title.contains("execute")
            || lower_title.contains("run command")
        {
            return ToolKind::Execute;
        }

        // Fetch operations
        if lower_title.contains("fetch")
            || lower_title.contains("http")
            || lower_title.contains("request")
            || lower_title.contains("download")
        {
            return ToolKind::Fetch;
        }
    }

    // Fallback to tool name patterns
    if lower_name.contains("read")
        || lower_name.contains("cat")
        || lower_name.contains("view")
        || lower_name.contains("get")
    {
        return ToolKind::Read;
    }

    if lower_name.contains("search")
        || lower_name.contains("find")
        || lower_name.contains("grep")
        || lower_name.contains("glob")
        || lower_name.contains("list")
    {
        return ToolKind::Search;
    }

    if lower_name.contains("write")
        || lower_name.contains("edit")
        || lower_name.contains("patch")
        || lower_name.contains("create")
    {
        return ToolKind::Edit;
    }

    if lower_name.contains("delete") || lower_name.contains("remove") {
        return ToolKind::Delete;
    }

    if lower_name.contains("move") || lower_name.contains("rename") {
        return ToolKind::Move;
    }

    if lower_name.contains("bash")
        || lower_name.contains("shell")
        || lower_name.contains("exec")
        || lower_name.contains("run")
    {
        return ToolKind::Execute;
    }

    if lower_name.contains("fetch")
        || lower_name.contains("http")
        || lower_name.contains("download")
    {
        return ToolKind::Fetch;
    }

    if lower_name.contains("think") || lower_name.contains("reason") || lower_name.contains("plan")
    {
        return ToolKind::Think;
    }

    ToolKind::Other
}

/// Permission mode for tool approval workflow
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    /// Always ask for permission (default)
    AlwaysAsk,
    /// Auto-approve file edits, ask for shell commands
    AcceptEdits,
    /// Auto-approve everything (dangerous)
    AutoApprove,
    /// Plan mode - read-only, approve reads automatically
    Plan,
}

impl Default for PermissionMode {
    fn default() -> Self {
        Self::AlwaysAsk
    }
}

/// Approval decision when resolving a permission request
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    /// Approve this tool call once
    Approved,
    /// Approve this tool for the entire session
    ApprovedForSession,
    /// Abort the current operation and stop
    Abort,
}

/// Permission status tracking
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionStatus {
    /// Request is pending user approval
    Pending,
    /// Request was approved
    Approved,
    /// Request was denied
    Denied,
    /// Request was canceled
    Canceled,
}

/// Auto-approval decision with context
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoApprovalDecision {
    pub decision: ApprovalDecision,
    pub mode: Option<PermissionMode>,
}

/// Pending permission request entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionEntry {
    pub request_id: String,
    pub tool_name: String,
    pub input: Option<serde_json::Value>,
    pub options: Vec<String>,
    pub created_at: u64,
}

impl PendingPermissionEntry {
    pub fn new(
        request_id: String,
        tool_name: String,
        input: Option<serde_json::Value>,
        options: Vec<String>,
    ) -> Self {
        Self {
            request_id,
            tool_name,
            input,
            options,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }
    }
}

/// Completed permission request entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedPermissionEntry {
    pub request_id: String,
    pub tool_name: String,
    pub input: Option<serde_json::Value>,
    pub status: PermissionStatus,
    pub decision: Option<ApprovalDecision>,
    pub reason: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub created_at: u64,
    pub completed_at: u64,
}

impl CompletedPermissionEntry {
    pub fn from_pending(
        pending: PendingPermissionEntry,
        status: PermissionStatus,
        decision: Option<ApprovalDecision>,
        reason: Option<String>,
        allowed_tools: Option<Vec<String>>,
    ) -> Self {
        Self {
            request_id: pending.request_id,
            tool_name: pending.tool_name,
            input: pending.input,
            status,
            decision,
            reason,
            allowed_tools,
            created_at: pending.created_at,
            completed_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }
    }
}

/// Permission handler managing tool approval workflow
#[derive(Debug, Clone)]
pub struct PermissionHandler {
    mode: PermissionMode,
    allowed_tools: HashSet<String>,
    pending_requests: HashMap<String, PendingPermissionEntry>,
    completed_requests: HashMap<String, CompletedPermissionEntry>,
}

impl Default for PermissionHandler {
    fn default() -> Self {
        Self::new(PermissionMode::default())
    }
}

impl PermissionHandler {
    /// Create a new permission handler with the specified mode
    pub fn new(mode: PermissionMode) -> Self {
        Self {
            mode,
            allowed_tools: HashSet::new(),
            pending_requests: HashMap::new(),
            completed_requests: HashMap::new(),
        }
    }

    /// Get the current permission mode
    pub fn mode(&self) -> PermissionMode {
        self.mode
    }

    /// Set the permission mode
    pub fn set_mode(&mut self, mode: PermissionMode) {
        self.mode = mode;
    }

    /// Get the set of allowed tools for this session
    pub fn allowed_tools(&self) -> &HashSet<String> {
        &self.allowed_tools
    }

    /// Add a tool to the allowed set (for session-level approval)
    pub fn add_allowed_tool(&mut self, tool_name: String) {
        self.allowed_tools.insert(tool_name);
    }

    /// Add multiple tools to the allowed set
    pub fn add_allowed_tools(&mut self, tools: Vec<String>) {
        for tool in tools {
            self.allowed_tools.insert(tool);
        }
    }

    /// Check if a tool is in the allowed set
    pub fn is_tool_allowed(&self, tool_name: &str) -> bool {
        self.allowed_tools.contains(tool_name)
    }

    /// Get all pending permission requests
    pub fn pending_requests(&self) -> &HashMap<String, PendingPermissionEntry> {
        &self.pending_requests
    }

    /// Get all completed permission requests
    pub fn completed_requests(&self) -> &HashMap<String, CompletedPermissionEntry> {
        &self.completed_requests
    }

    /// Get a specific pending request by ID
    pub fn get_pending(&self, request_id: &str) -> Option<&PendingPermissionEntry> {
        self.pending_requests.get(request_id)
    }

    /// Check if a tool should be auto-approved based on mode and tool name
    ///
    /// Returns `Some(AutoApprovalDecision)` if auto-approved, `None` if manual approval needed
    pub fn should_auto_approve(
        &self,
        tool_name: &str,
        tool_call_id: &str,
    ) -> Option<AutoApprovalDecision> {
        self.should_auto_approve_with_title(tool_name, tool_call_id, None)
    }

    /// Check if a tool should be auto-approved with additional title context
    ///
    /// Returns `Some(AutoApprovalDecision)` if auto-approved, `None` if manual approval needed
    pub fn should_auto_approve_with_title(
        &self,
        tool_name: &str,
        tool_call_id: &str,
        tool_title: Option<&str>,
    ) -> Option<AutoApprovalDecision> {
        let lower_tool = tool_name.to_lowercase();
        let lower_id = tool_call_id.to_lowercase();

        // Check if tool is explicitly allowed for this session
        if self.is_tool_allowed(tool_name) {
            debug!("Tool '{}' is in allowed set, auto-approving", tool_name);
            return Some(AutoApprovalDecision {
                decision: ApprovalDecision::Approved,
                mode: Some(self.mode),
            });
        }

        // Always auto-approve certain tools regardless of mode
        if is_always_approved_tool(&lower_tool, &lower_id) {
            debug!("Tool '{}' is always-approved, auto-approving", tool_name);
            return Some(AutoApprovalDecision {
                decision: ApprovalDecision::Approved,
                mode: Some(self.mode),
            });
        }

        // Infer tool kind for semantic analysis
        let tool_kind = infer_tool_kind(tool_name, tool_title);
        debug!(
            "Tool '{}' inferred as kind {:?} (title: {:?})",
            tool_name, tool_kind, tool_title
        );

        // Mode-based auto-approval with semantic tool kind
        match self.mode {
            PermissionMode::AutoApprove => {
                debug!("Auto-approve mode: auto-approving '{}'", tool_name);
                Some(AutoApprovalDecision {
                    decision: ApprovalDecision::ApprovedForSession,
                    mode: Some(PermissionMode::AutoApprove),
                })
            }

            PermissionMode::AcceptEdits => {
                // Auto-approve file edit tools
                if is_edit_tool(&lower_tool) {
                    debug!("AcceptEdits mode: auto-approving edit tool '{}'", tool_name);
                    return Some(AutoApprovalDecision {
                        decision: ApprovalDecision::Approved,
                        mode: Some(PermissionMode::AcceptEdits),
                    });
                }
                // Also auto-approve read/search in AcceptEdits mode
                if matches!(
                    tool_kind,
                    ToolKind::Read | ToolKind::Search | ToolKind::Think
                ) {
                    debug!(
                        "AcceptEdits mode: auto-approving read/search/think tool '{}'",
                        tool_name
                    );
                    return Some(AutoApprovalDecision {
                        decision: ApprovalDecision::Approved,
                        mode: Some(PermissionMode::AcceptEdits),
                    });
                }
                None
            }

            PermissionMode::Plan => {
                // In plan mode, auto-approve read/search/think operations
                if matches!(
                    tool_kind,
                    ToolKind::Read | ToolKind::Search | ToolKind::Think
                ) {
                    debug!(
                        "Plan mode: auto-approving read/search/think tool '{}'",
                        tool_name
                    );
                    return Some(AutoApprovalDecision {
                        decision: ApprovalDecision::Approved,
                        mode: Some(PermissionMode::Plan),
                    });
                }
                // Also use legacy check for backwards compatibility
                if !is_write_tool(&lower_tool) {
                    debug!(
                        "Plan mode: auto-approving read tool '{}' (legacy)",
                        tool_name
                    );
                    return Some(AutoApprovalDecision {
                        decision: ApprovalDecision::Approved,
                        mode: Some(PermissionMode::Plan),
                    });
                }
                None
            }

            PermissionMode::AlwaysAsk => None,
        }
    }

    /// Add a pending permission request
    pub fn add_request(&mut self, entry: PendingPermissionEntry) {
        self.pending_requests
            .insert(entry.request_id.clone(), entry);
    }

    /// Resolve a permission request
    ///
    /// # Arguments
    ///
    /// * `request_id` - The ID of the request to resolve
    /// * `approved` - Whether the request was approved
    /// * `decision` - The approval decision (Approved, ApprovedForSession, or Abort)
    /// * `reason` - Optional reason for denial/cancellation
    /// * `allowed_tools` - Optional list of tools to allow for the session
    ///
    /// Returns `Ok(())` on success, `Err(String)` if request not found
    pub fn resolve(
        &mut self,
        request_id: &str,
        approved: bool,
        decision: Option<ApprovalDecision>,
        reason: Option<String>,
        allowed_tools: Option<Vec<String>>,
    ) -> Result<(), String> {
        let pending = self
            .pending_requests
            .remove(request_id)
            .ok_or_else(|| format!("Permission request '{}' not found", request_id))?;

        let status = if approved {
            PermissionStatus::Approved
        } else {
            PermissionStatus::Denied
        };

        // If ApprovedForSession, add to allowed tools
        if approved {
            if let Some(ApprovalDecision::ApprovedForSession) = decision {
                self.add_allowed_tool(pending.tool_name.clone());
                debug!("Added '{}' to session allowed tools", pending.tool_name);
            }

            // If explicit tool list provided, add all
            if let Some(ref tools) = allowed_tools {
                self.add_allowed_tools(tools.clone());
            }
        }

        let completed = CompletedPermissionEntry::from_pending(
            pending,
            status,
            decision,
            reason,
            allowed_tools,
        );

        self.completed_requests
            .insert(request_id.to_string(), completed);

        debug!(
            "Resolved permission request '{}' with status {:?}",
            request_id, status
        );

        Ok(())
    }

    /// Cancel all pending requests (e.g., when session is aborted)
    pub fn cancel_all(&mut self, reason: String) {
        for (request_id, pending) in self.pending_requests.drain() {
            let completed = CompletedPermissionEntry::from_pending(
                pending,
                PermissionStatus::Canceled,
                Some(ApprovalDecision::Abort),
                Some(reason.clone()),
                None,
            );
            self.completed_requests.insert(request_id, completed);
        }
        debug!("Canceled all pending permission requests");
    }

    /// Get permission state for export (for frontend sync)
    pub fn get_state(&self) -> PermissionHandlerState {
        PermissionHandlerState {
            mode: self.mode,
            allowed_tools: self.allowed_tools.iter().cloned().collect(),
            pending_requests: self.pending_requests.values().cloned().collect(),
            completed_requests: self.completed_requests.values().cloned().collect(),
        }
    }
}

/// Exportable state of the permission handler
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionHandlerState {
    pub mode: PermissionMode,
    pub allowed_tools: Vec<String>,
    pub pending_requests: Vec<PendingPermissionEntry>,
    pub completed_requests: Vec<CompletedPermissionEntry>,
}

/// Tools that are always auto-approved regardless of mode
const ALWAYS_APPROVED_TOOLS: &[&str] = &[
    "change_title",
    "happy__change_title",
    "hapi_change_title",
    "hapi__change_title",
    "geminireasoning",
    "codexreasoning",
    "think",
    "save_memory",
];

/// Tool name patterns for file edit operations
const EDIT_TOOL_PATTERNS: &[&str] = &["write", "edit", "create", "delete", "patch"];

/// Tool name patterns for write operations (dangerous)
const WRITE_TOOL_PATTERNS: &[&str] = &[
    "write", "edit", "create", "delete", "patch", "bash", "shell",
];

/// Check if a tool should always be auto-approved
fn is_always_approved_tool(tool_name: &str, tool_call_id: &str) -> bool {
    let lower_tool = tool_name.to_lowercase();
    let lower_id = tool_call_id.to_lowercase();

    ALWAYS_APPROVED_TOOLS
        .iter()
        .any(|pattern| lower_tool.contains(pattern) || lower_id.contains(pattern))
}

/// Check if a tool is a file edit tool
fn is_edit_tool(tool_name: &str) -> bool {
    EDIT_TOOL_PATTERNS
        .iter()
        .any(|pattern| tool_name.contains(pattern))
}

/// Check if a tool is a write operation (could be dangerous)
fn is_write_tool(tool_name: &str) -> bool {
    WRITE_TOOL_PATTERNS
        .iter()
        .any(|pattern| tool_name.contains(pattern))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_handler_creation() {
        let handler = PermissionHandler::new(PermissionMode::AlwaysAsk);
        assert_eq!(handler.mode(), PermissionMode::AlwaysAsk);
        assert!(handler.pending_requests().is_empty());
    }

    #[test]
    fn test_auto_approve_always_approved_tools() {
        let handler = PermissionHandler::new(PermissionMode::AlwaysAsk);

        assert!(
            handler
                .should_auto_approve("change_title", "tool-123")
                .is_some()
        );
        assert!(handler.should_auto_approve("think", "tool-456").is_some());
    }

    #[test]
    fn test_auto_approve_with_mode() {
        let handler = PermissionHandler::new(PermissionMode::AutoApprove);

        let decision = handler.should_auto_approve("bash", "tool-123");
        assert!(decision.is_some());
        assert_eq!(
            decision.unwrap().decision,
            ApprovalDecision::ApprovedForSession
        );
    }

    #[test]
    fn test_auto_approve_accept_edits() {
        let handler = PermissionHandler::new(PermissionMode::AcceptEdits);

        // Edit tools should be auto-approved
        assert!(
            handler
                .should_auto_approve("write_file", "tool-123")
                .is_some()
        );
        assert!(
            handler
                .should_auto_approve("edit_file", "tool-456")
                .is_some()
        );

        // Non-edit tools should require approval
        assert!(handler.should_auto_approve("bash", "tool-789").is_none());
    }

    #[test]
    fn test_auto_approve_plan_mode() {
        let handler = PermissionHandler::new(PermissionMode::Plan);

        // Read operations should be auto-approved
        assert!(
            handler
                .should_auto_approve("read_file", "tool-123")
                .is_some()
        );

        // Write operations should require approval
        assert!(
            handler
                .should_auto_approve("write_file", "tool-456")
                .is_none()
        );
    }

    #[test]
    fn test_allowed_tools() {
        let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);

        handler.add_allowed_tool("bash".to_string());
        assert!(handler.is_tool_allowed("bash"));
        assert!(!handler.is_tool_allowed("write_file"));

        handler.add_allowed_tools(vec!["write_file".to_string(), "edit".to_string()]);
        assert!(handler.is_tool_allowed("write_file"));
        assert!(handler.is_tool_allowed("edit"));
    }

    #[test]
    fn test_allowed_tools_override() {
        let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);

        handler.add_allowed_tool("bash".to_string());

        let decision = handler.should_auto_approve("bash", "tool-123");
        assert!(decision.is_some());
        assert_eq!(decision.unwrap().decision, ApprovalDecision::Approved);
    }

    #[test]
    fn test_add_and_resolve_request() {
        let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);

        let entry = PendingPermissionEntry::new(
            "req-123".to_string(),
            "bash".to_string(),
            Some(serde_json::json!({ "command": "ls" })),
            vec!["allow_once".to_string(), "reject_once".to_string()],
        );

        handler.add_request(entry);
        assert!(handler.get_pending("req-123").is_some());
        assert_eq!(handler.pending_requests().len(), 1);

        handler
            .resolve(
                "req-123",
                true,
                Some(ApprovalDecision::Approved),
                None,
                None,
            )
            .unwrap();

        assert!(handler.get_pending("req-123").is_none());
        assert_eq!(handler.pending_requests().len(), 0);
        assert_eq!(handler.completed_requests().len(), 1);
    }

    #[test]
    fn test_resolve_nonexistent_request() {
        let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);

        let result = handler.resolve("nonexistent", true, None, None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_approve_for_session() {
        let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);

        let entry =
            PendingPermissionEntry::new("req-123".to_string(), "bash".to_string(), None, vec![]);

        handler.add_request(entry);
        assert!(!handler.is_tool_allowed("bash"));

        handler
            .resolve(
                "req-123",
                true,
                Some(ApprovalDecision::ApprovedForSession),
                None,
                None,
            )
            .unwrap();

        assert!(handler.is_tool_allowed("bash"));
    }

    #[test]
    fn test_cancel_all() {
        let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);

        handler.add_request(PendingPermissionEntry::new(
            "req-1".to_string(),
            "bash".to_string(),
            None,
            vec![],
        ));
        handler.add_request(PendingPermissionEntry::new(
            "req-2".to_string(),
            "edit".to_string(),
            None,
            vec![],
        ));

        assert_eq!(handler.pending_requests().len(), 2);

        handler.cancel_all("Session aborted".to_string());

        assert_eq!(handler.pending_requests().len(), 0);
        assert_eq!(handler.completed_requests().len(), 2);

        let completed = handler.completed_requests().get("req-1").unwrap();
        assert_eq!(completed.status, PermissionStatus::Canceled);
        assert_eq!(completed.decision, Some(ApprovalDecision::Abort));
    }

    #[test]
    fn test_is_edit_tool() {
        assert!(is_edit_tool("write_file"));
        assert!(is_edit_tool("edit_file"));
        assert!(is_edit_tool("create_file"));
        assert!(is_edit_tool("delete_file"));
        assert!(!is_edit_tool("read_file"));
        assert!(!is_edit_tool("bash"));
    }

    #[test]
    fn test_is_write_tool() {
        assert!(is_write_tool("write_file"));
        assert!(is_write_tool("bash"));
        assert!(is_write_tool("shell"));
        assert!(is_write_tool("delete_file"));
        assert!(!is_write_tool("read_file"));
        assert!(!is_write_tool("search"));
    }

    #[test]
    fn test_infer_tool_kind_from_name() {
        assert_eq!(infer_tool_kind("read_file", None), ToolKind::Read);
        assert_eq!(infer_tool_kind("search_files", None), ToolKind::Search);
        assert_eq!(infer_tool_kind("write_file", None), ToolKind::Edit);
        assert_eq!(infer_tool_kind("edit_file", None), ToolKind::Edit);
        assert_eq!(infer_tool_kind("delete_file", None), ToolKind::Delete);
        assert_eq!(infer_tool_kind("bash", None), ToolKind::Execute);
        assert_eq!(infer_tool_kind("fetch_url", None), ToolKind::Fetch);
        assert_eq!(infer_tool_kind("think", None), ToolKind::Think);
    }

    #[test]
    fn test_infer_tool_kind_from_title() {
        assert_eq!(
            infer_tool_kind("tool", Some("Read file contents")),
            ToolKind::Read
        );
        assert_eq!(
            infer_tool_kind("tool", Some("Search for pattern")),
            ToolKind::Search
        );
        assert_eq!(
            infer_tool_kind("tool", Some("Write file")),
            ToolKind::Edit
        );
        assert_eq!(
            infer_tool_kind("tool", Some("Edit file content")),
            ToolKind::Edit
        );
        assert_eq!(
            infer_tool_kind("tool", Some("Execute bash command")),
            ToolKind::Execute
        );
        assert_eq!(
            infer_tool_kind("tool", Some("Think and reason")),
            ToolKind::Think
        );
    }

    #[test]
    fn test_plan_mode_with_tool_kind() {
        let handler = PermissionHandler::new(PermissionMode::Plan);

        // Read/search/think should be auto-approved
        assert!(
            handler
                .should_auto_approve_with_title("read_file", "tool-1", Some("Read file"))
                .is_some()
        );
        assert!(
            handler
                .should_auto_approve_with_title("grep", "tool-2", Some("Search pattern"))
                .is_some()
        );
        assert!(
            handler
                .should_auto_approve_with_title("think", "tool-3", Some("Reasoning"))
                .is_some()
        );

        // Edit/execute should require approval
        assert!(
            handler
                .should_auto_approve_with_title("write_file", "tool-4", Some("Write file"))
                .is_none()
        );
        assert!(
            handler
                .should_auto_approve_with_title("bash", "tool-5", Some("Run command"))
                .is_none()
        );
    }

    #[test]
    fn test_accept_edits_mode_with_tool_kind() {
        let handler = PermissionHandler::new(PermissionMode::AcceptEdits);

        // Edit/write should be auto-approved
        assert!(
            handler
                .should_auto_approve_with_title("write_file", "tool-1", Some("Write file"))
                .is_some()
        );

        // Read/search should also be auto-approved in AcceptEdits
        assert!(
            handler
                .should_auto_approve_with_title("read_file", "tool-2", Some("Read file"))
                .is_some()
        );

        // Execute should require approval
        assert!(
            handler
                .should_auto_approve_with_title("bash", "tool-3", Some("Run command"))
                .is_none()
        );
    }

    #[test]
    fn test_permission_mode_default() {
        let handler = PermissionHandler::default();
        assert_eq!(handler.mode(), PermissionMode::AlwaysAsk);
    }

    #[test]
    fn test_set_mode() {
        let mut handler = PermissionHandler::new(PermissionMode::AlwaysAsk);
        handler.set_mode(PermissionMode::AutoApprove);
        assert_eq!(handler.mode(), PermissionMode::AutoApprove);
    }

    #[test]
    fn test_get_state() {
        let mut handler = PermissionHandler::new(PermissionMode::AcceptEdits);

        handler.add_allowed_tool("bash".to_string());

        let entry =
            PendingPermissionEntry::new("req-123".to_string(), "bash".to_string(), None, vec![]);
        handler.add_request(entry);

        let state = handler.get_state();
        assert_eq!(state.mode, PermissionMode::AcceptEdits);
        assert_eq!(state.allowed_tools, vec!["bash"]);
        assert_eq!(state.pending_requests.len(), 1);
    }
}
