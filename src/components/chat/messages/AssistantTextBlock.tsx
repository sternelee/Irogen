import { useState } from "react";
import type { AssistantTextMessage } from "@/types/api";
import { MarkdownText } from "@/components/chat/MarkdownText";
import { Copy, Check } from "lucide-react";

interface AssistantTextBlockProps {
  message: AssistantTextMessage;
}

export function AssistantTextBlock({ message }: AssistantTextBlockProps) {
  const isStreaming = message.status === "streaming";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full">
        <div className="group/msg rounded-2xl rounded-tl-sm bg-[var(--app-bg)] border border-[var(--app-border)] px-4 py-2.5 text-[var(--app-fg)] shadow-sm">
          <div className="min-w-0">
            <MarkdownText content={message.content} />
            {isStreaming && (
              <span className="inline-block h-4 w-0.5 bg-[var(--app-link)] animate-pulse ml-0.5 align-middle" />
            )}
          </div>

          {/* Copy button — visible on hover */}
          {message.content.length > 0 && (
            <div className="hidden sm:flex justify-end mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
              <button
                type="button"
                title="Copy"
                className="p-0.5 rounded hover:bg-[var(--app-subtle-bg)] transition-colors"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-[var(--app-hint)]" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
