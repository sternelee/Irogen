import { useState, useEffect } from "react";
import type { AssistantThinkingMessage } from "@/types/api";
import { MarkdownText } from "@/components/chat/MarkdownText";

interface ThinkingBlockProps {
  message: AssistantThinkingMessage;
}

function ShimmerDot() {
  return (
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ThinkingBlock({ message }: ThinkingBlockProps) {
  const isStreaming = message.status === "streaming";
  const [isOpen, setIsOpen] = useState(isStreaming);

  // Auto-expand while streaming
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors cursor-pointer select-none"
        >
          <ChevronIcon open={isOpen} />
          <span>Reasoning</span>
          {isStreaming && (
            <span className="flex items-center gap-1 ml-1 text-[var(--app-hint)]">
              <ShimmerDot />
            </span>
          )}
        </button>

        <div
          className={`overflow-hidden transition-all duration-200 ease-in-out ${
            isOpen ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="pl-4 pt-2 border-l-2 border-[var(--app-border)] ml-0.5">
            <div className="text-sm text-[var(--app-hint)] leading-relaxed min-w-0 max-w-full break-words">
              <MarkdownText content={message.content} />
              {isStreaming && (
                <span className="inline-block h-4 w-0.5 bg-[var(--app-link)] animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
