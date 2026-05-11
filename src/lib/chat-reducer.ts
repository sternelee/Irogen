import type {
  AcpEvent,
  ChatMessage,
  UserMessage,
  AssistantTextMessage,
  AssistantThinkingMessage,
  ToolCallMessage,
  TerminalOutputMessage,
  FileOperationMessage,
  SystemEventMessage,
  UsageUpdateMessage,
  SessionLifecycleMessage,
  NotificationLevel,
} from "@/types/api";

let messageIdCounter = 0;

function nextId(): string {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

/**
 * Reduce a stream of ACP events into a flat list of ChatMessages.
 *
 * This handles:
 * - Streaming text deltas (append to existing assistant text block)
 * - Streaming reasoning deltas (append to existing thinking block)
 * - Tool calls (create, update input, complete with result/error)
 * - Terminal output
 * - File operations
 * - System events
 * - Session lifecycle
 * - Usage updates
 */
export function reduceAcpEvents(
  existing: ChatMessage[],
  events: AcpEvent[]
): ChatMessage[] {
  const messages = [...existing];

  for (const event of events) {
    switch (event.type) {
      case "text:delta": {
        const text = (event.text as string) ?? "";
        const turnId = event.turn_id;
        // Find the most recent assistant text message for this turn
        const lastIdx = findLastIndex(
          messages,
          (m) =>
            m.role === "assistant" &&
            m.type === "text" &&
            m.turnId === turnId &&
            m.status === "streaming"
        );
        if (lastIdx >= 0) {
          const msg = messages[lastIdx] as AssistantTextMessage;
          messages[lastIdx] = {
            ...msg,
            content: msg.content + text,
          };
        } else {
          messages.push({
            id: nextId(),
            sessionId: event.session_id,
            turnId,
            role: "assistant",
            type: "text",
            content: text,
            status: "streaming",
            timestamp: Date.now(),
          });
        }
        break;
      }

      case "reasoning:delta": {
        const text = (event.text as string) ?? "";
        const turnId = event.turn_id;
        const lastIdx = findLastIndex(
          messages,
          (m) =>
            m.role === "assistant" &&
            m.type === "thinking" &&
            m.turnId === turnId &&
            m.status === "streaming"
        );
        if (lastIdx >= 0) {
          const msg = messages[lastIdx] as AssistantThinkingMessage;
          messages[lastIdx] = {
            ...msg,
            content: msg.content + text,
          };
        } else {
          messages.push({
            id: nextId(),
            sessionId: event.session_id,
            turnId,
            role: "assistant",
            type: "thinking",
            content: text,
            status: "streaming",
            timestamp: Date.now(),
          });
        }
        break;
      }

      case "turn:started": {
        // Mark any previous streaming blocks as complete (safety net
        // in case turn:completed was lost or never sent).
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role === "assistant" && m.status === "streaming") {
            if (m.type === "text") {
              messages[i] = { ...m, status: "complete" };
            } else if (m.type === "thinking") {
              messages[i] = { ...m, status: "complete" };
            }
          }
        }
        break;
      }

      case "turn:completed": {
        const turnId = event.turn_id;
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.turnId === turnId && m.role === "assistant") {
            if (m.type === "text" && m.status === "streaming") {
              messages[i] = { ...m, status: "complete" };
            } else if (m.type === "thinking" && m.status === "streaming") {
              messages[i] = { ...m, status: "complete" };
            }
          }
        }
        break;
      }

      case "turn:error": {
        const turnId = event.turn_id;
        const error = (event.error as string) ?? "Unknown error";
        // Mark any streaming text as error
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.turnId === turnId && m.role === "assistant" && m.type === "text" && m.status === "streaming") {
            messages[i] = { ...m, status: "error" };
          }
        }
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId,
          role: "event",
          type: "event",
          level: "error",
          title: "Turn Error",
          content: error,
          timestamp: Date.now(),
        });
        break;
      }

      case "tool:started": {
        const toolId = (event.tool_id as string) ?? "";
        const toolName = (event.tool_name as string) ?? "tool";
        const input = event.input ? String(event.input) : undefined;
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "assistant",
          type: "tool",
          toolId,
          toolName,
          input,
          status: "pending",
          timestamp: Date.now(),
        });
        break;
      }

      case "tool:inputUpdated": {
        const toolId = (event.tool_id as string) ?? "";
        const input = event.input ? String(event.input) : undefined;
        const idx = findLastIndex(
          messages,
          (m) => m.type === "tool" && m.toolId === toolId
        );
        if (idx >= 0) {
          const msg = messages[idx] as ToolCallMessage;
          messages[idx] = {
            ...msg,
            input: input ?? msg.input,
            status: "inProgress",
          };
        }
        break;
      }

      case "tool:completed": {
        const toolId = (event.tool_id as string) ?? "";
        const output = event.output ? String(event.output) : undefined;
        const error = event.error ? String(event.error) : undefined;
        const idx = findLastIndex(
          messages,
          (m) => m.type === "tool" && m.toolId === toolId
        );
        if (idx >= 0) {
          const msg = messages[idx] as ToolCallMessage;
          messages[idx] = {
            ...msg,
            output,
            error,
            status: error ? "failed" : "completed",
          };
        }
        break;
      }

      case "terminal:output": {
        const command = (event.command as string) ?? "";
        const output = (event.output as string) ?? "";
        const exitCode = event.exit_code as number | undefined;
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "assistant",
          type: "terminal",
          command,
          output,
          exitCode,
          timestamp: Date.now(),
        });
        break;
      }

      case "file:operation": {
        const operation = (event.operation as string) ?? "read";
        const path = (event.path as string) ?? "";
        const status = event.status ? String(event.status) : undefined;
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "event",
          type: "fileOperation",
          operation: operation as FileOperationMessage["operation"],
          path,
          status,
          timestamp: Date.now(),
        });
        break;
      }

      case "session:started": {
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "event",
          type: "lifecycle",
          event: "started",
          timestamp: Date.now(),
        });
        break;
      }

      case "session:ended": {
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "event",
          type: "lifecycle",
          event: "ended",
          timestamp: Date.now(),
        });
        break;
      }

      case "usage:update": {
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "event",
          type: "usage",
          inputTokens: event.input_tokens as number | undefined,
          outputTokens: event.output_tokens as number | undefined,
          cachedTokens: event.cached_tokens as number | undefined,
          modelContextWindow: event.model_context_window as number | undefined,
          timestamp: Date.now(),
        });
        break;
      }

      case "notification": {
        const level = (event.level as NotificationLevel) ?? "info";
        const message = (event.message as string) ?? "";
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "event",
          type: "event",
          level,
          content: message,
          timestamp: Date.now(),
        });
        break;
      }

      case "progress:update": {
        const operation = (event.operation as string) ?? "";
        const progress = (event.progress as number) ?? 0;
        const message = event.message ? String(event.message) : undefined;
        const pct = Math.round(progress * 100);
        const content = message
          ? `${operation}: ${message} (${pct}%)`
          : `${operation}: ${pct}%`;
        messages.push({
          id: nextId(),
          sessionId: event.session_id,
          turnId: event.turn_id,
          role: "event",
          type: "event",
          level: "info",
          title: operation,
          content,
          timestamp: Date.now(),
        });
        break;
      }

      case "raw": {
        const data = event.data ? String(event.data) : "";
        try {
          const parsed = JSON.parse(data);
          if (parsed && typeof parsed === "object") {
            // Try to render as a system event with the raw data
            messages.push({
              id: nextId(),
              sessionId: event.session_id,
              turnId: event.turn_id,
              role: "event",
              type: "event",
              level: "info",
              content: JSON.stringify(parsed, null, 2),
              timestamp: Date.now(),
            });
          }
        } catch {
          messages.push({
            id: nextId(),
            sessionId: event.session_id,
            turnId: event.turn_id,
            role: "event",
            type: "event",
            level: "info",
            content: data,
            timestamp: Date.now(),
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return messages;
}

function findLastIndex<T>(arr: T[], predicate: (value: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

/**
 * Create a user message from text input.
 */
export function createUserMessage(
  sessionId: string,
  text: string,
  attachments?: string[]
): UserMessage {
  return {
    id: nextId(),
    sessionId,
    role: "user",
    type: "user",
    content: text,
    attachments,
    timestamp: Date.now(),
  };
}

/**
 * Group messages by turn for rendering.
 * Returns an array of turns, each containing messages in that turn.
 */
export function groupMessagesByTurn(
  messages: ChatMessage[]
): { turnId: string | undefined; messages: ChatMessage[] }[] {
  const turns: { turnId: string | undefined; messages: ChatMessage[] }[] = [];
  let currentTurnId: string | undefined = undefined;
  let currentTurnMessages: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.turnId !== currentTurnId) {
      if (currentTurnMessages.length > 0) {
        turns.push({
          turnId: currentTurnId,
          messages: currentTurnMessages,
        });
      }
      currentTurnId = msg.turnId;
      currentTurnMessages = [msg];
    } else {
      currentTurnMessages.push(msg);
    }
  }

  if (currentTurnMessages.length > 0) {
    turns.push({ turnId: currentTurnId, messages: currentTurnMessages });
  }

  return turns;
}
