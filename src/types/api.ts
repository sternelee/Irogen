// ============================================================================
// Irogen Types — ACP-compatible frontend types
// ============================================================================

export type AgentType =
  | "claude"
  | "opencode"
  | "codex"
  | "cursor"
  | "gemini"
  | "cline"
  | "pi"
  | "qwen"
  | "copilot"
  | "qoder";

export type SessionMode = "remote" | "local";

export type PermissionMode =
  | "alwaysAsk"
  | "acceptEdits"
  | "autoApprove"
  | "plan";

export type NotificationLevel = "info" | "warning" | "error" | "success";

// ============================================================================
// Agent Session
// ============================================================================

export interface AgentSession {
  sessionId: string;
  agentType: AgentType;
  projectPath: string;
  additionalProjectPaths: string[];
  startedAt: number;
  active: boolean;
  controlledByRemote: boolean;
  hostname: string;
  os: string;
  agentVersion?: string;
  currentDir: string;
  gitBranch?: string;
  machineId: string;
  summary?: string;
  thinking?: boolean;
  mode?: SessionMode;
  controlSessionId?: string;
  lastReceivedSequence: number;
  permissionMode?: PermissionMode;
}

export interface ConnectedHost {
  controlSessionId: string;
  hostname: string;
  os: string;
  machineId: string;
  status: "online" | "offline" | "reconnecting";
}

export interface AgentSessionSummary {
  sessionId: string;
  agentType: AgentType;
  projectPath: string;
  startedAt: number;
  active: boolean;
  hostname: string;
  os: string;
  currentDir: string;
  gitBranch?: string;
  machineId: string;
  summary?: string;
  mode?: SessionMode;
}

export type ConnectionState =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "connecting";

export interface DeviceInfo {
  os: string;
  hostname: string;
  machineId: string;
  platform: string;
  arch: string;
}

// ============================================================================
// Chat Messages — Unified frontend message format for ACP events
// ============================================================================

export type ChatMessageRole = "user" | "assistant" | "event";

/** Base chat message interface */
export interface BaseChatMessage {
  id: string;
  sessionId: string;
  turnId?: string;
  role: ChatMessageRole;
  timestamp: number;
}

/** User message */
export interface UserMessage extends BaseChatMessage {
  role: "user";
  type: "user";
  content: string;
  attachments?: string[];
}

/** Assistant text output (streaming) */
export interface AssistantTextMessage extends BaseChatMessage {
  role: "assistant";
  type: "text";
  content: string;
  status?: "streaming" | "complete" | "error";
}

/** Assistant reasoning/thinking block */
export interface AssistantThinkingMessage extends BaseChatMessage {
  role: "assistant";
  type: "thinking";
  content: string;
  status?: "streaming" | "complete";
}

/** Tool call block */
export interface ToolCallMessage extends BaseChatMessage {
  role: "assistant";
  type: "tool";
  toolId: string;
  toolName: string;
  input?: string;
  output?: string;
  error?: string;
  status: "pending" | "inProgress" | "completed" | "failed";
  exitCode?: number;
}

/** Terminal output block */
export interface TerminalOutputMessage extends BaseChatMessage {
  role: "assistant";
  type: "terminal";
  command: string;
  output: string;
  exitCode?: number;
}

/** File operation block */
export interface FileOperationMessage extends BaseChatMessage {
  role: "event";
  type: "fileOperation";
  operation: "read" | "write" | "create" | "delete" | "move" | "copy";
  path: string;
  status?: string;
}

/** System event / notification */
export interface SystemEventMessage extends BaseChatMessage {
  role: "event";
  type: "event";
  level: NotificationLevel;
  title?: string;
  content: string;
}

/** Usage/token update */
export interface UsageUpdateMessage extends BaseChatMessage {
  role: "event";
  type: "usage";
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  modelContextWindow?: number;
}

/** Session lifecycle event */
export interface SessionLifecycleMessage extends BaseChatMessage {
  role: "event";
  type: "lifecycle";
  event: "started" | "ended";
}

/** Union of all chat message types */
export type ChatMessage =
  | UserMessage
  | AssistantTextMessage
  | AssistantThinkingMessage
  | ToolCallMessage
  | TerminalOutputMessage
  | FileOperationMessage
  | SystemEventMessage
  | UsageUpdateMessage
  | SessionLifecycleMessage;

// ============================================================================
// Permission Request
// ============================================================================

export interface PermissionOption {
  optionId: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  label?: string;
  description?: string;
}

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput?: string;
  toolParams?: string;
  message?: string;
  options: PermissionOption[];
  createdAt: number;
  status?: "pending" | "resolved" | "expired";
}

// ============================================================================
// ACP Raw Events (from Rust AgentEvent)
// ============================================================================

export type AcpEventType =
  | "session:started"
  | "session:ended"
  | "turn:started"
  | "text:delta"
  | "reasoning:delta"
  | "tool:started"
  | "tool:completed"
  | "tool:inputUpdated"
  | "approval:request"
  | "turn:completed"
  | "turn:error"
  | "usage:update"
  | "progress:update"
  | "notification"
  | "file:operation"
  | "terminal:output"
  | "raw";

export interface AcpEvent {
  type: AcpEventType;
  session_id: string;
  turn_id?: string;
  [key: string]: unknown;
}

// ============================================================================
// File & Directory
// ============================================================================

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

export interface FileContent {
  path: string;
  content: string;
}

export interface FileOpenRequest {
  path: string;
  line?: number;
  nonce: number;
}

// ============================================================================
// Notifications
// ============================================================================

export interface FrontendNotification {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
  timestamp: number;
  sessionId?: string;
  url?: string;
}

// ============================================================================
// Session Options
// ============================================================================

export interface CreateSessionOptions {
  agentType: AgentType;
  projectPath: string;
  mode?: SessionMode;
  additionalProjectPaths?: string[];
  permissionMode?: PermissionMode;
  mcpServers?: string;
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
  systemPrompt?: string;
}

// ============================================================================
// Legacy compat
// ============================================================================

export interface MessageBlock {
  id: string;
  role: "user" | "agent" | "event";
  content: unknown;
  timestamp: number;
}
