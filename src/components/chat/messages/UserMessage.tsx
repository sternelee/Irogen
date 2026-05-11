import { useState } from "react";
import type { UserMessage } from "@/types/api";
import { Copy, Check, FileText } from "lucide-react";

interface UserMessageProps {
  message: UserMessage;
}

export function UserMessageBubble({ message }: UserMessageProps) {
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

  const hasText = message.content.length > 0;
  const hasAttachments = message.attachments && message.attachments.length > 0;

  return (
    <div className="flex justify-end">
      <div className="group/msg w-fit min-w-0 max-w-[92%]">
        <div className="rounded-2xl rounded-tr-sm bg-[var(--app-secondary-bg)] px-4 py-2.5 text-[var(--app-fg)] shadow-sm">
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              {hasText && (
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </div>
              )}

              {hasAttachments && message.attachments && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {message.attachments.map((path, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-md bg-[var(--app-subtle-bg)] px-2 py-1 text-xs text-[var(--app-hint)]"
                    >
                      <FileText className="h-3 w-3" />
                      {path.split("/").pop() ?? path}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Copy button — visible on hover, inside the bubble */}
            {hasText && (
              <div className="shrink-0 self-end pb-0.5 flex items-center gap-1">
                <button
                  type="button"
                  title="Copy"
                  className="opacity-60 sm:opacity-0 sm:group-hover/msg:opacity-100 transition-[opacity,background-color] p-0.5 rounded hover:bg-[var(--app-subtle-bg)]"
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
    </div>
  );
}
