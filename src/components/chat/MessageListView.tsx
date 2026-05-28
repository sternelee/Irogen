/**
 * MessageListView Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import {
  type Component,
  Show,
  For,
  createSignal,
  createMemo,
  createEffect,
} from "solid-js";
import { cn } from "~/lib/utils";
import type { ChatMessage } from "~/stores/chatStore";
import {
  FiTerminal,
  FiFile,
  FiAlertTriangle,
  FiCode,
  FiEye,
  FiChevronDown,
} from "solid-icons/fi";

interface MessageListViewProps {
  messages: ChatMessage[];
  isLoading?: boolean;
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

interface DateGroup {
  date: string;
  label: string;
  messages: ChatMessage[];
}

const formatDateLabel = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isToday) return "Today";
  if (isYesterday) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};

const groupMessagesByDate = (messages: ChatMessage[]): DateGroup[] => {
  const groups: Record<string, ChatMessage[]> = {};
  for (const message of messages) {
    const timestamp = message.timestamp || Date.now();
    const date = new Date(timestamp);
    const dateKey = date.toDateString();
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(message);
  }
  return Object.entries(groups).map(([dateKey, msgs]) => ({
    date: dateKey,
    label: formatDateLabel(new Date(dateKey)),
    messages: msgs,
  }));
};

const DateSeparator: Component<{ date: string }> = (props) => (
  <div class="flex items-center gap-3 py-4">
    <div class="flex-1 h-px bg-base-content/10" />
    <span class="text-[11px] font-medium text-base-content/40 px-2">
      {props.date}
    </span>
    <div class="flex-1 h-px bg-base-content/10" />
  </div>
);

interface ChatEmptyStateProps {
  agentType?: string;
  onSuggestionClick?: (suggestion: string) => void;
}

const conversationStarters = [
  { icon: FiCode, text: "Help me write a function", hint: "Generate code" },
  { icon: FiEye, text: "Review my code", hint: "Find issues" },
  { icon: FiFile, text: "Explain this file", hint: "Understand context" },
  { icon: FiAlertTriangle, text: "Debug this error", hint: "Fix problems" },
];

const ChatEmptyState: Component<ChatEmptyStateProps> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center min-h-[400px] px-4 sm:px-6 text-center">
      {/* Agent Avatar */}
      <div class="relative mb-6">
        <div class="w-20 h-20 sm:w-24 sm:h-24 border border-base-content/10 flex items-center justify-center">
          <FiTerminal size={36} class="text-base-content/60 sm:w-10 sm:h-10" />
        </div>
      </div>

      {/* Title */}
      <h3 class="text-xl sm:text-2xl font-bold tracking-tight mb-2">
        Ready to assist
      </h3>

      {/* Description */}
      <p class="text-sm text-base-content/50 max-w-md mb-6 leading-relaxed">
        Send a message to start chatting with{" "}
        <span class="font-medium text-base-content">
          {props.agentType || "your AI agent"}
        </span>
      </p>

      {/* Conversation Starters */}
      <div class="mb-8 w-full max-w-md">
        <p class="text-[10px] font-semibold uppercase tracking-widest text-base-content/40 mb-4">
          Try asking
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {conversationStarters.map((starter) => (
            <button
              type="button"
              onClick={() => props.onSuggestionClick?.(starter.text)}
              class="group flex items-center gap-3 px-4 py-3 border border-base-content/10 hover:border-base-content/40 text-left"
            >
              <div class="w-10 h-10 border border-base-content/10 flex items-center justify-center">
                <starter.icon size={18} class="text-base-content/60" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium truncate">{starter.text}</p>
                <p class="text-[10px] text-base-content/50">
                  {starter.hint}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard Shortcut Hint */}
      <div class="flex items-center gap-3 px-4 py-2 border border-base-content/10">
        <div class="flex items-center gap-1">
          <span class="border border-base-content/10 px-1.5 py-0.5 text-xs">Enter</span>
          <span class="text-xs text-base-content/50">to send</span>
        </div>
        <div class="w-px h-4 bg-base-content/10" />
        <div class="flex items-center gap-1">
          <span class="border border-base-content/10 px-1.5 py-0.5 text-xs">Shift</span>
          <span class="text-xs text-base-content/50">+</span>
          <span class="border border-base-content/10 px-1.5 py-0.5 text-xs">Enter</span>
          <span class="text-xs text-base-content/50">new line</span>
        </div>
      </div>
    </div>
  );
};

interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
  unreadCount?: number;
}

const ScrollToBottomButton: Component<ScrollToBottomButtonProps> = (props) => (
  <Show when={props.visible}>
    <button
      type="button"
      onClick={props.onClick}
      class="fixed bottom-24 right-4 sm:right-6 z-30 flex items-center gap-2 px-3 py-2 bg-white border border-base-content/10 text-xs font-medium"
    >
      <Show when={(props.unreadCount || 0) > 0}>
        <span class="bg-primary text-primary-content h-5 w-5 flex items-center justify-center text-[10px] font-bold">
          {props.unreadCount}
        </span>
      </Show>
      <FiChevronDown size={14} />
      <span class="hidden sm:inline">Latest</span>
    </button>
  </Show>
);

export const MessageListView: Component<MessageListViewProps> = (props) => {
  let scrollContainerRef: HTMLDivElement | undefined;
  const [isScrolledToBottom, setIsScrolledToBottom] = createSignal(true);
  const [showScrollButton, setShowScrollButton] = createSignal(false);
  const [lastScrollTop, setLastScrollTop] = createSignal(0);

  const groupedMessages = createMemo(() => groupMessagesByDate(props.messages));

  const handleScroll = () => {
    if (!scrollContainerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    const userScrolledUp = scrollTop < lastScrollTop() - 5;
    setIsScrolledToBottom(atBottom);
    setShowScrollButton(!atBottom && userScrolledUp);
    setLastScrollTop(scrollTop);
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (!scrollContainerRef) return;
    scrollContainerRef.scrollTo({
      top: scrollContainerRef.scrollHeight,
      behavior,
    });
    setShowScrollButton(false);
  };

  createEffect(() => {
    const msgCount = props.messages.length;
    if (msgCount > 0 && isScrolledToBottom()) {
      queueMicrotask(() => scrollToBottom());
    }
  });

  createEffect(() => {
    if (!props.isStreaming && isScrolledToBottom()) {
      queueMicrotask(() => scrollToBottom());
    }
  });

  return (
    <div class="relative flex-1 min-h-0 flex flex-col">
      <Show when={props.isLoading}>
        <div class="absolute inset-0 flex items-center justify-center bg-base-100/80 z-20">
          <div class="flex flex-col items-center gap-3">
            <span class="inline-block w-6 h-6 border-2 border-base-content/30 border-t-base-content/60" />
            <span class="text-xs font-medium text-base-content/50">
              Loading messages...
            </span>
          </div>
        </div>
      </Show>

      <Show
        when={props.messages.length > 0}
        fallback={
          <Show when={!props.isLoading}>
            <ChatEmptyState />
          </Show>
        }
      >
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          class="flex-1 overflow-y-auto px-4 sm:px-6 py-4"
        >
          <div class="max-w-3xl mx-auto">
            <For each={groupedMessages()}>
              {(group) => (
                <>
                  <DateSeparator date={group.label} />
                  <For each={group.messages}>
                    {(message) => (
                      <div class="py-3">
                        {/* Simple message display - individual message components handle role-based styling */}
                        <div
                          class={cn(
                            "text-sm leading-relaxed whitespace-pre-wrap break-words",
                            message.role === "user" && "text-right",
                          )}
                        >
                          {message.content}
                        </div>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>
          </div>
        </div>
      </Show>

      <ScrollToBottomButton
        visible={showScrollButton()}
        onClick={() => scrollToBottom()}
      />
    </div>
  );
};

export { ChatEmptyState };
