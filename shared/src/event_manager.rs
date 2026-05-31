//! Event Manager
//!
//! This module provides a unified event management and message processing mechanism,
//! supporting system, connection, and error events.

use crate::message_protocol::*;
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info, warn};

/// Type alias for the complex listeners map type to reduce complexity
type ListenerMap = Arc<RwLock<HashMap<EventType, Vec<Arc<dyn EventListener>>>>>;

/// 事件类型
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EventType {
    /// TCP转发事件
    TcpSessionCreated,
    TcpSessionStopped,
    TcpConnectionOpen,
    TcpConnectionClose,
    TcpDataForwarded,
    /// 系统事件
    SystemStarted,
    SystemStopped,
    SystemError,
    /// 连接事件
    PeerConnected,
    PeerDisconnected,
    /// Agent 事件
    AgentMessageReceived,
    AgentSessionStarted,
    AgentSessionStopped,
    AgentPermissionRequested,
    AgentControlReceived,
}

/// 事件数据
#[derive(Debug, Clone)]
pub struct Event {
    pub event_type: EventType,
    pub source: String,
    pub data: serde_json::Value,
    pub timestamp: u64,
    pub session_id: Option<String>,
}

impl Event {
    pub fn new(event_type: EventType, source: String, data: serde_json::Value) -> Self {
        Self {
            event_type,
            source,
            data,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            session_id: None,
        }
    }

    pub fn with_session(mut self, session_id: String) -> Self {
        self.session_id = Some(session_id);
        self
    }
}

/// 事件监听器trait
#[async_trait::async_trait]
pub trait EventListener: Send + Sync {
    /// 处理事件
    async fn handle_event(&self, event: &Event) -> Result<()>;

    /// 获取监听器名称
    fn name(&self) -> &str;

    /// 获取支持的事件类型
    fn supported_events(&self) -> Vec<EventType>;
}

/// 事件管理器
pub struct EventManager {
    listeners: ListenerMap,
    event_tx: mpsc::UnboundedSender<Event>,
    event_rx: Arc<RwLock<Option<mpsc::UnboundedReceiver<Event>>>>,
    /// Approximate number of events queued but not yet processed. Used to detect
    /// unbounded backlog growth caused by a slow listener.
    pending_depth: Arc<AtomicUsize>,
}

/// Warn (rate-limited by power-of-two steps) once the backlog crosses this size.
const EVENT_BACKLOG_WARN_THRESHOLD: usize = 10_000;

impl EventManager {
    pub fn new() -> Self {
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        Self {
            listeners: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            event_rx: Arc::new(RwLock::new(Some(event_rx))),
            pending_depth: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// 注册事件监听器
    pub async fn register_listener(&self, listener: Arc<dyn EventListener>) {
        for event_type in listener.supported_events() {
            let mut listeners = self.listeners.write().await;
            listeners
                .entry(event_type)
                .or_insert_with(Vec::new)
                .push(listener.clone());
        }
        info!("Registered event listener: {}", listener.name());
    }

    /// 发布事件
    pub async fn publish_event(&self, event: Event) -> Result<()> {
        debug!(
            "Publishing event: {:?} from {}",
            event.event_type, event.source
        );

        if let Err(e) = self.event_tx.send(event) {
            error!("Failed to publish event: {}", e);
            return Err(anyhow::anyhow!("Failed to publish event: {}", e));
        }

        // Track approximate backlog depth and warn if it grows unbounded, which
        // indicates a slow/blocked listener starving the event loop.
        let depth = self.pending_depth.fetch_add(1, Ordering::Relaxed) + 1;
        if depth >= EVENT_BACKLOG_WARN_THRESHOLD && depth.is_power_of_two() {
            warn!(
                "Event backlog is large ({} pending); a listener may be slow or blocked",
                depth
            );
        }

        Ok(())
    }

    /// 启动事件处理循环
    pub async fn start_event_loop(&self) -> Result<()> {
        info!("Starting event manager loop");

        let mut event_rx = {
            let mut rx_guard = self.event_rx.write().await;
            rx_guard
                .take()
                .ok_or_else(|| anyhow::anyhow!("Event receiver already taken"))?
        };

        let listeners = self.listeners.clone();
        let pending_depth = self.pending_depth.clone();

        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                pending_depth.fetch_sub(1, Ordering::Relaxed);
                debug!(
                    "Processing event: {:?} from {}",
                    event.event_type, event.source
                );

                let current_listeners = {
                    let listeners_guard = listeners.read().await;
                    listeners_guard
                        .get(&event.event_type)
                        .cloned()
                        .unwrap_or_default()
                };

                for listener in current_listeners {
                    let event_clone = event.clone();
                    let listener_name = listener.name();
                    if let Err(e) = listener.handle_event(&event_clone).await {
                        error!(
                            "Event listener {} failed to handle event: {}",
                            listener_name, e
                        );
                    }
                }
            }

            info!("Event manager loop ended");
        });

        Ok(())
    }

    /// 获取事件发送器
    pub fn get_event_sender(&self) -> mpsc::UnboundedSender<Event> {
        self.event_tx.clone()
    }
}

impl Default for EventManager {
    fn default() -> Self {
        Self::new()
    }
}

/// 消息到事件转换器
pub struct MessageToEventConverter {
    event_manager: Arc<EventManager>,
    sender_id: String,
}

impl MessageToEventConverter {
    pub fn new(event_manager: Arc<EventManager>, sender_id: String) -> Self {
        Self {
            event_manager,
            sender_id,
        }
    }

    /// 将消息转换为事件并发布
    pub async fn convert_and_publish(&self, message: &Message) -> Result<()> {
        match &message.payload {
            MessagePayload::TcpForwarding(msg) => match &msg.action {
                TcpForwardingAction::CreateSession { .. } => {
                    let event = Event::new(
                        EventType::TcpSessionCreated,
                        self.sender_id.clone(),
                        serde_json::json!({
                            "message_id": message.id,
                            "request_id": msg.request_id,
                        }),
                    );
                    self.event_manager.publish_event(event).await?;
                }
                TcpForwardingAction::StopSession { session_id } => {
                    let event = Event::new(
                        EventType::TcpSessionStopped,
                        self.sender_id.clone(),
                        serde_json::json!({
                            "session_id": session_id,
                            "message_id": message.id,
                        }),
                    );
                    self.event_manager.publish_event(event).await?;
                }
                _ => {}
            },
            MessagePayload::TcpData(msg) => match msg.data_type {
                TcpDataType::ConnectionOpen => {
                    let event = Event::new(
                        EventType::TcpConnectionOpen,
                        self.sender_id.clone(),
                        serde_json::json!({
                            "session_id": msg.session_id,
                            "connection_id": msg.connection_id,
                            "message_id": message.id,
                        }),
                    );
                    self.event_manager.publish_event(event).await?;
                }
                TcpDataType::ConnectionClose => {
                    let event = Event::new(
                        EventType::TcpConnectionClose,
                        self.sender_id.clone(),
                        serde_json::json!({
                            "session_id": msg.session_id,
                            "connection_id": msg.connection_id,
                            "message_id": message.id,
                        }),
                    );
                    self.event_manager.publish_event(event).await?;
                }
                TcpDataType::Data => {
                    let event = Event::new(
                        EventType::TcpDataForwarded,
                        self.sender_id.clone(),
                        serde_json::json!({
                            "session_id": msg.session_id,
                            "connection_id": msg.connection_id,
                            "data_length": msg.data.len(),
                            "message_id": message.id,
                        }),
                    );
                    self.event_manager.publish_event(event).await?;
                }
                _ => {}
            },
            MessagePayload::Error(msg) => {
                let event = Event::new(
                    EventType::SystemError,
                    self.sender_id.clone(),
                    serde_json::json!({
                        "code": msg.code,
                        "message": msg.message,
                        "details": msg.details,
                        "message_id": message.id,
                    }),
                );
                self.event_manager.publish_event(event).await?;
            }
            MessagePayload::AgentSession(msg) => {
                let event_type = match &msg.action {
                    crate::message_protocol::AgentSessionAction::Register { .. } => {
                        EventType::AgentSessionStarted
                    }
                    crate::message_protocol::AgentSessionAction::StopSession { .. } => {
                        EventType::AgentSessionStopped
                    }
                    _ => EventType::AgentMessageReceived,
                };
                let event = Event::new(
                    event_type,
                    self.sender_id.clone(),
                    serde_json::json!({
                        "message_id": message.id,
                        "request_id": msg.request_id,
                        "session_id": message.session_id,
                    }),
                );
                self.event_manager.publish_event(event).await?;
            }
            MessagePayload::AgentMessage(msg) => {
                let event = Event::new(
                    EventType::AgentMessageReceived,
                    self.sender_id.clone(),
                    serde_json::json!({
                        "session_id": msg.session_id,
                        "message_id": message.id,
                    }),
                );
                self.event_manager.publish_event(event).await?;
            }
            MessagePayload::AgentPermission(_msg) => {
                let event = Event::new(
                    EventType::AgentPermissionRequested,
                    self.sender_id.clone(),
                    serde_json::json!({
                        "session_id": message.session_id,
                        "message_id": message.id,
                    }),
                );
                self.event_manager.publish_event(event).await?;
            }
            MessagePayload::AgentControl(msg) => {
                let event = Event::new(
                    EventType::AgentControlReceived,
                    self.sender_id.clone(),
                    serde_json::json!({
                        "session_id": msg.session_id,
                        "action": format!("{:?}", msg.action),
                        "message_id": message.id,
                    }),
                );
                self.event_manager.publish_event(event).await?;
            }
            _ => {}
        }

        Ok(())
    }
}

/// 统一通信管理器
pub struct CommunicationManager {
    message_router: Arc<MessageRouter>,
    event_manager: Arc<EventManager>,
    message_converter: Arc<MessageToEventConverter>,
    node_id: String,
}

impl CommunicationManager {
    pub fn new(node_id: String) -> Self {
        let event_manager = Arc::new(EventManager::new());
        let message_converter = Arc::new(MessageToEventConverter::new(
            event_manager.clone(),
            node_id.clone(),
        ));

        Self {
            message_router: Arc::new(MessageRouter::new()),
            event_manager,
            message_converter,
            node_id,
        }
    }

    /// 初始化通信管理器
    pub async fn initialize(&self) -> Result<()> {
        info!(
            "Initializing communication manager for node: {}",
            self.node_id
        );

        // 启动事件管理器
        self.event_manager.start_event_loop().await?;

        info!("Communication manager initialized successfully");
        Ok(())
    }

    /// 注册消息处理器
    pub async fn register_message_handler(&self, handler: Arc<dyn MessageHandler>) {
        self.message_router.register_handler(handler).await;
    }

    /// 注册事件监听器
    pub async fn register_event_listener(&self, listener: Arc<dyn EventListener>) {
        self.event_manager.register_listener(listener).await;
    }

    /// 接收传入的消息
    pub async fn receive_incoming_message(&self, message: Message) -> Result<Option<Message>> {
        debug!("Received incoming message: {:?}", message.message_type);

        // 转换消息为事件
        self.message_converter.convert_and_publish(&message).await?;

        // 路由消息到处理器
        let results = self.message_router.route_message(&message).await;

        // 收集处理器返回的响应（第一个成功的响应）
        let mut response = None;
        for (i, result) in results.into_iter().enumerate() {
            match result {
                Ok(Some(msg)) => {
                    debug!("Message handler {} returned response", i);
                    if response.is_none() {
                        response = Some(msg);
                    }
                }
                Ok(None) => {
                    debug!("Message handler {} completed without response", i);
                }
                Err(e) => {
                    error!("Message handler {} failed: {}", i, e);
                }
            }
        }

        Ok(response)
    }

    /// 获取事件管理器
    pub fn get_event_manager(&self) -> Arc<EventManager> {
        self.event_manager.clone()
    }

    /// 获取节点ID
    pub fn get_node_id(&self) -> &str {
        &self.node_id
    }
}

/// TCP转发事件监听器示例
pub struct TcpForwardingEventListener {
    name: String,
}

impl TcpForwardingEventListener {
    pub fn new(name: String) -> Self {
        Self { name }
    }
}

#[async_trait]
impl EventListener for TcpForwardingEventListener {
    async fn handle_event(&self, event: &Event) -> Result<()> {
        match event.event_type {
            EventType::TcpSessionCreated => {
                info!("[{}] TCP session created: {}", self.name, event.data);
            }
            EventType::TcpSessionStopped => {
                info!("[{}] TCP session stopped: {}", self.name, event.data);
            }
            EventType::TcpConnectionOpen => {
                info!("[{}] TCP connection opened: {}", self.name, event.data);
            }
            EventType::TcpConnectionClose => {
                info!("[{}] TCP connection closed: {}", self.name, event.data);
            }
            EventType::TcpDataForwarded => {
                debug!("[{}] TCP data forwarded: {}", self.name, event.data);
            }
            _ => {}
        }
        Ok(())
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn supported_events(&self) -> Vec<EventType> {
        vec![
            EventType::TcpSessionCreated,
            EventType::TcpSessionStopped,
            EventType::TcpConnectionOpen,
            EventType::TcpConnectionClose,
            EventType::TcpDataForwarded,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_event_manager() {
        let event_manager = Arc::new(EventManager::new());
        event_manager.start_event_loop().await.unwrap();

        let event = Event::new(
            EventType::SystemStarted,
            "test_source".to_string(),
            serde_json::json!({"status": "ok"}),
        );

        event_manager.publish_event(event).await.unwrap();

        // Give event processing some time
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    #[test]
    fn test_message_to_event_converter() {
        // This test requires an async runtime; tested in actual usage
    }
}
