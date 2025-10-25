/// 测试简化的协议功能

use riterm_shared::simple_protocol::*;
use anyhow::Result;

#[tokio::test]
async fn test_simple_protocol_creation() {
    // 测试终端创建请求
    let request = TerminalCreateRequest {
        name: Some("test-terminal".to_string()),
        shell: Some("/bin/bash".to_string()),
        cwd: Some("/home".to_string()),
        rows: Some(24),
        cols: Some(80),
    };

    let message = ProtocolMessage::create_with_data(ProtocolCommand::TerminalCreate, request).unwrap();

    assert_eq!(message.command, ProtocolCommand::TerminalCreate);
    assert!(message.raw.contains("[TERMINAL_CREATE]"));
    assert!(message.raw.contains("/bin/bash"));
}

#[tokio::test]
async fn test_protocol_message_parsing() {
    // 测试消息解析
    let raw_message = "[TERMINAL_INPUT]{\"id\":\"test\",\"data\":\"hello\"}";

    match ProtocolMessage::parse(raw_message) {
        Ok(message) => {
            assert_eq!(message.command, ProtocolCommand::TerminalInput);

            match message.data {
                serde_json::Value::Object(obj) => {
                    assert_eq!(obj.get("id").unwrap().as_str().unwrap(), "test");
                    assert_eq!(obj.get("data").unwrap().as_str().unwrap(), "hello");
                }
                _ => panic!("Expected JSON object"),
            }
        }
        Err(e) => panic!("Failed to parse valid message: {}", e),
    }
}

#[tokio::test]
async fn test_protocol_command_serialization() {
    // 测试命令序列化
    let command = ProtocolCommand::FileUpload;
    assert_eq!(command.as_str(), "FILE_UPLOAD");

    // 测试反序列化
    let parsed_cmd = ProtocolCommand::from_str("FILE_UPLOAD").unwrap();
    assert_eq!(parsed_cmd, command);
}

#[test]
fn test_protocol_message_validation() {
    // 测试消息格式验证
    let valid_message = ProtocolMessage::create(
        ProtocolCommand::Ping,
        serde_json::json!({"timestamp": 123456})
    );

    assert!(valid_message.is_valid());

    let invalid_message = ProtocolMessage {
        command: ProtocolCommand::Ping,
        data: serde_json::json!({"timestamp": 123456}),
        raw: "INVALID_FORMAT".to_string(),
    };

    assert!(!invalid_message.is_valid());
}

#[test]
fn test_error_message_creation() {
    // 测试错误消息创建
    let error_message = ProtocolMessage::error("Test error");

    assert_eq!(error_message.command, ProtocolCommand::Error);

    match error_message.data {
        serde_json::Value::Object(obj) => {
            assert_eq!(obj.get("message").unwrap().as_str().unwrap(), "Test error");
        }
        _ => panic!("Expected JSON object with message field"),
    }
}

#[test]
fn test_file_upload_request() {
    // 测试文件上传请求结构
    let request = FileUploadRequest {
        path: "/tmp/test.txt".to_string(),
        data: "SGVsbG8gdGVzdCB0b250gdCBv".to_string(), // "Hello, World!" base64
        size: Some(13),
    };

    assert_eq!(request.path, "/tmp/test.txt");
    assert_eq!(request.size, Some(13));
}

#[test]
fn test_port_forward_request() {
    // 测试端口转发请求
    let request = PortForwardCreateRequest {
        local_port: 3000,
        remote_port: Some(8080),
        service_name: "web-service".to_string(),
        service_type: Some("tcp".to_string()),
    };

    assert_eq!(request.local_port, 3000);
    assert_eq!(request.remote_port, Some(8080));
    assert_eq!(request.service_name, "web-service");
    assert_eq!(request.service_type, Some("tcp"));
}