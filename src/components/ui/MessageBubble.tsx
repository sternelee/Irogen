/**
 * MessageBubble Component
 *
 * LobeHub-inspired redesign:
 * - User: right-aligned primary pill with soft rounded corners
 * - Assistant: card-style with subtle shadow, header, collapsible thinking,
 *   animated tool calls, token badges, file ops, terminal embeds
 * - Hover-reveal actions toolbar
 * - Smooth transitions throughout
 */

import {
  type Component,
  Show,
  For,
  createSignal,
  createMemo,
  Switch,
  Match,
} from "solid-js";
import { cn } from "~/lib/utils";
import {
  FiCopy,
  FiCheck,
  FiMessageSquare,
  FiChevronDown,
  FiChevronRight,
  FiTool,
  FiTerminal,
  FiFile,
  FiEdit3,
  FiClock,
  FiRefreshCw,
} from "solid-icons/fi";
import { SolidMarkdown } from "solid-markdown";
import type { ChatMessage, SystemCard, ToolCall } from "~/stores/chatStore";
import { ShikiCodeBlock } from "./ShikiCodeBlock";

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m ago`;

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

function agentAvatarColor(name: string): string {
  const colors = [
    "bg-primary text-primary-content",
    "bg-secondary text-secondary-content",
    "bg-accent text-accent-content",
    "bg-info text-info-content",
    "bg-success text-success-content",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function agentInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

// ============================================================================
// Types
// ============================================================================

export interface MessageBubbleProps {
  message: ChatMessage;
  class?: string;
  isStreaming?: boolean;
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
// Status Dot Component (for ToolCall)
// ============================================================================

const ToolCallStatusDot: Component<{ status: ToolCall["status"] }> = (
  props,
) => {
  const dotClass = createMemo(() => {
    switch (props.status) {
      case "started":
      case "in_progress":
        return "tool-call-status-dot running";
      case "completed":
        return "tool-call-status-dot success";
      case "failed":
      case "cancelled":
        return "tool-call-status-dot error";
      default:
        return "tool-call-status-dot pending";
    }
  });

  const label = createMemo(() => {
    switch (props.status) {
      case "started":
        return "Starting…";
      case "in_progress":
        return "Running…";
      case "completed":
        return "Done";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      default:
        return "Pending";
    }
  });

  return (
    <div class="flex items-center gap-1.5">
      <span class={dotClass()} />
      <span class="text-[10px] text-base-content/40">{label()}</span>
    </div>
  );
};

// ============================================================================
// Tool Call Card
// ============================================================================

const ToolCallCard: Component<{
  toolCall: ToolCall;
}> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const isRunning = () =>
    props.toolCall.status === "started" ||
    props.toolCall.status === "in_progress";

  return (
    <div class="tool-call-card">
      <div
        class="tool-call-card-header cursor-pointer select-none"
        onClick={() => props.toolCall.output && setExpanded((v) => !v)}
      >
        <FiTool
          size={12}
          class={cn(
            "shrink-0",
            isRunning() ? "text-warning" : "text-base-content/40",
          )}
        />
        <span class="tool-call-name">{props.toolCall.toolName}</span>
        <ToolCallStatusDot status={props.toolCall.status} />
        <Show when={props.toolCall.output}>
          <span class="ml-auto text-base-content/30">
            {expanded() ? (
              <FiChevronDown size={12} />
            ) : (
              <FiChevronRight size={12} />
            )}
          </span>
        </Show>
      </div>
      <Show when={expanded() && props.toolCall.output}>
        <div class="tool-call-body">
          <div class="tool-call-output">{props.toolCall.output}</div>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Thinking Block
// ============================================================================

const ThinkingBlock: Component<{ content: string }> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [animating, setAnimating] = createSignal(false);

  const toggle = () => {
    if (open()) {
      setAnimating(true);
      setOpen(false);
      setTimeout(() => setAnimating(false), 300);
    } else {
      setOpen(true);
    }
  };

  return (
    <div class="thinking-block">
      <div
        class="thinking-block-header"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && toggle()}
      >
        <span
          class={cn("transition-transform duration-200", open() && "rotate-90")}
        >
          <FiChevronRight size={12} />
        </span>
        <span>Reasoning</span>
        <Show when={!open()}>
          <span class="ml-auto text-base-content/30 text-[10px]">
            {props.content.length} chars
          </span>
        </Show>
      </div>
      <Show when={open() || animating()}>
        <div
          class="thinking-block-content"
          classList={{
            "max-h-0 !pb-0": !open() && animating(),
            "max-h-[600px]": open(),
          }}
        >
          <div class="thinking-block-content-inner">
            <SolidMarkdown children={props.content} />
          </div>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Token Usage Badge
// ============================================================================

const TokenBadge: Component<{
  inputTokens?: number;
  outputTokens?: number;
}> = (props) => {
  const total = () => (props.inputTokens ?? 0) + (props.outputTokens ?? 0);
  if (!total()) return null;

  return (
    <span
      class="token-badge"
      title={`Input: ${props.inputTokens ?? 0}, Output: ${props.outputTokens ?? 0}`}
    >
      <FiClock size={9} />
      {total().toLocaleString()} tokens
    </span>
  );
};

// ============================================================================
// File Operation Indicator
// ============================================================================

const FileOperationIndicator: Component<{
  path: string;
  operation: string;
}> = (props) => {
  const statusClass = createMemo(() => {
    const op = props.operation.toLowerCase();
    if (op === "write" || op === "create") return "created";
    if (op === "delete") return "deleted";
    return "modified";
  });

  return (
    <div class="file-op-inline">
      <FiFile class="file-op-icon" />
      <span class="file-op-path">{props.path}</span>
      <span class={`file-op-status ${statusClass()}`}>{props.operation}</span>
    </div>
  );
};

// ============================================================================
// Terminal Embed
// ============================================================================

const TerminalEmbed: Component<{
  command: string;
  output: string;
  exitCode?: number;
}> = (props) => {
  return (
    <div class="terminal-embed">
      <div class="terminal-embed-header">
        <FiTerminal size={10} />
        <span class="truncate">{props.command}</span>
        <Show when={props.exitCode !== undefined}>
          <span
            class={cn(
              "ml-auto",
              props.exitCode === 0 ? "text-success" : "text-error",
            )}
          >
            exit {props.exitCode}
          </span>
        </Show>
      </div>
      <pre class="terminal-embed-body">{props.output}</pre>
    </div>
  );
};

// ============================================================================
// Progress Bar (Inline)
// ============================================================================

const ProgressInline: Component<{
  operation: string;
  progress: number;
  message?: string;
}> = (props) => {
  const pct = () => Math.round(props.progress * 100);

  return (
    <div class="progress-inline">
      <div class="progress-inline-header">
        <span class="progress-inline-label">{props.operation}</span>
        <span class="progress-inline-pct">{pct()}%</span>
      </div>
      <div class="progress-inline-bar">
        <div class="progress-inline-fill" style={{ width: `${pct()}%` }} />
      </div>
      <Show when={props.message}>
        <div class="progress-inline-msg">{props.message}</div>
      </Show>
    </div>
  );
};

// ============================================================================
// System Card Renderer
// ============================================================================

const SystemCardRenderer: Component<{
  systemCard: SystemCard;
  onOpenFileLocation?: (path: string, line?: number) => void;
  onApplyEditReview?: (path: string, action: "accept" | "reject") => void;
  onTerminalAction?: (
    terminalId: string,
    action: "attach" | "stop" | "status",
  ) => void;
}> = (props) => {
  return (
    <Switch>
      {/* Following Location */}
      <Match
        when={
          props.systemCard.type === "following" &&
          "locations" in props.systemCard
        }
      >
        <div class="mx-4 my-2 rounded-lg border border-info/20 bg-info/5 p-3">
          <div class="flex items-center gap-2 mb-2 text-xs font-medium text-base-content/60">
            <FiFile size={12} />
            <span>Following</span>
          </div>
          <For each={(props.systemCard as any).locations}>
            {(loc: { path: string; line?: number }) => (
              <button
                class="flex items-center gap-2 w-full text-left py-1 px-2 rounded text-xs font-mono text-base-content/50 hover:bg-base-200/50 hover:text-base-content transition-colors"
                onClick={() => props.onOpenFileLocation?.(loc.path, loc.line)}
              >
                <span class="truncate">{loc.path}</span>
                <Show when={loc.line}>
                  <span class="text-base-content/30 shrink-0">:{loc.line}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Match>

      {/* Edit Review */}
      <Match when={props.systemCard.type === "edit_review"}>
        <div class="mx-4 my-2 rounded-lg border border-warning/20 bg-warning/5 p-3">
          <div class="flex items-center gap-2 mb-2 text-xs font-medium text-base-content/60">
            <FiEdit3 size={12} />
            <span class="truncate">{(props.systemCard as any).path}</span>
          </div>
          <div class="flex gap-2">
            <button
              class="px-3 py-1 rounded text-xs font-medium bg-success text-success-content hover:brightness-110 transition-all"
              onClick={() =>
                props.onApplyEditReview?.(
                  (props.systemCard as any).path,
                  "accept",
                )
              }
            >
              Accept
            </button>
            <button
              class="px-3 py-1 rounded text-xs font-medium bg-error text-error-content hover:brightness-110 transition-all"
              onClick={() =>
                props.onApplyEditReview?.(
                  (props.systemCard as any).path,
                  "reject",
                )
              }
            >
              Reject
            </button>
          </div>
        </div>
      </Match>

      {/* TODO List */}
      <Match when={props.systemCard.type === "todo_list"}>
        <div class="card card-bordered bg-base-200/50 mx-4 my-2 p-3">
          <div class="text-xs font-medium text-base-content/60 mb-2">Todo</div>
          <For each={(props.systemCard as any).entries}>
            {(entry: { content: string; status: string }) => (
              <div class="flex items-center gap-2 py-1 text-xs text-base-content/50">
                <span
                  class={cn(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0",
                    entry.status === "completed"
                      ? "bg-success border-success"
                      : "border-base-content/30",
                  )}
                >
                  <Show when={entry.status === "completed"}>
                    <FiCheck size={8} class="text-success-content" />
                  </Show>
                </span>
                <span
                  classList={{
                    "line-through text-base-content/30":
                      entry.status === "completed",
                  }}
                >
                  {entry.content}
                </span>
              </div>
            )}
          </For>
        </div>
      </Match>

      {/* Terminal */}
      <Match when={props.systemCard.type === "terminal"}>
        <TerminalEmbed
          command={(props.systemCard as any).terminalId || "terminal"}
          output=""
        />
      </Match>
    </Switch>
  );
};

// ============================================================================
// User Message
// ============================================================================

const UserMessage: Component<{
  content: string;
  timestamp?: number;
  isStreaming?: boolean;
}> = (props) => {
  return (
    <div class="chat chat-end animate-fade-in">
      <Show when={props.timestamp}>
        <div class="chat-header text-[10px] text-base-content/30 opacity-70">
          {formatTimestamp(props.timestamp)}
        </div>
      </Show>
      <div class="chat-bubble chat-bubble-primary text-[14px] leading-relaxed p-3.5">
        <div class="prose prose-sm max-w-none">
          <SolidMarkdown children={props.content} />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Assistant Message
// ============================================================================

const AssistantMessage: Component<{
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  timestamp?: number;
  inputTokens?: number;
  outputTokens?: number;
  systemCard?: SystemCard;
  onQuote?: (content: string) => void;
  onResend?: (content: string) => void;
  onOpenFileLocation?: (path: string, line?: number) => void;
  onApplyEditReview?: (path: string, action: "accept" | "reject") => void;
  onTerminalAction?: (
    terminalId: string,
    action: "attach" | "stop" | "status",
  ) => void;
}> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const hasThinking = () => props.thinking && props.thinking.length > 0;
  const hasToolCalls = () => props.toolCalls && props.toolCalls.length > 0;
  const hasContent = () => props.content && props.content.length > 0;
  const hasActions = () => props.onQuote || props.onResend;

  return (
    <div class="group chat chat-start animate-fade-in">
      {/*
      <div class="chat-header">...</div>
      We put header inside card for richer layout
      */}
      <div class="card card-bordered bg-base-100 w-full max-w-[96%] shadow-sm">
        {/* Header */}
        <div class="flex items-center gap-2 px-4 pt-3 pb-1">
          <div
            class={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              agentAvatarColor("AI"),
            )}
          >
            {agentInitial("AI")}
          </div>
          <span class="text-xs font-semibold text-base-content">
            AI Assistant
          </span>
          <span class="text-[10px] text-base-content/40 ml-auto">
            {formatTimestamp(props.timestamp)}
          </span>
          <Show
            when={
              props.inputTokens !== undefined ||
              props.outputTokens !== undefined
            }
          >
            <TokenBadge
              inputTokens={props.inputTokens}
              outputTokens={props.outputTokens}
            />
          </Show>
        </div>

        {/* Thinking Block */}
        <Show when={hasThinking()}>
          <ThinkingBlock content={props.thinking!} />
        </Show>

        {/* Tool Calls */}
        <Show when={hasToolCalls()}>
          <div class="space-y-1 my-1">
            <For each={props.toolCalls}>
              {(toolCall) => <ToolCallCard toolCall={toolCall} />}
            </For>
          </div>
        </Show>

        {/* Text Content */}
        <Show when={hasContent()}>
          <div
            class={cn(
              "px-4 pb-3 pt-1 text-sm leading-relaxed",
              props.isStreaming && !hasToolCalls() && "streaming-cursor",
            )}
          >
            <div class="prose prose-sm max-w-none">
              <SolidMarkdown
                children={props.content}
                components={{
                  code: (codeProps: any) => {
                    const { children, className } = codeProps;
                    const isInline = !className;
                    if (isInline) {
                      return (
                        <code class="bg-base-200/70 px-1.5 py-0.5 rounded text-[13px] font-mono text-base-content/80">
                          {children}
                        </code>
                      );
                    }
                    const lang = className?.replace("language-", "") || "";
                    return (
                      <ShikiCodeBlock code={String(children)} language={lang} />
                    );
                  },
                  pre: (preProps: any) => <>{preProps.children}</>,
                }}
              />
            </div>
          </div>
        </Show>

        {/* System Card */}
        <Show when={props.systemCard}>
          <SystemCardRenderer
            systemCard={props.systemCard!}
            onOpenFileLocation={props.onOpenFileLocation}
            onApplyEditReview={props.onApplyEditReview}
            onTerminalAction={props.onTerminalAction}
          />
        </Show>
      </div>

      {/* Actions Bar (Hover Reveal) */}
      <Show when={hasActions() && !props.isStreaming}>
        <div class="chat-footer opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-1 px-1">
          {/* Copy */}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy message"
            aria-label="Copy message"
          >
            <Show when={copied()} fallback={<FiCopy size={13} />}>
              <FiCheck size={13} class="text-success" />
            </Show>
          </button>

          {/* Quote */}
          <Show when={props.onQuote}>
            <button
              type="button"
              onClick={() => props.onQuote?.(props.content)}
              title="Quote and reply"
              aria-label="Quote message"
            >
              <FiMessageSquare size={13} />
            </button>
          </Show>

          {/* Resend */}
          <Show when={props.onResend}>
            <button
              type="button"
              onClick={() => props.onResend?.(props.content)}
              title="Resend message"
              aria-label="Resend message"
            >
              <FiRefreshCw size={13} />
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Compact File Operation Message (shown standalone)
// ============================================================================

export const FileOperationMessage: Component<{
  path: string;
  operation: string;
}> = (props) => {
  return (
    <FileOperationIndicator path={props.path} operation={props.operation} />
  );
};

// ============================================================================
// Terminal Output Message (shown standalone)
// ============================================================================

export const TerminalOutputMessage: Component<{
  command: string;
  output: string;
  exitCode?: number;
}> = (props) => {
  return (
    <TerminalEmbed
      command={props.command}
      output={props.output}
      exitCode={props.exitCode}
    />
  );
};

// ============================================================================
// Progress Update Message (shown standalone)
// ============================================================================

export const ProgressUpdateMessage: Component<{
  operation: string;
  progress: number;
  message?: string;
}> = (props) => {
  return (
    <ProgressInline
      operation={props.operation}
      progress={props.progress}
      message={props.message}
    />
  );
};

// ============================================================================
// Message Skeleton
// ============================================================================

export const MessageSkeleton: Component = () => (
  <div class="message-skeleton px-4">
    <div class="message-skeleton-line w-full" />
    <div class="message-skeleton-line w-5/6" />
    <div class="message-skeleton-line w-2/3" />
  </div>
);

// ============================================================================
// Main MessageBubble Component
// ============================================================================

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const message = () => props.message;
  const role = () => message().role;
  const isAssistant = () => role() === "assistant" || role() === "system";

  return (
    <div
      class={cn(
        "flex px-3 sm:px-4",
        role() === "user" ? "justify-end" : "justify-start",
        props.class,
      )}
    >
      <Show
        when={isAssistant()}
        fallback={
          <UserMessage
            content={message().content}
            timestamp={message().timestamp}
            isStreaming={props.isStreaming}
          />
        }
      >
        <AssistantMessage
          content={message().content}
          thinking={message().thinking as string | undefined}
          toolCalls={message().toolCalls}
          isStreaming={props.isStreaming}
          timestamp={message().timestamp}
          systemCard={message().systemCard}
          onQuote={props.onQuote}
          onResend={props.onResend}
          onOpenFileLocation={props.onOpenFileLocation}
          onApplyEditReview={props.onApplyEditReview}
          onTerminalAction={props.onTerminalAction}
        />
      </Show>
    </div>
  );
};
