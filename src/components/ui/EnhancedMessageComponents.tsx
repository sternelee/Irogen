/**
 * Enhanced Message Components
 *
 * AI-native UI components inspired by Vercel AI Elements:
 * - ToolCallItem: Enhanced tool call display with status indicators
 * - ReasoningBlock: Collapsible reasoning/thinking display
 * - TerminalOutput: Terminal output with ANSI support
 */

import {
  type Component,
  type JSX,
  Show,
  createSignal,
  For,
  createMemo,
} from "solid-js";
import { cn } from "~/lib/utils";
import type { ToolCall } from "~/stores/chatStore";
import {
  FiTool,
  FiCheck,
  FiX,
  FiChevronDown,
  FiChevronRight,
  FiCopy,
  FiCheckCircle,
  FiAlertCircle,
  FiLoader,
  FiTerminal,
} from "solid-icons/fi";

// ============================================================================
// Tool Call Component
// ============================================================================

export interface ToolCallItemProps {
  toolCall: ToolCall;
  expanded?: boolean;
  class?: string;
}

const statusConfig = {
  started: {
    icon: FiLoader,
    label: "Started",
    class: "text-info",
    animate: true,
  },
  in_progress: {
    icon: FiLoader,
    label: "Running",
    class: "text-warning animate-spin",
    animate: true,
  },
  completed: {
    icon: FiCheckCircle,
    label: "Completed",
    class: "text-success",
    animate: false,
  },
  failed: {
    icon: FiAlertCircle,
    label: "Failed",
    class: "text-error",
    animate: false,
  },
  cancelled: {
    icon: FiX,
    label: "Cancelled",
    class: "text-muted-foreground",
    animate: false,
  },
};

export const ToolCallItem: Component<ToolCallItemProps> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(props.expanded ?? false);
  const [copied, setCopied] = createSignal(false);

  const config = createMemo(
    () => statusConfig[props.toolCall.status] || statusConfig.started,
  );
  const StatusIcon = config().icon;

  const hasOutput = () => !!props.toolCall.output;

  const handleCopy = async () => {
    if (props.toolCall.output) {
      await navigator.clipboard.writeText(props.toolCall.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatOutput = (output: string) => {
    // Truncate long outputs
    if (output.length > 500) {
      return output.slice(0, 500) + "\n... (truncated)";
    }
    return output;
  };

  return (
    <div
      class={cn(
        "rounded-lg border border-border bg-muted/30 overflow-hidden",
        props.class,
      )}
    >
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded())}
        class="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        {/* Status Icon */}
        <div class={cn("shrink-0", config().class)}>
          <StatusIcon size={14} />
        </div>

        {/* Tool Name */}
        <div class="flex items-center gap-1.5 flex-1 min-w-0">
          <FiTool size={12} class="text-muted-foreground shrink-0" />
          <span class="font-medium text-sm truncate">
            {props.toolCall.toolName}
          </span>
        </div>

        {/* Status Badge */}
        <span
          class={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
            config().class,
          )}
        >
          {config().label}
        </span>

        {/* Expand Icon */}
        <Show when={hasOutput()}>
          <div class="text-muted-foreground shrink-0">
            <Show when={isExpanded()} fallback={<FiChevronRight size={14} />}>
              <FiChevronDown size={14} />
            </Show>
          </div>
        </Show>
      </button>

      {/* Output - collapsible */}
      <Show when={isExpanded() && hasOutput()}>
        <div class="border-t border-border">
          <div class="flex items-center justify-between px-3 py-1.5 bg-muted/20">
            <span class="text-[10px] text-muted-foreground uppercase tracking-wide">
              Output
            </span>
            <button
              type="button"
              onClick={handleCopy}
              class="p-1 hover:bg-muted rounded transition-colors"
              title="Copy output"
            >
              <Show when={copied()} fallback={<FiCopy size={12} />}>
                <FiCheck size={12} class="text-success" />
              </Show>
            </button>
          </div>
          <pre class="px-3 py-2 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-60">
            {formatOutput(props.toolCall.output || "")}
          </pre>
        </div>
      </Show>

      {/* Timestamp */}
      <div class="px-3 py-1 border-t border-border bg-muted/10">
        <span class="text-[10px] text-muted-foreground/60">
          {new Date(props.toolCall.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};

// ============================================================================
// Tool Call List Component
// ============================================================================

export interface ToolCallListProps {
  toolCalls: ToolCall[];
  class?: string;
}

export const ToolCallList: Component<ToolCallListProps> = (props) => {
  return (
    <div class={cn("flex flex-col gap-2 mt-2", props.class)}>
      <For each={props.toolCalls}>
        {(toolCall) => <ToolCallItem toolCall={toolCall} />}
      </For>
    </div>
  );
};

// ============================================================================
// Reasoning Block Component
// ============================================================================

export interface ReasoningBlockProps {
  thinking?: string;
  isStreaming?: boolean;
  class?: string;
}

export const ReasoningBlock: Component<ReasoningBlockProps> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(false);

  return (
    <Show when={props.thinking}>
      <div
        class={cn(
          "rounded-lg border border-info/30 bg-info/5 overflow-hidden",
          props.class,
        )}
      >
        {/* Header */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded())}
          class="w-full flex items-center gap-2 px-3 py-2 hover:bg-info/10 transition-colors text-left"
        >
          <div class="text-info animate-pulse">
            <FiLoader size={14} />
          </div>
          <span class="text-sm font-medium text-info">Thinking</span>
          <Show when={props.isStreaming}>
            <span class="text-xs text-info/60 animate-pulse">...</span>
          </Show>
          <div class="flex-1" />
          <div class="text-muted-foreground">
            <Show when={isExpanded()} fallback={<FiChevronRight size={14} />}>
              <FiChevronDown size={14} />
            </Show>
          </div>
        </button>

        {/* Content */}
        <Show when={isExpanded()}>
          <div class="px-3 py-2 border-t border-info/20">
            <pre class="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
              {props.thinking}
            </pre>
          </div>
        </Show>
      </div>
    </Show>
  );
};

// ============================================================================
// Terminal Output Component
// ============================================================================

export interface TerminalOutputProps {
  output: string;
  command?: string;
  exitCode?: number;
  isStreaming?: boolean;
  class?: string;
}

export const TerminalOutput: Component<TerminalOutputProps> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(true);
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColor = () => {
    if (props.exitCode === 0) return "text-success";
    if (props.exitCode !== undefined) return "text-error";
    return "text-muted-foreground";
  };

  return (
    <div
      class={cn(
        "rounded-lg border border-border bg-base-300 overflow-hidden",
        props.class,
      )}
    >
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-2 bg-base-200 border-b border-border">
        <FiTerminal size={14} class="text-muted-foreground" />
        <span class="text-sm font-medium flex-1 truncate">
          {props.command || "Terminal Output"}
        </span>
        <Show when={props.exitCode !== undefined}>
          <span
            class={cn("text-xs px-1.5 py-0.5 rounded font-mono", statusColor())}
          >
            {props.exitCode}
          </span>
        </Show>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded())}
          class="p-1 hover:bg-muted rounded transition-colors"
        >
          <Show when={isExpanded()} fallback={<FiChevronRight size={14} />}>
            <FiChevronDown size={14} />
          </Show>
        </button>
        <button
          type="button"
          onClick={handleCopy}
          class="p-1 hover:bg-muted rounded transition-colors"
          title="Copy output"
        >
          <Show when={copied()} fallback={<FiCopy size={14} />}>
            <FiCheck size={14} class="text-success" />
          </Show>
        </button>
      </div>

      {/* Output */}
      <Show when={isExpanded()}>
        <div class="relative">
          <Show when={props.isStreaming}>
            <div class="absolute top-2 right-2">
              <span class="inline-flex h-2 w-2 rounded-full bg-info animate-ping" />
            </div>
          </Show>
          <pre class="px-3 py-2 text-xs font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-80">
            {props.output}
          </pre>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Empty State Component
// ============================================================================

// Icon type for SolidJS components
type IconComponent = Component<{ size?: number; class?: string }>;

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: IconComponent;
  action?: JSX.Element;
  class?: string;
}

export const EmptyState: Component<EmptyStateProps> = (props) => {
  return (
    <div
      class={cn(
        "flex flex-col items-center justify-center gap-3 p-8 text-center",
        props.class,
      )}
    >
      <Show when={props.icon}>
        <div class="text-muted-foreground/50">{props.icon!({ size: 48 })}</div>
      </Show>
      <Show when={props.title}>
        <h3 class="text-lg font-semibold">{props.title}</h3>
      </Show>
      <Show when={props.description}>
        <p class="text-sm text-muted-foreground max-w-sm">
          {props.description}
        </p>
      </Show>
      <Show when={props.action}>
        <div class="mt-2">{props.action}</div>
      </Show>
    </div>
  );
};

// ============================================================================
// Shimmer Loading Effect
// ============================================================================

export interface ShimmerProps {
  class?: string;
}

export const Shimmer: Component<ShimmerProps> = (props) => {
  return (
    <div
      class={cn(
        "animate-pulse bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]",
        props.class,
      )}
    />
  );
};

// ============================================================================
// Message Loading Skeleton
// ============================================================================

export const MessageSkeleton: Component<{ class?: string }> = (props) => {
  return (
    <div class={cn("flex flex-col gap-2", props.class)}>
      <div class="flex items-center gap-2">
        <Shimmer class="h-8 w-8 rounded-full" />
        <Shimmer class="h-3 w-20 rounded" />
      </div>
      <Shimmer class="h-20 w-full rounded-lg" />
    </div>
  );
};
