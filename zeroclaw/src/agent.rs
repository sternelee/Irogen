//! Agent turn loop — core LLM tool-use cycle
//!
//! This module provides the agent turn loop: send messages to the LLM, parse tool calls,
//! execute tools, and loop until a final text response. Designed to be called by
//! `ZeroClawSession` in clawdchat's agent system.

use crate::memory::Memory;
use crate::providers::{ChatMessage, Provider};
use crate::tools::Tool;
use crate::util::truncate_with_ellipsis;
use anyhow::Result;
use std::fmt::Write;
use std::time::Instant;
use uuid::Uuid;

/// Maximum agentic tool-use iterations per user message to prevent runaway loops.
pub const MAX_TOOL_ITERATIONS: usize = 20;

/// Trigger auto-compaction when non-system message count exceeds this threshold.
pub const MAX_HISTORY_MESSAGES: usize = 50;

/// Keep this many most-recent non-system messages after compaction.
const COMPACTION_KEEP_RECENT_MESSAGES: usize = 20;

/// Safety cap for compaction source transcript passed to the summarizer.
const COMPACTION_MAX_SOURCE_CHARS: usize = 12_000;

/// Max characters retained in stored compaction summary.
const COMPACTION_MAX_SUMMARY_CHARS: usize = 2_000;

/// Callback trait for agent turn events (tool started, text produced, etc.)
/// Implement this to bridge zeroclaw events into clawdchat's AgentTurnEvent system.
pub trait TurnCallback: Send + Sync {
    fn on_text(&self, text: &str);
    fn on_tool_started(&self, tool_name: &str, tool_id: &str);
    fn on_tool_completed(&self, tool_name: &str, tool_id: &str, output: &str, success: bool);
    fn on_turn_completed(&self);
    fn on_turn_error(&self, error: &str);
}

/// No-op callback for testing
pub struct NoopCallback;
impl TurnCallback for NoopCallback {
    fn on_text(&self, _text: &str) {}
    fn on_tool_started(&self, _tool_name: &str, _tool_id: &str) {}
    fn on_tool_completed(&self, _tool_name: &str, _tool_id: &str, _output: &str, _success: bool) {}
    fn on_turn_completed(&self) {}
    fn on_turn_error(&self, _error: &str) {}
}

#[derive(Debug)]
struct ParsedToolCall {
    name: String,
    arguments: serde_json::Value,
}

fn parse_arguments_value(raw: Option<&serde_json::Value>) -> serde_json::Value {
    match raw {
        Some(serde_json::Value::String(s)) => serde_json::from_str::<serde_json::Value>(s)
            .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new())),
        Some(value) => value.clone(),
        None => serde_json::Value::Object(serde_json::Map::new()),
    }
}

fn parse_tool_call_value(value: &serde_json::Value) -> Option<ParsedToolCall> {
    if let Some(function) = value.get("function") {
        let name = function
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !name.is_empty() {
            let arguments = parse_arguments_value(function.get("arguments"));
            return Some(ParsedToolCall { name, arguments });
        }
    }

    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if name.is_empty() {
        return None;
    }

    let arguments = parse_arguments_value(value.get("arguments"));
    Some(ParsedToolCall { name, arguments })
}

fn parse_tool_calls_from_json_value(value: &serde_json::Value) -> Vec<ParsedToolCall> {
    let mut calls = Vec::new();

    if let Some(tool_calls) = value.get("tool_calls").and_then(|v| v.as_array()) {
        for call in tool_calls {
            if let Some(parsed) = parse_tool_call_value(call) {
                calls.push(parsed);
            }
        }
        if !calls.is_empty() {
            return calls;
        }
    }

    if let Some(array) = value.as_array() {
        for item in array {
            if let Some(parsed) = parse_tool_call_value(item) {
                calls.push(parsed);
            }
        }
        return calls;
    }

    if let Some(parsed) = parse_tool_call_value(value) {
        calls.push(parsed);
    }

    calls
}

fn extract_json_values(input: &str) -> Vec<serde_json::Value> {
    let mut values = Vec::new();
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return values;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        values.push(value);
        return values;
    }

    let char_positions: Vec<(usize, char)> = trimmed.char_indices().collect();
    let mut idx = 0;
    while idx < char_positions.len() {
        let (byte_idx, ch) = char_positions[idx];
        if ch == '{' || ch == '[' {
            let slice = &trimmed[byte_idx..];
            let mut stream =
                serde_json::Deserializer::from_str(slice).into_iter::<serde_json::Value>();
            if let Some(Ok(value)) = stream.next() {
                let consumed = stream.byte_offset();
                if consumed > 0 {
                    values.push(value);
                    let next_byte = byte_idx + consumed;
                    while idx < char_positions.len() && char_positions[idx].0 < next_byte {
                        idx += 1;
                    }
                    continue;
                }
            }
        }
        idx += 1;
    }

    values
}

/// Parse tool calls from an LLM response.
/// Returns (text, tool_calls).
pub fn parse_tool_calls(response: &str) -> (String, Vec<(String, serde_json::Value)>) {
    let mut text_parts = Vec::new();
    let mut calls = Vec::new();
    let mut remaining = response;

    // Try OpenAI-style JSON response with tool_calls array
    if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(response.trim()) {
        let parsed = parse_tool_calls_from_json_value(&json_value);
        if !parsed.is_empty() {
            if let Some(content) = json_value.get("content").and_then(|v| v.as_str()) {
                if !content.trim().is_empty() {
                    text_parts.push(content.trim().to_string());
                }
            }
            let out: Vec<(String, serde_json::Value)> =
                parsed.into_iter().map(|c| (c.name, c.arguments)).collect();
            return (text_parts.join("\n"), out);
        }
    }

    // Fall back to XML-style <tool_call> tag parsing
    while let Some(start) = remaining.find("<tool_call>") {
        let before = &remaining[..start];
        if !before.trim().is_empty() {
            text_parts.push(before.trim().to_string());
        }

        if let Some(end) = remaining[start..].find("</tool_call>") {
            let inner = &remaining[start + 11..start + end];
            let json_values = extract_json_values(inner);
            for value in json_values {
                let parsed = parse_tool_calls_from_json_value(&value);
                for c in parsed {
                    calls.push((c.name, c.arguments));
                }
            }
            remaining = &remaining[start + end + 12..];
        } else {
            break;
        }
    }

    // SECURITY: We do NOT fall back to extracting arbitrary JSON from the response
    // here. That would enable prompt injection attacks where malicious content
    // (e.g., in emails, files, or web pages) could include JSON that mimics a
    // tool call. Tool calls MUST be explicitly wrapped in either:
    // 1. OpenAI-style JSON with a "tool_calls" array
    // 2. ZeroClaw <invoke>...</invoke> tags
    // This ensures only the LLM's intentional tool calls are executed.

    if !remaining.trim().is_empty() {
        text_parts.push(remaining.trim().to_string());
    }

    (text_parts.join("\n"), calls)
}

/// Build a transcript from conversation messages for compaction.
fn build_compaction_transcript(messages: &[ChatMessage]) -> String {
    let mut transcript = String::new();
    for msg in messages {
        let role = msg.role.to_uppercase();
        let _ = writeln!(transcript, "{}: {}", role, msg.content.trim());
    }

    if transcript.chars().count() > COMPACTION_MAX_SOURCE_CHARS {
        truncate_with_ellipsis(&transcript, COMPACTION_MAX_SOURCE_CHARS)
    } else {
        transcript
    }
}

/// Apply a compaction summary to the history, replacing old messages with a summary.
fn apply_compaction_summary(
    history: &mut Vec<ChatMessage>,
    start: usize,
    compact_end: usize,
    summary: &str,
) {
    let summary_msg = ChatMessage::assistant(format!("[Compaction summary]\n{}", summary.trim()));
    history.splice(start..compact_end, std::iter::once(summary_msg));
}

/// Auto-compact conversation history when it grows too large.
///
/// This function summarizes older messages into a single context message,
/// preserving key information while reducing token usage.
pub async fn auto_compact_history(
    history: &mut Vec<ChatMessage>,
    provider: &dyn Provider,
    model: &str,
) -> anyhow::Result<bool> {
    let has_system = history.first().map_or(false, |m| m.role == "system");
    let non_system_count = if has_system {
        history.len().saturating_sub(1)
    } else {
        history.len()
    };

    if non_system_count <= MAX_HISTORY_MESSAGES {
        return Ok(false);
    }

    let start = if has_system { 1 } else { 0 };
    let keep_recent = COMPACTION_KEEP_RECENT_MESSAGES.min(non_system_count);
    let compact_count = non_system_count.saturating_sub(keep_recent);
    if compact_count == 0 {
        return Ok(false);
    }

    let compact_end = start + compact_count;
    let to_compact: Vec<ChatMessage> = history[start..compact_end].to_vec();
    let transcript = build_compaction_transcript(&to_compact);

    let summarizer_system = "You are a conversation compaction engine. Summarize older chat history into concise context for future turns. Preserve: user preferences, commitments, decisions, unresolved tasks, key facts. Omit: filler, repeated chit-chat, verbose tool logs. Output plain text bullet points only.";

    let summarizer_user = format!(
        "Summarize the following conversation history for context preservation. Keep it short (max 12 bullet points).\n\n{}",
        transcript
    );

    let summary_raw = provider
        .chat_with_system(Some(summarizer_system), &summarizer_user, model, 0.2)
        .await
        .unwrap_or_else(|_| {
            // Fallback to deterministic local truncation when summarization fails.
            truncate_with_ellipsis(&transcript, COMPACTION_MAX_SUMMARY_CHARS)
        });

    let summary = truncate_with_ellipsis(&summary_raw, COMPACTION_MAX_SUMMARY_CHARS);
    apply_compaction_summary(history, start, compact_end, &summary);

    Ok(true)
}

/// Trim conversation history to prevent unbounded growth.
pub fn trim_history(history: &mut Vec<ChatMessage>) {
    let has_system = history.first().is_some_and(|m| m.role == "system");
    let non_system_count = if has_system {
        history.len() - 1
    } else {
        history.len()
    };

    if non_system_count <= MAX_HISTORY_MESSAGES {
        return;
    }

    let start = if has_system { 1 } else { 0 };
    let to_remove = non_system_count - MAX_HISTORY_MESSAGES;
    history.drain(start..start + to_remove);
}

/// Build context preamble by searching memory for relevant entries
pub async fn build_context(mem: &dyn Memory, user_msg: &str) -> String {
    let mut context = String::new();

    if let Ok(entries) = mem.recall(user_msg, 5).await {
        if !entries.is_empty() {
            context.push_str("[Memory context]\n");
            for entry in &entries {
                let _ = writeln!(context, "- {}: {}", entry.key, entry.content);
            }
            context.push('\n');
        }
    }

    context
}

/// Build the tool instruction block for the system prompt.
pub fn build_tool_instructions(tools_registry: &[Box<dyn Tool>]) -> String {
    let mut instructions = String::new();
    instructions.push_str("\n## Tool Use Protocol\n\n");
    instructions.push_str("To use a tool, wrap a JSON object in <tool_call></tool_call> tags:\n\n");
    instructions.push_str(
        "```\n<tool_call>\n{\"name\": \"tool_name\", \"arguments\": {\"param\": \"value\"}}\n</tool_call>\n```\n\n",
    );
    instructions.push_str("You may use multiple tool calls in a single response. ");
    instructions.push_str("After tool execution, results appear in <tool_result> tags. ");
    instructions
        .push_str("Continue reasoning with the results until you can give a final answer.\n\n");
    instructions.push_str("### Available Tools\n\n");

    for tool in tools_registry {
        let _ = writeln!(
            instructions,
            "**{}**: {}\nParameters: `{}`\n",
            tool.name(),
            tool.description(),
            tool.parameters_schema()
        );
    }

    instructions
}

/// Find a tool by name in the registry.
fn find_tool<'a>(tools: &'a [Box<dyn Tool>], name: &str) -> Option<&'a dyn Tool> {
    tools.iter().find(|t| t.name() == name).map(|t| t.as_ref())
}

/// Execute a single turn of the agent loop: send messages, parse tool calls,
/// execute tools, and loop until the LLM produces a final text response.
///
/// Returns the final text response from the LLM.
pub async fn agent_turn(
    provider: &dyn Provider,
    history: &mut Vec<ChatMessage>,
    tools_registry: &[Box<dyn Tool>],
    callback: &dyn TurnCallback,
    model: &str,
    temperature: f64,
    max_iterations: usize,
) -> Result<String> {
    for _iteration in 0..max_iterations {
        let response = provider
            .chat_with_history(history, model, temperature)
            .await?;

        let (text, tool_calls) = parse_tool_calls(&response);

        if tool_calls.is_empty() {
            // No tool calls — this is the final response
            history.push(ChatMessage::assistant(&response));
            let final_text = if text.is_empty() { response } else { text };
            callback.on_text(&final_text);
            callback.on_turn_completed();

            // Auto-compaction before returning to preserve long-context signal
            if let Ok(compacted) = auto_compact_history(history, provider, model).await {
                if compacted {
                    // Compaction was successful
                }
            }

            return Ok(final_text);
        }

        // Emit text alongside tool calls
        if !text.is_empty() {
            callback.on_text(&text);
        }

        // Execute each tool call and build results
        let mut tool_results = String::new();
        for (name, arguments) in &tool_calls {
            let tool_id = Uuid::new_v4().to_string();
            callback.on_tool_started(name, &tool_id);

            let _start = Instant::now();
            let result = if let Some(tool) = find_tool(tools_registry, name) {
                match tool.execute(arguments.clone()).await {
                    Ok(r) => {
                        let success = r.success;
                        let output = if r.success {
                            r.output.clone()
                        } else {
                            format!("Error: {}", r.error.as_deref().unwrap_or(&r.output))
                        };
                        callback.on_tool_completed(name, &tool_id, &output, success);
                        output
                    }
                    Err(e) => {
                        let msg = format!("Error executing {name}: {e}");
                        callback.on_tool_completed(name, &tool_id, &msg, false);
                        msg
                    }
                }
            } else {
                let msg = format!("Unknown tool: {name}");
                callback.on_tool_completed(name, &tool_id, &msg, false);
                msg
            };

            let _ = writeln!(
                tool_results,
                "<tool_result name=\"{name}\">\n{result}\n</tool_result>"
            );
        }

        // Add to history
        history.push(ChatMessage::assistant(&response));
        history.push(ChatMessage::user(format!("[Tool results]\n{tool_results}")));
    }

    let msg = format!("Agent exceeded maximum tool iterations ({MAX_TOOL_ITERATIONS})");
    callback.on_turn_error(&msg);
    anyhow::bail!("{msg}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tool_calls_xml() {
        let input = "Let me check that.\n<tool_call>\n{\"name\": \"shell\", \"arguments\": {\"command\": \"ls\"}}\n</tool_call>\nDone.";
        let (text, calls) = parse_tool_calls(input);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "shell");
        assert!(text.contains("Let me check that."));
    }

    #[test]
    fn test_parse_tool_calls_json() {
        let input = r#"{"tool_calls": [{"function": {"name": "file_read", "arguments": {"path": "README.md"}}}]}"#;
        let (_, calls) = parse_tool_calls(input);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "file_read");
    }

    #[test]
    fn test_parse_tool_calls_no_tools() {
        let input = "This is just a normal response with no tools.";
        let (text, calls) = parse_tool_calls(input);
        assert!(calls.is_empty());
        assert_eq!(text, input);
    }

    #[test]
    fn test_trim_history() {
        let mut history = vec![ChatMessage::system("You are helpful.")];
        for i in 0..60 {
            history.push(ChatMessage::user(format!("msg {i}")));
        }
        assert_eq!(history.len(), 61);
        trim_history(&mut history);
        assert_eq!(history.len(), 51); // 1 system + 50 messages
        assert_eq!(history[0].role, "system");
    }

    #[test]
    fn test_build_tool_instructions() {
        let security = std::sync::Arc::new(crate::security::SecurityPolicy::default());
        let tools = crate::tools::default_tools(security);
        let instructions = build_tool_instructions(&tools);
        assert!(instructions.contains("shell"));
        assert!(instructions.contains("file_read"));
        assert!(instructions.contains("file_write"));
        assert!(instructions.contains("<tool_call>"));
    }

    #[test]
    fn build_compaction_transcript_formats_roles() {
        let messages = vec![
            ChatMessage::user("I like dark mode"),
            ChatMessage::assistant("Got it"),
        ];
        let transcript = build_compaction_transcript(&messages);
        assert!(transcript.contains("USER: I like dark mode"));
        assert!(transcript.contains("ASSISTANT: Got it"));
    }

    #[test]
    fn apply_compaction_summary_replaces_old_segment() {
        let mut history = vec![
            ChatMessage::system("sys"),
            ChatMessage::user("old 1"),
            ChatMessage::assistant("old 2"),
            ChatMessage::user("recent 1"),
            ChatMessage::assistant("recent 2"),
        ];

        apply_compaction_summary(&mut history, 1, 3, "- user prefers concise replies");

        assert_eq!(history.len(), 4);
        assert!(history[1].content.contains("Compaction summary"));
        assert!(history[2].content.contains("recent 1"));
        assert!(history[3].content.contains("recent 2"));
    }
}
