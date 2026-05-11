import { useRef, useEffect, useState, useCallback } from "react";
import type { ChatMessage, PermissionRequest } from "@/types/api";
import { UserMessageBubble } from "@/components/chat/messages/UserMessage";
import { AssistantTextBlock } from "@/components/chat/messages/AssistantTextBlock";
import { ThinkingBlock } from "@/components/chat/messages/ThinkingBlock";
import { ToolCallBlock } from "@/components/chat/messages/ToolCallBlock";
import { SystemEventBlock } from "@/components/chat/messages/SystemEventBlock";
import { PermissionRequestDialog } from "@/components/chat/PermissionRequestDialog";
import { Loader2, ArrowDown } from "lucide-react";

interface ChatThreadProps {
  messages: ChatMessage[];
  permissions: PermissionRequest[];
  isTyping: boolean;
  onResolvePermission: (id: string, option: string) => void;
}

export function ChatThread({
  messages,
  permissions,
  isTyping,
  onResolvePermission,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  // Track scroll position to show/hide scroll button
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
    setShowScrollButton(!atBottom && messages.length > 0);
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {/* Message list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[var(--app-hint)]">
            <div className="text-center">
              <div className="text-4xl mb-3">💬</div>
              <div className="text-sm">
                Send a message to start the conversation
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const key = msg.id ?? `msg-${index}`;

            if (msg.role === "user" && msg.type === "user") {
              return (
                <div
                  key={key}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <UserMessageBubble message={msg} />
                </div>
              );
            }

            if (msg.role === "assistant" && msg.type === "text") {
              return (
                <div
                  key={key}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <AssistantTextBlock message={msg} />
                </div>
              );
            }

            if (msg.role === "assistant" && msg.type === "thinking") {
              return (
                <div
                  key={key}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <ThinkingBlock message={msg} />
                </div>
              );
            }

            if (msg.role === "assistant" && msg.type === "tool") {
              return (
                <div
                  key={key}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  <ToolCallBlock message={msg} />
                </div>
              );
            }

            if (msg.role === "event") {
              return (
                <div key={key} className="animate-in fade-in duration-200">
                  <SystemEventBlock message={msg} />
                </div>
              );
            }

            return null;
          })
        )}

        {/* Typing indicator */}
        {isTyping && messages.length > 0 && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-[var(--app-bg)] border border-[var(--app-border)] px-4 py-2.5">
              <div className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--app-link)]" />
                <span className="text-xs text-[var(--app-hint)]">
                  Thinking…
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Bottom spacer */}
        <div className="h-2" />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 !text-black flex items-center gap-1 rounded-full bg-[var(--app-link)] px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-[var(--app-link)]/90 transition-all animate-in fade-in slide-in-from-bottom-2"
        >
          <ArrowDown className="h-3 w-3" />
          New messages
        </button>
      )}

      {/* Permission dialog overlay */}
      <PermissionRequestDialog
        requests={permissions}
        onResolve={onResolvePermission}
      />
    </div>
  );
}
