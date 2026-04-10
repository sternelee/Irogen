/**
 * Message Bubble Components
 *
 * Dedicated components for rendering different message types:
 * - MessageBubble: Main container with role-based styling
 * - UserMessage: User's messages
 * - AssistantMessage: AI assistant messages with thinking support
 * - SystemMessage: System notifications and tool outputs
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
} from "./EnhancedMessageComponents";

// ============================================================================
// Code Block with Copy Button (inspired by hapi)
// ============================================================================

interface CodeBlockProps {
  code: string;
  language?: string;
}

const CodeBlockWithCopy: Component<CodeBlockProps> = (props) => {
  const [copied, setCopied] = createSignal(false);
  const [, , write] = createClipboard();

  const handleCopy = () => {
    write(props.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="relative min-w-0 max-w-full">
      <button
        type="button"
        onClick={handleCopy}
        class="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground hover:bg-base-200 hover:text-foreground transition-colors z-10"
        title="Copy code"
      >
        <Show when={copied()} fallback={<FiCopy size={14} />}>
          <FiCheck size={14} class="text-success-content" />
        </Show>
      </button>
      <div class="min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden rounded-md bg-base-300">
        <pre class="m-0 w-max min-w-full p-2 pr-8 text-xs font-mono">
          <code class="block">{props.code}</code>
        </pre>
      </div>
    </div>
  );
};

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
    <div class="chat chat-end overflow-x-hidden">
      <div class="prose prose-sm max-w-none text-[14px] sm:text-sm leading-relaxed sm:leading-6 selectable prose-invert break-words [overflow-wrap:anywhere]">
        <SolidMarkdown children={props.content} />
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
    <div class="chat chat-start overflow-x-hidden">
      {/* Thinking/Reasoning */}
      <Show when={props.thinking}>
        <ReasoningBlock
          thinking={props.content}
          isStreaming={props.isStreaming}
        />
      </Show>

      {/* Content */}
      <div class="prose prose-sm max-w-none text-[14px] sm:text-sm leading-relaxed sm:leading-6 selectable break-words [overflow-wrap:anywhere]">
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
                <CodeBlockWithCopy code={codeString} language={match[1]} />
              );
            },
          }}
        />
      </div>

      {/* Tool Calls */}
      <Show when={props.toolCalls && props.toolCalls.length > 0}>
        <div class="mt-2.5 pt-2.5 sm:mt-3.5 sm:pt-3.5 border-t border-base-content/10">
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
    <div class="chat chat-start overflow-x-hidden">
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
  const [showDiff, setShowDiff] = createSignal(false);
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
        <div class="space-y-2.5 rounded-lg border border-info/30 bg-info/8 p-3">
          <div class="inline-flex items-center rounded-md bg-info/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-info ring-1 ring-info/25">
            Following
          </div>
          <For each={card.locations}>
            {(loc) => (
              <div class="flex items-center gap-2 rounded-lg border border-info/20 bg-info/12 px-3 py-2.5">
                <button
                  type="button"
                  class="flex-1 text-left text-[13px] sm:text-sm font-mono hover:text-info transition-colors"
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
                  class="btn btn-ghost btn-xs h-8 min-h-8"
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
            class="btn btn-outline btn-sm w-full sm:w-auto"
            onClick={() => props.onToggleFileBrowser?.()}
          >
            Open File Panel
          </button>
        </div>
      );
    }

    if (card.type === "edit_review") {
      const diffText = `--- old\n+++ new\n-${card.oldText}\n+${card.newText}`;
      return (
        <div class="space-y-2.5 rounded-lg border border-accent/30 bg-accent/8 p-3">
          <div class="inline-flex items-center rounded-md bg-accent/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-accent ring-1 ring-accent/25">
            Edit Review
          </div>
          <div class="rounded-lg border border-accent/20 bg-accent/12 px-3 py-2 text-[13px] sm:text-sm font-mono break-all text-base-content/80">
            {card.path}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-xs h-8 min-h-8"
              onClick={() => setShowDiff((v) => !v)}
            >
              {showDiff() ? "Hide Diff" : "Show Diff"}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs h-8 min-h-8"
              onClick={() => copyText(diffText)}
            >
              Copy Diff
            </button>
            <Show when={props.onApplyEditReview}>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-8 min-h-8"
                onClick={() => props.onApplyEditReview?.(card.path, "accept")}
              >
                Accept
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-8 min-h-8"
                onClick={() => props.onApplyEditReview?.(card.path, "reject")}
              >
                Reject
              </button>
            </Show>
          </div>
          <Show when={showDiff()}>
            <div class="min-w-0 w-full max-w-full overflow-x-auto overflow-y-hidden rounded-md bg-base-300">
              <pre class="m-0 w-max min-w-full p-2.5 text-[11px] sm:text-xs font-mono">
                <code class="block whitespace-pre-wrap break-all">
                  {diffText}
                </code>
              </pre>
            </div>
          </Show>
        </div>
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
        <div class="space-y-2.5 rounded-lg border border-primary/30 bg-primary/8 p-3">
          <div class="inline-flex items-center rounded-md bg-primary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/25">
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
                  <label class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-primary/15 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-primary checkbox-sm sm:checkbox-xs"
                      checked={checked()}
                      onChange={(e) =>
                        setTodoStates((prev) => ({
                          ...prev,
                          [index()]: e.currentTarget.checked,
                        }))
                      }
                    />
                    <span
                      class={`text-[15px] sm:text-sm ${checked() ? "line-through opacity-50" : ""}`}
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
              class="btn btn-outline btn-sm w-full sm:w-auto"
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
        <div class="space-y-2.5 rounded-lg border border-secondary/30 bg-secondary/8 p-3">
          <div class="inline-flex items-center rounded-md bg-secondary/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-secondary ring-1 ring-secondary/25">
            Terminal
          </div>
          <div class="rounded-lg border border-secondary/20 bg-secondary/12 px-3 py-2.5 text-[13px] sm:text-sm text-base-content/80">
            <div class="font-mono break-all">
              {card.terminalId || "unknown"}
            </div>
            <div class="mt-1 opacity-60">
              {card.mode || "interactive/background"}{" "}
              {card.status ? `· ${card.status}` : ""}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-xs h-8 min-h-8"
              onClick={() => copyText(card.terminalId)}
            >
              Copy ID
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs h-8 min-h-8"
              onClick={() => props.onQuote?.(`terminal:${card.terminalId}`)}
            >
              Insert
            </button>
            <Show when={props.onTerminalAction}>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-8 min-h-8"
                onClick={() =>
                  props.onTerminalAction?.(card.terminalId, "attach")
                }
              >
                Attach
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-8 min-h-8"
                onClick={() =>
                  props.onTerminalAction?.(card.terminalId, "status")
                }
              >
                Status
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs h-8 min-h-8 text-error hover:bg-error/10"
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
            <div class="prose prose-sm break-words [overflow-wrap:anywhere] text-[14px] sm:text-sm max-w-none leading-relaxed sm:leading-6 text-base-content/70 selectable">
              <SolidMarkdown
                children={normalizeEscapedLineBreaks(props.content)}
              />
            </div>
          }
        >
          <Show
            when={parseTerminalOutput()}
            fallback={
              <div class="prose prose-sm break-words [overflow-wrap:anywhere] text-[14px] sm:text-sm max-w-none leading-relaxed sm:leading-6 text-base-content/70 selectable">
                <SolidMarkdown
                  children={normalizeEscapedLineBreaks(props.content)}
                />
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
                <div class="text-xs sm:text-sm">
                  <span class="inline-flex items-center rounded-md bg-info/12 px-2 py-1 font-mono text-xs text-info ring-1 ring-info/15">
                    [{parsed().toolName}]
                  </span>
                  <Show when={parsed().output}>
                    <pre class="mt-1.5 sm:mt-2 text-[11px] sm:text-xs opacity-60 whitespace-pre-wrap break-all">
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

      <button
        type="button"
        class="pointer-events-none absolute top-1.5 right-1.5 btn btn-ghost btn-xs h-7 min-h-7 w-7 rounded-lg border border-base-content/15 bg-base-100 text-base-content shadow-md shadow-black/10 backdrop-blur-md opacity-0 transition-opacity group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-75 hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 sm:hidden"
        onClick={(e) => {
          e.stopPropagation();
          triggerHaptic();
          setShowActions(true);
        }}
        title="Message actions"
        aria-label="Message actions"
      >
        <FiMoreVertical size={14} />
      </button>

      {/* Action menu overlay */}
      <Show when={showActions()}>
        <Portal>
          <div
            class="modal modal-bottom sm:modal-middle"
            classList={{ "modal-open": showActions() }}
          >
            <div class="modal-box p-3 sm:p-4 pb-[max(env(safe-area-inset-bottom,0px),1rem)]">
              <h3 class="text-sm font-bold mb-3">Message actions</h3>
              <div class="flex flex-col gap-1">
                <Show when={isUser()}>
                  <button
                    type="button"
                    class="btn btn-ghost justify-start"
                    onClick={resendMessage}
                  >
                    Resend
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn btn-ghost justify-start"
                  onClick={quoteMessage}
                >
                  Quote to input
                </button>
                <Show when={!isUser() && firstCodeBlock()}>
                  <button
                    type="button"
                    class="btn btn-ghost justify-start"
                    onClick={copyCodeBlock}
                  >
                    Copy code block
                  </button>
                </Show>
                <Show when={isUser() && firstCodeBlock()}>
                  <button
                    type="button"
                    class="btn btn-ghost justify-start"
                    onClick={copyCodeBlock}
                  >
                    Copy code block
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn btn-ghost justify-start"
                  onClick={copyMessage}
                >
                  Copy
                </button>
                <button
                  type="button"
                  class="btn btn-ghost justify-start"
                  onClick={copyAsMarkdown}
                >
                  Copy as Markdown
                </button>
              </div>
              <div class="modal-action">
                <button type="button" class="btn btn-sm" onClick={closeActions}>
                  Close
                </button>
              </div>
            </div>
            <button
              type="button"
              class="modal-backdrop"
              onClick={closeActions}
            />
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
