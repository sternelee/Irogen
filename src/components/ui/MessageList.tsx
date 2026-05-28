/**
 * Chat Message List with Date Separators
 *
 * Enhanced message list with:
 * - Date grouping
 * - Auto-scroll management
 * - Loading skeletons
 */

import { type Component, Show, For, createMemo } from "solid-js";
import { cn } from "~/lib/utils";
import type { ChatMessage } from "~/stores/chatStore";
import { MessageSkeleton } from "./EnhancedMessageComponents";

// ============================================================================
// Types
// ============================================================================

interface DateGroup {
  date: string;
  label: string;
  messages: ChatMessage[];
}

// ============================================================================
// Helper Functions
// ============================================================================

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

    if (!groups[dateKey]) {
      groups[dateKey] = [];
    }
    groups[dateKey].push(message);
  }

  return Object.entries(groups).map(([dateKey, msgs]) => ({
    date: dateKey,
    label: formatDateLabel(new Date(dateKey)),
    messages: msgs,
  }));
};

// ============================================================================
// Date Separator Component
// ============================================================================

export const DateSeparator: Component<{ date: string }> = (props) => {
  return (
    <div class="flex items-center gap-4 py-4">
      <div class="flex-1 h-px bg-border" />
      <span class="text-xs font-medium text-base-content/50 px-2">
        {props.date}
      </span>
      <div class="flex-1 h-px bg-border" />
    </div>
  );
};

// ============================================================================
// Message List Component
// ============================================================================

export interface MessageListProps {
  messages: ChatMessage[];
  renderMessage: (message: ChatMessage, index: number) => any;
  isLoading?: boolean;
  class?: string;
}

export const MessageList: Component<MessageListProps> = (props) => {
  // Group messages by date
  const groupedMessages = createMemo(() => groupMessagesByDate(props.messages));

  return (
    <div class={cn("flex flex-col", props.class)}>
      {/* Loading State */}
      <Show when={props.isLoading}>
        <div class="space-y-4 p-4">
          <MessageSkeleton />
          <MessageSkeleton />
          <MessageSkeleton />
        </div>
      </Show>

      {/* Empty State */}
      <Show when={!props.isLoading && props.messages.length === 0}>
        <div class="flex-1 flex items-center justify-center min-h-[400px]">
          <div class="text-center max-w-sm">
            <div class="text-6xl mb-4">💬</div>
            <h3 class="text-lg font-semibold mb-2">No messages yet</h3>
            <p class="text-sm text-base-content/50">
              Start a conversation by sending a message below
            </p>
          </div>
        </div>
      </Show>

      {/* Messages with Date Separators */}
      <Show when={!props.isLoading && props.messages.length > 0}>
        <For each={groupedMessages()}>
          {(group) => (
            <>
              <DateSeparator date={group.label} />
              <For each={group.messages}>
                {(message, index) => props.renderMessage(message, index())}
              </For>
            </>
          )}
        </For>
      </Show>
    </div>
  );
};

// ============================================================================
// Auto Scroll to Bottom Button
// ============================================================================

export interface ScrollToBottomButtonProps {
  visible: boolean;
  onClick: () => void;
  class?: string;
}

export const ScrollToBottomButton: Component<ScrollToBottomButtonProps> = (props) => {
  return (
    <Show when={props.visible}>
      <button
        type="button"
        onClick={props.onClick}
        class={cn(
          "fixed bottom-24 right-6 z-10",
          "flex items-center gap-2 px-3 py-2",
          "bg-base-100 border border-base-300 rounded-full",
          "shadow-lg hover:shadow-xl",
          "transition-all duration-200 hover:scale-105",
          "text-sm font-medium",
          props.class
        )}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
        Scroll to bottom
      </button>
    </Show>
  );
};
