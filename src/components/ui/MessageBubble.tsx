/**
 * Message Bubble Components
 *
 * Clean, modern message bubbles inspired by OpenChamber.
 * Uses bg-primary, text-primary, border-border tokens.
 */

import { type Component, For, Show, createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "~/lib/utils";
import { createClipboard } from "@solid-primitives/clipboard";
import { FiCopy, FiCheck, FiMoreVertical } from "solid-icons/fi";
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
    <div class="flex justify-end">
      <div class="inline-block max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md bg-primary px-4 py-3 shadow-sm">
        <div class="prose prose-sm max-w-none text-[14px] leading-relaxed text-primary-contrast">
          <SolidMarkdown children={props.content} />
        </div>
      </div>
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
      <div class="inline-block rounded-2xl rounded-bl-md bg-muted/60 px-4 py-3 border border-border/50">
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
                return (
                  <ShikiCodeBlock code={codeString} language={match[1]} />
                );
              },
            }}
          />
        </div>
      </div>

      {/* Tool Calls */}
      <Show when={props.toolCalls && props.toolCalls.length > 0}>
        <div class="mt-1 pt-3 border-t border-border/50">
          <ToolCallList toolCalls={props.toolCalls!} />
        </div>
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
    <div class="flex flex-col gap-2 max-w-[85%] sm:max-w-[75%]">
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
        <div class="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
          <div class="inline-flex items-center rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
            Following
          </div>
          <For each={card.locations}>
            {(loc) => (
              <div class="flex items-center gap-2 rounded-lg border border-blue-500/15 bg-blue-500/8 px-3 py-2">
                <button
                  type="button"
                  class="flex-1 text-left text-sm font-mono hover:text-blue-500 transition-colors"
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
                    <span class="ml-1 opacity-50">:{loc.line}</span>
                  </Show>
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs h-7 min-h-7"
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
            class="btn btn-outline btn-sm w-full"
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
        <div class="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div class="inline-flex items-center rounded-md bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
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
                  <label class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-primary/10 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-primary checkbox-sm"
                      checked={checked()}
                      onChange={(e) =>
                        setTodoStates((prev) => ({
                          ...prev,
                          [index()]: e.currentTarget.checked,
                        }))
                      }
                    />
                    <span
                      class={`text-sm ${checked() ? "line-through opacity-50" : ""}`}
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
              class="btn btn-outline btn-sm w-full"
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
        <div class="rounded-xl border border-secondary/20 bg-secondary/5 p-3 space-y-2">
          <div class="inline-flex items-center rounded-md bg-secondary/15 px-2 py-0.5 text-xs font-semibold text-secondary">
            Terminal
          </div>
          <div class="rounded-lg border border-secondary/20 bg-secondary/8 px-3 py-2.5 text-sm text-foreground/80">
            <div class="font-mono break-all">{card.terminalId || "unknown"}</div>
            <div class="mt-1 opacity-60">
              {card.mode || "interactive/background"}{" "}
              {card.status ? `· ${card.status}` : ""}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-xs h-7"
              onClick={() => copyText(card.terminalId)}
            >
              Copy ID
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs h-7"
              onClick={() => props.onQuote?.(`terminal:${card.terminalId}`)}
            >
              Insert
            </button>
            <Show when={props.onTerminalAction}>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-7"
                onClick={() =>
                  props.onTerminalAction?.(card.terminalId, "attach")
                }
              >
                Attach
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-7"
                onClick={() =>
                  props.onTerminalAction?.(card.terminalId, "status")
                }
              >
                Status
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-7 text-red-500 hover:bg-red-500/10"
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
            <div class="inline-block rounded-xl bg-muted/40 border border-border/50 px-4 py-3">
              <div class="text-sm leading-relaxed text-foreground/70 whitespace-pre-wrap break-words">
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
              <div class="inline-block rounded-xl bg-muted/40 border border-border/50 px-4 py-3">
                <div class="text-sm leading-relaxed text-foreground/70 whitespace-pre-wrap break-words">
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
                    class="inline-flex items-center gap-2 hover:bg-muted/50 rounded-lg px-2 py-1 -ml-2 transition-colors"
                  >
                    <span class="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 font-mono text-xs text-blue-600 dark:text-blue-400">
                      [{parsed().toolName}]
                    </span>
                    <span class="text-muted-foreground">
                      {toolOutputExpanded() ? "▼" : "▶"}
                    </span>
                  </button>
                  <Show when={toolOutputExpanded() && parsed().output}>
                    <pre class="mt-2 text-xs opacity-60 whitespace-pre-wrap break-all">
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

  const copyAsMarkdown = async () => {
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

      {/* Hover action button */}
      <button
        type="button"
        class="pointer-events-none absolute top-0 right-2 opacity-0 group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 btn btn-ghost btn-xs h-7 w-7 rounded-lg bg-background/90 border border-border/50 shadow-sm"
        onClick={(e) => {
          e.stopPropagation();
          triggerHaptic();
          setShowActions(true);
        }}
        title="Message actions"
        aria-label="Message actions"
      >
        <FiMoreVertical size={12} />
      </button>

      {/* Action menu overlay */}
      <Show when={showActions()}>
        <Portal>
          <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            <button
              type="button"
              class="fixed inset-0 bg-black/40 backdrop-blur-sm -z-10"
              onClick={closeActions}
            />
            <div class="w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-background border border-border/50 p-4 shadow-2xl mb-safe">
              <div class="space-y-1">
                <Show when={isUser()}>
                  <button
                    type="button"
                    class="btn btn-ghost justify-start w-full"
                    onClick={resendMessage}
                  >
                    Resend
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn btn-ghost justify-start w-full"
                  onClick={quoteMessage}
                >
                  Quote to input
                </button>
                <Show when={!isUser() && firstCodeBlock()}>
                  <button
                    type="button"
                    class="btn btn-ghost justify-start w-full"
                    onClick={copyCodeBlock}
                  >
                    Copy code block
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn btn-ghost justify-start w-full"
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
