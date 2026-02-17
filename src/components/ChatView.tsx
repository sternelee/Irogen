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
  FiSend,
  FiSquare,
  FiPlus,
  FiCheck,
  FiX,
  FiAlertTriangle,
  FiTool,
  FiCopy,
  FiCode,
  FiMessageSquare,
  FiActivity,
} from "solid-icons/fi";
import { SiGoogle, SiGithub } from "solid-icons/si";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { platform } from "@tauri-apps/plugin-os";
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
  Label,
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
    if (isUser()) return "bg-primary text-primary-foreground border-primary";
    if (isSystem()) return "bg-foreground text-background border-foreground";
    return "bg-secondary text-secondary-foreground border-secondary";
  };

  const handleCopy = () => {
    write(props.message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      class={`flex flex-col gap-1 ${isUser() ? "items-end" : "items-start"} group/bubble transition-all duration-300`}
    >
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Show when={isUser()}>
          <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <FiUser size={20} />
          </div>
        </Show>
        <Show when={!isUser() && !isSystem()}>
          <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <FiTerminal size={20} />
          </div>
        </Show>
        <Show when={isSystem()}>
          <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
            <FiTerminal size={20} />
          </div>
        </Show>
        <time class="opacity-70">
          {new Date(props.message.timestamp || Date.now()).toLocaleTimeString()}
        </time>
        <Show when={!isSystem()}>
          <button
            type="button"
            onClick={handleCopy}
            class="ml-1 p-1 rounded-md hover:bg-base-300 opacity-0 group-hover/bubble:opacity-100 transition-opacity inline-flex items-center justify-center"
            title="Copy message"
          >
            <Show when={copied()} fallback={<FiCopy size={14} />}>
              <FiCheck size={18} />
            </Show>
          </button>
        </Show>
      </div>
      <div
        class={`max-w-[min(38rem,92vw)] rounded-xl border px-4 py-3 shadow-sm ${bubbleClass()}`}
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
                  <FiTool class="mr-1" size={12} />
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
      <FiAlertTriangle size={24} />
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
          <FiCheck size={20} />
          Approve Once
        </Button>
        <Button
          type="button"
          onClick={props.onApproveForSession}
          variant="primary"
          size="sm"
        >
          <FiCheck size={20} />
          Approve Session
        </Button>
        <Button
          type="button"
          onClick={props.onDeny}
          variant="destructive"
          size="sm"
        >
          <FiX size={20} />
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
  const [scrollEl, setScrollEl] = createSignal<HTMLElement>();
  const [isScrolledToBottom, setIsScrolledToBottom] = createSignal(true);
  const [isStreaming, setIsStreaming] = createSignal(false);

  // Track scroll position using solid-primitives hook
  const scrollPos = createScrollPosition(scrollEl);

  createEffect(() => {
    const el = scrollEl();
    if (el) {
      const isAtBottom = el.scrollHeight - scrollPos.y - el.clientHeight < 100;
      if (isAtBottom !== isScrolledToBottom()) {
        setIsScrolledToBottom(isAtBottom);
      }
    }
  });

  // Remote spawn state
  const [showSpawnModal, setShowSpawnModal] = createSignal(false);
  const [spawnAgentType, setSpawnAgentType] = createSignal<AgentType>("claude");
  const [spawnProjectPath, setSpawnProjectPath] = createSignal("");
  const [spawnArgs, setSpawnArgs] = createSignal("");
  const [isSpawning, setIsSpawning] = createSignal(false);

  // Platform-based agent types filter
  const [isMobilePlatform, setIsMobilePlatform] = createSignal(false);
  onMount(async () => {
    try {
      const currentPlatform = await platform();
      setIsMobilePlatform(
        currentPlatform === "android" || currentPlatform === "ios",
      );
    } catch {
      setIsMobilePlatform(false);
    }
  });

  const availableAgentTypes = (): AgentType[] => {
    if (isMobilePlatform()) {
      return ["zeroclaw", "custom"];
    }
    return [
      "claude",
      "claude_acp",
      "codex",
      "opencode",
      "gemini",
      "copilot",
      "qwen",
      "zeroclaw",
      "custom",
    ];
  };

  const agentTypeLabel = (type: AgentType): string => {
    const labels: Record<AgentType, string> = {
      claude: "Claude Code",
      claude_acp: "Claude (ACP)",
      codex: "Codex",
      opencode: "OpenCode",
      gemini: "Gemini CLI",
      copilot: "GitHub Copilot",
      qwen: "Qwen Code",
      zeroclaw: "ClawdAI",
      custom: "Custom (P2P)",
    };
    return labels[type] || type;
  };

  // Set default agent type based on platform
  createEffect(() => {
    if (isMobilePlatform()) {
      setSpawnAgentType("zeroclaw");
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
              }

              case "tool_started": {
                const toolName = parsed.toolName || "unknown";
                const toolInput = parsed.input;
                const inputStr = toolInput ? JSON.stringify(toolInput) : "";
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Tool: ${toolName} started]${inputStr ? `\nInput: ${inputStr}` : ""}`,
                });
                break;
              }

              case "tool_inputUpdated": {
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
              }

              case "tool_completed": {
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
              }

              case "approval_request": {
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
                chatStore.addMessage(props.sessionId, {
                  role: "system",
                  content: `[Session ended]`,
                });
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
        return <FiCode size={24} />;
      case "gemini":
        return <SiGoogle size={24} />;
      case "copilot":
        return <SiGithub size={24} />;
      case "qwen":
        return <FiMessageSquare size={24} />;
      case "zeroclaw":
        return <FiActivity size={24} />;
      case "claude":
      case "claude_acp":
        return <FiTerminal size={24} />;
      default:
        return <FiTerminal size={24} />;
    }
  };

  return (
    <div class="flex flex-col h-full bg-base-200 relative">
      {/* Header */}
      <div class="z-20 flex items-center justify-between border-b border-base-300 bg-base-100 pr-4 pl-16 lg:pl-6 py-4 shadow-sm">
        <div class="flex-1">
          <div class="flex items-center gap-3">
            <div class="text-primary">{getAgentIcon()}</div>
            <div>
              <h2 class="text-lg font-semibold">
                {props.agentType === "claude" && "Claude Code"}
                {props.agentType === "claude_acp" && "Claude (ACP)"}
                {props.agentType === "codex" && "Codex"}
                {props.agentType === "opencode" && "OpenCode"}
                {props.agentType === "gemini" && "Gemini CLI"}
                {props.agentType === "copilot" && "GitHub Copilot"}
                {props.agentType === "qwen" && "Qwen Code"}
                {props.agentType === "zeroclaw" && "ClawdAI"}
                {props.agentType === "custom" && "Custom Agent"}
              </h2>
              <div
                class="text-xs text-base-content/50 truncate max-w-[24rem]"
                title={props.projectPath}
              >
                {props.projectPath || "No project path"}
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
              <FiSquare size={20} />
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
            <FiPlus size={16} />
          </Button>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={setScrollEl}
        class="flex-1 overflow-y-auto px-4 py-6 scroll-smooth"
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
        <div class="space-y-4 mb-6">
          <TransitionGroup name="message">
            <For each={pendingPermissions()}>
              {(permission) => (
                <PermissionRequestCard
                  permission={permission}
                  onApprove={() =>
                    handlePermissionResponse(permission.id, "approved")
                  }
                  onDeny={() =>
                    handlePermissionResponse(permission.id, "denied")
                  }
                  onApproveForSession={() =>
                    handlePermissionResponse(
                      permission.id,
                      "approved_for_session",
                    )
                  }
                />
              )}
            </For>
          </TransitionGroup>
        </div>

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
              <FiSend size={20} />
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
              <FiPlus size={20} />
              Spawn New Remote Session
            </h3>

            <div class="mb-4 space-y-2">
              <Label for="agent-type">Agent Type</Label>
              <Select
                id="agent-type"
                value={spawnAgentType()}
                onInput={(e) =>
                  setSpawnAgentType(e.currentTarget.value as AgentType)
                }
              >
                <For each={availableAgentTypes()}>
                  {(agentType) => (
                    <option value={agentType}>
                      {agentTypeLabel(agentType)}
                    </option>
                  )}
                </For>
              </Select>
            </div>

            <div class="mb-4 space-y-2">
              <Label for="project-path">Project Path</Label>
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
              <Label for="spawn-args">Additional Arguments</Label>
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
