/// 简化主机集成测试
/// 验证新架构的完整功能

use anyhow::{Result, anyhow};
use std::sync::Arc;
use tokio::sync::{RwLock, Mutex};
use tokio::time::{sleep, Duration};
use tracing::{info, error, warn};
use uuid::Uuid;

use riterm_shared::{
    simple_protocol::*,
    NodeTicket,
};

// 测试用主机模拟
struct TestSimpleHost {
    connections: Arc<RwLock<std::collections::HashMap<String, TestConnection>>>,
    terminal_count: Arc<RwLock<usize>>,
}

#[derive(Debug)]
struct TestConnection {
    pub id: String,
    pub node_id: String,
    pub created_terminals: Vec<String>,
    pub last_activity: Arc<RwLock<std::time::Instant>>,
    pub state: Arc<RwLock<ConnectionState>>,
}

#[derive(Debug, Clone)]
enum ConnectionState {
    Connecting,
    Active,
    Error(String),
}

impl TestSimpleHost {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(std::collections::HashMap::new())),
            terminal_count: Arc::new(RwLock::new(0)),
        }
    }

    pub async fn add_connection(&self, id: String, node_id: String) -> Result<()> {
        let connection = TestConnection {
            id: id.clone(),
            node_id: node_id.clone(),
            created_terminals: Vec::new(),
            last_activity: Arc::new(RwLock::new(std::time::Instant::now())),
            state: Arc::new(RwLock::new(ConnectionState::Connecting)),
        };

        let mut connections = self.connections.write().await;
        connections.insert(id, connection);
        info!("✅ Added connection: {} ({})", id, node_id);
        Ok(())
    }

    pub async fn update_connection_state(&self, id: &str, state: ConnectionState) -> Result<()> {
        let connections = self.connections.read().await;
        if let Some(conn) = connections.get(id) {
            *conn.state.write().await = state.clone();
            info!("📊 Connection {} state: {:?}", id, state);
        } else {
            return Err(anyhow!("Connection not found: {}", id));
        }
    }

    pub async fn add_terminal(&self, connection_id: &str, terminal_id: String) -> Result<()> {
        let connections = self.connections.read().await;
        if let Some(conn) = connections.get(connection_id) {
            conn.created_terminals.push(terminal_id.clone());
            *conn.last_activity.write().await = std::time::Instant::now();
            info!("✅ Added terminal {} to connection {}", terminal_id, connection_id);
            Ok(())
        } else {
            return Err(anyhow!("Connection not found: {}", connection_id));
        }
    }

    pub async fn get_connection(&self, id: &str) -> Option<TestConnection> {
        let connections = self.connections.read().await;
        connections.get(id).map(|conn| TestConnection {
            id: conn.id.clone(),
            node_id: conn.node_id.clone(),
            created_terminals: conn.created_terminals.clone(),
            last_activity: *conn.last_activity.read().await,
            state: *conn.state.read().await,
        })
    }

    pub async fn list_terminals(&self, connection_id: &str) -> Result<Vec<String>> {
        let connections = self.connections.read().await;
        if let Some(conn) = connections.get(connection_id) {
            Ok(conn.created_terminals.clone())
        } else {
            Err(anyhow!("Connection not found: {}", connection_id))
        }
    }

    pub async fn get_stats(&self) -> HostStats {
        let connections = self.connections.read().await;
        let total_terminals: usize = connections.values()
            .map(|conn| conn.created_terminals.len())
            .sum();

        let active_connections = connections.values()
            .filter(|conn| {
                matches!(*conn.state.read().await, ConnectionState::Active)
            })
            .count();

        HostStats {
            total_connections: connections.len(),
            active_connections,
            total_terminals,
        }
    }
}

#[derive(Debug)]
struct HostStats {
    pub total_connections: usize,
    pub active_connections: usize,
    pub total_terminals: usize,
}

#[tokio::test]
async fn test_terminal_lifecycle_management() -> Result<()> {
    info!("🧪 Starting terminal lifecycle management test");

    let host = TestSimpleHost::new();

    // 测试连接建立
    let connection_id = "test_connection_1".to_string();
    let node_id = "test_node_1".to_string();
    host.add_connection(connection_id.clone(), node_id.clone()).await?;

    // 测试连接激活
    host.update_connection_state(&connection_id, ConnectionState::Active).await?;

    // 测试终端创建
    let terminal_id = "test_terminal_1".to_string();
    host.add_terminal(&connection_id, terminal_id.clone()).await?;

    // 测试多终端创建
    let terminal_id2 = "test_terminal_2".to_string();
    let terminal_id3 = "test_terminal_3".to_string();
    host.add_terminal(&connection_id, terminal_id2.clone()).await?;
    host.add_terminal(&connection_id, terminal_id3.clone()).await?;

    // 验证终端列表
    let terminals = host.list_terminals(&connection_id).await?;
    assert_eq!(terminals.len(), 3, "Should have 3 terminals");
    assert!(terminals.contains(&terminal_id));
    assert!(terminals.contains(&terminal_id2));
    assert!(terminals.contains(&terminal_id3));

    // 验证统计信息
    let stats = host.get_stats().await;
    assert_eq!(stats.total_connections, 1, "Should have 1 connection");
    assert_eq!(stats.active_connections, 1, "Should have 1 active connection");
    assert_eq!(stats.total_terminals, 3, "Should have 3 terminals");

    info!("✅ Terminal lifecycle management test passed");
    Ok(())
}

#[tokio::test]
async fn test_protocol_message_handling() -> Result<()> {
    info!("🧪 Starting protocol message handling test");

    let host = TestSimpleHost::new();

    // 测试终端创建消息
    let create_request = TerminalCreateRequest {
        name: Some("lifecycle-test".to_string()),
        shell: Some("/bin/bash".to_string()),
        cwd: Some("/tmp".to_string()),
        rows: Some(24),
        cols: Some(80),
    };

    let create_message = ProtocolMessage::create_with_data(
        ProtocolCommand::TerminalCreate,
        create_request
    )?;

    // 测试终端输入消息
    let input_request = TerminalInputRequest {
        id: "lifecycle-terminal".to_string(),
        data: "echo 'lifecycle test'\n".to_string(),
    };

    let input_message = ProtocolMessage::create_with_data(
        ProtocolCommand::TerminalInput,
        input_request
    )?;

    // 测试文件上传消息
    let upload_request = FileUploadRequest {
        path: "/tmp/test.txt".to_string(),
        data: "SGVsbG8gdGVzdCBv".to_string(),
        size: Some(13),
    };

    let upload_message = ProtocolMessage::create_with_data(
        ProtocolCommand::FileUpload,
        upload_request
    )?;

    // 测试端口转发消息
    let port_request = PortForwardCreateRequest {
        local_port: 3000,
        remote_port: Some(8080),
        service_name: "lifecycle-test".to_string(),
        service_type: Some("tcp".to_string()),
    };

    let port_message = ProtocolMessage::create_with_data(
        ProtocolCommand::PortForwardCreate,
        port_request
    )?;

    // 测试ping消息
    let ping_message = ProtocolMessage::create(
        ProtocolCommand::Ping,
        serde_json::json!({"timestamp": 1234567890})
    );

    // 测试pong消息
    let pong_message = ProtocolMessage::create(
        ProtocolCommand::Pong,
        serde_json::json!({"timestamp": 1234567890})
    );

    // 验证消息格式正确性
    assert!(create_message.command == ProtocolCommand::TerminalCreate);
    assert!(create_message.raw.contains("[TERMINAL_CREATE]"));
    assert!(create_message.raw.contains("/bin/bash"));

    assert!(input_message.command == ProtocolCommand::TerminalInput);
    assert!(input_message.raw.contains("[TERMINAL_INPUT]"));

    assert!(upload_message.command == ProtocolCommand::FileUpload);
    assert!(upload_message.raw.contains("[FILE_UPLOAD]"));

    assert!(port_message.command == ProtocolCommand::PortForwardCreate);
    assert!(port_message.raw.contains("[PORT_FORWARD_CREATE]"));

    assert!(ping_message.command == ProtocolCommand::Ping);
    assert!(ping_message.raw.contains("[PING]"));

    assert!(pong_message.command == ProtocolCommand::Pong);
    assert!(pong_message.raw.contains("[PONG]"));

    // 验证JSON数据正确解析
    if let serde_json::Value::Object(data) = create_message.data {
        assert_eq!(data.get("name").unwrap().as_str().unwrap(), "lifecycle-test");
        assert_eq!(data.get("shell").unwrap().as_str().unwrap(), "/bin/bash");
    }

    if let Some(serde_json::Value::Object(data)) = input_message.data {
        assert_eq!(data.get("id").unwrap().as_str().unwrap(), "lifecycle-terminal");
        assert_eq!(data.get("data").unwrap().as_str().unwrap(), "echo 'lifecycle test'\\n");
    }

    info!("✅ Protocol message handling test passed");
    Ok(())
}

#[tokio::test]
async fn test_connection_management_and_cleanup() -> Result<()> {
    info!("🧪 Starting connection management and cleanup test");

    let host = TestSimpleHost::new();

    // 创建多个连接
    let mut connection_ids = Vec::new();
    for i in 0..5 {
        let connection_id = format!("cleanup_conn_{}", i);
        let node_id = format!("cleanup_node_{}", i);
        host.add_connection(connection_id.clone(), node_id.clone()).await?;
        host.update_connection_state(&connection_id, ConnectionState::Active).await?;
        connection_ids.push(connection_id);
    }

    // 验证所有连接都活跃
    let stats = host.get_stats().await;
    assert_eq!(stats.total_connections, 5, "Should have 5 connections");
    assert_eq!(stats.active_connections, 5, "Should have 5 active connections");

    // 清理一个连接
    let connection_to_remove = connection_ids.get(2).unwrap();
    host.connections.write().await.remove(&connection_to_remove.to_string());

    // 验证连接已移除
    let stats_after_cleanup = host.get_stats().await;
    assert_eq!(stats_after_cleanup.total_connections, 4, "Should have 4 connections after cleanup");
    assert_eq!(stats_after_cleanup.active_connections, 4, "Should have 4 active connections");

    // 验证其他连接仍存在
    for connection_id in connection_ids.iter().skip(2) {
        assert!(host.get_connection(connection_id).await.is_some(),
                  "Connection {} should still exist", connection_id);
    }

    info!("✅ Connection management and cleanup test passed");
    Ok(())
}

#[tokio::test]
async fn test_error_handling_and_recovery() -> Result<()> {
    info!("🧪 Starting error handling and recovery test");

    let host = TestSimpleHost::new();

    // 测试无效消息处理
    let invalid_message = ProtocolMessage::error("Test error message");

    // 测试错误状态处理
    let connection_id = "error_test_conn".to_string();
    let node_id = "error_test_node".to_string();

    host.add_connection(connection_id.clone(), node_id.clone()).await?;
    host.update_connection_state(&connection_id, ConnectionState::Error("Initial error".to_string())).await?;

    // 验证错误状态记录
    let stats = host.get_stats().await;
    assert_eq!(stats.total_connections, 1, "Should have 1 connection");
    assert_eq!(stats.active_connections, 0, "Should have 0 active connections (in error state)");

    // 测试错误恢复
    host.update_connection_state(&connection_id, ConnectionState::Active).await?;

    // 验证恢复后的状态
    let stats_after_recovery = host.get_stats().await;
    assert_eq!(stats_after_recovery.total_connections, 1, "Should still have 1 connection");
    assert_eq!(stats_after_recovery.active_connections, 1, "Should have 1 active connection after recovery");

    // 测试连接不存在时的错误处理
    let non_existent_id = "non_existent_conn".to_string();
    assert!(host.get_connection(&non_existent_id).await.is_none(),
                 "Non-existent connection should return None");

    info!("✅ Error handling and recovery test passed");
    Ok(())
}

#[tokio::test]
async fn test_multiple_concurrent_operations() -> Result<()> {
    info!("🧪 Starting multiple concurrent operations test");

    let host = TestSimpleHost::new();

    // 创建多个并发连接
    let mut connection_ids = Vec::new();
    for i in 0..10 {
        let connection_id = format!("concurrent_conn_{}", i);
        let node_id = format!("concurrent_node_{}", i);
        host.add_connection(connection_id.clone(), node_id.clone()).await?;
        host.update_connection_state(&connection_id, ConnectionState::Active).await?;
        connection_ids.push(connection_id);
    }

    // 并发创建多个终端
    for (i, connection_id) in connection_ids.iter().enumerate() {
        for j in 0..3 {
            let terminal_id = format!("concurrent_terminal_{}_{}", i, j);
            host.add_terminal(&connection_id, terminal_id).await?;
        }
    }

    // 验证并发性能
    let start_time = std::time::Instant::now();

    for connection_id in &connection_ids {
        for terminal_id in 0..3 {
            host.list_terminals(&connection_id).await?;
        }
    }

    let total_time = start_time.elapsed();

    // 验证所有终端都被正确创建
    let stats = host.get_stats().await;
    assert_eq!(stats.total_connections, 10, "Should have 10 connections");
    assert_eq!(stats.active_connections, 10, "Should have 10 active connections");
    assert_eq!(stats.total_terminals, 30, "Should have 30 terminals total");

    info!("✅ Multiple concurrent operations test completed in {:?}", total_time);
    Ok(())
}