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
import { isMobile } from "../../stores/deviceStore";
import {
  FiSend,
  FiPlus,
  FiX,
  FiFolder,
  FiGitBranch,
  FiSettings,
  FiCheck,
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
  const isStreamingNow = () => !!props.isStreaming;
  const mentionSuggestions = () => props.mentionSuggestions ?? [];
  const hasMentionSuggestions = () => mentionSuggestions().length > 0;
  const slashSuggestions = () => props.slashSuggestions ?? [];
  const hasSlashSuggestions = () => slashSuggestions().length > 0;
  const showMentionSuggestions = () =>
    hasMentionSuggestions() && !hasSlashSuggestions();
  const showSlashSuggestions = () => hasSlashSuggestions();

  const permissionOptions: {
    value: PermissionMode;
    label: string;
    description: string;
  }[] = [
    { value: "AlwaysAsk", label: "Ask", description: "Approve each action" },
    { value: "AcceptEdits", label: "Edit", description: "Allow file edits" },
    { value: "Plan", label: "Plan", description: "Auto-approve planning" },
    { value: "AutoApprove", label: "Auto", description: "Approve all actions" },
  ];

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
    if (textareaRef && !isMobile()) {
      textareaRef.focus();
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (showSlashSuggestions()) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSlashIndex((prev) =>
          Math.min(prev + 1, slashSuggestions().length - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSlashIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const item = slashSuggestions()[activeSlashIndex()];
        if (item) {
          props.onSelectSlash?.(item.value || item.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        props.onDismissSlash?.();
        return;
      }
    }
    if (showMentionSuggestions()) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMentionIndex((prev) =>
          Math.min(prev + 1, mentionSuggestions().length - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMentionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const item = mentionSuggestions()[activeMentionIndex()];
        if (item) {
          props.onSelectMention?.(item.path);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        props.onDismissMentions?.();
        return;
      }
    }

    const shouldSend =
      e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey);
    // Send on Shift/Cmd/Ctrl+Enter, keep Enter as newline
    if (shouldSend) {
      e.preventDefault();
      if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing) return;
      if (props.isStreaming && props.onInterrupt) {
        props.onInterrupt();
        if (mobile()) {
          setShowSettings(false);
        }
      } else if (props.value.trim()) {
        props.onSubmit();
        if (mobile()) {
          setShowSettings(false);
        }
      }
    }
  };

  createEffect(() => {
    mentionSuggestions();
    setActiveMentionIndex(0);
  });

  createEffect(() => {
    slashSuggestions();
    setActiveSlashIndex(0);
  });

  return (
    <div
      class={cn(
        "flex flex-col gap-1 sm:gap-1.5 px-1.5 sm:px-4 pt-1.5 sm:pt-3 pb-[max(env(safe-area-inset-bottom,0.65rem),0.65rem)] sm:pb-3 bg-base-100/95 backdrop-blur-md sticky bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-0 z-20 transition-all duration-300 mobile-keyboard-adjust",
        focused() && "bg-base-100",
        props.class,
      )}
    >
      {/* Input Container with Toolbar Inside */}
      <div
        class={cn(
          "relative flex flex-col rounded-2xl border-2 bg-base-200/50 transition-all duration-300",
          focused()
            ? "border-primary/50 shadow-xl shadow-primary/5 bg-base-100"
            : "border-base-content/10 hover:border-base-content/20 hover:bg-base-200/80",
        )}
      >
        <Show when={showMentionSuggestions()}>
          <div class="absolute left-2 right-2 sm:left-3 sm:right-3 bottom-[calc(100%+0.5rem)] z-40 rounded-xl border border-base-content/10 bg-base-300/98 shadow-2xl max-h-[12rem] sm:max-h-[15rem] overflow-y-auto backdrop-blur-md">
            {mentionSuggestions().map((item, index) => (
              <button
                type="button"
                class={cn(
                  "w-full px-4 py-3 text-left text-sm transition-colors min-h-[48px] flex items-center gap-2",
                  index === activeMentionIndex()
                    ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                    : "hover:bg-base-content/5",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onSelectMention?.(item.path)}
              >
                <FiFolder size={14} class="opacity-50" />
                <span class="font-medium truncate">{item.path}</span>
              </button>
            ))}
          </div>
        </Show>

        <Show when={showSlashSuggestions()}>
          <div class="absolute left-2 right-2 sm:left-3 sm:right-3 bottom-[calc(100%+0.5rem)] z-40 rounded-xl border border-base-content/10 bg-base-300/98 shadow-2xl max-h-[12rem] sm:max-h-[15rem] overflow-y-auto backdrop-blur-md">
            {slashSuggestions().map((item, index) => (
              <button
                type="button"
                class={cn(
                  "w-full px-4 py-3 text-left transition-colors min-h-[48px]",
                  index === activeSlashIndex()
                    ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                    : "hover:bg-base-content/5",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onSelectSlash?.(item.value || item.name)}
              >
                <div class="text-sm font-bold flex items-center">
                  <span class="opacity-50">/</span>
                  {item.name}
                </div>
                <Show when={item.description}>
                  <div class="mt-0.5 text-xs opacity-70 line-clamp-1">
                    {item.description}
                  </div>
                </Show>
              </button>
            ))}
          </div>
        </Show>

        {/* Top Row: Textarea + Send Button */}
        <div class="flex items-end gap-1 sm:gap-2 p-1 sm:p-2 pb-0.5 sm:pb-1">
          {/* Attach Button (Hidden but kept structure) */}
          <button
            type="button"
            class="p-2.5 text-base-content/60 hover:text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 shrink-0 hidden"
            title="Attach files"
            aria-label="Attach files"
            disabled={props.disabled}
            onClick={handleAttach}
          >
            <FiPlus size={22} />
          </button>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={props.value}
            onInput={(e) => props.onInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setFocused(true);
              if (mobile()) {
                setTimeout(() => {
                  textareaRef?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }, 300);
              }
            }}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder || "Type your message..."}
            aria-label="Chat input"
            class="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-transparent border-none outline-none resize-none text-[16px] sm:text-sm max-h-[200px] min-h-[36px] sm:min-h-[44px] leading-snug sm:leading-relaxed placeholder:opacity-40"
            disabled={props.disabled}
            rows={1}
          />
        </div>

        {/* Attachments List */}
        <Show when={props.attachments && props.attachments.length > 0}>
          <div class="flex flex-wrap gap-2 px-3 pb-2">
            {props.attachments!.map((file) => (
              <div class="flex items-center gap-2 px-3 py-1.5 bg-base-300/80 rounded-lg text-xs border border-base-content/5">
                <FiPlus size={10} class="rotate-45 opacity-60" />
                <span class="truncate max-w-[150px] font-medium">
                  {file.name}
                </span>
                <button
                  type="button"
                  class="p-1 hover:bg-base-content/10 rounded text-base-content/60"
                  onClick={() => props.onAttach?.([])}
                >
                  <FiX size={12} />
                </button>
              </div>
            ))}
          </div>
        </Show>

        {/* Bottom Toolbar */}
        <div class="flex items-center px-1.5 sm:px-2 pb-1.5 sm:pb-2 gap-1 sm:gap-2">
          <div class="flex items-center gap-1.5">
            {/* Settings Button with Permission Dropdown */}
            <div class="relative">
              <button
                type="button"
                class={cn(
                  "btn btn-ghost btn-sm h-8 min-h-[32px] sm:h-10 sm:min-h-[40px] px-2 sm:px-3 gap-1 sm:gap-2 text-[11px] sm:text-[12px] transition-all rounded-lg sm:rounded-xl",
                  showSettings()
                    ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                    : "text-base-content/70 hover:text-primary hover:bg-primary/10",
                )}
                onClick={() => setShowSettings(!showSettings())}
                title="Settings"
                aria-label="Settings"
              >
                <FiSettings class="size-4 sm:size-4.5" />
                <span class="hidden sm:inline">Settings</span>
              </button>

              {/* Settings Backdrop (Mobile only) */}
              <Show when={showSettings()}>
                <div
                  class="fixed inset-0 z-[100] bg-black/40 backdrop-blur-[2px] animate-fade-in sm:hidden"
                  onClick={() => setShowSettings(false)}
                />
              </Show>

              {/* Settings Dropdown / Bottom Sheet */}
              <Show when={showSettings()}>
                <div class="fixed bottom-0 left-0 right-0 z-[101] overflow-hidden rounded-t-3xl border border-base-content/10 bg-base-300 shadow-2xl transition-all duration-300 animate-slide-up sm:absolute sm:bottom-full sm:left-0 sm:right-auto sm:mb-2 sm:w-60 sm:rounded-xl">
                  {/* Handle for mobile bottom sheet */}
                  <div class="flex justify-center py-3 sm:hidden">
                    <div class="w-10 h-1 bg-base-content/20 rounded-full" />
                  </div>

                  <div class="px-4 py-3 border-b border-base-content/10 flex items-center justify-between">
                    <div class="text-[11px] font-black uppercase tracking-widest opacity-50">
                      Permission Mode
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-circle sm:hidden"
                      onClick={() => setShowSettings(false)}
                    >
                      <FiX size={16} />
                    </button>
                  </div>
                  <div class="p-2 space-y-1">
                    {permissionOptions.map((option) => (
                      <button
                        type="button"
                        class={cn(
                          "w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl transition-all active:scale-[0.98]",
                          props.permissionMode === option.value
                            ? "bg-primary/10 text-primary ring-1 ring-primary/15 shadow-md shadow-base-content/5"
                            : "hover:bg-base-content/5",
                        )}
                        onClick={() => {
                          props.onPermissionModeChange?.(option.value);
                          setShowSettings(false);
                        }}
                      >
                        <div class="flex-1 min-w-0">
                          <div class="text-sm font-bold">{option.label}</div>
                          <div
                            class={cn(
                              "text-[11px] truncate",
                              props.permissionMode === option.value
                                ? "opacity-90"
                                : "opacity-50",
                            )}
                          >
                            {option.description}
                          </div>
                        </div>
                        <Show when={props.permissionMode === option.value}>
                          <FiCheck size={18} class="shrink-0" />
                        </Show>
                      </button>
                    ))}
                  </div>
                  {/* Extra spacing for mobile safe area */}
                  <div class="h-8 sm:hidden" />
                </div>
              </Show>
            </div>

            {/* File Browser Button */}
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class={cn(
                  "btn btn-ghost btn-sm h-8 min-h-[32px] sm:h-10 sm:min-h-[40px] px-2 sm:px-3 gap-1 sm:gap-2 text-[11px] sm:text-[12px] transition-all rounded-lg sm:rounded-xl",
                  props.rightPanelView === "file"
                    ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                    : "text-base-content/70 hover:text-primary hover:bg-primary/10",
                )}
                onClick={() => {
                  props.onToggleFileBrowser?.();
                }}
                title="Toggle file browser"
                aria-label="Toggle file browser"
                disabled={props.disabled}
              >
                <FiFolder class="size-4 sm:size-4.5" />
                <span class="hidden sm:inline">Files</span>
              </button>

              <button
                type="button"
                class={cn(
                  "btn btn-ghost btn-sm h-8 min-h-[32px] sm:h-10 sm:min-h-[40px] px-2 sm:px-3 gap-1 sm:gap-2 text-[11px] sm:text-[12px] transition-all rounded-lg sm:rounded-xl",
                  props.rightPanelView === "git"
                    ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                    : "text-base-content/70 hover:text-primary hover:bg-primary/10",
                )}
                onClick={() => {
                  props.onToggleGitPanel?.();
                }}
                title="Toggle git panel"
                aria-label="Toggle git panel"
                disabled={props.disabled}
              >
                <FiGitBranch class="size-4 sm:size-4.5" />
                <span class="hidden sm:inline">Git</span>
              </button>
            </div>
          </div>

          {/* Right side: Keyboard hints */}
          <div class="hidden sm:flex items-center gap-2 text-[10px] opacity-30">
            <Show when={isStreamingNow()}>
              <span class="text-[10px] text-primary font-bold">
                Generating...
              </span>
            </Show>
            <span class="flex items-center gap-1">
              <kbd class="kbd kbd-xs">↵</kbd>
              <span>line</span>
            </span>
            <span class="flex items-center gap-1">
              <kbd class="kbd kbd-xs">⇧↵</kbd>
              <span>send</span>
            </span>
          </div>

          {/* Send/Stop Button */}
          <button
            type="button"
            onClick={() => {
              if (props.isStreaming && props.onInterrupt) {
                props.onInterrupt();
                if (mobile()) {
                  setShowSettings(false);
                }
              } else {
                props.onSubmit();
                if (mobile()) {
                  setShowSettings(false);
                }
              }
            }}
            disabled={
              !props.isStreaming && (!props.value.trim() || props.disabled)
            }
            class={cn(
              "btn btn-primary btn-sm h-9 w-9 sm:h-10 sm:w-auto sm:px-4 rounded-lg sm:rounded-xl shadow-lg shadow-primary/20 transition-all duration-300 ml-auto shrink-0 active:scale-90",
              props.isStreaming && "btn-error shadow-error/20",
            )}
            title={props.isStreaming ? "Stop generation" : "Send message"}
            aria-label={props.isStreaming ? "Stop generation" : "Send message"}
          >
            <Show
              when={props.isStreaming}
              fallback={
                <div class="flex items-center gap-2">
                  <FiSend class="size-4.5 sm:size-4" />
                  <span class="text-sm font-bold hidden sm:inline">Send</span>
                </div>
              }
            >
              <FaSolidStopCircle size={22} />
            </Show>
          </button>
        </div>
      </div>
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
          class="px-3 py-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-muted rounded-full border border-border hover:border-primary/50 transition-colors"
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  );
};
