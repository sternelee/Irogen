//! 消息处理器性能测试
//!
//! 此示例演示了 RiTerm 消息处理器的性能优化功能，包括：
//! - 批量处理效果对比
//! - 性能监控
//! - 连接池使用
//! - 消息缓存机制

use riterm_shared::{
    MessageBuilder, MessageType, EnhancedMessageRouter, EnhancedCommunicationManager,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 初始化日志
    tracing_subscriber::fmt::init();

    info!("🚀 RiTerm 消息处理器性能测试");
    info!("此测试展示了消息处理器的性能优化功能");

    // 测试 1: 基础性能测试
    test_basic_performance().await?;

    // 测试 2: 批量处理对比
    test_batching_performance().await?;

    // 测试 3: 性能监控功能
    test_performance_monitoring().await?;

    // 测试 4: 增强通信管理器
    test_enhanced_communication_manager().await?;

    // 测试 5: 连接池效果
    test_connection_pool().await?;

    info!("✅ 所有性能测试完成！");
    Ok(())
}

/// 基础性能测试
async fn test_basic_performance() -> Result<(), Box<dyn std::error::Error>> {
    info!("\n📊 测试 1: 基础性能测试");
    info!("测试单个消息处理的性能基准");

    let router = Arc::new(EnhancedMessageRouter::new());

    // 创建测试处理器
    struct FastHandler;
    #[async_trait::async_trait]
    impl riterm_shared::MessageHandler for FastHandler {
        async fn handle_message(&self, _message: &riterm_shared::Message) -> Result<Option<riterm_shared::Message>, anyhow::Error> {
            // 模拟快速处理
            tokio::time::sleep(Duration::from_micros(100)).await;
            Ok(None)
        }

        fn supported_message_types(&self) -> Vec<MessageType> {
            vec![MessageType::Heartbeat, MessageType::TerminalManagement]
        }
    }

    let handler = Arc::new(FastHandler);
    router.register_handler(handler).await;

    // 测试不同规模的消息处理
    let test_sizes = vec![100, 500, 1000, 5000];

    for size in test_sizes {
        let messages: Vec<riterm_shared::Message> = (0..size)
            .map(|i| {
                MessageBuilder::heartbeat(
                    format!("test_node_{}", i % 10),
                    i as u64,
                    "active".to_string(),
                )
            })
            .collect();

        let start_time = Instant::now();
        let _results = router.route_messages_batch(messages).await;
        let duration = start_time.elapsed();

        let throughput = size as f64 / duration.as_secs_f64();
        let stats = router.get_stats();

        info!(
            "Batch size: {}, Duration: {:?}, Throughput: {:.2} msg/s, Avg: {}μs",
            size,
            duration,
            throughput,
            stats.avg_processing_time_us.load(std::sync::atomic::Ordering::Relaxed)
        );
    }

    Ok(())
}

/// 批量处理对比测试
async fn test_batching_performance() -> Result<(), Box<dyn std::error::Error>> {
    info!("\n📈 测试 2: 批量处理对比测试");
    info!("对比单条处理 vs 批量处理的性能差异");

    let router_batch = Arc::new(EnhancedMessageRouter::new());
    let router_single = Arc::new(riterm_shared::MessageRouter::new());

    // 注册处理器
    struct TestHandler;
    #[async_trait::async_trait]
    impl riterm_shared::MessageHandler for TestHandler {
        async fn handle_message(&self, _message: &riterm_shared::Message) -> Result<Option<riterm_shared::Message>, anyhow::Error> {
            tokio::time::sleep(Duration::from_micros(50)).await;
            Ok(None)
        }

        fn supported_message_types(&self) -> Vec<MessageType> {
            vec![MessageType::Heartbeat]
        }
    }

    let handler = Arc::new(TestHandler);
    router_batch.register_handler(handler.clone()).await;
    router_single.register_handler(handler).await;

    let test_size = 1000;
    let messages: Vec<riterm_shared::Message> = (0..test_size)
        .map(|i| {
            MessageBuilder::heartbeat(
                format!("test_node_{}", i % 5),
                i as u64,
                "active".to_string(),
            )
        })
        .collect();

    // 批量处理测试
    let start_batch = Instant::now();
    let _batch_results = router_batch.route_messages_batch(messages.clone()).await;
    let batch_duration = start_batch.elapsed();

    // 单条处理测试
    let start_single = Instant::now();
    for message in &messages {
        router_single.route_message(message).await;
    }
    let single_duration = start_single.elapsed();

    let batch_throughput = test_size as f64 / batch_duration.as_secs_f64();
    let single_throughput = test_size as f64 / single_duration.as_secs_f64();

    info!("消息数量: {}", test_size);
    info!("批量处理: {:?}, 吞吐量: {:.2} msg/s", batch_duration, batch_throughput);
    info!("单条处理: {:?}, 吞吐量: {:.2} msg/s", single_duration, single_throughput);
    info!("性能提升: {:.2}x", batch_throughput / single_throughput);

    Ok(())
}

/// 性能监控测试
async fn test_performance_monitoring() -> Result<(), Box<dyn std::error::Error>> {
    info!("\n📊 测试 3: 性能监控测试");
    info!("测试实时性能监控功能");

    let router = Arc::new(EnhancedMessageRouter::new());

    // 创建处理器
    struct VariableSpeedHandler;
    #[async_trait::async_trait]
    impl riterm_shared::MessageHandler for VariableSpeedHandler {
        async fn handle_message(&self, message: &riterm_shared::Message) -> Result<Option<riterm_shared::Message>, anyhow::Error> {
            // 模拟可变处理时间
            let delay = match message.id.len() % 3 {
                0 => Duration::from_micros(50),
                1 => Duration::from_micros(200),
                _ => Duration::from_micros(500),
            };
            tokio::time::sleep(delay).await;
            Ok(None)
        }

        fn supported_message_types(&self) -> Vec<MessageType> {
            vec![MessageType::Heartbeat, MessageType::TerminalIO]
        }
    }

    let handler = Arc::new(VariableSpeedHandler);
    router.register_handler(handler).await;

    // 生成不同负载的消息
    info!("开始发送测试消息...");
    for i in 0..1000 {
        let message = MessageBuilder::heartbeat(
            format!("load_test_{}", i),
            i as u64,
            "active".to_string(),
        );

        router.route_message(&message).await;

        // 每100个消息输出一次统计
        if (i + 1) % 100 == 0 {
            let stats = router.get_stats();
            info!(
                "进度: {}/1000, 成功率: {}%, 平均时间: {}μs",
                i + 1,
                (stats.successful_processed.load(std::sync::atomic::Ordering::Relaxed) * 100)
                    / stats.total_processed.load(std::sync::atomic::Ordering::Relaxed),
                stats.avg_processing_time_us.load(std::sync::atomic::Ordering::Relaxed)
            );
        }

        // 模拟负载波动
        if i % 200 == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    // 最终统计
    let final_stats = router.get_stats();
    info!("最终统计:");
    info!("  总处理数: {}", final_stats.total_processed.load(std::sync::atomic::Ordering::Relaxed));
    info!("  成功处理数: {}", final_stats.successful_processed.load(std::sync::atomic::Ordering::Relaxed));
    info!("  失败处理数: {}", final_stats.failed_processed.load(std::sync::atomic::Ordering::Relaxed));
    info!("  平均处理时间: {}μs", final_stats.avg_processing_time_us.load(std::sync::atomic::Ordering::Relaxed));

    let success_rate = (final_stats.successful_processed.load(std::sync::atomic::Ordering::Relaxed) * 100)
        / final_stats.total_processed.load(std::sync::atomic::Ordering::Relaxed);
    info!("  成功率: {}%", success_rate);

    if success_rate < 95 {
        warn!("成功率较低: {}%，建议检查系统资源", success_rate);
    }

    Ok(())
}

/// 增强通信管理器测试
async fn test_enhanced_communication_manager() -> Result<(), Box<dyn std::error::Error>> {
    info!("\n🔧 测试 4: 增强通信管理器测试");
    info!("测试完整的增强通信管理器功能");

    let manager = Arc::new(EnhancedCommunicationManager::new("perf_test_node".to_string()));

    // 注册处理器
    struct EnhancedHandler;
    #[async_trait::async_trait]
    impl riterm_shared::MessageHandler for EnhancedHandler {
        async fn handle_message(&self, message: &riterm_shared::Message) -> Result<Option<riterm_shared::Message>, anyhow::Error> {
            // 模拟复杂的消息处理
            tokio::time::sleep(Duration::from_millis(1)).await;

            // 根据消息类型生成响应
            match message.message_type {
                MessageType::Heartbeat => {
                    Ok(Some(MessageBuilder::response(
                        message.sender_id.clone(),
                        "resp_123".to_string(),
                        true,
                        Some(serde_json::json!({"status": "ok"})),
                        Some("Heartbeat response".to_string()),
                    )))
                }
                _ => Ok(None),
            }
        }

        fn supported_message_types(&self) -> Vec<MessageType> {
            vec![MessageType::Heartbeat, MessageType::TerminalManagement, MessageType::TcpForwarding]
        }
    }

    let handler = Arc::new(EnhancedHandler);
    manager.register_message_handler(handler).await;

    // 初始化管理器
    info!("初始化增强通信管理器...");
    manager.initialize().await?;

    // 启动心跳任务
    manager.start_heartbeat_task().await?;

    // 发送测试消息
    info!("发送测试消息...");
    for i in 0..50 {
        let message = MessageBuilder::heartbeat(
            format!("enhanced_test_{}", i),
            i as u64,
            "active".to_string(),
        );
        manager.send_message(message.clone()).await?;
        manager.receive_incoming_message(message).await?;
    }

    // 等待一段时间让监控器收集数据
    info!("等待性能监控器收集数据...");
    sleep(Duration::from_secs(5)).await;

    // 获取统计信息
    let stats = manager.get_processing_stats();
    info!("管理器统计:");
    info!("  总处理数: {}", stats.total_processed.load(std::sync::atomic::Ordering::Relaxed));
    info!("  成功处理数: {}", stats.successful_processed.load(std::sync::atomic::Ordering::Relaxed));
    info!("  平均处理时间: {}μs", stats.avg_processing_time_us.load(std::sync::atomic::Ordering::Relaxed));
    info!("  当前队列大小: {}", stats.queue_size.load(std::sync::atomic::Ordering::Relaxed));
    info!("  峰值队列大小: {}", stats.peak_queue_size.load(std::sync::atomic::Ordering::Relaxed));

    Ok(())
}

/// 连接池测试
async fn test_connection_pool() -> Result<(), Box<dyn std::error::Error>> {
    info!("\n🔗 测试 5: 连接池测试");
    info!("测试连接池的复用效果");

    use riterm_shared::MessageConnectionPool;

    let pool = Arc::new(MessageConnectionPool::new(10));

    info!("初始连接数: {}", pool.current_connections());

    // 模拟获取和归还连接
    for i in 0..20 {
        // 获取连接
        let connection = pool.get_connection().await;

        if connection.is_some() {
            info!("获取到连接 {}", i);
            // 模拟使用连接
            tokio::time::sleep(Duration::from_millis(10)).await;

            // 归还连接
            pool.return_connection(connection.unwrap()).await;
            info!("归还连接 {}", i);
        } else {
            info!("无可用连接 {}", i);
        }

        if i % 5 == 0 {
            info!("当前连接数: {}", pool.current_connections());
        }
    }

    Ok(())
}

/// 性能基准测试函数
async fn benchmark_message_processing(
    router: Arc<EnhancedMessageRouter>,
    message_count: usize,
    batch_sizes: Vec<usize>,
) -> Vec<(usize, Duration, f64)> {
    let mut results = Vec::new();

    let messages: Vec<riterm_shared::Message> = (0..message_count)
        .map(|i| {
            MessageBuilder::heartbeat(
                format!("benchmark_{}", i),
                i as u64,
                "active".to_string(),
            )
        })
        .collect();

    for &batch_size in &batch_sizes {
        // 分批处理
        let start_time = Instant::now();
        for chunk in messages.chunks(batch_size) {
            router.route_messages_batch(chunk.to_vec()).await;
        }
        let duration = start_time.elapsed();
        let throughput = message_count as f64 / duration.as_secs_f64();

        results.push((batch_size, duration, throughput));
        info!(
            "批量大小: {}, 总时间: {:?}, 吞吐量: {:.2} msg/s",
            batch_size,
            duration,
            throughput
        );
    }

    results
}

/// 压力测试函数
async fn stress_test_message_processing(
    router: Arc<EnhancedMessageRouter>,
    duration_secs: u64,
    message_rate: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    info!("开始压力测试: {}秒内每秒{}条消息", duration_secs, message_rate);

    let message_count = duration_secs * message_rate as u64;
    let messages: Vec<riterm_shared::Message> = (0..message_count)
        .map(|i| {
            MessageBuilder::heartbeat(
                format!("stress_test_{}", i),
                i as u64,
                "active".to_string(),
            )
        })
        .collect();

    let start_time = Instant::now();
    let interval = Duration::from_millis(1000 / message_rate as u64);

    // 使用 tokio-timer 实现定时发送
    let mut interval_timer = tokio::time::interval(interval);
    let mut message_index = 0;

    loop {
        tokio::select! {
            _ = interval_timer.tick() => {
                if message_index < messages.len() {
                    router.route_message(&messages[message_index]).await;
                    message_index += 1;
                } else {
                    info!("所有消息已发送完成");
                    break;
                }
            }
            _ = sleep(Duration::from_secs(1)) => {
                if Instant::now() - start_time >= Duration::from_secs(duration_secs) {
                    info!("压力测试时间结束");
                    break;
                }
            }
        }
    }

    let total_time = start_time.elapsed();
    let actual_rate = message_index as f64 / total_time.as_secs_f64();
    let stats = router.get_stats();

    info!("压力测试结果:");
    info!("  目标时间: {}秒", duration_secs);
    info!("  实际时间: {:?}", total_time);
    info!("  目标速率: {} msg/s", message_rate);
    info!("  实际速率: {:.2} msg/s", actual_rate);
    info!("  处理消息数: {}", message_index);
    info!("  成功率: {}%",
        (stats.successful_processed.load(std::sync::atomic::Ordering::Relaxed) * 100) /
        stats.total_processed.load(std::sync::atomic::Ordering::Relaxed)
    );
    info!("  平均处理时间: {}μs",
        stats.avg_processing_time_us.load(std::sync::atomic::Ordering::Relaxed)
    );

    Ok(())
}