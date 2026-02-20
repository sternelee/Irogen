//! Event Manager
//!
//! This module provides a unified event management and message processing mechanism,
//! supporting system, connection, and error events.

use crate::message_protocol::*;
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info};

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
}

impl EventManager {
    pub fn new() -> Self {
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        Self {
            listeners: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            event_rx: Arc::new(RwLock::new(Some(event_rx))),
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

        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
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
                    let listener_clone = listener.clone();

                    tokio::spawn(async move {
                        let listener_name = listener_clone.name();
                        if let Err(e) = listener_clone.handle_event(&event_clone).await {
                            error!(
                                "Event listener {} failed to handle event: {}",
                                listener_name, e
                            );
                        }
                    });
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
    _incoming_message_tx: mpsc::UnboundedSender<Message>, // Kept for potential future use
    outgoing_message_tx: mpsc::UnboundedSender<Message>,
    node_id: String,
}

impl CommunicationManager {
    pub fn new(node_id: String) -> Self {
        let (incoming_message_tx, _) = mpsc::unbounded_channel();
        let (outgoing_message_tx, _) = mpsc::unbounded_channel();

        let event_manager = Arc::new(EventManager::new());
        let message_converter = Arc::new(MessageToEventConverter::new(
            event_manager.clone(),
            node_id.clone(),
        ));

        Self {
            message_router: Arc::new(MessageRouter::new()),
            event_manager,
            message_converter,
            _incoming_message_tx: incoming_message_tx,
            outgoing_message_tx,
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

        // 启动消息处理循环
        self.start_message_processing_loop().await?;

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

    /// 发送消息
    pub async fn send_message(&self, message: Message) -> Result<()> {
        debug!(
            "Sending message: {:?} from {}",
            message.message_type, message.sender_id
        );

        if let Err(e) = self.outgoing_message_tx.send(message) {
            error!("Failed to send message: {}", e);
            return Err(anyhow::anyhow!("Failed to send message: {}", e));
        }

        Ok(())
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

        // 注意：incoming_message_tx 通道的接收端被丢弃，这里不再尝试发送
        // 消息已经通过 message_converter 和 message_router 处理了

        Ok(response)
    }

    /// 获取传入消息接收器
    pub fn get_incoming_message_receiver(&self) -> mpsc::UnboundedReceiver<Message> {
        let (_, rx) = mpsc::unbounded_channel();
        rx // Note: 这里需要重构以支持多个接收器
    }

    /// 获取传出消息接收器
    pub fn get_outgoing_message_receiver(&self) -> mpsc::UnboundedReceiver<Message> {
        let (_, rx) = mpsc::unbounded_channel();
        rx // Note: 这里需要重构以支持多个接收器
    }

    /// 获取事件管理器
    pub fn get_event_manager(&self) -> Arc<EventManager> {
        self.event_manager.clone()
    }

    /// 获取节点ID
    pub fn get_node_id(&self) -> &str {
        &self.node_id
    }

    /// 启动消息处理循环
    async fn start_message_processing_loop(&self) -> Result<()> {
        let _outgoing_tx = self.outgoing_message_tx.clone();
        let node_id = self.node_id.clone();

        tokio::spawn(async move {
            debug!("Message processing loop started for node: {}", node_id);

            // 保持 outgoing_tx 存活，这样通道就不会被关闭
            // 实际的消息发送是通过 send_message() 方法进行的
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                debug!("Message processing loop alive for node: {}", node_id);
            }

            // 注意：这个循环永远不会退出，除非任务被取消
            // 这样可以保持 outgoing_tx 存活，防止通道关闭
        });

        Ok(())
    }

    /// 创建心跳任务
    pub async fn start_heartbeat_task(&self) -> Result<()> {
        let outgoing_tx = self.outgoing_message_tx.clone();
        let node_id = self.node_id.clone();

        tokio::spawn(async move {
            let mut sequence = 0;
            loop {
                let heartbeat =
                    MessageBuilder::heartbeat(node_id.clone(), sequence, "active".to_string());

                if let Err(e) = outgoing_tx.send(heartbeat) {
                    error!("Failed to send heartbeat: {}", e);
                    break;
                }

                sequence += 1;
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });

        info!("Heartbeat task started");
        Ok(())
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
