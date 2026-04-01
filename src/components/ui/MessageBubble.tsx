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
          <FiCheck size={14} class="text-success" />
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
    <div class="chat chat-end">
      <div class="chat-bubble chat-bubble-primary overflow-x-hidden">
        <div class="prose prose-sm max-w-none text-[15px] sm:text-sm selectable prose-invert break-words [overflow-wrap:anywhere]">
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
    <div class="chat chat-start">
      <div class="chat-bubble overflow-x-hidden">
        {/* Thinking/Reasoning */}
        <Show when={props.thinking}>
          <ReasoningBlock
            thinking={props.content}
            isStreaming={props.isStreaming}
          />
        </Show>

        {/* Content */}
        <div class="prose prose-sm max-w-none text-[15px] sm:text-sm selectable break-words [overflow-wrap:anywhere]">
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
          <div class="mt-3.5 pt-3.5 border-t border-base-content/10">
            <ToolCallList toolCalls={props.toolCalls!} />
          </div>
        </Show>
      </div>
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
    <div class="chat chat-start">
      <div class="chat-bubble chat-bubble-neutral overflow-x-hidden">
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
        <div class="space-y-2.5">
          <div class="text-[10px] font-bold uppercase tracking-wider text-info">
            Following
          </div>
          <For each={card.locations}>
            {(loc) => (
              <div class="flex items-center gap-2 rounded-lg border border-base-content/10 bg-base-200 px-3 py-2.5">
                <button
                  type="button"
                  class="flex-1 text-left text-[13px] sm:text-sm font-mono hover:text-primary transition-colors"
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
        <div class="space-y-2.5">
          <div class="text-[10px] font-bold uppercase tracking-wider text-warning">
            Edit Review
          </div>
          <div class="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] sm:text-sm font-mono break-all">
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
        <div class="space-y-2.5">
          <div class="text-[10px] font-bold uppercase tracking-wider text-success">
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
                  <label class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-base-content/5 cursor-pointer transition-colors">
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
        <div class="space-y-2.5">
          <div class="text-[10px] font-bold uppercase tracking-wider text-primary">
            Terminal
          </div>
          <div class="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-[13px] sm:text-sm">
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
                class="btn btn-ghost btn-xs h-8 min-h-8 text-error"
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
            <div class="prose prose-sm break-words [overflow-wrap:anywhere] text-[15px] sm:text-sm max-w-none leading-relaxed sm:leading-6 text-base-content/70 selectable">
              <SolidMarkdown
                children={normalizeEscapedLineBreaks(props.content)}
              />
            </div>
          }
        >
          <Show
            when={parseTerminalOutput()}
            fallback={
              <div class="prose prose-sm break-words [overflow-wrap:anywhere] text-[15px] sm:text-sm max-w-none leading-relaxed sm:leading-6 text-base-content/70 selectable">
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
                <div class="text-sm">
                  <span class="font-mono text-xs text-info">
                    [{parsed().toolName}]
                  </span>
                  <Show when={parsed().output}>
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
    <div class={cn("relative", props.class)}>
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

      {/* Top-right action button - only on mobile */}
      <Show when={isMobile()}>
        <button
          type="button"
          class="absolute top-2 right-2 btn btn-ghost btn-xs h-7 min-h-7 w-7 rounded-lg opacity-0 group-hover/bubble:opacity-60 hover:opacity-100 transition-opacity"
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
      </Show>

      {/* Action menu overlay */}
      <Show when={showActions()}>
        <div
          class="modal modal-bottom sm:modal-middle"
          classList={{ "modal-open": showActions() }}
        >
          <div class="modal-box p-4 pb-[max(env(safe-area-inset-bottom,0px),1rem)]">
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
          <button type="button" class="modal-backdrop" onClick={closeActions} />
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Export additional components for reuse
// ============================================================================

export { UserMessage, AssistantMessage, SystemMessage };
