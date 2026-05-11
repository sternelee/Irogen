import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square, Paperclip, Settings2 } from "lucide-react";
import { StatusBar } from "@/components/chat/StatusBar";

interface ChatComposerProps {
  onSend: (text: string, attachments?: string[]) => void;
  onAbort?: () => void;
  isRunning: boolean;
  placeholder?: string;
  active?: boolean;
  permissionCount?: number;
  contextSize?: number;
  contextWindow?: number | null;
  permissionMode?: string;
  model?: string | null;
  agentType?: string;
  settingsPanel?: React.ReactNode;
}

export function ChatComposer({
  onSend,
  onAbort,
  isRunning,
  placeholder = "Ask anything…",
  active = true,
  permissionCount = 0,
  contextSize,
  contextWindow,
  permissionMode,
  model,
  agentType,
  settingsPanel,
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isRunning) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
  }, [text, attachments, isRunning, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          setAttachments((prev) => [...prev, file.name]);
        }
      }
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="relative border-t border-[var(--app-border)] bg-[var(--app-bg)] px-4 py-3">
      <div className="mx-auto w-full max-w-content relative">
        {/* Settings floating panel */}
        {showSettings && settingsPanel && (
          <div className="absolute bottom-[100%] mb-2 w-full z-20">
            <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg max-h-80">
              <div className="overflow-y-auto max-h-80">
                {settingsPanel}
              </div>
            </div>
          </div>
        )}

        {/* StatusBar */}
        <StatusBar
          active={active}
          thinking={isRunning}
          permissionCount={permissionCount}
          contextSize={contextSize}
          contextWindow={contextWindow}
          permissionMode={permissionMode}
          model={model}
          agentType={agentType}
        />

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((path, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--app-subtle-bg)] px-2 py-1 text-xs text-[var(--app-hint)] cursor-pointer hover:bg-[var(--app-border)]"
                onClick={() => removeAttachment(i)}
              >
                <Paperclip className="h-3 w-3" />
                {path.split("/").pop() ?? path}
                <span className="text-[10px] opacity-50">×</span>
              </span>
            ))}
          </div>
        )}

        <div className="overflow-hidden rounded-[20px] bg-[var(--app-secondary-bg)]">
          <div className="flex items-center px-4 py-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={isRunning || !active}
              rows={1}
              className="flex-1 resize-none bg-transparent text-base leading-snug text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Button row */}
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                title="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] ${showSettings ? 'text-[var(--app-link)] bg-[var(--app-subtle-bg)]' : 'text-[var(--app-hint)]'}`}
                title="Settings"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {isRunning ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={onAbort}
                  className="gap-1.5 rounded-full px-3"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSend}
                  disabled={!text.trim() || !active}
                  className="gap-1.5 rounded-full px-3 bg-[var(--app-link)] hover:bg-[var(--app-link)]/90 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-1.5 px-1">
          <div className="text-[10px] text-[var(--app-hint)]">
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>
    </div>
  );
}
