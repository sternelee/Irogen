/**
 * Typed ACP (Agent Client Protocol) event types for frontend consumption.
 *
 * These types mirror the Rust `AgentEvent` enum from `shared/src/agent/events.rs`
 * as serialized by `event_to_message_content` in `shared/src/agent/message_adapter.rs`.
 *
 * All event types use snake_case strings (e.g., "text_delta") and camelCase property
 * names (e.g., "sessionId", "turnId") for consistency with the frontend JSON format.
 */

// ============================================================================
// Shared / Primitive Types
// ============================================================================

export type NotificationLevel = "Info" | "Warning" | "Error";

export type FileOperationType = "Read" | "Write" | "Create" | "Delete" | "Move" | "Copy";

export type ToolCallStatus = "Started" | "InProgress" | "Completed" | "Failed" | "Error" | "Cancelled";

// ============================================================================
// Base Event Shape
// ============================================================================

/** Every ACP event has at least a type and a sessionId. */
export interface AcpEventBase {
  sessionId: string;
}

// ============================================================================
// Discriminated Union — Session Lifecycle
// ============================================================================

export interface SessionStartedEvent extends AcpEventBase {
  type: "session_started";
  agent: string;
}

export interface SessionEndedEvent extends AcpEventBase {
  type: "session_ended";
}

// ============================================================================
// Discriminated Union — Turn Lifecycle
// ============================================================================

export interface TurnStartedEvent extends AcpEventBase {
  type: "turn_started";
  turnId: string;
}

export interface TurnCompletedEvent extends AcpEventBase {
  type: "turn_completed";
  content?: string;
}

export interface TurnErrorEvent extends AcpEventBase {
  type: "turn_error";
  error: string;
  code?: string;
}

// ============================================================================
// Discriminated Union — Content Streaming
// ============================================================================

export interface TextDeltaEvent extends AcpEventBase {
  type: "text_delta";
  text: string;
}

export interface ReasoningDeltaEvent extends AcpEventBase {
  type: "reasoning_delta";
  text: string;
}

/** Inline frontend format for full responses (legacy or non-streaming). */
export interface ResponseEvent extends AcpEventBase {
  type: "response";
  content?: string;
  text?: string;
  thinking?: boolean;
  messageId?: string;
}

// ============================================================================
// Discriminated Union — Tool Execution
// ============================================================================

export interface ToolStartedEvent extends AcpEventBase {
  type: "tool_started";
  toolId: string;
  toolName: string;
  input?: unknown;
}

export interface ToolInputUpdatedEvent extends AcpEventBase {
  type: "tool_input_updated";
  toolId: string;
  toolName?: string;
  input?: unknown;
}

export interface ToolCompletedEvent extends AcpEventBase {
  type: "tool_completed";
  toolId: string;
  toolName?: string;
  output?: unknown;
  error?: string;
}

/** Legacy tool call event (used by some agent parsers). */
export interface ToolCallEvent extends AcpEventBase {
  type: "tool_call";
  toolName?: string;
  status?: string;
  output?: unknown;
}

/** Legacy tool call update event (used by some agent parsers). */
export interface ToolCallUpdateEvent extends AcpEventBase {
  type: "tool_call_update";
  toolId?: string;
  toolCallId?: string;
  toolName?: string;
  status?: string;
  output?: unknown;
  data?: unknown;
}

// ============================================================================
// Discriminated Union — Permission & User Questions
// ============================================================================

export interface ApprovalRequestEvent extends AcpEventBase {
  type: "approval_request";
  requestId: string;
  toolName: string;
  input?: unknown;
  message?: string;
}

/** Alias for approval_request used by some backends. */
export interface PermissionRequestEvent extends AcpEventBase {
  type: "permission_request";
  requestId: string;
  toolName: string;
  input?: unknown;
  message?: string;
  toolParams?: unknown;
  createdAt?: number;
  requestedAt?: number;
}

export interface UserQuestionEvent extends AcpEventBase {
  type: "user_question";
  question: string;
  options?: string[];
  questionId?: string;
  requestId?: string;
}

// ============================================================================
// Discriminated Union — Monitoring / Info
// ============================================================================

export interface UsageUpdateEvent extends AcpEventBase {
  type: "usage_update";
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  modelContextWindow?: number;
  modelUsage?: string;
}

export interface ProgressUpdateEvent extends AcpEventBase {
  type: "progress_update";
  operation: string;
  progress: number;
  message?: string;
}

export interface NotificationEvent extends AcpEventBase {
  type: "notification";
  level: NotificationLevel;
  message: string;
  details?: unknown;
}

export interface FileOperationEvent extends AcpEventBase {
  type: "file_operation";
  operation: FileOperationType | string;
  path: string;
  status?: string;
}

export interface TerminalOutputEvent extends AcpEventBase {
  type: "terminal_output";
  command: string;
  output: string;
  exitCode?: number;
}

// ============================================================================
// Discriminated Union — Raw Passthrough
// ============================================================================

export interface RawEvent extends AcpEventBase {
  type: "raw";
  agent: string;
  data: unknown;
}

// ============================================================================
// Discriminated Union — Legacy / Externally Tagged
// ============================================================================

export interface MessageStartEvent extends AcpEventBase {
  type: "message_start";
}

export interface MessageEndEvent extends AcpEventBase {
  type: "message_end";
}

export interface PingEvent extends AcpEventBase {
  type: "ping";
}

// ============================================================================
// Master Discriminated Union
// ============================================================================

export type AcpEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnErrorEvent
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | ResponseEvent
  | ToolStartedEvent
  | ToolInputUpdatedEvent
  | ToolCompletedEvent
  | ToolCallEvent
  | ToolCallUpdateEvent
  | ApprovalRequestEvent
  | PermissionRequestEvent
  | UserQuestionEvent
  | UsageUpdateEvent
  | ProgressUpdateEvent
  | NotificationEvent
  | FileOperationEvent
  | TerminalOutputEvent
  | RawEvent
  | MessageStartEvent
  | MessageEndEvent
  | PingEvent;

// ============================================================================
// Type Guards
// ============================================================================

export function isAcpEvent(obj: unknown): obj is AcpEvent {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.type === "string" && typeof o.sessionId === "string";
}

export function isTextDeltaEvent(event: AcpEvent): event is TextDeltaEvent {
  return event.type === "text_delta";
}

export function isReasoningDeltaEvent(event: AcpEvent): event is ReasoningDeltaEvent {
  return event.type === "reasoning_delta";
}

export function isTurnStartedEvent(event: AcpEvent): event is TurnStartedEvent {
  return event.type === "turn_started";
}

export function isTurnCompletedEvent(event: AcpEvent): event is TurnCompletedEvent {
  return event.type === "turn_completed";
}

export function isTurnErrorEvent(event: AcpEvent): event is TurnErrorEvent {
  return event.type === "turn_error";
}

export function isToolEvent(event: AcpEvent): event is ToolStartedEvent | ToolInputUpdatedEvent | ToolCompletedEvent | ToolCallEvent | ToolCallUpdateEvent {
  return (
    event.type === "tool_started" ||
    event.type === "tool_input_updated" ||
    event.type === "tool_completed" ||
    event.type === "tool_call" ||
    event.type === "tool_call_update"
  );
}

export function isApprovalRequestEvent(event: AcpEvent): event is ApprovalRequestEvent | PermissionRequestEvent {
  return event.type === "approval_request" || event.type === "permission_request";
}

export function isUserQuestionEvent(event: AcpEvent): event is UserQuestionEvent {
  return event.type === "user_question";
}

export function isTerminalEvent(event: AcpEvent): boolean {
  return event.type === "turn_completed" || event.type === "turn_error" || event.type === "session_ended";
}

export function isRawEvent(event: AcpEvent): event is RawEvent {
  return event.type === "raw";
}

// ============================================================================
// Parser — Convert untyped payload to typed AcpEvent
// ============================================================================

/**
 * Parse an untyped event payload into a strongly typed AcpEvent.
 *
 * Handles multiple input formats:
 * 1. Wrapped format:   { event: { type: "text_delta", ... }, sessionId: "...", turnId: "..." }
 * 2. Inline format:    { type: "text_delta", sessionId: "...", ... }
 * 3. Externally tagged: { TextDelta: { text: "..." }, sessionId: "..." }
 */
export function parseAcpEvent(payload: unknown): AcpEvent | null {
  if (typeof payload !== "object" || payload === null) return null;

  const obj = payload as Record<string, unknown>;

  // --- 1. Wrapped format: { event: { type: "..." }, sessionId: "..." }
  if (
    "event" in obj &&
    typeof obj.event === "object" &&
    obj.event !== null
  ) {
    const nested = obj.event as Record<string, unknown>;
    const typeStr = normalizeType(String(nested.type || ""));
    const sessionId = String(obj.sessionId || obj.session_id || "");
    if (!typeStr || !sessionId) return null;

    const merged: Record<string, unknown> = { type: typeStr, sessionId };

    // Merge nested event properties (snake_case -> camelCase)
    for (const [key, value] of Object.entries(nested)) {
      if (key === "type") continue;
      merged[toCamelCase(key)] = value;
    }

    // Merge top-level properties (sessionId, turnId, etc.)
    for (const [key, value] of Object.entries(obj)) {
      if (key === "event") continue;
      merged[toCamelCase(key)] = value;
    }

    return buildEvent(merged);
  }

  // --- 2. Inline format: { type: "text_delta", sessionId: "...", ... }
  if ("type" in obj) {
    const typeStr = normalizeType(String(obj.type));
    const sessionId = String(obj.sessionId || obj.session_id || "");
    if (!typeStr) return null;

    const merged: Record<string, unknown> = { type: typeStr };

    // Copy all properties, converting snake_case to camelCase
    for (const [key, value] of Object.entries(obj)) {
      if (key === "type") continue;
      merged[toCamelCase(key)] = value;
    }

    if (sessionId) merged.sessionId = sessionId;

    return buildEvent(merged);
  }

  // --- 3. Externally tagged format (Rust enum serialization)
  const externTagMap: Record<string, string> = {
    TextDelta: "text_delta",
    ReasoningDelta: "reasoning_delta",
    TurnStarted: "turn_started",
    TurnCompleted: "turn_completed",
    TurnError: "turn_error",
    ToolCall: "tool_call",
    ToolCallUpdate: "tool_call_update",
    ToolResult: "tool_completed",
    MessageStart: "message_start",
    MessageEnd: "message_end",
    Ping: "ping",
  };

  for (const [key, mappedType] of Object.entries(externTagMap)) {
    if (key in obj) {
      const value = obj[key];
      const sessionId = String(obj.sessionId || obj.session_id || "");
      const merged: Record<string, unknown> = { type: mappedType };
      if (sessionId) merged.sessionId = sessionId;

      if (value && typeof value === "object") {
        const nested = value as Record<string, unknown>;
        for (const [k, v] of Object.entries(nested)) {
          merged[toCamelCase(k)] = v;
        }
      }

      return buildEvent(merged);
    }
  }

  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeType(typeStr: string): string {
  // Convert protocol names like "text:delta" -> "text_delta"
  return typeStr.replace(/:/g, "_").toLowerCase();
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function buildEvent(data: Record<string, unknown>): AcpEvent | null {
  const typeStr = String(data.type || "");
  const sessionId = String(data.sessionId || "");

  if (!typeStr) return null;

  // Base event with required fields
  const base = { sessionId };

  switch (typeStr) {
    case "session_started":
      return { ...base, type: "session_started", agent: String(data.agent || "") };

    case "session_ended":
      return { ...base, type: "session_ended" };

    case "turn_started":
      return { ...base, type: "turn_started", turnId: String(data.turnId || "") };

    case "turn_completed":
      return { ...base, type: "turn_completed", content: data.content as string | undefined };

    case "turn_error":
      return { ...base, type: "turn_error", error: String(data.error || ""), code: data.code as string | undefined };

    case "text_delta":
      return { ...base, type: "text_delta", text: String(data.text || data.content || "") };

    case "reasoning_delta":
      return { ...base, type: "reasoning_delta", text: String(data.text || "") };

    case "response":
      return {
        ...base,
        type: "response",
        content: data.content as string | undefined,
        text: data.text as string | undefined,
        thinking: data.thinking as boolean | undefined,
        messageId: data.messageId as string | undefined,
      };

    case "tool_started":
      return {
        ...base,
        type: "tool_started",
        toolId: String(data.toolId || data.toolCallId || ""),
        toolName: String(data.toolName || ""),
        input: data.input,
      };

    case "tool_input_updated":
      return {
        ...base,
        type: "tool_input_updated",
        toolId: String(data.toolId || ""),
        toolName: data.toolName as string | undefined,
        input: data.input,
      };

    case "tool_completed":
      return {
        ...base,
        type: "tool_completed",
        toolId: String(data.toolId || data.toolCallId || ""),
        toolName: data.toolName as string | undefined,
        output: data.output,
        error: data.error as string | undefined,
      };

    case "tool_call":
      return {
        ...base,
        type: "tool_call",
        toolName: data.toolName as string | undefined,
        status: data.status as string | undefined,
        output: data.output,
      };

    case "tool_call_update":
      return {
        ...base,
        type: "tool_call_update",
        toolId: data.toolId as string | undefined,
        toolCallId: data.toolCallId as string | undefined,
        toolName: data.toolName as string | undefined,
        status: data.status as string | undefined,
        output: data.output,
        data: data.data,
      };

    case "approval_request":
      return {
        ...base,
        type: "approval_request",
        requestId: String(data.requestId || ""),
        toolName: String(data.toolName || ""),
        input: data.input,
        message: data.message as string | undefined,
      };

    case "permission_request":
      return {
        ...base,
        type: "permission_request",
        requestId: String(data.requestId || ""),
        toolName: String(data.toolName || ""),
        input: data.input,
        message: data.message as string | undefined,
        toolParams: data.toolParams,
        createdAt: data.createdAt as number | undefined,
        requestedAt: data.requestedAt as number | undefined,
      };

    case "user_question":
      return {
        ...base,
        type: "user_question",
        question: String(data.question || ""),
        options: Array.isArray(data.options) ? (data.options as string[]) : undefined,
        questionId: data.questionId as string | undefined,
        requestId: data.requestId as string | undefined,
      };

    case "usage_update":
      return {
        ...base,
        type: "usage_update",
        inputTokens: data.inputTokens as number | undefined,
        outputTokens: data.outputTokens as number | undefined,
        cachedTokens: data.cachedTokens as number | undefined,
        modelContextWindow: data.modelContextWindow as number | undefined,
        modelUsage: data.modelUsage as string | undefined,
      };

    case "progress_update":
      return {
        ...base,
        type: "progress_update",
        operation: String(data.operation || ""),
        progress: typeof data.progress === "number" ? data.progress : 0,
        message: data.message as string | undefined,
      };

    case "notification":
      return {
        ...base,
        type: "notification",
        level: (data.level as NotificationLevel) || "Info",
        message: String(data.message || ""),
        details: data.details,
      };

    case "file_operation":
      return {
        ...base,
        type: "file_operation",
        operation: String(data.operation || ""),
        path: String(data.path || ""),
        status: data.status as string | undefined,
      };

    case "terminal_output":
      return {
        ...base,
        type: "terminal_output",
        command: String(data.command || ""),
        output: String(data.output || ""),
        exitCode: data.exitCode as number | undefined,
      };

    case "raw":
      return {
        ...base,
        type: "raw",
        agent: String(data.agent || ""),
        data: data.data,
      };

    case "message_start":
      return { ...base, type: "message_start" };

    case "message_end":
      return { ...base, type: "message_end" };

    case "ping":
      return { ...base, type: "ping" };

    default:
      return null;
  }
}
