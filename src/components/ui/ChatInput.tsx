/**
 * Enhanced Chat Input Component
 *
 * AI-native chat input inspired by Vercel AI Elements:
 * - Auto-resizing textarea
 * - Markdown support indicator
 * - Keyboard shortcuts
 * - Loading states
 */

import { type Component, Show, createSignal, createEffect, onMount } from "solid-js";
import { cn } from "~/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FiSend,
  FiSquare,
  FiPlus,
  FiCommand,
  FiX,
} from "solid-icons/fi";

// ============================================================================
// Types
// ============================================================================

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
}

// ============================================================================
// Chat Input Component
// ============================================================================

export const ChatInput: Component<ChatInputProps> = (props) => {
  let textareaRef: HTMLTextAreaElement | undefined;
  const [focused, setFocused] = createSignal(false);

  // Handle file selection
  const handleAttach = async () => {
    if (!props.onAttach) return;

    try {
      const selected = await open({
        multiple: true,
        title: "Select files to attach",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        // Convert paths to File-like objects with basic info
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

  // Auto-resize textarea
  const adjustHeight = () => {
    if (textareaRef) {
      textareaRef.style.height = "auto";
      const newHeight = Math.min(textareaRef.scrollHeight, props.maxHeight || 200);
      textareaRef.style.height = `${newHeight}px`;
    }
  };

  // Adjust height when value changes
  createEffect(() => {
    props.value;
    adjustHeight();
  });

  // Focus textarea on mount
  onMount(() => {
    if (textareaRef) {
      textareaRef.focus();
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (props.isStreaming && props.onInterrupt) {
        props.onInterrupt();
      } else if (props.value.trim()) {
        props.onSubmit();
      }
    }
  };

  const handleInput = (e: InputEvent) => {
    const target = e.currentTarget as HTMLTextAreaElement;
    props.onInput(target.value);
  };

  return (
    <div
      class={cn(
        "flex flex-col gap-2 px-4 py-3 bg-background/80 backdrop-blur-md border-t border-border/60",
        focused() && "bg-background",
        props.class
      )}
    >
      {/* Input Container */}
      <div
        class={cn(
          "flex items-end gap-2 rounded-2xl border-2 bg-muted/30 transition-all duration-300",
          focused()
            ? "border-primary/50 shadow-xl shadow-primary/5 bg-background"
            : "border-border/60 hover:border-muted-foreground/20 hover:bg-muted/50"
        )}
      >
        {/* Attach Button */}
        <button
          type="button"
          class="p-3 text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 rounded-xl transition-all duration-200 shrink-0"
          title="Attach files"
          disabled={props.disabled}
          onClick={handleAttach}
        >
          <FiPlus size={22} />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={props.value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={props.placeholder || "Type your message..."}
          class="flex-1 py-3.5 bg-transparent border-none outline-none resize-none text-sm max-h-[200px] min-h-[24px] leading-relaxed placeholder:text-muted-foreground/40"
          disabled={props.disabled}
          rows={1}
        />

        {/* Send/Stop Button */}
        <button
          type="button"
          onClick={() => {
            if (props.isStreaming && props.onInterrupt) {
              props.onInterrupt();
            } else {
              props.onSubmit();
            }
          }}
          disabled={
            !props.isStreaming && (!props.value.trim() || props.disabled)
          }
          class={cn(
            "shrink-0 p-3 rounded-xl transition-all duration-300 shadow-lg",
            props.isStreaming
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse"
              : "bg-gradient-to-r from-primary to-primary/90 text-primary-foreground hover:from-primary/90 hover:to-primary/80 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          )}
          title={props.isStreaming ? "Stop generation" : "Send message"}
        >
          <Show when={props.isStreaming} fallback={<FiSend size={20} />}>
            <FiSquare size={20} />
          </Show>
        </button>
      </div>

      {/* Attachments List */}
      <Show when={props.attachments && props.attachments.length > 0}>
        <div class="flex flex-wrap gap-2 px-1">
          {props.attachments!.map((file) => (
            <div class="flex items-center gap-2 px-3 py-1.5 bg-muted/60 rounded-lg text-xs border border-border/30">
              <FiPlus size={12} class="rotate-45 text-muted-foreground/60" />
              <span class="truncate max-w-[150px]">{file.name}</span>
              <button
                type="button"
                class="p-0.5 hover:bg-muted-foreground/20 rounded text-muted-foreground/60"
                onClick={() => props.onAttach?.([])} // Will be handled via parent
              >
                <FiX size={12} />
              </button>
            </div>
          ))}
        </div>
      </Show>

      {/* Footer */}
      <div class="flex items-center justify-between px-2 text-[10px] text-muted-foreground/40">
        <div class="flex items-center gap-4">
          <span class="flex items-center gap-1.5">
            <kbd class="kbd kbd-xs bg-muted/50 border-border/30">↵</kbd> send
          </span>
          <span class="flex items-center gap-1">
            <kbd class="kbd kbd-xs bg-muted/50 border-border/30">⇧</kbd>+<kbd class="kbd kbd-xs bg-muted/50 border-border/30">↵</kbd> new line
          </span>
        </div>
        <span class="opacity-60">Markdown supported</span>
      </div>
    </div>
  );
};

// ============================================================================
// Command Palette Component
// ============================================================================

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: Component<{ size?: number; class?: string }>;
  action: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder?: string;
  class?: string;
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
  const [search, setSearch] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const filteredItems = () => {
    const query = search().toLowerCase();
    if (!query) return props.items;
    return props.items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query)
    );
  };

  // Reset selection when filtered items change
  createEffect(() => {
    filteredItems();
    setSelectedIndex(0);
  });

  // Focus input when opened
  createEffect(() => {
    if (props.open && inputRef) {
      inputRef.focus();
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = filteredItems();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        const selected = items[selectedIndex()];
        if (selected) {
          selected.action();
          props.onClose();
        }
        break;
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
    }
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
        {/* Backdrop */}
        <div
          class="absolute inset-0 bg-background/80 backdrop-blur-sm"
          onClick={props.onClose}
        />

        {/* Dialog */}
        <div
          class={cn(
            "relative w-full max-w-lg bg-base-100 rounded-xl border border-border shadow-2xl overflow-hidden",
            props.class
          )}
        >
          {/* Search Input */}
          <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
            <FiCommand size={18} class="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder={props.placeholder || "Type a command..."}
              class="flex-1 bg-transparent border-none outline-none text-sm"
            />
            <kbd class="kbd kbd-sm">ESC</kbd>
          </div>

          {/* Command List */}
          <div class="max-h-[300px] overflow-y-auto p-2">
            <Show
              when={filteredItems().length > 0}
              fallback={
                <div class="py-8 text-center text-muted-foreground text-sm">
                  No commands found
                </div>
              }
            >
              {filteredItems().map((item, index) => (
                <button
                  type="button"
                  onClick={() => {
                    item.action();
                    props.onClose();
                  }}
                  class={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                    index === selectedIndex()
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  )}
                >
                  <Show when={item.icon}>
                    <div class="text-muted-foreground shrink-0">
                      {item.icon!({ size: 18 })}
                    </div>
                  </Show>
                  <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm truncate">{item.label}</div>
                    <Show when={item.description}>
                      <div class="text-xs text-muted-foreground truncate">
                        {item.description}
                      </div>
                    </Show>
                  </div>
                  <Show when={index === selectedIndex()}>
                    <kbd class="kbd kbd-xs">↵</kbd>
                  </Show>
                </button>
              ))}
            </Show>
          </div>
        </div>
      </div>
    </Show>
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
    <div
      class={cn(
        "flex flex-wrap gap-2 px-3 pb-2",
        props.class
      )}
    >
      {props.suggestions.map((suggestion) => (
        <button
          type="button"
          onClick={() => props.onSelect(suggestion.prompt)}
          class="px-3 py-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-muted rounded-full border border-border hover:border-primary/50 transition-colors"
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  );
};
