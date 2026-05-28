/**
 * ChatInput Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import {
  type Component,
  Show,
  createSignal,
  createEffect,
  onMount,
} from "solid-js";
import { cn } from "~/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { isMobile } from "../../stores/deviceStore";
import {
  FiSend,
  FiPlus,
  FiX,
  FiFolder,
  FiCheck,
} from "solid-icons/fi";
import { FaSolidStopCircle } from "solid-icons/fa";

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
// Chat Input Component
// ============================================================================

export const ChatInput: Component<ChatInputProps> = (props) => {
  let textareaRef: HTMLTextAreaElement | undefined;
  const [focused, setFocused] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [activeMentionIndex, setActiveMentionIndex] = createSignal(0);
  const [activeSlashIndex, setActiveSlashIndex] = createSignal(0);
  const mobile = () => isMobile();
  const mentionSuggestions = () => props.mentionSuggestions ?? [];
  const hasMentionSuggestions = () => mentionSuggestions().length > 0;
  const slashSuggestions = () => props.slashSuggestions ?? [];
  const hasSlashSuggestions = () => slashSuggestions().length > 0;
  const showMentionSuggestions = () => hasMentionSuggestions() && !hasSlashSuggestions();
  const showSlashSuggestions = () => hasSlashSuggestions();

  const permissionOptions: { value: PermissionMode; label: string; description: string }[] = [
    { value: "AlwaysAsk", label: "Ask", description: "Approve each action" },
    { value: "AcceptEdits", label: "Edit", description: "Allow file edits" },
    { value: "Plan", label: "Plan", description: "Auto-approve planning" },
    { value: "AutoApprove", label: "Auto", description: "Approve all actions" },
  ];

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
    } catch (err) {
      console.error("Failed to open file dialog:", err);
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
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveMentionIndex((prev) => Math.min(prev + 1, mentionSuggestions().length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveMentionIndex((prev) => Math.max(prev - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); const item = mentionSuggestions()[activeMentionIndex()]; if (item) props.onSelectMention?.(item.path); return; }
      if (e.key === "Escape") { e.preventDefault(); props.onDismissMentions?.(); return; }
    }
    // Standard chat shortcut: Enter sends, Shift+Enter inserts newline
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (props.isStreaming && props.onInterrupt) {
        props.onInterrupt();
        if (mobile()) setShowSettings(false);
      } else if (props.value.trim()) {
        props.onSubmit();
        if (mobile()) setShowSettings(false);
      }
    }
  };

  createEffect(() => { mentionSuggestions(); setActiveMentionIndex(0); });
  createEffect(() => { slashSuggestions(); setActiveSlashIndex(0); });

  return (
    <div class={cn("relative flex flex-col px-4 py-3 bg-base-100 border-t border-base-content/10", props.class)}>
      {/* Mention/Slash Suggestions */}
      <Show when={showMentionSuggestions()}>
        <div class="absolute left-0 right-0 bottom-full z-50 mb-2 border border-base-content/10 bg-base-100 max-h-48 overflow-y-auto">
          {mentionSuggestions().map((item, index) => (
            <button
              type="button"
              class={cn(
                "w-full px-4 py-2 text-left text-sm flex items-center gap-2 border-b border-base-content/5",
                index === activeMentionIndex() ? "bg-base-200" : "hover:bg-base-200/50",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onSelectMention?.(item.path)}
              onMouseEnter={() => setActiveMentionIndex(index)}
            >
              <FiFolder size={12} class="text-base-content/40" />
              <span class="truncate font-mono text-base-content">{item.path}</span>
            </button>
          ))}
        </div>
      </Show>

      <Show when={showSlashSuggestions()}>
        <div class="absolute left-0 right-0 bottom-full z-50 mb-2 border border-base-content/10 bg-base-100 max-h-48 overflow-y-auto">
          {slashSuggestions().map((item, index) => (
            <button
              type="button"
              class={cn(
                "w-full px-4 py-2 text-left border-b border-base-content/5",
                index === activeSlashIndex() ? "bg-base-200" : "hover:bg-base-200/50",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onSelectSlash?.(item.value || item.name)}
              onMouseEnter={() => setActiveSlashIndex(index)}
            >
              <span class="text-sm font-bold"><span class="text-base-content/40">/</span>{item.name}</span>
              <Show when={item.description}>
                <span class="text-xs text-base-content/50 ml-2">{item.description}</span>
              </Show>
            </button>
          ))}
        </div>
      </Show>

      {/* Input Container */}
      <div class={cn(
        "flex flex-col border border-base-content/10",
        focused() ? "border-base-content/30" : "",
      )}>
        {/* Attachments */}
        <Show when={props.attachments && props.attachments.length > 0}>
          <div class="flex flex-wrap gap-2 px-3 pt-2">
            {props.attachments!.map((file) => (
              <div class="flex items-center gap-2 px-2 py-1 bg-base-200 text-xs border border-base-content/10">
                <span class="truncate max-w-[120px]">{file.name}</span>
                <button
                  type="button"
                  class="p-1 text-base-content/40 hover:text-error"
                  onClick={() => {
                    const remaining = props.attachments?.filter((a) => a.name !== file.name) ?? [];
                    props.onAttach?.(remaining);
                  }}
                  aria-label={`Remove attachment ${file.name}`}
                >
                  <FiX size={14} />
                </button>
              </div>
            ))}
          </div>
        </Show>

        {/* Textarea Row */}
        <div class="flex items-end gap-2 px-2 py-2">
          <button
            type="button"
            class="p-2 text-base-content/40 hover:text-base-content"
            onClick={handleAttach}
            disabled={props.disabled}
            title="Attach files"
          >
            <FiPlus size={16} />
          </button>
          <textarea
            ref={textareaRef}
            value={props.value}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder || "Type your message..."}
            class="flex-1 px-2 py-2 bg-transparent border-none outline-none resize-none text-sm min-h-[40px] placeholder:text-base-content/40 text-base-content"
            disabled={props.disabled}
            rows={1}
            aria-label="Chat input"
          />
          <button
            type="button"
            onClick={() => {
              if (props.isStreaming && props.onInterrupt) {
                props.onInterrupt();
              } else {
                props.onSubmit();
              }
            }}
            disabled={!props.isStreaming && (!props.value.trim() || props.disabled)}
            class={cn(
              "px-4 py-2 text-sm font-medium border",
              props.isStreaming
                ? "border-error text-error hover:bg-error hover:text-base-100"
                : "border-base-content/10 text-base-content hover:bg-base-200",
            )}
          >
            {props.isStreaming ? <FaSolidStopCircle size={14} /> : <FiSend size={14} />}
          </button>
        </div>

        {/* Streaming indicator */}
        <Show when={props.isStreaming}>
          <div class="flex items-center px-2 pb-2 gap-1 border-t border-base-content/5">
            <span class="text-xs text-base-content/50">Thinking...</span>
          </div>
        </Show>
      </div>

      {/* Settings Dropdown */}
      <Show when={showSettings()}>
        <div class="mt-2 border border-base-content/10 bg-base-100">
          <div class="px-3 py-2 border-b border-base-content/10 text-[10px] font-semibold text-base-content/40 uppercase">
            Permission Mode
          </div>
          {permissionOptions.map((option) => (
            <button
              type="button"
              class={cn(
                "w-full flex items-center justify-between px-4 py-2 text-left border-b border-base-content/5 last:border-b-0",
                props.permissionMode === option.value ? "bg-base-200" : "hover:bg-base-200/50",
              )}
              onClick={() => { props.onPermissionModeChange?.(option.value); setShowSettings(false); }}
            >
              <div>
                <div class="text-sm font-medium">{option.label}</div>
                <div class="text-xs text-base-content/50">{option.description}</div>
              </div>
              <Show when={props.permissionMode === option.value}>
                <FiCheck size={14} />
              </Show>
            </button>
          ))}
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Prompt Suggestions Component
// ============================================================================

export interface PromptSuggestion {
  id: string;
  label: string;
  prompt: string;
}

export interface PromptSuggestionsProps {
  suggestions: PromptSuggestion[];
  onSelect: (prompt: string) => void;
  class?: string;
}

export const PromptSuggestions: Component<PromptSuggestionsProps> = (props) => {
  return (
    <div class={cn("flex flex-wrap gap-2 px-3 pb-2", props.class)}>
      {props.suggestions.map((suggestion) => (
        <button
          type="button"
          onClick={() => props.onSelect(suggestion.prompt)}
          class="px-3 py-1.5 text-xs text-base-content/50 border border-base-content/10 hover:bg-base-200/50"
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  );
};