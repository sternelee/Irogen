//! Claude Code streaming JSON implementation
#![allow(dead_code)]
//!
//! Handles Claude Code CLI execution via `claude -p` (print mode) with
//! streaming JSON output based on CodeMoss patterns.

use riterm_shared::message_protocol::AgentType;
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{RwLock, broadcast};
use tracing::{debug, error, info, warn};

use super::StreamingAgentSession;
use super::events::{AgentEvent, AgentTurnEvent, PermissionMode};
use super::session::{
    AgentConfig, AgentProcessState, extract_string_field, extract_tool_result_text,
};

/// Claude streaming session for a workspace
pub struct ClaudeStreamingSession {
    /// Session identifier
    session_id: String,
    /// Workspace directory path
    workspace_path: PathBuf,
    /// Process state management
    process_state: Arc<AgentProcessState>,
    /// Custom binary path
    bin_path: Option<String>,
    /// Custom home directory
    home_dir: Option<String>,
    /// Additional CLI arguments
    custom_args: Option<String>,
    /// Permission mode
    permission_mode: PermissionMode,
    /// Current Claude session ID (for --resume)
    claude_session_id: RwLock<Option<String>>,
}

impl ClaudeStreamingSession {
    /// Create a new Claude streaming session
    pub fn new(session_id: String, workspace_path: PathBuf, config: Option<AgentConfig>) -> Self {
        let config = config.unwrap_or_default();
        let process_state = Arc::new(AgentProcessState::new(session_id.clone()));

        Self {
            session_id,
            workspace_path,
            process_state,
            bin_path: config.bin_path,
            home_dir: config.home_dir,
            custom_args: config.custom_args,
            permission_mode: config.permission_mode,
            claude_session_id: RwLock::new(None),
        }
    }

    /// Get a receiver for agent events
    pub fn subscribe(&self) -> broadcast::Receiver<AgentTurnEvent> {
        let receiver = self.process_state.event_sender.subscribe();
        tracing::info!(
            "[claude_streaming] New subscriber created for session {}",
            self.session_id
        );
        receiver
    }

    /// Get current Claude session ID
    pub async fn get_claude_session_id(&self) -> Option<String> {
        self.claude_session_id.read().await.clone()
    }

    /// Set Claude session ID (after successful execution)
    pub async fn set_claude_session_id(&self, id: Option<String>) {
        *self.claude_session_id.write().await = id;
    }

    /// Build the Claude CLI command
    fn build_command(&self, text: &str, has_images: bool) -> Command {
        // Use custom bin_path or fall back to "claude"
        let bin = self
            .bin_path
            .clone()
            .unwrap_or_else(|| "claude".to_string());

        let mut cmd = Command::new(&bin);

        // Set working directory
        cmd.current_dir(&self.workspace_path);

        // Print mode (non-interactive)
        cmd.arg("-p");

        if has_images {
            // When images are present, use stream-json input format
            cmd.arg(""); // Empty string as placeholder, real content via stdin
            cmd.arg("--input-format");
            cmd.arg("stream-json");
        } else {
            // Text-only mode
            cmd.arg(text);
        }

        // Output format for streaming
        cmd.arg("--output-format");
        cmd.arg("stream-json");

        // Verbose for more events
        cmd.arg("--verbose");

        // Include partial messages for streaming text
        cmd.arg("--include-partial-messages");

        // Permission mode
        match self.permission_mode {
            PermissionMode::AutoApprove => {
                cmd.arg("--dangerously-skip-permissions");
            }
            PermissionMode::Plan => {
                cmd.arg("--permission-mode");
                cmd.arg("plan");
            }
            PermissionMode::AcceptEdits | PermissionMode::AlwaysAsk => {
                cmd.arg("--permission-mode");
                cmd.arg("acceptEdits");
            }
        }

        // Custom arguments
        if let Some(ref args) = self.custom_args {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }

        // Set up stdio
        if has_images {
            cmd.stdin(Stdio::piped()); // Enable stdin for image data
        } else {
            cmd.stdin(Stdio::null());
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Environment
        if let Some(ref home) = self.home_dir {
            cmd.env("CLAUDE_HOME", home);
        }

        cmd
    }

    /// Send a message and stream the response
    pub async fn send_message(&self, text: String, turn_id: &str) -> Result<(), String> {
        info!(
            "[claude_streaming] send_message called: session={}, turn={}, text={}",
            self.session_id, turn_id, text
        );

        // Reset cumulative text tracker for the new turn
        self.process_state.reset_text_tracker();

        // For now, we don't support images in the initial implementation
        let has_images = false;
        let mut cmd = self.build_command(&text, has_images);

        // Debug: log the command being executed
        debug!("[claude_streaming] Command: {:?}", cmd);

        // Spawn the process
        let mut child = cmd.spawn().map_err(|e| {
            error!("[claude_streaming] Failed to spawn claude: {}", e);
            format!("Failed to spawn claude: {}", e)
        })?;

        info!(
            "[claude_streaming] Process spawned successfully for turn {}",
            turn_id
        );

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr".to_string())?;

        // Store child for interruption (per turn)
        self.process_state
            .register_process(turn_id.to_string(), child)
            .await;

        // Emit session started event
        self.process_state.emit_event(
            turn_id,
            AgentEvent::SessionStarted {
                session_id: self.session_id.clone(),
                agent: AgentType::ClaudeCode,
            },
        );

        // Emit turn started event
        self.process_state.emit_event(
            turn_id,
            AgentEvent::TurnStarted {
                session_id: self.session_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        // Read stdout line by line
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut error_output = String::new();

        // Spawn stderr reader
        let stderr_reader = BufReader::new(stderr);
        let session_id_clone = self.session_id.clone();
        let stderr_handle = tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            let mut stderr_text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                stderr_text.push_str(&line);
                stderr_text.push('\n');
            }
            (session_id_clone, stderr_text)
        });

        // Process stdout events
        let mut session_id_emitted = false;
        let mut line_count = 0;
        while let Ok(Some(line)) = lines.next_line().await {
            line_count += 1;
            if line.trim().is_empty() {
                continue;
            }

            info!(
                "[claude_streaming] Received line {}: {}",
                line_count,
                line.chars().take(200).collect::<String>()
            );

            match serde_json::from_str::<Value>(&line) {
                Ok(event) => {
                    // Extract session ID if present
                    let sid = event
                        .get("session_id")
                        .or_else(|| event.get("sessionId"))
                        .and_then(|v| v.as_str());
                    if let Some(sid) = sid {
                        if !sid.is_empty() && sid != "pending" && !session_id_emitted {
                            self.set_claude_session_id(Some(sid.to_string())).await;
                            session_id_emitted = true;
                            // Emit SessionStarted with real session_id
                            self.process_state.emit_event(
                                turn_id,
                                AgentEvent::SessionStarted {
                                    session_id: self.session_id.clone(),
                                    agent: AgentType::ClaudeCode,
                                },
                            );
                        }
                    }

                    // Convert and emit event
                    if let Some(unified_event) = self.convert_event(turn_id, &event) {
                        info!("[claude_streaming] Emitting event: {:?}", unified_event);
                        self.process_state.emit_event(turn_id, unified_event);
                    }
                }
                Err(e) => {
                    // Non-JSON output, might be error
                    warn!(
                        "[claude_streaming] Failed to parse JSON: {} - line: {}",
                        e,
                        &line[..line.len().min(100)]
                    );
                    error_output.push_str(&line);
                    error_output.push('\n');
                }
            }
        }

        info!(
            "[claude_streaming] stdout processing complete, {} lines read",
            line_count
        );

        // Wait for process to complete
        let child = self.process_state.remove_process(turn_id).await;
        let status = if let Some(mut child_proc) = child {
            child_proc.wait().await.ok()
        } else {
            None
        };

        // Get stderr
        let (_, stderr_text) = stderr_handle
            .await
            .unwrap_or((String::new(), String::new()));
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }

        // Check for errors
        if let Some(status) = status {
            if !status.success() {
                let error_msg = if !error_output.is_empty() {
                    error_output.trim().to_string()
                } else {
                    format!("Claude exited with status: {}", status)
                };

                error!("Claude process failed: {}", error_msg);

                self.process_state.emit_event(
                    turn_id,
                    AgentEvent::TurnError {
                        session_id: self.session_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );

                return Err(error_msg);
            }
        } else {
            // Process handle was taken by interrupt() or missing
            let was_interrupted = self.process_state.is_interrupted();
            if was_interrupted {
                info!("Turn {} was interrupted by user", turn_id);
                self.process_state.emit_event(
                    turn_id,
                    AgentEvent::TurnError {
                        session_id: self.session_id.clone(),
                        error: "Session stopped.".to_string(),
                        code: None,
                    },
                );
                return Err("Session stopped.".to_string());
            }
        }

        // Emit turn completed
        self.process_state.emit_event(
            turn_id,
            AgentEvent::TurnCompleted {
                session_id: self.session_id.clone(),
                result: None,
            },
        );

        Ok(())
    }

    /// Interrupt the current operation
    pub async fn interrupt(&self) -> Result<(), String> {
        self.process_state.kill_all_processes().await
    }

    /// Respond to a permission request
    pub async fn respond_to_permission(
        &self,
        request_id: &str,
        approved: bool,
        reason: Option<String>,
    ) -> Result<(), String> {
        // Remove the pending permission
        let permission = self
            .process_state
            .remove_pending_permission(request_id)
            .await;

        if let Some(permission) = permission {
            // If there's a response channel, send the response
            if let Some(tx) = permission.response_tx {
                let response = super::events::PermissionResponse { approved, reason };
                let _ = tx.send(response);
            }

            info!(
                "Permission response sent: {} approved={}",
                request_id, approved
            );

            Ok(())
        } else {
            Err(format!("Permission request not found: {}", request_id))
        }
    }

    /// Get all pending permission requests
    pub async fn get_pending_permissions(&self) -> Vec<super::events::PendingPermission> {
        self.process_state.get_pending_permissions().await
    }

    /// Convert Claude event to unified format
    /// Handles Claude CLI 2.0.52+ event format: system, assistant, result, error
    fn convert_event(&self, turn_id: &str, event: &Value) -> Option<AgentEvent> {
        debug!(
            "[claude] Received event: {}",
            serde_json::to_string_pretty(event).unwrap_or_else(|_| event.to_string())
        );

        // Check for context_window field in ANY event (Claude statusline/hooks)
        self.try_extract_context_window_usage(turn_id, event);

        let event_type = event.get("type")?.as_str()?;

        match event_type {
            // Legacy stream_event format (kept for backward compatibility)
            "stream_event" => self.convert_stream_event(event),

            // Claude CLI 2.0.52+ format: system init event
            "system" => {
                if let Some(sid) = event
                    .get("session_id")
                    .or_else(|| event.get("sessionId"))
                    .and_then(|v| v.as_str())
                {
                    if !sid.is_empty() && sid != "pending" {
                        return Some(AgentEvent::SessionStarted {
                            session_id: self.session_id.clone(),
                            agent: AgentType::ClaudeCode,
                        });
                    }
                }
                None
            }

            // Claude CLI 2.0.52+ format: assistant message event
            "assistant" => {
                if let Some(message) = event.get("message") {
                    if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                        for block in content {
                            let block_type = block.get("type").and_then(|t| t.as_str());
                            match block_type {
                                Some("text") => {
                                    if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                        // Compute delta to avoid sending full text on every update
                                        let delta = self.process_state.compute_text_delta(text);
                                        if delta.is_empty() {
                                            return None;
                                        }
                                        return Some(AgentEvent::TextDelta {
                                            session_id: self.session_id.clone(),
                                            text: delta,
                                        });
                                    }
                                }
                                Some("tool_use") => {
                                    return self.convert_tool_use(block);
                                }
                                Some("tool_result") => {
                                    return self.convert_tool_result(block);
                                }
                                Some("thinking") => {
                                    if let Some(text) =
                                        block.get("thinking").and_then(|t| t.as_str())
                                    {
                                        return Some(AgentEvent::ReasoningDelta {
                                            session_id: self.session_id.clone(),
                                            text: text.to_string(),
                                        });
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                None
            }

            // Claude CLI 2.0.52+ format: final result event
            "result" => Some(AgentEvent::TurnCompleted {
                session_id: self.session_id.clone(),
                result: Some(event.clone()),
            }),

            "error" => {
                let message = event
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .or_else(|| event.get("message").and_then(|m| m.as_str()))
                    .unwrap_or("Unknown error");
                Some(AgentEvent::TurnError {
                    session_id: self.session_id.clone(),
                    error: message.to_string(),
                    code: event
                        .get("error")
                        .and_then(|e| e.get("code"))
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string()),
                })
            }

            "tool_use" => self.convert_tool_use(event),
            "tool_result" => self.convert_tool_result(event),

            // Permission request from Claude (when using --permission-mode acceptEdits)
            "permission_request" => self.convert_permission_request(event),

            _ => {
                // Check if this is a raw permission prompt in the output
                // Claude sometimes sends permission prompts as plain text
                if let Some(message) = event.get("message").and_then(|m| m.as_str()) {
                    if message.contains("Allow")
                        || message.contains("Confirm")
                        || message.contains("Proceed")
                    {
                        return self.extract_permission_from_text(message);
                    }
                }

                // Pass through as raw event
                Some(AgentEvent::Raw {
                    session_id: self.session_id.clone(),
                    agent: AgentType::ClaudeCode,
                    data: event.clone(),
                })
            }
        }
    }

    /// Convert permission_request event to ApprovalRequest event
    fn convert_permission_request(&self, event: &Value) -> Option<AgentEvent> {
        let request_id = event
            .get("request_id")
            .or_else(|| event.get("requestId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let tool_name = event
            .get("tool_name")
            .or_else(|| event.get("toolName"))
            .or_else(|| event.get("tool"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let input = event.get("input").or_else(|| event.get("params")).cloned();

        let message = event
            .get("message")
            .or_else(|| event.get("description"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Register the pending permission synchronously (using blocking lock)
        // This is safe because we're just inserting into a HashMap
        if let Ok(mut pending) = self.process_state.pending_permissions.try_write() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            pending.insert(
                request_id.clone(),
                super::events::PendingPermission {
                    request_id: request_id.clone(),
                    session_id: self.session_id.clone(),
                    tool_name: tool_name.clone(),
                    tool_params: input.clone().unwrap_or(serde_json::Value::Null),
                    message: message.clone(),
                    created_at: now,
                    response_tx: None,
                },
            );
        }

        Some(AgentEvent::ApprovalRequest {
            session_id: self.session_id.clone(),
            request_id,
            tool_name,
            input,
            message,
        })
    }

    /// Extract permission request from text output (fallback for legacy format)
    fn extract_permission_from_text(&self, text: &str) -> Option<AgentEvent> {
        // Try to extract tool name from permission prompt text
        let tool_name = if text.contains("edit") || text.contains("Edit") {
            "edit"
        } else if text.contains("bash") || text.contains("command") {
            "bash"
        } else if text.contains("write") || text.contains("Write") {
            "write"
        } else if text.contains("read") || text.contains("Read") {
            "read"
        } else {
            "unknown"
        };

        let request_id = uuid::Uuid::new_v4().to_string();

        // Register the pending permission synchronously
        if let Ok(mut pending) = self.process_state.pending_permissions.try_write() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            pending.insert(
                request_id.clone(),
                super::events::PendingPermission {
                    request_id: request_id.clone(),
                    session_id: self.session_id.clone(),
                    tool_name: tool_name.to_string(),
                    tool_params: serde_json::Value::Null,
                    message: Some(text.to_string()),
                    created_at: now,
                    response_tx: None,
                },
            );
        }

        Some(AgentEvent::ApprovalRequest {
            session_id: self.session_id.clone(),
            request_id,
            tool_name: tool_name.to_string(),
            input: None,
            message: Some(text.to_string()),
        })
    }

    /// Convert tool_use block to event
    fn convert_tool_use(&self, block: &Value) -> Option<AgentEvent> {
        let tool_name = block
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("unknown");
        let index = block.get("index").and_then(|v| v.as_i64());
        let tool_id = self
            .resolve_tool_use_id(block, index)
            .unwrap_or_else(|| "unknown".to_string());
        let input = block.get("input").cloned();

        if let Some(index) = index {
            self.process_state.cache_tool_block_index(index, &tool_id);
        }
        self.process_state.cache_tool_name(&tool_id, tool_name);

        Some(AgentEvent::ToolStarted {
            session_id: self.session_id.clone(),
            tool_id: tool_id.to_string(),
            tool_name: tool_name.to_string(),
            input,
        })
    }

    /// Convert tool_result block to event
    fn convert_tool_result(&self, block: &Value) -> Option<AgentEvent> {
        let index = block.get("index").and_then(|v| v.as_i64());
        let tool_id = self
            .resolve_tool_result_id(block, index)
            .unwrap_or_default();

        if tool_id.is_empty() {
            return None;
        }

        let content = block.get("content");
        let is_error = block
            .get("is_error")
            .or_else(|| block.get("isError"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let output = content.and_then(extract_tool_result_text);
        let result = self.build_tool_completed(&tool_id, output, is_error);

        self.process_state.clear_tool_block_index(index);
        result
    }

    /// Convert stream_event type (legacy format)
    fn convert_stream_event(&self, event: &Value) -> Option<AgentEvent> {
        let inner = event.get("event")?;
        let inner_type = inner.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if inner_type == "content_block_start" {
            if let Some(block) = inner.get("content_block") {
                let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match block_type {
                    "tool_use" => {
                        return self.convert_tool_use(block);
                    }
                    "tool_result" => {
                        return self.convert_tool_result(block);
                    }
                    _ => {}
                }
            }
        }

        if inner_type == "content_block_delta" {
            let delta = inner.get("delta");
            let delta_type = delta
                .and_then(|d| d.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("");

            if delta_type == "input_json_delta" {
                let partial = delta
                    .and_then(|d| d.get("partial_json"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let index = inner.get("index").and_then(|v| v.as_i64());
                if let Some(tool_id) = self.process_state.tool_id_for_block_index(index) {
                    if let Some(input) = self.process_state.append_tool_input(&tool_id, partial) {
                        let tool_name = self.process_state.peek_tool_name(&tool_id);
                        return Some(AgentEvent::ToolInputUpdated {
                            session_id: self.session_id.clone(),
                            tool_id,
                            tool_name,
                            input: Some(input),
                        });
                    }
                }
            }
        }

        let delta = inner.get("delta");
        let delta_type = delta
            .and_then(|d| d.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("");

        match delta_type {
            "text_delta" => {
                let text = delta?.get("text")?.as_str()?;
                Some(AgentEvent::TextDelta {
                    session_id: self.session_id.clone(),
                    text: text.to_string(),
                })
            }
            "thinking_delta" => {
                let text = delta?.get("thinking")?.as_str()?;
                Some(AgentEvent::ReasoningDelta {
                    session_id: self.session_id.clone(),
                    text: text.to_string(),
                })
            }
            _ => None,
        }
    }

    /// Try to extract context window usage from any event
    fn try_extract_context_window_usage(&self, turn_id: &str, event: &Value) {
        let (usage, model_context_window) = self.find_usage_data(event);

        if let Some(usage) = usage {
            let input_tokens = usage
                .get("input_tokens")
                .or_else(|| usage.get("inputTokens"))
                .and_then(|v| v.as_i64());

            let output_tokens = usage
                .get("output_tokens")
                .or_else(|| usage.get("outputTokens"))
                .and_then(|v| v.as_i64());

            let cache_creation = usage
                .get("cache_creation_input_tokens")
                .or_else(|| usage.get("cacheCreationInputTokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let cache_read = usage
                .get("cache_read_input_tokens")
                .or_else(|| usage.get("cacheReadInputTokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let cached_tokens = if cache_creation > 0 || cache_read > 0 {
                Some(cache_creation + cache_read)
            } else {
                None
            };

            if input_tokens.is_some() {
                debug!(
                    "[claude] Emitting UsageUpdate: input={:?}, output={:?}, cached={:?}, window={:?}",
                    input_tokens, output_tokens, cached_tokens, model_context_window
                );
                self.process_state.emit_event(
                    turn_id,
                    AgentEvent::UsageUpdate {
                        session_id: self.session_id.clone(),
                        input_tokens,
                        output_tokens,
                        cached_tokens,
                        model_context_window,
                    },
                );
            }
        }
    }

    /// Find usage data from various locations in the event
    fn find_usage_data<'a>(&self, event: &'a Value) -> (Option<&'a Value>, Option<i64>) {
        // 1. First priority: context_window.current_usage
        if let Some(context_window) = event.get("context_window") {
            let model_context_window = context_window
                .get("context_window_size")
                .or_else(|| context_window.get("contextWindowSize"))
                .and_then(|v| v.as_i64());

            if let Some(current_usage) = context_window
                .get("current_usage")
                .or_else(|| context_window.get("currentUsage"))
            {
                return (Some(current_usage), model_context_window);
            }
        }

        // 2. Second priority: message.usage
        if let Some(message) = event.get("message") {
            if let Some(usage) = message.get("usage") {
                return (Some(usage), None);
            }
        }

        // 3. Third priority: top-level usage field
        if let Some(usage) = event.get("usage") {
            return (Some(usage), None);
        }

        (None, None)
    }

    fn resolve_tool_use_id(&self, block: &Value, index: Option<i64>) -> Option<String> {
        if let Some(id) = extract_string_field(
            block,
            &[
                "id",
                "tool_use_id",
                "toolUseId",
                "tool_useId",
                "toolId",
                "tool_id",
            ],
        ) {
            return Some(id);
        }
        index.map(|value| format!("tool-block-{}", value))
    }

    fn resolve_tool_result_id(&self, block: &Value, index: Option<i64>) -> Option<String> {
        if let Some(id) = extract_string_field(
            block,
            &["tool_use_id", "toolUseId", "tool_useId", "toolUseID"],
        ) {
            return Some(id);
        }
        if let Some(mapped) = self.process_state.tool_id_for_block_index(index) {
            return Some(mapped);
        }
        extract_string_field(block, &["tool_id", "toolId", "id"])
    }

    fn build_tool_completed(
        &self,
        tool_id: &str,
        output: Option<String>,
        is_error: bool,
    ) -> Option<AgentEvent> {
        if tool_id.is_empty() {
            return None;
        }
        let tool_name = self.process_state.take_tool_name(tool_id);
        self.process_state.clear_tool_input(tool_id);

        let error = if is_error {
            output.clone().filter(|text| !text.trim().is_empty())
        } else {
            None
        };
        let output = if is_error {
            None
        } else {
            output.map(Value::String)
        };

        Some(AgentEvent::ToolCompleted {
            session_id: self.session_id.clone(),
            tool_id: tool_id.to_string(),
            tool_name,
            output,
            error,
        })
    }
}

#[async_trait::async_trait]
impl StreamingAgentSession for ClaudeStreamingSession {
    fn session_id(&self) -> &str {
        &self.session_id
    }

    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentTurnEvent> {
        self.subscribe()
    }

    async fn send_message(&self, text: String, turn_id: &str) -> Result<(), String> {
        self.send_message(text, turn_id).await
    }

    async fn interrupt(&self) -> Result<(), String> {
        self.interrupt().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_creation() {
        let session = ClaudeStreamingSession::new(
            "test-session".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        assert_eq!(session.session_id(), "test-session");
        assert_eq!(session.agent_type(), AgentType::ClaudeCode);
    }
}
