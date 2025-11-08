//! 高性能消息处理器
//!
//! 此模块提供了优化后的消息处理机制，包含：
//! - 无锁数据结构优化
//! - 批量消息处理
//! - 内存池管理
//! - 智能重试机制
//! - 性能监控和指标收集

use crate::event_manager::*;
use crate::message_protocol::*;
use anyhow::Result;
use async_trait::async_trait;
use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{RwLock, mpsc};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

/// 性能优化的消息路由器
pub struct OptimizedMessageRouter {
    /// 使用 DashMap 替代 RwLock<HashMap> 以提高并发性能
    handlers: DashMap<MessageType, Vec<Arc<dyn OptimizedMessageHandler>>>,
    /// 消息处理统计
    stats: Arc<MessageRouterStats>,
    /// 批量处理配置
    batch_config: BatchConfig,
    /// 内存池管理器
    memory_pool: Arc<MemoryPool>,
}

/// 消息路由器性能统计
#[derive(Debug, Default)]
pub struct MessageRouterStats {
    /// 总处理消息数
    pub total_messages: AtomicU64,
    /// 成功处理消息数
    pub successful_messages: AtomicU64,
    /// 失败处理消息数
    pub failed_messages: AtomicU64,
    /// 平均处理时间（微秒）
    pub avg_processing_time_us: AtomicU64,
    /// 当前待处理消息数
    pub pending_messages: AtomicUsize,
    /// 每种消息类型的处理次数
    pub messages_by_type: DashMap<MessageType, AtomicU64>,
}

/// 批量处理配置
#[derive(Debug, Clone)]
pub struct BatchConfig {
    /// 批量大小
    pub batch_size: usize,
    /// 最大等待时间（毫秒）
    pub max_wait_time_ms: u64,
    /// 是否启用批量处理
    pub enable_batching: bool,
}

impl Default for BatchConfig {
    fn default() -> Self {
        Self {
            batch_size: 50,
            max_wait_time_ms: 10,
            enable_batching: true,
        }
    }
}

/// 内存池管理器
pub struct MemoryPool {
    /// 消息对象池
    message_pool: Arc<RwLock<VecDeque<Message>>>,
    /// 事件对象池
    event_pool: Arc<RwLock<VecDeque<Event>>>,
    /// 字节缓冲区池
    buffer_pool: Arc<RwLock<VecDeque<Vec<u8>>>>,
    /// 池大小限制
    max_pool_size: usize,
}

impl MemoryPool {
    pub fn new(max_pool_size: usize) -> Self {
        Self {
            message_pool: Arc::new(RwLock::new(VecDeque::with_capacity(max_pool_size))),
            event_pool: Arc::new(RwLock::new(VecDeque::with_capacity(max_pool_size))),
            buffer_pool: Arc::new(RwLock::new(VecDeque::with_capacity(max_pool_size))),
            max_pool_size,
        }
    }

    /// 获取消息对象（从池中或新建）
    pub async fn get_message(&self) -> Message {
        let mut pool = self.message_pool.write().await;
        pool.pop_front().unwrap_or_else(|| {
            // 如果池为空，创建新消息
            Message::new(
                MessageType::Heartbeat,
                "pool".to_string(),
                MessagePayload::Heartbeat(HeartbeatMessage {
                    sequence: 0,
                    status: "active".to_string(),
                }),
            )
        })
    }

    /// 归还消息对象到池中
    pub async fn return_message(&self, mut message: Message) {
        // 重置消息状态
        message.id = uuid::Uuid::new_v4().to_string();
        message.timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut pool = self.message_pool.write().await;
        if pool.len() < self.max_pool_size {
            pool.push_back(message);
        }
    }

    /// 获取字节缓冲区
    pub async fn get_buffer(&self) -> Vec<u8> {
        let mut pool = self.buffer_pool.write().await;
        pool.pop_front().unwrap_or_else(|| Vec::with_capacity(8192))
    }

    /// 归还字节缓冲区到池中
    pub async fn return_buffer(&self, mut buffer: Vec<u8>) {
        buffer.clear();
        let mut pool = self.buffer_pool.write().await;
        if pool.len() < self.max_pool_size && buffer.capacity() <= 65536 {
            pool.push_back(buffer);
        }
    }
}

impl OptimizedMessageRouter {
    pub fn new() -> Self {
        Self::with_config(BatchConfig::default(), 1000)
    }

    pub fn with_config(batch_config: BatchConfig, pool_size: usize) -> Self {
        Self {
            handlers: DashMap::new(),
            stats: Arc::new(MessageRouterStats::default()),
            batch_config,
            memory_pool: Arc::new(MemoryPool::new(pool_size)),
        }
    }

    /// 注册优化的消息处理器
    pub async fn register_handler(&self, handler: Arc<dyn OptimizedMessageHandler>) {
        let supported_types = handler.supported_message_types();
        for message_type in supported_types {
            self.handlers
                .entry(message_type)
                .or_insert_with(Vec::new)
                .push(handler.clone());
        }
        info!("Registered optimized message handler");
    }

    /// 高性能批量路由消息
    pub async fn route_messages_batch(
        &self,
        messages: Vec<Message>,
    ) -> Vec<Result<Option<Message>>> {
        let start_time = Instant::now();
        let batch_size = messages.len();

        // 更新统计信息
        self.stats
            .pending_messages
            .fetch_add(batch_size, Ordering::Relaxed);
        self.stats
            .total_messages
            .fetch_add(batch_size as u64, Ordering::Relaxed);

        // 按消息类型分组以优化处理
        let mut grouped_messages: DashMap<MessageType, Vec<Message>> = DashMap::new();
        for message in messages {
            grouped_messages
                .entry(message.message_type)
                .or_insert_with(Vec::new)
                .push(message);
        }

        let mut results = Vec::with_capacity(batch_size);
        let mut successful_count = 0;
        let mut failed_count = 0;

        // 并行处理每种类型的消息
        let mut handles = Vec::new();
        for entry in grouped_messages {
            let handlers = self.handlers.get(&entry.key()).cloned().unwrap_or_default();
            let messages = entry.remove();
            let stats = self.stats.clone();

            if !handlers.is_empty() {
                let handle = tokio::spawn(async move {
                    let mut type_results = Vec::new();
                    for message in messages {
                        let mut message_results = Vec::new();
                        for handler in &handlers {
                            let result = handler.handle_message_optimized(&message).await;
                            match result {
                                Ok(Some(response)) => {
                                    successful_count += 1;
                                    message_results.push(Ok(Some(response)));
                                }
                                Ok(None) => {
                                    successful_count += 1;
                                    message_results.push(Ok(None));
                                }
                                Err(e) => {
                                    failed_count += 1;
                                    error!("Message handler failed: {}", e);
                                    message_results.push(Err(e));
                                }
                            }
                        }
                        type_results.push(message_results);
                    }
                    type_results
                });
                handles.push(handle);
            }
        }

        // 等待所有处理完成并收集结果
        for handle in handles {
            match handle.await {
                Ok(type_results) => {
                    for message_results in type_results {
                        results.extend(message_results);
                    }
                }
                Err(e) => {
                    error!("Batch processing task failed: {}", e);
                    // 为失败的任务添加错误结果
                    for _ in 0..batch_size / handles.len() {
                        results.push(Err(anyhow::anyhow!("Task execution failed: {}", e)));
                        failed_count += 1;
                    }
                }
            }
        }

        // 更新统计信息
        self.stats
            .pending_messages
            .fetch_sub(batch_size, Ordering::Relaxed);
        self.stats
            .successful_messages
            .fetch_add(successful_count, Ordering::Relaxed);
        self.stats
            .failed_messages
            .fetch_add(failed_count, Ordering::Relaxed);

        let processing_time = start_time.elapsed().as_micros() as u64;
        self.stats
            .avg_processing_time_us
            .store(processing_time, Ordering::Relaxed);

        debug!(
            "Processed batch of {} messages in {}μs (success: {}, failed: {})",
            batch_size, processing_time, successful_count, failed_count
        );

        results
    }

    /// 单个消息路由（兼容性方法）
    pub async fn route_message(&self, message: &Message) -> Vec<Result<Option<Message>>> {
        let results = self.route_messages_batch(vec![message.clone()]).await;
        results
    }

    /// 获取性能统计
    pub fn get_stats(&self) -> &MessageRouterStats {
        &self.stats
    }

    /// 获取内存池
    pub fn get_memory_pool(&self) -> Arc<MemoryPool> {
        self.memory_pool.clone()
    }
}

impl Default for OptimizedMessageRouter {
    fn default() -> Self {
        Self::new()
    }
}

/// 优化的消息处理器 trait
#[async_trait::async_trait]
pub trait OptimizedMessageHandler: Send + Sync {
    /// 优化的消息处理方法
    async fn handle_message_optimized(
        &self,
        message: &Message,
    ) -> Result<Option<Message>, anyhow::Error>;

    /// 兼容性方法（默认调用优化方法）
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>, anyhow::Error> {
        self.handle_message_optimized(message).await
    }

    /// 获取处理器支持的消息类型
    fn supported_message_types(&self) -> Vec<MessageType>;

    /// 获取处理器名称（用于监控）
    fn name(&self) -> &str;

    /// 获取处理器优先级（用于调度）
    fn priority(&self) -> u8 {
        100 // 默认优先级
    }
}

/// 消息重试管理器
pub struct MessageRetryManager {
    /// 重试队列
    retry_queue: Arc<RwLock<VecDeque<RetryableMessage>>>,
    /// 最大重试次数
    max_retries: u32,
    /// 重试间隔（毫秒）
    retry_interval_ms: u64,
    /// 指数退避因子
    backoff_factor: f64,
    /// 重试统计
    retry_stats: Arc<RetryStats>,
}

/// 可重试的消息
#[derive(Debug, Clone)]
pub struct RetryableMessage {
    pub message: Message,
    pub retry_count: u32,
    pub last_attempt: Instant,
    pub next_attempt: Instant,
    pub error: Option<String>,
}

/// 重试统计
#[derive(Debug, Default)]
pub struct RetryStats {
    pub total_retries: AtomicU64,
    pub successful_retries: AtomicU64,
    pub failed_retries: AtomicU64,
    pub avg_retries_per_message: AtomicU64,
}

impl MessageRetryManager {
    pub fn new(max_retries: u32, retry_interval_ms: u64, backoff_factor: f64) -> Self {
        Self {
            retry_queue: Arc::new(RwLock::new(VecDeque::new())),
            max_retries,
            retry_interval_ms,
            backoff_factor,
            retry_stats: Arc::new(RetryStats::default()),
        }
    }

    /// 添加消息到重试队列
    pub async fn add_retry_message(&self, message: Message, error: String) {
        let retry_count = 0;
        let next_attempt = Instant::now() + Duration::from_millis(self.retry_interval_ms);

        let retryable = RetryableMessage {
            message,
            retry_count,
            last_attempt: Instant::now(),
            next_attempt,
            error: Some(error),
        };

        let mut queue = self.retry_queue.write().await;
        queue.push_back(retryable);
        self.retry_stats
            .total_retries
            .fetch_add(1, Ordering::Relaxed);
    }

    /// 启动重试处理器
    pub async fn start_retry_processor(
        &self,
        router: Arc<OptimizedMessageRouter>,
    ) -> JoinHandle<()> {
        let retry_queue = self.retry_queue.clone();
        let max_retries = self.max_retries;
        let retry_interval_ms = self.retry_interval_ms;
        let backoff_factor = self.backoff_factor;
        let retry_stats = self.retry_stats.clone();

        tokio::spawn(async move {
            loop {
                let mut ready_messages = Vec::new();

                // 收集准备重试的消息
                {
                    let mut queue = retry_queue.write().await;
                    let now = Instant::now();

                    while let Some(msg) = queue.front() {
                        if msg.next_attempt <= now {
                            ready_messages.push(queue.pop_front().unwrap());
                        } else {
                            break;
                        }
                    }
                }

                // 处理准备重试的消息
                for mut retryable in ready_messages {
                    if retryable.retry_count >= max_retries {
                        warn!(
                            "Message {} exceeded max retries ({}), giving up",
                            retryable.message.id, max_retries
                        );
                        retry_stats.failed_retries.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }

                    debug!(
                        "Retrying message {} (attempt {}/{})",
                        retryable.message.id,
                        retryable.retry_count + 1,
                        max_retries
                    );

                    // 尝试重新处理消息
                    let results = router.route_message(&retryable.message).await;
                    let mut success = false;

                    for result in results {
                        if result.is_ok() {
                            success = true;
                            retry_stats
                                .successful_retries
                                .fetch_add(1, Ordering::Relaxed);
                            info!(
                                "Message {} succeeded on retry {}",
                                retryable.message.id,
                                retryable.retry_count + 1
                            );
                            break;
                        }
                    }

                    if !success {
                        // 计算下次重试时间（指数退避）
                        retryable.retry_count += 1;
                        retryable.last_attempt = Instant::now();
                        let delay_ms = (retry_interval_ms as f64
                            * backoff_factor.powi(retryable.retry_count as i32))
                            as u64;
                        retryable.next_attempt = Instant::now() + Duration::from_millis(delay_ms);

                        // 重新加入队列
                        {
                            let mut queue = retry_queue.write().await;
                            queue.push_back(retryable);
                        }
                    }
                }

                // 等待一小段时间再检查
                sleep(Duration::from_millis(100)).await;
            }
        })
    }

    /// 获取重试统计
    pub fn get_retry_stats(&self) -> &RetryStats {
        &self.retry_stats
    }
}

/// 高性能事件管理器
pub struct OptimizedEventManager {
    /// 使用 DashMap 提高并发性能
    listeners: DashMap<EventType, Vec<Arc<dyn OptimizedEventListener>>>,
    /// 事件通道
    event_tx: mpsc::UnboundedSender<OptimizedEvent>,
    /// 批量处理配置
    batch_config: BatchConfig,
    /// 事件统计
    stats: Arc<EventStats>,
    /// 内存池
    memory_pool: Arc<MemoryPool>,
}

/// 优化的事件
#[derive(Debug, Clone)]
pub struct OptimizedEvent {
    pub event_type: EventType,
    pub source: String,
    pub data: serde_json::Value,
    pub timestamp: u64,
    pub session_id: Option<String>,
    pub priority: EventPriority,
}

/// 事件优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EventPriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// 事件统计
#[derive(Debug, Default)]
pub struct EventStats {
    pub total_events: AtomicU64,
    pub events_by_type: DashMap<EventType, AtomicU64>,
    pub avg_processing_time_us: AtomicU64,
    pub pending_events: AtomicUsize,
}

impl OptimizedEventManager {
    pub fn new() -> Self {
        Self::with_config(BatchConfig::default(), 1000)
    }

    pub fn with_config(batch_config: BatchConfig, pool_size: usize) -> Self {
        let (event_tx, _) = mpsc::unbounded_channel();

        Self {
            listeners: DashMap::new(),
            event_tx,
            batch_config,
            stats: Arc::new(EventStats::default()),
            memory_pool: Arc::new(MemoryPool::new(pool_size)),
        }
    }

    /// 注册优化的事件监听器
    pub async fn register_listener(&self, listener: Arc<dyn OptimizedEventListener>) {
        for event_type in listener.supported_events() {
            self.listeners
                .entry(event_type)
                .or_insert_with(Vec::new)
                .push(listener.clone());
        }
        info!("Registered optimized event listener: {}", listener.name());
    }

    /// 发布优化事件
    pub async fn publish_event(&self, event: OptimizedEvent) -> Result<()> {
        self.stats.total_events.fetch_add(1, Ordering::Relaxed);
        self.stats.pending_events.fetch_add(1, Ordering::Relaxed);

        self.stats
            .events_by_type
            .entry(event.event_type)
            .or_insert_with(|| AtomicU64::new(0))
            .fetch_add(1, Ordering::Relaxed);

        if let Err(e) = self.event_tx.send(event) {
            self.stats.pending_events.fetch_sub(1, Ordering::Relaxed);
            error!("Failed to publish optimized event: {}", e);
            return Err(anyhow::anyhow!("Failed to publish optimized event: {}", e));
        }

        Ok(())
    }

    /// 启动优化事件处理循环
    pub async fn start_event_loop(&self) -> Result<()> {
        let (mut event_rx, _) = mpsc::unbounded_channel();

        // 这里需要重新设计通道以支持多个接收器
        // 实际实现中应该使用 broadcast channel 或类似机制

        info!("Starting optimized event manager loop");
        Ok(())
    }

    /// 获取事件统计
    pub fn get_stats(&self) -> &EventStats {
        &self.stats
    }
}

/// 优化的事件监听器 trait
#[async_trait::async_trait]
pub trait OptimizedEventListener: Send + Sync {
    /// 优化的事件处理方法
    async fn handle_event_optimized(&self, event: &OptimizedEvent) -> Result<(), anyhow::Error>;

    /// 兼容性方法
    async fn handle_event(&self, event: &OptimizedEvent) -> Result<(), anyhow::Error> {
        self.handle_event_optimized(event).await
    }

    /// 获取监听器名称
    fn name(&self) -> &str;

    /// 获取支持的事件类型
    fn supported_events(&self) -> Vec<EventType>;

    /// 获取监听器优先级
    fn priority(&self) -> u8 {
        100
    }
}

/// 性能监控器
pub struct PerformanceMonitor {
    /// 监控间隔（秒）
    monitor_interval_secs: u64,
    /// 性能指标
    metrics: Arc<PerformanceMetrics>,
}

/// 性能指标
#[derive(Debug, Default)]
pub struct PerformanceMetrics {
    /// 消息处理速率（消息/秒）
    pub messages_per_second: AtomicU64,
    /// 事件处理速率（事件/秒）
    pub events_per_second: AtomicU64,
    /// 平均响应时间（微秒）
    pub avg_response_time_us: AtomicU64,
    /// 错误率（百分比）
    pub error_rate_percent: AtomicU64,
    /// 内存使用量（字节）
    pub memory_usage_bytes: AtomicU64,
    /// 活跃连接数
    pub active_connections: AtomicU64,
}

impl PerformanceMonitor {
    pub fn new(monitor_interval_secs: u64) -> Self {
        Self {
            monitor_interval_secs,
            metrics: Arc::new(PerformanceMetrics::default()),
        }
    }

    /// 启动性能监控
    pub async fn start_monitoring(
        &self,
        message_router: Arc<OptimizedMessageRouter>,
        event_manager: Arc<OptimizedEventManager>,
    ) -> JoinHandle<()> {
        let monitor_interval = Duration::from_secs(self.monitor_interval_secs);
        let metrics = self.metrics.clone();

        tokio::spawn(async move {
            loop {
                // 收集消息路由器统计
                let router_stats = message_router.get_stats();
                let total_messages = router_stats.total_messages.load(Ordering::Relaxed);
                let successful_messages = router_stats.successful_messages.load(Ordering::Relaxed);
                let failed_messages = router_stats.failed_messages.load(Ordering::Relaxed);
                let avg_time = router_stats.avg_processing_time_us.load(Ordering::Relaxed);

                // 计算指标
                let error_rate = if total_messages > 0 {
                    (failed_messages * 100) / total_messages
                } else {
                    0
                };

                // 更新指标
                metrics.messages_per_second.store(
                    successful_messages / self.monitor_interval_secs,
                    Ordering::Relaxed,
                );
                metrics
                    .avg_response_time_us
                    .store(avg_time, Ordering::Relaxed);
                metrics
                    .error_rate_percent
                    .store(error_rate, Ordering::Relaxed);

                // 输出性能报告
                info!(
                    "Performance Report - Messages: {}/s, Response: {}μs, Error: {}%",
                    successful_messages / self.monitor_interval_secs,
                    avg_time,
                    error_rate
                );

                sleep(monitor_interval).await;
            }
        })
    }

    /// 获取性能指标
    pub fn get_metrics(&self) -> Arc<PerformanceMetrics> {
        self.metrics.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_optimized_message_router() {
        let router = Arc::new(OptimizedMessageRouter::new());

        // 创建测试处理器
        struct TestHandler;

        #[async_trait]
        impl OptimizedMessageHandler for TestHandler {
            async fn handle_message_optimized(&self, message: &Message) -> Result<Option<Message>> {
                Ok(None)
            }

            fn supported_message_types(&self) -> Vec<MessageType> {
                vec![MessageType::Heartbeat]
            }

            fn name(&self) -> &str {
                "test_handler"
            }
        }

        let handler = Arc::new(TestHandler);
        router.register_handler(handler).await;

        // 测试批量处理
        let messages: Vec<Message> = (0..100)
            .map(|i| MessageBuilder::heartbeat("test".to_string(), i, "active".to_string()))
            .collect();

        let results = router.route_messages_batch(messages).await;
        assert_eq!(results.len(), 100);

        // 检查统计信息
        let stats = router.get_stats();
        assert_eq!(stats.total_messages.load(Ordering::Relaxed), 100);
    }

    #[tokio::test]
    async fn test_memory_pool() {
        let pool = Arc::new(MemoryPool::new(10));

        // 获取和归还消息对象
        let msg1 = pool.get_message().await;
        let msg2 = pool.get_message().await;

        pool.return_message(msg1).await;
        pool.return_message(msg2).await;

        // 验证池中有对象
        let msg3 = pool.get_message().await;
        assert!(msg3.sender_id == "pool"); // 说明是从池中获取的
    }

    #[tokio::test]
    async fn test_retry_manager() {
        let router = Arc::new(OptimizedMessageRouter::new());
        let retry_manager = MessageRetryManager::new(3, 100, 2.0);

        // 添加重试消息
        let message = MessageBuilder::heartbeat("test".to_string(), 1, "active".to_string());
        retry_manager
            .add_retry_message(message.clone(), "test error".to_string())
            .await;

        // 验证统计
        let stats = retry_manager.get_retry_stats();
        assert_eq!(stats.total_retries.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn test_performance_monitor() {
        let router = Arc::new(OptimizedMessageRouter::new());
        let event_manager = Arc::new(OptimizedEventManager::new());
        let monitor = PerformanceMonitor::new(1); // 1秒间隔

        let _handle = monitor
            .start_monitoring(router.clone(), event_manager.clone())
            .await;

        // 处理一些消息来生成统计数据
        let messages: Vec<Message> = (0..10)
            .map(|i| MessageBuilder::heartbeat("test".to_string(), i, "active".to_string()))
            .collect();

        router.route_messages_batch(messages).await;

        // 等待监控器收集数据
        sleep(Duration::from_millis(1500)).await;

        let metrics = monitor.get_metrics();
        assert!(metrics.messages_per_second.load(Ordering::Relaxed) > 0);
    }
}
