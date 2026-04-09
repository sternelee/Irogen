//! OpenClaw Gateway WebSocket session implementation.
//!
//! This module provides WebSocket-based communication with OpenClaw Gateway.
//! Uses a singleton manager to ensure only one Gateway connection exists.
//!
//! # Protocol
//!
//! The Gateway uses JSON frames:
//! - REQUEST: `{type: "req", id: string, method: string, params: object}`
//! - RESPONSE: `{type: "res", id: string, ok: boolean, payload?: object, error?: object}`
//! - EVENT: `{type: "event", event: string, payload: object, seq: number}`
//!
//! # Handshake Flow
//!
//! 1. Connect to WebSocket
//! 2. Wait for `connect.challenge` event to get nonce
//! 3. Send connect request with device identity and signed payload (v3 format with nonce)
//! 4. Wait for connect response with ok:true

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use rand_core::OsRng;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::{RwLock, broadcast, mpsc, oneshot};
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info};

use super::events::{AgentEvent, AgentTurnEvent, PendingPermission};
use crate::message_protocol::AgentType;

/// Default port for OpenClaw Gateway
pub const DEFAULT_OPENCLAW_PORT: u16 = 18789;

/// Default agent ID for OpenClaw Gateway
pub const DEFAULT_AGENT_ID: &str = "main";

/// Gateway manager - singleton that manages the single WebSocket connection
static GATEWAY_MANAGER: std::sync::LazyLock<RwLock<Option<Arc<OpenClawGatewayManager>>>> =
    std::sync::LazyLock::new(|| RwLock::new(None));

/// OpenClaw Gateway manager - single connection for all sessions
pub struct OpenClawGatewayManager {
    /// Connection state
    connected: Arc<AtomicBool>,
    /// Handshake completion notification
    handshake_done: Arc<tokio::sync::Notify>,
    /// Event broadcaster for all sessions (shares with sessions)
    event_sender: broadcast::Sender<AgentTurnEvent>,
    /// Channel to send messages to the gateway
    send_tx: mpsc::Sender<Vec<u8>>,
    /// Request ID counter
    request_counter: Arc<AtomicU64>,
    /// Pending request context keyed by gateway request id
    request_contexts: Arc<RwLock<HashMap<String, RequestContext>>>,
    /// Pending RPC response waiters keyed by gateway request id
    pending_rpc: PendingRpcMap,
    /// Streaming state per session key
    session_states: Arc<RwLock<HashMap<String, SessionStreamState>>>,
    /// Run ID to session key mapping
    run_to_session: Arc<RwLock<HashMap<String, String>>>,
    /// Pending permissions
    pending_permissions: Arc<RwLock<HashMap<String, PendingPermission>>>,
    /// Gateway config
    config: GatewayConfig,
}

/// OpenClaw session - represents a single user's session
pub struct OpenClawWsSession {
    /// Session ID
    session_id: String,
    /// Agent type
    agent_type: AgentType,
    /// Session key for gateway
    session_key: String,
    /// Event sender (cloned from manager for resubscription)
    event_sender: broadcast::Sender<AgentTurnEvent>,
    /// Permission mode for this session
    permission_mode: Arc<RwLock<super::permission_handler::PermissionMode>>,
}

/// Gateway configuration
#[derive(Debug, Clone)]
struct GatewayConfig {
    port: u16,
    token: String,
    agent_id: String,
    device_identity: DeviceIdentity,
}

#[derive(Debug, Clone)]
struct RequestContext {
    session_id: String,
    turn_id: String,
    method: String,
    emit_events: bool,
}

type GatewayRpcResult = Result<serde_json::Value, String>;
type PendingRpcSender = oneshot::Sender<GatewayRpcResult>;
type PendingRpcMap = Arc<RwLock<HashMap<String, PendingRpcSender>>>;

#[derive(Debug, Default, Clone)]
struct SessionStreamState {
    turn_id: Option<String>,
    last_content: String,
}

#[derive(Clone)]
struct GatewayRuntimeState {
    pending_permissions: Arc<RwLock<HashMap<String, PendingPermission>>>,
    request_contexts: Arc<RwLock<HashMap<String, RequestContext>>>,
    pending_rpc: PendingRpcMap,
    session_states: Arc<RwLock<HashMap<String, SessionStreamState>>>,
    run_to_session: Arc<RwLock<HashMap<String, String>>>,
}

// ============================================================================
// Device Identity
// ============================================================================

#[derive(Clone, Debug)]
struct DeviceIdentity {
    device_id: String,
    public_key: [u8; 32],
    private_key: [u8; 32],
}

fn load_or_create_device_identity(config_dir: &std::path::Path) -> Result<DeviceIdentity> {
    let identity_path = config_dir.join("identity.json");

    if identity_path.exists() {
        let content = std::fs::read_to_string(&identity_path)?;
        let stored: serde_json::Value =
            serde_json::from_str(&content).context("Failed to parse identity file")?;

        let device_id = stored["deviceId"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing deviceId"))?;
        let public_key_b64 = stored["publicKey"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing publicKey"))?;
        let private_key_b64 = stored["privateKey"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing privateKey"))?;

        let public_key = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(public_key_b64)
            .context("Invalid public key")?;
        let private_key = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(private_key_b64)
            .context("Invalid private key")?;

        if public_key.len() != 32 || private_key.len() != 32 {
            anyhow::bail!("Invalid key length");
        }

        let mut public_key_arr = [0u8; 32];
        let mut private_key_arr = [0u8; 32];
        public_key_arr.copy_from_slice(&public_key);
        private_key_arr.copy_from_slice(&private_key);

        // Verify device_id matches
        let computed_id = compute_device_id(&public_key_arr);
        if computed_id != device_id {
            anyhow::bail!("Device ID mismatch");
        }

        return Ok(DeviceIdentity {
            device_id: device_id.to_string(),
            public_key: public_key_arr,
            private_key: private_key_arr,
        });
    }

    // Generate new identity using Ed25519
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();

    let mut public_key_arr = [0u8; 32];
    let mut private_key_arr = [0u8; 32];
    public_key_arr.copy_from_slice(verifying_key.as_bytes());
    private_key_arr.copy_from_slice(signing_key.as_bytes());

    let device_id = compute_device_id(&public_key_arr);

    // Ensure directory exists
    if let Some(parent) = identity_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Save to file
    let stored = serde_json::json!({
        "version": 1,
        "deviceId": device_id,
        "publicKey": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(public_key_arr),
        "privateKey": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(private_key_arr),
        "createdAtMs": chrono::Utc::now().timestamp_millis()
    });

    std::fs::write(&identity_path, serde_json::to_string_pretty(&stored)?)?;
    info!("[OpenClaw] Generated new device identity: {}", device_id);

    Ok(DeviceIdentity {
        device_id,
        public_key: public_key_arr,
        private_key: private_key_arr,
    })
}

/// Compute device ID from public key (SHA256 hash)
fn compute_device_id(public_key: &[u8; 32]) -> String {
    let hash = Sha256::digest(public_key);
    hex::encode(hash)
}

/// Per OpenClaw auth spec, only ASCII uppercase letters are lowercased.
fn normalize_device_metadata(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else {
                c
            }
        })
        .collect()
}

/// Sign device auth payload using Ed25519
fn sign_device_payload(private_key: &[u8; 32], payload: &str) -> String {
    let signing_key = SigningKey::from_bytes(private_key);
    let signature = signing_key.sign(payload.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(signature.to_bytes())
}

// ============================================================================
// Gateway Configuration
// ============================================================================

fn load_gateway_config() -> Option<GatewayConfig> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".openclaw").join("openclaw.json");

    if !config_path.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;

    let gateway = config.get("gateway")?;
    let port = gateway
        .get("port")
        .and_then(|v| v.as_u64())
        .unwrap_or(18789) as u16;
    let token = gateway.get("auth")?.get("token")?.as_str()?.to_string();

    // Load device identity
    let config_dir = home.join(".openclaw");
    let device_identity = load_or_create_device_identity(&config_dir).ok()?;

    Some(GatewayConfig {
        port,
        token,
        agent_id: DEFAULT_AGENT_ID.to_string(),
        device_identity,
    })
}

// ============================================================================
// Agent Request Types
// ============================================================================

#[derive(Debug, Serialize)]
struct AgentRequest {
    #[serde(rename = "type")]
    msg_type: String,
    id: String,
    method: String,
    params: AgentRequestParams,
}

#[derive(Debug, Serialize)]
struct AgentRequestParams {
    message: String,
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "sessionKey")]
    session_key: String,
    #[serde(rename = "idempotencyKey")]
    idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout: Option<u64>,
}

// ============================================================================
// OpenClawWsSession Implementation
// ============================================================================

impl OpenClawWsSession {
    /// Spawn a new OpenClaw session (registers with singleton manager)
    pub async fn spawn(
        session_id: String,
        agent_type: AgentType,
        _command: String,
        _args: Vec<String>,
        _working_dir: PathBuf,
        _home_dir: Option<String>,
    ) -> Result<Self> {
        // Get or create the singleton manager
        let manager = get_or_create_gateway_manager().await?;

        // Use session_id as session_key
        let session_key = session_id.clone();

        // Subscribe to the manager's event broadcaster
        let event_sender = manager.event_sender();

        info!(
            "[OpenClaw] Session {} created with key {}",
            session_id, session_key
        );

        Ok(Self {
            session_id,
            agent_type,
            session_key,
            event_sender,
            permission_mode: Arc::new(RwLock::new(
                super::permission_handler::PermissionMode::AlwaysAsk,
            )),
        })
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn agent_type(&self) -> AgentType {
        self.agent_type
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentTurnEvent> {
        self.event_sender.subscribe()
    }

    pub async fn set_permission_mode(
        &self,
        mode: super::permission_handler::PermissionMode,
    ) -> std::result::Result<(), String> {
        let mut current = self.permission_mode.write().await;
        *current = mode;
        Ok(())
    }

    pub async fn get_permission_mode(&self) -> super::permission_handler::PermissionMode {
        let current = self.permission_mode.read().await;
        *current
    }

    pub async fn send_message(
        &self,
        text: String,
        turn_id: &str,
        _attachments: Vec<String>,
    ) -> std::result::Result<(), String> {
        // Get the manager
        let manager = get_or_create_gateway_manager()
            .await
            .map_err(|e| e.to_string())?;

        manager
            .send_agent_request(&text, &self.session_key, Some(turn_id))
            .await
            .map_err(|e| e.to_string())?;

        info!("[OpenClaw] Message sent for session {}", self.session_id);
        Ok(())
    }

    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        let manager = get_or_create_gateway_manager()
            .await
            .map_err(|e| e.to_string())?;
        manager
            .abort_session_runs(&self.session_key, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn get_pending_permissions(
        &self,
    ) -> std::result::Result<Vec<PendingPermission>, String> {
        let manager = get_or_create_gateway_manager()
            .await
            .map_err(|e| e.to_string())?;
        let pending = manager.pending_permissions.read().await;
        let items = pending
            .values()
            .filter(|p| p.session_id == self.session_key)
            .cloned()
            .collect::<Vec<_>>();
        Ok(items)
    }

    pub async fn respond_to_permission(
        &self,
        request_id: String,
        approved: bool,
        approve_for_session: bool,
        _reason: Option<String>,
    ) -> std::result::Result<(), String> {
        let decision = if approved {
            if approve_for_session {
                "allow-always"
            } else {
                "allow-once"
            }
        } else {
            "deny"
        };
        let manager = get_or_create_gateway_manager()
            .await
            .map_err(|e| e.to_string())?;
        manager
            .resolve_exec_approval(&request_id, decision)
            .await
            .map_err(|e| e.to_string())?;
        manager
            .pending_permissions
            .write()
            .await
            .remove(&request_id);
        Ok(())
    }

    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        info!("[OpenClaw] Session {} shutdown", self.session_id);
        Ok(())
    }
}

/// Get or create the singleton gateway manager
async fn get_or_create_gateway_manager() -> Result<Arc<OpenClawGatewayManager>> {
    // First try to get existing
    {
        let guard = GATEWAY_MANAGER.read().await;
        if let Some(manager) = guard.as_ref()
            && manager.is_connected()
        {
            return Ok(manager.clone());
        }
    }

    // Need to create new manager
    let mut guard = GATEWAY_MANAGER.write().await;

    // Double-check after acquiring write lock
    if let Some(manager) = guard.as_ref()
        && manager.is_connected()
    {
        return Ok(manager.clone());
    }

    // Load config
    let config = load_gateway_config().ok_or_else(|| {
        anyhow!("No OpenClaw gateway config found. Create ~/.openclaw/openclaw.json")
    })?;

    info!("[OpenClaw] Creating new gateway manager");

    // Create new manager with connection loop
    let manager = Arc::new(OpenClawGatewayManager::new(config).await?);

    *guard = Some(manager.clone());

    // Wait for handshake completion
    let handshake_done = manager.handshake_done.clone();
    if manager.is_connected() {
        return Ok(manager);
    }

    tokio::select! {
        _ = sleep(Duration::from_secs(15)) => {
            anyhow::bail!("Timeout waiting for gateway handshake");
        }
        _ = handshake_done.notified() => {
            if manager.is_connected() {
                info!("[OpenClaw] Gateway manager connected and handshaked");
                Ok(manager)
            } else {
                anyhow::bail!("Gateway connection failed during handshake")
            }
        }
    }
}

impl OpenClawGatewayManager {
    /// Create and start the gateway manager
    async fn new(config: GatewayConfig) -> Result<Self> {
        let (event_sender, _) = broadcast::channel(1024);
        let (send_tx, send_rx) = mpsc::channel(100);

        let connected = Arc::new(AtomicBool::new(false));
        let handshake_done = Arc::new(tokio::sync::Notify::new());
        let request_counter = Arc::new(AtomicU64::new(0));
        let pending_permissions = Arc::new(RwLock::new(HashMap::new()));
        let request_contexts = Arc::new(RwLock::new(HashMap::new()));
        let pending_rpc = Arc::new(RwLock::new(HashMap::new()));
        let session_states = Arc::new(RwLock::new(HashMap::new()));
        let run_to_session = Arc::new(RwLock::new(HashMap::new()));
        let runtime_state = Arc::new(GatewayRuntimeState {
            pending_permissions: pending_permissions.clone(),
            request_contexts: request_contexts.clone(),
            pending_rpc: pending_rpc.clone(),
            session_states: session_states.clone(),
            run_to_session: run_to_session.clone(),
        });

        // Clone for the connection loop
        let connected_clone = connected.clone();
        let handshake_done_clone = handshake_done.clone();
        let event_sender_clone = event_sender.clone();
        let runtime_state_clone = runtime_state.clone();
        let config_clone = config.clone();

        // Spawn connection loop
        tokio::spawn(async move {
            Self::connection_loop(
                config_clone,
                connected_clone,
                handshake_done_clone,
                event_sender_clone,
                runtime_state_clone,
                send_rx,
            )
            .await;
        });

        Ok(Self {
            connected,
            handshake_done,
            event_sender,
            send_tx,
            request_counter,
            pending_permissions,
            request_contexts,
            pending_rpc,
            session_states,
            run_to_session,
            config,
        })
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// Get event sender for resubscription
    fn event_sender(&self) -> broadcast::Sender<AgentTurnEvent> {
        self.event_sender.clone()
    }

    /// Send an agent request
    async fn send_agent_request(
        &self,
        message: &str,
        session_key: &str,
        turn_id_hint: Option<&str>,
    ) -> Result<()> {
        if !self.is_connected() {
            anyhow::bail!("Not connected to gateway");
        }

        let seq = self.request_counter.fetch_add(1, Ordering::SeqCst) + 1;
        let now = chrono::Utc::now().timestamp_millis();
        let request_id = format!("agent:{}:{}", now, seq);
        let turn_id = turn_id_hint
            .filter(|v| !v.trim().is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let request = AgentRequest {
            msg_type: "req".to_string(),
            id: request_id.clone(),
            method: "agent".to_string(),
            params: AgentRequestParams {
                message: message.to_string(),
                agent_id: self.config.agent_id.clone(),
                session_key: session_key.to_string(),
                idempotency_key: turn_id.clone(),
                timeout: Some(120_000), // 120s timeout
            },
        };

        self.request_contexts.write().await.insert(
            request_id.clone(),
            RequestContext {
                session_id: session_key.to_string(),
                turn_id: turn_id.clone(),
                method: "agent".to_string(),
                emit_events: true,
            },
        );

        // Store run_id to session key mapping
        self.run_to_session
            .write()
            .await
            .insert(turn_id.clone(), session_key.to_string());

        {
            let mut states = self.session_states.write().await;
            let state = states.entry(session_key.to_string()).or_default();
            state.turn_id = Some(turn_id);
            state.last_content.clear();
        }

        let data = serde_json::to_vec(&request)?;
        self.send_tx
            .send(data)
            .await
            .context("Failed to send message")?;

        info!("[OpenClaw] Sent agent request: {}", request_id);
        Ok(())
    }

    async fn send_control_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        if !self.is_connected() {
            anyhow::bail!("Not connected to gateway");
        }

        let seq = self.request_counter.fetch_add(1, Ordering::SeqCst) + 1;
        let now = chrono::Utc::now().timestamp_millis();
        let request_id = format!("ctl:{}:{}", now, seq);
        let request = serde_json::json!({
            "type": "req",
            "id": request_id,
            "method": method,
            "params": params,
        });
        let data = serde_json::to_vec(&request)?;
        let (tx, rx) = oneshot::channel();
        self.pending_rpc
            .write()
            .await
            .insert(request_id.clone(), tx);
        self.request_contexts.write().await.insert(
            request_id.clone(),
            RequestContext {
                session_id: String::new(),
                turn_id: request_id.clone(),
                method: method.to_string(),
                emit_events: false,
            },
        );

        if let Err(e) = self.send_tx.send(data).await {
            self.pending_rpc.write().await.remove(&request_id);
            self.request_contexts.write().await.remove(&request_id);
            return Err(anyhow!("Failed to send message: {}", e));
        }

        let timeout = sleep(Duration::from_secs(8));
        tokio::pin!(timeout);
        tokio::select! {
            outcome = rx => {
                match outcome {
                    Ok(Ok(payload)) => Ok(payload),
                    Ok(Err(err)) => Err(anyhow!(err)),
                    Err(_) => Err(anyhow!("Gateway control request canceled")),
                }
            }
            _ = &mut timeout => {
                self.pending_rpc.write().await.remove(&request_id);
                self.request_contexts.write().await.remove(&request_id);
                Err(anyhow!("Gateway control request timeout: {}", method))
            }
        }
    }

    async fn abort_session_runs(&self, session_key: &str, run_id: Option<&str>) -> Result<bool> {
        let params = serde_json::json!({
            "sessionKey": session_key,
            "runId": run_id,
        });
        let payload = self.send_control_request("chat.abort", params).await?;
        Ok(payload
            .get("aborted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false))
    }

    async fn resolve_exec_approval(&self, request_id: &str, decision: &str) -> Result<()> {
        let params = serde_json::json!({
            "id": request_id,
            "decision": decision,
        });
        let _ = self
            .send_control_request("exec.approval.resolve", params)
            .await?;
        Ok(())
    }

    /// Connection loop with auto-reconnect
    async fn connection_loop(
        config: GatewayConfig,
        connected: Arc<AtomicBool>,
        handshake_done: Arc<tokio::sync::Notify>,
        event_sender: broadcast::Sender<AgentTurnEvent>,
        runtime_state: Arc<GatewayRuntimeState>,
        mut send_rx: mpsc::Receiver<Vec<u8>>,
    ) {
        let mut reconnect_delay = Duration::from_secs(1);
        let max_reconnect_delay = Duration::from_secs(30);

        loop {
            info!("[OpenClaw] Starting connection attempt...");

            runtime_state.session_states.write().await.clear();
            runtime_state.run_to_session.write().await.clear();

            let result = Self::connect_and_read(
                &config,
                &connected,
                &handshake_done,
                &event_sender,
                &runtime_state,
                &mut send_rx,
            )
            .await;

            match result {
                Ok(_) => {
                    info!("[OpenClaw] Connection closed normally");
                    reconnect_delay = Duration::from_secs(1);
                }
                Err(e) => {
                    error!("[OpenClaw] Connection error: {}", e);
                    if reconnect_delay < max_reconnect_delay {
                        reconnect_delay *= 2;
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);

            // Wait before reconnecting
            tokio::select! {
                _ = sleep(reconnect_delay) => {
                    info!("[OpenClaw] Reconnecting...");
                }
                _ = send_rx.recv() => {
                    // Channel closed, exit
                    info!("[OpenClaw] Send channel closed, stopping connection loop");
                    break;
                }
            }
        }
    }

    /// Connect and handle messages
    async fn connect_and_read(
        config: &GatewayConfig,
        connected: &Arc<AtomicBool>,
        handshake_done: &Arc<tokio::sync::Notify>,
        event_sender: &broadcast::Sender<AgentTurnEvent>,
        runtime_state: &Arc<GatewayRuntimeState>,
        send_rx: &mut mpsc::Receiver<Vec<u8>>,
    ) -> Result<()> {
        let url = format!("ws://127.0.0.1:{}", config.port);
        info!("[OpenClaw] Connecting to {}", url);

        let (ws_stream, _) = connect_async(&url).await.context("Failed to connect")?;

        let (mut write, mut read) = ws_stream.split();

        // Step 1: Wait for connect.challenge event to get the nonce
        let nonce = Self::wait_for_connect_challenge(&mut read).await?;

        // Step 2: Send connect request with device identity and nonce
        Self::send_connect_request(&mut write, &config.token, &config.device_identity, &nonce)
            .await?;

        // Step 3: Wait for connect response
        let connect_timeout = sleep(Duration::from_secs(10));
        tokio::pin!(connect_timeout);

        loop {
            tokio::select! {
                msg_result = read.next() => {
                    match msg_result {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                                let msg_type = json.get("type").and_then(|v| v.as_str());
                                let msg_id = json.get("id").and_then(|v| v.as_str());

                                if msg_type == Some("res") && msg_id == Some("connect") {
                                    let ok = json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                                    if ok {
                                        info!("[OpenClaw] Connect handshake succeeded");
                                        break;
                                    } else {
                                        let error = json.get("error")
                                            .and_then(|e| e.get("message"))
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown error");
                                        anyhow::bail!("Connect handshake failed: {}", error);
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Binary(data))) => {
                            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&data) {
                                let msg_type = json.get("type").and_then(|v| v.as_str());
                                let msg_id = json.get("id").and_then(|v| v.as_str());

                                if msg_type == Some("res") && msg_id == Some("connect") {
                                    let ok = json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                                    if ok {
                                        info!("[OpenClaw] Connect handshake succeeded");
                                        break;
                                    } else {
                                        let error = json.get("error")
                                            .and_then(|e| e.get("message"))
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown error");
                                        anyhow::bail!("Connect handshake failed: {}", error);
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) => {
                            anyhow::bail!("Connection closed during handshake");
                        }
                        Some(Ok(Message::Ping(data))) => {
                            let _ = write.send(Message::Pong(data)).await;
                        }
                        Some(Err(e)) => {
                            anyhow::bail!("Read error during handshake: {}", e);
                        }
                        None => {
                            anyhow::bail!("Stream ended during handshake");
                        }
                        _ => {}
                    }
                }
                _ = &mut connect_timeout => {
                    anyhow::bail!("Timeout waiting for connect response");
                }
            }
        }

        // Mark as connected and notify handshake done
        connected.store(true, Ordering::SeqCst);
        handshake_done.notify_waiters();
        info!("[OpenClaw] Connected to gateway, starting message loop");

        // Main message loop
        loop {
            tokio::select! {
                // Handle incoming messages
                msg_result = read.next() => {
                    match msg_result {
                        Some(Ok(Message::Text(text))) => {
                            handle_gateway_message(
                                &text,
                                event_sender,
                                runtime_state,
                            )
                            .await;
                        }
                        Some(Ok(Message::Binary(data))) => {
                            let text = String::from_utf8_lossy(&data);
                            handle_gateway_message(
                                &text,
                                event_sender,
                                runtime_state,
                            )
                            .await;
                        }
                        Some(Ok(Message::Close(_))) => {
                            info!("[OpenClaw] Connection closed by server");
                            break;
                        }
                        Some(Ok(Message::Ping(data))) => {
                            if let Err(e) = write.send(Message::Pong(data)).await {
                                error!("[OpenClaw] Failed to send pong: {}", e);
                                break;
                            }
                        }
                        Some(Err(e)) => {
                            error!("[OpenClaw] Read error: {}", e);
                            break;
                        }
                        None => {
                            info!("[OpenClaw] Stream ended");
                            break;
                        }
                        _ => {}
                    }
                }
                // Handle outgoing messages
                Some(data) = send_rx.recv() => {
                    let msg = Message::Text(String::from_utf8_lossy(&data).to_string().into());
                    if let Err(e) = write.send(msg).await {
                        error!("[OpenClaw] Failed to send message: {}", e);
                        break;
                    }
                }
            }
        }

        connected.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Wait for connect.challenge event and extract nonce
    async fn wait_for_connect_challenge(
        read: &mut futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
        >,
    ) -> Result<String> {
        let challenge_timeout = sleep(Duration::from_secs(10));
        tokio::pin!(challenge_timeout);

        loop {
            tokio::select! {
                msg_result = read.next() => {
                    match msg_result {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                                let msg_type = json.get("type").and_then(|v| v.as_str());
                                let event = json.get("event").and_then(|v| v.as_str());

                                if msg_type == Some("event") && event == Some("connect.challenge") {
                                    if let Some(payload) = json.get("payload")
                                        && let Some(nonce) =
                                            payload.get("nonce").and_then(|v| v.as_str())
                                    {
                                        info!("[OpenClaw] Received connect challenge with nonce");
                                        return Ok(nonce.to_string());
                                    }
                                    anyhow::bail!("connect.challenge missing nonce payload");
                                }
                            }
                        }
                        Some(Ok(Message::Binary(data))) => {
                            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&data) {
                                let msg_type = json.get("type").and_then(|v| v.as_str());
                                let event = json.get("event").and_then(|v| v.as_str());

                                if msg_type == Some("event") && event == Some("connect.challenge") {
                                    if let Some(payload) = json.get("payload")
                                        && let Some(nonce) =
                                            payload.get("nonce").and_then(|v| v.as_str())
                                    {
                                        info!("[OpenClaw] Received connect challenge with nonce");
                                        return Ok(nonce.to_string());
                                    }
                                    anyhow::bail!("connect.challenge missing nonce payload");
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) => {
                            anyhow::bail!("Connection closed while waiting for challenge");
                        }
                        Some(Ok(_)) => {}
                        Some(Err(e)) => {
                            anyhow::bail!("Error waiting for challenge: {}", e);
                        }
                        None => {
                            anyhow::bail!("Stream ended while waiting for challenge");
                        }
                    }
                }
                _ = &mut challenge_timeout => {
                    anyhow::bail!("Timeout waiting for connect.challenge");
                }
            }
        }
    }

    /// Send the initial connect handshake with v3 payload format
    async fn send_connect_request(
        write: &mut futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            Message,
        >,
        token: &str,
        device_identity: &DeviceIdentity,
        nonce: &str,
    ) -> Result<()> {
        let signed_at = chrono::Utc::now().timestamp_millis();

        // Build device auth payload (v3 format):
        // v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily
        let scopes_list = vec!["operator.read", "operator.write", "operator.admin"];
        let scopes_str = scopes_list.join(",");
        let platform = normalize_device_metadata(std::env::consts::OS);
        let device_family = normalize_device_metadata("server");
        let payload = format!(
            "v3|{}|gateway-client|backend|operator|{}|{}|{}|{}|{}|{}",
            device_identity.device_id, scopes_str, signed_at, token, nonce, platform, device_family
        );

        let signature = sign_device_payload(&device_identity.private_key, &payload);

        let connect_req = serde_json::json!({
            "type": "req",
            "id": "connect",
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "gateway-client",
                    "version": "0.3.0",
                    "platform": platform,
                    "deviceFamily": device_family,
                    "mode": "backend"
                },
                "role": "operator",
                "scopes": scopes_list,
                "auth": {
                    "token": token
                },
                "locale": "zh-CN",
                "userAgent": "irogen-openclaw",
                "device": {
                    "id": device_identity.device_id,
                    "publicKey": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(device_identity.public_key),
                    "signature": signature,
                    "signedAt": signed_at,
                    "nonce": nonce
                }
            }
        });

        info!(
            "[OpenClaw] Sending connect request for device: {}",
            device_identity.device_id
        );

        let data = serde_json::to_vec(&connect_req)?;
        write
            .send(Message::Binary(data.into()))
            .await
            .context("Failed to send connect request")?;

        Ok(())
    }
}

/// Handle incoming gateway messages and broadcast events
async fn handle_gateway_message(
    text: &str,
    event_sender: &broadcast::Sender<AgentTurnEvent>,
    runtime_state: &Arc<GatewayRuntimeState>,
) {
    let msg: serde_json::Value = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            error!("[OpenClaw] Failed to parse JSON: {}", e);
            return;
        }
    };

    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "res" => {
            let response_id = msg
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let ok = msg.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            let payload = msg.get("payload");

            let ctx = runtime_state
                .request_contexts
                .write()
                .await
                .remove(&response_id);
            if let Some(waiter) = runtime_state.pending_rpc.write().await.remove(&response_id) {
                if ok {
                    let _ = waiter.send(Ok(payload.cloned().unwrap_or(serde_json::Value::Null)));
                } else {
                    let err = msg
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();
                    let _ = waiter.send(Err(err));
                }
            }

            let emit_events = ctx.as_ref().map(|c| c.emit_events).unwrap_or(true);
            let method = ctx.as_ref().map(|c| c.method.as_str()).unwrap_or_default();
            if !emit_events || method != "agent" {
                return;
            }

            let session_id = ctx
                .as_ref()
                .map(|c| c.session_id.clone())
                .or_else(|| extract_session_key(payload))
                .unwrap_or_else(|| "default".to_string());
            let turn_id = ctx
                .as_ref()
                .map(|c| c.turn_id.clone())
                .or_else(|| extract_turn_id(payload))
                .unwrap_or_else(|| response_id.clone());

            if ok {
                let status = payload
                    .and_then(|p| p.get("status"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("ok")
                    .to_string()
                    .to_lowercase();

                let content = payload
                    .and_then(extract_text_from_payload)
                    .unwrap_or_default();
                if !content.is_empty() {
                    let previous =
                        read_last_content(&runtime_state.session_states, &session_id).await;
                    let delta = compute_incremental_delta(&previous, &content);
                    if !delta.is_empty() {
                        emit_event(
                            event_sender,
                            &turn_id,
                            AgentEvent::TextDelta {
                                session_id: session_id.clone(),
                                text: delta,
                            },
                        );
                        write_last_content(
                            &runtime_state.session_states,
                            &session_id,
                            content,
                            &turn_id,
                        )
                        .await;
                    }
                }

                if status == "ok" {
                    emit_event(
                        event_sender,
                        &turn_id,
                        AgentEvent::TurnCompleted {
                            session_id: session_id.clone(),
                            result: payload.and_then(|v| serde_json::to_string(&v).ok()),
                        },
                    );
                    clear_session_state(&runtime_state.session_states, &session_id).await;
                } else if status == "error" {
                    let error = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .or_else(|| {
                            payload
                                .and_then(|p| p.get("error"))
                                .and_then(|v| v.as_str())
                        })
                        .unwrap_or("OpenClaw request failed")
                        .to_string();
                    emit_event(
                        event_sender,
                        &turn_id,
                        AgentEvent::TurnError {
                            session_id: session_id.clone(),
                            error,
                            code: None,
                        },
                    );
                    clear_session_state(&runtime_state.session_states, &session_id).await;
                } else {
                    // status is "accepted" or other, wait for events
                    info!(
                        "[OpenClaw] Agent request accepted, waiting for events (turn_id: {})",
                        turn_id
                    );
                    return; // Don't clear session state yet
                }
            } else {
                let error = msg
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string();
                emit_event(
                    event_sender,
                    &turn_id,
                    AgentEvent::TurnError {
                        session_id: session_id.clone(),
                        error,
                        code: None,
                    },
                );
                clear_session_state(&runtime_state.session_states, &session_id).await;
            }
        }
        "event" => {
            let event_name = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
            let payload = msg.get("payload");

            let mut turn_id = extract_turn_id(payload).unwrap_or_default();
            let session_id_from_payload = extract_session_key(payload);

            let session_id = if let Some(sid) = session_id_from_payload {
                sid
            } else if !turn_id.is_empty() {
                runtime_state
                    .run_to_session
                    .read()
                    .await
                    .get(&turn_id)
                    .cloned()
                    .unwrap_or_else(|| "default".to_string())
            } else {
                "default".to_string()
            };

            if turn_id.is_empty() {
                turn_id = resolve_turn_id(&runtime_state.session_states, &session_id).await;
            }

            match event_name {
                "agent" => {
                    let stream = payload
                        .and_then(|p| p.get("stream"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let data = payload.and_then(|p| p.get("data"));

                    match stream {
                        "assistant" => {
                            let cumulative = data
                                .and_then(|d| d.get("text"))
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();
                            let raw_delta = data
                                .and_then(|d| d.get("delta"))
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string();

                            let delta = if !raw_delta.is_empty() {
                                raw_delta.clone()
                            } else {
                                compute_incremental_delta(
                                    &read_last_content(&runtime_state.session_states, &session_id)
                                        .await,
                                    &cumulative,
                                )
                            };

                            if !delta.is_empty() {
                                emit_event(
                                    event_sender,
                                    &turn_id,
                                    AgentEvent::TextDelta {
                                        session_id: session_id.clone(),
                                        text: delta,
                                    },
                                );
                                write_last_content(
                                    &runtime_state.session_states,
                                    &session_id,
                                    if !cumulative.is_empty() {
                                        cumulative
                                    } else {
                                        // If we only have delta, we should ideally accumulate it in last_content
                                        let prev = read_last_content(
                                            &runtime_state.session_states,
                                            &session_id,
                                        )
                                        .await;
                                        format!("{}{}", prev, raw_delta)
                                    },
                                    &turn_id,
                                )
                                .await;
                            }
                        }
                        "lifecycle" => {
                            let phase = data
                                .and_then(|d| d.get("phase"))
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();

                            if phase == "start" {
                                set_session_turn(
                                    &runtime_state.session_states,
                                    &session_id,
                                    &turn_id,
                                )
                                .await;
                                emit_event(
                                    event_sender,
                                    &turn_id,
                                    AgentEvent::TurnStarted {
                                        session_id: session_id.clone(),
                                        turn_id: turn_id.clone(),
                                    },
                                );
                            } else if phase == "end" {
                                emit_event(
                                    event_sender,
                                    &turn_id,
                                    AgentEvent::TurnCompleted {
                                        session_id: session_id.clone(),
                                        result: payload
                                            .and_then(|v| serde_json::to_string(&v).ok()),
                                    },
                                );
                                clear_session_state(&runtime_state.session_states, &session_id)
                                    .await;
                            }
                        }
                        "error" | "failed" | "cancelled" => {
                            let error = data
                                .and_then(|d| d.get("message"))
                                .and_then(|v| v.as_str())
                                .or_else(|| {
                                    data.and_then(|d| d.get("error")).and_then(|v| v.as_str())
                                })
                                .unwrap_or("OpenClaw run failed")
                                .to_string();
                            emit_event(
                                event_sender,
                                &turn_id,
                                AgentEvent::TurnError {
                                    session_id: session_id.clone(),
                                    error,
                                    code: None,
                                },
                            );
                            clear_session_state(&runtime_state.session_states, &session_id).await;
                        }
                        _ => {
                            // Handle usage and cost in metadata if available
                            if let Some(meta) = data
                                .and_then(|d| d.get("meta"))
                                .or_else(|| payload.and_then(|p| p.get("meta")))
                            {
                                emit_usage_update(event_sender, &session_id, meta);
                            }
                        }
                    }
                }
                "tool_started" => {
                    let tool_name = payload
                        .and_then(|p| p.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let input = payload
                        .and_then(|p| p.get("input"))
                        .and_then(|v| serde_json::to_string(v).ok());
                    let tool_id = payload
                        .and_then(|p| p.get("tool_id"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                    emit_event(
                        event_sender,
                        &turn_id,
                        AgentEvent::ToolStarted {
                            session_id: session_id.clone(),
                            tool_id,
                            tool_name,
                            input,
                        },
                    );
                }
                "tool_completed" => {
                    let tool_name = payload
                        .and_then(|p| p.get("name"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned);
                    let output = payload
                        .and_then(|p| p.get("output"))
                        .and_then(|v| serde_json::to_string(v).ok());
                    let error = payload
                        .and_then(|p| p.get("error"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned);
                    let tool_id = payload
                        .and_then(|p| p.get("tool_id"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                    emit_event(
                        event_sender,
                        &turn_id,
                        AgentEvent::ToolCompleted {
                            session_id: session_id.clone(),
                            tool_id,
                            tool_name,
                            output,
                            error,
                        },
                    );
                }
                "permission_request" => {
                    let request_id = payload
                        .and_then(|p| p.get("request_id"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    let tool_name = payload
                        .and_then(|p| p.get("tool_name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let tool_params = payload
                        .and_then(|p| p.get("tool_params"))
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let message = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned);

                    runtime_state.pending_permissions.write().await.insert(
                        request_id.clone(),
                        PendingPermission {
                            request_id: request_id.clone(),
                            session_id: session_id.clone(),
                            tool_name: tool_name.clone(),
                            tool_params: tool_params.clone(),
                            message: message.clone(),
                            created_at: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs(),
                            response_tx: None,
                        },
                    );

                    emit_event(
                        event_sender,
                        &turn_id,
                        AgentEvent::ApprovalRequest {
                            session_id: session_id.clone(),
                            request_id,
                            tool_name,
                            input: Some(
                                serde_json::to_string(&tool_params)
                                    .unwrap_or_else(|_| "{}".to_string()),
                            ),
                            message,
                        },
                    );
                }
                "exec.approval.requested" => {
                    let approval_id = payload
                        .and_then(|p| p.get("id"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    let request = payload.and_then(|p| p.get("request"));
                    let approval_session_id = request
                        .and_then(|r| r.get("sessionKey"))
                        .and_then(|v| v.as_str())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| session_id.clone());
                    let command = request
                        .and_then(|r| r.get("command"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("exec");
                    let message = Some(format!("Exec approval required: {}", command));
                    let tool_params = request.cloned().unwrap_or(serde_json::Value::Null);

                    runtime_state.pending_permissions.write().await.insert(
                        approval_id.clone(),
                        PendingPermission {
                            request_id: approval_id.clone(),
                            session_id: approval_session_id.clone(),
                            tool_name: "exec".to_string(),
                            tool_params: tool_params.clone(),
                            message: message.clone(),
                            created_at: std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs(),
                            response_tx: None,
                        },
                    );

                    emit_event(
                        event_sender,
                        &turn_id,
                        AgentEvent::ApprovalRequest {
                            session_id: approval_session_id,
                            request_id: approval_id,
                            tool_name: "exec".to_string(),
                            input: Some(
                                serde_json::to_string(&tool_params)
                                    .unwrap_or_else(|_| "{}".to_string()),
                            ),
                            message,
                        },
                    );
                }
                "exec.approval.resolved" => {
                    let approval_id = payload
                        .and_then(|p| p.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if !approval_id.is_empty() {
                        runtime_state
                            .pending_permissions
                            .write()
                            .await
                            .remove(&approval_id);
                    }
                }
                "error" | "agent.error" | "agent.abort" => {
                    let error = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .or_else(|| {
                            payload
                                .and_then(|p| p.get("error"))
                                .and_then(|v| v.as_str())
                        })
                        .or_else(|| {
                            payload
                                .and_then(|p| p.get("errorMessage"))
                                .and_then(|v| v.as_str())
                        })
                        .unwrap_or("Unknown error")
                        .to_string();
                    emit_event(
                        event_sender,
                        &turn_id,
                        AgentEvent::TurnError {
                            session_id: session_id.clone(),
                            error,
                            code: None,
                        },
                    );
                    clear_session_state(&runtime_state.session_states, &session_id).await;
                }
                "connected" | "progress" | "complete" | "connect.challenge"
                | "gateway.response" => {
                    // Control events, ignore
                }
                "health" | "ticket" => {
                    emit_event(
                        event_sender,
                        "system",
                        AgentEvent::Notification {
                            session_id,
                            level: crate::message_protocol::NotificationLevel::Info,
                            message: event_name.to_string(),
                            details: payload.and_then(|v| serde_json::to_string(&v).ok()),
                        },
                    );
                }
                _ => {
                    debug!(
                        "[OpenClaw] Unknown event '{}', payload: {:?}",
                        event_name, payload
                    );
                }
            }
        }
        _ => {
            debug!(
                "[OpenClaw] Unknown message type '{}', body: {}",
                msg_type, text
            );
        }
    }
}

fn emit_event(event_sender: &broadcast::Sender<AgentTurnEvent>, turn_id: &str, event: AgentEvent) {
    let _ = event_sender.send(AgentTurnEvent {
        turn_id: turn_id.to_string(),
        event,
    });
}

fn emit_usage_update(
    event_sender: &broadcast::Sender<AgentTurnEvent>,
    session_id: &str,
    meta: &serde_json::Value,
) {
    let agent_meta = meta.get("agentMeta").unwrap_or(meta);
    let usage = agent_meta.get("usage").unwrap_or(meta);

    let input_tokens = usage
        .get("inputTokens")
        .or_else(|| usage.get("input"))
        .and_then(|v| v.as_i64());
    let output_tokens = usage
        .get("outputTokens")
        .or_else(|| usage.get("output"))
        .and_then(|v| v.as_i64());
    let cached_tokens = usage
        .get("cachedInputTokens")
        .or_else(|| usage.get("cacheRead"))
        .and_then(|v| v.as_i64());

    if input_tokens.is_some() || output_tokens.is_some() {
        emit_event(
            event_sender,
            "usage",
            AgentEvent::UsageUpdate {
                session_id: session_id.to_string(),
                input_tokens,
                output_tokens,
                cached_tokens,
                model_context_window: None,
            },
        );
    }
}

async fn set_session_turn(
    session_states: &Arc<RwLock<HashMap<String, SessionStreamState>>>,
    session_id: &str,
    turn_id: &str,
) {
    let mut states = session_states.write().await;
    let state = states.entry(session_id.to_string()).or_default();
    state.turn_id = Some(turn_id.to_string());
    state.last_content.clear();
}

async fn resolve_turn_id(
    session_states: &Arc<RwLock<HashMap<String, SessionStreamState>>>,
    session_id: &str,
) -> String {
    let states = session_states.read().await;
    states
        .get(session_id)
        .and_then(|s| s.turn_id.clone())
        .unwrap_or_else(|| format!("stream:{}", session_id))
}

async fn read_last_content(
    session_states: &Arc<RwLock<HashMap<String, SessionStreamState>>>,
    session_id: &str,
) -> String {
    let states = session_states.read().await;
    states
        .get(session_id)
        .map(|s| s.last_content.clone())
        .unwrap_or_default()
}

async fn write_last_content(
    session_states: &Arc<RwLock<HashMap<String, SessionStreamState>>>,
    session_id: &str,
    content: String,
    turn_id: &str,
) {
    let mut states = session_states.write().await;
    let state = states.entry(session_id.to_string()).or_default();
    state.turn_id = Some(turn_id.to_string());
    state.last_content = content;
}

async fn clear_session_state(
    session_states: &Arc<RwLock<HashMap<String, SessionStreamState>>>,
    session_id: &str,
) {
    let mut states = session_states.write().await;
    states.remove(session_id);
}

fn compute_incremental_delta(previous: &str, current: &str) -> String {
    if current.is_empty() {
        return String::new();
    }
    if previous.is_empty() {
        return current.to_string();
    }
    if let Some(stripped) = current.strip_prefix(previous) {
        stripped.to_string()
    } else if current != previous {
        current.to_string()
    } else {
        String::new()
    }
}

fn extract_session_key(payload: Option<&serde_json::Value>) -> Option<String> {
    let payload = payload?;
    payload
        .get("sessionKey")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("session").and_then(|v| v.as_str()))
        .or_else(|| {
            payload
                .get("message")
                .and_then(|m| m.get("sessionKey"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            payload
                .get("message")
                .and_then(|m| m.get("session"))
                .and_then(|v| v.as_str())
        })
        .map(ToOwned::to_owned)
}

fn extract_turn_id(payload: Option<&serde_json::Value>) -> Option<String> {
    let payload = payload?;
    payload
        .get("runId")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("turnId").and_then(|v| v.as_str()))
        .or_else(|| {
            payload
                .get("message")
                .and_then(|m| m.get("runId"))
                .and_then(|v| v.as_str())
        })
        .map(ToOwned::to_owned)
}

fn extract_text_from_payload(payload: &serde_json::Value) -> Option<String> {
    payload
        .get("content")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .or_else(|| {
            payload
                .get("text")
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            payload
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            payload
                .get("message")
                .and_then(|m| m.get("text"))
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            payload
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|v| v.as_array())
                .and_then(|items| items.first())
                .and_then(|item| item.get("text"))
                .and_then(|v| v.as_str())
                .map(ToOwned::to_owned)
        })
}
