//! ZeroClaw session — built-in LLM agent with tool use and memory.
//!
//! This session type runs the zeroclaw agent in-process (no external CLI).
//! It supports 22+ LLM providers, shell/file tools, SQLite memory, and security policies.

use base64::Engine;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::message_protocol::AgentType;
use anyhow::{Context, Result};
use tokio::sync::broadcast;
use tracing::{debug, error, info};

use super::events::{AgentEvent, AgentTurnEvent, PendingPermission};
use zeroclaw::agent::TurnCallback;
use zeroclaw::runtime::RuntimeAdapter;

/// ZeroClaw session — in-process LLM agent
pub struct ZeroClawSession {
    session_id: String,
    agent_type: AgentType,
    event_tx: broadcast::Sender<AgentTurnEvent>,
    provider: Arc<Mutex<Option<Box<dyn zeroclaw::providers::Provider>>>>,
    tools_registry: Arc<Vec<Box<dyn zeroclaw::tools::Tool>>>,
    history: Arc<tokio::sync::Mutex<Vec<zeroclaw::providers::ChatMessage>>>,
    memory: Arc<dyn zeroclaw::memory::Memory>,
    model: String,
    temperature: f64,
    max_iterations: usize,
    #[allow(dead_code)]
    working_dir: PathBuf,
    interrupted: Arc<std::sync::atomic::AtomicBool>,
}

/// Callback that bridges zeroclaw events into ClawdChat's broadcast channel
struct SessionCallback {
    event_tx: broadcast::Sender<AgentTurnEvent>,
    session_id: String,
}

impl zeroclaw::agent::TurnCallback for SessionCallback {
    fn on_text(&self, text: &str) {
        let _ = self.event_tx.send(AgentTurnEvent {
            turn_id: String::new(),
            event: AgentEvent::TextDelta {
                session_id: self.session_id.clone(),
                text: text.to_string(),
            },
        });
    }

    fn on_tool_started(&self, tool_name: &str, tool_id: &str) {
        let _ = self.event_tx.send(AgentTurnEvent {
            turn_id: String::new(),
            event: AgentEvent::ToolStarted {
                session_id: self.session_id.clone(),
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                input: None,
            },
        });
    }

    fn on_tool_completed(&self, tool_name: &str, tool_id: &str, output: &str, _success: bool) {
        let _ = self.event_tx.send(AgentTurnEvent {
            turn_id: String::new(),
            event: AgentEvent::ToolCompleted {
                session_id: self.session_id.clone(),
                tool_id: tool_id.to_string(),
                tool_name: Some(tool_name.to_string()),
                output: Some(serde_json::Value::String(output.to_string())),
                error: None,
            },
        });
    }

    fn on_turn_completed(&self) {
        let _ = self.event_tx.send(AgentTurnEvent {
            turn_id: String::new(),
            event: AgentEvent::TurnCompleted {
                session_id: self.session_id.clone(),
                result: None,
            },
        });
    }

    fn on_turn_error(&self, error: &str) {
        let _ = self.event_tx.send(AgentTurnEvent {
            turn_id: String::new(),
            event: AgentEvent::TurnError {
                session_id: self.session_id.clone(),
                error: error.to_string(),
                code: None,
            },
        });
    }
}

impl ZeroClawSession {
    /// Spawn a new ZeroClaw session.
    ///
    /// # Arguments
    /// * `session_id` - Unique session ID
    /// * `agent_type` - Agent type (should be AgentType::ZeroClaw)
    /// * `working_dir` - Working directory for file operations
    /// * `extra_args` - Extra arguments: `[provider_name, model_name, api_key?]`
    pub async fn spawn(
        session_id: String,
        agent_type: AgentType,
        working_dir: PathBuf,
        extra_args: Vec<String>,
    ) -> Result<Self> {
        let (event_tx, _) = broadcast::channel(256);

        // Parse extra_args: [provider, model, api_key?, temperature, max_iterations?, system_prompt_b64?, enabled_tools?]
        let provider_name = extra_args.first().map(|s| s.as_str()).unwrap_or("ollama");
        let model_name = extra_args.get(1).map(|s| s.as_str()).unwrap_or("qwen3:8b");
        let api_key = extra_args.get(2).map(|s| s.as_str());
        let temperature: f64 = extra_args
            .get(3)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.7);
        let max_iterations: usize = extra_args.get(4).and_then(|s| s.parse().ok()).unwrap_or(20);

        // Parse system prompt (base64 encoded)
        let custom_system_prompt = extra_args.get(5).and_then(|s| {
            let decoded = base64::engine::general_purpose::STANDARD.decode(s);
            decoded.ok().and_then(|bytes| String::from_utf8(bytes).ok())
        });

        // Parse enabled tools (comma-separated)
        let enabled_tools: Option<Vec<String>> = extra_args.get(6).map(|s| {
            s.split(',')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect()
        });

        // Create provider
        let provider = zeroclaw::providers::create_provider(provider_name, api_key)
            .with_context(|| format!("Failed to create ZeroClaw provider '{provider_name}'"))?;

        // Create memory
        let memory: Arc<dyn zeroclaw::memory::Memory> =
            Arc::from(zeroclaw::memory::create_memory("sqlite", &working_dir)?);

        // Create security policy
        let security = Arc::new(zeroclaw::security::SecurityPolicy::from_config(
            &zeroclaw::config::AutonomyConfig::default(),
            &working_dir,
        ));

        // Create tools with appropriate runtime based on feature flags
        #[cfg(any(
            feature = "tauri-runtime",
            feature = "desktop-runtime",
            feature = "mobile-runtime"
        ))]
        let runtime: Arc<dyn RuntimeAdapter> = Arc::new(zeroclaw::runtime::TauriRuntime::new());
        #[cfg(not(any(
            feature = "tauri-runtime",
            feature = "desktop-runtime",
            feature = "mobile-runtime"
        )))]
        let _runtime: Arc<dyn RuntimeAdapter> = Arc::new(zeroclaw::runtime::NativeRuntime::new());

        // Use all_tools_with_runtime for desktop/tauri builds to include screenshot tools
        #[cfg(any(feature = "desktop-runtime", feature = "tauri-runtime"))]
        let all_tools = zeroclaw::tools::all_tools_with_runtime(&security, runtime, memory.clone());
        #[cfg(not(any(feature = "desktop-runtime", feature = "tauri-runtime")))]
        let all_tools = zeroclaw::tools::all_tools(&security, memory.clone());

        // Filter tools based on enabled_tools if provided
        let tools_registry: Vec<Box<dyn zeroclaw::tools::Tool>> =
            if let Some(ref enabled) = enabled_tools {
                all_tools
                    .into_iter()
                    .filter(|t| enabled.contains(&t.name().to_string()))
                    .collect()
            } else {
                all_tools
            };

        info!(
            "ZeroClaw session created: id={}, provider={}, model={}, tools={}, max_iterations={}",
            session_id,
            provider_name,
            model_name,
            tools_registry.len(),
            max_iterations
        );

        // Build initial system prompt
        let tool_instructions = zeroclaw::agent::build_tool_instructions(&tools_registry);

        // Use custom system prompt if provided, otherwise use default
        let system_prompt = if let Some(custom) = custom_system_prompt {
            format!(
                "{}\n\nWorking directory: {}\n\n{}",
                custom,
                working_dir.display(),
                tool_instructions
            )
        } else {
            format!(
                "You are ZeroClaw, a helpful AI coding assistant.\n\
                 You have access to tools for shell execution, file operations, and memory.\n\
                 Always use tools when needed to accomplish tasks.\n\
                 Working directory: {}\n\
                 {tool_instructions}",
                working_dir.display()
            )
        };

        let history = vec![zeroclaw::providers::ChatMessage::system(&system_prompt)];

        Ok(Self {
            session_id,
            agent_type,
            event_tx,
            provider: Arc::new(Mutex::new(Some(provider))),
            tools_registry: Arc::new(tools_registry),
            history: Arc::new(tokio::sync::Mutex::new(history)),
            memory,
            model: model_name.to_string(),
            temperature,
            max_iterations,
            working_dir,
            interrupted: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn agent_type(&self) -> AgentType {
        self.agent_type
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentTurnEvent> {
        self.event_tx.subscribe()
    }

    pub async fn send_message(
        &self,
        text: String,
        _turn_id: &str,
        _attachments: Vec<String>,
    ) -> std::result::Result<(), String> {
        self.interrupted
            .store(false, std::sync::atomic::Ordering::Relaxed);

        // Build context from memory
        let context = zeroclaw::agent::build_context(self.memory.as_ref(), &text, None).await;

        // Add user message to history
        {
            let mut history = self.history.lock().await;
            let full_message = if context.is_empty() {
                text.clone()
            } else {
                format!("{context}\n{text}")
            };
            history.push(zeroclaw::providers::ChatMessage::user(full_message));
            zeroclaw::agent::trim_history(&mut history);
        }

        // Run agent turn in background
        let provider_arc = self.provider.clone();
        let history_arc = self.history.clone();
        let tools = self.tools_registry.clone();
        let callback = SessionCallback {
            event_tx: self.event_tx.clone(),
            session_id: self.session_id.clone(),
        };
        let model = self.model.clone();
        let temperature = self.temperature;
        let max_iterations = self.max_iterations;

        tokio::spawn(async move {
            // Take provider out temporarily
            let provider = {
                let mut guard = provider_arc.lock().unwrap();
                guard.take()
            };

            if let Some(provider) = provider {
                let mut history = history_arc.lock().await;
                let result = zeroclaw::agent::agent_turn(
                    provider.as_ref(),
                    &mut history,
                    &tools,
                    &callback,
                    &model,
                    temperature,
                    max_iterations,
                )
                .await;

                if let Err(e) = result {
                    error!("ZeroClaw agent turn error: {e}");
                    callback.on_turn_error(&e.to_string());
                }

                // Put provider back
                let mut guard = provider_arc.lock().unwrap();
                *guard = Some(provider);
            } else {
                callback.on_turn_error("Provider is not available (session busy?)");
            }
        });

        Ok(())
    }

    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        self.interrupted
            .store(true, std::sync::atomic::Ordering::Relaxed);
        debug!("ZeroClaw session interrupted: {}", self.session_id);
        Ok(())
    }

    pub async fn get_pending_permissions(
        &self,
    ) -> std::result::Result<Vec<PendingPermission>, String> {
        // ZeroClaw handles permissions internally via SecurityPolicy
        Ok(vec![])
    }

    pub async fn respond_to_permission(
        &self,
        _request_id: String,
        _approved: bool,
        _reason: Option<String>,
    ) -> std::result::Result<(), String> {
        Ok(())
    }

    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        self.interrupted
            .store(true, std::sync::atomic::Ordering::Relaxed);
        info!("ZeroClaw session shut down: {}", self.session_id);
        Ok(())
    }
}
