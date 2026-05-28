//! 统一的消息事件协议
//!
//! 此模块定义了 Irogen 中所有组件间的统一消息协议，
//! 支持App-CLI、AI Agent会话管理、TCP转发、文件浏览、Git操作等各种消息类型。

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
pub const MESSAGE_PROTOCOL_VERSION: u8 = 2;

/// Schema fingerprint for cross-version diagnostics.
/// Hash of the bincode-serialized RemoteSpawnMessage structure (SpawnSession variant, all fields set to their minimum/None values).
/// Both sender and receiver must agree on this value; mismatch indicates a schema version drift.
pub const MESSAGE_SCHEMA_FINGERPRINT: u64 = 0xa1b2c3d4e5f0_0u64;

/// 消息类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum MessageType {
    /// 心跳消息
    Heartbeat = 0x01,
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
    /// AI Agent 会话管理
    AgentSession = 0x10,
    /// AI Agent 消息 (用户 <-> AI)
    AgentMessage = 0x11,
    /// AI Agent 权限请求/响应
    AgentPermission = 0x12,
    /// AI Agent 控制消息
    AgentControl = 0x13,
    /// AI Agent 元数据和状态更新
    AgentMetadata = 0x14,
    /// 文件浏览器消息
    FileBrowser = 0x15,
    /// Git 状态消息
    GitStatus = 0x16,
    /// 远程会话生成消息
    RemoteSpawn = 0x17,
    /// 推送通知消息
    Notification = 0x18,
    /// 斜杠命令消息（转发给 AI Agent 的命令）
    SlashCommand = 0x19,
}

impl TryFrom<u8> for MessageType {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self> {
        match value {
            0x01 => Ok(MessageType::Heartbeat),
            0x04 => Ok(MessageType::TcpForwarding),
            0x05 => Ok(MessageType::TcpData),
            0x06 => Ok(MessageType::SystemControl),
            0x09 => Ok(MessageType::SystemInfo),
            0x07 => Ok(MessageType::Response),
            0x08 => Ok(MessageType::Error),
            0x10 => Ok(MessageType::AgentSession),
            0x11 => Ok(MessageType::AgentMessage),
            0x12 => Ok(MessageType::AgentPermission),
            0x13 => Ok(MessageType::AgentControl),
            0x14 => Ok(MessageType::AgentMetadata),
            0x15 => Ok(MessageType::FileBrowser),
            0x16 => Ok(MessageType::GitStatus),
            0x17 => Ok(MessageType::RemoteSpawn),
            0x18 => Ok(MessageType::Notification),
            0x19 => Ok(MessageType::SlashCommand),
            _ => Err(anyhow::anyhow!("Invalid message type: {}", value)),
        }
    }
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
        /// Optional session_id provided by client. If set, CLI will use this instead of generating a new one.
        #[serde(default)]
        session_id: Option<String>,
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
    /// 安装/升级 ACP 包
    InstallAcp { agent_type: String },
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
    #[serde(default)]
    pub requires_response: bool,
    /// 关联的消息ID（用于响应消息）
    #[serde(default)]
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
    /// TCP转发载荷
    TcpForwarding(TcpForwardingMessage),
    /// TCP数据载荷
    TcpData(TcpDataMessage),
    /// 系统控制载荷
    SystemControl(SystemControlMessage),
    /// 系统信息载荷
    SystemInfo(Box<SystemInfoMessage>),
    /// 响应载荷
    Response(ResponseMessage),
    /// 错误载荷
    Error(ErrorMessage),
    /// AI Agent 会话载荷
    AgentSession(AgentSessionMessage),
    /// AI Agent 消息载荷
    AgentMessage(AgentMessageMessage),
    /// AI Agent 权限载荷
    AgentPermission(AgentPermissionMessage),
    /// AI Agent 控制载荷
    AgentControl(AgentControlMessage),
    /// AI Agent 元数据载荷
    AgentMetadata(AgentMetadataMessage),
    /// 文件浏览器载荷
    FileBrowser(FileBrowserMessage),
    /// Git 状态载荷
    GitStatus(GitStatusMessage),
    /// 远程会话生成载荷
    RemoteSpawn(RemoteSpawnMessage),
    /// 推送通知载荷
    Notification(NotificationMessage),
    /// 斜杠命令载荷
    SlashCommand(SlashCommandMessage),
}

/// 心跳消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatMessage {
    pub sequence: u64,
    pub status: String,
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
    SystemInfoResponse(Box<SystemInfo>),
    /// 获取系统运行状态
    GetSystemStats,
    /// 响应系统运行状态
    SystemStatsResponse(Box<SystemStats>),
}

/// 系统运行状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    /// CPU 使用率 (0-100)
    pub cpu_usage: f32,
    /// 内存使用率 (0-100)
    pub memory_usage: f32,
    /// 总内存 (字节)
    pub total_memory: u64,
    /// 已用内存 (字节)
    pub used_memory: u64,
    /// 磁盘使用率 (0-100)
    pub disk_usage: f32,
    /// 总磁盘空间 (字节)
    pub total_disk: u64,
    /// 已用磁盘空间 (字节)
    pub used_disk: u64,
    /// 系统运行时间 (秒)
    pub uptime: u64,
    /// 负载平均值 (1分钟, 5分钟, 15分钟)
    pub load_avg: Option<LoadAverage>,
    /// 网络统计
    pub network_stats: Option<NetworkStats>,
    /// 时间戳
    pub timestamp: u64,
}

/// 负载平均值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadAverage {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

/// 网络统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkStats {
    /// 接收的字节数
    pub bytes_received: u64,
    /// 发送的字节数
    pub bytes_sent: u64,
    /// 接收的包数
    pub packets_received: u64,
    /// 发送的包数
    pub packets_sent: u64,
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

// ============================================================================
// AI Agent 相关类型定义
// ============================================================================

/// AI Agent 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AgentType {
    /// Claude Agent (Anthropic) — ACP
    ClaudeCode,
    /// OpenCode (OpenAI)
    OpenCode,
    /// OpenAI Codex (OpenAI)
    Codex,
    /// Cursor CLI (Cursor)
    Cursor,
    /// Gemini CLI (Google)
    Gemini,
    /// Cline CLI — ACP
    Cline,
    /// Pi CLI — ACP
    Pi,
    /// Qwen Code CLI — ACP
    QwenCode,
}

/// AI Agent 会话元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionMetadata {
    /// 会话 ID
    pub session_id: String,
    /// Agent 类型
    pub agent_type: AgentType,
    /// 项目路径
    pub project_path: String,
    /// 会话开始时间
    pub started_at: u64,
    /// 是否活跃
    pub active: bool,
    /// 是否被远程控制
    pub controlled_by_remote: bool,
    /// 主机名
    pub hostname: String,
    /// 操作系统
    pub os: String,
    /// Agent 版本
    pub agent_version: Option<String>,
    /// 当前工作目录
    pub current_dir: String,
    /// Git 分支（如果在 git 仓库中）
    pub git_branch: Option<String>,
    /// 机器 ID
    pub machine_id: String,
}

/// AI Agent 会话动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentSessionAction {
    /// 注册新会话
    Register { metadata: AgentSessionMetadata },
    /// 更新会话状态
    UpdateStatus { active: bool, thinking: bool },
    /// 列出活跃会话
    ListSessions,
    /// 停止会话
    StopSession { session_id: String },
    /// 心跳更新
    Heartbeat { sequence: u64 },
}

/// External agent history entry (ACP session list)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHistoryEntry {
    pub agent_type: AgentType,
    pub session_id: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub cwd: Option<String>,
    pub meta: Option<serde_json::Value>,
}

/// AI Agent 消息内容类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentMessageContent {
    /// 用户输入消息
    UserMessage {
        content: String,
        /// 附件 ID 列表（文件、图片等）
        attachments: Vec<String>,
    },
    /// AI 响应消息（完整内容）
    AgentResponse {
        content: String,
        /// 是否正在思考（流式响应中）
        thinking: bool,
        /// 消息 ID（用于流式更新）
        message_id: Option<String>,
    },
    /// 回合开始（流式响应开始）
    TurnStarted { turn_id: String },
    /// 文本增量（流式输出）
    TextDelta {
        text: String,
        /// 是否为思考内容
        thinking: bool,
    },
    /// 回合结束（流式响应结束）
    TurnCompleted {
        /// 最终完整内容（可选）
        content: Option<String>,
    },
    /// 回合错误
    TurnError { error: String },
    /// 工具调用更新
    ToolCallUpdate {
        tool_name: String,
        status: ToolCallStatus,
        output: Option<String>,
    },
    /// 系统通知
    SystemNotification {
        level: NotificationLevel,
        message: String,
    },
    /// 原始事件（用于透传 ACP 扩展能力）
    /// data 存储为 JSON 字符串以兼容 bincode 序列化
    RawEvent { event_type: String, data: String },
    /// 权限请求
    ApprovalRequest {
        request_id: String,
        tool_name: String,
        input: Option<String>,
        message: Option<String>,
    },
}

/// 工具调用状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ToolCallStatus {
    /// 工具调用开始
    Started,
    /// 工具调用进行中
    InProgress,
    /// 工具调用成功完成
    Completed,
    /// 工具调用失败
    Failed,
    /// 工具调用被取消
    Cancelled,
}

/// 通知级别
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NotificationLevel {
    Info,
    Warning,
    Error,
    Success,
}

/// AI Agent 权限请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPermissionRequest {
    /// 请求 ID
    pub request_id: String,
    /// 会话 ID
    pub session_id: String,
    /// 工具名称
    pub tool_name: String,
    /// 工具参数 (JSON string for bincode compatibility)
    pub tool_params: String,
    /// 请求时间戳
    pub requested_at: u64,
    /// 权限模式
    pub permission_mode: PermissionMode,
    /// 用户友好的描述
    pub description: Option<String>,
}

/// 权限模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionMode {
    /// 每次都需要批准
    AlwaysAsk,
    /// 本次会话批准
    ApproveForSession,
    /// 自动批准
    AutoApprove,
    /// 拒绝
    Deny,
}

/// AI Agent 权限响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPermissionResponse {
    /// 请求 ID
    pub request_id: String,
    /// 是否批准
    pub approved: bool,
    /// 权限模式
    pub permission_mode: PermissionMode,
    /// 决策时间戳
    pub decided_at: u64,
    /// 拒绝原因（如果拒绝）
    pub reason: Option<String>,
}

/// AI Agent 控制动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentControlAction {
    /// 暂停 Agent
    Pause,
    /// 恢复 Agent
    Resume,
    /// 终止 Agent
    Terminate,
    /// Set permission mode for agent tools
    SetPermissionMode { mode: AgentPermissionMode },
    /// Get current permission mode
    GetPermissionMode,
    /// 发送用户输入
    SendInput {
        content: String,
        attachments: Vec<String>,
    },
    /// 发送中断信号
    SendInterrupt,
    /// 获取 Agent 状态
    GetStatus,
    /// List agent history sessions
    ListHistory {
        agent_type: String,
        project_path: String,
    },
    /// Load an agent history session
    LoadHistory {
        agent_type: String,
        history_session_id: String,
        project_path: String,
        target_session_id: String,
    },
}

/// Permission modes for agent tool approval
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentPermissionMode {
    /// Always ask for approval
    AlwaysAsk,
    /// Auto-approve file edits, ask for other tools
    AcceptEdits,
    /// Auto-approve all tools
    AutoApprove,
    /// Read-only mode, approve reads automatically
    Plan,
}

/// AI Agent 元数据更新
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetadataUpdate {
    /// 会话 ID
    pub session_id: String,
    /// 更新时间戳
    pub updated_at: u64,
    /// 元数据内容
    pub metadata: AgentMetadataContent,
}

/// AI Agent 元数据内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentMetadataContent {
    /// 更新待办事项列表
    UpdateTodos { todos: Vec<TodoItem> },
    /// 更新会话摘要
    UpdateSummary { summary: String },
    /// 更新可用工具列表
    UpdateAvailableTools { tools: Vec<String> },
    /// 更新斜杠命令列表
    UpdateSlashCommands { commands: Vec<String> },
    /// 会话生命周期状态
    LifecycleState { state: String, since: u64 },
}

/// 待办事项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    /// 待办 ID
    pub id: String,
    /// 内容
    pub content: String,
    /// 状态
    pub status: TodoStatus,
    /// 优先级
    pub priority: TodoPriority,
}

/// 待办状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}

/// 待办优先级
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TodoPriority {
    High,
    Medium,
    Low,
}

/// AI Agent 会话消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionMessage {
    pub action: AgentSessionAction,
    pub request_id: Option<String>,
}

/// AI Agent 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessageMessage {
    pub session_id: String,
    pub content: AgentMessageContent,
    pub sequence: Option<u64>,
}

/// AI Agent 权限消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPermissionMessage {
    pub inner: AgentPermissionMessageInner,
}

/// AI Agent 权限消息内容（枚举包装）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentPermissionMessageInner {
    /// 权限请求
    Request(AgentPermissionRequest),
    /// 权限响应
    Response(AgentPermissionResponse),
}

/// AI Agent 控制消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentControlMessage {
    pub session_id: String,
    pub action: AgentControlAction,
    pub request_id: Option<String>,
}

/// AI Agent 元数据消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetadataMessage {
    pub update: AgentMetadataUpdate,
}

/// 文件浏览器消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBrowserMessage {
    pub action: FileBrowserAction,
    pub request_id: Option<String>,
}

/// 文件浏览器动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FileBrowserAction {
    /// 列出目录内容
    ListDirectory { path: String },
    /// 列出 @mention 文件候选
    ListMentionCandidates {
        base_path: String,
        query: String,
        limit: Option<usize>,
    },
    /// 读取文件内容
    ReadFile { path: String },
    /// 写入文件
    WriteFile { path: String, content: String },
    /// 获取文件信息
    GetFileInfo { path: String },
}

/// Git 状态消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatusMessage {
    pub action: GitAction,
    pub request_id: Option<String>,
}

/// Git 操作动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GitAction {
    /// 获取 git 状态
    GetStatus { path: String },
    /// 获取文件 diff
    GetDiff { path: String, file: String },
    /// 获取提交历史
    GetLog { path: String, limit: Option<usize> },
    /// 获取当前分支
    GetBranch { path: String },
}

/// 远程会话生成消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSpawnMessage {
    pub action: RemoteSpawnAction,
    pub request_id: Option<String>,
}

/// 远程会话生成动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RemoteSpawnAction {
    /// 生成新的 AI Agent 会话
    SpawnSession {
        /// App 端的会话 ID，用于事件路由
        session_id: String,
        agent_type: AgentType,
        project_path: String,
        args: Vec<String>,
        /// Optional MCP server configuration JSON string (ACP mcpServers array)
        #[serde(default)]
        mcp_servers: Option<String>,
    },
    /// 列出远程 CLI 已创建的 agent 会话
    ListSessions,
    /// 列出可用的 agent 类型
    ListAvailableAgents,
    /// 停止远程 CLI 上的 agent 会话
    StopSession { session_id: String },
}

/// 推送通知消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationMessage {
    pub notification: NotificationData,
}

/// 通知数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationData {
    /// 通知 ID
    pub id: String,
    /// 会话 ID (可选)
    pub session_id: Option<String>,
    /// 通知类型
    pub notification_type: NotificationType,
    /// 通知标题
    pub title: String,
    /// 通知内容
    pub body: String,
    /// 时间戳
    pub timestamp: u64,
    /// 优先级
    pub priority: NotificationPriority,
    /// 是否已读
    pub read: bool,
}

/// 通知类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NotificationType {
    /// 权限请求
    PermissionRequest,
    /// 工具调用完成
    ToolCompleted,
    /// 会话状态变化
    SessionStatus,
    /// 错误通知
    Error,
    /// 信息通知
    Info,
}

/// 通知优先级
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum NotificationPriority {
    Low,
    Normal,
    High,
    Critical,
}

// ============================================================================
// 斜杠命令相关类型定义
// ============================================================================

/// 斜杠命令消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommandMessage {
    /// 会话 ID
    pub session_id: String,
    /// 命令
    pub command: SlashCommand,
    /// 请求 ID
    pub request_id: Option<String>,
}

/// 斜杠命令
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SlashCommand {
    /// 转发给 Agent 的原始命令
    Passthrough {
        /// 原始命令字符串（如 "/help", "/sessions", "/plugin install xxx"）
        raw: String,
    },
    /// Irogen 内置命令
    Builtin {
        /// 命令类型
        command_type: BuiltinCommand,
    },
}

/// Irogen 内置命令
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BuiltinCommand {
    /// 列出所有会话
    ListSessions,
    /// 启动新的 Agent 会话
    SpawnAgent {
        agent_type: AgentType,
        project_path: String,
        args: Vec<String>,
    },
    /// 停止会话
    StopSession { session_id: String },
    /// 获取可用命令列表
    ListCommands,
    /// 获取 Agent 信息
    GetAgentInfo,
    /// 初始化项目 - 分析项目结构并创建开发计划
    Init { description: Option<String> },
    /// 代码审查 - 审查指定文件或当前更改
    Review { target: Option<String> },
    /// 代码审查（审查分支）
    ReviewBranch,
    /// 代码审查（审查提交）
    ReviewCommit,
    /// 提交更改 - 生成提交信息并创建 git commit
    Commit { message: Option<String> },
    /// 循环执行 - 重复执行某个任务
    Loop {
        task: String,
        iterations: Option<u32>,
    },
    /// 添加目录到上下文 - 将目录内容纳入对话上下文
    AddDir { path: String },
    /// 分支操作 - 创建或切换分支
    Branch { name: Option<String> },
    /// 顺便说一下 - 记录临时想法或上下文切换
    Btw { message: String },
    /// 清空上下文 - 清除对话历史但保持会话
    Clear,
    /// 压缩上下文 - 总结并压缩对话历史
    Compact,
    /// 创建计划 - 创建结构化的任务计划
    Plan { description: String },
    /// 重命名会话
    Rename { new_name: String },
    /// 登出 - 结束会话
    Logout,
}

/// 斜杠命令响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommandResponse {
    /// 会话 ID
    pub session_id: String,
    /// 响应内容
    pub content: SlashCommandResponseContent,
    /// 请求 ID
    pub request_id: Option<String>,
}

/// 斜杠命令响应内容
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SlashCommandResponseContent {
    /// 成功响应
    Success {
        /// 响应数据
        data: serde_json::Value,
    },
    /// 错误响应
    Error {
        /// 错误消息
        message: String,
    },
    /// 结构化输出（用于命令如 /sessions）
    Structured {
        /// 输出格式
        format: OutputFormat,
        /// 内容
        content: String,
    },
}

/// 输出格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OutputFormat {
    /// 纯文本
    Text,
    /// Markdown
    Markdown,
    /// JSON
    Json,
    /// 表格
    Table,
}

/// Agent 特定的命令定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCommandDefinition {
    /// 命令名称（不含斜杠）
    pub name: String,
    /// 命令描述
    pub description: String,
    /// 参数定义
    pub parameters: Vec<CommandParameter>,
    /// 是否需要参数
    pub requires_args: bool,
    /// 示例用法
    pub examples: Vec<String>,
    /// 支持的 Agent 类型
    pub supported_agents: Vec<AgentType>,
}

/// 命令参数定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandParameter {
    /// 参数名称
    pub name: String,
    /// 参数描述
    pub description: String,
    /// 是否必需
    pub required: bool,
    /// 参数类型
    pub param_type: CommandParameterType,
}

/// 命令参数类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CommandParameterType {
    /// 字符串
    String,
    /// 数字
    Number,
    /// 布尔值
    Boolean,
    /// 文件路径
    FilePath,
    /// 任意
    Any,
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

/// Returns the bincode-serialized byte size of a RemoteSpawnMessage (SpawnSession variant).
/// Used for cross-version diagnostic logging: compare CLI vs app output to detect schema drift.
#[doc(hidden)]
pub fn remote_spawn_message_wire_size() -> usize {
    let msg = Message {
        id: "4ba0b26b-64db-4e5f-a088-ba07a1131044".to_string(),
        message_type: MessageType::RemoteSpawn,
        priority: MessagePriority::Normal,
        sender_id: "app".to_string(),
        receiver_id: None,
        session_id: None,
        timestamp: 0,
        payload: MessagePayload::RemoteSpawn(RemoteSpawnMessage {
            action: RemoteSpawnAction::SpawnSession {
                session_id: "agent_00000000-0000-0000-0000-000000000000".to_string(),
                agent_type: AgentType::ClaudeCode,
                project_path: "~/test".to_string(),
                args: vec![],
                mcp_servers: None,
            },
            request_id: None,
        }),
        requires_response: true,
        correlation_id: None,
    };
    msg.to_bytes().map(|b| b.len()).unwrap_or(0)
}

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
            return Err(anyhow::anyhow!(
                "Data too short for message header: data_len={}",
                data.len()
            ));
        }

        let length = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;

        if data.len() < 4 + length {
            let preview = data
                .iter()
                .take(16)
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>()
                .join(" ");
            return Err(anyhow::anyhow!(
                "Incomplete message data: expected_total={}, actual={}, payload_len={}, header_hex=[{}]",
                4 + length,
                data.len(),
                length,
                preview
            ));
        }

        let message_bytes = &data[4..4 + length];
        Message::from_bytes(message_bytes).map_err(|e| {
            let preview = message_bytes
                .iter()
                .take(16)
                .map(|b| format!("{:02x}", b))
                .collect::<Vec<_>>()
                .join(" ");
            anyhow::anyhow!(
                "Message decode failed: payload_len={}, payload_hex=[{}], error={}",
                message_bytes.len(),
                preview,
                e
            )
        })
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
        let payload = MessagePayload::SystemInfo(Box::new(SystemInfoMessage {
            action: SystemInfoAction::GetSystemInfo,
            request_id: None,
        }));
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

    // ========================================================================
    // AI Agent 消息构建方法
    // ========================================================================

    /// 创建 AI Agent 会话注册消息
    pub fn agent_session_register(
        sender_id: String,
        metadata: AgentSessionMetadata,
        request_id: Option<String>,
    ) -> Message {
        let payload = MessagePayload::AgentSession(AgentSessionMessage {
            action: AgentSessionAction::Register { metadata },
            request_id,
        });
        Message::new(MessageType::AgentSession, sender_id, payload)
            .with_priority(MessagePriority::High)
            .requires_response()
    }

    /// 创建 AI Agent 会话心跳消息
    pub fn agent_session_heartbeat(
        sender_id: String,
        session_id: String,
        sequence: u64,
    ) -> Message {
        let payload = MessagePayload::AgentSession(AgentSessionMessage {
            action: AgentSessionAction::Heartbeat { sequence },
            request_id: None,
        });
        Message::new(MessageType::AgentSession, sender_id, payload)
            .with_session(session_id)
            .with_priority(MessagePriority::Low)
    }

    /// 创建 AI Agent 用户消息
    pub fn agent_user_message(
        sender_id: String,
        session_id: String,
        content: String,
        attachments: Vec<String>,
    ) -> Message {
        let payload = MessagePayload::AgentMessage(AgentMessageMessage {
            session_id: session_id.clone(),
            content: AgentMessageContent::UserMessage {
                content,
                attachments,
            },
            sequence: None,
        });
        Message::new(MessageType::AgentMessage, sender_id, payload)
            .with_session(session_id)
            .with_priority(MessagePriority::Normal)
    }

    /// 创建 AI Agent 响应消息
    pub fn agent_response(
        sender_id: String,
        session_id: String,
        content: String,
        thinking: bool,
        message_id: Option<String>,
    ) -> Message {
        let payload = MessagePayload::AgentMessage(AgentMessageMessage {
            session_id: session_id.clone(),
            content: AgentMessageContent::AgentResponse {
                content,
                thinking,
                message_id,
            },
            sequence: None,
        });
        Message::new(MessageType::AgentMessage, sender_id, payload)
            .with_session(session_id)
            .with_priority(MessagePriority::Normal)
    }

    /// 创建 AI Agent 工具调用更新消息
    pub fn agent_tool_update(
        sender_id: String,
        session_id: String,
        tool_name: String,
        status: ToolCallStatus,
        output: Option<String>,
    ) -> Message {
        let payload = MessagePayload::AgentMessage(AgentMessageMessage {
            session_id: session_id.clone(),
            content: AgentMessageContent::ToolCallUpdate {
                tool_name,
                status,
                output,
            },
            sequence: None,
        });
        Message::new(MessageType::AgentMessage, sender_id, payload)
            .with_session(session_id)
            .with_priority(MessagePriority::High)
    }

    /// 创建 AI Agent 系统通知消息
    pub fn agent_notification(
        sender_id: String,
        session_id: String,
        level: NotificationLevel,
        message: String,
    ) -> Message {
        let payload = MessagePayload::AgentMessage(AgentMessageMessage {
            session_id: session_id.clone(),
            content: AgentMessageContent::SystemNotification { level, message },
            sequence: None,
        });
        Message::new(MessageType::AgentMessage, sender_id, payload)
            .with_session(session_id)
            .with_priority(MessagePriority::Normal)
    }

    /// 创建 AI Agent 权限请求消息
    pub fn agent_permission_request(sender_id: String, request: AgentPermissionRequest) -> Message {
        let payload = MessagePayload::AgentPermission(AgentPermissionMessage {
            inner: AgentPermissionMessageInner::Request(request),
        });
        Message::new(MessageType::AgentPermission, sender_id, payload)
            .with_priority(MessagePriority::High)
            .requires_response()
    }

    /// 创建 AI Agent 权限响应消息
    pub fn agent_permission_response(
        sender_id: String,
        response: AgentPermissionResponse,
    ) -> Message {
        let payload = MessagePayload::AgentPermission(AgentPermissionMessage {
            inner: AgentPermissionMessageInner::Response(response),
        });
        Message::new(MessageType::AgentPermission, sender_id, payload)
            .with_priority(MessagePriority::High)
    }

    /// 创建 AI Agent 控制消息
    pub fn agent_control(
        sender_id: String,
        session_id: String,
        action: AgentControlAction,
        request_id: Option<String>,
    ) -> Message {
        let payload = MessagePayload::AgentControl(AgentControlMessage {
            session_id: session_id.clone(),
            action,
            request_id,
        });
        Message::new(MessageType::AgentControl, sender_id, payload)
            .with_session(session_id)
            .with_priority(MessagePriority::High)
            .requires_response()
    }

    /// 创建 AI Agent 元数据更新消息
    pub fn agent_metadata_update(
        sender_id: String,
        session_id: String,
        metadata: AgentMetadataContent,
    ) -> Message {
        let payload = MessagePayload::AgentMetadata(AgentMetadataMessage {
            update: AgentMetadataUpdate {
                session_id,
                updated_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
                metadata,
            },
        });
        Message::new(MessageType::AgentMetadata, sender_id, payload)
            .with_priority(MessagePriority::Normal)
    }

    // ========================================================================
    // Phase 5: File Browser, Git, Remote Spawn, Notifications
    // ========================================================================

    /// 创建文件浏览器消息
    pub fn file_browser(
        sender_id: String,
        action: FileBrowserAction,
        request_id: Option<String>,
    ) -> Message {
        let payload = MessagePayload::FileBrowser(FileBrowserMessage { action, request_id });
        Message::new(MessageType::FileBrowser, sender_id, payload)
            .with_priority(MessagePriority::Normal)
            .requires_response()
    }

    /// 创建 Git 状态消息
    pub fn git_status(sender_id: String, action: GitAction, request_id: Option<String>) -> Message {
        let payload = MessagePayload::GitStatus(GitStatusMessage { action, request_id });
        Message::new(MessageType::GitStatus, sender_id, payload)
            .with_priority(MessagePriority::Normal)
            .requires_response()
    }

    /// 创建远程会话生成消息
    pub fn remote_spawn(
        sender_id: String,
        action: RemoteSpawnAction,
        request_id: Option<String>,
    ) -> Message {
        let payload = MessagePayload::RemoteSpawn(RemoteSpawnMessage { action, request_id });
        Message::new(MessageType::RemoteSpawn, sender_id, payload)
            .with_priority(MessagePriority::High)
            .requires_response()
    }

    /// 创建通知消息
    pub fn notification(sender_id: String, notification: NotificationData) -> Message {
        let payload = MessagePayload::Notification(NotificationMessage { notification });
        Message::new(MessageType::Notification, sender_id, payload)
            .with_priority(MessagePriority::High)
    }

    /// 创建权限请求通知
    pub fn permission_notification(
        sender_id: String,
        session_id: String,
        _tool_name: String,
        description: String,
    ) -> Message {
        let notification = NotificationData {
            id: Uuid::new_v4().to_string(),
            session_id: Some(session_id),
            notification_type: NotificationType::PermissionRequest,
            title: "Permission Request".to_string(),
            body: description,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            priority: NotificationPriority::High,
            read: false,
        };
        Self::notification(sender_id, notification)
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
    fn test_network_serialization() {
        let message = MessageBuilder::tcp_data(
            "cli".to_string(),
            "session1".to_string(),
            "conn1".to_string(),
            TcpDataType::Data,
            b"hello".to_vec(),
        );

        let network_data = MessageSerializer::serialize_for_network(&message).unwrap();
        let parsed = MessageSerializer::deserialize_from_network(&network_data).unwrap();

        assert_eq!(parsed.id, message.id);
        assert_eq!(parsed.message_type, MessageType::TcpData);
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

    #[test]
    fn test_remote_spawn_message_body_size() {
        let size = remote_spawn_message_wire_size();
        eprintln!("RemoteSpawnMessage body wire size: {} bytes", size);
        let msg = Message {
            id: "4ba0b26b-64db-4e5f-a088-ba07a1131044".to_string(),
            message_type: MessageType::RemoteSpawn,
            priority: MessagePriority::Normal,
            sender_id: "app".to_string(),
            receiver_id: None,
            session_id: None,
            timestamp: 0,
            payload: MessagePayload::RemoteSpawn(RemoteSpawnMessage {
                action: RemoteSpawnAction::SpawnSession {
                    session_id: "agent_00000000-0000-0000-0000-000000000000".to_string(),
                    agent_type: AgentType::ClaudeCode,
                    project_path: "~/test".to_string(),
                    args: vec![],
                    mcp_servers: None,
                },
                request_id: None,
            }),
            requires_response: true,
            correlation_id: None,
        };
        let body = msg.to_bytes().unwrap();
        eprintln!("Full Message body bytes: {}", body.len());
        let wire = MessageSerializer::serialize_for_network(&msg).unwrap();
        eprintln!("Wire (frame) total bytes: {}", wire.len());

        // Verify serialization and deserialization work
        let parsed = Message::from_bytes(&body).unwrap();
        assert_eq!(parsed.message_type, MessageType::RemoteSpawn);
    }

    #[test]
    fn test_remote_spawn_message_with_request_id() {
        // Test with request_id matching what app sends
        let msg = Message {
            id: "75c56c56-7a40-435e-8352-96398f12df07".to_string(),
            message_type: MessageType::RemoteSpawn,
            priority: MessagePriority::Normal,
            sender_id: "app".to_string(),
            receiver_id: None,
            session_id: None,
            timestamp: 0,
            payload: MessagePayload::RemoteSpawn(RemoteSpawnMessage {
                action: RemoteSpawnAction::SpawnSession {
                    session_id: "agent_ad6fea43-3ef1-410d-8a60-a76702747baa".to_string(),
                    agent_type: AgentType::Codex,
                    project_path: "~/www/gitee".to_string(),
                    args: vec![],
                    mcp_servers: None,
                },
                request_id: Some("38465219-26c9-4784-8c2e-537daf92009a".to_string()),
            }),
            requires_response: true,
            correlation_id: None,
        };

        let body = msg.to_bytes().unwrap();
        eprintln!("Message with request_id body size: {} bytes", body.len());

        // Verify deserialization works
        let parsed = Message::from_bytes(&body).unwrap();
        assert_eq!(parsed.message_type, MessageType::RemoteSpawn);

        // Verify the payload
        if let MessagePayload::RemoteSpawn(ref payload) = parsed.payload {
            if let RemoteSpawnAction::SpawnSession { session_id, .. } = &payload.action {
                assert_eq!(session_id, "agent_ad6fea43-3ef1-410d-8a60-a76702747baa");
            } else {
                panic!("Expected SpawnSession action");
            }
        } else {
            panic!("Expected RemoteSpawn payload");
        }
    }
}
