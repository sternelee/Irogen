//! 统一的消息事件协议
//!
//! 此模块定义了RiTerm中所有组件间的统一消息协议，
//! 支持App-CLI、终端管理、TCP转发等各种消息类型。

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use uuid::Uuid;

// Type aliases for complex types to improve readability
type MessageHandlerMap = HashMap<MessageType, Vec<Arc<dyn MessageHandler>>>;
type MessageHandlerStore = Arc<RwLock<MessageHandlerMap>>;

/// 消息协议版本
pub const MESSAGE_PROTOCOL_VERSION: u8 = 1;

/// 消息类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum MessageType {
    /// 心跳消息
    Heartbeat = 0x01,
    /// 终端管理消息
    TerminalManagement = 0x02,
    /// 终端I/O消息
    TerminalIO = 0x03,
    /// TCP转发管理消息
    TcpForwarding = 0x04,
    /// TCP数据转发消息
    TcpData = 0x05,
    /// 系统控制消息
    SystemControl = 0x06,
    /// 系统信息消息
    SystemInfo = 0x09,
    /// 响应消息
    Response = 0x07,
    /// 错误消息
    Error = 0x08,
}

impl TryFrom<u8> for MessageType {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            0x01 => Ok(MessageType::Heartbeat),
            0x02 => Ok(MessageType::TerminalManagement),
            0x03 => Ok(MessageType::TerminalIO),
            0x04 => Ok(MessageType::TcpForwarding),
            0x05 => Ok(MessageType::TcpData),
            0x06 => Ok(MessageType::SystemControl),
            0x09 => Ok(MessageType::SystemInfo),
            0x07 => Ok(MessageType::Response),
            0x08 => Ok(MessageType::Error),
            _ => Err(anyhow::anyhow!("Invalid message type: {}", value)),
        }
    }
}

/// 终端管理动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalAction {
    /// 创建终端
    Create {
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: (u16, u16),
    },
    /// 列出终端
    List,
    /// 停止终端
    Stop { terminal_id: String },
    /// 调整终端大小
    Resize {
        terminal_id: String,
        rows: u16,
        cols: u16,
    },
    /// 获取终端信息
    Info { terminal_id: String },
    /// 发送输入到终端
    Input { terminal_id: String, data: Vec<u8> },
}

/// TCP转发管理动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TcpForwardingAction {
    /// 创建TCP转发会话
    CreateSession {
        local_addr: String,
        remote_host: Option<String>,
        remote_port: Option<u16>,
        forwarding_type: TcpForwardingType,
    },
    /// 列出TCP转发会话
    ListSessions,
    /// 停止TCP转发会话
    StopSession { session_id: String },
    /// 获取会话信息
    GetSessionInfo { session_id: String },
    /// 连接到远程TCP转发
    Connect { ticket: String, local_addr: String },
}

/// TCP转发类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TcpForwardingType {
    /// 监听本地TCP并转发到远程
    ListenToRemote,
    /// 从本地TCP连接并转发到远程
    ConnectToRemote,
}

/// 系统控制动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SystemAction {
    /// 获取系统状态
    GetStatus,
    /// 重启系统
    Restart,
    /// 关闭系统
    Shutdown,
    /// 获取日志
    GetLogs { limit: Option<u32> },
}

/// 消息优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessagePriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// 统一消息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// 消息ID
    pub id: String,
    /// 消息类型
    pub message_type: MessageType,
    /// 消息优先级
    pub priority: MessagePriority,
    /// 发送者ID
    pub sender_id: String,
    /// 接收者ID（可选，广播时为空）
    pub receiver_id: Option<String>,
    /// 会话ID
    pub session_id: Option<String>,
    /// 时间戳
    pub timestamp: u64,
    /// 消息载荷
    pub payload: MessagePayload,
    /// 是否需要响应
    pub requires_response: bool,
    /// 关联的消息ID（用于响应消息）
    pub correlation_id: Option<String>,
}

impl Message {
    /// 创建新消息
    pub fn new(message_type: MessageType, sender_id: String, payload: MessagePayload) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            message_type,
            priority: MessagePriority::Normal,
            sender_id,
            receiver_id: None,
            session_id: None,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            payload,
            requires_response: false,
            correlation_id: None,
        }
    }

    /// 设置接收者
    pub fn with_receiver(mut self, receiver_id: String) -> Self {
        self.receiver_id = Some(receiver_id);
        self
    }

    /// 设置会话ID
    pub fn with_session(mut self, session_id: String) -> Self {
        self.session_id = Some(session_id);
        self
    }

    /// 设置优先级
    pub fn with_priority(mut self, priority: MessagePriority) -> Self {
        self.priority = priority;
        self
    }

    /// 设置需要响应
    pub fn requires_response(mut self) -> Self {
        self.requires_response = true;
        self
    }

    /// 设置关联消息ID
    pub fn with_correlation_id(mut self, correlation_id: String) -> Self {
        self.correlation_id = Some(correlation_id);
        self
    }

    /// 创建响应消息
    pub fn create_response(&self, payload: MessagePayload) -> Self {
        let mut response = Self::new(MessageType::Response, self.sender_id.clone(), payload);
        response.receiver_id = Some(self.sender_id.clone());
        response.session_id = self.session_id.clone();
        response.correlation_id = Some(self.id.clone());
        response
    }

    /// 创建错误响应
    pub fn create_error_response(&self, error: String) -> Self {
        let payload = MessagePayload::Error(ErrorMessage {
            code: -1,
            message: error,
            details: None,
        });
        self.create_response(payload)
    }

    /// 序列化消息
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self).map_err(Into::into)
    }

    /// 反序列化消息
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        bincode::deserialize(bytes).map_err(Into::into)
    }
}

/// 消息载荷枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessagePayload {
    /// 心跳载荷
    Heartbeat(HeartbeatMessage),
    /// 终端管理载荷
    TerminalManagement(TerminalManagementMessage),
    /// 终端I/O载荷
    TerminalIO(TerminalIOMessage),
    /// TCP转发载荷
    TcpForwarding(TcpForwardingMessage),
    /// TCP数据载荷
    TcpData(TcpDataMessage),
    /// 系统控制载荷
    SystemControl(SystemControlMessage),
    /// 系统信息载荷
    SystemInfo(SystemInfoMessage),
    /// 响应载荷
    Response(ResponseMessage),
    /// 错误载荷
    Error(ErrorMessage),
}

/// 心跳消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatMessage {
    pub sequence: u64,
    pub status: String,
}

/// 终端管理消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalManagementMessage {
    pub action: TerminalAction,
    pub request_id: Option<String>,
}

/// 终端I/O消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalIOMessage {
    pub terminal_id: String,
    pub data_type: IODataType,
    pub data: Vec<u8>,
}

/// I/O数据类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IODataType {
    Input,
    Output,
    Error,
    Resize { rows: u16, cols: u16 },
    Signal { signal: u32 },
}

/// TCP转发消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpForwardingMessage {
    pub action: TcpForwardingAction,
    pub request_id: Option<String>,
}

/// TCP数据消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpDataMessage {
    pub session_id: String,
    pub connection_id: String,
    pub data_type: TcpDataType,
    pub data: Vec<u8>,
}

/// TCP数据类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TcpDataType {
    Data,
    ConnectionOpen,
    ConnectionClose,
    Error,
}

/// 系统控制消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemControlMessage {
    pub action: SystemAction,
    pub request_id: Option<String>,
}

/// 响应消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseMessage {
    pub request_id: String,
    pub success: bool,
    /// 响应数据，存储为 JSON 字符串（bincode 兼容）
    pub data: Option<String>,
    pub message: Option<String>,
}

/// 错误消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorMessage {
    pub code: i32,
    pub message: String,
    pub details: Option<String>,
}

/// 系统信息消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfoMessage {
    pub action: SystemInfoAction,
    pub request_id: Option<String>,
}

/// 系统信息动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SystemInfoAction {
    /// 获取系统信息
    GetSystemInfo,
    /// 响应系统信息
    SystemInfoResponse(SystemInfo),
}

/// 系统信息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    /// 操作系统信息
    pub os_info: OSInfo,
    /// Shell 信息
    pub shell_info: ShellInfo,
    /// 可用工具列表
    pub available_tools: AvailableTools,
    /// 环境变量
    pub environment_vars: std::collections::HashMap<String, String>,
    /// 系统架构
    pub architecture: String,
    /// 主机名
    pub hostname: String,
    /// 用户信息
    pub user_info: UserInfo,
}

/// 操作系统信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OSInfo {
    /// 操作系统类型 (Linux, macOS, Windows)
    pub os_type: String,
    /// 操作系统名称 (Ubuntu, CentOS, macOS, Windows 10, etc.)
    pub name: String,
    /// 操作系统版本
    pub version: String,
    /// 内核版本
    pub kernel_version: String,
}

/// Shell 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellInfo {
    /// 默认 Shell 路径
    pub default_shell: String,
    /// Shell 类型 (bash, zsh, fish, powershell, cmd)
    pub shell_type: String,
    /// Shell 版本
    pub shell_version: String,
    /// 支持的 Shell 列表
    pub available_shells: Vec<String>,
}

/// 可用工具信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableTools {
    /// 包管理器
    pub package_managers: Vec<PackageManager>,
    /// 版本控制工具
    pub version_control: Vec<Tool>,
    /// 文本编辑器
    pub text_editors: Vec<Tool>,
    /// 搜索工具
    pub search_tools: Vec<Tool>,
    /// 开发工具
    pub development_tools: Vec<Tool>,
    /// 系统工具
    pub system_tools: Vec<Tool>,
}

/// 包管理器信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageManager {
    /// 包管理器名称 (brew, apt, yum, npm, pip, etc.)
    pub name: String,
    /// 包管理器命令
    pub command: String,
    /// 版本
    pub version: String,
    /// 是否可用
    pub available: bool,
}

/// 工具信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    /// 工具名称
    pub name: String,
    /// 工具命令
    pub command: String,
    /// 版本
    pub version: String,
    /// 是否可用
    pub available: bool,
    /// 工具描述
    pub description: String,
}

/// 用户信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    /// 用户名
    pub username: String,
    /// 用户主目录
    pub home_directory: String,
    /// 当前工作目录
    pub current_directory: String,
    /// 用户 ID
    pub user_id: String,
    /// 组 ID
    pub group_id: String,
}

/// 消息处理器trait
#[async_trait::async_trait]
pub trait MessageHandler: Send + Sync {
    /// 处理消息
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>>;

    /// 获取处理器支持的消息类型
    fn supported_message_types(&self) -> Vec<MessageType>;
}

/// 消息路由器
pub struct MessageRouter {
    handlers: MessageHandlerStore,
}

impl MessageRouter {
    pub fn new() -> Self {
        Self {
            handlers: Arc::new(RwLock::new(MessageHandlerMap::new())),
        }
    }

    /// 注册消息处理器
    pub async fn register_handler(&self, handler: Arc<dyn MessageHandler>) {
        let supported_types = handler.supported_message_types();
        let mut handlers = self.handlers.write().await;
        for message_type in supported_types {
            handlers
                .entry(message_type)
                .or_insert_with(Vec::new)
                .push(handler.clone());
        }
    }

    /// 路由消息到相应的处理器
    pub async fn route_message(&self, message: &Message) -> Vec<Result<Option<Message>>> {
        let handlers = {
            let handlers_guard = self.handlers.read().await;
            handlers_guard.get(&message.message_type).cloned()
        };

        if let Some(handlers) = handlers {
            let mut results = Vec::new();
            for handler in handlers {
                let result = handler.handle_message(message).await;
                results.push(result);
            }
            results
        } else {
            vec![Err(anyhow::anyhow!(
                "No handlers for message type: {:?}",
                message.message_type
            ))]
        }
    }
}

impl Default for MessageRouter {
    fn default() -> Self {
        Self::new()
    }
}

/// 消息序列化工具
pub struct MessageSerializer;

impl MessageSerializer {
    /// 序列化消息为网络传输格式
    pub fn serialize_for_network(message: &Message) -> Result<Vec<u8>> {
        let message_bytes = message.to_bytes()?;
        let length = message_bytes.len() as u32;

        // 格式: [长度(4字节)] + [消息体]
        let mut result = Vec::with_capacity(4 + message_bytes.len());
        result.extend_from_slice(&length.to_be_bytes());
        result.extend_from_slice(&message_bytes);

        Ok(result)
    }

    /// 从网络数据反序列化消息
    pub fn deserialize_from_network(data: &[u8]) -> Result<Message> {
        if data.len() < 4 {
            return Err(anyhow::anyhow!("Data too short for message header"));
        }

        let length = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;

        if data.len() < 4 + length {
            return Err(anyhow::anyhow!("Incomplete message data"));
        }

        let message_bytes = &data[4..4 + length];
        Message::from_bytes(message_bytes)
    }
}

/// 消息构建器，用于方便创建各种类型的消息
pub struct MessageBuilder;

impl MessageBuilder {
    /// 创建心跳消息
    pub fn heartbeat(sender_id: String, sequence: u64, status: String) -> Message {
        let payload = MessagePayload::Heartbeat(HeartbeatMessage { sequence, status });
        Message::new(MessageType::Heartbeat, sender_id, payload).with_priority(MessagePriority::Low)
    }

    /// 创建终端管理消息
    pub fn terminal_management(
        sender_id: String,
        action: TerminalAction,
        request_id: Option<String>,
    ) -> Message {
        let payload =
            MessagePayload::TerminalManagement(TerminalManagementMessage { action, request_id });
        Message::new(MessageType::TerminalManagement, sender_id, payload)
            .with_priority(MessagePriority::Normal)
            .requires_response()
    }

    /// 创建终端I/O消息
    pub fn terminal_io(
        sender_id: String,
        terminal_id: String,
        data_type: IODataType,
        data: Vec<u8>,
    ) -> Message {
        let payload = MessagePayload::TerminalIO(TerminalIOMessage {
            terminal_id,
            data_type,
            data,
        });
        Message::new(MessageType::TerminalIO, sender_id, payload)
            .with_priority(MessagePriority::High)
    }

    /// 创建TCP转发管理消息
    pub fn tcp_forwarding(
        sender_id: String,
        action: TcpForwardingAction,
        request_id: Option<String>,
    ) -> Message {
        let payload = MessagePayload::TcpForwarding(TcpForwardingMessage { action, request_id });
        Message::new(MessageType::TcpForwarding, sender_id, payload)
            .with_priority(MessagePriority::Normal)
            .requires_response()
    }

    /// 创建TCP数据消息
    pub fn tcp_data(
        sender_id: String,
        session_id: String,
        connection_id: String,
        data_type: TcpDataType,
        data: Vec<u8>,
    ) -> Message {
        let payload = MessagePayload::TcpData(TcpDataMessage {
            session_id,
            connection_id,
            data_type,
            data,
        });
        Message::new(MessageType::TcpData, sender_id, payload).with_priority(MessagePriority::High)
    }

    /// 创建系统控制消息
    pub fn system_control(
        sender_id: String,
        action: SystemAction,
        request_id: Option<String>,
    ) -> Message {
        let payload = MessagePayload::SystemControl(SystemControlMessage { action, request_id });
        Message::new(MessageType::SystemControl, sender_id, payload)
            .with_priority(MessagePriority::Normal)
            .requires_response()
    }

    /// 创建响应消息
    pub fn response(
        sender_id: String,
        request_id: String,
        success: bool,
        data: Option<serde_json::Value>,
        message: Option<String>,
    ) -> Message {
        let payload = MessagePayload::Response(ResponseMessage {
            request_id,
            success,
            data: data.map(|v| v.to_string()), // 转换为 JSON 字符串
            message,
        });
        Message::new(MessageType::Response, sender_id, payload)
            .with_priority(MessagePriority::Normal)
    }

    /// 创建系统信息消息
    pub fn system_info(sender_id: String) -> Message {
        let payload = MessagePayload::SystemInfo(SystemInfoMessage {
            action: SystemInfoAction::GetSystemInfo,
            request_id: None
        });
        Message::new(MessageType::SystemInfo, sender_id, payload)
            .with_priority(MessagePriority::Normal)
            .requires_response()
    }

    /// 创建错误消息
    pub fn error(
        sender_id: String,
        code: i32,
        error_message: String,
        details: Option<String>,
    ) -> Message {
        let payload = MessagePayload::Error(ErrorMessage {
            code,
            message: error_message,
            details,
        });
        Message::new(MessageType::Error, sender_id, payload)
            .with_priority(MessagePriority::Critical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_serialization() {
        let message = MessageBuilder::heartbeat("sender1".to_string(), 1, "active".to_string());

        let bytes = message.to_bytes().unwrap();
        let parsed = Message::from_bytes(&bytes).unwrap();

        assert_eq!(parsed.id, message.id);
        assert_eq!(parsed.sender_id, message.sender_id);
        assert_eq!(parsed.message_type, MessageType::Heartbeat);
    }

    #[test]
    fn test_message_builder() {
        let message = MessageBuilder::terminal_management(
            "app".to_string(),
            TerminalAction::Create {
                name: Some("test".to_string()),
                shell_path: Some("/bin/bash".to_string()),
                working_dir: Some("/home".to_string()),
                size: (24, 80),
            },
            Some("req1".to_string()),
        );

        assert_eq!(message.message_type, MessageType::TerminalManagement);
        assert_eq!(message.sender_id, "app");
        assert!(message.requires_response);
    }

    #[test]
    fn test_network_serialization() {
        let message = MessageBuilder::terminal_io(
            "cli".to_string(),
            "term1".to_string(),
            IODataType::Input,
            b"hello".to_vec(),
        );

        let network_data = MessageSerializer::serialize_for_network(&message).unwrap();
        let parsed = MessageSerializer::deserialize_from_network(&network_data).unwrap();

        assert_eq!(parsed.id, message.id);
        assert_eq!(parsed.message_type, MessageType::TerminalIO);
    }

    #[test]
    fn test_message_response() {
        let original = MessageBuilder::system_control(
            "app".to_string(),
            SystemAction::GetStatus,
            Some("req1".to_string()),
        );

        let response_data = serde_json::json!({"status": "running"});
        let response = original.create_response(MessagePayload::Response(ResponseMessage {
            request_id: "req1".to_string(),
            success: true,
            data: Some(response_data.to_string()), // 转换为 JSON 字符串
            message: None,
        }));

        assert_eq!(response.message_type, MessageType::Response);
        assert_eq!(response.correlation_id, Some(original.id));
        assert_eq!(response.receiver_id, Some("app".to_string()));
    }
}
