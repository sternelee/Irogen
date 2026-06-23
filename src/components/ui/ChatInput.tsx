/**
 * ChatInput Component
 *
 * LobeHub-inspired redesign:
 * - Compact toolbar with inline actions
 * - Slash command popup with visual hierarchy
 * - Attachment pills
 * - Permission mode indicator
 * - Send/Stop streaming button
 */

import {
  type Component,
  Show,
  createSignal,
  createEffect,
  onMount,
  For,
} from "solid-js";
import { cn } from "~/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { isMobile } from "../../stores/deviceStore";
import {
  FiSend,
  FiPlus,
  FiX,
  FiFolder,
  FiStopCircle,
} from "solid-icons/fi";

// ============================================================================
// Types
// ============================================================================

export type PermissionMode = "AlwaysAsk" | "AcceptEdits" | "Plan" | "AutoApprove";
export type RightPanelView = "none" | "file" | "git" | "permissions";

export interface ChatInputProps {
  value: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onInterrupt?: () => void;
  onAttach?: (files: File[]) => void;
  attachments?: File[];
  placeholder?: string;
  disabled?: boolean;
  isStreaming?: boolean;
  maxHeight?: number;
  class?: string;
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  rightPanelView?: RightPanelView;
  onToggleFileBrowser?: () => void;
  onToggleGitPanel?: () => void;
  mentionSuggestions?: { name: string; path: string }[];
  onSelectMention?: (path: string) => void;
  onDismissMentions?: () => void;
  slashSuggestions?: { name: string; description?: string; value?: string }[];
  onSelectSlash?: (name: string) => void;
  onDismissSlash?: () => void;
}

// ============================================================================
// ChatInput Component
// ============================================================================

export const ChatInput: Component<ChatInputProps> = (props) => {
  let textareaRef: HTMLTextAreaElement | undefined;
  const [focused, setFocused] = createSignal(false);
  const [activeSlashIndex, setActiveSlashIndex] = createSignal(0);

  const mentionSuggestions = () => props.mentionSuggestions ?? [];
  const hasMentionSuggestions = () => mentionSuggestions().length > 0;
  const slashSuggestions = () => props.slashSuggestions ?? [];
  const hasSlashSuggestions = () => slashSuggestions().length > 0;
  const showMentionSuggestions = () => hasMentionSuggestions() && !hasSlashSuggestions();
  const showSlashSuggestions = () => hasSlashSuggestions();

  

  const handleAttach = async () => {
    if (!props.onAttach) return;
    try {
      const selected = await open({ multiple: true, title: "Select files to attach" });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        const files = paths.map((path) => {
          const name = path.split(/[\\/]/).pop() || "file";
          const file = new File([], name, { type: "application/octet-stream" });
          (file as File & { path: string }).path = path;
          return file;
        });
        props.onAttach(files);
      }
    } catch {
      // dialog cancelled
    }
  };

  const adjustHeight = () => {
    if (textareaRef) {
      textareaRef.style.height = "auto";
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, props.maxHeight || 200)}px`;
    }
  };

  createEffect(() => {
    props.value;
    adjustHeight();
  });

  onMount(() => {
    if (textareaRef && !isMobile()) textareaRef.focus();
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showSlashSuggestions()) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveSlashIndex((prev) => Math.min(prev + 1, slashSuggestions().length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveSlashIndex((prev) => Math.max(prev - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); const item = slashSuggestions()[activeSlashIndex()]; if (item) props.onSelectSlash?.(item.value || item.name); return; }
      if (e.key === "Escape") { e.preventDefault(); props.onDismissSlash?.(); return; }
    }
    if (showMentionSuggestions()) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveSlashIndex((prev) => Math.min(prev + 1, mentionSuggestions().length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveSlashIndex((prev) => Math.max(prev - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); const item = mentionSuggestions()[activeSlashIndex()]; if (item) props.onSelectMention?.(item.path); return; }
      if (e.key === "Escape") { e.preventDefault(); props.onDismissMentions?.(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (props.isStreaming && props.onInterrupt) {
        props.onInterrupt();
      } else if (props.value.trim()) {
        props.onSubmit();
      }
    }
  };

  createEffect(() => { mentionSuggestions(); setActiveSlashIndex(0); });
  createEffect(() => { slashSuggestions(); setActiveSlashIndex(0); });

  return (
    <div class={cn("relative bg-base-100 border-t border-base-content/10", props.class)}>
      {/* Slash Suggestions */}
      <Show when={showSlashSuggestions()}>
        <div class="absolute left-4 right-4 bottom-full z-50 mb-1 rounded-xl border border-base-content/10 bg-base-100 shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          <For each={slashSuggestions()}>
            {(item, index) => (
              <button
                type="button"
                class={cn(
                  "w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors",
                  "border-b border-base-content/5 last:border-b-0",
                  index() === activeSlashIndex() ? "bg-base-200" : "hover:bg-base-200/50",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onSelectSlash?.(item.value || item.name)}
                onMouseEnter={() => setActiveSlashIndex(index())}
              >
                <span class="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary text-xs font-bold">
                  /
                </span>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-base-content truncate">{item.name}</div>
                  <Show when={item.description}>
                    <div class="text-[11px] text-base-content/40 truncate">{item.description}</div>
                  </Show>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Mention Suggestions */}
      <Show when={showMentionSuggestions()}>
        <div class="absolute left-4 right-4 bottom-full z-50 mb-1 rounded-xl border border-base-content/10 bg-base-100 shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          <For each={mentionSuggestions()}>
            {(item, index) => (
              <button
                type="button"
                class={cn(
                  "w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors",
                  "border-b border-base-content/5 last:border-b-0",
                  index() === activeSlashIndex() ? "bg-base-200" : "hover:bg-base-200/50",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onSelectMention?.(item.path)}
                onMouseEnter={() => setActiveSlashIndex(index())}
              >
                <span class="flex items-center justify-center w-7 h-7 rounded-lg bg-base-200 text-base-content/40">
                  <FiFolder size={12} />
                </span>
                <span class="text-sm font-mono text-base-content truncate">{item.path}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Input Area */}
      <div class="flex flex-col px-3 py-2.5 gap-2">
        {/* Attachments */}
        <Show when={props.attachments && props.attachments.length > 0}>
          <div class="flex flex-wrap gap-1.5">
            <For each={props.attachments}>
              {(file) => (
                <div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-base-200/70 border border-base-content/10 text-xs text-base-content/60">
                  <FiFolder size={10} />
                  <span class="truncate max-w-[100px]">{file.name}</span>
                  <button
                    type="button"
                    class="ml-0.5 p-0.5 rounded hover:bg-base-300 text-base-content/30 hover:text-error transition-colors"
                    onClick={() => {
                      const remaining = props.attachments?.filter((a) => a.name !== file.name) ?? [];
                      props.onAttach?.(remaining);
                    }}
                  >
                    <FiX size={12} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Textarea Row */}
        <div class="flex items-end gap-1.5 rounded-xl border transition-colors duration-150"
          classList={{
            "border-base-content/30": focused(),
            "border-base-content/10": !focused(),
          }}
        >
          {/* Attach Button */}
          <button
            type="button"
            class="p-2.5 shrink-0 text-base-content/30 hover:text-base-content transition-colors"
            onClick={handleAttach}
            disabled={props.disabled}
            title="Attach files"
          >
            <FiPlus size={16} />
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={props.value}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder || "Type a message..."}
            class="flex-1 py-2.5 bg-transparent border-none outline-none resize-none text-sm leading-relaxed min-h-[40px] max-h-[200px] placeholder:text-base-content/30 text-base-content"
            disabled={props.disabled}
            rows={1}
          />

          {/* Send / Interrupt Button */}
          <button
            type="button"
            onClick={() => {
              if (props.isStreaming && props.onInterrupt) {
                props.onInterrupt();
              } else if (props.value.trim()) {
                props.onSubmit();
              }
            }}
            disabled={!props.isStreaming && !props.value.trim() && !props.disabled}
            class={cn(
              "p-2.5 shrink-0 rounded-lg transition-all duration-150",
              props.isStreaming
                ? "text-error hover:bg-error/10"
                : props.value.trim()
                  ? "text-primary hover:bg-primary/10"
                  : "text-base-content/20",
            )}
            title={props.isStreaming ? "Stop streaming" : "Send message"}
          >
            {props.isStreaming ? <FiStopCircle size={18} /> : <FiSend size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};
