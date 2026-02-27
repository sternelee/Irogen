/**
 * ChatView Component
 *
 * Main chat interface for AI agent interactions with the shared UI token system.
 * Displays messages, handles user input, shows permission requests, and supports slash commands.
 */

import {
  For,
  Show,
  createEffect,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";
import { TransitionGroup } from "solid-transition-group";
import { createClipboard } from "@solid-primitives/clipboard";
import { createScrollPosition } from "@solid-primitives/scroll";
import {
  FiUser,
  FiTerminal,
  FiPlus,
  FiCheck,
  FiX,
  FiAlertTriangle,
  FiCopy,
} from "solid-icons/fi";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { chatStore } from "../stores/chatStore";
import { sessionStore } from "../stores/sessionStore";
import { isMobile } from "../stores/deviceStore";
import type { AgentType } from "../stores/sessionStore";
import { notificationStore } from "../stores/notificationStore";
import type { ChatMessage, PermissionRequest } from "../stores/chatStore";
import { Dialog } from "./ui/dialog";
import { PermissionList } from "./ui/PermissionCard";
import { Button } from "./ui/primitives";
import { SolidMarkdown } from "solid-markdown";
import { ToolCallList, ReasoningBlock } from "./ui/EnhancedMessageComponents";
import { ChatInput } from "./ui/ChatInput";

// ============================================================================
// Helper Functions
// ============================================================================

interface ParsedEvent {
  type: string;
  // External agent protocol event types
  sessionId?: string;
  turnId?: string;
  agent?: string;
  // Text/Content
  text?: string;
  content?: string;
  thinking?: boolean;
  // Turn lifecycle
  result?: unknown;
  error?: string;
  code?: string;
  // Tool events
  toolId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  // Permission
  requestId?: string;
  message?: string;
  // Usage
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  modelContextWindow?: number;
  modelUsage?: string;
  // Progress
  progress?: number;
  // Notification
  level?: string;
  details?: unknown;
  // File operations
  operation?: string;
  path?: string;
  status?: string;
  // Terminal
  command?: string;
  exitCode?: number;
  // Raw fields
  data?: unknown;
}

/**
 * Parse event from either format:
 * 1. Rust externally tagged: {TurnStarted: {turn_id: "..."}} -> type: "turn_started"
 * 2. Frontend inline format: {type: "text_delta", content: "..."}
 * 3. External agent protocol format: {type: "text:delta", sessionId: "...", text: "..."}
 */
function parseEvent(eventObj: Record<string, unknown>): ParsedEvent {
  // Check for inline protocol format first (type: "text_delta" or "text:delta")
  if ("type" in eventObj) {
    const result: ParsedEvent = { type: eventObj.type as string };

    // Convert protocol type names from kebab-case to camelCase
    const typeStr = result.type;
    if (typeStr.includes(":")) {
      // Protocol: "text:delta" -> "text_delta"
      result.type = typeStr.replace(":", "_");
    }

    // Copy all other properties, converting snake_case to camelCase
    for (const key of Object.keys(eventObj)) {
      if (key !== "type") {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        (result as unknown as Record<string, unknown>)[camelKey] =
          eventObj[key];
      }
    }

    return result;
  }

  // Check for externally tagged format (Rust serialization)
  const typeMapping: Record<string, string> = {
    TextDelta: "text_delta",
    ReasoningDelta: "reasoning_delta",
    TurnStarted: "turn_started",
    TurnCompleted: "turn_completed",
    TurnError: "turn_error",
    ToolCall: "tool_call",
    ToolResult: "tool_result",
    MessageStart: "message_start",
    MessageEnd: "message_end",
    Ping: "ping",
  };

  // Find the event type key
  for (const [key, value] of Object.entries(eventObj)) {
    if (typeMapping[key]) {
      const parsed: ParsedEvent = { type: typeMapping[key] };
      if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        // Extract common fields
        if ("text" in obj) parsed.text = obj.text as string;
        if ("content" in obj) parsed.content = obj.content as string;
        if ("thinking" in obj) parsed.thinking = obj.thinking as boolean;
        if ("turn_id" in obj) parsed.turnId = obj.turn_id as string;
        if ("result" in obj) parsed.result = obj.result;
        if ("error" in obj) parsed.error = obj.error as string;
        if ("tool_name" in obj || "toolName" in obj) {
          parsed.toolName = (obj.tool_name || obj.toolName) as string;
        }
        if ("status" in obj) parsed.status = obj.status as string;
        if ("output" in obj) parsed.output = obj.output as string;
        if ("data" in obj) parsed.data = obj.data;
      }
      return parsed;
    }
  }

  return { type: "unknown" };
}

// ============================================================================
// Types
// ============================================================================

interface ChatViewProps {
  sessionId: string;
  onSendMessage?: (message: string) => void;
  onSpawnRemoteSession?: (
    agentType: AgentType,
    projectPath: string,
    args: string[],
  ) => void;
  agentType?: AgentType;
  projectPath?: string;
  sessionMode?: "remote" | "local"; // Added session mode
}

// ============================================================================
// Helper Components
// ============================================================================

function MessageBubble(props: { message: ChatMessage }) {
  const [, , write] = createClipboard();
  const [copied, setCopied] = createSignal(false);

  const isUser = () => props.message.role === "user";
  const isSystem = () => props.message.role === "system";
  const bubbleClass = () => {
    if (isUser())
      return "bg-gradient-to-br from-primary to-primary/90 text-primary-foreground border-primary/20 shadow-lg shadow-primary/10";
    if (isSystem())
      return "bg-gradient-to-br from-muted to-muted/50 text-muted-foreground border-border/50";
    return "bg-gradient-to-br from-muted/80 to-muted/40 text-foreground border-border/30";
  };

  const handleCopy = () => {
    write(props.message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      class={`flex flex-col gap-1 animate-fade-in ${isUser() ? "items-end" : "items-start"} group/bubble transition-all duration-300`}
    >
      <div class="flex items-center gap-2 text-xs text-muted-foreground/50 px-1">
        <Show when={isUser()}>
          <div class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20">
            <FiUser size={16} />
          </div>
        </Show>
        <Show when={!isUser() && !isSystem()}>
          <div class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-secondary to-secondary/80 text-secondary-foreground shadow-md">
            <FiTerminal size={16} />
          </div>
        </Show>
        <Show when={isSystem()}>
          <div class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-muted to-muted/80 text-muted-foreground">
            <FiTerminal size={16} />
          </div>
        </Show>
        <time class="opacity-60">
          {new Date(props.message.timestamp || Date.now()).toLocaleTimeString()}
        </time>
        <Show when={!isSystem()}>
          <button
            type="button"
            onClick={handleCopy}
            class="ml-1 p-1 rounded-md hover:bg-muted opacity-0 group-hover/bubble:opacity-100 transition-opacity inline-flex items-center justify-center"
            title="Copy message"
          >
            <Show when={copied()} fallback={<FiCopy size={14} />}>
              <FiCheck size={16} />
            </Show>
          </button>
        </Show>
      </div>
      <div
        class={`max-w-[92vw] rounded-2xl border px-4 py-3 shadow-sm ${bubbleClass()}`}
      >
        <div class="prose prose-sm wrap-break-words text-sm max-w-none">
          <SolidMarkdown children={props.message.content} />
        </div>
        <Show
          when={props.message.toolCalls && props.message.toolCalls.length > 0}
        >
          <ToolCallList toolCalls={props.message.toolCalls!} />
        </Show>
        <Show when={props.message.thinking}>
          <ReasoningBlock thinking="Thinking..." isStreaming={true} />
        </Show>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ChatView(props: ChatViewProps) {
  {
    const session = () => sessionStore.getSession(props.sessionId);
    const isActive = () => session()?.active !== false;

    const messages = () => chatStore.getMessages(props.sessionId);
    const pendingPermissions = () =>
      chatStore.getPendingPermissions(props.sessionId);

    const [inputValue, setInputValue] = createSignal("");
    const [messagesEnd, setMessagesEnd] = createSignal<HTMLDivElement | null>(
      null,
    );
    const [scrollEl, setScrollEl] = createSignal<HTMLElement>();
    const [isScrolledToBottom, setIsScrolledToBottom] = createSignal(true);
    const [isStreaming, setIsStreaming] = createSignal(false);
    const [permissionMode, setPermissionMode] = createSignal<
      "AlwaysAsk" | "AcceptEdits" | "Plan" | "AutoApprove"
    >("AlwaysAsk");
    const toolMessageIds = new Map<string, string>();
    const pendingPermissionsForModal = () =>
      pendingPermissions().map((permission) => ({
        request_id: permission.id,
        session_id: permission.sessionId,
        tool_name: permission.toolName,
        tool_params: permission.toolParams,
        message: permission.description,
        created_at: Math.floor(permission.requestedAt / 1000),
      }));

    // Track scroll position using solid-primitives hook
    const scrollPos = createScrollPosition(scrollEl);

    createEffect(() => {
      const el = scrollEl();
      if (el) {
        const isAtBottom =
          el.scrollHeight - scrollPos.y - el.clientHeight < 100;
        if (isAtBottom !== isScrolledToBottom()) {
          setIsScrolledToBottom(isAtBottom);
        }
      }
    });

    // Auto-scroll to bottom when new messages arrive
    createEffect(() => {
      messages();
      pendingPermissions();

      if (isScrolledToBottom()) {
        scrollToBottom();
      }
    });

    // Listen for incoming agent messages from backend
    onMount(() => {
      // Listen for local agent events
      const unlistenLocalPromise = listen<Record<string, unknown>>(
        "local-agent-event",
        (event) => {
          console.log("[ChatView] Received local-agent-event:", event.payload);
          try {
            const data = event.payload as {
              sessionId: string;
              turnId: string;
              event: Record<string, unknown>;
            };
            if (data.sessionId === props.sessionId) {
              // Parse event using helper that handles both Rust and frontend formats
              const parsed = parseEvent(data.event);
              const eventType = parsed.type;
              const content = parsed.content || parsed.text || "";
              const thinking = parsed.thinking || false;

              // Handle different event types from local agent
              switch (eventType) {
                case "text_delta": {
                  const deltaContent = content || "";
                  // Update or create message
                  const currentMessages = messages();
                  const lastMessage =
                    currentMessages[currentMessages.length - 1];

                  if (lastMessage?.role === "assistant") {
                    chatStore.updateMessage(props.sessionId, lastMessage.id, {
                      content: lastMessage.content + deltaContent,
                      thinking,
                      timestamp: Date.now(),
                    });
                  } else {
                    chatStore.addMessage(props.sessionId, {
                      role: "assistant",
                      content: deltaContent,
                      thinking,
                    });
                  }
                  setIsStreaming(true);
                  break;
                }

                case "turn_started":
                  setIsStreaming(true);
                  break;

                case "turn_completed": {
                  setIsStreaming(false);
                  const currentMessages2 = messages();
                  const lastMessage2 =
                    currentMessages2[currentMessages2.length - 1];
                  if (
                    lastMessage2?.role === "assistant" &&
                    lastMessage2.thinking
                  ) {
                    chatStore.updateMessage(props.sessionId, lastMessage2.id, {
                      thinking: false,
                    });
                  }
                  break;
                }

                case "turn_error": {
                  setIsStreaming(false);
                  const error = parsed.error || "Unknown error";
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `Error: ${error}`,
                  });
                  break;
                }

                case "reasoning_delta": {
                  const reasoningContent = content || "";
                  // Append to current message or create new one
                  const reasonMessages = messages();
                  const lastReasonMsg =
                    reasonMessages[reasonMessages.length - 1];

                  if (lastReasonMsg?.role === "assistant") {
                    // Append thinking indicator text
                    chatStore.updateMessage(props.sessionId, lastReasonMsg.id, {
                      content: lastReasonMsg.content + reasoningContent,
                      thinking: true,
                      timestamp: Date.now(),
                    });
                  } else {
                    // New message with thinking
                    chatStore.addMessage(props.sessionId, {
                      role: "assistant",
                      content: reasoningContent,
                      thinking: true,
                    });
                  }
                  setIsStreaming(true);
                  break;
                }

                case "tool_started": {
                  const toolId = parsed.toolId;
                  const toolName = parsed.toolName || "unknown";
                  const toolInput = parsed.input;
                  const inputStr = toolInput ? JSON.stringify(toolInput) : "";
                  const content = `[Tool: ${toolName} started]${inputStr ? `\nInput: ${inputStr}` : ""}`;
                  if (toolId) {
                    upsertToolMessage(toolId, content);
                  } else {
                    chatStore.addMessage(props.sessionId, {
                      role: "system",
                      content,
                    });
                  }
                  break;
                }

                case "tool_inputUpdated": {
                  const toolId = parsed.toolId;
                  const updateToolName = parsed.toolName || "unknown";
                  const updatedInput = parsed.input;
                  const updateStr = updatedInput
                    ? JSON.stringify(updatedInput)
                    : "";
                  const content = `[Tool: ${updateToolName} input updated]${updateStr ? `\n${updateStr}` : ""}`;
                  if (toolId) {
                    upsertToolMessage(toolId, content);
                  } else {
                    chatStore.addMessage(props.sessionId, {
                      role: "system",
                      content,
                    });
                  }
                  break;
                }

                case "tool_completed": {
                  const toolId = parsed.toolId;
                  const compToolName = parsed.toolName || "unknown";
                  const compOutput = parsed.output;
                  const compError = parsed.error;
                  const outputStr = compOutput
                    ? typeof compOutput === "string"
                      ? compOutput
                      : JSON.stringify(compOutput, null, 2)
                    : "";
                  if (compError) {
                    const content = `[Tool: ${compToolName} failed]\nError: ${compError}`;
                    if (toolId) {
                      upsertToolMessage(toolId, content);
                      toolMessageIds.delete(toolId);
                    } else {
                      chatStore.addMessage(props.sessionId, {
                        role: "system",
                        content,
                      });
                    }
                  } else {
                    const content = `[Tool: ${compToolName} completed]${outputStr ? `\n${outputStr}` : ""}`;
                    if (toolId) {
                      upsertToolMessage(toolId, content);
                      toolMessageIds.delete(toolId);
                    } else {
                      chatStore.addMessage(props.sessionId, {
                        role: "system",
                        content,
                      });
                    }
                  }
                  break;
                }

                case "approval_request": {
                  const permToolName = parsed.toolName || "unknown";
                  const permMessage =
                    parsed.message || `Permission request for ${permToolName}`;
                  const permInput = parsed.input;
                  const permRequestDesc = `${permMessage}${permInput ? `\nInput: ${JSON.stringify(permInput)}` : ""}`;
                  chatStore.addPermissionRequest(props.sessionId, {
                    sessionId: props.sessionId,
                    id: parsed.requestId,
                    toolName: permToolName,
                    toolParams: permInput as Record<string, unknown>,
                    description: permRequestDesc,
                    requestedAt:
                      typeof parsed.createdAt === "number"
                        ? parsed.createdAt * 1000
                        : undefined,
                  });
                  setIsStreaming(false);
                  break;
                }

                case "tool_call": {
                  const legacyToolName = parsed.toolName || "unknown";
                  const legacyStatus = parsed.status || "started";
                  const legacyToolOutput = parsed.output as string | undefined;
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `[Tool: ${legacyToolName}] Status: ${legacyStatus}${legacyToolOutput ? `\n${legacyToolOutput}` : ""}`,
                  });
                  break;
                }

                case "session_started": {
                  const agentName = parsed.agent || "Agent";
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `[Session started: ${agentName}]`,
                  });
                  break;
                }

                case "session_ended":
                  setIsStreaming(false);
                  break;

                case "usage_update": {
                  const inputTokens = parsed.inputTokens;
                  const outputTokens = parsed.outputTokens;
                  const modelUsage = parsed.modelUsage;
                  if (inputTokens || outputTokens || modelUsage) {
                    const usageParts: string[] = [];
                    if (modelUsage) usageParts.push(`Model: ${modelUsage}`);
                    if (inputTokens !== undefined)
                      usageParts.push(`Input tokens: ${inputTokens}`);
                    if (outputTokens !== undefined)
                      usageParts.push(`Output tokens: ${outputTokens}`);
                    chatStore.addMessage(props.sessionId, {
                      role: "system",
                      content: `[Token Usage] ${usageParts.join(" | ")}`,
                    });
                  }
                  break;
                }

                case "progress_update": {
                  const progress = parsed.progress || 0;
                  const progressMsg = parsed.message || "";
                  const operation = parsed.operation || "Operation";
                  const progressPercent = Math.round(progress * 100);
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `[Progress] ${operation}: ${progressPercent}%${progressMsg ? ` - ${progressMsg}` : ""}`,
                  });
                  break;
                }

                case "notification": {
                  const notifLevel = parsed.level || "Info";
                  const notifMessage = parsed.message || "";
                  if (notifMessage) {
                    chatStore.addMessage(props.sessionId, {
                      role: "system",
                      content: `[${notifLevel}] ${notifMessage}`,
                    });
                  }
                  break;
                }

                case "file_operation": {
                  const fileOp = parsed.operation || "unknown";
                  const filePath = parsed.path || "";
                  const fileStatus = parsed.status || "";
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `[File: ${fileOp} ${filePath}]${fileStatus ? ` - ${fileStatus}` : ""}`,
                  });
                  break;
                }

                case "terminal_output": {
                  const termCmd = parsed.command || "";
                  const termOutput = (parsed.output as string) || "";
                  const termExitCode = parsed.exitCode;
                  if (termCmd) {
                    if (termExitCode === 0) {
                      chatStore.addMessage(props.sessionId, {
                        role: "system",
                        content: `[Command completed: ${termCmd}]\n${termOutput}`,
                      });
                    } else if (termExitCode && termExitCode > 0) {
                      chatStore.addMessage(props.sessionId, {
                        role: "system",
                        content: `[Command failed (exit ${termExitCode}): ${termCmd}]\n${termOutput}`,
                      });
                    } else {
                      chatStore.addMessage(props.sessionId, {
                        role: "system",
                        content: `[Command output: ${termCmd}]\n${termOutput}`,
                      });
                    }
                  }
                  break;
                }

                default:
                  console.log(
                    "[ChatView] Unknown local agent event:",
                    eventType,
                    parsed,
                  );
              }
            }
          } catch (e) {
            console.error("Failed to handle local agent event:", e);
          }
        },
      );

      // Listen for remote agent events from CLI
      const unlistenPromise = listen<Record<string, unknown>>(
        "agent-message",
        (event) => {
          console.log(
            "[ChatView] Received agent-message event:",
            event.payload,
          );
          try {
            const data = event.payload;
            if (data.sessionId === props.sessionId) {
              if (data.type === "text_delta") {
                const content = (data.content as string) || "";
                const thinking = (data.thinking as boolean) || false;

                // Ensure we show streaming state during response
                setIsStreaming(true);

                const currentMessages = messages();
                const lastMessage = currentMessages[currentMessages.length - 1];

                // Update existing message if it's an assistant message
                if (lastMessage?.role === "assistant") {
                  chatStore.updateMessage(props.sessionId, lastMessage.id, {
                    content: lastMessage.content + content,
                    thinking,
                    timestamp: Date.now(),
                  });
                } else {
                  // New message
                  chatStore.addMessage(props.sessionId, {
                    role: "assistant",
                    content,
                    thinking,
                  });
                }
              } else if (data.type === "response") {
                // Full response - replace existing message or create new one
                const content = (data.content as string) || "";
                const thinking = (data.thinking as boolean) || false;
                const messageId = data.messageId as string | undefined;

                setIsStreaming(true);

                const currentMessages = messages();
                const lastMessage = currentMessages[currentMessages.length - 1];

                // Update existing message if matching ID or streaming chunk (assistant role)
                if (
                  (messageId && lastMessage?.messageId === messageId) ||
                  (!messageId && lastMessage?.role === "assistant")
                ) {
                  chatStore.updateMessage(props.sessionId, lastMessage.id, {
                    content: content, // Replace content instead of appending
                    thinking,
                    timestamp: Date.now(),
                  });
                } else {
                  // New message
                  chatStore.addMessage(props.sessionId, {
                    role: "assistant",
                    content,
                    thinking,
                    messageId,
                  });
                }
              } else if (data.type === "permission_request") {
                chatStore.addPermissionRequest(props.sessionId, {
                  sessionId: props.sessionId,
                  id: data.requestId as string | undefined,
                  toolName: data.toolName as string,
                  toolParams: data.toolParams as Record<string, unknown>,
                  description:
                    (data.description as string) ||
                    `Permission request for ${data.toolName}`,
                  requestedAt:
                    typeof data.requestedAt === "number"
                      ? data.requestedAt * 1000
                      : undefined,
                });
                setIsStreaming(false); // Pause streaming on permission request
              } else if (data.type === "tool_call") {
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Tool: ${data.toolName}] Status: ${data.status}${data.output ? `\n${data.output}` : ""}`,
                });
              } else if (data.type === "notification") {
                const level = data.level as string;
                const message = data.message as string;
                if (level === "Info" && (!message || !message.trim())) return;
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[${level}] ${message}`,
                });
              } else if (data.type === "turn_started") {
                setIsStreaming(true);
              } else if (data.type === "turn_completed") {
                setIsStreaming(false);
                // Ensure the last message is not thinking
                const currentMessages = messages();
                const lastMessage = currentMessages[currentMessages.length - 1];
                if (lastMessage?.role === "assistant" && lastMessage.thinking) {
                  chatStore.updateMessage(props.sessionId, lastMessage.id, {
                    thinking: false,
                  });
                }
              } else if (data.type === "turn_error") {
                setIsStreaming(false);
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `Error: ${data.error}`,
                });
              }
            }
          } catch (e) {
            console.error("Failed to handle agent message:", e);
          }
        },
      );

      onCleanup(() => {
        // Cleanup local agent event listener
        unlistenLocalPromise.then((fn) => fn());
        // Cleanup remote agent event listener
        unlistenPromise.then((fn) => fn());
      });
    });

    // Load pending permissions for local sessions (restore after reload)
    createEffect(() => {
      if (!props.sessionId || props.sessionMode !== "local") return;

      invoke<
        Array<{
          request_id: string;
          tool_name: string;
          tool_params: unknown;
          message?: string | null;
          created_at: number;
        }>
      >("local_get_pending_permissions", { sessionId: props.sessionId })
        .then((pending) => {
          const permissions = pending.map((entry) => ({
            id: entry.request_id,
            sessionId: props.sessionId,
            toolName: entry.tool_name,
            toolParams: entry.tool_params,
            description:
              entry.message ||
              `Permission request for ${entry.tool_name || "tool"}`,
            requestedAt: entry.created_at * 1000,
            status: "pending" as const,
          }));
          const existing = chatStore.getPendingPermissions(props.sessionId);
          if (permissions.length > 0 || existing.length === 0) {
            chatStore.setPendingPermissions(props.sessionId, permissions);
          }
          if (permissions.length > 0) {
            setIsStreaming(false);
          }
        })
        .catch((error) => {
          console.error("Failed to load pending permissions:", error);
        });
    });

    // Load permission mode from backend
    createEffect(() => {
      if (!props.sessionId) return;

      const controlSessionId =
        props.sessionMode === "remote"
          ? sessionStore.getSession(props.sessionId)?.controlSessionId
          : undefined;

      invoke<string>("get_permission_mode", {
        sessionId: props.sessionId,
        controlSessionId,
      })
        .then((mode) => {
          if (
            mode === "AlwaysAsk" ||
            mode === "AcceptEdits" ||
            mode === "Plan" ||
            mode === "AutoApprove"
          ) {
            setPermissionMode(mode);
          }
        })
        .catch((error) => {
          console.error("Failed to load permission mode:", error);
        });
    });

    const scrollToBottom = () => {
      messagesEnd()?.scrollIntoView({ behavior: "smooth" });
    };

    // Handle file attachments from ChatInput
    const handleAttachFiles = (files: File[]) => {
      const sessionId = props.sessionId;
      if (!sessionId) return;

      for (const file of files) {
        chatStore.addAttachment(sessionId, {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          path: (file as File & { path?: string }).path,
        });
      }
    };

    const handleSend = async () => {
      const sessionId = props.sessionId;
      console.log(
        "[handleSend] sessionId:",
        sessionId,
        "sessionMode:",
        props.sessionMode,
      );

      const content = inputValue().trim();
      if (!content && !chatStore.getAttachments(sessionId).length) return;
      if (!sessionId) {
        console.error("[handleSend] sessionId is undefined!");
        notificationStore.error("No active session", "Error");
        return;
      }

      setInputValue("");
      setIsStreaming(true);

      // Get attachments before clearing
      const attachments = chatStore.getAttachments(sessionId);
      const attachmentPaths = attachments
        .map((a) => a.path)
        .filter(Boolean) as string[];

      // Clear attachments after getting them
      chatStore.clearAttachments(sessionId);

      // Reset textarea height
      const textarea = document.querySelector<HTMLTextAreaElement>(
        "textarea[aria-label='Chat input']",
      );
      if (textarea) textarea.style.height = "auto";

      if (content.startsWith("/")) {
        try {
          await invoke("send_slash_command", {
            sessionId,
            command: content,
          });
          chatStore.addMessage(sessionId, {
            role: "system",
            content: `Command sent: ${content}`,
          });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Failed to send command";
          notificationStore.error(errorMsg, "Command Error");
          chatStore.addMessage(sessionId, {
            role: "system",
            content: `Error: ${errorMsg}`,
          });
          setIsStreaming(false);
        }
      } else {
        // Check session mode and call appropriate backend command
        if (props.sessionMode === "local") {
          // Local agent - add user message to store before sending
          console.log(
            "[ChatView] Sending to local agent:",
            sessionId,
            content.substring(0, 50),
          );
          chatStore.addMessage(sessionId, {
            role: "user",
            content,
          });
          try {
            // On mobile, use mobile-specific command
            if (isMobile()) {
              await invoke("mobile_send_agent_message", {
                sessionId,
                content,
                attachments: attachmentPaths,
              });
            } else {
              await invoke("local_send_agent_message", {
                sessionId,
                content,
                attachments: attachmentPaths,
              });
            }
            console.log("[ChatView] Message sent successfully");
          } catch (error) {
            console.error("[ChatView] Failed to send message:", error);
            const errorMsg =
              error instanceof Error
                ? error.message
                : "Failed to send message to local agent";
            notificationStore.error(errorMsg, "Local Agent Error");
            chatStore.addMessage(sessionId, {
              role: "system",
              content: `Error: ${errorMsg}`,
            });
            setIsStreaming(false);
          }
        } else {
          // Remote agent - add user message to store
          console.log(
            "[ChatView] Sending to remote agent:",
            sessionId,
            content.substring(0, 50),
          );
          chatStore.addMessage(sessionId, {
            role: "user",
            content,
          });
          try {
            const controlSessionId =
              sessionStore.getSession(sessionId)?.controlSessionId;
            await invoke("send_agent_message", {
              sessionId,
              content,
              controlSessionId,
              attachments: attachmentPaths,
            });
            console.log("[ChatView] Remote message sent successfully");
          } catch (error) {
            console.error("[ChatView] Failed to send remote message:", error);
            const errorMsg =
              error instanceof Error
                ? error.message
                : "Failed to send message to remote agent";
            notificationStore.error(errorMsg, "Remote Agent Error");
            chatStore.addMessage(sessionId, {
              role: "system",
              content: `Error: ${errorMsg}`,
            });
            setIsStreaming(false);
          }
        }
        props.onSendMessage?.(content);
      }
    };

    const handleAbort = async () => {
      try {
        if (props.sessionMode === "local") {
          await invoke("local_abort_agent_action", {
            sessionId: props.sessionId,
          });
        } else {
          const controlSessionId = sessionStore.getSession(
            props.sessionId,
          )?.controlSessionId;
          await invoke("abort_agent_action", {
            sessionId: props.sessionId,
            controlSessionId,
          });
        }
        setIsStreaming(false);
        notificationStore.success("Action aborted", "System");
        chatStore.addMessage(props.sessionId, {
          role: "system",
          content: "User aborted the action.",
        });
      } catch (error) {
        console.error("Failed to abort:", error);
        notificationStore.error("Failed to abort action", "System");
      }
    };

    const handlePermissionResponse = async (
      permissionId: string,
      response: "approved" | "denied" | "approved_for_session",
    ) => {
      chatStore.respondToPermission(props.sessionId, permissionId, response);
      chatStore.clearPermission(props.sessionId, permissionId);

      try {
        if (props.sessionMode === "local") {
          await invoke("local_respond_to_agent_permission", {
            sessionId: props.sessionId,
            permissionId,
            approved: response !== "denied",
            approveForSession: response === "approved_for_session",
          });
        } else {
          const controlSessionId = sessionStore.getSession(
            props.sessionId,
          )?.controlSessionId;
          await invoke("respond_to_agent_permission", {
            sessionId: props.sessionId,
            permissionId,
            approved: response !== "denied",
            approveForSession: response === "approved_for_session",
            controlSessionId,
          });
        }
      } catch (error) {
        console.error("Failed to respond to permission:", error);
        notificationStore.error("Failed to send permission response", "Error");
      }

      // Resume streaming if approved?
      // Backend should handle resumption upon receiving permission response
      if (response !== "denied") {
        setIsStreaming(true);
      }
    };

    const handleOpenSpawnModal = () => {
      const s = session();
      if (s?.mode === "remote") {
        // Open modal in remote mode with current connection selected
        const controlId = s.controlSessionId || s.sessionId;
        sessionStore.openNewSessionModal("remote", controlId);
      } else {
        // Open modal in local mode
        sessionStore.openNewSessionModal("local");
      }
    };

    const upsertToolMessage = (toolId: string, content: string) => {
      const existingId = toolMessageIds.get(toolId);
      if (existingId) {
        chatStore.updateMessage(props.sessionId, existingId, {
          content,
          timestamp: Date.now(),
        });
        return;
      }

      chatStore.addMessage(props.sessionId, {
        role: "system",
        content,
      });
      const messages = chatStore.getMessages(props.sessionId);
      const last = messages[messages.length - 1];
      if (last) {
        toolMessageIds.set(toolId, last.id);
      }
    };

    const handlePermissionModeChange = async (
      mode: "AlwaysAsk" | "AcceptEdits" | "Plan" | "AutoApprove",
    ) => {
      setPermissionMode(mode);
      try {
        if (props.sessionMode === "local") {
          await invoke("set_permission_mode", {
            sessionId: props.sessionId,
            mode,
          });
        } else {
          const controlSessionId = sessionStore.getSession(
            props.sessionId,
          )?.controlSessionId;
          await invoke("set_permission_mode", {
            sessionId: props.sessionId,
            mode,
            controlSessionId,
          });
        }
      } catch (error) {
        console.error("Failed to set permission mode:", error);
        notificationStore.error("Failed to set permission mode", "Error");
      }
    };

    const getAgentIcon = () => {
      const normalizedType = props.agentType?.toLowerCase() || "";

      // Map agent types to local SVG icons in public folder
      const iconPaths: Record<string, string> = {
        claude: "/claude-ai.svg",
        claudecode: "/claude-ai.svg",
        "claude-code": "/claude-ai.svg",
        codex: "/openai-light.svg",
        opencode: "/opencode-wordmark-dark.svg",
        open: "/openai-light.svg",
        openai: "/openai-light.svg",
        gemini: "/google-gemini.svg",
        "gemini-cli": "/google-gemini.svg",
        openclaw: "/openclaw.svg",
        "open-claw": "/openclaw.svg",
      };

      const iconPath = iconPaths[normalizedType];

      if (iconPath) {
        return <img src={iconPath} alt={normalizedType} class="w-6 h-6" />;
      }

      // Fallback
      return <span class="text-2xl">🤖</span>;
    };

    return (
      <div class="flex flex-col h-full bg-muted relative pb-safe lg:pb-0">
        {/* Header */}
        <div class="z-20 flex items-center justify-between border-b border-border/60 bg-background/80 backdrop-blur-sm pr-4 pl-16 lg:pl-6 py-3 shadow-sm">
          <div class="flex-1">
            <div class="flex items-center gap-3">
              <div class="text-primary p-1.5 rounded-lg bg-primary/10 shrink-0">
                {getAgentIcon()}
              </div>
              <div>
                <h2 class="text-base font-semibold tracking-tight">
                  {props.agentType === "claude" && "Claude Agent"}
                  {props.agentType === "codex" && "Codex"}
                  {props.agentType === "opencode" && "OpenCode"}
                  {props.agentType === "gemini" && "Gemini"}
                  {props.agentType === "openclaw" && "OpenClaw"}
                </h2>
                <div
                  class="text-xs text-muted-foreground/50 truncate max-w-[20rem] flex items-center gap-1.5"
                  title={props.projectPath}
                >
                  <span class="inline-flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-green-500/80" />
                    Active
                  </span>
                  <span class="text-muted-foreground/30">•</span>
                  <span class="truncate max-w-full">
                    {props.projectPath?.split("/").pop() || "No project"}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <select
              class="select select-xs h-8 bg-background/60 border-border/50"
              value={permissionMode()}
              onChange={(e) =>
                handlePermissionModeChange(
                  e.currentTarget.value as
                    | "AlwaysAsk"
                    | "AcceptEdits"
                    | "Plan"
                    | "AutoApprove",
                )
              }
              title="Permission mode"
            >
              <option value="AlwaysAsk">Always ask</option>
              <option value="AcceptEdits">Accept edits</option>
              <option value="Plan">Plan (read-only)</option>
              <option value="AutoApprove">Auto approve</option>
            </select>
            <Button
              type="button"
              onClick={handleOpenSpawnModal}
              variant="ghost"
              size="icon"
              class="h-9 w-9 hover:bg-primary/10 hover:text-primary"
            >
              <FiPlus size={18} />
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <div
          ref={setScrollEl}
          class="flex-1 overflow-y-auto px-4 py-6 scroll-smooth overflow-x-hidden"
        >
          <Show
            when={messages().length === 0 && pendingPermissions().length === 0}
          >
            <div class="flex flex-col items-center text-center p- justify-center h-full8">
              <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-5 shadow-lg shadow-primary/10">
                <div class="text-4xl">{getAgentIcon()}</div>
              </div>
              <h3 class="text-xl font-semibold mb-2 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Ready to assist
              </h3>
              <p class="max-w-xs mx-auto text-sm text-muted-foreground/70">
                I can help you write code, explain concepts, or debug issues.
                Just ask!
              </p>
              {/* Quick actions */}
              <div class="flex items-center gap-2 mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  class="text-xs"
                  onClick={() => {
                    const session = sessionStore.getSession(props.sessionId);
                    if (session?.projectPath) {
                      setInputValue(`List files in ${session.projectPath}`);
                    }
                  }}
                >
                  List files
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="text-xs"
                  onClick={() => {
                    setInputValue("Explain what you can do");
                  }}
                >
                  What can you do?
                </Button>
              </div>
            </div>
          </Show>

          <Dialog
            open={pendingPermissionsForModal().length > 0}
            onClose={() => undefined}
            contentClass="max-w-xl"
          >
            <h3 class="font-bold text-lg flex items-center gap-2">
              <FiAlertTriangle size={18} />
              Permission Required
            </h3>
            <div class="mt-4">
              <PermissionList
                permissions={pendingPermissionsForModal()}
                disabled={!isActive()}
                permissionMode={permissionMode()}
                onApprove={(requestId, decision) => {
                  const response =
                    decision === "ApprovedForSession"
                      ? "approved_for_session"
                      : "approved";
                  handlePermissionResponse(requestId, response);
                }}
                onDeny={(requestId) => {
                  handlePermissionResponse(requestId, "denied");
                }}
              />
            </div>
          </Dialog>

          {/* Messages */}
          <div class="space-y-6 mb-4">
            <TransitionGroup name="message">
              <For each={messages()}>
                {(message) => <MessageBubble message={message} />}
              </For>
            </TransitionGroup>
          </div>

          <div ref={setMessagesEnd} />
        </div>

        <style>
          {`
        .message-enter {
          opacity: 0;
          transform: translateY(10px);
        }
        .message-enter-active {
          transition: opacity 300ms ease-out, transform 300ms ease-out;
        }
        .message-exit {
          opacity: 1;
        }
        .message-exit-active {
          opacity: 0;
          transition: opacity 300ms ease-in;
          position: absolute;
        }
      `}
        </style>

        {/* Scroll to bottom button */}
        <Show when={!isScrolledToBottom() && messages().length > 0}>
          <Button
            type="button"
            onClick={scrollToBottom}
            class="fixed bottom-24 right-6 z-10 h-8 w-8 bg-background shadow-lg"
            size="icon"
            variant="ghost"
            aria-label="Scroll to bottom"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <title>Scroll to bottom</title>
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 14l-7 7m0 0l-7-7m7 7V3"
              />
            </svg>
          </Button>
        </Show>

        {/* Input Area */}
        <Show
          when={isActive()}
          fallback={
            <div class="flex items-center justify-center p-4 bg-muted/50 rounded-lg border border-dashed border-border">
              <span class="text-sm text-muted-foreground/50 flex items-center gap-2">
                <FiAlertTriangle size={16} />
                This session is inactive. Connection might be lost.
              </span>
            </div>
          }
        >
          <ChatInput
            value={inputValue()}
            onInput={setInputValue}
            onSubmit={handleSend}
            onInterrupt={handleAbort}
            onAttach={handleAttachFiles}
            attachments={chatStore.getAttachments(props.sessionId).map((a) => {
              const file = new File([], a.filename, { type: a.mimeType });
              (file as File & { path?: string; id?: string }).path = a.path;
              (file as File & { path?: string; id?: string }).id = a.id;
              return file;
            })}
            isStreaming={isStreaming()}
            disabled={!isActive()}
          />
        </Show>
      </div>
    );
  }
}

export default ChatView;
