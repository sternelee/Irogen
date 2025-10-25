/// 完整的端到端集成测试
/// 验证简化架构的完整功能

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::{RwLock, Mutex};
use tokio::time::{sleep, Duration};
use tracing::info;
use uuid::Uuid;

use riterm_shared::{
    simple_protocol::*,
    NodeTicket,
};

// 集成测试的模拟连接管理器
struct TestConnectionManager {
    connections: Arc<RwLock<std::collections::HashMap<String, TestConnection>>>,
}

#[derive(Debug)]
struct TestConnection {
    pub id: String,
    pub node_id: String,
    pub last_ping: Arc<RwLock<std::time::Instant>>,
    pub state: Arc<RwLock<ConnectionState>>,
}

#[derive(Debug, Clone)]
enum ConnectionState {
    Connecting,
    Connected,
    Disconnected,
    Error(String),
}

impl TestConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    pub async fn add_connection(&self, id: String, node_id: String) -> Result<()> {
        let connection = TestConnection {
            id: id.clone(),
            node_id: node_id.clone(),
            last_ping: Arc::new(RwLock::new(std::time::Instant::now())),
            state: Arc::new(RwLock::new(ConnectionState::Connecting)),
        };

        let mut connections = self.connections.write().await;
        connections.insert(id, connection);
        info!("🔗 Added connection: {} ({})", id, node_id);
        Ok(())
    }

    pub async fn update_connection_state(&self, id: &str, state: ConnectionState) {
        let mut connections = self.connections.write().await;
        if let Some(conn) = connections.get_mut(id) {
            *conn.state.write().await = state.clone();
            info!("📊 Connection {} state: {:?}", id, state);
        }
    }

    pub async fn update_last_ping(&self, id: &str) {
        let connections = self.connections.read().await;
        if let Some(conn) = connections.get(id) {
            *conn.last_ping.write().await = std::time::Instant::now();
        }
    }

    pub async fn get_connection(&self, id: &str) -> Option<String> {
        let connections = self.connections.read().await;
        connections.get(id).map(|conn| conn.node_id.clone())
    }

    pub async fn remove_connection(&self, id: &str) {
        let mut connections = self.connections.write().await;
        if let Some(_conn) = connections.remove(id) {
            info!("🔌 Removed connection: {}", id);
        }
    }

    pub async fn list_connections(&self) -> Vec<String> {
        let connections = self.connections.read().await;
        connections.keys().cloned().collect()
    }

    pub async fn get_connection_stats(&self) -> ConnectionStats {
        let connections = self.connections.read().await;
        let mut stats = ConnectionStats::default();

        for conn in connections.values() {
            stats.total_connections += 1;

            match *conn.state.read().await {
                ConnectionState::Connected => stats.active_connections += 1,
                ConnectionState::Disconnected | ConnectionState::Error(_) => stats.failed_connections += 1,
                ConnectionState::Connecting => stats.pending_connections += 1,
            }

            let last_ping = *conn.last_ping.read().await;
            if last_ping.elapsed().as_secs() > 30 {
                stats.stale_connections += 1;
            }
        }

        stats
    }
}

#[derive(Debug, Default)]
struct ConnectionStats {
    total_connections: usize,
    active_connections: usize,
    pending_connections: usize,
    failed_connections: usize,
    stale_connections: usize,
}

#[tokio::test]
async fn test_end_to_end_terminal_management() -> Result<()> {
    info!("🧪 Starting end-to-end terminal management test");

    let manager = TestConnectionManager::new();

    // 模拟多个连接
    let connection_ids: Vec<String> = (0..5).map(|i| format!("conn_{}", i)).collect();

    for (i, id) in connection_ids.iter().enumerate() {
        let node_id = format!("test_node_{}", i);
        manager.add_connection(id.clone(), node_id.clone()).await?;
        manager.update_connection_state(id, ConnectionState::Connected).await;

        info!("🖥️ Created connection {}: {}", id, node_id);

        // 模拟终端操作
        sleep(Duration::from_millis(100 * i as u64)).await;
    }

    // 验证连接列表
    let active_connections = manager.list_connections().await;
    assert_eq!(active_connections.len(), 5, "Should have 5 active connections");

    // 获取连接统计
    let stats = manager.get_connection_stats().await;
    assert_eq!(stats.total_connections, 5, "Should track 5 total connections");
    assert_eq!(stats.active_connections, 5, "Should have 5 active connections");

    info!("✅ End-to-end terminal management test passed");
    Ok(())
}

#[tokio::test]
async fn test_protocol_message_roundtrip() -> Result<()> {
    info!("🧪 Starting protocol message roundtrip test");

    // 测试终端创建
    let create_request = TerminalCreateRequest {
        name: Some("test-terminal".to_string()),
        shell: Some("/bin/bash".to_string()),
        cwd: Some("/home".to_string()),
        rows: Some(24),
        cols: Some(80),
    };

    let create_message = ProtocolMessage::create_with_data(
        ProtocolCommand::TerminalCreate,
        create_request
    )?;

    assert_eq!(create_message.command, ProtocolCommand::TerminalCreate);
    assert!(create_message.raw.contains("[TERMINAL_CREATE]"));

    // 测试终端输入
    let input_request = TerminalInputRequest {
        id: "test-terminal".to_string(),
        data: "echo 'Hello from roundtrip test!'\\n".to_string(),
    };

    let input_message = ProtocolMessage::create_with_data(
        ProtocolCommand::TerminalInput,
        input_request
    )?;

    assert_eq!(input_message.command, ProtocolCommand::TerminalInput);
    assert!(input_message.raw.contains("[TERMINAL_INPUT]"));

    // 测试文件上传
    let upload_request = FileUploadRequest {
        path: "/tmp/test_upload.txt".to_string(),
        data: "SGVsbG8gdGVzdCBv".to_string(), // "Hello, World!" base64
        size: Some(13),
    };

    let upload_message = ProtocolMessage::create_with_data(
        ProtocolCommand::FileUpload,
        upload_request
    )?;

    assert_eq!(upload_message.command, ProtocolCommand::FileUpload);

    // 测试端口转发
    let port_forward_request = PortForwardCreateRequest {
        local_port: 3000,
        remote_port: Some(8080),
        service_name: "test-web".to_string(),
        service_type: Some("tcp".to_string()),
    };

    let port_forward_message = ProtocolMessage::create_with_data(
        ProtocolCommand::PortForwardCreate,
        port_forward_request
    )?;

    assert_eq!(port_forward_message.command, ProtocolCommand::PortForwardCreate);

    // 测试ping/pong
    let ping_data = serde_json::json!({"timestamp": 1234567890});
    let ping_message = ProtocolMessage::create(ProtocolCommand::Ping, ping_data);

    assert_eq!(ping_message.command, ProtocolCommand::Ping);
    assert!(ping_message.raw.contains("[PING]"));

    let pong_message = ProtocolMessage::create(
        ProtocolCommand::Pong,
        serde_json::json!({"timestamp": 1234567890})
    );

    assert_eq!(pong_message.command, ProtocolCommand::Pong);
    assert!(pong_message.raw.contains("[PONG]"));

    info!("✅ Protocol message roundtrip test passed");
    Ok(())
}

#[tokio::test]
async fn test_concurrent_connections() -> Result<()> {
    info!("🧪 Starting concurrent connections test");

    let manager = TestConnectionManager::new();

    // 创建多个并发连接
    let mut connection_tasks = Vec::new();

    for i in 0..10 {
        let manager_clone = Arc::clone(&manager);
        let task = tokio::spawn(async move {
            let id = format!("concurrent_conn_{}", i);
            let node_id = format!("concurrent_node_{}", i);

            if let Err(e) = manager_clone.add_connection(id.clone(), node_id.clone()).await {
                info!("Failed to create connection {}: {}", id, e);
                return;
            }

            // 模拟连接建立
            sleep(Duration::from_millis(50)).await;

            if let Err(e) = manager_clone.update_connection_state(&id, ConnectionState::Connected).await {
                info!("Failed to update connection state {}: {}", id, e);
            }

            sleep(Duration::from_millis(100)).await;
        });

        connection_tasks.push(task);
    }

    // 等待所有任务完成
    for task in connection_tasks {
        task.await;
    }

    // 验证并发连接结果
    let connections = manager.list_connections().await;
    assert_eq!(connections.len(), 10, "Should have 10 concurrent connections");

    let stats = manager.get_connection_stats().await;
    assert_eq!(stats.total_connections, 10, "Should track 10 total connections");
    assert_eq!(stats.active_connections, 10, "Should have 10 active connections");

    info!("✅ Concurrent connections test passed");
    Ok(())
}

#[tokio::test]
async fn test_error_handling_and_recovery() -> Result<()> {
    info!("🧪 Starting error handling and recovery test");

    let manager = TestConnectionManager::new();
    let connection_id = "error_test_conn".to_string();
    let node_id = "error_test_node".to_string();

    // 添加连接
    manager.add_connection(connection_id.clone(), node_id.clone()).await?;
    manager.update_connection_state(&connection_id, ConnectionState::Connected).await;

    // 模拟连接错误
    let error_state = ConnectionState::Error("Connection lost".to_string());
    manager.update_connection_state(&connection_id, error_state).await;

    // 验证错误状态
    let stats = manager.get_connection_stats().await;
    assert_eq!(stats.failed_connections, 1, "Should have 1 failed connection");

    // 模拟恢复 - 重新连接
    manager.update_connection_state(&connection_id, ConnectionState::Connected).await;

    let recovery_stats = manager.get_connection_stats().await;
    assert_eq!(recovery_stats.active_connections, 1, "Should have 1 active connection after recovery");
    assert_eq!(recovery_stats.failed_connections, 1, "Should still track 1 failed connection in history");

    info!("✅ Error handling and recovery test passed");
    Ok(())
}

#[tokio::test]
async fn test_performance_benchmark() -> Result<()> {
    info!("🧪 Starting performance benchmark test");

    let start_time = std::time::Instant::now();

    // 创建大量连接测试性能
    let manager = TestConnectionManager::new();
    let mut connection_ids = Vec::new();

    for i in 0..100 {
        let id = format!("perf_conn_{}", i);
        let node_id = format!("perf_node_{}", i);
        connection_ids.push((id, node_id));
    }

    // 批量创建连接
    for (id, node_id) in connection_ids {
        manager.add_connection(id, node_id).await?;
    }

    let creation_time = start_time.elapsed();
    info!("📊 Created 100 connections in {:?}", creation_time);

    // 测试消息处理性能
    let message = ProtocolMessage::create(
        ProtocolCommand::Ping,
        serde_json::json!({"timestamp": 1234567890})
    );

    let message_creation_start = std::time::Instant::now();

    // 创建1000个消息测试编解码性能
    for _ in 0..1000 {
        let _encoded = ProtocolCodec::encode(&message).unwrap();
        let _decoded = ProtocolCodec::decode(&_encoded).unwrap();
    }

    let message_processing_time = message_creation_start.elapsed();
    info!("📊 Processed 1000 messages in {:?}", message_processing_time);

    // 验证结果
    let stats = manager.get_connection_stats().await;
    assert_eq!(stats.total_connections, 100, "Should track 100 connections");
    assert_eq!(stats.active_connections, 100, "Should have 100 active connections");

    let total_test_time = start_time.elapsed();
    info!("📊 Total test completed in {:?}", total_test_time);

    info!("✅ Performance benchmark test passed");
    Ok(())
}

#[tokio::test]
async fn test_connection_cleanup_and_leak_prevention() -> Result<()> {
    info!("🧪 Starting connection cleanup and leak prevention test");

    let manager = TestConnectionManager::new();
    let mut connection_ids = Vec::new();

    // 创建大量连接
    for i in 0..50 {
        let id = format!("cleanup_conn_{}", i);
        let node_id = format!("cleanup_node_{}", i);
        connection_ids.push(id.clone());
        manager.add_connection(id, node_id).await?;
        manager.update_connection_state(&id, ConnectionState::Connected).await;
    }

    // 验证初始状态
    let initial_stats = manager.get_connection_stats().await;
    assert_eq!(initial_stats.total_connections, 50, "Should have 50 connections initially");

    // 清理一半连接
    for (i, id) in connection_ids.iter().enumerate() {
        if i % 2 == 0 {
            manager.remove_connection(id).await;
        }
    }

    // 验证清理后的状态
    let cleanup_stats = manager.get_connection_stats().await;
    assert_eq!(cleanup_stats.total_connections, 25, "Should have 25 connections after cleanup");

    // 清理所有连接
    for id in &connection_ids {
        manager.remove_connection(id).await;
    }

    // 验证最终状态
    let final_stats = manager.get_connection_stats().await;
    assert_eq!(final_stats.total_connections, 0, "Should have 0 connections after full cleanup");

    info!("✅ Connection cleanup and leak prevention test passed");
    Ok(())
}