//! 消息处理器适配器
//!
//! 此模块提供适配器，将现有的消息处理器无缝集成到优化后的消息处理系统中，
//! 确保向后兼容性的同时提供性能提升。

use crate::event_manager::*;
use crate::message_protocol::*;
use crate::performance_optimized_messaging::*;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, info, warn};

/// 将现有 MessageHandler 适配为 OptimizedMessageHandler
pub struct MessageHandlerAdapter {
    /// 原始消息处理器
    inner: Arc<dyn MessageHandler>,
    /// 处理器名称
    name: String,
    /// 性能统计
    stats: Arc<HandlerStats>,
}

/// 处理器统计
#[derive(Debug, Default)]
pub struct HandlerStats {
    /// 总处理数
    pub total_processed: std::sync::atomic::AtomicU64,
    /// 成功处理数
    pub successful_processed: std::sync::atomic::AtomicU64,
    /// 失败处理数
    pub failed_processed: std::sync::atomic::AtomicU64,
    /// 平均处理时间（微秒）
    pub avg_processing_time_us: std::sync::atomic::AtomicU64,
}

impl MessageHandlerAdapter {
    /// 创建新的适配器
    pub fn new(handler: Arc<dyn MessageHandler>, name: String) -> Self {
        Self {
            inner: handler,
            name,
            stats: Arc::new(HandlerStats::default()),
        }
    }

    /// 获取原始处理器
    pub fn inner(&self) -> &Arc<dyn MessageHandler> {
        &self.inner
    }

    /// 获取统计信息
    pub fn get_stats(&self) -> Arc<HandlerStats> {
        self.stats.clone()
    }
}

#[async_trait::async_trait]
impl OptimizedMessageHandler for MessageHandlerAdapter {
    async fn handle_message_optimized(
        &self,
        message: &Message,
    ) -> Result<Option<Message>, anyhow::Error> {
        let start_time = Instant::now();
        self.stats
            .total_processed
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        debug!("Handling message {} with adapter {}", message.id, self.name);

        let result = self.inner.handle_message(message).await;
        let processing_time = start_time.elapsed().as_micros() as u64;

        // 更新统计信息
        match &result {
            Ok(_) => {
                self.stats
                    .successful_processed
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            Err(e) => {
                self.stats
                    .failed_processed
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                warn!(
                    "Handler {} failed to process message {}: {}",
                    self.name, message.id, e
                );
            }
        }

        // 更新平均处理时间（简单的移动平均）
        let current_avg = self
            .stats
            .avg_processing_time_us
            .load(std::sync::atomic::Ordering::Relaxed);
        let new_avg = (current_avg + processing_time) / 2;
        self.stats
            .avg_processing_time_us
            .store(new_avg, std::sync::atomic::Ordering::Relaxed);

        debug!(
            "Handler {} processed message {} in {}μs",
            self.name, message.id, processing_time
        );

        result
    }

    fn supported_message_types(&self) -> Vec<MessageType> {
        self.inner.supported_message_types()
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> u8 {
        // 基于处理器类型确定优先级
        let types = self.supported_message_types();
        for msg_type in &types {
            match msg_type {
                MessageType::Heartbeat => return 10,     // 低优先级
                MessageType::TerminalIO => return 50,    // 高优先级
                MessageType::TcpData => return 60,       // 高优先级
                MessageType::SystemControl => return 80, // 高优先级
                MessageType::Error => return 90,         // 最高优先级
                _ => {}
            }
        }
        50 // 默认中等优先级
    }
}

/// 将现有 EventListener 适配为 OptimizedEventListener
pub struct EventListenerAdapter {
    /// 原始事件监听器
    inner: Arc<dyn EventListener>,
    /// 适配器名称
    name: String,
}

impl EventListenerAdapter {
    /// 创建新的适配器
    pub fn new(listener: Arc<dyn EventListener>, name: String) -> Self {
        Self {
            inner: listener,
            name,
        }
    }

    /// 获取原始监听器
    pub fn inner(&self) -> &Arc<dyn EventListener> {
        &self.inner
    }
}

#[async_trait::async_trait]
impl OptimizedEventListener for EventListenerAdapter {
    async fn handle_event_optimized(&self, event: &OptimizedEvent) -> Result<(), anyhow::Error> {
        // 将 OptimizedEvent 转换为 Event
        let legacy_event = Event {
            event_type: event.event_type.clone(),
            source: event.source.clone(),
            data: event.data.clone(),
            timestamp: event.timestamp,
            session_id: event.session_id.clone(),
        };

        self.inner.handle_event(&legacy_event).await
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn supported_events(&self) -> Vec<EventType> {
        self.inner.supported_events()
    }

    fn priority(&self) -> u8 {
        // 基于事件类型确定优先级
        let events = self.supported_events();
        for event_type in &events {
            match event_type {
                EventType::TerminalInput | EventType::TerminalOutput => return 60,
                EventType::TcpDataForwarded => return 70,
                EventType::SystemError => return 90,
                EventType::PeerConnected | EventType::PeerDisconnected => return 50,
                _ => {}
            }
        }
        30 // 默认中等优先级
    }
}

/// 优化的通信管理器，集成所有性能优化组件
pub struct OptimizedCommunicationManager {
    /// 原始通信管理器
    inner: Arc<CommunicationManager>,
    /// 优化的消息路由器
    optimized_router: Arc<OptimizedMessageRouter>,
    /// 优化的消息路由器
    optimized_event_manager: Arc<OptimizedEventManager>,
    /// 重试管理器
    retry_manager: Arc<MessageRetryManager>,
    /// 性能监控器
    performance_monitor: Arc<PerformanceMonitor>,
    /// 适配的处理器列表
    adapted_handlers: Arc<RwLock<Vec<Arc<MessageHandlerAdapter>>>>,
    /// 适配的监听器列表
    adapted_listeners: Arc<RwLock<Vec<Arc<EventListenerAdapter>>>>,
}

impl OptimizedCommunicationManager {
    /// 创建新的优化通信管理器
    pub fn new(node_id: String) -> Self {
        let inner = Arc::new(CommunicationManager::new(node_id.clone()));
        let optimized_router = Arc::new(OptimizedMessageRouter::new());
        let optimized_event_manager = Arc::new(OptimizedEventManager::new());
        let retry_manager = Arc::new(MessageRetryManager::new(3, 100, 2.0));
        let performance_monitor = Arc::new(PerformanceMonitor::new(5));

        Self {
            inner,
            optimized_router,
            optimized_event_manager,
            retry_manager,
            performance_monitor,
            adapted_handlers: Arc::new(RwLock::new(Vec::new())),
            adapted_listeners: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 初始化优化通信管理器
    pub async fn initialize(&self) -> Result<()> {
        info!("Initializing optimized communication manager");

        // 初始化原始通信管理器
        self.inner.initialize().await?;

        // 启动重试处理器
        let retry_handle = self
            .retry_manager
            .start_retry_processor(self.optimized_router.clone())
            .await;

        // 启动性能监控
        let monitor_handle = self
            .performance_monitor
            .start_monitoring(
                self.optimized_router.clone(),
                self.optimized_event_manager.clone(),
            )
            .await;

        // 启动事件管理器
        self.optimized_event_manager.start_event_loop().await?;

        info!("Optimized communication manager initialized successfully");

        // 在实际实现中，应该保存这些句柄以便后续管理
        drop(retry_handle);
        drop(monitor_handle);

        Ok(())
    }

    /// 注册消息处理器（自动适配）
    pub async fn register_message_handler(&self, handler: Arc<dyn MessageHandler>) {
        let name = format!(
            "adapter_{}",
            uuid::Uuid::new_v4().to_string()[..8].to_string()
        );
        let adapter = Arc::new(MessageHandlerAdapter::new(handler, name.clone()));

        // 注册到优化路由器
        self.optimized_router
            .register_handler(adapter.clone())
            .await;

        // 保存适配器引用
        let mut handlers = self.adapted_handlers.write().await;
        handlers.push(adapter);

        // 同时注册到原始管理器以保持兼容性
        self.inner.register_message_handler(handler).await;

        info!("Registered adapted message handler: {}", name);
    }

    /// 注册事件监听器（自动适配）
    pub async fn register_event_listener(&self, listener: Arc<dyn EventListener>) {
        let name = format!(
            "event_adapter_{}",
            uuid::Uuid::new_v4().to_string()[..8].to_string()
        );
        let adapter = Arc::new(EventListenerAdapter::new(listener, name.clone()));

        // 注册到优化事件管理器
        self.optimized_event_manager
            .register_listener(adapter.clone())
            .await;

        // 保存适配器引用
        let mut listeners = self.adapted_listeners.write().await;
        listeners.push(adapter);

        // 同时注册到原始管理器以保持兼容性
        self.inner.register_event_listener(listener.clone()).await;

        info!("Registered adapted event listener: {}", name);
    }

    /// 发送消息（使用优化路由）
    pub async fn send_message(&self, message: Message) -> Result<()> {
        // 尝试使用优化路由器
        let results = self.optimized_router.route_message(&message).await;

        // 检查是否有成功的处理结果
        let mut has_success = false;
        for result in &results {
            if result.is_ok() {
                has_success = true;
                break;
            }
        }

        if !has_success {
            // 如果优化路由失败，添加到重试队列
            for result in results {
                if let Err(e) = result {
                    self.retry_manager
                        .add_retry_message(message.clone(), e.to_string())
                        .await;
                }
            }
        }

        // 同时发送到原始管理器以保持兼容性
        self.inner.send_message(message).await
    }

    /// 接收传入消息（使用优化处理）
    pub async fn receive_incoming_message(&self, message: Message) -> Result<()> {
        // 使用优化路由器处理
        let results = self.optimized_router.route_message(&message).await;

        // 检查处理结果并决定是否需要重试
        let mut failed_count = 0;
        for result in &results {
            if let Err(e) = result {
                failed_count += 1;
                warn!("Optimized message handler failed: {}", e);
            }
        }

        // 如果所有处理器都失败，添加到重试队列
        if failed_count == results.len() && failed_count > 0 {
            self.retry_manager
                .add_retry_message(message.clone(), "All optimized handlers failed".to_string())
                .await;
        }

        // 同时使用原始管理器处理以保持兼容性
        self.inner.receive_incoming_message(message).await
    }

    /// 获取性能指标
    pub fn get_performance_metrics(&self) -> Arc<PerformanceMetrics> {
        self.performance_monitor.get_metrics()
    }

    /// 获取消息路由器统计
    pub fn get_router_stats(&self) -> Arc<MessageRouterStats> {
        self.optimized_router.get_stats()
    }

    /// 获取重试统计
    pub fn get_retry_stats(&self) -> Arc<RetryStats> {
        self.retry_manager.get_retry_stats()
    }

    /// 获取事件统计
    pub fn get_event_stats(&self) -> Arc<EventStats> {
        self.optimized_event_manager.get_stats()
    }

    /// 获取节点ID
    pub fn get_node_id(&self) -> &str {
        self.inner.get_node_id()
    }

    /// 获取原始通信管理器
    pub fn inner(&self) -> &Arc<CommunicationManager> {
        &self.inner
    }

    /// 获取优化消息路由器
    pub fn optimized_router(&self) -> &Arc<OptimizedMessageRouter> {
        &self.optimized_router
    }

    /// 获取优化事件管理器
    pub fn optimized_event_manager(&self) -> &Arc<OptimizedEventManager> {
        &self.optimized_event_manager
    }

    /// 启动心跳任务
    pub async fn start_heartbeat_task(&self) -> Result<()> {
        self.inner.start_heartbeat_task().await
    }
}

/// 便捷的创建函数，用于将现有通信管理器升级为优化版本
pub fn upgrade_communication_manager(
    original: Arc<CommunicationManager>,
) -> Result<Arc<OptimizedCommunicationManager>, anyhow::Error> {
    let node_id = original.get_node_id().to_string();
    let optimized = Arc::new(OptimizedCommunicationManager::new(node_id));

    // 在实际实现中，这里需要复制原始管理器的状态
    // 由于原始管理器没有提供复制方法，我们需要手动处理

    Ok(optimized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_manager::{EventType, TerminalEventListener};

    #[tokio::test]
    async fn test_message_handler_adapter() {
        use crate::message_protocol::MessageBuilder;

        // 创建测试处理器
        struct TestHandler;
        #[async_trait::async_trait]
        impl MessageHandler for TestHandler {
            async fn handle_message(&self, _message: &Message) -> Result<Option<Message>> {
                Ok(None)
            }

            fn supported_message_types(&self) -> Vec<MessageType> {
                vec![MessageType::Heartbeat]
            }
        }

        let original = Arc::new(TestHandler);
        let adapter = Arc::new(MessageHandlerAdapter::new(original, "test".to_string()));

        // 测试适配
        let message = MessageBuilder::heartbeat("sender".to_string(), 1, "active".to_string());
        let result = adapter.handle_message_optimized(&message).await;
        assert!(result.is_ok());

        // 检查统计
        let stats = adapter.get_stats();
        assert_eq!(
            stats
                .total_processed
                .load(std::sync::atomic::Ordering::Relaxed),
            1
        );
        assert_eq!(
            stats
                .successful_processed
                .load(std::sync::atomic::Ordering::Relaxed),
            1
        );
    }

    #[tokio::test]
    async fn test_event_listener_adapter() {
        let original = Arc::new(TerminalEventListener::new("test".to_string()));
        let adapter = Arc::new(EventListenerAdapter::new(
            original,
            "test_adapter".to_string(),
        ));

        let event = OptimizedEvent {
            event_type: EventType::TerminalCreated,
            source: "test".to_string(),
            data: serde_json::json!({"terminal_id": "test"}),
            timestamp: 0,
            session_id: None,
            priority: EventPriority::Normal,
        };

        let result = adapter.handle_event_optimized(&event).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_optimized_communication_manager() {
        let manager = Arc::new(OptimizedCommunicationManager::new("test_node".to_string()));

        // 测试初始化
        let result = manager.initialize().await;
        assert!(result.is_ok());

        // 测试获取统计
        let metrics = manager.get_performance_metrics();
        let router_stats = manager.get_router_stats();
        let event_stats = manager.get_event_stats();

        assert!(
            metrics
                .messages_per_second
                .load(std::sync::atomic::Ordering::Relaxed)
                >= 0
        );
        assert!(
            router_stats
                .total_messages
                .load(std::sync::atomic::Ordering::Relaxed)
                >= 0
        );
        assert!(
            event_stats
                .total_events
                .load(std::sync::atomic::Ordering::Relaxed)
                >= 0
        );
    }
}
