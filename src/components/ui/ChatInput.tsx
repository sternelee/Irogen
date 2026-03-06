/**
 * Enhanced Chat Input Component
 *
 * AI-native chat input inspired by Vercel AI Elements:
 * - Auto-resizing textarea
 * - Markdown support indicator
 * - Keyboard shortcuts
 * - Loading states
 * - Tool buttons (Permission, Git, File browser)
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
import {
  FiSend,
  FiPlus,
  FiCommand,
  FiX,
  FiFolder,
  FiGitBranch,
} from "solid-icons/fi";
import { FaSolidStopCircle } from "solid-icons/fa";

// ============================================================================
// Types
// ============================================================================

export type PermissionMode =
  | "AlwaysAsk"
  | "AcceptEdits"
  | "Plan"
  | "AutoApprove";
export type RightPanelView = "none" | "file" | "git";

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
  // Tool buttons
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  rightPanelView?: RightPanelView;
  onToggleFileBrowser?: () => void;
  onToggleGitPanel?: () => void;
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
      const newHeight = Math.min(
        textareaRef.scrollHeight,
        props.maxHeight || 200,
      );
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
    // Send on Shift+Enter, keep Enter as newline
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing) return;
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
        "flex flex-col gap-1.5 px-3 sm:px-4 py-2 sm:py-3 mb-10 sm:mb-0 bg-background/80 backdrop-blur-md sticky bottom-0",
        focused() && "bg-background",
        props.class,
      )}
    >
      {/* Input Container with Toolbar Inside */}
      <div
        class={cn(
          "flex flex-col rounded-2xl border-2 bg-muted/30 transition-all duration-300",
          focused()
            ? "border-primary/50 shadow-xl shadow-primary/5 bg-background"
            : "border-border/60 hover:border-muted-foreground/20 hover:bg-muted/50",
        )}
      >
        {/* Top Row: Textarea + Send Button */}
        <div class="flex items-end gap-1.5 sm:gap-2 p-1.5 sm:p-2 pb-1">
          {/* Attach Button */}
          <button
            type="button"
            class="p-2 text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 rounded-xl transition-all duration-200 shrink-0 hidden"
            title="Attach files"
            disabled={props.disabled}
            onClick={handleAttach}
          >
            <FiPlus size={20} />
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
            class="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-transparent border-none outline-none resize-none text-[13px] sm:text-sm max-h-[200px] min-h-[22px] leading-5 sm:leading-relaxed placeholder:text-muted-foreground/40 scrollbar-hide"
            disabled={props.disabled}
            rows={1}
          />
        </div>

        {/* Attachments List */}
        <Show when={props.attachments && props.attachments.length > 0}>
          <div class="flex flex-wrap gap-2 px-3 pb-1">
            {props.attachments!.map((file) => (
              <div class="flex items-center gap-2 px-2.5 py-1 bg-muted/60 rounded-lg text-xs border border-border/30">
                <FiPlus size={10} class="rotate-45 text-muted-foreground/60" />
                <span class="truncate max-w-[150px]">{file.name}</span>
                <button
                  type="button"
                  class="p-0.5 hover:bg-muted-foreground/20 rounded text-muted-foreground/60"
                  onClick={() => props.onAttach?.([])}
                >
                  <FiX size={10} />
                </button>
              </div>
            ))}
          </div>
        </Show>

        {/* Bottom Toolbar */}
        <div class="flex items-center px-3 pb-1 gap-2">
          <div class="flex items-center gap-0.5">
            {/* Permission Mode Dropdown */}
            <div class="relative flex items-center">
              <select
                class="select select-xs h-6 bg-muted/40 border-border/30 text-[11px] pr-5 appearance-none cursor-pointer hover:bg-muted/60 transition-colors rounded-md"
                value={props.permissionMode || "AlwaysAsk"}
                onChange={(e) =>
                  props.onPermissionModeChange?.(
                    e.currentTarget.value as PermissionMode,
                  )
                }
                title="Permission mode"
              >
                <option value="AlwaysAsk">Ask</option>
                <option value="AcceptEdits">Edit</option>
                <option value="Plan">Plan</option>
                <option value="AutoApprove">Auto</option>
              </select>
            </div>

            {/* Divider */}
            <div class="w-px h-4 bg-border/40 mx-1.5" />

            {/* File Browser Button */}
            <button
              type="button"
              class={cn(
                "btn btn-ghost btn-xs h-6 min-h-0 px-2 gap-1 text-[11px] transition-all rounded-md",
                props.rightPanelView === "file"
                  ? "bg-primary/15 text-primary hover:bg-primary/20"
                  : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50",
              )}
              onClick={props.onToggleFileBrowser}
              title="Toggle file browser"
              disabled={props.disabled}
            >
              <FiFolder size={12} />
              <span class="hidden sm:inline">Files</span>
            </button>

            {/* Git Panel Button */}
            <button
              type="button"
              class={cn(
                "btn btn-ghost btn-xs h-6 min-h-0 px-2 gap-1 text-[11px] transition-all rounded-md",
                props.rightPanelView === "git"
                  ? "bg-primary/15 text-primary hover:bg-primary/20"
                  : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50",
              )}
              onClick={props.onToggleGitPanel}
              title="Toggle git panel"
              disabled={props.disabled}
            >
              <FiGitBranch size={12} />
              <span class="hidden sm:inline">Git</span>
            </button>
          </div>

          {/* Right side: Keyboard hints */}
          <div class="flex items-center gap-2 text-[10px] text-muted-foreground/40">
            <span class="hidden sm:flex items-center gap-0.5">
              <kbd class="kbd kbd-xs bg-muted/40 border-border/20">↵</kbd>
              <span>line</span>
            </span>
            <span class="hidden sm:flex items-center gap-0.5">
              <kbd class="kbd kbd-xs bg-muted/40 border-border/20">⇧↵</kbd>
              <span>send</span>
            </span>
          </div>

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
              "shrink-0 ml-auto inline-flex justify-center items-center p-1 rounded-xl transition-all duration-300 shadow-lg mb-0.5",
              props.isStreaming
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 animate-pulse"
                : "bg-gradient-to-r from-primary to-primary/90 text-primary-foreground hover:from-primary/90 hover:to-primary/80 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none",
            )}
            title={props.isStreaming ? "Stop generation" : "Send message"}
          >
            <Show when={props.isStreaming} fallback={<FiSend size={18} />}>
              <FaSolidStopCircle size={24} color="red" />
            </Show>
          </button>
        </div>
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
        item.description?.toLowerCase().includes(query),
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
            props.class,
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
          <div class="max-h-75 overflow-y-auto p-2">
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
                      : "hover:bg-muted",
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
    <div class={cn("flex flex-wrap gap-2 px-3 pb-2", props.class)}>
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
