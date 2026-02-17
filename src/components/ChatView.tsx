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
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { chatStore } from "../stores/chatStore";
import type { AgentType } from "../stores/sessionStore";
import { notificationStore } from "../stores/notificationStore";
import type { ChatMessage, PermissionRequest } from "../stores/chatStore";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Input,
  Kbd,
  Select,
  Spinner,
} from "./ui/primitives";
import { MarkdownRenderer } from "solid-markdown-wasm";

// ============================================================================
// Helper Functions
// ============================================================================

interface ParsedEvent {
  type: string;
  // SDK protocol event types
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
 * 3. SDK protocol format: {type: "text:delta", sessionId: "...", text: "..."}
 */
function parseEvent(eventObj: Record<string, unknown>): ParsedEvent {
  // Check for inline/SKD format first (type: "text_delta" or "text:delta")
  if ("type" in eventObj) {
    const result: ParsedEvent = { type: eventObj.type as string };

    // Convert SDK protocol type names from kebab-case to camelCase
    const typeStr = result.type;
    if (typeStr.includes(":")) {
      // SDK protocol: "text:delta" -> "text_delta"
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
  onPermissionResponse?: (
    permissionId: string,
    response: "approved" | "denied" | "approved_for_session",
  ) => void;
  onSpawnRemoteSession?: (
    agentType: AgentType,
    projectPath: string,
    args: string[],
  ) => void;
  agentType?: AgentType;
  sessionMode?: "remote" | "local"; // Added session mode
}

// ============================================================================
// Icons
// ============================================================================

const UserIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>User</title>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

const BotIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Bot</title>
    <rect x="3" y="11" width="18" height="10" rx="2"></rect>
    <circle cx="12" cy="5" r="2"></circle>
    <path d="M12 7v4"></path>
    <line x1="8" y1="16" x2="8" y2="16"></line>
    <line x1="16" y1="16" x2="16" y2="16"></line>
  </svg>
);

const SendIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Send</title>
    <line x1="22" y1="2" x2="11" y2="13"></line>
    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
  </svg>
);

const StopIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Stop</title>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
  </svg>
);

const PlusIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Add</title>
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Approve</title>
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const XIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-5 h-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Deny</title>
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const WarningIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-6 h-6"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Warning</title>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
    <line x1="12" y1="9" x2="12" y2="13"></line>
    <line x1="12" y1="17" x2="12.01" y2="17"></line>
  </svg>
);

const ToolIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-3 h-3 mr-1"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <title>Tool</title>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
  </svg>
);

// ============================================================================
// Helper Components
// ============================================================================

function MessageBubble(props: { message: ChatMessage }) {
  const isUser = () => props.message.role === "user";
  const isSystem = () => props.message.role === "system";
  const bubbleClass = () => {
    if (isUser()) return "bg-primary text-primary-foreground border-primary";
    if (isSystem()) return "bg-foreground text-background border-foreground";
    return "bg-secondary text-secondary-foreground border-secondary";
  };

  return (
    <div
      class={`flex flex-col gap-1 ${isUser() ? "items-end" : "items-start"}`}
    >
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Show when={isUser()}>
          <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <UserIcon />
          </div>
        </Show>
        <Show when={!isUser() && !isSystem()}>
          <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <BotIcon />
          </div>
        </Show>
        <Show when={isSystem()}>
          <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
            <BotIcon />
          </div>
        </Show>
        <time class="opacity-70">
          {new Date(props.message.timestamp || Date.now()).toLocaleTimeString()}
        </time>
      </div>
      <div
        class={`max-w-[min(38rem,92vw)] rounded-xl border px-4 py-3 ${bubbleClass()}`}
      >
        <div class="prose prose-sm wrap-break-words text-sm max-w-none">
          <MarkdownRenderer markdown={props.message.content} />
        </div>
        <Show
          when={props.message.toolCalls && props.message.toolCalls.length > 0}
        >
          <div class="mt-2 flex flex-wrap gap-1">
            <For each={props.message.toolCalls}>
              {(tool) => (
                <Badge class="h-5 px-2 text-[10px]" variant="default">
                  <ToolIcon />
                  {tool.toolName}
                </Badge>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.message.thinking}>
          <span class="mt-2 inline-flex">
            <Spinner size="sm" />
          </span>
        </Show>
      </div>
    </div>
  );
}

function PermissionRequestCard(props: {
  permission: PermissionRequest;
  onApprove: () => void;
  onDeny: () => void;
  onApproveForSession: () => void;
}) {
  return (
    <Alert variant="warning" class="mx-4 max-w-2xl shadow-lg">
      <WarningIcon />
      <div class="flex-1">
        <h3 class="font-bold">Permission Request</h3>
        <div class="text-sm opacity-80">{props.permission.description}</div>
      </div>
      <div class="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          onClick={props.onApprove}
          variant="success"
          size="sm"
        >
          <CheckIcon />
          Approve Once
        </Button>
        <Button
          type="button"
          onClick={props.onApproveForSession}
          variant="primary"
          size="sm"
        >
          <CheckIcon />
          Approve Session
        </Button>
        <Button
          type="button"
          onClick={props.onDeny}
          variant="destructive"
          size="sm"
        >
          <XIcon />
          Deny
        </Button>
      </div>
    </Alert>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ChatView(props: ChatViewProps) {
  const messages = () => chatStore.getMessages(props.sessionId);
  const pendingPermissions = () =>
    chatStore.getPendingPermissions(props.sessionId);

  const [inputValue, setInputValue] = createSignal("");
  const [messagesEnd, setMessagesEnd] = createSignal<HTMLDivElement | null>(
    null,
  );
  const [isScrolledToBottom, setIsScrolledToBottom] = createSignal(true);
  const [isStreaming, setIsStreaming] = createSignal(false);

  // Remote spawn state
  const [showSpawnModal, setShowSpawnModal] = createSignal(false);
  const [spawnAgentType, setSpawnAgentType] = createSignal<AgentType>("claude");
  const [spawnProjectPath, setSpawnProjectPath] = createSignal("");
  const [spawnArgs, setSpawnArgs] = createSignal("");
  const [isSpawning, setIsSpawning] = createSignal(false);

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
              case "text_delta":
                const deltaContent = content || "";
                // Update or create message
                const currentMessages = messages();
                const lastMessage = currentMessages[currentMessages.length - 1];

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

              case "turn_started":
                setIsStreaming(true);
                break;

              case "turn_completed":
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

              case "turn_error":
                setIsStreaming(false);
                const error = parsed.error || "Unknown error";
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `Error: ${error}`,
                });
                break;

              case "reasoning_delta":
                const reasoningContent = content || "";
                // Append to current message or create new one
                const reasonMessages = messages();
                const lastReasonMsg = reasonMessages[reasonMessages.length - 1];

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

              case "tool_started":
                const toolName = parsed.toolName || "unknown";
                const toolInput = parsed.input;
                const inputStr = toolInput ? JSON.stringify(toolInput) : "";
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Tool: ${toolName} started]${inputStr ? `\nInput: ${inputStr}` : ""}`,
                });
                break;

              case "tool_inputUpdated":
                const updateToolName = parsed.toolName || "unknown";
                const updatedInput = parsed.input;
                const updateStr = updatedInput
                  ? JSON.stringify(updatedInput)
                  : "";
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Tool: ${updateToolName} input updated]${updateStr ? `\n${updateStr}` : ""}`,
                });
                break;

              case "tool_completed":
                const compToolName = parsed.toolName || "unknown";
                const compOutput = parsed.output;
                const compError = parsed.error;
                if (compError) {
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `[Tool: ${compToolName} failed]\nError: ${compError}`,
                  });
                } else {
                  const outputStr = compOutput
                    ? typeof compOutput === "string"
                      ? compOutput
                      : JSON.stringify(compOutput, null, 2)
                    : "";
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `[Tool: ${compToolName} completed]${outputStr ? `\n${outputStr}` : ""}`,
                  });
                }
                break;

              case "approval_request":
                const permToolName = parsed.toolName || "unknown";
                const permMessage =
                  parsed.message || `Permission request for ${permToolName}`;
                const permInput = parsed.input;
                const permRequestDesc = `${permMessage}${permInput ? `\nInput: ${JSON.stringify(permInput)}` : ""}`;
                chatStore.addPermissionRequest(props.sessionId, {
                  sessionId: props.sessionId,
                  toolName: permToolName,
                  toolParams: permInput as Record<string, unknown>,
                  description: permRequestDesc,
                });
                setIsStreaming(false);
                break;

              case "tool_call":
                const legacyToolName = parsed.toolName || "unknown";
                const legacyStatus = parsed.status || "started";
                const legacyToolOutput = parsed.output as string | undefined;
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Tool: ${legacyToolName}] Status: ${legacyStatus}${legacyToolOutput ? `\n${legacyToolOutput}` : ""}`,
                });
                break;

              case "session_started":
                const agentName = parsed.agent || "Agent";
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Session started: ${agentName}]`,
                });
                break;

              case "session_ended":
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Session ended]`,
                });
                break;

              case "usage_update":
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

              case "progress_update":
                const progress = parsed.progress || 0;
                const progressMsg = parsed.message || "";
                const operation = parsed.operation || "Operation";
                const progressPercent = Math.round(progress * 100);
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Progress] ${operation}: ${progressPercent}%${progressMsg ? ` - ${progressMsg}` : ""}`,
                });
                break;

              case "notification":
                const notifLevel = parsed.level || "Info";
                const notifMessage = parsed.message || "";
                if (notifMessage) {
                  chatStore.addMessage(props.sessionId, {
                    role: "system",
                    content: `[${notifLevel}] ${notifMessage}`,
                  });
                }
                break;

              case "file_operation":
                const fileOp = parsed.operation || "unknown";
                const filePath = parsed.path || "";
                const fileStatus = parsed.status || "";
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[File: ${fileOp} ${filePath}]${fileStatus ? ` - ${fileStatus}` : ""}`,
                });
                break;

              case "terminal_output":
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
        console.log("[ChatView] Received agent-message event:", event.payload);
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
                toolName: data.toolName as string,
                toolParams: data.toolParams as Record<string, unknown>,
                description:
                  (data.description as string) ||
                  `Permission request for ${data.toolName}`,
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

  const scrollToBottom = () => {
    messagesEnd()?.scrollIntoView({ behavior: "smooth" });
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
    if (!content) return;
    if (!sessionId) {
      console.error("[handleSend] sessionId is undefined!");
      notificationStore.error("No active session", "Error");
      return;
    }

    setInputValue("");
    setIsStreaming(true);

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
          await invoke("local_send_agent_message", {
            sessionId,
            content,
          });
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
        chatStore.addMessage(sessionId, {
          role: "user",
          content,
        });
      }
      props.onSendMessage?.(content);
    }
  };

  const handleAbort = async () => {
    try {
      await invoke("abort_agent_action", { sessionId: props.sessionId });
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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePermissionResponse = (
    permissionId: string,
    response: "approved" | "denied" | "approved_for_session",
  ) => {
    chatStore.respondToPermission(props.sessionId, permissionId, response);
    chatStore.clearPermission(props.sessionId, permissionId);
    props.onPermissionResponse?.(permissionId, response);

    // Resume streaming if approved?
    // Backend should handle resumption upon receiving permission response
    if (response !== "denied") {
      setIsStreaming(true);
    }
  };

  const handleSpawnSession = async () => {
    const projectPath = spawnProjectPath().trim();
    if (!projectPath) {
      notificationStore.error("Please enter a project path", "Spawn Session");
      return;
    }

    setIsSpawning(true);
    try {
      const args = spawnArgs().trim().split(/\s+/).filter(Boolean);
      props.onSpawnRemoteSession?.(spawnAgentType(), projectPath, args);
      notificationStore.success(
        `New ${spawnAgentType()} session created`,
        "Spawn Session",
      );
      setShowSpawnModal(false);
      setSpawnProjectPath("");
      setSpawnArgs("");
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to spawn session";
      notificationStore.error(errorMsg, "Spawn Session Error");
    } finally {
      setIsSpawning(false);
    }
  };

  const getAgentIcon = () => {
    switch (props.agentType) {
      case "opencode":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>Agent Icon</title>
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        );
      case "gemini":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>Agent Icon</title>
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"></path>
            <path d="M12 8v8"></path>
            <path d="M8 12h8"></path>
          </svg>
        );
      case "copilot":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>GitHub Copilot</title>
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
          </svg>
        );
      case "qwen":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>Qwen Code</title>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
        );
      case "zeroclaw":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>ZeroClaw</title>
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        );
      default:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <title>Agent Icon</title>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        );
    }
  };

  return (
    <div class="flex flex-col h-full bg-base-200 relative">
      {/* Header */}
      <div class="z-20 flex items-center justify-between border-b border-base-300 bg-base-100 pr-4 pl-16 py-4 shadow-sm">
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <div class="text-primary">{getAgentIcon()}</div>
            <div>
              <h2 class="text-lg font-semibold">
                {props.agentType === "claude" && "Claude Code"}
                {props.agentType === "codex" && "Codex"}
                {props.agentType === "opencode" && "OpenCode"}
                {props.agentType === "gemini" && "Gemini CLI"}
                {props.agentType === "copilot" && "GitHub Copilot"}
                {props.agentType === "qwen" && "Qwen Code"}
                {props.agentType === "zeroclaw" && "ZeroClaw"}
                {props.agentType === "custom" && "Custom Agent"}
              </h2>
              <div class="text-xs text-base-content/50">
                Session:{" "}
                {props.sessionId ? props.sessionId.slice(0, 8) : "unknown"}
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Show when={isStreaming()}>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              class="animate-pulse"
              onClick={handleAbort}
            >
              <StopIcon />
              <span class="hidden sm:inline">Stop</span>
            </Button>
          </Show>
          <Button
            type="button"
            onClick={() => setShowSpawnModal(true)}
            variant="ghost"
            size="icon"
            class="h-8 w-8"
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      {/* Messages Area */}
      <div
        class="flex-1 overflow-y-auto px-4 py-6 scroll-smooth"
        onScroll={(e) => {
          const target = e.target as HTMLElement;
          const isAtBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight < 100;
          setIsScrolledToBottom(isAtBottom);
        }}
      >
        <Show
          when={messages().length === 0 && pendingPermissions().length === 0}
        >
          <div class="flex flex-col items-center justify-center h-full text-center p-8 opacity-60">
            <div class="text-6xl mb-4 grayscale">💬</div>
            <h3 class="text-xl font-bold mb-2">Ready to assist</h3>
            <p class="max-w-xs mx-auto text-sm">
              I can help you write code, explain concepts, or debug issues. Just
              ask!
            </p>
          </div>
        </Show>

        {/* Permission Requests */}
        <For each={pendingPermissions()}>
          {(permission) => (
            <PermissionRequestCard
              permission={permission}
              onApprove={() =>
                handlePermissionResponse(permission.id, "approved")
              }
              onDeny={() => handlePermissionResponse(permission.id, "denied")}
              onApproveForSession={() =>
                handlePermissionResponse(permission.id, "approved_for_session")
              }
            />
          )}
        </For>

        {/* Messages */}
        <div class="space-y-6 mb-4">
          <For each={messages()}>
            {(message) => <MessageBubble message={message} />}
          </For>
        </div>

        <div ref={setMessagesEnd} />
      </div>

      {/* Scroll to bottom button */}
      <Show when={!isScrolledToBottom() && messages().length > 0}>
        <Button
          type="button"
          onClick={scrollToBottom}
          class="fixed bottom-24 right-6 z-10 h-8 w-8 bg-base-100 shadow-lg"
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
      <div class="p-4 bg-base-100 border-t border-base-300">
        <div class="flex w-full gap-2 shadow-sm items-end">
          <textarea
            value={inputValue()}
            onInput={(e) => {
              setInputValue(e.currentTarget.value);
              // Auto-resize
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height =
                Math.min(e.currentTarget.scrollHeight, 200) + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            class="textarea textarea-bordered flex-1 min-h-10 max-h-50 resize-none leading-normal"
            aria-label="Chat input"
            autofocus
            rows={1}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={!inputValue().trim() || isStreaming()}
            class="shrink-0"
            aria-label="Send message"
          >
            <Show when={!isStreaming()} fallback={<Spinner size="xs" />}>
              <SendIcon />
            </Show>
          </Button>
        </div>
        <div class="mt-2 flex justify-between px-1">
          <span class="text-xs text-base-content/40">Markdown supported</span>
          <span class="text-xs text-base-content/40">
            <Kbd>Shift+Enter</Kbd> new line, <Kbd>Enter</Kbd> to send
          </span>
        </div>
      </div>

      {/* Remote Spawn Modal */}
      <Show when={showSpawnModal()}>
        <Dialog
          open={showSpawnModal()}
          onClose={() => !isSpawning() && setShowSpawnModal(false)}
          contentClass="max-w-md"
        >
          <div>
            <h3 class="font-bold text-lg mb-4 flex items-center gap-2">
              <PlusIcon />
              Spawn New Remote Session
            </h3>

            <div class="mb-4 space-y-2">
              <label class="text-sm font-semibold" for="agent-type">
                Agent Type
              </label>
              <Select
                id="agent-type"
                value={spawnAgentType()}
                onInput={(e) =>
                  setSpawnAgentType(e.currentTarget.value as AgentType)
                }
              >
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="opencode">OpenCode</option>
                <option value="gemini">Gemini CLI</option>
                <option value="copilot">GitHub Copilot</option>
                <option value="qwen">Qwen Code</option>
                <option value="zeroclaw">ZeroClaw</option>
                <option value="custom">Custom</option>
              </Select>
            </div>

            <div class="mb-4 space-y-2">
              <label class="text-sm font-semibold" for="project-path">
                Project Path
              </label>
              <Input
                id="project-path"
                type="text"
                placeholder="/path/to/project"
                class="font-mono text-sm"
                value={spawnProjectPath()}
                onInput={(e) => setSpawnProjectPath(e.currentTarget.value)}
              />
            </div>

            <div class="mb-6 space-y-2">
              <label class="text-sm font-semibold" for="spawn-args">
                Additional Arguments
              </label>
              <Input
                id="spawn-args"
                type="text"
                placeholder="--arg1 value1"
                class="font-mono text-sm"
                value={spawnArgs()}
                onInput={(e) => setSpawnArgs(e.currentTarget.value)}
              />
            </div>

            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowSpawnModal(false)}
                disabled={isSpawning()}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSpawnSession}
                disabled={!spawnProjectPath().trim()}
                loading={isSpawning()}
              >
                Spawn Session
              </Button>
            </div>
          </div>
        </Dialog>
      </Show>
    </div>
  );
}

export default ChatView;
