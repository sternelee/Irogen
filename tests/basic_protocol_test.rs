use anyhow::Result;
use riterm_shared::simple_protocol::*;

#[tokio::test]
async fn test_protocol_message_creation() -> Result<()> {
    println!("Testing protocol message creation");

    // Test TerminalCreate message
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

    assert!(create_message.raw.contains("[TERMINAL_CREATE]"));
    assert!(create_message.raw.contains("/bin/bash"));
    assert_eq!(create_message.command, ProtocolCommand::TerminalCreate);

    println!("✅ TerminalCreate message test passed");

    // Test TerminalInput message
    let input_request = TerminalInputRequest {
        id: "test-terminal".to_string(),
        data: "echo 'hello world'\n".to_string(),
    };

    let input_message = ProtocolMessage::create_with_data(
        ProtocolCommand::TerminalInput,
        input_request
    )?;

    assert!(input_message.raw.contains("[TERMINAL_INPUT]"));
    assert!(input_message.raw.contains("echo 'hello world'"));
    assert_eq!(input_message.command, ProtocolCommand::TerminalInput);

    println!("✅ TerminalInput message test passed");

    // Test Ping message
    let ping_message = ProtocolMessage::create(
        ProtocolCommand::Ping,
        serde_json::json!({"timestamp": 1234567890})
    );

    assert!(ping_message.raw.contains("[PING]"));
    assert_eq!(ping_message.command, ProtocolCommand::Ping);

    println!("✅ Ping message test passed");

    Ok(())
}

#[tokio::test]
async fn test_protocol_encoding_decoding() -> Result<()> {
    println!("Testing protocol encoding and decoding");

    let original_message = ProtocolMessage::create(
        ProtocolCommand::FileUpload,
        serde_json::json!({
            "path": "/tmp/test.txt",
            "data": "SGVsbG8gd29ybGQ=",
            "size": 13
        })
    );

    // Encode the message
    let encoded = ProtocolCodec::encode(&original_message)?;

    // Decode the message
    let decoded_message = ProtocolCodec::decode(&encoded)?;

    assert!(decoded_message.is_some(), "Failed to decode encoded message");

    let decoded = decoded_message.unwrap();
    assert_eq!(decoded.command, original_message.command);

    println!("✅ Encoding/decoding test passed");

    Ok(())
}

#[tokio::test]
async fn test_simple_host_functionality() -> Result<()> {
    println!("Testing simple protocol functionality");

    // Test creating a simple terminal create request and parsing
    let terminal_create_data = r#"[TERMINAL_CREATE]{"name":"test","shell":"/bin/bash","cwd":"/tmp","rows":24,"cols":80}"#;

    if let Some(message) = ProtocolCodec::decode(terminal_create_data.as_bytes())? {
        assert_eq!(message.command, ProtocolCommand::TerminalCreate);

        if let serde_json::Value::Object(data) = message.data {
            assert_eq!(data.get("name").unwrap().as_str().unwrap(), "test");
            assert_eq!(data.get("shell").unwrap().as_str().unwrap(), "/bin/bash");
        } else {
            panic!("Expected JSON data");
        }

        println!("✅ Simple protocol parsing test passed");
    } else {
        panic!("Failed to parse terminal create message");
    }

    Ok(())
}