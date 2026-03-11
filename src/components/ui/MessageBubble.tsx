/**
 * Message Bubble Components
 *
 * Dedicated components for rendering different message types:
 * - MessageBubble: Main container with role-based styling
 * - UserMessage: User's messages
 * - AssistantMessage: AI assistant messages with thinking support
 * - SystemMessage: System notifications and tool outputs
 */

import { type Component, Show, createSignal } from "solid-js";
import { createClipboard } from "@solid-primitives/clipboard";
import { FiCopy, FiCheck, FiMoreVertical } from "solid-icons/fi";
import { SolidMarkdown } from "solid-markdown";
import type { ChatMessage, ToolCall } from "~/stores/chatStore";
import { isMobile } from "~/stores/deviceStore";
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
}

// ============================================================================
// User Message Component
// ============================================================================

const UserMessage: Component<{ content: string; timestamp?: number }> = (
  props,
) => {
  // hapi-style: user bubble aligned right with dark background
  const bubbleClass =
    "w-fit max-w-[92%] ml-auto rounded-xl bg-base-300 px-3 py-2 text-foreground shadow-sm";

  return (
    <div class="flex flex-col gap-1.5 items-end group/bubble">
      {/* Message bubble - hapi style */}
      <div class={bubbleClass}>
        <div class="flex items-end gap-2">
          <div class="flex-1 min-w-0">
            <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6 selectable">
              <SolidMarkdown children={props.content} />
            </div>
          </div>
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
    <div class="flex flex-col gap-1.5 items-start group/bubble">
      {/* Message bubble */}
      <div class="w-full max-w-[min(92vw,54rem)] rounded-xl border border-border/60 bg-muted/50 px-3.5 py-3">
        {/* Thinking/Reasoning */}
        <Show when={props.thinking}>
          <div class="mb-3 pb-3 border-b border-border/50">
            <ReasoningBlock
              thinking={props.content}
              isStreaming={props.isStreaming}
            />
          </div>
        </Show>

        {/* Content */}
        <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6 selectable">
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
                // Use CodeBlock with copy button
                return (
                  <CodeBlockWithCopy code={codeString} language={match[1]} />
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
      when={isTerminalOutput()}
      fallback={
        <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6 text-muted-foreground selectable">
          <SolidMarkdown children={props.content} />
        </div>
      }
    >
      <Show
        when={parseTerminalOutput()}
        fallback={
          <div class="prose prose-sm wrap-break-words text-[13px] sm:text-sm max-w-none leading-5 sm:leading-6 text-muted-foreground selectable">
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
                <pre class="mt-2 text-xs text-muted-foreground whitespace-pre-wrap break-all">
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
  const [showActions, setShowActions] = createSignal(false);

  const closeActions = () => setShowActions(false);

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message().content);
    } catch {
      // ignore clipboard failures
    } finally {
      closeActions();
    }
  };

  const quoteMessage = () => {
    props.onQuote?.(message().content);
    closeActions();
  };

  const resendMessage = () => {
    props.onResend?.(message().content);
    closeActions();
  };

  return (
    <div class={props.class}>
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

      <Show when={isMobile()}>
        <div class={`mt-1 flex ${isUser() ? "justify-end" : "justify-start"}`}>
          <button
            type="button"
            class="btn btn-ghost btn-xs h-8 min-h-8 w-8 rounded-lg opacity-60 hover:opacity-100"
            onClick={() => setShowActions(true)}
            title="Message actions"
            aria-label="Message actions"
          >
            <FiMoreVertical size={14} />
          </button>
        </div>
      </Show>

      <Show when={showActions()}>
        <div class="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            class="absolute inset-0 bg-black/45"
            aria-label="Close message actions"
            onClick={closeActions}
          />
          <div class="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-border/60 bg-base-100 p-3 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)] shadow-2xl">
            <div class="mb-2 px-1 text-xs text-muted-foreground/70">
              Message actions
            </div>
            <div class="flex flex-col gap-1">
              <button
                type="button"
                class="btn btn-ghost justify-start h-11 min-h-11"
                onClick={copyMessage}
              >
                Copy
              </button>
              <button
                type="button"
                class="btn btn-ghost justify-start h-11 min-h-11"
                onClick={quoteMessage}
              >
                Quote to input
              </button>
              <Show when={isUser()}>
                <button
                  type="button"
                  class="btn btn-ghost justify-start h-11 min-h-11"
                  onClick={resendMessage}
                >
                  Resend
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Export additional components for reuse
// ============================================================================

export { UserMessage, AssistantMessage, SystemMessage };
