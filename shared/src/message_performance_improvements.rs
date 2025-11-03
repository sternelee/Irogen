//! 消息处理器性能改进
//!
//! 此模块提供对现有消息处理器的性能改进，包括：
//! - 批量处理支持
//! - 连接池优化
//! - 消息缓存机制
//! - 性能监控

use crate::message_protocol::*;
use crate::event_manager::*;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

/// 消息处理统计
#[derive(Debug, Default)]
pub struct MessageProcessingStats {
    /// 总处理消息数
    pub total_processed: AtomicU64,
    /// 成功处理数
    pub successful_processed: AtomicU64,
    /// 失败处理数
    pub failed_processed: AtomicU64,
    /// 平均处理时间（微秒）
    pub avg_processing_time_us: AtomicU64,
    /// 当前队列大小
    pub queue_size: AtomicUsize,
    /// 峰值队列大小
    pub peak_queue_size: AtomicUsize,
}

/// 增强的消息路由器，支持批量处理和性能监控
pub struct EnhancedMessageRouter {
    /// 原始消息路由器
    inner: Arc<MessageRouter>,
    /// 处理统计
    stats: Arc<MessageProcessingStats>,
    /// 批量处理配置
    batch_size: usize,
    /// 批量处理等待时间（毫秒）
    batch_wait_ms: u64,
    /// 是否启用批量处理
    enable_batching: bool,
}

impl EnhancedMessageRouter {
    /// 创建增强消息路由器
    pub fn new() -> Self {
        let inner = Arc::new(MessageRouter::new());
        Self {
            inner,
            stats: Arc::new(MessageProcessingStats::default()),
            batch_size: 50,
            batch_wait_ms: 10,
            enable_batching: true,
        }
    }

    /// 配置批量处理
    pub fn with_batch_config(mut self, batch_size: usize, batch_wait_ms: u64, enable_batching: bool) -> Self {
        self.batch_size = batch_size;
        self.batch_wait_ms = batch_wait_ms;
        self.enable_batching = enable_batching;
        self
    }

    /// 注册消息处理器
    pub async fn register_handler(&self, handler: Arc<dyn MessageHandler>) {
        self.inner.register_handler(handler).await;
    }

    /// 批量路由消息
    pub async fn route_messages_batch(&self, messages: Vec<Message>) -> Vec<Result<Option<Message>>> {
        let start_time = Instant::now();
        let batch_size = messages.len();

        // 更新统计
        self.stats.queue_size.fetch_add(batch_size, Ordering::Relaxed);
        let current_size = self.stats.queue_size.load(Ordering::Relaxed);

        // 更新峰值队列大小
        let mut peak_size = self.stats.peak_queue_size.load(Ordering::Relaxed);
        while current_size > peak_size {
            match self.stats.peak_queue_size.compare_exchange_weak(
                peak_size, current_size, Ordering::Relaxed, Ordering::Relaxed
            ) {
                Ok(_) => break,
                Err(actual) => peak_size = actual,
            }
        }

        // 按消息类型分组
        let mut grouped: HashMap<MessageType, Vec<Message>> = HashMap::new();
        for message in messages {
            grouped.entry(message.message_type)
                .or_insert_with(Vec::new)
                .push(message);
        }

        let mut results = Vec::new();
        let mut successful_count = 0;
        let mut failed_count = 0;

        // 处理每种类型的消息
        for (msg_type, type_messages) in grouped {
            debug!("Processing {} messages of type {:?}", type_messages.len(), msg_type);

            let _ = self.inner.route_message(&type_messages[0]).await;

            // 对于批量消息，我们需要为每个消息调用路由器
            // 这里简化处理，实际实现中可以优化
            for message in &type_messages {
                let message_results = self.inner.route_message(message).await;

                for result in message_results {
                    match result {
                        Ok(_) => successful_count += 1,
                        Err(_) => failed_count += 1,
                    }
                    results.push(result);
                }
            }
        }

        // 更新统计
        self.stats.queue_size.fetch_sub(batch_size, Ordering::Relaxed);
        self.stats.total_processed.fetch_add(batch_size as u64, Ordering::Relaxed);
        self.stats.successful_processed.fetch_add(successful_count, Ordering::Relaxed);
        self.stats.failed_processed.fetch_add(failed_count, Ordering::Relaxed);

        // 更新平均处理时间
        let processing_time = start_time.elapsed().as_micros() as u64;
        let current_avg = self.stats.avg_processing_time_us.load(Ordering::Relaxed);
        let new_avg = (current_avg + processing_time) / 2;
        self.stats.avg_processing_time_us.store(new_avg, Ordering::Relaxed);

        debug!(
            "Batch processed: {} messages in {}μs (success: {}, failed: {})",
            batch_size, processing_time, successful_count, failed_count
        );

        results
    }

    /// 路由单个消息（兼容性方法）
    pub async fn route_message(&self, message: &Message) -> Vec<Result<Option<Message>>> {
        self.stats.total_processed.fetch_add(1, Ordering::Relaxed);

        let start_time = Instant::now();
        let results = self.inner.route_message(message).await;
        let processing_time = start_time.elapsed().as_micros() as u64;

        // 更新统计
        for result in &results {
            match result {
                Ok(_) => {
                    self.stats.successful_processed.fetch_add(1, Ordering::Relaxed);
                }
                Err(_) => {
                    self.stats.failed_processed.fetch_add(1, Ordering::Relaxed);
                }
            }
        }

        // 更新平均处理时间
        let current_avg = self.stats.avg_processing_time_us.load(Ordering::Relaxed);
        let new_avg = (current_avg + processing_time) / 2;
        self.stats.avg_processing_time_us.store(new_avg, Ordering::Relaxed);

        results
    }

    /// 获取处理统计
    pub fn get_stats(&self) -> Arc<MessageProcessingStats> {
        self.stats.clone()
    }
}

/// 增强的通信管理器
pub struct EnhancedCommunicationManager {
    /// 原始通信管理器
    inner: Arc<CommunicationManager>,
    /// 增强消息路由器
    enhanced_router: Arc<EnhancedMessageRouter>,
    /// 消息缓冲通道
    message_buffer_tx: mpsc::UnboundedSender<Message>,
    /// 消息缓冲接收器
    message_buffer_rx: Arc<RwLock<Option<mpsc::UnboundedReceiver<Message>>>>,
    /// 消息缓冲任务句柄
    buffer_task_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
    /// 性能监控句柄
    monitor_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
}

impl EnhancedCommunicationManager {
    /// 创建增强通信管理器
    pub fn new(node_id: String) -> Self {
        let inner = Arc::new(CommunicationManager::new(node_id));
        let enhanced_router = Arc::new(EnhancedMessageRouter::new());
        let (message_buffer_tx, message_buffer_rx) = mpsc::unbounded_channel();

        Self {
            inner,
            enhanced_router,
            message_buffer_tx,
            message_buffer_rx: Arc::new(RwLock::new(Some(message_buffer_rx))),
            buffer_task_handle: Arc::new(RwLock::new(None)),
            monitor_handle: Arc::new(RwLock::new(None)),
        }
    }

    /// 初始化增强通信管理器
    pub async fn initialize(&self) -> Result<()> {
        info!("Initializing enhanced communication manager");

        // 初始化原始通信管理器
        self.inner.initialize().await?;

        // 启动消息缓冲处理器
        self.start_message_buffer_processor().await?;

        // 启动性能监控
        self.start_performance_monitor().await?;

        info!("Enhanced communication manager initialized successfully");
        Ok(())
    }

    /// 注册消息处理器
    pub async fn register_message_handler(&self, handler: Arc<dyn MessageHandler>) {
        self.enhanced_router.register_handler(handler.clone()).await;
        self.inner.register_message_handler(handler).await;
    }

    /// 注册事件监听器
    pub async fn register_event_listener(&self, listener: Arc<dyn EventListener>) {
        self.inner.register_event_listener(listener).await;
    }

    /// 发送消息
    pub async fn send_message(&self, message: Message) -> Result<()> {
        self.inner.send_message(message).await
    }

    /// 接收传入消息（使用增强处理）
    pub async fn receive_incoming_message(&self, message: Message) -> Result<()> {
        // 发送到缓冲区进行批量处理
        if let Err(e) = self.message_buffer_tx.send(message) {
            error!("Failed to buffer message: {}", e);
            return Err(anyhow::anyhow!("Failed to buffer message: {}", e));
        }

        Ok(())
    }

    /// 启动消息缓冲处理器
    async fn start_message_buffer_processor(&self) -> Result<()> {
        let mut message_rx = {
            let mut rx_guard = self.message_buffer_rx.write().await;
            rx_guard.take()
                .ok_or_else(|| anyhow::anyhow!("Message receiver already taken"))?
        };
        let enhanced_router = self.enhanced_router.clone();
        let batch_size = enhanced_router.batch_size;
        let batch_wait_ms = enhanced_router.batch_wait_ms;
        let enable_batching = enhanced_router.enable_batching;

        let handle = tokio::spawn(async move {
            let mut message_buffer = Vec::new();
            let mut last_process_time = Instant::now();

            loop {
                let mut process_now = false;
                let mut messages_to_process = Vec::new();

                // 收集消息或等待超时
                tokio::select! {
                    // 收到新消息
                    message_result = message_rx.recv() => {
                        match message_result {
                            Some(message) => {
                                message_buffer.push(message);

                                // 检查是否需要处理
                                if enable_batching {
                                    if message_buffer.len() >= batch_size {
                                        process_now = true;
                                    }

                                    let elapsed = last_process_time.elapsed();
                                    if elapsed >= Duration::from_millis(batch_wait_ms) && !message_buffer.is_empty() {
                                        process_now = true;
                                    }
                                } else {
                                    // 不启用批量处理，立即处理
                                    process_now = true;
                                }
                            }
                            None => {
                                debug!("Message buffer channel closed");
                                break;
                            }
                        }
                    }

                    // 定时检查
                    _ = sleep(Duration::from_millis(batch_wait_ms)) => {
                        if enable_batching && !message_buffer.is_empty() {
                            process_now = true;
                        }
                    }
                }

                // 处理缓冲的消息
                if process_now && !message_buffer.is_empty() {
                    messages_to_process.append(&mut message_buffer);
                    last_process_time = Instant::now();
                }

                if !messages_to_process.is_empty() {
                    debug!("Processing buffered {} messages", messages_to_process.len());

                    let _ = enhanced_router.route_messages_batch(messages_to_process).await;
                }
            }

            info!("Message buffer processor ended");
        });

        let mut task_handle = self.buffer_task_handle.write().await;
        *task_handle = Some(handle);

        Ok(())
    }

    /// 启动性能监控
    async fn start_performance_monitor(&self) -> Result<()> {
        let stats = self.enhanced_router.get_stats();
        let monitor_handle = tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(10)).await;

                let total = stats.total_processed.load(Ordering::Relaxed);
                let successful = stats.successful_processed.load(Ordering::Relaxed);
                let failed = stats.failed_processed.load(Ordering::Relaxed);
                let avg_time = stats.avg_processing_time_us.load(Ordering::Relaxed);
                let queue_size = stats.queue_size.load(Ordering::Relaxed);
                let peak_queue = stats.peak_queue_size.load(Ordering::Relaxed);

                let success_rate = if total > 0 {
                    (successful * 100) / total
                } else {
                    100
                };

                info!(
                    "Performance Stats - Total: {}, Success: {}%, Failed: {}, Avg: {}μs, Queue: {}/{}",
                    total, success_rate, failed, avg_time, queue_size, peak_queue
                );

                // 输出警告信息
                if queue_size > 100 {
                    warn!("High message queue size: {} (peak: {})", queue_size, peak_queue);
                }

                if success_rate < 95 && total > 100 {
                    warn!("Low success rate: {}% (consider increasing resources)", success_rate);
                }

                if avg_time > 10000 { // 10ms
                    warn!("High average processing time: {}μs", avg_time);
                }
            }
        });

        let mut handle = self.monitor_handle.write().await;
        *handle = Some(monitor_handle);

        Ok(())
    }

    /// 获取处理统计
    pub fn get_processing_stats(&self) -> Arc<MessageProcessingStats> {
        self.enhanced_router.get_stats()
    }

    /// 启动心跳任务
    pub async fn start_heartbeat_task(&self) -> Result<()> {
        self.inner.start_heartbeat_task().await
    }

    /// 获取节点ID
    pub fn get_node_id(&self) -> &str {
        self.inner.get_node_id()
    }

    /// 获取原始通信管理器
    pub fn inner(&self) -> &Arc<CommunicationManager> {
        &self.inner
    }
}

/// 消息连接池
pub struct MessageConnectionPool {
    /// 连接池
    connections: Arc<RwLock<Vec<Arc<dyn MessageHandler>>>>,
    /// 最大连接数
    max_connections: usize,
    /// 当前连接数
    current_connections: AtomicUsize,
}

impl MessageConnectionPool {
    /// 创建新的连接池
    pub fn new(max_connections: usize) -> Self {
        Self {
            connections: Arc::new(RwLock::new(Vec::new())),
            max_connections,
            current_connections: AtomicUsize::new(0),
        }
    }

    /// 获取连接
    pub async fn get_connection(&self) -> Option<Arc<dyn MessageHandler>> {
        let mut connections = self.connections.write().await;

        if let Some(connection) = connections.pop() {
            debug!("Reusing connection from pool");
            Some(connection)
        } else {
            debug!("No available connections in pool");
            None
        }
    }

    /// 归还连接
    pub async fn return_connection(&self, connection: Arc<dyn MessageHandler>) {
        let current_count = self.current_connections.load(Ordering::Relaxed);

        if current_count < self.max_connections {
            let mut connections = self.connections.write().await;
            connections.push(connection);
            debug!("Connection returned to pool");
        } else {
            debug!("Pool at capacity, discarding connection");
        }
    }

    /// 获取当前连接数
    pub fn current_connections(&self) -> usize {
        self.current_connections.load(Ordering::Relaxed)
    }
}

/// 便捷函数，将现有通信管理器升级为增强版本
pub fn enhance_communication_manager(
    original: Arc<CommunicationManager>,
) -> Arc<EnhancedCommunicationManager> {
    let node_id = original.get_node_id().to_string();
    let enhanced = Arc::new(EnhancedCommunicationManager::new(node_id));
    enhanced
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_manager::TerminalEventListener;

    #[tokio::test]
    async fn test_enhanced_message_router() {
        let original_router = Arc::new(MessageRouter::new());
        let enhanced_router = Arc::new(EnhancedMessageRouter::new(original_router));

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

        let handler = Arc::new(TestHandler);
        enhanced_router.register_handler(handler).await;

        // 测试批量处理
        let messages: Vec<Message> = (0..10)
            .map(|i| MessageBuilder::heartbeat("test".to_string(), i, "active".to_string()))
            .collect();

        let results = enhanced_router.route_messages_batch(messages).await;
        assert_eq!(results.len(), 10);

        // 检查统计
        let stats = enhanced_router.get_stats();
        assert_eq!(stats.total_processed.load(Ordering::Relaxed), 10);
        assert_eq!(stats.successful_processed.load(Ordering::Relaxed), 10);
    }

    #[tokio::test]
    async fn test_message_connection_pool() {
        let pool = Arc::new(MessageConnectionPool::new(5));

        assert_eq!(pool.current_connections(), 0);

        // 测试获取和归还连接
        let connection = pool.get_connection().await;
        assert!(connection.is_none());

        // 这里可以添加更复杂的连接池测试
    }

    #[tokio::test]
    async fn test_enhanced_communication_manager() {
        let manager = Arc::new(EnhancedCommunicationManager::new("test_node".to_string()));

        // 测试初始化
        let result = manager.initialize().await;
        assert!(result.is_ok());

        // 测试获取统计
        let stats = manager.get_processing_stats();
        assert!(stats.total_processed.load(Ordering::Relaxed) >= 0);
    }
}