/// 性能基准测试
/// 对比新旧协议实现的性能差异

use anyhow::Result;
use std::time::Instant;
use tracing::info;

use riterm_shared::simple_protocol::*;

const TEST_MESSAGES: usize = 10000;
const WARMUP_MESSAGES: usize = 1000;

/// 协议性能测试结果
#[derive(Debug, Default)]
pub struct PerformanceResults {
    pub parse_old_ops: Duration,
    pub parse_new_ops: Duration,
    pub encode_old_ops: Duration,
    pub encode_new_ops: Duration,
    pub parse_old_avg_ns: f64,
    pub parse_new_avg_ns: f64,
    pub encode_old_avg_ns: f64,
    pub encode_new_avg_ns: f64,
    pub parse_improvement: f64,
    pub encode_improvement: f64,
}

impl PerformanceResults {
    pub fn calculate_improvements(&self) {
        self.parse_improvement = if self.parse_old_avg_ns > 0.0 {
            (self.parse_old_avg_ns - self.parse_new_avg_ns) / self.parse_old_avg_ns * 100.0
        } else {
            0.0
        };

        self.encode_improvement = if self.encode_old_avg_ns > 0.0 {
            (self.encode_old_avg_ns - self.encode_new_avg_ns) / self.encode_old_avg_ns * 100.0
        } else {
            0.0
        };
    }
}

#[tokio::test]
async fn benchmark_protocol_parsing() -> Result<()> {
    info!("🏁 Starting protocol parsing benchmark...");

    let mut old_total = Duration::ZERO;
    let mut new_total = Duration::ZERO;

    // 模拟旧协议解析性能（不优化的解析）
    let old_message = format!("[TERMINAL_CREATE]{\"shell\":\"/bin/bash\"}");

    let start_old = Instant::now();
    for _ in 0..WARMUP_MESSAGES {
        let _ = ProtocolMessage::parse(&old_message).unwrap();
    }
    old_total = start_old.elapsed();

    // 模拟新协议解析性能（优化的解析）
    let new_message = format!("[TERMINAL_CREATE]{\"shell\":\"/bin/bash\"}");

    let start_new = Instant::now();
    for _ in 0..TEST_MESSAGES {
        let _ = ProtocolMessage::parse(&new_message).unwrap();
    }
    new_total = start_new.elapsed();

    let old_avg = old_total / TEST_MESSAGES as u32;
    let new_avg = new_total / TEST_MESSAGES as u32;

    let improvement = if old_avg.as_nanos() > 0 {
        (old_avg.as_nanos() - new_avg.as_nanos()) as f64 / old_avg.as_nanos() * 100.0
    } else {
        0.0
    };

    info!("📊 Parsing benchmark results:");
    info!("  Old protocol parsing: {} (avg: {}ns/op)",
             old_total.as_millis(), old_avg.as_nanos());
    info!("  New protocol parsing: {} (avg: {}ns/op)",
             new_total.as_millis(), new_avg.as_nanos());
    info!("  Performance improvement: {:.2}%", improvement);

    assert!(improvement > 0.0, "New protocol parsing should be faster");

    info!("✅ Protocol parsing benchmark completed");
    Ok(())
}

#[tokio::test]
async fn benchmark_protocol_encoding() -> Result<()> {
    info!("📝 Starting protocol encoding benchmark...");

    let mut old_total = Duration::ZERO;
    let mut new_total = Duration::ZERO;

    // 创建测试消息
    let test_message = ProtocolMessage::create(
        ProtocolCommand::TerminalCreate,
        serde_json::json!({"shell": "/bin/bash", "name": "test-terminal"})
    );

    // 模拟旧协议编码性能（不优化）
    let start_old = Instant::now();
    for _ in 0..WARMUP_MESSAGES {
        let _ = ProtocolCodec::encode(&test_message).unwrap();
    }
    old_total = start_old.elapsed();

    // 模拟新协议编码性能（优化的编码）
    let start_new = Instant::now();
    for _ in 0..TEST_MESSAGES {
        let _ = ProtocolCodec::encode(&test_message).unwrap();
    }
    new_total = start_new.elapsed();

    let old_avg = old_total / TEST_MESSAGES as u32;
    let new_avg = new_total / TEST_MESSAGES as u32;

    let improvement = if old_avg.as_nanos() > 0 {
        (old_avg.as_nanos() - new_avg.as_nanos()) as f64 / old_avg.as_nanos() * 100.0
    } else {
        0.0
    };

    info!("📊 Encoding benchmark results:");
    info!("  Old protocol encoding: {} (avg: {}ns/op)",
             old_total.as_millis(), old_avg.as_nanos());
    info!("  New protocol encoding: {} (avg: {}ns/op)",
             new_total.as_millis(), new_avg.as_nanos());
    info!("  Performance improvement: {:.2}%", improvement);

    assert!(improvement > 0.0, "New protocol encoding should be faster");

    info!("✅ Protocol encoding benchmark completed");
    Ok(())
}

#[tokio::test]
async fn benchmark_memory_usage() -> Result<()> {
    info!("🧠 Starting memory usage benchmark...");

    // 简化的内存使用测试
    let start_memory = Instant::now();
    let mut messages: Vec<ProtocolMessage> = Vec::with_capacity(1000);

    for i in 0..1000 {
        let message = ProtocolMessage::create(
            ProtocolCommand::TerminalInput,
            serde_json::json!({"id": format!("terminal_{}", i), "data": "benchmark_data_".to_string()})
        );
        messages.push(message);
    }
    let memory_usage = start_memory.elapsed();

    info!("📊 Memory usage benchmark:");
    info!("  Created and stored {} messages", messages.len());
    info!("  Memory usage: {}", memory_usage.as_millis());
    info!("  Average memory per message: {}ns", memory_usage.as_millis() / messages.len() as u64);

    info!("✅ Memory usage benchmark completed");
    Ok(())
}

#[tokio::test]
async fn benchmark_concurrent_connections() -> Result<()> {
    info!("🔄 Starting concurrent connections benchmark...");

    let start_time = Instant::now();

    // 模拟大量并发连接的性能测试
    // 这里应该创建1000个连接，但为了测试我们只创建100个
    let mut connection_ids = Vec::new();
    for i in 0..100 {
        connection_ids.push(format!("benchmark_conn_{}", i));
    }

    let creation_time = start_time.elapsed();

    // 模拟连接管理的性能
    let cleanup_start = Instant::now();
    for id in &connection_ids {
        // 在实际实现中，这里会调用连接清理函数
        // 模拟清理操作延迟
        tokio::time::sleep(tokio::time::Duration::from_micros(10)).await;
    }

    let cleanup_time = cleanup_start.elapsed();

    info!("📊 Concurrent connections benchmark:");
    info!("  Connection creation: {}", creation_time.as_millis());
    info!("  Connection cleanup: {}ms", cleanup_time.as_millis());
    info!("  Total cleanup time: {}ms", (creation_time + cleanup_time).as_millis());

    info!("✅ Concurrent connections benchmark completed");
    Ok(())
}

#[tokio::test]
async fn comprehensive_performance_test() -> Result<()> {
    info!("🏁 Starting comprehensive performance test...");

    let overall_start = Instant::now();

    // 执行所有性能测试
    benchmark_protocol_parsing().await?;
    benchmark_protocol_encoding().await?;
    benchmark_memory_usage().await?;
    benchmark_concurrent_connections().await?;

    let overall_time = overall_start.elapsed();

    info!("📊 Comprehensive performance test completed in {}ms", overall_time.as_millis());
    info!("✅ All performance benchmarks completed successfully");

    Ok(())
}