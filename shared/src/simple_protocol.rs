/// 简化的应用层协议 - 基于dumbpipe的指令-响应模式
/// 移除复杂的结构化消息系统，回归简单的文本协议

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// 简单的协议指令格式
/// 格式: [COMMAND_TYPE]JSON_DATA
///
/// 例如:
/// [TERMINAL_CREATE]{"shell":"/bin/bash","cwd":"/home","name":"term1"}
/// [TERMINAL_INPUT]{"id":"term_123","data":"ls\n"}
/// [TERMINAL_RESIZE]{"id":"term_123","rows":24,"cols":80}
/// [FILE_TRANSFER]{"action":"upload","path":"./test.txt","data":"base64..."}
/// [TCP_FORWARD]{"local_port":3000,"remote_port":8080}

#[derive(Debug, Clone, PartialEq)]
pub enum ProtocolCommand {
    // === 终端管理 ===
    TerminalCreate,
    TerminalList,
    TerminalInput,
    TerminalOutput,
    TerminalResize,
    TerminalStatus,
    TerminalStop,

    // === 文件传输 ===
    FileUpload,
    FileDownload,
    FileData,
    FileStatus,

    // === 端口转发 ===
    PortForwardCreate,
    PortForwardData,
    PortForwardStop,

    // === 系统控制 ===
    Ping,
    Pong,
    Error,

    // === 连接管理 ===
    Connect,
    Disconnect,
    Heartbeat,
}

impl ProtocolCommand {
    pub fn to_bytes(&self) -> Vec<u8> {
        format!("[{}]", self.as_str()).into_bytes()
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ProtocolCommand::TerminalCreate => "TERMINAL_CREATE",
            ProtocolCommand::TerminalList => "TERMINAL_LIST",
            ProtocolCommand::TerminalInput => "TERMINAL_INPUT",
            ProtocolCommand::TerminalOutput => "TERMINAL_OUTPUT",
            ProtocolCommand::TerminalResize => "TERMINAL_RESIZE",
            ProtocolCommand::TerminalStatus => "TERMINAL_STATUS",
            ProtocolCommand::TerminalStop => "TERMINAL_STOP",

            ProtocolCommand::FileUpload => "FILE_UPLOAD",
            ProtocolCommand::FileDownload => "FILE_DOWNLOAD",
            ProtocolCommand::FileData => "FILE_DATA",
            ProtocolCommand::FileStatus => "FILE_STATUS",

            ProtocolCommand::PortForwardCreate => "PORT_FORWARD_CREATE",
            ProtocolCommand::PortForwardData => "PORT_FORWARD_DATA",
            ProtocolCommand::PortForwardStop => "PORT_FORWARD_STOP",

            ProtocolCommand::Ping => "PING",
            ProtocolCommand::Pong => "PONG",
            ProtocolCommand::Error => "ERROR",

            ProtocolCommand::Connect => "CONNECT",
            ProtocolCommand::Disconnect => "DISCONNECT",
            ProtocolCommand::Heartbeat => "HEARTBEAT",
        }
    }
}

impl FromStr for ProtocolCommand {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "TERMINAL_CREATE" => Ok(ProtocolCommand::TerminalCreate),
            "TERMINAL_LIST" => Ok(ProtocolCommand::TerminalList),
            "TERMINAL_INPUT" => Ok(ProtocolCommand::TerminalInput),
            "TERMINAL_OUTPUT" => Ok(ProtocolCommand::TerminalOutput),
            "TERMINAL_RESIZE" => Ok(ProtocolCommand::TerminalResize),
            "TERMINAL_STATUS" => Ok(ProtocolCommand::TerminalStatus),
            "TERMINAL_STOP" => Ok(ProtocolCommand::TerminalStop),

            "FILE_UPLOAD" => Ok(ProtocolCommand::FileUpload),
            "FILE_DOWNLOAD" => Ok(ProtocolCommand::FileDownload),
            "FILE_DATA" => Ok(ProtocolCommand::FileData),
            "FILE_STATUS" => Ok(ProtocolCommand::FileStatus),

            "PORT_FORWARD_CREATE" => Ok(ProtocolCommand::PortForwardCreate),
            "PORT_FORWARD_DATA" => Ok(ProtocolCommand::PortForwardData),
            "PORT_FORWARD_STOP" => Ok(ProtocolCommand::PortForwardStop),

            "PING" => Ok(ProtocolCommand::Ping),
            "PONG" => Ok(ProtocolCommand::Pong),
            "ERROR" => Ok(ProtocolCommand::Error),

            "CONNECT" => Ok(ProtocolCommand::Connect),
            "DISCONNECT" => Ok(ProtocolCommand::Disconnect),
            "HEARTBEAT" => Ok(ProtocolCommand::Heartbeat),

            _ => Err(anyhow!("Unknown protocol command: {}", s)),
        }
    }
}

/// 协议消息结构
#[derive(Debug, Clone)]
pub struct ProtocolMessage {
    pub command: ProtocolCommand,
    pub data: serde_json::Value,
    pub raw: String,
}

impl ProtocolMessage {
    /// 解析原始协议消息
    /// 格式: [COMMAND_TYPE]JSON_DATA
    pub fn parse(raw: &str) -> Result<Self> {
        if !raw.starts_with('[') || !raw.contains(']') {
            return Err(anyhow!("Invalid protocol message format: {}", raw));
        }

        let end_bracket = raw.find(']').ok_or_else(|| anyhow!("Missing closing bracket"))?;
        let command_str = &raw[1..end_bracket]; // 提取 COMMAND_TYPE
        let data_str = &raw[end_bracket + 1..]; // 提取 JSON_DATA

        let command = ProtocolCommand::from_str(command_str)?;

        // 解析JSON数据（如果存在）
        let data = if data_str.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_str(data_str)
                .map_err(|e| anyhow!("Failed to parse JSON data: {}", e))?
        };

        Ok(ProtocolMessage {
            command,
            data,
            raw: raw.to_string(),
        })
    }

    /// 创建协议消息
    pub fn create(command: ProtocolCommand, data: serde_json::Value) -> Self {
        let data_json = if data.is_null() {
            String::new()
        } else {
            serde_json::to_string(&data).unwrap_or_default()
        };

        let raw = format!("[{}]{}", command.as_str(), data_json);

        ProtocolMessage {
            command,
            data,
            raw,
        }
    }

    /// 创建带有结构化数据的消息
    pub fn create_with_data<T: Serialize>(command: ProtocolCommand, data: T) -> Result<Self> {
        let json_data = serde_json::to_value(data)
            .map_err(|e| anyhow!("Failed to serialize data: {}", e))?;
        Ok(Self::create(command, json_data))
    }

    /// 创建简单的错误响应
    pub fn error(message: &str) -> Self {
        Self::create(ProtocolCommand::Error, serde_json::json!({
            "message": message
        }))
    }

    /// 转换为字节序列
    pub fn to_bytes(&self) -> Vec<u8> {
        self.raw.as_bytes().to_vec()
    }

    /// 验证消息格式
    pub fn is_valid(&self) -> bool {
        self.raw.starts_with('[') && self.raw.contains(']')
    }
}

// === 特定指令的数据结构 ===

/// 终端创建请求
#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalCreateRequest {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
}

/// 终端输入请求
#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalInputRequest {
    pub id: String,
    pub data: String,
}

/// 终端调整大小请求
#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalResizeRequest {
    pub id: String,
    pub rows: u16,
    pub cols: u16,
}

/// 终端输出响应
#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalOutputResponse {
    pub id: String,
    pub data: String,
    pub timestamp: u64,
}

/// 终端状态响应
#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalStatusResponse {
    pub id: String,
    pub status: String, // "running", "stopped", "error"
    pub last_activity: Option<u64>,
}

/// 文件上传请求
#[derive(Debug, Serialize, Deserialize)]
pub struct FileUploadRequest {
    pub path: String,
    pub data: String, // base64 encoded
    pub size: Option<u64>,
}

/// 文件下载请求
#[derive(Debug, Serialize, Deserialize)]
pub struct FileDownloadRequest {
    pub path: String,
}

/// 文件状态响应
#[derive(Debug, Serialize, Deserialize)]
pub struct FileStatusResponse {
    pub path: String,
    pub action: String, // "upload", "download", "progress"
    pub progress: Option<u8>,
    pub size: Option<u64>,
    pub transferred: Option<u64>,
    pub error: Option<String>,
}

/// 端口转发创建请求
#[derive(Debug, Serialize, Deserialize)]
pub struct PortForwardCreateRequest {
    pub local_port: u16,
    pub remote_port: Option<u16>,
    pub service_name: String,
    pub service_type: Option<String>, // "tcp", "web"
}

/// 端口转发数据传输
#[derive(Debug, Serialize, Deserialize)]
pub struct PortForwardData {
    pub service_id: String,
    pub data: String, // base64 encoded
    pub direction: String, // "to_remote", "from_remote"
}


/// 简单的协议处理器trait
pub trait SimpleProtocolHandler: Send + Sync {
    fn handle_message(&mut self, message: ProtocolMessage) -> Result<Option<ProtocolMessage>>;
}

/// 协议编解码器
pub struct ProtocolCodec;

impl ProtocolCodec {
    /// 解码字节流为协议消息
    pub fn decode(buffer: &[u8]) -> Result<Option<ProtocolMessage>> {
        let message_str = std::str::from_utf8(buffer)
            .map_err(|e| anyhow!("Invalid UTF-8: {}", e))?;

        if message_str.is_empty() {
            return Ok(None);
        }

        // 尝试解析完整消息
        match ProtocolMessage::parse(message_str) {
            Ok(msg) => Ok(Some(msg)),
            Err(_) => Ok(None), // 等待更多数据
        }
    }

    /// 编码协议消息为字节流
    pub fn encode(message: &ProtocolMessage) -> Result<Vec<u8>> {
        Ok(message.to_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protocol_message_parsing() {
        let raw = "[TERMINAL_CREATE]{\"shell\":\"/bin/bash\"}";
        let message = ProtocolMessage::parse(raw).unwrap();

        assert_eq!(message.command, ProtocolCommand::TerminalCreate);
        assert_eq!(message.data.get("shell").unwrap().as_str().unwrap(), "/bin/bash");
    }

    #[test]
    fn test_protocol_message_creation() {
        let data = TerminalCreateRequest {
            shell: Some("/bin/zsh".to_string()),
            cwd: None,
            name: Some("test".to_string()),
            rows: Some(24),
            cols: Some(80),
        };

        let message = ProtocolMessage::create_with_data(ProtocolCommand::TerminalCreate, data).unwrap();
        assert!(message.raw.starts_with("[TERMINAL_CREATE]"));
        assert!(message.raw.contains("/bin/zsh"));
    }

    #[test]
    fn test_command_conversion() {
        let cmd = ProtocolCommand::TerminalInput;
        assert_eq!(cmd.as_str(), "TERMINAL_INPUT");
        assert_eq!(ProtocolCommand::from_str("TERMINAL_INPUT").unwrap(), cmd);
    }
}