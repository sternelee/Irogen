/**
 * Terminal Types
 *
 * Type definitions for remote agent terminal interface
 */

// ============================================================================
// Agent Types
// ============================================================================

export type AgentType =
  | 'claude'
  | 'opencode'
  | 'codex'
  | 'gemini'
  | 'openclaw'

export type SessionMode = 'remote' | 'local'

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

// ============================================================================
// Session Types
// ============================================================================

export interface AgentSessionMetadata {
  sessionId: string
  agentType: AgentType
  projectPath: string
  startedAt: number
  active: boolean
  hostname?: string
  currentDir?: string
  gitBranch?: string
  summary?: string
  thinking?: boolean
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  thinking?: boolean
  toolCalls?: ToolCall[]
  attachments?: Attachment[]
}

export interface ToolCall {
  id: string
  toolName: string
  status: 'started' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  input?: unknown
  output?: string
  timestamp: number
}

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  path?: string
  previewUrl?: string
}

// ============================================================================
// Permission Types
// ============================================================================

export interface PermissionRequest {
  id: string
  sessionId: string
  toolName: string
  toolParams?: unknown
  description: string
  message?: string
  requestedAt: number
  status: 'pending' | 'approved' | 'denied'
  response?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
}

// ============================================================================
// Event Types (from WASM)
// ============================================================================

export type NotificationLevel = 'info' | 'warning' | 'error' | 'success'

export type FileOperationType = 'read' | 'write' | 'create' | 'delete' | 'move' | 'copy'

export interface AgentEvent {
  type: string
  sessionId: string
  [key: string]: unknown
}

export interface SessionStartedEvent extends AgentEvent {
  type: 'session:started'
  agent: AgentType
}

export interface TurnStartedEvent extends AgentEvent {
  type: 'turn:started'
  turnId: string
}

export interface TextDeltaEvent extends AgentEvent {
  type: 'text:delta'
  text: string
}

export interface ReasoningDeltaEvent extends AgentEvent {
  type: 'reasoning:delta'
  text: string
}

export interface ToolStartedEvent extends AgentEvent {
  type: 'tool:started'
  toolId: string
  toolName: string
  input?: unknown
}

export interface ToolCompletedEvent extends AgentEvent {
  type: 'tool:completed'
  toolId: string
  toolName?: string
  output?: unknown
  error?: string
}

export interface ToolInputUpdatedEvent extends AgentEvent {
  type: 'tool:inputUpdated'
  toolId: string
  toolName?: string
  input?: unknown
}

export interface ApprovalRequestEvent extends AgentEvent {
  type: 'approval:request'
  requestId: string
  toolName: string
  input?: unknown
  message?: string
}

export interface TurnCompletedEvent extends AgentEvent {
  type: 'turn:completed'
  result?: unknown
}

export interface TurnErrorEvent extends AgentEvent {
  type: 'turn:error'
  error: string
  code?: string
}

export interface SessionEndedEvent extends AgentEvent {
  type: 'session:ended'
}

export interface UsageUpdateEvent extends AgentEvent {
  type: 'usage:update'
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  modelContextWindow?: number
}

export interface ProgressUpdateEvent extends AgentEvent {
  type: 'progress:update'
  operation: string
  progress: number
  message?: string
}

export interface NotificationEvent extends AgentEvent {
  type: 'notification'
  level: NotificationLevel
  message: string
  details?: unknown
}

export interface FileOperationEvent extends AgentEvent {
  type: 'file:operation'
  operation: FileOperationType
  path: string
  status?: string
}

export interface TerminalOutputEvent extends AgentEvent {
  type: 'terminal:output'
  command: string
  output: string
  exitCode?: number
}
