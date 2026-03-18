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
  const [showMobileTools, setShowMobileTools] = createSignal(false);
  const [toolbarTouchStartY, setToolbarTouchStartY] = createSignal<
    number | null
  >(null);
  const [activeMentionIndex, setActiveMentionIndex] = createSignal(0);
  const [activeSlashIndex, setActiveSlashIndex] = createSignal(0);
  const mobile = () => isMobile();
  const isStreamingNow = () => !!props.isStreaming;
  const showAdvancedTools = () => !isStreamingNow();
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
          setShowMobileTools(false);
          setShowSettings(false);
        }
      } else if (props.value.trim()) {
        props.onSubmit();
        if (mobile()) {
          setShowMobileTools(false);
          setShowSettings(false);
        }
      }
    }
  };

  createEffect(() => {
    if (!mobile()) {
      setShowMobileTools(true);
    }
  });

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
        "flex flex-col gap-1.5 px-2.5 sm:px-4 pt-2 sm:pt-3 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] sm:pb-3 bg-background/85 backdrop-blur-md sticky bottom-0 z-20",
        focused() && "bg-background",
        props.class,
      )}
    >
      {/* Input Container with Toolbar Inside */}
      <div
        class={cn(
          "relative flex flex-col rounded-2xl border-2 bg-muted/30 transition-all duration-300",
          focused()
            ? "border-primary/50 shadow-xl shadow-primary/5 bg-background"
            : "border-border/60 hover:border-muted-foreground/20 hover:bg-muted/50",
        )}
      >
        <Show when={showMentionSuggestions()}>
          <div class="absolute left-2 right-2 sm:left-3 sm:right-3 bottom-[calc(100%+0.375rem)] z-40 rounded-xl border border-border/50 bg-base-300/95 shadow-lg max-h-[7.5rem] sm:max-h-[13rem] overflow-y-auto">
            {mentionSuggestions().map((item, index) => (
              <button
                type="button"
                class={cn(
                  "w-full px-3 py-2 text-left text-xs sm:text-sm transition-colors min-h-10 sm:min-h-11",
                  index === activeMentionIndex()
                    ? "bg-primary/15 text-primary"
                    : "hover:bg-muted/60",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onSelectMention?.(item.path)}
              >
                <span class="font-medium">{item.path}</span>
              </button>
            ))}
          </div>
        </Show>

        <Show when={showSlashSuggestions()}>
          <div class="absolute left-2 right-2 sm:left-3 sm:right-3 bottom-[calc(100%+0.375rem)] z-40 rounded-xl border border-border/50 bg-base-300/95 shadow-lg max-h-[7.5rem] sm:max-h-[13rem] overflow-y-auto">
            {slashSuggestions().map((item, index) => (
              <button
                type="button"
                class={cn(
                  "w-full px-3 py-2 text-left transition-colors",
                  index === activeSlashIndex()
                    ? "bg-primary/15 text-primary"
                    : "hover:bg-muted/60",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onSelectSlash?.(item.value || item.name)}
              >
                <div class="text-xs sm:text-sm font-medium">/{item.name}</div>
                <Show when={item.description}>
                  <div class="mt-0.5 text-[11px] sm:text-xs text-muted-foreground line-clamp-2">
                    {item.description}
                  </div>
                </Show>
              </button>
            ))}
          </div>
        </Show>

        {/* Top Row: Textarea + Send Button */}
        <div class="flex items-end gap-1.5 sm:gap-2 p-1.5 sm:p-2 pb-1">
          {/* Attach Button */}
          <button
            type="button"
            class="p-2 text-muted-foreground/60 hover:text-foreground hover:bg-muted/80 rounded-xl transition-all duration-200 shrink-0 hidden"
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
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder || "Type your message..."}
            aria-label="Chat input"
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
        <div
          class="flex items-center px-3 pb-1 gap-2"
          onTouchStart={(e) => {
            if (!mobile() || e.touches.length !== 1) return;
            setToolbarTouchStartY(e.touches[0].clientY);
          }}
          onTouchEnd={(e) => {
            const startY = toolbarTouchStartY();
            setToolbarTouchStartY(null);
            if (!mobile() || startY === null) return;
            const endY = e.changedTouches[0]?.clientY ?? startY;
            const deltaY = endY - startY;
            if (deltaY < -35) {
              setShowMobileTools(true);
            } else if (deltaY > 35) {
              setShowMobileTools(false);
            }
          }}
        >
          <Show when={mobile()}>
            <button
              type="button"
              class="btn btn-ghost btn-sm h-9 min-h-9 w-9 rounded-md hide-on-keyboard"
              onClick={() => setShowMobileTools((prev) => !prev)}
              title={showMobileTools() ? "Hide tools" : "Show tools"}
              aria-label={showMobileTools() ? "Hide tools" : "Show tools"}
            >
              <Show
                when={showMobileTools()}
                fallback={<FiPlus class="size-4" />}
              >
                <FiX class="size-4" />
              </Show>
            </button>
          </Show>

          <Show when={!mobile() || showMobileTools()}>
            <div class="flex items-center gap-0.5 hide-on-keyboard">
              {/* Settings Button with Permission Dropdown */}
              <div class="relative">
                <button
                  type="button"
                  class={cn(
                    "btn btn-ghost btn-sm h-9 min-h-9 px-2.5 gap-1 text-[11px] transition-all rounded-md",
                    showSettings()
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50",
                  )}
                  onClick={() => setShowSettings(!showSettings())}
                  title="Settings"
                  aria-label="Settings"
                >
                  <FiSettings class="size-4 sm:size-4" />
                  <span class="hidden sm:inline">Settings</span>
                </button>

                {/* Settings Dropdown */}
                <Show when={showSettings()}>
                  <div class="absolute bottom-full left-0 mb-2 w-48 bg-base-300 rounded-lg border border-border shadow-xl z-50 overflow-hidden">
                    <div class="px-3 py-2 border-b border-border">
                      <div class="text-xs font-medium text-muted-foreground">
                        Permission Mode
                      </div>
                    </div>
                    <div class="p-1">
                      {permissionOptions.map((option) => (
                        <button
                          type="button"
                          class={cn(
                            "w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded-md transition-colors",
                            props.permissionMode === option.value
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted",
                          )}
                          onClick={() => {
                            props.onPermissionModeChange?.(option.value);
                            setShowSettings(false);
                          }}
                        >
                          <div class="flex-1 min-w-0">
                            <div class="font-medium">{option.label}</div>
                            <div class="text-xs text-muted-foreground truncate">
                              {option.description}
                            </div>
                          </div>
                          <Show when={props.permissionMode === option.value}>
                            <FiCheck size={14} class="text-primary shrink-0" />
                          </Show>
                        </button>
                      ))}
                    </div>
                  </div>
                </Show>
              </div>

              {/* File Browser Button */}
              <Show when={showAdvancedTools()}>
                <>
                  {/* File Browser Button */}
                  <button
                    type="button"
                    class={cn(
                      "btn btn-ghost btn-sm h-9 min-h-9 px-2.5 gap-1 text-[11px] transition-all rounded-md",
                      props.rightPanelView === "file"
                        ? "bg-primary/15 text-primary hover:bg-primary/20"
                        : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50",
                    )}
                    onClick={() => {
                      props.onToggleFileBrowser?.();
                      if (mobile()) {
                        setShowMobileTools(false);
                      }
                    }}
                    title="Toggle file browser"
                    aria-label="Toggle file browser"
                    disabled={props.disabled}
                  >
                    <FiFolder class="size-4 sm:size-4" />
                    <span class="hidden sm:inline">Files</span>
                  </button>

                  {/* Git Panel Button */}
                  <button
                    type="button"
                    class={cn(
                      "btn btn-ghost btn-sm h-9 min-h-9 px-2.5 gap-1 text-[11px] transition-all rounded-md",
                      props.rightPanelView === "git"
                        ? "bg-primary/15 text-primary hover:bg-primary/20"
                        : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50",
                    )}
                    onClick={() => {
                      props.onToggleGitPanel?.();
                      if (mobile()) {
                        setShowMobileTools(false);
                      }
                    }}
                    title="Toggle git panel"
                    aria-label="Toggle git panel"
                    disabled={props.disabled}
                  >
                    <FiGitBranch class="size-4 sm:size-4" />
                    <span class="hidden sm:inline">Git</span>
                  </button>
                </>
              </Show>
            </div>
          </Show>

          {/* Right side: Keyboard hints */}
          <div class="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground/40">
            <Show when={isStreamingNow()}>
              <span class="text-[10px] text-primary/80">Generating...</span>
            </Show>
            <span class="hidden sm:flex items-center gap-0.5">
              <kbd class="kbd kbd-xs bg-muted/40 border-border/20">↵</kbd>
              <span>line</span>
            </span>
            <span class="hidden sm:flex items-center gap-0.5">
              <kbd class="kbd kbd-xs bg-muted/40 border-border/20">⇧↵</kbd>
              <span>send</span>
            </span>
            <span class="hidden sm:flex items-center gap-0.5">
              <kbd class="kbd kbd-xs bg-muted/40 border-border/20">⌘↵</kbd>
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
                  setShowMobileTools(false);
                  setShowSettings(false);
                }
              } else {
                props.onSubmit();
                if (mobile()) {
                  setShowMobileTools(false);
                  setShowSettings(false);
                }
              }
            }}
            disabled={
              !props.isStreaming && (!props.value.trim() || props.disabled)
            }
            class={cn(
              "btn btn-sm h-8 min-h-8 shrink-0 ml-auto inline-flex justify-center items-center rounded-xl transition-all duration-300 mb-0.5",
              props.isStreaming ? "p-2" : "disabled:cursor-not-allowed",
            )}
            title={props.isStreaming ? "Stop generation" : "Send message"}
            aria-label={props.isStreaming ? "Stop generation" : "Send message"}
          >
            <Show
              when={props.isStreaming}
              fallback={
                <div class="flex items-center gap-1.5 px-1.5 py-0.5">
                  <FiSend class="size-4 text-white" />
                  <span class="text-sm font-medium text-white hidden sm:inline">
                    Send
                  </span>
                </div>
              }
            >
              <FaSolidStopCircle size={24} />
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
