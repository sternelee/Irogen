/**
 * Enhanced Chat Input Component
 *
 * Clean, modern chat input inspired by OpenChamber:
 * - Auto-resizing textarea
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
        "flex flex-col gap-2 px-4 pt-3 pb-3 sm:pb-4 bg-background/95 backdrop-blur-md sticky bottom-0 z-20 transition-all duration-300",
        focused() && "bg-background",
        props.class,
      )}
    >
      {/* Mention/Slash Suggestions - Improved positioning with better z-index */}
      <Show when={showMentionSuggestions()}>
        <div class="absolute left-0 right-0 bottom-full z-50 mb-2 rounded-xl border border-border/80 bg-background/98 backdrop-blur-lg shadow-2xl max-h-[12rem] overflow-y-auto animate-slide-up">
          {mentionSuggestions().map((item, index) => (
            <button
              type="button"
              class={cn(
                "w-full px-4 py-3 text-left text-sm transition-all min-h-[48px] flex items-center gap-2",
                index === activeMentionIndex()
                  ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20"
                  : "hover:bg-muted/60",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onSelectMention?.(item.path)}
              onMouseEnter={() => setActiveMentionIndex(index)}
            >
              <FiFolder size={14} class="text-primary/70 shrink-0" />
              <span class="truncate font-mono text-foreground/90">
                {item.path}
              </span>
            </button>
          ))}
        </div>
      </Show>

      <Show when={showSlashSuggestions()}>
        <div class="absolute left-0 right-0 bottom-full z-50 mb-2 rounded-xl border border-border/80 bg-background/98 backdrop-blur-lg shadow-2xl max-h-[12rem] overflow-y-auto animate-slide-up">
          {slashSuggestions().map((item, index) => (
            <button
              type="button"
              class={cn(
                "w-full px-4 py-3 text-left transition-all min-h-[48px]",
                index === activeSlashIndex()
                  ? "bg-primary/15 text-primary font-medium ring-1 ring-primary/20"
                  : "hover:bg-muted/60",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onSelectSlash?.(item.value || item.name)}
              onMouseEnter={() => setActiveSlashIndex(index)}
            >
              <div class="text-sm font-bold flex items-center gap-1">
                <span class="text-primary/70">/</span>
                <span class="text-foreground/90">{item.name}</span>
              </div>
              <Show when={item.description}>
                <div class="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                  {item.description}
                </div>
              </Show>
            </button>
          ))}
        </div>
      </Show>

      {/* Input Container with Toolbar Inside */}
      <div
        class={cn(
          "relative flex flex-col rounded-2xl border border-border/50 bg-muted/30 transition-all duration-300",
          focused()
            ? "border-primary/50 bg-background shadow-xl shadow-primary/5 ring-1 ring-primary/10"
            : "hover:bg-muted/40",
        )}
      >
        {/* Attachments List */}
        <Show when={props.attachments && props.attachments.length > 0}>
          <div class="flex flex-wrap gap-2 px-4 pt-3">
            {props.attachments!.map((file) => (
              <div class="flex items-center gap-2 px-3 py-1.5 bg-muted/80 rounded-lg text-xs border border-border/50">
                <FiPlus size={10} class="rotate-45 text-muted-foreground" />
                <span class="truncate max-w-[150px] font-medium">
                  {file.name}
                </span>
                <button
                  type="button"
                  class="p-1 hover:bg-muted rounded text-muted-foreground"
                  onClick={() => props.onAttach?.([])}
                >
                  <FiX size={12} />
                </button>
              </div>
            ))}
          </div>
        </Show>

        {/* Top Row: Textarea + Send Button */}
        <div class="flex items-end gap-2 p-2 sm:p-3">
          {/* Attach Button */}
          <button
            type="button"
            class="p-2.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-xl transition-all duration-200 shrink-0"
            title="Attach files"
            aria-label="Attach files"
            disabled={props.disabled}
            onClick={handleAttach}
          >
            <FiPlus size={20} />
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
            class="flex-1 px-2 py-2 bg-transparent border-none outline-none resize-none text-[15px] sm:text-sm max-h-[200px] min-h-[44px] leading-relaxed placeholder:opacity-40 text-foreground"
            disabled={props.disabled}
            rows={1}
          />
        </div>

        {/* Bottom Toolbar */}
        <div class="flex items-center px-2 sm:px-3 pb-2 sm:pb-3 gap-2">
          <div class="flex items-center gap-1.5">
            {/* Settings Button with Permission Dropdown */}
            <div class="relative">
              <button
                type="button"
                class={cn(
                  "btn btn-ghost h-9 px-3 gap-2 text-xs transition-all rounded-xl",
                  showSettings()
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                onClick={() => setShowSettings(!showSettings())}
                title="Settings"
                aria-label="Settings"
              >
                <FiSettings size={16} />
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
                <div class="fixed bottom-0 left-0 right-0 z-101 overflow-hidden rounded-t-3xl border-t border-border/50 bg-base-300 shadow-2xl transition-all duration-300 animate-slide-up sm:absolute sm:bottom-full sm:left-0 sm:right-auto sm:mb-2 sm:w-64 sm:rounded-2xl">
                  {/* Handle for mobile bottom sheet */}
                  <div class="flex justify-center py-3 sm:hidden">
                    <div class="w-10 h-1 bg-muted rounded-full" />
                  </div>

                  <div class="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                    <div class="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Permission Mode
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-square sm:hidden"
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
                          "w-full flex items-center gap-3 px-4 py-3 text-left rounded-xl transition-all",
                          props.permissionMode === option.value
                            ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                            : "hover:bg-muted/50",
                        )}
                        onClick={() => {
                          props.onPermissionModeChange?.(option.value);
                          setShowSettings(false);
                        }}
                      >
                        <div class="flex-1 min-w-0">
                          <div class="text-sm font-semibold">
                            {option.label}
                          </div>
                          <div class="text-xs text-muted-foreground truncate">
                            {option.description}
                          </div>
                        </div>
                        <Show when={props.permissionMode === option.value}>
                          <FiCheck size={16} class="shrink-0" />
                        </Show>
                      </button>
                    ))}
                  </div>
                  {/* Extra spacing for mobile safe area */}
                  <div class="h-6 sm:hidden" />
                </div>
              </Show>
            </div>

            {/* File Browser Button */}
            <button
              type="button"
              class={cn(
                "btn btn-ghost h-9 px-3 gap-2 text-xs transition-all rounded-xl",
                props.rightPanelView === "file"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
              onClick={() => {
                props.onToggleFileBrowser?.();
              }}
              title="Toggle file browser"
              aria-label="Toggle file browser"
              disabled={props.disabled}
            >
              <FiFolder size={16} />
              <span class="hidden sm:inline">Files</span>
            </button>

            {/* Git Button */}
            <button
              type="button"
              class={cn(
                "btn btn-ghost h-9 px-3 gap-2 text-xs transition-all rounded-xl",
                props.rightPanelView === "git"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
              onClick={() => {
                props.onToggleGitPanel?.();
              }}
              title="Toggle git panel"
              aria-label="Toggle git panel"
              disabled={props.disabled}
            >
              <FiGitBranch size={16} />
              <span class="hidden sm:inline">Git</span>
            </button>
          </div>

          {/* Right side: Streaming indicator with bouncing dots */}
          <div class="hidden sm:flex items-center gap-2 text-xs text-muted-foreground ml-2">
            <Show
              when={isStreamingNow()}
              fallback={
                <Show when={props.value.trim() && !props.disabled}>
                  <span class="text-muted-foreground/60">Ready to send</span>
                </Show>
              }
            >
              <div class="flex items-center gap-1.5">
                <span class="text-primary font-medium">Thinking</span>
                <div class="flex items-center gap-0.5">
                  <span
                    class="w-1.5 h-1.5 bg-primary rounded-full animate-bounce-dot"
                    style="animation-delay: 0ms;"
                  />
                  <span
                    class="w-1.5 h-1.5 bg-primary rounded-full animate-bounce-dot"
                    style="animation-delay: 150ms;"
                  />
                  <span
                    class="w-1.5 h-1.5 bg-primary rounded-full animate-bounce-dot"
                    style="animation-delay: 300ms;"
                  />
                </div>
              </div>
            </Show>
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
              "btn h-9 w-9 sm:h-10 sm:w-auto sm:px-4 rounded-xl shadow-lg transition-all duration-300 ml-auto shrink-0",
              props.isStreaming
                ? "btn-error bg-red-500 hover:bg-red-600 shadow-red-500/20"
                : "btn-primary shadow-primary/20 hover:shadow-primary/30",
            )}
            title={props.isStreaming ? "Stop generation" : "Send message"}
            aria-label={props.isStreaming ? "Stop generation" : "Send message"}
          >
            <Show
              when={props.isStreaming}
              fallback={
                <div class="flex items-center gap-2">
                  <FiSend size={16} />
                  <span class="text-sm font-semibold hidden sm:inline">
                    Send
                  </span>
                </div>
              }
            >
              <FaSolidStopCircle size={20} />
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
