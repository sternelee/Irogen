/**
 * Message Bubble Components
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import { type Component, For, Show, createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "~/lib/utils";
import { createClipboard } from "@solid-primitives/clipboard";
import { FiCopy, FiMessageSquare, FiMoreHorizontal } from "solid-icons/fi";
import { SolidMarkdown } from "solid-markdown";
import type { ChatMessage, SystemCard, ToolCall } from "~/stores/chatStore";
import { isMobile } from "~/stores/deviceStore";
import { HapticFeedback } from "~/utils/mobile";
import {
  ToolCallList,
  ReasoningBlock,
  TerminalOutput,
  FileEditDiff,
} from "./EnhancedMessageComponents";
import { ShikiCodeBlock } from "./ShikiCodeBlock";

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) return timeStr;
  const dateStr = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${dateStr} ${timeStr}`;
}

// ============================================================================
// Types
// ============================================================================

export interface MessageBubbleProps {
  message: ChatMessage;
  class?: string;
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

// ============================================================================
// User Message Component
// ============================================================================

const UserMessage: Component<{ content: string; timestamp?: number }> = (
  props,
) => {
  return (
    <div class="flex flex-col items-end gap-1">
      <div class="inline-block max-w-[85%] sm:max-w-[75%] bg-zinc-900 dark:bg-zinc-100 px-4 py-3">
        <div class="prose prose-sm max-w-none text-[14px] leading-relaxed text-white dark:text-zinc-900">
          <SolidMarkdown children={props.content} />
        </div>
      </div>
      <Show when={props.timestamp}>
        <span class="text-[10px] text-base-content/40 px-1">
          {formatTimestamp(props.timestamp)}
        </span>
      </Show>
    </div>
  );
};

// ============================================================================
// Assistant Message Component
// ============================================================================

interface AssistantMessageProps {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  timestamp?: number;
}

const StreamingCursor: Component = () => (
  <span class="inline-block ml-0.5 w-2 h-4 bg-base-content/40 align-middle" />
);

const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  return (
    <div class="flex flex-col gap-3 max-w-[90%]">
      {/* Thinking/Reasoning */}
      <Show when={props.thinking}>
        <ReasoningBlock
          thinking={props.content}
          isStreaming={props.isStreaming}
        />
      </Show>

      {/* Content */}
      <div class="inline-block px-4 py-3 border border-black/10">
        <div class="prose prose-sm max-w-none text-[14px] leading-relaxed text-foreground">
          <SolidMarkdown
            children={props.thinking ? undefined : props.content}
            components={{
              code({ inline, class: className, children, ...codeProps }) {
                const match = /language-(\w+)/.exec(className || "");
                const codeString = String(children).replace(/\n$/, "");
                if (inline || !match) {
                  return (
                    <code class={className} {...codeProps}>
                      {children}
                    </code>
                  );
                }
                return <ShikiCodeBlock code={codeString} language={match[1]} />;
              },
            }}
          />
          {/* Streaming cursor */}
          <Show when={props.isStreaming}>
            <StreamingCursor />
          </Show>
        </div>
      </div>

      {/* Tool Calls */}
      <Show when={props.toolCalls && props.toolCalls.length > 0}>
        <div class="mt-1 pt-3 border-t border-black/10">
          <ToolCallList toolCalls={props.toolCalls!} />
        </div>
      </Show>

      {/* Timestamp */}
      <Show when={props.timestamp}>
        <span class="text-[10px] text-base-content/40 px-1">
          {formatTimestamp(props.timestamp)}
        </span>
      </Show>
    </div>
  );
};

// ============================================================================
// System Message Component
// ============================================================================

interface SystemMessageProps {
  content: string;
  systemCard?: SystemCard;
  timestamp?: number;
  onQuote?: (content: string) => void;
  onToggleFileBrowser?: () => void;
  onSyncTodoList?: (content: string) => void;
  onOpenFileLocation?: (path: string, line?: number) => void;
  onApplyEditReview?: (path: string, action: "accept" | "reject") => void;
  onTerminalAction?: (
    terminalId: string,
    action: "attach" | "stop" | "status",
  ) => void;
}

const SystemMessage: Component<SystemMessageProps> = (props) => {
  return (
    <div class="flex flex-col gap-1 max-w-[85%] sm:max-w-[75%]">
      <SystemMessageContent
        content={props.content}
        systemCard={props.systemCard}
        onQuote={props.onQuote}
        onToggleFileBrowser={props.onToggleFileBrowser}
        onSyncTodoList={props.onSyncTodoList}
        onOpenFileLocation={props.onOpenFileLocation}
        onApplyEditReview={props.onApplyEditReview}
        onTerminalAction={props.onTerminalAction}
      />
      <Show when={props.timestamp}>
        <span class="text-[10px] text-base-content/40 px-1">
          {formatTimestamp(props.timestamp)}
        </span>
      </Show>
    </div>
  );
};

// ============================================================================
// System Message Content Parser
// ============================================================================

const normalizeEscapedLineBreaks = (value: string) =>
  value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");

const SystemMessageContent: Component<{
  content: string;
  systemCard?: SystemCard;
  onQuote?: (content: string) => void;
  onToggleFileBrowser?: () => void;
  onSyncTodoList?: (content: string) => void;
  onOpenFileLocation?: (path: string, line?: number) => void;
  onApplyEditReview?: (path: string, action: "accept" | "reject") => void;
  onTerminalAction?: (
    terminalId: string,
    action: "attach" | "stop" | "status",
  ) => void;
}> = (props) => {
  const [todoStates, setTodoStates] = createSignal<Record<number, boolean>>({});
  const [toolOutputExpanded, setToolOutputExpanded] = createSignal(false);
  const [, , write] = createClipboard();

  const copyText = async (text: string) => {
    try {
      await write(text);
    } catch {
      // ignore clipboard failures
    }
  };

  const renderSystemCard = () => {
    const card = props.systemCard;
    if (!card) return null;

    if (card.type === "following") {
      return (
        <div class="border border-blue-500/20 p-3 space-y-2">
          <div class="inline-flex items-center px-2 py-0.5 text-xs font-semibold text-blue-600 border border-blue-500/20">
            Following
          </div>
          <For each={card.locations}>
            {(loc) => (
              <div class="flex items-center gap-2 border border-blue-500/15 px-3 py-2">
                <button
                  type="button"
                  class="flex-1 text-left text-sm font-mono text-base-content/80 hover:text-blue-600"
                  onClick={() => {
                    if (props.onOpenFileLocation) {
                      props.onOpenFileLocation(loc.path, loc.line);
                    } else {
                      props.onQuote?.(
                        `@${loc.path}${loc.line ? `:${loc.line}` : ""}`,
                      );
                    }
                  }}
                >
                  {loc.path}
                  <Show when={loc.line !== undefined}>
                    <span class="ml-1 text-base-content/40">:{loc.line}</span>
                  </Show>
                </button>
                <button
                  type="button"
                  class="border border-black/10 px-2 py-1 text-xs hover:bg-base-200"
                  onClick={() =>
                    copyText(`${loc.path}${loc.line ? `:${loc.line}` : ""}`)
                  }
                >
                  Copy
                </button>
              </div>
            )}
          </For>
          <button
            type="button"
            class="border border-black/10 px-3 py-1.5 text-sm w-full hover:bg-base-200"
            onClick={() => props.onToggleFileBrowser?.()}
          >
            Open File Panel
          </button>
        </div>
      );
    }

    if (card.type === "edit_review") {
      return (
        <FileEditDiff
          path={card.path}
          oldText={card.oldText}
          newText={card.newText}
          onAccept={() => props.onApplyEditReview?.(card.path, "accept")}
          onReject={() => props.onApplyEditReview?.(card.path, "reject")}
        />
      );
    }

    if (card.type === "todo_list") {
      const syncTodoToAgent = () => {
        const current = todoStates();
        const lines = card.entries.map((entry, idx) => {
          const checked =
            current[idx] !== undefined
              ? current[idx]
              : entry.status === "completed";
          return `- [${checked ? "x" : " "}] ${entry.content}`;
        });
        props.onSyncTodoList?.(`TODO update:\n${lines.join("\n")}`);
      };

      return (
        <div class="border border-black/10 p-3 space-y-2">
          <div class="inline-flex items-center px-2 py-0.5 text-xs font-semibold text-base-content/60 border border-black/10">
            TODO List
          </div>
          <div class="space-y-1">
            <For each={card.entries}>
              {(entry, index) => {
                const initialDone = entry.status === "completed";
                const checked = () =>
                  todoStates()[index()] !== undefined
                    ? todoStates()[index()]!
                    : initialDone;
                return (
                  <label class="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      class="w-4 h-4 border border-black/20"
                      checked={checked()}
                      onChange={(e) =>
                        setTodoStates((prev) => ({
                          ...prev,
                          [index()]: e.currentTarget.checked,
                        }))
                      }
                    />
                    <span
                      class={`text-sm ${checked() ? "line-through text-base-content/40" : ""}`}
                    >
                      {entry.content}
                    </span>
                  </label>
                );
              }}
            </For>
          </div>
          <Show when={props.onSyncTodoList}>
            <button
              type="button"
              class="border border-black/10 px-3 py-1.5 text-sm w-full hover:bg-base-200"
              onClick={syncTodoToAgent}
            >
              Sync to Agent
            </button>
          </Show>
        </div>
      );
    }

    if (card.type === "terminal") {
      return (
        <div class="border border-black/20 p-3 space-y-2">
          <div class="inline-flex items-center px-2 py-0.5 text-xs font-semibold text-base-content/60 border border-black/20">
            Terminal
          </div>
          <div class="border border-black/10 bg-base-200 px-3 py-2.5 text-sm text-base-content/80">
            <div class="font-mono break-all">
              {card.terminalId || "unknown"}
            </div>
            <div class="mt-1 text-base-content/50">
              {card.mode || "interactive/background"}{" "}
              {card.status ? `· ${card.status}` : ""}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="border border-black/10 px-2 py-1 text-xs hover:bg-base-200"
              onClick={() => copyText(card.terminalId)}
            >
              Copy ID
            </button>
            <button
              type="button"
              class="border border-black/10 px-2 py-1 text-xs hover:bg-base-200"
              onClick={() => props.onQuote?.(`terminal:${card.terminalId}`)}
            >
              Insert
            </button>
            <Show when={props.onTerminalAction}>
              <button
                type="button"
                class="border border-black/10 px-2 py-1 text-xs hover:bg-base-200"
                onClick={() =>
                  props.onTerminalAction?.(card.terminalId, "attach")
                }
              >
                Attach
              </button>
              <button
                type="button"
                class="border border-black/10 px-2 py-1 text-xs hover:bg-base-200"
                onClick={() =>
                  props.onTerminalAction?.(card.terminalId, "status")
                }
              >
                Status
              </button>
              <button
                type="button"
                class="border border-red-500/20 px-2 py-1 text-xs text-red-500 hover:bg-red-500 hover:text-white"
                onClick={() =>
                  props.onTerminalAction?.(card.terminalId, "stop")
                }
              >
                Stop
              </button>
            </Show>
          </div>
        </div>
      );
    }

    return null;
  };

  // Check if it's a terminal output format
  const isTerminalOutput = () => {
    const content = props.content;
    return (
      content.includes("[Tool:") ||
      content.includes("Command completed:") ||
      content.includes("Command failed:") ||
      content.includes("Command output:")
    );
  };

  // Parse terminal output
  const parseTerminalOutput = () => {
    const content = props.content;

    // Tool started/completed/failed pattern
    const toolMatch = content.match(/\[Tool: (.+?)\](.*)/s);
    if (toolMatch) {
      const toolName = toolMatch[1];
      const rest = toolMatch[2].trim();
      return {
        type: "tool",
        toolName,
        output: rest,
      };
    }

    // Command patterns
    const cmdMatch = content.match(
      /(Command completed|Command failed|Command output): (.+)/s,
    );
    if (cmdMatch) {
      return {
        type: "command",
        status: cmdMatch[1].replace("Command ", "").toLowerCase(),
        command: cmdMatch[2],
      };
    }

    return null;
  };

  return (
    <Show
      when={props.systemCard}
      fallback={
        <Show
          when={isTerminalOutput()}
          fallback={
            <div class="inline-block bg-base-200 border border-black/10 px-4 py-3">
              <div class="text-sm leading-relaxed text-base-content/70 whitespace-pre-wrap break-words">
                <SolidMarkdown
                  children={normalizeEscapedLineBreaks(props.content)}
                />
              </div>
            </div>
          }
        >
          <Show
            when={parseTerminalOutput()}
            fallback={
              <div class="inline-block bg-base-200 border border-black/10 px-4 py-3">
                <div class="text-sm leading-relaxed text-base-content/70 whitespace-pre-wrap break-words">
                  <SolidMarkdown
                    children={normalizeEscapedLineBreaks(props.content)}
                  />
                </div>
              </div>
            }
          >
            {(parsed) => (
              <Show
                when={parsed().type === "tool"}
                fallback={
                  <TerminalOutput
                    output={parsed().command || ""}
                    exitCode={
                      parsed().status === "completed"
                        ? 0
                        : parsed().status === "failed"
                          ? 1
                          : undefined
                    }
                  />
                }
              >
                <div class="text-sm">
                  <button
                    type="button"
                    onClick={() => setToolOutputExpanded(!toolOutputExpanded())}
                    class="inline-flex items-center gap-2 hover:bg-base-200 px-2 py-1 -ml-2"
                  >
                    <span class="inline-flex items-center bg-blue-500/10 px-2 py-0.5 font-mono text-xs text-blue-600">
                      [{parsed().toolName}]
                    </span>
                    <span class="text-base-content/50">
                      {toolOutputExpanded() ? "▼" : "▶"}
                    </span>
                  </button>
                  <Show when={toolOutputExpanded() && parsed().output}>
                    <pre class="mt-2 text-xs text-base-content/50 whitespace-pre-wrap break-all">
                      {normalizeEscapedLineBreaks(parsed().output || "")}
                    </pre>
                  </Show>
                </div>
              </Show>
            )}
          </Show>
        </Show>
      }
    >
      {renderSystemCard()}
    </Show>
  );
};

// ============================================================================
// Main Message Bubble Component
// ============================================================================

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const message = () => props.message;
  const isUser = createMemo(() => message().role === "user");
  const isSystem = createMemo(() => message().role === "system");
  const [showActions, setShowActions] = createSignal(false);
  const firstCodeBlock = createMemo(() => {
    const match = message().content.match(/```(?:\w+)?\n([\s\S]*?)```/);
    return match?.[1]?.trim() || null;
  });

  const closeActions = () => setShowActions(false);
  const triggerHaptic = () => {
    if (isMobile()) {
      HapticFeedback.selection();
    }
  };

  const copyMessage = async () => {
    triggerHaptic();
    try {
      await navigator.clipboard.writeText(message().content);
    } catch {
      // ignore clipboard failures
    } finally {
      closeActions();
    }
  };

  const copyCodeBlock = async () => {
    const code = firstCodeBlock();
    if (!code) return;
    triggerHaptic();
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // ignore clipboard failures
    } finally {
      closeActions();
    }
  };

  const quoteMessage = () => {
    triggerHaptic();
    props.onQuote?.(message().content);
    closeActions();
  };

  const resendMessage = () => {
    triggerHaptic();
    props.onResend?.(message().content);
    closeActions();
  };

  return (
    <div class={cn("group/bubble relative", props.class)}>
      <div>
        <Show
          when={isUser()}
          fallback={
            <Show
              when={isSystem()}
              fallback={
                <AssistantMessage
                  content={message().content}
                  thinking={message().thinking ? "Thinking..." : undefined}
                  toolCalls={message().toolCalls}
                  isStreaming={message().thinking}
                  timestamp={message().timestamp}
                />
              }
            >
              <SystemMessage
                content={message().content}
                systemCard={message().systemCard}
                timestamp={message().timestamp}
                onQuote={props.onQuote}
                onToggleFileBrowser={props.onToggleFileBrowser}
                onSyncTodoList={props.onSyncTodoList}
                onOpenFileLocation={props.onOpenFileLocation}
                onApplyEditReview={props.onApplyEditReview}
                onTerminalAction={props.onTerminalAction}
              />
            </Show>
          }
        >
          <UserMessage
            content={message().content}
            timestamp={message().timestamp}
          />
        </Show>
      </div>

      {/* Desktop hover actions */}
      <div class="absolute -top-2 right-2 hidden sm:flex items-center gap-1 opacity-0 group-hover/bubble:opacity-100">
        <button
          type="button"
          onClick={quoteMessage}
          class="p-2 bg-background border border-black/10 hover:bg-base-200"
          title="Quote"
          aria-label="Quote"
        >
          <FiMessageSquare size={14} />
        </button>
        <button
          type="button"
          onClick={copyMessage}
          class="p-2 bg-background border border-black/10 hover:bg-base-200"
          title="Copy"
          aria-label="Copy"
        >
          <FiCopy size={14} />
        </button>
      </div>

      {/* Mobile action trigger */}
      <div class="flex sm:hidden absolute -top-1 right-0">
        <button
          type="button"
          onClick={() => setShowActions(true)}
          class="p-2 text-base-content/40 hover:text-base-content"
          aria-label="Message actions"
        >
          <FiMoreHorizontal size={16} />
        </button>
      </div>

      {/* Action menu overlay */}
      <Show when={showActions()}>
        <Portal>
          <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            <button
              type="button"
              class="absolute inset-0 bg-black/50"
              onClick={closeActions}
              aria-label="Close action menu"
            />
            <div class="w-full max-w-sm border-t border-black/10 bg-background p-4 mb-safe">
              <div class="space-y-1">
                <Show when={isUser()}>
                  <button
                    type="button"
                    class="block w-full text-left px-3 py-3 text-sm hover:bg-base-200"
                    onClick={resendMessage}
                  >
                    Resend
                  </button>
                </Show>
                <button
                  type="button"
                  class="block w-full text-left px-3 py-3 text-sm hover:bg-base-200"
                  onClick={quoteMessage}
                >
                  Quote to input
                </button>
                <Show when={!isUser() && firstCodeBlock()}>
                  <button
                    type="button"
                    class="block w-full text-left px-3 py-3 text-sm hover:bg-base-200"
                    onClick={copyCodeBlock}
                  >
                    Copy code block
                  </button>
                </Show>
                <button
                  type="button"
                  class="block w-full text-left px-3 py-3 text-sm hover:bg-base-200"
                  onClick={copyMessage}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

// ============================================================================
// Export additional components for reuse
// ============================================================================

export { UserMessage, AssistantMessage, SystemMessage };
