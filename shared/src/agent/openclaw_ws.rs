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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use sha2::{Digest, Sha256};
use tokio::sync::{RwLock, broadcast, mpsc, oneshot};
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info};
use uuid::Uuid;

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
    /// Event broadcaster for all sessions
    event_sender: broadcast::Sender<AgentTurnEvent>,
    /// Channel to send messages to the gateway
    send_tx: Arc<RwLock<Option<mpsc::Sender<Vec<u8>>>>>,
    /// Request ID counter
    request_counter: Arc<AtomicU64>,
    /// Pending permissions
    pending_permissions: Arc<RwLock<HashMap<String, PendingPermission>>>,
    /// Active turn tracking
    active_turn: Arc<RwLock<Option<String>>>,
    /// Shutdown signal
    shutdown_tx: Arc<RwLock<Option<mpsc::Sender<()>>>>,
    /// Gateway config
    config: GatewayConfig,
}

/// OpenClaw session - represents a single user's session
pub struct OpenClawWsSession {
    /// Session ID
    session_id: String,
    /// Agent type
    agent_type: AgentType,
    /// Session key for gateway (maps to session_id)
    _session_key: String,
    /// Event broadcaster for this session
    event_sender: broadcast::Sender<AgentTurnEvent>,
    /// Command channel for this session
    command_tx: mpsc::UnboundedSender<SessionCommand>,
    /// Permission mode for this session (stored locally for UI consistency)
    permission_mode: Arc<RwLock<super::permission_handler::PermissionMode>>,
}

/// Commands from session to manager
#[derive(Debug)]
#[allow(dead_code)]
enum SessionCommand {
    /// Send a prompt
    Prompt {
        text: String,
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Cancel current operation
    Cancel {
        response_tx: oneshot::Sender<std::result::Result<(), String>>,
    },
    /// Shutdown this session
    Shutdown,
}

/// Gateway configuration
#[derive(Debug, Clone)]
struct GatewayConfig {
    port: u16,
    token: String,
    agent_id: String,
    device_identity: DeviceIdentity,
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

    // Generate new identity
    let mut rng = rand::rng();
    let mut private_key_arr = [0u8; 32];
    let mut public_key_arr = [0u8; 32];
    rng.fill_bytes(&mut private_key_arr);
    public_key_arr.copy_from_slice(&private_key_arr);

    let device_id = compute_device_id(&public_key_arr);

    if let Some(parent) = identity_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

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

fn compute_device_id(public_key: &[u8; 32]) -> String {
    let hash = Sha256::digest(public_key);
    hex::encode(hash)
}

fn sign_device_payload(private_key: &[u8; 32], payload: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(private_key);
    hasher.update(payload.as_bytes());
    let hash = hasher.finalize();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash)
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

        // Register this session with the manager
        let session_key = session_id.clone();
        manager.register_session(session_key.clone()).await;

        let (event_sender, _) = broadcast::channel(1024);
        let (command_tx, command_rx) = mpsc::unbounded_channel();

        // Spawn task to handle commands for this session
        let session_id_clone = session_id.clone();
        let session_key_clone = session_key.clone();
        let manager_clone = manager.clone();
        let event_sender_clone = event_sender.clone();

        tokio::spawn(async move {
            handle_session_commands(
                session_id_clone,
                session_key_clone,
                manager_clone,
                event_sender_clone,
                command_rx,
            )
            .await;
        });

        Ok(Self {
            session_id,
            agent_type,
            _session_key: session_key,
            event_sender,
            command_tx,
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
        _turn_id: &str,
        _attachments: Vec<String>,
    ) -> std::result::Result<(), String> {
        let (response_tx, response_rx) = oneshot::channel();

        self.command_tx
            .send(SessionCommand::Prompt { text, response_tx })
            .map_err(|e| format!("Failed to send command: {}", e))?;

        response_rx
            .await
            .map_err(|e| format!("Command channel closed: {}", e))?
    }

    pub async fn interrupt(&self) -> std::result::Result<(), String> {
        // For now, interrupt is handled at manager level
        Ok(())
    }

    pub async fn get_pending_permissions(
        &self,
    ) -> std::result::Result<Vec<PendingPermission>, String> {
        // Get from manager
        Ok(vec![])
    }

    pub async fn respond_to_permission(
        &self,
        _request_id: String,
        _approved: bool,
        _approve_for_session: bool,
        _reason: Option<String>,
    ) -> std::result::Result<(), String> {
        Ok(())
    }

    pub async fn shutdown(&self) -> std::result::Result<(), String> {
        self.command_tx
            .send(SessionCommand::Shutdown)
            .map_err(|e| format!("Failed to send shutdown: {}", e))?;
        Ok(())
    }
}

/// Get or create the singleton gateway manager
async fn get_or_create_gateway_manager() -> Result<Arc<OpenClawGatewayManager>> {
    // First try to get existing
    {
        let guard = GATEWAY_MANAGER.read().await;
        if let Some(manager) = guard.as_ref() {
            if manager.is_connected() {
                return Ok(manager.clone());
            }
        }
    }

    // Need to create new manager
    let mut guard = GATEWAY_MANAGER.write().await;

    // Double-check after acquiring write lock
    if let Some(manager) = guard.as_ref() {
        if manager.is_connected() {
            return Ok(manager.clone());
        }
    }

    // Load config
    let config = load_gateway_config().ok_or_else(|| {
        anyhow!("No OpenClaw gateway config found. Create ~/.openclaw/openclaw.json")
    })?;

    // Create new manager
    let manager = Arc::new(OpenClawGatewayManager::new(config)?);

    // Start the connection
    manager.connect().await?;

    *guard = Some(manager.clone());

    Ok(manager)
}

impl OpenClawGatewayManager {
    fn new(config: GatewayConfig) -> Result<Self> {
        let (event_sender, _) = broadcast::channel(1024);

        Ok(Self {
            connected: Arc::new(AtomicBool::new(false)),
            event_sender,
            send_tx: Arc::new(RwLock::new(None)),
            request_counter: Arc::new(AtomicU64::new(0)),
            pending_permissions: Arc::new(RwLock::new(HashMap::new())),
            active_turn: Arc::new(RwLock::new(None)),
            shutdown_tx: Arc::new(RwLock::new(None)),
            config,
        })
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    async fn register_session(&self, _session_key: String) {
        // Register session - for now just ensure we're connected
        info!("[OpenClaw] Session registered");
    }

    async fn connect(&self) -> Result<()> {
        let url = format!("ws://127.0.0.1:{}", self.config.port);
        info!("[OpenClaw] Connecting to Gateway at {}", url);

        let (ws_stream, _) = connect_async(&url)
            .await
            .context("Failed to connect to Gateway")?;

        let (mut write, mut read) = ws_stream.split();

        // Send connect request
        self.send_connect_request(&mut write).await?;

        // Wait for connect response
        let timeout = sleep(Duration::from_secs(10));
        tokio::pin!(timeout);

        #[allow(unused_assignments)]
        let mut handshake_ok = false;

        loop {
            tokio::select! {
                msg_result = read.next() => {
                    match msg_result {
                        Some(Ok(Message::Text(text))) => {
                            let json: serde_json::Value = serde_json::from_str(&text).ok()
                                .unwrap_or(serde_json::Value::Null);

                            if json.get("type").and_then(|v| v.as_str()) == Some("res")
                                && json.get("id").and_then(|v| v.as_str()) == Some("connect")
                            {
                                let ok = json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                                if ok {
                                    info!("[OpenClaw] Connect handshake succeeded");
                                    handshake_ok = true;
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
                        Some(Ok(Message::Binary(data))) => {
                            let json: serde_json::Value = serde_json::from_slice(&data).ok()
                                .unwrap_or(serde_json::Value::Null);

                            if json.get("type").and_then(|v| v.as_str()) == Some("res")
                                && json.get("id").and_then(|v| v.as_str()) == Some("connect")
                            {
                                let ok = json.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                                if ok {
                                    info!("[OpenClaw] Connect handshake succeeded");
                                    handshake_ok = true;
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
                        Some(Ok(Message::Close(_))) => {
                            anyhow::bail!("Connection closed during handshake");
                        }
                        Some(Ok(Message::Ping(data))) => {
                            let _ = write.send(Message::Pong(data)).await;
                        }
                        None | Some(Err(_)) => {
                            anyhow::bail!("Stream ended during handshake");
                        }
                        _ => {}
                    }
                }
                _ = &mut timeout => {
                    anyhow::bail!("Timeout waiting for connect response");
                }
            }
        }

        if !handshake_ok {
            anyhow::bail!("Handshake failed");
        }

        self.connected.store(true, Ordering::SeqCst);

        // Create channels
        let (tx, rx) = mpsc::channel::<Vec<u8>>(100);
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);

        *self.send_tx.write().await = Some(tx);
        *self.shutdown_tx.write().await = Some(shutdown_tx);

        // Spawn message loop
        let connected = self.connected.clone();
        let event_sender = self.event_sender.clone();
        let request_counter = self.request_counter.clone();
        let pending_permissions = self.pending_permissions.clone();
        let active_turn = self.active_turn.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            gateway_message_loop(
                read,
                write,
                connected,
                event_sender,
                request_counter,
                pending_permissions,
                active_turn,
                config,
                rx,
                shutdown_rx,
            )
            .await;
        });

        info!("[OpenClaw] Gateway connected and running");
        Ok(())
    }

    async fn send_connect_request(
        &self,
        write: &mut futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
            >,
            Message,
        >,
    ) -> Result<()> {
        let signed_at = chrono::Utc::now().timestamp_millis();
        let scopes = "operator.read,operator.write,operator.admin";
        let payload = format!(
            "v1|{}|gateway-client|backend|operator|{}|{}|{}",
            self.config.device_identity.device_id, scopes, signed_at, self.config.token
        );
        let signature = sign_device_payload(&self.config.device_identity.private_key, &payload);

        let connect_req = serde_json::json!({
            "type": "req",
            "id": "connect",
            "method": "connect",
            "params": {
                "minProtocol": 3,
                "maxProtocol": 3,
                "client": {
                    "id": "gateway-client",
                    "version": "0.2.0",
                    "platform": "linux",
                    "mode": "backend"
                },
                "role": "operator",
                "scopes": ["operator.read", "operator.write", "operator.admin"],
                "auth": {
                    "token": self.config.token
                },
                "locale": "zh-CN",
                "userAgent": "riterm-openclaw",
                "device": {
                    "id": self.config.device_identity.device_id,
                    "publicKey": base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(self.config.device_identity.public_key),
                    "signature": signature,
                    "signedAt": signed_at
                }
            }
        });

        info!("[OpenClaw] Sending connect request");

        let data = serde_json::to_vec(&connect_req)?;
        write
            .send(Message::Binary(bytes::Bytes::from(data)))
            .await
            .context("Failed to send connect request")?;

        Ok(())
    }

    /// Send a message to the agent
    pub async fn send_agent_message(&self, text: String, session_key: String) -> Result<String> {
        let _request_id = self.request_counter.fetch_add(1, Ordering::SeqCst);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        let request = serde_json::json!({
            "type": "req",
            "id": format!("agent:{}", now),
            "method": "agent",
            "params": {
                "message": text,
                "agentId": self.config.agent_id,
                "sessionKey": session_key,
                "deliver": true,
                "idempotencyKey": format!("{}", now)
            }
        });

        if let Some(tx) = self.send_tx.read().await.as_ref() {
            tx.send(serde_json::to_vec(&request)?)
                .await
                .map_err(|e| anyhow!("Failed to send: {}", e))?;
        }

        Ok(format!("agent:{}", now))
    }
}

/// Handle commands for a single session
async fn handle_session_commands(
    session_id: String,
    session_key: String,
    manager: Arc<OpenClawGatewayManager>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    mut command_rx: mpsc::UnboundedReceiver<SessionCommand>,
) {
    while let Some(cmd) = command_rx.recv().await {
        match cmd {
            SessionCommand::Prompt { text, response_tx } => {
                match manager.send_agent_message(text, session_key.clone()).await {
                    Ok(turn_id) => {
                        let _ = event_sender.send(AgentTurnEvent {
                            turn_id: turn_id.clone(),
                            event: AgentEvent::TurnStarted {
                                session_id: session_id.clone(),
                                turn_id,
                            },
                        });
                        let _ = response_tx.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = response_tx.send(Err(e.to_string()));
                    }
                }
            }
            SessionCommand::Cancel { response_tx } => {
                // TODO: Implement cancel
                let _ = response_tx.send(Ok(()));
            }
            SessionCommand::Shutdown => {
                info!("[OpenClaw] Session {} shutdown", session_id);
                break;
            }
        }
    }
}

/// Main message loop for the gateway connection
async fn gateway_message_loop(
    mut read: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
    mut write: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    connected: Arc<AtomicBool>,
    event_sender: broadcast::Sender<AgentTurnEvent>,
    _request_counter: Arc<AtomicU64>,
    pending_permissions: Arc<RwLock<HashMap<String, PendingPermission>>>,
    active_turn: Arc<RwLock<Option<String>>>,
    _config: GatewayConfig,
    mut rx: mpsc::Receiver<Vec<u8>>,
    mut shutdown_rx: mpsc::Receiver<()>,
) {
    loop {
        tokio::select! {
            // Handle incoming messages
            msg_result = read.next() => {
                match msg_result {
                    Some(Ok(Message::Text(text))) => {
                        handle_gateway_message(
                            &text.to_string(),
                            &event_sender,
                            &pending_permissions,
                            &active_turn,
                        ).await;
                    }
                    Some(Ok(Message::Binary(data))) => {
                        let text = String::from_utf8_lossy(&data).to_string();
                        handle_gateway_message(
                            &text,
                            &event_sender,
                            &pending_permissions,
                            &active_turn,
                        ).await;
                    }
                    Some(Ok(Message::Close(_))) => {
                        info!("[OpenClaw] Gateway connection closed");
                        connected.store(false, Ordering::SeqCst);
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
            Some(data) = rx.recv() => {
                match String::from_utf8(data.clone()) {
                    Ok(text) => {
                        if let Err(e) = write.send(Message::Text(text.into())).await {
                            error!("[OpenClaw] Failed to send: {}", e);
                            break;
                        }
                    }
                    Err(_) => {
                        if let Err(e) = write.send(Message::Binary(bytes::Bytes::from(data))).await {
                            error!("[OpenClaw] Failed to send binary: {}", e);
                            break;
                        }
                    }
                }
            }
            // Handle shutdown
            _ = shutdown_rx.recv() => {
                info!("[OpenClaw] Gateway manager shutdown");
                break;
            }
        }
    }

    connected.store(false, Ordering::SeqCst);
}

/// Handle incoming gateway messages
async fn handle_gateway_message(
    text: &str,
    event_sender: &broadcast::Sender<AgentTurnEvent>,
    pending_permissions: &Arc<RwLock<HashMap<String, PendingPermission>>>,
    active_turn: &Arc<RwLock<Option<String>>>,
) {
    debug!("OpenClaw gateway message: {}", text);

    let msg: serde_json::Value = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(_) => return,
    };

    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "res" => {
            let id = msg.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let ok = msg.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);

            if ok {
                if let Some(payload) = msg.get("payload") {
                    if let Some(content) = payload.get("content").and_then(|v| v.as_str()) {
                        let _ = event_sender.send(AgentTurnEvent {
                            turn_id: id.to_string(),
                            event: AgentEvent::TextDelta {
                                text: content.to_string(),
                                session_id: "default".to_string(),
                            },
                        });
                    }
                }

                *active_turn.write().await = None;
                let _ = event_sender.send(AgentTurnEvent {
                    turn_id: id.to_string(),
                    event: AgentEvent::TurnCompleted {
                        session_id: "default".to_string(),
                        result: None,
                    },
                });
            } else {
                let error = msg
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                let _ = event_sender.send(AgentTurnEvent {
                    turn_id: id.to_string(),
                    event: AgentEvent::TurnError {
                        session_id: "default".to_string(),
                        error: error.to_string(),
                        code: None,
                    },
                });
            }
        }
        "event" => {
            let event_name = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
            let payload = msg.get("payload");

            match event_name {
                "tool_started" => {
                    let tool_name = payload
                        .and_then(|p| p.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let input = payload.and_then(|p| p.get("input")).cloned();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::ToolStarted {
                            tool_id: Uuid::new_v4().to_string(),
                            tool_name,
                            input,
                            session_id: "default".to_string(),
                        },
                    });
                }
                "tool_completed" => {
                    let tool_name = payload
                        .and_then(|p| p.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let output = payload.and_then(|p| p.get("output")).cloned();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::ToolCompleted {
                            tool_id: Uuid::new_v4().to_string(),
                            tool_name: Some(tool_name),
                            output,
                            session_id: "default".to_string(),
                            error: None,
                        },
                    });
                }
                "text_delta" => {
                    let text = payload
                        .and_then(|p| p.get("text"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::TextDelta {
                            text,
                            session_id: "default".to_string(),
                        },
                    });
                }
                "permission_request" => {
                    let request_id = payload
                        .and_then(|p| p.get("request_id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let tool_name = payload
                        .and_then(|p| p.get("tool_name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let message = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let permission = PendingPermission {
                        request_id: request_id.clone(),
                        session_id: "default".to_string(),
                        tool_name,
                        tool_params: serde_json::Value::Null,
                        message,
                        created_at: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs(),
                        response_tx: None,
                    };

                    pending_permissions
                        .write()
                        .await
                        .insert(request_id.clone(), permission);

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::ApprovalRequest {
                            session_id: "default".to_string(),
                            request_id,
                            tool_name: "unknown".to_string(),
                            message: None,
                            input: None,
                        },
                    });
                }
                "error" => {
                    let error = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error")
                        .to_string();

                    let _ = event_sender.send(AgentTurnEvent {
                        turn_id: Uuid::new_v4().to_string(),
                        event: AgentEvent::TurnError {
                            session_id: "default".to_string(),
                            error,
                            code: None,
                        },
                    });
                }
                "connected" | "progress" | "complete" => {
                    debug!("Skipping control event: {}", event_name);
                }
                _ => {
                    debug!("Unknown gateway event: {}", event_name);
                }
            }
        }
        _ => {}
    }
}
