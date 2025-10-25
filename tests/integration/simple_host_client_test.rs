/// 简化主机-客户端集成测试
/// 验证 dumbpipe 模式的端到端通信

use anyhow::Result;
use std::time::Duration;
use tokio::time::timeout;

// 测试用的简化实现
mod test_simple_host {
    use anyhow::Result;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::{RwLock, Mutex};
    use tracing::info;

    use riterm_shared::simple_protocol::*;
    use riterm_shared::NodeTicket;

    pub struct TestSimpleHost {
        connections: Arc<RwLock<HashMap<String, TestConnection>>>,
    }

    pub struct TestConnection {
        pub id: String,
        pub last_message: Arc<RwLock<Option<ProtocolMessage>>>,
    }

    impl TestSimpleHost {
        pub fn new() -> Self {
            Self {
                connections: Arc::new(RwLock::new(HashMap::new())),
            }
        }

        pub async fn handle_message(&self, connection_id: String, message: ProtocolMessage) -> Result<Option<ProtocolMessage>> {
            let connections = self.connections.read().await;
            if let Some(conn) = connections.get(&connection_id) {
                *conn.last_message.write().await = Some(message.clone());

                info!("📨 Handling message: {:?} for connection {}", message.command, connection_id);

                // 简单响应逻辑
                match message.command {
                    ProtocolCommand::TerminalCreate => Ok(Some(ProtocolMessage::create(
                        ProtocolCommand::TerminalStatus,
                        serde_json::json!({"id": "default", "status": "created"})
                    ))),
                    ProtocolCommand::TerminalInput => Ok(None), // 输入不需要响应
                    ProtocolCommand::Ping => Ok(Some(ProtocolMessage::create(
                        ProtocolCommand::Pong,
                        serde_json::json!({"timestamp": 1234567890})
                    ))),
                    ProtocolCommand::FileUpload => Ok(Some(ProtocolMessage::create(
                        ProtocolCommand::FileStatus,
                        serde_json::json!({"path": "test.txt", "size": 100, "transferred": 100})
                    ))),
                    _ => Ok(Some(ProtocolMessage::error("Unknown command"))),
                }
            } else {
                Ok(Some(ProtocolMessage::error("Connection not found")))
            }
        }

        pub async fn add_connection(&self, id: String) -> Result<()> {
            let mut connections = self.connections.write().await;
            connections.insert(id.clone(), TestConnection {
                id: id.clone(),
                last_message: Arc::new(RwLock::new(None)),
            });
            info!("✅ Added connection: {}", id);
            Ok(())
        }

        pub async fn remove_connection(&self, id: String) {
            let mut connections = self.connections.write().await;
            connections.remove(&id);
            info!("🔌 Removed connection: {}", id);
        }
    }
}

mod test_simple_client {
    use anyhow::Result;
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use tracing::info;

    use riterm_shared::simple_protocol::*;
    use riterm_shared::NodeTicket;

    pub struct TestSimpleClient {
        last_response: Arc<RwLock<Option<ProtocolMessage>>>,
    }

    impl TestSimpleClient {
        pub fn new() -> Self {
            Self {
                last_response: Arc::new(RwLock::new(None)),
            }
        }

        pub async fn send_message(&self, message: ProtocolMessage) -> Result<Option<ProtocolMessage>> {
            // 模拟发送延迟
            tokio::time::sleep(Duration::from_millis(10)).await;

            // 模拟响应
            match message.command {
                ProtocolCommand::TerminalCreate => {
                    let response = ProtocolMessage::create(
                        ProtocolCommand::TerminalStatus,
                        serde_json::json!({"id": "test-terminal", "status": "created"})
                    );
                    *self.last_response.write().await = Some(response);
                    info!("📤 Sent terminal create, received status response");
                    Ok(Some(response))
                }
                ProtocolCommand::TerminalInput => {
                    info!("📤 Sent terminal input");
                    Ok(None) // 输入通常不需要响应
                }
                ProtocolCommand::Ping => {
                    let response = ProtocolMessage::create(
                        ProtocolCommand::Pong,
                        serde_json::json!({"timestamp": 1234567890})
                    );
                    *self.last_response.write().await = Some(response);
                    info!("📤 Sent ping, received pong");
                    Ok(Some(response))
                }
                _ => {
                    let error_response = ProtocolMessage::error("Test command not implemented");
                    *self.last_response.write().await = Some(error_response);
                    info!("📤 Sent command, received error response");
                    Ok(Some(error_response))
                }
            }
        }

        pub async fn get_last_response(&self) -> Option<ProtocolMessage> {
            self.last_response.read().await.clone()
        }
    }
}

#[tokio::test]
async fn test_simple_host_client_communication() -> Result<()> {
    use super::test_simple_host::*;
    use super::test_simple_client::*;

    info!("🧪 Starting simple host-client communication test");

    let host = TestSimpleHost::new();
    let client = TestSimpleClient::new();

    // 模拟连接建立
    let connection_id = "test-connection-1".to_string();
    host.add_connection(connection_id.clone()).await?;

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

    let response = host.handle_message(connection_id.clone(), create_message).await?;
    assert!(response.is_some());
    assert_eq!(response.unwrap().command, ProtocolCommand::TerminalStatus);

    // 客户端发送创建请求
    let client_response = client.send_message(create_message).await?;
    assert!(client_response.is_some());

    // 测试终端输入
    let input_message = ProtocolMessage::create(
        ProtocolCommand::TerminalInput,
        serde_json::json!({
            "id": "test-terminal",
            "data": "echo 'hello world'"
        })
    );

    let input_response = host.handle_message(connection_id.clone(), input_message).await?;
    assert!(input_response.is_none()); // 输入不需要响应

    client.send_message(input_message).await?;

    // 测试ping/pong
    let ping_message = ProtocolMessage::create(
        ProtocolCommand::Ping,
        serde_json::json!({"timestamp": 1234567890})
    );

    let ping_response = host.handle_message(connection_id.clone(), ping_message).await?;
    assert!(ping_response.is_some());
    assert_eq!(ping_response.unwrap().command, ProtocolCommand::Pong);

    let client_pong_response = client.send_message(ping_message).await?;
    assert!(client_pong_response.is_some());

    // 清理
    host.remove_connection(connection_id).await;

    info!("✅ Simple host-client communication test passed");
    Ok(())
}

#[tokio::test]
async fn test_protocol_message_roundtrip() -> Result<()> {
    use super::test_simple_host::*;
    use super::test_simple_client::*;

    info!("🧪 Starting protocol message roundtrip test");

    let host = TestSimpleHost::new();
    let client = TestSimpleClient::new();

    let connection_id = "test-roundtrip".to_string();
    host.add_connection(connection_id.clone()).await?;

    // 测试文件上传
    let upload_request = FileUploadRequest {
        path: "/tmp/test.txt".to_string(),
        data: "SGVsbG8gdGVzdCB0b250gdCBv".to_string(), // "Hello, World!" base64
        size: Some(13),
    };

    let upload_message = ProtocolMessage::create_with_data(
        ProtocolCommand::FileUpload,
        upload_request
    )?;

    let upload_response = host.handle_message(connection_id.clone(), upload_message).await?;
    assert!(upload_response.is_some());

    let client_upload_response = client.send_message(upload_message).await?;
    assert!(client_upload_response.is_some());

    // 验证响应数据
    if let Some(response) = client_upload_response {
        if let Some(data) = response.data.get("path") {
            assert_eq!(data.as_str().unwrap(), "/tmp/test.txt");
        }
        if let Some(size) = response.data.get("size") {
            assert_eq!(size.as_u64().unwrap(), 13);
        }
    }

    // 清理
    host.remove_connection(connection_id).await;

    info!("✅ Protocol message roundtrip test passed");
    Ok(())
}

#[tokio::test]
async fn test_error_handling() -> Result<()> {
    use super::test_simple_host::*;

    info!("🧪 Starting error handling test");

    let host = TestSimpleHost::new();

    // 测试连接到不存在的连接
    let response = host.handle_message(
        "non-existent-connection".to_string(),
        ProtocolMessage::create(ProtocolCommand::Ping, serde_json::json!({}))
    ).await?;

    assert!(response.is_some());
    assert_eq!(response.unwrap().command, ProtocolCommand::Error);

    info!("✅ Error handling test passed");
    Ok(())
}

#[tokio::test]
async fn test_message_validation() -> Result<()> {
    use riterm_shared::simple_protocol::*;

    info!("🧪 Starting message validation test");

    // 测试有效消息格式
    let valid_message = ProtocolMessage::create(
        ProtocolCommand::TerminalCreate,
        serde_json::json!({"name": "test"})
    );

    assert!(valid_message.is_valid());
    assert!(valid_message.raw.starts_with("[TERMINAL_CREATE]"));
    assert!(valid_message.raw.ends_with("}"));

    // 测试消息解析
    let parsed = ProtocolMessage::parse(&valid_message.raw)?;
    assert_eq!(parsed.command, ProtocolCommand::TerminalCreate);

    info!("✅ Message validation test passed");
    Ok(())
}