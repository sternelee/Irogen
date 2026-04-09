/**
 * ChatView Component
 *
 * Main chat interface for AI agent interactions with the shared UI token system.
 * Displays messages, handles user input, shows permission requests, and supports slash commands.
 */

import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { FiAlertTriangle, FiRefreshCw, FiGlobe } from "solid-icons/fi";
import { invoke } from "@tauri-apps/api/core";
import { Virtualizer } from "virtua/solid";
import { chatStore } from "../stores/chatStore";
import {
  sessionStore,
  type BackendSessionMetadata,
} from "../stores/sessionStore";
import {
  sessionEventRouter,
  type SessionEvent,
} from "../stores/sessionEventRouter";
import { isMobile } from "../stores/deviceStore";
import type { ChatMessage } from "../stores/chatStore";
import type { SlashCommandItem } from "../stores/chatStore";
import type { SystemCard } from "../stores/chatStore";
import type { AgentType } from "../stores/sessionStore";
import { notificationStore } from "../stores/notificationStore";
import { fileBrowserStore } from "../stores/fileBrowserStore";
import { PermissionMessage, UserQuestionMessage } from "./ui/PermissionCard";
import { MessageBubble } from "./ui/MessageBubble";
import { ChatInput } from "./ui/ChatInput";
import { LanguageSwitcher, ThemeSwitcher } from "./ui/ThemeSwitcher";
import { TcpForwardingModal } from "./TcpForwardingModal";

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
  messageId?: string;
  // Turn lifecycle
  result?: unknown;
  error?: string;
  code?: string;
  // Tool events
  toolId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
  // Permission
  requestId?: string;
  message?: string;
  createdAt?: number;
  requestedAt?: number;
  toolParams?: unknown;
  description?: string;
  // User Question
  question?: string;
  options?: string[];
  questionId?: string;
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
 * 4. Wrapped format: {event: {type: "text_delta", ...}, sessionId: "...", turnId: "..."}
 */
function parseEvent(eventObj: Record<string, unknown>): ParsedEvent {
  // Check for wrapped format first (event: {type: "...", ...})
  if (
    "event" in eventObj &&
    typeof eventObj.event === "object" &&
    eventObj.event !== null
  ) {
    const nestedEvent = eventObj.event as Record<string, unknown>;
    if ("type" in nestedEvent) {
      const result: ParsedEvent = { type: nestedEvent.type as string };

      // Convert protocol type names from colon to underscore
      const typeStr = result.type;
      if (typeStr.includes(":")) {
        result.type = typeStr.replace(":", "_");
      }

      // Copy all properties from nested event, converting snake_case to camelCase
      for (const key of Object.keys(nestedEvent)) {
        if (key !== "type") {
          const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          (result as unknown as Record<string, unknown>)[camelKey] =
            nestedEvent[key];
        }
      }

      // Also copy top-level properties (sessionId, turnId)
      for (const key of Object.keys(eventObj)) {
        if (key !== "event") {
          const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          (result as unknown as Record<string, unknown>)[camelKey] =
            eventObj[key];
        }
      }

      return result;
    }
  }

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
    ToolCallUpdate: "tool_call_update",
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
        if ("tool_id" in obj) parsed.toolId = obj.tool_id as string;
        if ("toolId" in obj) parsed.toolId = obj.toolId as string;
        if ("tool_call_id" in obj)
          parsed.toolCallId = obj.tool_call_id as string;
        if ("toolCallId" in obj) parsed.toolCallId = obj.toolCallId as string;
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
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  agentType?: AgentType;
  projectPath?: string;
  sessionMode?: "remote" | "local"; // Added session mode
  // Right panel (managed by parent)
  rightPanelView?: "none" | "file" | "git";
  onToggleFileBrowser?: () => void;
  onToggleGitPanel?: () => void;
}

interface MentionCandidate {
  name: string;
  path: string;
}

const DEFAULT_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    name: "review",
    description: "Review code (supports optional instructions)",
  },
  { name: "review-branch", description: "Review current branch" },
  { name: "review-commit", description: "Review specific commit" },
  { name: "init", description: "Initialize a CLAUDE.md/AGENT.md file" },
  {
    name: "compact",
    description: "Clear history but keep a summary in context",
  },
  { name: "logout", description: "Logout current Codex session" },
  { name: "context", description: "Show current context usage" },
  { name: "debug", description: "Read session debug log" },
  {
    name: "security-review",
    description: "Run security review on pending changes",
  },
  {
    name: "pr-comments",
    description: "Get comments from a GitHub pull request",
  },
  { name: "insights", description: "Generate session insights report" },
];

interface SlashSuggestionItem {
  name: string;
  description?: string;
  value: string;
}

const normalizeSlashName = (value: string): string =>
  value.trim().replace(/^\/+/, "");

type RightPanelView = "none" | "file" | "git";

interface VirtualMessageRowProps {
  key?: string;
  message: ChatMessage;
  onQuote?: (content: string) => void;
  onResend?: (content: string) => void;
  onToggleFileBrowser?: () => void;
  onSyncTodoList?: (content: string) => void;
  onOpenFileLocation?: (path: string, line?: number) => void;
  onApplyEditReview?: (path: string, action: "accept" | "reject") => void;
  onTerminalAction?: (
    terminalId: string,
    action: "attach" | "stop" | "status",
  ) => void;
}

const VirtualMessageRow = (props: VirtualMessageRowProps) => {
  return (
    <MessageBubble
      message={props.message}
      onQuote={props.onQuote}
      onResend={props.onResend}
      onToggleFileBrowser={props.onToggleFileBrowser}
      onSyncTodoList={props.onSyncTodoList}
      onOpenFileLocation={props.onOpenFileLocation}
      onApplyEditReview={props.onApplyEditReview}
      onTerminalAction={props.onTerminalAction}
      class="pb-4"
    />
  );
};

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
    const pendingQuestions = () =>
      chatStore.getPendingQuestions(props.sessionId);

    const [inputValue, setInputValue] = createSignal("");
    const [messageScrollEl, setMessageScrollEl] =
      createSignal<HTMLDivElement>();
    const [isScrolledToBottom, setIsScrolledToBottom] = createSignal(true);
    const [shouldAutoFollow, setShouldAutoFollow] = createSignal(true);
    const [isStreaming, setIsStreaming] = createSignal(false);
    const [unseenMessageCount, setUnseenMessageCount] = createSignal(0);
    const [permissionMode, setPermissionMode] = createSignal<
      "AlwaysAsk" | "AcceptEdits" | "Plan" | "AutoApprove"
    >("AlwaysAsk");
    const [mentionSuggestions, setMentionSuggestions] = createSignal<
      MentionCandidate[]
    >([]);
    const [slashSuggestions, setSlashSuggestions] = createSignal<
      SlashSuggestionItem[]
    >([]);
    // Use props if provided, otherwise use internal state
    const [internalRightPanelView, setInternalRightPanelView] =
      createSignal<RightPanelView>("none");
    const [tcpModalOpen, setTcpModalOpen] = createSignal(false);
    const rightPanelView = () =>
      props.rightPanelView ?? internalRightPanelView();
    const toolMessageIds = new Map<string, string>();
    const toolNameMessageIds = new Map<string, string>();
    let scrollRafId: number | undefined;
    let mentionDebounceTimer: number | undefined;
    let lastScrollOffset = 0;
    const pendingPermissionsForModal = () =>
      pendingPermissions().map((permission) => ({
        request_id: permission.id,
        session_id: permission.sessionId,
        tool_name: permission.toolName,
        tool_params: permission.toolParams,
        message: permission.description,
        created_at: Math.floor(permission.requestedAt / 1000),
      }));

    // Reconnection state
    const [isReconnecting, setIsReconnecting] = createSignal(false);

    // Handle reconnection for inactive sessions
    const handleReconnect = async () => {
      const currentSession = session();
      if (!currentSession || isReconnecting()) return;

      setIsReconnecting(true);
      try {
        if (props.sessionMode === "local" || currentSession.mode === "local") {
          // For local sessions, restart the agent
          const sessionId = await invoke<string>("local_start_agent", {
            agentTypeStr: currentSession.agentType,
            projectPath: currentSession.projectPath,
            sessionId: undefined,
          });

          // Update session state to active
          sessionStore.updateSession(props.sessionId, {
            active: true,
            sessionId: sessionId,
          });

          notificationStore.success("Session reconnected", "Local Agent");
        } else {
          // For remote sessions, reconnect to CLI and reload sessions
          const ticket = sessionStore.state.sessionTicket.trim();
          if (!ticket) {
            notificationStore.error(
              "No session ticket available. Please reconnect manually.",
              "Reconnect Failed",
            );
            return;
          }

          try {
            // Reinitialize network and reconnect to CLI
            await sessionStore.initializeNetwork();

            // Connect to remote host
            const connectionSessionId = await invoke<string>(
              "connect_to_host",
              {
                sessionTicket: ticket,
              },
            );

            sessionStore.setTargetControlSessionId(connectionSessionId);
            sessionStore.setConnectionState("connected");

            // Reload remote sessions from CLI
            const remoteSessions = await invoke<BackendSessionMetadata[]>(
              "remote_list_agents",
              { controlSessionId: connectionSessionId },
            );

            // Find our session in the list
            const remoteSession = remoteSessions.find(
              (s) => s.session_id === props.sessionId,
            );

            if (remoteSession) {
              // Update session with new metadata and mark as active
              sessionStore.updateSession(props.sessionId, {
                active: remoteSession.active,
                controlSessionId: connectionSessionId,
                // Update other metadata if needed
              });

              if (remoteSession.active) {
                notificationStore.success(
                  "Session reconnected",
                  "Remote Agent",
                );
              } else {
                notificationStore.error(
                  "Session is no longer active on remote host",
                  "Session Ended",
                );
              }
            } else {
              // Session no longer exists on CLI
              notificationStore.error(
                "Session no longer exists on remote host",
                "Session Not Found",
              );
              // Remove the session
              sessionStore.removeSession(props.sessionId);
            }
          } catch (connErr) {
            const msg =
              connErr instanceof Error
                ? connErr.message
                : "Failed to reconnect";
            notificationStore.error(msg, "Reconnect Failed");
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Reconnect failed";
        notificationStore.error(msg, "Reconnect Failed");
      } finally {
        setIsReconnecting(false);
      }
    };

    const setSessionInputValue = (
      next: string | ((prev: string) => string),
    ) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: string) => string)(inputValue())
          : next;
      setInputValue(resolved);
      if (props.sessionId) {
        chatStore.setInputValue(props.sessionId, resolved);
      }
    };

    createEffect(
      on(
        () => props.sessionId,
        (sessionId) => {
          setInputValue(chatStore.getInputValue(sessionId));
          setUnseenMessageCount(0);
          setShouldAutoFollow(true);
          lastScrollOffset = 0;
          toolMessageIds.clear();
          toolNameMessageIds.clear();
        },
        { defer: false },
      ),
    );

    const updateScrollState = () => {
      const container = messageScrollEl();
      if (!container) return;
      const offset = container.scrollTop;
      const userMovedViewport = Math.abs(offset - lastScrollOffset) > 1;
      lastScrollOffset = offset;
      const atBottom =
        container.scrollHeight - offset - container.clientHeight < 80;
      if (atBottom !== isScrolledToBottom()) {
        setIsScrolledToBottom(atBottom);
      }
      if (atBottom) {
        setShouldAutoFollow(true);
        setUnseenMessageCount(0);
      } else if (userMovedViewport) {
        setShouldAutoFollow(false);
      }
    };

    const pushSystem = (content: string) => {
      if (!content.trim()) return;
      chatStore.addMessage(props.sessionId, {
        role: "system",
        content,
      });
    };

    const pushSystemCard = (content: string, systemCard: SystemCard) => {
      chatStore.addMessage(props.sessionId, {
        role: "system",
        content,
        systemCard,
      });
    };

    const getActiveMentionToken = (
      text: string,
    ): { start: number; token: string } | null => {
      const match = text.match(/(^|\s)(@[^\s@]*)$/);
      if (!match || !match[2]) return null;
      const token = match[2];
      const start = text.length - token.length;
      return { start, token };
    };

    const clearMentionSuggestions = () => {
      setMentionSuggestions([]);
    };

    const applyMentionSelection = (path: string) => {
      const current = inputValue();
      const active = getActiveMentionToken(current);
      if (!active) return;
      const replacement = `@${path} `;
      setSessionInputValue(
        `${current.slice(0, active.start)}${replacement}${current.slice(active.start + active.token.length)}`,
      );
      clearMentionSuggestions();
    };

    const renderToolContent = (contentItem: Record<string, unknown>) => {
      const contentType = String(contentItem.type || "");
      if (contentType === "diff") {
        const path = String(contentItem.path || "");
        const oldText = String(contentItem.oldText || "");
        const newText = String(contentItem.newText || "");
        pushSystem(
          `[Edit Review] ${path}\n\`\`\`diff\n--- old\n+++ new\n-${oldText}\n+${newText}\n\`\`\``,
        );
        return;
      }

      if (contentType === "terminal") {
        const terminalId = String(contentItem.terminalId || "");
        pushSystem(`[Terminal] Interactive/background terminal: ${terminalId}`);
        return;
      }

      if (contentType === "content") {
        const nested = contentItem.content as
          | Record<string, unknown>
          | undefined;
        if (!nested) return;
        if (nested.type === "image") {
          const mimeType = String(nested.mimeType || "image/png");
          const data = String(nested.data || "");
          if (data) {
            pushSystem(`![tool-image](data:${mimeType};base64,${data})`);
          }
          return;
        }
        if (nested.type === "text") {
          const text = String(nested.text || "");
          pushSystem(text);
        }
      }
    };

    const handleAcpRawEvent = (rawPayload: unknown) => {
      const raw = rawPayload as Record<string, unknown> | undefined;
      if (!raw || typeof raw !== "object") return;
      const updateType = String(raw.sessionUpdate || raw.type || "");

      if (updateType === "plan") {
        const entries = Array.isArray(raw.entries)
          ? (raw.entries as Array<Record<string, unknown>>)
          : [];
        if (entries.length === 0) return;
        pushSystemCard("[TODO]", {
          type: "todo_list",
          entries: entries.map((entry) => ({
            status: String(entry.status || "pending"),
            content: String(entry.content || ""),
          })),
        });
        return;
      }

      if (
        updateType === "available_commands_update" ||
        raw.AvailableCommandsUpdate
      ) {
        const commandContainer = (raw.AvailableCommandsUpdate ||
          raw.availableCommandsUpdate ||
          raw.available_commands_update ||
          raw) as Record<string, unknown>;
        const rawCommands =
          commandContainer.availableCommands ??
          commandContainer.available_commands ??
          raw.availableCommands ??
          raw.available_commands;
        const commands = Array.isArray(rawCommands)
          ? (rawCommands as Array<Record<string, unknown>>)
          : [];
        const parsedCommands = commands
          .map((cmd) => ({
            name: String(cmd.name || "").trim(),
            description: String(cmd.description || "").trim(),
          }))
          .filter((cmd) => cmd.name.length > 0);
        chatStore.setSlashCommands(props.sessionId, parsedCommands);
        setSlashSuggestions([]);
        return;
      }

      if (
        updateType === "available_prompts_update" ||
        raw.AvailablePromptsUpdate
      ) {
        const promptContainer = (raw.AvailablePromptsUpdate ||
          raw.availablePromptsUpdate ||
          raw.available_prompts_update ||
          raw) as Record<string, unknown>;
        const rawPrompts =
          promptContainer.availablePrompts ??
          promptContainer.available_prompts ??
          promptContainer.prompts ??
          raw.availablePrompts ??
          raw.available_prompts ??
          raw.prompts;
        const prompts = Array.isArray(rawPrompts)
          ? (rawPrompts as Array<Record<string, unknown>>)
          : [];
        const parsedPrompts = prompts
          .map((prompt) => ({
            name: String(prompt.name || "").trim(),
            description: String(prompt.description || "").trim(),
            command: String(prompt.command || "").trim(),
          }))
          .filter((prompt) => prompt.name.length > 0);
        chatStore.setCustomPrompts(props.sessionId, parsedPrompts);
        setSlashSuggestions([]);
        return;
      }

      if (updateType === "tool_call" || updateType === "tool_call_update") {
        const locations = Array.isArray(raw.locations)
          ? (raw.locations as Array<Record<string, unknown>>)
          : [];
        if (locations.length > 0) {
          pushSystemCard("[Following]", {
            type: "following",
            locations: locations
              .map((loc) => ({
                path: String(loc.path || ""),
                line:
                  typeof loc.line === "number"
                    ? (loc.line as number)
                    : undefined,
              }))
              .filter((loc) => !!loc.path),
          });
        }

        const content = Array.isArray(raw.content)
          ? (raw.content as Array<Record<string, unknown>>)
          : [];
        for (const item of content) {
          const itemType = String(item.type || "");
          if (itemType === "diff") {
            pushSystemCard("[Edit Review]", {
              type: "edit_review",
              path: String(item.path || ""),
              oldText: String(item.oldText || ""),
              newText: String(item.newText || ""),
            });
            continue;
          }
          if (itemType === "terminal") {
            pushSystemCard("[Terminal]", {
              type: "terminal",
              terminalId: String(item.terminalId || ""),
              title: String(item.title || ""),
              mode: String(item.mode || ""),
              status: String(item.status || ""),
            });
            continue;
          }
          renderToolContent(item);
        }
      }
    };

    const normalizeToolNameKey = (toolName: string) =>
      `name-${toolName}`.replace(/\s+/g, "-").toLowerCase();

    const resolveToolMessageKey = (
      toolName: string,
      explicitToolId?: string,
    ) => {
      const toolNameKey = normalizeToolNameKey(toolName);
      const toolMessageKey =
        explicitToolId || toolNameMessageIds.get(toolNameKey) || toolNameKey;
      return { toolNameKey, toolMessageKey };
    };

    const isTerminalToolStatus = (status: string) =>
      status === "Completed" ||
      status === "Failed" ||
      status === "Error" ||
      status === "Cancelled";

    // ========================================================================
    // Session Event Handler (using centralized router)
    // ========================================================================

    const handleSessionEvent = (event: SessionEvent) => {
      // Parse event using helper that handles both Rust and frontend formats
      const parsed = parseEvent(event as unknown as Record<string, unknown>);
      const eventType = parsed.type;
      const content = parsed.content || parsed.text || "";
      const thinking = parsed.thinking || false;

      // Handle different event types
      switch (eventType) {
        case "text_delta": {
          setIsStreaming(true);
          const deltaContent = content || "";
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
          // Don't set isStreaming here - only user sending message should trigger it
          break;
        }

        case "response": {
          setIsStreaming(true);
          // Full response - replace existing message or create new one
          const responseContent = content || "";
          const responseThinking = thinking;
          const messageId = parsed.messageId;

          // Don't set isStreaming here - only user sending message should trigger it

          const currentMessages = messages();
          const lastMessage = currentMessages[currentMessages.length - 1];

          if (
            (messageId && lastMessage?.messageId === messageId) ||
            (!messageId && lastMessage?.role === "assistant")
          ) {
            chatStore.updateMessage(props.sessionId, lastMessage.id, {
              content: responseContent,
              thinking: responseThinking,
              timestamp: Date.now(),
            });
          } else {
            chatStore.addMessage(props.sessionId, {
              role: "assistant",
              content: responseContent,
              thinking: responseThinking,
              messageId,
            });
          }
          break;
        }

        case "turn_started":
          setIsStreaming(true);
          break;

        case "turn_completed": {
          setIsStreaming(false);
          const currentMessages = messages();
          const lastMessage = currentMessages[currentMessages.length - 1];
          if (lastMessage?.role === "assistant" && lastMessage.thinking) {
            chatStore.updateMessage(props.sessionId, lastMessage.id, {
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
          setIsStreaming(true);
          const reasoningContent = content || "";
          const reasonMessages = messages();
          const lastReasonMsg = reasonMessages[reasonMessages.length - 1];

          if (lastReasonMsg?.role === "assistant") {
            chatStore.updateMessage(props.sessionId, lastReasonMsg.id, {
              content: lastReasonMsg.content + reasoningContent,
              thinking: true,
              timestamp: Date.now(),
            });
          } else {
            chatStore.addMessage(props.sessionId, {
              role: "assistant",
              content: reasoningContent,
              thinking: true,
            });
          }
          // Don't set isStreaming here - only user sending message should trigger it
          break;
        }

        case "tool_started": {
          const explicitToolId = parsed.toolId || parsed.toolCallId;
          const toolName = parsed.toolName || "unknown";
          const toolInput = parsed.input;
          const inputStr = toolInput ? JSON.stringify(toolInput) : "";
          const toolContent = `[Tool: ${toolName} started]${inputStr ? `\nInput: ${inputStr}` : ""}`;
          if (explicitToolId) {
            const { toolNameKey, toolMessageKey } = resolveToolMessageKey(
              toolName,
              explicitToolId,
            );
            upsertToolMessage(toolMessageKey, toolContent);
            toolNameMessageIds.set(toolNameKey, toolMessageKey);
          } else {
            chatStore.addMessage(props.sessionId, {
              role: "system",
              content: toolContent,
            });
          }
          break;
        }

        case "tool_inputUpdated": {
          const explicitToolId = parsed.toolId || parsed.toolCallId;
          const updateToolName = parsed.toolName || "unknown";
          const updatedInput = parsed.input;
          const updateStr = updatedInput ? JSON.stringify(updatedInput) : "";
          const toolContent = `[Tool: ${updateToolName} input updated]${updateStr ? `\n${updateStr}` : ""}`;
          if (explicitToolId) {
            const { toolNameKey, toolMessageKey } = resolveToolMessageKey(
              updateToolName,
              explicitToolId,
            );
            upsertToolMessage(toolMessageKey, toolContent);
            toolNameMessageIds.set(toolNameKey, toolMessageKey);
          } else {
            chatStore.addMessage(props.sessionId, {
              role: "system",
              content: toolContent,
            });
          }
          break;
        }

        case "tool_completed": {
          const explicitToolId = parsed.toolId || parsed.toolCallId;
          const compToolName = parsed.toolName || "unknown";
          const compOutput = parsed.output;
          const compError = parsed.error;
          const outputStr = compOutput
            ? typeof compOutput === "string"
              ? compOutput
              : JSON.stringify(compOutput, null, 2)
            : "";
          if (compError) {
            const toolContent = `[Tool: ${compToolName} failed]\nError: ${compError}`;
            if (explicitToolId) {
              const { toolNameKey, toolMessageKey } = resolveToolMessageKey(
                compToolName,
                explicitToolId,
              );
              upsertToolMessage(toolMessageKey, toolContent);
              toolMessageIds.delete(toolMessageKey);
              toolNameMessageIds.delete(toolNameKey);
            } else {
              chatStore.addMessage(props.sessionId, {
                role: "system",
                content: toolContent,
              });
            }
          } else {
            const toolContent = `[Tool: ${compToolName} completed]${outputStr ? `\n${outputStr}` : ""}`;
            if (explicitToolId) {
              const { toolNameKey, toolMessageKey } = resolveToolMessageKey(
                compToolName,
                explicitToolId,
              );
              upsertToolMessage(toolMessageKey, toolContent);
              toolMessageIds.delete(toolMessageKey);
              toolNameMessageIds.delete(toolNameKey);
            } else {
              chatStore.addMessage(props.sessionId, {
                role: "system",
                content: toolContent,
              });
            }
          }
          break;
        }

        case "tool_call_update": {
          const toolName = parsed.toolName || "unknown";
          const status = parsed.status || "";
          const output = parsed.output;
          const stableToolId =
            parsed.toolId ||
            parsed.toolCallId ||
            (typeof parsed.data === "string"
              ? (() => {
                  try {
                    const rawData = JSON.parse(parsed.data) as Record<
                      string,
                      unknown
                    >;
                    return typeof rawData.toolCallId === "string"
                      ? rawData.toolCallId
                      : undefined;
                  } catch {
                    return undefined;
                  }
                })()
              : undefined);
          const { toolNameKey, toolMessageKey } = resolveToolMessageKey(
            toolName,
            stableToolId,
          );
          let toolContent = "";
          let parsedOutput: Record<string, unknown> | null = null;
          if (typeof output === "string") {
            try {
              parsedOutput = JSON.parse(output) as Record<string, unknown>;
            } catch {
              parsedOutput = null;
            }
          }
          if (parsedOutput) {
            const description = parsedOutput.description as string | undefined;
            const command = parsedOutput.command as string | undefined;
            if (description) {
              toolContent = `[Tool: ${toolName}] ${description}`;
            } else if (command) {
              toolContent = `[Tool: ${toolName}] Running: ${command}`;
            } else {
              toolContent = `[Tool: ${toolName}] Status: ${status}`;
            }
          } else {
            toolContent = `[Tool: ${toolName}] Status: ${status}${output ? `\n${output}` : ""}`;
          }
          upsertToolMessage(toolMessageKey, toolContent);
          toolNameMessageIds.set(toolNameKey, toolMessageKey);
          if (isTerminalToolStatus(status)) {
            toolMessageIds.delete(toolMessageKey);
            toolNameMessageIds.delete(toolNameKey);
          }
          break;
        }

        case "user_question": {
          const questionText = parsed.question || "Please select an option";
          const questionOptions = parsed.options || [];
          const questionId =
            parsed.questionId || parsed.requestId || crypto.randomUUID();

          chatStore.addUserQuestion(props.sessionId, {
            sessionId: props.sessionId,
            id: questionId,
            question: questionText,
            options: questionOptions,
          });
          break;
        }

        case "approval_request":
        case "permission_request": {
          const permToolName = parsed.toolName || "unknown";
          const permMessage =
            parsed.message || `Permission request for ${permToolName}`;
          const permInput = parsed.input || parsed.toolParams;
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
                : typeof parsed.requestedAt === "number"
                  ? parsed.requestedAt * 1000
                  : undefined,
          });
          setIsStreaming(false);
          break;
        }

        case "tool_call": {
          const legacyToolName = parsed.toolName || "unknown";
          const legacyStatus = parsed.status || "started";
          const legacyToolOutput = parsed.output as string | undefined;
          const { toolNameKey, toolMessageKey } =
            resolveToolMessageKey(legacyToolName);
          const toolContent = `[Tool: ${legacyToolName}] Status: ${legacyStatus}${legacyToolOutput ? `\n${legacyToolOutput}` : ""}`;
          upsertToolMessage(toolMessageKey, toolContent);
          toolNameMessageIds.set(toolNameKey, toolMessageKey);
          if (isTerminalToolStatus(legacyStatus)) {
            toolMessageIds.delete(toolMessageKey);
            toolNameMessageIds.delete(toolNameKey);
          }
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
          const isOpenClawHealth =
            session()?.agentType === "openclaw" &&
            notifLevel === "Info" &&
            notifMessage.trim().toLowerCase() === "health";
          if (isOpenClawHealth) return;
          if (notifLevel === "Info" && (!notifMessage || !notifMessage.trim()))
            return;
          chatStore.addMessage(props.sessionId, {
            role: "system",
            content: `[${notifLevel}] ${notifMessage}`,
          });
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

        case "tool_input_updated":
          // Tool input updates are typically handled by the permission UI
          // No action needed for display - just suppress the unknown event log
          break;

        case "raw":
          handleAcpRawEvent(parsed.data);
          break;

        default:
          console.log("[ChatView] Unknown event type:", eventType, parsed);
      }
    };

    // Subscribe to session events via centralized router.
    // Re-subscribe when sessionId changes so newly opened sessions receive events.
    createEffect(() => {
      const sessionId = props.sessionId;
      if (!sessionId) return;

      const unsubscribe = sessionEventRouter.subscribe(
        sessionId,
        handleSessionEvent,
      );

      // Sync streaming state from router for the current session
      const routerState = sessionEventRouter.getStreamingState(sessionId);
      setIsStreaming(routerState.isStreaming);

      onCleanup(() => {
        unsubscribe();
      });
    });

    onCleanup(() => {
      if (mentionDebounceTimer !== undefined) {
        clearTimeout(mentionDebounceTimer);
      }
      if (scrollRafId !== undefined) {
        cancelAnimationFrame(scrollRafId);
      }
    });

    // Sync streaming state when sessionId changes (handles session switching)
    createEffect(() => {
      const sid = props.sessionId;
      if (sid) {
        const routerState = sessionEventRouter.getStreamingState(sid);
        setIsStreaming(routerState.isStreaming);
      }
    });

    // Re-sync streaming state after history load finishes
    createEffect(() => {
      const sid = props.sessionId;
      const historyLoading = sessionStore.state.isHistoryLoading;
      if (!sid || historyLoading) return;
      const routerState = sessionEventRouter.getStreamingState(sid);
      setIsStreaming(routerState.isStreaming);
    });

    createEffect(() => {
      const text = inputValue();
      const mention = getActiveMentionToken(text);
      const activeSession = session();
      const basePath = activeSession?.projectPath || props.projectPath || "";

      if (!mention || !basePath || !isActive()) {
        clearMentionSuggestions();
        return;
      }

      if (props.sessionMode === "remote" && !activeSession?.controlSessionId) {
        clearMentionSuggestions();
        return;
      }

      if (mentionDebounceTimer !== undefined) {
        clearTimeout(mentionDebounceTimer);
      }

      mentionDebounceTimer = window.setTimeout(async () => {
        try {
          const query = mention.token.slice(1);
          const data =
            props.sessionMode === "remote"
              ? await invoke<MentionCandidate[]>(
                  "list_remote_mention_candidates",
                  {
                    sessionId: activeSession?.controlSessionId || "",
                    basePath,
                    query,
                    limit: 20,
                  },
                )
              : await invoke<MentionCandidate[]>("list_mention_candidates", {
                  basePath,
                  query,
                  limit: 20,
                });
          setMentionSuggestions(data);
        } catch (error) {
          console.error("Failed to load mention suggestions:", error);
          clearMentionSuggestions();
        }
      }, 120);
    });

    createEffect(() => {
      const raw = inputValue();
      const match = raw.match(/^\/([^\s]*)$/);
      if (!match) {
        setSlashSuggestions([]);
        return;
      }
      const keyword = match[1].toLowerCase();
      const sessionCommands = chatStore
        .getSlashCommands(props.sessionId)
        .map((cmd) => ({
          name: normalizeSlashName(cmd.name),
          description: cmd.description,
          value: normalizeSlashName(cmd.name),
        }));
      const sessionPrompts = chatStore
        .getCustomPrompts(props.sessionId)
        .map((prompt) => {
          const normalized = normalizeSlashName(prompt.command || prompt.name);
          return {
            name: normalized,
            description: prompt.description
              ? `[Prompt] ${prompt.description}`
              : "[Prompt]",
            value: normalized,
          };
        });
      const base =
        sessionCommands.length > 0
          ? sessionCommands
          : DEFAULT_SLASH_COMMANDS.map((cmd) => ({
              name: normalizeSlashName(cmd.name),
              description: cmd.description,
              value: normalizeSlashName(cmd.name),
            }));

      const dedup = new Map<string, SlashSuggestionItem>();
      for (const item of [...base, ...sessionPrompts]) {
        if (!item.name) continue;
        dedup.set(item.name, item);
      }
      const all = Array.from(dedup.values());
      if (all.length === 0) {
        setSlashSuggestions([]);
        return;
      }
      const filtered = all.filter((cmd) =>
        cmd.name.toLowerCase().includes(keyword),
      );
      setSlashSuggestions(filtered.slice(0, 20));
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
      // const sessionId = props.sessionId;

      // Avoid showing previous session's mode while loading the current session mode.
      setPermissionMode("AlwaysAsk");

      // const controlSessionId =
      //   props.sessionMode === "remote"
      //     ? sessionStore.getSession(sessionId)?.controlSessionId
      //     : undefined;

      // invoke<string>("get_permission_mode", {
      //   sessionId,
      //   controlSessionId,
      // })
      //   .then((mode) => {
      //     // Ignore stale async responses when user has switched sessions.
      //     if (props.sessionId !== sessionId) return;
      //     if (
      //       mode === "AlwaysAsk" ||
      //       mode === "AcceptEdits" ||
      //       mode === "Plan" ||
      //       mode === "AutoApprove"
      //     ) {
      //       setPermissionMode(mode);
      //     }
      //   })
      //   .catch((error) => {
      //     console.error("Failed to load permission mode:", error);
      //   });
    });

    const scrollToBottom = (behavior: "auto" | "smooth" = "auto") => {
      const container = messageScrollEl();
      if (!container) return;
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
    };

    const scheduleScrollToBottom = (behavior: "auto" | "smooth" = "auto") => {
      if (scrollRafId !== undefined) {
        cancelAnimationFrame(scrollRafId);
      }
      scrollRafId = requestAnimationFrame(() => {
        scrollToBottom(behavior);
        scrollRafId = requestAnimationFrame(() => {
          scrollRafId = undefined;
          scrollToBottom("auto");
          updateScrollState();
        });
      });
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

    const dispatchMessageToAgent = async (
      sessionId: string,
      content: string,
      attachments: string[],
    ) => {
      if (props.sessionMode === "local") {
        if (isMobile()) {
          await invoke("mobile_send_agent_message", {
            sessionId,
            content,
            attachments,
          });
        } else {
          await invoke("local_send_agent_message", {
            sessionId,
            content,
            attachments,
          });
        }
      } else {
        const controlSessionId =
          sessionStore.getSession(sessionId)?.controlSessionId;
        await invoke("send_agent_message", {
          sessionId,
          content,
          controlSessionId,
          attachments,
        });
      }
    };

    const handleSyncTodoList = async (content: string) => {
      const sessionId = props.sessionId;
      if (!sessionId || !content.trim() || isStreaming()) return;

      setIsStreaming(true);
      setShouldAutoFollow(true);
      chatStore.addMessage(sessionId, {
        role: "user",
        content,
      });

      try {
        await dispatchMessageToAgent(sessionId, content, []);
        props.onSendMessage?.(content);
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : props.sessionMode === "remote"
              ? "Failed to sync TODO list to remote agent"
              : "Failed to sync TODO list to local agent";
        notificationStore.error(errorMsg, "TODO Sync Error");
        chatStore.addMessage(sessionId, {
          role: "system",
          content: `Error: ${errorMsg}`,
        });
        setIsStreaming(false);
      }
    };

    const handleSelectSlash = (value: string) => {
      const normalized = normalizeSlashName(value);
      if (!normalized) return;
      const commandText = `/${normalized} `;
      setSessionInputValue(commandText);
      setSlashSuggestions([]);
    };

    const handleApplyEditReview = async (
      path: string,
      action: "accept" | "reject",
    ) => {
      const content =
        action === "accept"
          ? `Please apply the proposed edit review changes for \`${path}\`.`
          : `Please discard/revert the proposed edit review changes for \`${path}\` and explain the reason.`;
      await handleSyncTodoList(content);
    };

    const handleTerminalAction = async (
      terminalId: string,
      action: "attach" | "stop" | "status",
    ) => {
      if (!terminalId) return;
      const content =
        action === "attach"
          ? `Attach to terminal ${terminalId} and continue running commands in that terminal.`
          : action === "stop"
            ? `Stop terminal ${terminalId} and summarize final output.`
            : `Check terminal ${terminalId} status and latest output.`;
      await handleSyncTodoList(content);
    };

    const handleOpenFileLocation = (path: string, line?: number) => {
      if (!path) return;
      toggleRightPanel("file");
      const activeSession = session();
      const basePath = activeSession?.projectPath || props.projectPath || ".";
      const normalizedPath = path.startsWith("/")
        ? path
        : `${basePath.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
      fileBrowserStore.requestOpenFile(normalizedPath, line);
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

      setSessionInputValue("");
      setSlashSuggestions([]);
      setIsStreaming(true);
      setShouldAutoFollow(true);

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
        // Slash commands - send directly to agent based on session mode
        chatStore.addMessage(sessionId, {
          role: "user",
          content,
        });
        try {
          if (props.sessionMode === "local") {
            // Local agent - use local_send_agent_message
            if (isMobile()) {
              await invoke("mobile_send_agent_message", {
                sessionId,
                content,
                attachments: [] as string[],
              });
            } else {
              await invoke("local_send_agent_message", {
                sessionId,
                content,
                attachments: [] as string[],
              });
            }
          } else {
            // Remote agent - use send_slash_command
            const controlSessionId =
              sessionStore.getSession(sessionId)?.controlSessionId;
            await invoke("send_slash_command", {
              sessionId,
              command: content,
              controlSessionId,
            });
          }
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
            await dispatchMessageToAgent(sessionId, content, attachmentPaths);
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
            await dispatchMessageToAgent(sessionId, content, attachmentPaths);
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

    // Auto-scroll to bottom after message/permission updates, if user is near bottom.
    createEffect(
      on(
        () => {
          const list = messages();
          const last = list[list.length - 1];
          return {
            messageCount: list.length,
            lastId: last?.id,
            lastLen: last?.content?.length ?? 0,
            pendingCount: pendingPermissions().length,
          };
        },
        () => {
          if (shouldAutoFollow()) {
            scheduleScrollToBottom("auto");
          }
        },
        { defer: false },
      ),
    );
    createEffect(
      on(
        () => messages().length,
        (count, prev = 0) => {
          if (count > prev && !isScrolledToBottom()) {
            setUnseenMessageCount((current) => current + (count - prev));
          }
          return count;
        },
      ),
    );

    const handleQuoteMessage = (content: string) => {
      const quoted = content
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      setSessionInputValue((prev) =>
        prev.trim() ? `${prev}\n\n${quoted}\n` : `${quoted}\n`,
      );
    };

    const handleResendMessage = (content: string) => {
      if (!content.trim() || isStreaming()) return;
      chatStore.clearAttachments(props.sessionId);
      setSessionInputValue(content);
      queueMicrotask(() => {
        void handleSend();
      });
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
          await invoke("local_set_permission_mode", {
            sessionId: props.sessionId,
            mode,
          });
        } else {
          const controlSessionId = sessionStore.getSession(
            props.sessionId,
          )?.controlSessionId;
          await invoke("remote_set_permission_mode", {
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

    const toggleRightPanel = (view: Exclude<RightPanelView, "none">) => {
      if (props.rightPanelView !== undefined) {
        // Parent manages state - call the parent's toggle
        if (view === "file") {
          props.onToggleFileBrowser?.();
        } else if (view === "git") {
          props.onToggleGitPanel?.();
        }
      } else {
        setInternalRightPanelView((prev) => (prev === view ? "none" : view));
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
        cursor: "/cursor.svg",
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
      <div
        class={`drawer drawer-end h-full ${rightPanelView() !== "none" ? "drawer-open" : ""}`}
      >
        <input
          type="checkbox"
          class="drawer-toggle"
          checked={rightPanelView() !== "none"}
          readOnly
        />
        <div class="drawer-content flex h-full bg-base-100 relative pb-safe lg:pb-0 overflow-hidden">
          <div class="flex flex-col h-full min-w-0 flex-1">
            {/* Header */}
            <div class="compact-mobile-controls z-20 flex items-center h-12 sm:h-16 box-border justify-between border-b border-base-content/10 bg-base-100/80 backdrop-blur-md px-3 sm:px-6 py-1.5 sm:py-2 shadow-sm sticky top-0">
              <div class="flex items-center gap-1 sm:gap-3 overflow-hidden">
                {/* Mobile Sidebar Toggle */}
                <Show when={!props.sidebarOpen}>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs sm:btn-sm h-8 w-8 sm:h-10 sm:w-10 min-h-8 sm:min-h-10 rounded-lg sm:rounded-xl lg:hidden active:scale-95 transition-transform"
                    onClick={() => props.onToggleSidebar?.()}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="w-4 h-4 sm:w-5 sm:h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <title>Menu</title>
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                  </button>
                </Show>

                <div class="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
                  <div class="hidden rounded-xl bg-primary/10 p-2 text-primary shadow-inner ring-1 ring-primary/10 xs:flex shrink-0">
                    {getAgentIcon()}
                  </div>
                  <div class="min-w-0">
                    <h2 class="text-[13px] sm:text-[15px] font-bold tracking-tight truncate leading-tight">
                      {props.agentType === "claude" && "Claude Code"}
                      {props.agentType === "codex" && "Codex"}
                      {props.agentType === "cursor" && "Cursor"}
                      {props.agentType === "opencode" && "OpenCode"}
                      {props.agentType === "gemini" && "Gemini CLI"}
                      {props.agentType === "openclaw" && "OpenClaw"}
                    </h2>
                    <div
                      class="text-[10px] sm:text-[11px] opacity-50 truncate max-w-48 sm:max-w-[18rem] flex items-center gap-1.5 mt-0.5"
                      title={props.projectPath}
                    >
                      <span class="inline-flex items-center gap-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-base-100)_82%,transparent)]" />
                        <span class="font-medium hidden sm:inline">Active</span>
                      </span>
                      <span class="opacity-30 hidden sm:inline">•</span>
                      <span class="truncate font-mono">
                        {props.projectPath?.split("/").pop() || "No project"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <Show when={props.sessionMode === "remote"}>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs sm:btn-sm h-8 w-8 sm:h-10 sm:w-10 min-h-8 sm:min-h-10 rounded-lg sm:rounded-xl text-base-content/60 hover:text-primary active:scale-95 transition-all"
                    onClick={() => setTcpModalOpen(true)}
                    title="TCP Forwarding"
                  >
                    <FiGlobe class="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </Show>
                <LanguageSwitcher />
                <ThemeSwitcher />
              </div>
            </div>

            {/* Messages Area */}
            <div
              ref={setMessageScrollEl}
              onScroll={updateScrollState}
              class="flex-1 overflow-y-auto px-3.5 sm:px-6 py-6 sm:py-8 pb-28 sm:pb-10 overflow-x-hidden bg-base-100"
            >
              <Show
                when={
                  messages().length === 0 && pendingPermissions().length === 0
                }
              >
                <div class="flex flex-col items-center text-center justify-center h-full max-w-sm mx-auto px-2 sm:px-0">
                  <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl sm:rounded-4xl bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-4 sm:mb-6 shadow-xl shadow-primary/10 border border-primary/10">
                    <div class="text-[28px] sm:text-3xl scale-[1.35] sm:scale-150 filter drop-shadow-sm">
                      {getAgentIcon()}
                    </div>
                  </div>
                  <h3 class="text-xl sm:text-2xl font-bold mb-2 sm:mb-3 tracking-tight">
                    Ready to assist
                  </h3>
                  <p class="text-[13px] sm:text-sm opacity-60 leading-relaxed px-2 sm:px-4">
                    I can help you write code, explain concepts, or debug
                    issues. How can I help you today?
                  </p>
                  {/* Quick actions */}
                  <div class="flex flex-wrap items-center justify-center gap-2 mt-5 sm:mt-8 px-1 sm:px-2">
                    <button
                      type="button"
                      class="btn btn-outline btn-xs sm:btn-sm rounded-lg sm:rounded-xl px-3 sm:px-4 font-bold border-base-content/20"
                      onClick={() => {
                        const session = sessionStore.getSession(
                          props.sessionId,
                        );
                        if (session?.projectPath) {
                          setSessionInputValue(
                            `List files in ${session.projectPath}`,
                          );
                        }
                      }}
                    >
                      List files
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline btn-xs sm:btn-sm rounded-lg sm:rounded-xl px-3 sm:px-4 font-bold border-base-content/20"
                      onClick={() => {
                        setSessionInputValue("Explain what you can do");
                      }}
                    >
                      What can you do?
                    </button>
                  </div>
                </div>
              </Show>

              {/* Messages */}
              <div class="max-w-4xl mx-auto w-full space-y-6">
                <Show when={messages().length > 0}>
                  <Virtualizer
                    scrollRef={messageScrollEl()}
                    data={messages()}
                    itemSize={120}
                    bufferSize={400}
                  >
                    {(message: ReturnType<typeof messages>[number]) => (
                      <VirtualMessageRow
                        key={message.id}
                        message={message}
                        onQuote={handleQuoteMessage}
                        onResend={handleResendMessage}
                        onToggleFileBrowser={() => toggleRightPanel("file")}
                        onSyncTodoList={handleSyncTodoList}
                        onOpenFileLocation={handleOpenFileLocation}
                        onApplyEditReview={handleApplyEditReview}
                        onTerminalAction={handleTerminalAction}
                      />
                    )}
                  </Virtualizer>
                </Show>

                {/* Pending Permission Requests (inline) */}
                <For each={pendingPermissionsForModal()}>
                  {(permission) => (
                    <div class="animate-slide-up">
                      <PermissionMessage
                        toolName={permission.tool_name}
                        toolParams={permission.tool_params}
                        message={permission.message}
                        requestId={permission.request_id}
                        permissionMode={permissionMode()}
                        disabled={!isActive()}
                        onApprove={(decision) => {
                          const response =
                            decision === "ApprovedForSession"
                              ? "approved_for_session"
                              : "approved";
                          handlePermissionResponse(
                            permission.request_id,
                            response,
                          );
                        }}
                        onDeny={() => {
                          handlePermissionResponse(
                            permission.request_id,
                            "denied",
                          );
                        }}
                      />
                    </div>
                  )}
                </For>

                {/* Pending User Questions */}
                <For each={pendingQuestions()}>
                  {(question) => (
                    <div class="animate-slide-up">
                      <UserQuestionMessage
                        question={question.question}
                        options={question.options}
                        questionId={question.id}
                        disabled={!isActive() || question.status === "answered"}
                        onSelect={(option) => {
                          chatStore.answerQuestion(
                            props.sessionId,
                            question.id,
                            option,
                          );
                          // Send the answer back to the agent
                          // For now, just clear the question - backend should handle sending response
                          chatStore.clearQuestion(props.sessionId, question.id);
                          // Add user response as a message
                          chatStore.addMessage(props.sessionId, {
                            role: "user",
                            content: option,
                          });
                        }}
                      />
                    </div>
                  )}
                </For>
              </div>
            </div>

            {/* Scroll to bottom button */}
            <Show when={!isScrolledToBottom() && messages().length > 0}>
              <button
                type="button"
                onClick={() => {
                  setShouldAutoFollow(true);
                  setIsScrolledToBottom(true);
                  setUnseenMessageCount(0);
                  scrollToBottom("smooth");
                }}
                class="fixed bottom-30 right-4 sm:right-8 z-30 btn btn-circle btn-sm h-10 w-10 bg-base-100/90 shadow-2xl border-base-content/10 backdrop-blur-sm"
                aria-label="Scroll to bottom"
                title={
                  unseenMessageCount() > 0
                    ? `${unseenMessageCount()} new messages`
                    : "Scroll to bottom"
                }
              >
                <Show
                  when={unseenMessageCount() > 0}
                  fallback={
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <title>Scroll to bottom</title>
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2.5"
                        d="M19 14l-7 7m0 0l-7-7m7 7V3"
                      />
                    </svg>
                  }
                >
                  <span class="text-[11px] font-black text-primary">
                    {Math.min(unseenMessageCount(), 99)}
                  </span>
                </Show>
              </button>
            </Show>

            {/* Input Area */}
            <Show
              when={isActive()}
              fallback={
                <div class="alert alert-warning m-4 mb-8">
                  <FiAlertTriangle size={20} />
                  <span class="text-sm">
                    Session inactive. Connection might be lost.
                  </span>
                  <button
                    type="button"
                    class="btn btn-sm"
                    onClick={handleReconnect}
                    disabled={isReconnecting()}
                  >
                    <Show
                      when={isReconnecting()}
                      fallback={
                        <>
                          <FiRefreshCw size={16} />
                          Reconnect
                        </>
                      }
                    >
                      <span class="loading loading-spinner loading-sm" />
                    </Show>
                  </button>
                </div>
              }
            >
              <ChatInput
                value={inputValue()}
                onInput={(value) => {
                  setSessionInputValue(value);
                  if (!value.includes("@")) {
                    clearMentionSuggestions();
                  }
                  if (!value.startsWith("/")) {
                    setSlashSuggestions([]);
                  }
                }}
                onSubmit={handleSend}
                onInterrupt={handleAbort}
                onAttach={handleAttachFiles}
                attachments={chatStore
                  .getAttachments(props.sessionId)
                  .map((a) => {
                    const file = new File([], a.filename, { type: a.mimeType });
                    (file as File & { path?: string; id?: string }).path =
                      a.path;
                    (file as File & { path?: string; id?: string }).id = a.id;
                    return file;
                  })}
                isStreaming={isStreaming()}
                disabled={!isActive()}
                permissionMode={permissionMode()}
                onPermissionModeChange={handlePermissionModeChange}
                rightPanelView={rightPanelView()}
                onToggleFileBrowser={() => toggleRightPanel("file")}
                onToggleGitPanel={() => toggleRightPanel("git")}
                mentionSuggestions={mentionSuggestions()}
                onSelectMention={applyMentionSelection}
                onDismissMentions={clearMentionSuggestions}
                slashSuggestions={slashSuggestions()}
                onSelectSlash={handleSelectSlash}
                onDismissSlash={() => setSlashSuggestions([])}
              />
            </Show>
          </div>
          <Show when={tcpModalOpen()}>
            <TcpForwardingModal
              sessionId={session()?.controlSessionId || props.sessionId}
              isOpen={tcpModalOpen()}
              onClose={() => setTcpModalOpen(false)}
            />
          </Show>
        </div>
      </div>
    );
  }
}

export default ChatView;
