use async_trait::async_trait;
use futures::StreamExt;
use futures::stream::BoxStream;
use serde::{Deserialize, Serialize};

/// A single message in a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
        }
    }

    /// Create a tool message (result of tool execution)
    pub fn tool(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: format!(
                "{{\"tool_call_id\": \"{}\", \"content\": \"{}\"}}",
                tool_call_id.into(),
                content.into()
            ),
        }
    }
}

/// A tool call requested by the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// An LLM response that may contain text, tool calls, or both.
#[derive(Debug, Clone)]
pub struct ChatResponse {
    /// Text content of the response (may be empty if only tool calls).
    pub text: Option<String>,
    /// Tool calls requested by the LLM.
    pub tool_calls: Vec<ToolCall>,
    /// Token usage reported by the provider, if available.
    pub usage: Option<StreamUsage>,
    /// Raw reasoning/thinking content from thinking models (e.g. DeepSeek-R1,
    /// Kimi K2.5, GLM-4.7). Preserved as an opaque pass-through so it can be
    /// sent back in subsequent API requests — some providers reject tool-call
    /// history that omits this field.
    pub reasoning_content: Option<String>,
}

impl ChatResponse {
    /// True when the LLM wants to invoke at least one tool.
    pub fn has_tool_calls(&self) -> bool {
        !self.tool_calls.is_empty()
    }

    /// Convenience: return text content or empty string.
    pub fn text_or_empty(&self) -> &str {
        self.text.as_deref().unwrap_or("")
    }
}

/// A tool result to feed back to the LLM.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResultMessage {
    pub tool_call_id: String,
    pub content: String,
}

/// A message in a multi-turn conversation, including tool interactions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ConversationMessage {
    /// Regular chat message (system, user, assistant).
    Chat(ChatMessage),
    /// Tool calls from the assistant (stored for history fidelity).
    AssistantToolCalls {
        text: Option<String>,
        tool_calls: Vec<ToolCall>,
        /// Raw reasoning content from thinking models, preserved for round-trip
        /// fidelity with provider APIs that require it.
        #[serde(skip_serializing_if = "Option::is_none")]
        reasoning_content: Option<String>,
    },
    /// Result of a tool execution, fed back to the LLM.
    ToolResult(ToolResultMessage),
}

// =============================================================================
// ChatRequest - Structured request type for the chat method
// =============================================================================

/// Request type for structured chat calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    /// Conversation messages.
    pub messages: Vec<ChatMessage>,
    /// Model identifier (e.g., "claude-3-5-sonnet-20241022").
    pub model: String,
    /// Tools to expose to the model. Default: none.
    pub tools: Option<Vec<serde_json::Value>>,
    /// Sampling temperature. Default: 0.0.
    pub temperature: Option<f64>,
    /// Maximum tokens to generate. Default: provider default.
    pub max_tokens: Option<u32>,
    /// Streaming options. Default: None (non-streaming).
    pub stream_options: Option<StreamOptions>,
}

impl ChatRequest {
    /// Create a new chat request with required fields.
    pub fn new(model: impl Into<String>, messages: Vec<ChatMessage>) -> Self {
        Self {
            messages,
            model: model.into(),
            tools: None,
            temperature: None,
            max_tokens: None,
            stream_options: None,
        }
    }

    /// Add tools to the request.
    pub fn with_tools(mut self, tools: Vec<serde_json::Value>) -> Self {
        self.tools = Some(tools);
        self
    }

    /// Set temperature.
    pub fn with_temperature(mut self, temperature: f64) -> Self {
        self.temperature = Some(temperature);
        self
    }

    /// Set max_tokens.
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = Some(max_tokens);
        self
    }

    /// Enable streaming.
    pub fn with_streaming(mut self) -> Self {
        self.stream_options = Some(StreamOptions {
            include_usage: true,
        });
        self
    }
}

// =============================================================================
// ProviderCapabilities - Feature detection for providers
// =============================================================================

/// Capabilities of a provider.
#[derive(Debug, Clone, Default)]
pub struct ProviderCapabilities {
    /// Provider supports native function calling / tools.
    pub native_tools: bool,
    /// Provider supports vision / image input.
    pub vision: bool,
    /// Provider supports streaming responses.
    pub streaming: bool,
    /// Provider supports JSON mode / structured output.
    pub json_output: bool,
    /// Provider supports system prompts.
    pub system_prompt: bool,
    /// Provider supports tool results as separate messages.
    pub tool_results_as_messages: bool,
    /// Provider supports parallel tool calls.
    pub parallel_tool_calls: bool,
    /// Provider requires a base URL (for custom endpoints).
    pub requires_base_url: bool,
}

impl ProviderCapabilities {
    /// Standard capabilities for OpenAI-compatible providers.
    pub fn openai_compatible() -> Self {
        Self {
            native_tools: true,
            vision: true,
            streaming: true,
            json_output: true,
            system_prompt: true,
            tool_results_as_messages: true,
            parallel_tool_calls: true,
            requires_base_url: true,
        }
    }

    /// Capabilities for Anthropic-style providers.
    pub fn anthropic_style() -> Self {
        Self {
            native_tools: true,
            vision: true,
            streaming: true,
            json_output: false,
            system_prompt: true,
            tool_results_as_messages: true,
            parallel_tool_calls: false,
            requires_base_url: false,
        }
    }

    /// Capabilities for local/ollama-style providers.
    pub fn ollama_style() -> Self {
        Self {
            native_tools: true,
            vision: false,
            streaming: true,
            json_output: false,
            system_prompt: true,
            tool_results_as_messages: true,
            parallel_tool_calls: false,
            requires_base_url: false,
        }
    }
}

// =============================================================================
// ProviderCapabilityError - Errors when checking provider capabilities
// =============================================================================

/// Errors that can occur when checking or converting provider capabilities.
#[derive(Debug, Clone)]
pub enum ProviderCapabilityError {
    /// Provider does not support the requested feature.
    Unsupported(String),
    /// Failed to convert tools to provider format.
    ConversionFailed(String),
    /// Provider configuration error.
    Configuration(String),
}

impl std::fmt::Display for ProviderCapabilityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderCapabilityError::Unsupported(feature) => {
                write!(f, "Provider does not support: {}", feature)
            }
            ProviderCapabilityError::ConversionFailed(msg) => {
                write!(f, "Tool conversion failed: {}", msg)
            }
            ProviderCapabilityError::Configuration(msg) => {
                write!(f, "Provider configuration error: {}", msg)
            }
        }
    }
}

impl std::error::Error for ProviderCapabilityError {}

// =============================================================================

// =============================================================================
// ToolsPayload - Output format for converted tools
// =============================================================================

/// Output of converting tools to provider-specific format.
#[derive(Debug, Clone)]
pub enum ToolsPayload {
    /// Tools in inline JSON format (OpenAI style).
    Inline(Vec<serde_json::Value>),
    /// Tools as URI reference.
    Uri(String),
    /// Auto mode (provider decides).
    Auto,
}

impl ToolsPayload {
    /// Convert to JSON value for API requests.
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            ToolsPayload::Inline(tools) => serde_json::Value::Array(tools.clone()),
            ToolsPayload::Uri(uri) => serde_json::json!({ "uri": uri }),
            ToolsPayload::Auto => serde_json::json!({ "auto": {} }),
        }
    }
}

// =============================================================================
// Streaming types
// =============================================================================

/// Options for streaming requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamOptions {
    /// Include usage statistics in the final chunk.
    pub include_usage: bool,
}

/// A single chunk in a streaming response.
#[derive(Debug, Clone)]
pub struct StreamChunk {
    /// Text content of this chunk (may be empty).
    pub text: Option<String>,
    /// Tool calls in this chunk (may be empty).
    pub tool_calls: Vec<ToolCall>,
    /// Whether this is the final chunk.
    pub is_final: bool,
    /// Usage statistics (only in final chunk if enabled).
    pub usage: Option<StreamUsage>,
}

/// Usage statistics from a streaming response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamUsage {
    /// Number of input tokens.
    pub prompt_tokens: u32,
    /// Number of output tokens.
    pub completion_tokens: u32,
    /// Total tokens.
    pub total_tokens: u32,
}

/// Result type for streaming responses.
pub type StreamResult = Result<StreamChunk, StreamError>;

/// Error type for streaming responses.
#[derive(Debug)]
pub struct StreamError {
    message: String,
    is_retryable: bool,
}

impl StreamError {
    /// Create a new stream error.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            is_retryable: false,
        }
    }

    /// Create a retryable stream error.
    pub fn retryable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            is_retryable: true,
        }
    }

    /// Check if the error is retryable.
    pub fn is_retryable(&self) -> bool {
        self.is_retryable
    }
}

impl std::fmt::Display for StreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for StreamError {}

// =============================================================================
// ProviderError - Errors from provider operations
// =============================================================================

/// Errors from provider API operations.
#[derive(Debug)]
pub enum ProviderError {
    /// Authentication failed.
    Authentication(String),
    /// Rate limit exceeded.
    RateLimited {
        message: String,
        retry_after_secs: Option<u32>,
    },
    /// Model not found or invalid.
    ModelNotFound(String),
    /// Invalid request parameters.
    InvalidRequest(String),
    /// Provider returned an error.
    ProviderError(String),
    /// Network or connection error.
    Network(String),
    /// Timeout error.
    Timeout,
    /// Stream was cancelled.
    StreamCancelled,
}

impl ProviderError {
    /// Check if the error is retryable.
    pub fn is_retryable(&self) -> bool {
        match self {
            ProviderError::RateLimited { .. } => true,
            ProviderError::Network(_) => true,
            ProviderError::Timeout => true,
            _ => false,
        }
    }

    /// Get a user-friendly message.
    pub fn message(&self) -> &str {
        match self {
            ProviderError::Authentication(msg) => msg,
            ProviderError::RateLimited { message, .. } => message,
            ProviderError::ModelNotFound(msg) => msg,
            ProviderError::InvalidRequest(msg) => msg,
            ProviderError::ProviderError(msg) => msg,
            ProviderError::Network(msg) => msg,
            ProviderError::Timeout => "Request timed out",
            ProviderError::StreamCancelled => "Stream was cancelled",
        }
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

impl std::error::Error for ProviderError {}

// =============================================================================
// build_tool_instructions_text - Helper function for tool instructions
// =============================================================================

/// Build instructions text for tool use from a list of tool specs.
pub fn build_tool_instructions_text(tools: &[crate::tools::ToolSpec]) -> String {
    if tools.is_empty() {
        return String::new();
    }

    let mut text = String::from("## Available Tools\n\n");
    text.push_str("You may call one or more tools to assist with the user's request.\n\n");

    for tool in tools {
        text.push_str(&format!("### {}\n\n", tool.name));
        text.push_str(&format!("{}\n\n", tool.description));
        text.push_str("**Parameters:**\n```json\n");
        text.push_str(&serde_json::to_string_pretty(&tool.parameters).unwrap_or_default());
        text.push_str("\n```\n\n");
    }

    text
}

#[async_trait]
pub trait Provider: Send + Sync {
    async fn chat(&self, message: &str, model: &str, temperature: f64) -> anyhow::Result<String> {
        self.chat_with_system(None, message, model, temperature)
            .await
    }

    async fn chat_with_system(
        &self,
        system_prompt: Option<&str>,
        message: &str,
        model: &str,
        temperature: f64,
    ) -> anyhow::Result<String>;

    /// Multi-turn conversation. Default implementation extracts the last user
    /// message and delegates to `chat_with_system`.
    async fn chat_with_history(
        &self,
        messages: &[ChatMessage],
        model: &str,
        temperature: f64,
    ) -> anyhow::Result<String> {
        let system = messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.as_str());
        let last_user = messages
            .iter()
            .rfind(|m| m.role == "user")
            .map(|m| m.content.as_str())
            .unwrap_or("");
        self.chat_with_system(system, last_user, model, temperature)
            .await
    }

    /// Warm up the HTTP connection pool (TLS handshake, DNS, HTTP/2 setup).
    /// Default implementation is a no-op; providers with HTTP clients should override.
    async fn warmup(&self) -> anyhow::Result<()> {
        Ok(())
    }

    // =============================================================================
    // New capability methods (Phase 1)
    // =============================================================================

    /// Get the capabilities of this provider.
    /// Default implementation returns OpenAI-compatible capabilities.
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities::openai_compatible()
    }

    /// Convert tools to the provider's expected format.
    /// Default implementation converts to inline JSON format.
    fn convert_tools(
        &self,
        tools: &[crate::tools::ToolSpec],
    ) -> Result<ToolsPayload, ProviderCapabilityError> {
        if tools.is_empty() {
            return Ok(ToolsPayload::Inline(vec![]));
        }

        let tools_json: Vec<serde_json::Value> = tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect();

        Ok(ToolsPayload::Inline(tools_json))
    }

    /// Structured chat request with full options.
    /// Default implementation wraps in legacy methods for backward compatibility.
    async fn chat_request(&self, request: ChatRequest) -> Result<ChatResponse, ProviderError> {
        // Extract the last user message for legacy compatibility
        let _system = request
            .messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.as_str());

        let _last_user = request
            .messages
            .iter()
            .rfind(|m| m.role == "user")
            .map(|m| m.content.as_str())
            .unwrap_or("");

        let temperature = request.temperature.unwrap_or(0.0);

        // Call legacy method - this will need to be implemented by providers
        // For now, we'll use chat_with_history and then parse the response
        let text = self
            .chat_with_history(&request.messages, &request.model, temperature)
            .await
            .map_err(|e| ProviderError::ProviderError(e.to_string()))?;

        Ok(ChatResponse {
            text: Some(text),
            tool_calls: vec![],
            usage: None,
            reasoning_content: None,
        })
    }

    /// Check if this provider supports native function calling.
    fn supports_native_tools(&self) -> bool {
        self.capabilities().native_tools
    }

    /// Check if this provider supports vision / image input.
    fn supports_vision(&self) -> bool {
        self.capabilities().vision
    }

    /// Check if this provider supports streaming responses.
    fn supports_streaming(&self) -> bool {
        self.capabilities().streaming
    }

    /// Start a streaming chat session.
    /// Default implementation returns a not-supported error stream.
    fn stream_chat(&self, _request: ChatRequest) -> BoxStream<'static, StreamResult> {
        // Default: return an error stream
        let error = StreamError::new("Streaming not supported by this provider");
        futures::stream::iter(vec![Err(error)]).boxed()
    }

    /// Start a streaming chat session with text input.
    /// Default implementation wraps in ChatRequest and calls stream_chat.
    fn stream_chat_text(
        &self,
        message: &str,
        model: &str,
        temperature: f64,
    ) -> BoxStream<'static, StreamResult> {
        let request = ChatRequest::new(model.to_string(), vec![ChatMessage::user(message)])
            .with_temperature(temperature)
            .with_streaming();
        self.stream_chat(request)
    }

    /// Start a streaming chat session with system prompt and message.
    /// Default implementation wraps in ChatRequest and calls stream_chat.
    fn stream_chat_with_system(
        &self,
        system_prompt: Option<&str>,
        message: &str,
        model: &str,
        temperature: f64,
    ) -> BoxStream<'static, StreamResult> {
        let mut messages = vec![];
        if let Some(system) = system_prompt {
            messages.push(ChatMessage::system(system));
        }
        messages.push(ChatMessage::user(message));

        let request = ChatRequest::new(model.to_string(), messages)
            .with_temperature(temperature)
            .with_streaming();
        self.stream_chat(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_message_constructors() {
        let sys = ChatMessage::system("Be helpful");
        assert_eq!(sys.role, "system");
        assert_eq!(sys.content, "Be helpful");

        let user = ChatMessage::user("Hello");
        assert_eq!(user.role, "user");

        let asst = ChatMessage::assistant("Hi there");
        assert_eq!(asst.role, "assistant");
    }

    #[test]
    fn chat_response_helpers() {
        let empty = ChatResponse {
            text: None,
            tool_calls: vec![],
        };
        assert!(!empty.has_tool_calls());
        assert_eq!(empty.text_or_empty(), "");

        let with_tools = ChatResponse {
            text: Some("Let me check".into()),
            tool_calls: vec![ToolCall {
                id: "1".into(),
                name: "shell".into(),
                arguments: "{}".into(),
            }],
        };
        assert!(with_tools.has_tool_calls());
        assert_eq!(with_tools.text_or_empty(), "Let me check");
    }

    #[test]
    fn tool_call_serialization() {
        let tc = ToolCall {
            id: "call_123".into(),
            name: "file_read".into(),
            arguments: r#"{"path":"test.txt"}"#.into(),
        };
        let json = serde_json::to_string(&tc).unwrap();
        assert!(json.contains("call_123"));
        assert!(json.contains("file_read"));
    }

    #[test]
    fn conversation_message_variants() {
        let chat = ConversationMessage::Chat(ChatMessage::user("hi"));
        let json = serde_json::to_string(&chat).unwrap();
        assert!(json.contains("\"type\":\"Chat\""));

        let tool_result = ConversationMessage::ToolResult(ToolResultMessage {
            tool_call_id: "1".into(),
            content: "done".into(),
        });
        let json = serde_json::to_string(&tool_result).unwrap();
        assert!(json.contains("\"type\":\"ToolResult\""));
    }
}
