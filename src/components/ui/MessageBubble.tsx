/**
 * Message Bubble Components
 *
 * Dedicated components for rendering different message types:
 * - MessageBubble: Main container with role-based styling
 * - UserMessage: User's messages
 * - AssistantMessage: AI assistant messages with thinking support
 * - SystemMessage: System notifications and tool outputs
 */

import {
  type Component,
  Show,
  createSignal,
} from "solid-js";
import { createClipboard } from "@solid-primitives/clipboard";
import {
  FiUser,
  FiTerminal,
  FiCopy,
  FiCheck,
} from "solid-icons/fi";
import { SolidMarkdown } from "solid-markdown";
import type { ChatMessage, ToolCall } from "~/stores/chatStore";
import { ToolCallList, ReasoningBlock, TerminalOutput } from "./EnhancedMessageComponents";

// ============================================================================
// Types
// ============================================================================

export interface MessageBubbleProps {
  message: ChatMessage;
  class?: string;
}

// ============================================================================
// User Message Component
// ============================================================================

const UserMessage: Component<{ content: string; timestamp?: number }> = (props) => {
  const [, , write] = createClipboard();
  const [copied, setCopied] = createSignal(false);

  const handleCopy = () => {
    write(props.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="flex flex-col gap-1.5 items-end">
      {/* Avatar and metadata */}
      <div class="flex items-center gap-2 text-[11px] text-muted-foreground/70 px-1">
        <div class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-primary/30 bg-primary/15 text-primary">
          <FiUser size={13} />
        </div>
        <span class="font-medium tracking-wide uppercase text-[10px] opacity-80">
          You
        </span>
        <span class="opacity-30">•</span>
        <time class="opacity-60">
          {new Date(props.timestamp || Date.now()).toLocaleTimeString()}
        </time>
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
      </div>

      {/* Message bubble */}
      <div class="w-full max-w-[min(92vw,54rem)] rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-3">
        <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6">
          <SolidMarkdown
            children={props.content}
          />
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
  const [, , write] = createClipboard();
  const [copied, setCopied] = createSignal(false);

  const handleCopy = () => {
    write(props.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="flex flex-col gap-1.5 items-start group/bubble">
      {/* Avatar and metadata */}
      <div class="flex items-center gap-2 text-[11px] text-muted-foreground/70 px-1">
        <div class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-muted/70 text-muted-foreground">
          <FiTerminal size={13} />
        </div>
        <span class="font-medium tracking-wide uppercase text-[10px] opacity-80">
          Assistant
        </span>
        <span class="opacity-30">•</span>
        <time class="opacity-60">
          {new Date(props.timestamp || Date.now()).toLocaleTimeString()}
        </time>
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
      </div>

      {/* Message bubble */}
      <div class="w-full max-w-[min(92vw,54rem)] rounded-xl border border-border/60 bg-muted/50 px-3.5 py-3">
        {/* Thinking/Reasoning */}
        <Show when={props.thinking}>
          <div class="mb-3 pb-3 border-b border-border/50">
            <ReasoningBlock thinking={props.thinking} isStreaming={props.isStreaming} />
          </div>
        </Show>

        {/* Content */}
        <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6">
          <SolidMarkdown
            children={props.content}
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
                // For code blocks, return simple pre/code structure
                return (
                  <pre class="bg-base-300 rounded-lg p-3 overflow-x-auto text-xs">
                    <code>{codeString}</code>
                  </pre>
                );
              },
            }}
          />
        </div>

        {/* Tool Calls */}
        <Show when={props.toolCalls && props.toolCalls.length > 0}>
          <div class="mt-3 pt-3 border-t border-border/50">
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
  timestamp?: number;
}

const SystemMessage: Component<SystemMessageProps> = (props) => {
  return (
    <div class="flex flex-col gap-1.5 items-start opacity-80">
      {/* Metadata */}
      <div class="flex items-center gap-2 text-[11px] text-muted-foreground/70 px-1">
        <div class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
          <FiTerminal size={13} />
        </div>
        <span class="font-medium tracking-wide uppercase text-[10px] opacity-80">
          System
        </span>
        <span class="opacity-30">•</span>
        <time class="opacity-60">
          {new Date(props.timestamp || Date.now()).toLocaleTimeString()}
        </time>
      </div>

      {/* Message content */}
      <div class="w-full max-w-[min(92vw,54rem)] rounded-xl border border-border/70 bg-background/80 px-3.5 py-3">
        <SystemMessageContent content={props.content} />
      </div>
    </div>
  );
};

// ============================================================================
// System Message Content Parser
// ============================================================================

const SystemMessageContent: Component<{ content: string }> = (props) => {
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
    const cmdMatch = content.match(/(Command completed|Command failed|Command output): (.+)/s);
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
      when={isTerminalOutput()}
      fallback={
        <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6 text-muted-foreground">
          <SolidMarkdown children={props.content} />
        </div>
      }
    >
      <Show
        when={parseTerminalOutput()}
        fallback={
          <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6 text-muted-foreground">
            <SolidMarkdown children={props.content} />
          </div>
        }
      >
        {(parsed) => (
          <Show
            when={parsed().type === "tool"}
            fallback={
              <TerminalOutput
                output={parsed().command || ""}
                exitCode={parsed().status === "completed" ? 0 : parsed().status === "failed" ? 1 : undefined}
              />
            }
          >
            <div class="text-sm">
              <span class="font-mono text-xs text-info">[{parsed().toolName}]</span>
              <Show when={parsed().output}>
                <pre class="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                  {parsed().output}
                </pre>
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </Show>
  );
};

// ============================================================================
// Main Message Bubble Component
// ============================================================================

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const message = () => props.message;
  const isUser = () => message().role === "user";
  const isSystem = () => message().role === "system";

  return (
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
            timestamp={message().timestamp}
          />
        </Show>
      }
    >
      <UserMessage
        content={message().content}
        timestamp={message().timestamp}
      />
    </Show>
  );
};

// ============================================================================
// Export additional components for reuse
// ============================================================================

export { UserMessage, AssistantMessage, SystemMessage };
