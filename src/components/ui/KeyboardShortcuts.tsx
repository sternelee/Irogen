/**
 * Keyboard Shortcuts Component - DaisyUI v5
 *
 * Features:
 * - Common shortcuts overlay (? to show)
 * - DaisyUI kbd classes for badges
 * - Grouped by category with DaisyUI styling
 * - Global keyboard listener
 */

import { type Component, Show, For, onMount, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "~/lib/utils";
import {
  FiX,
  FiHelpCircle,
  FiCommand,
  FiMessageSquare,
  FiNavigation,
  FiGrid,
} from "solid-icons/fi";

// ============================================================================
// Types
// ============================================================================

export interface KeyboardShortcut {
  key: string;
  description: string;
  category: string;
}

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  class?: string;
}

// ============================================================================
// Shortcuts Definition
// ============================================================================

const shortcuts: KeyboardShortcut[] = [
  // Global
  { key: "⌘ B", description: "Toggle sidebar", category: "Global" },
  { key: "?", description: "Show keyboard shortcuts", category: "Global" },
  { key: "Esc", description: "Close dialogs / Cancel", category: "Global" },
  { key: "⌘ K", description: "Open command palette", category: "Global" },

  // Chat
  { key: "Enter", description: "New line in message", category: "Chat" },
  { key: "Shift Enter", description: "Send message", category: "Chat" },
  { key: "↑", description: "Navigate to previous message", category: "Chat" },
  { key: "↓", description: "Navigate to next message", category: "Chat" },

  // Navigation
  { key: "1-9", description: "Switch to session", category: "Navigation" },
  { key: "Tab", description: "Focus next element", category: "Navigation" },
  { key: "Shift Tab", description: "Focus previous element", category: "Navigation" },

  // Permissions
  { key: "Y", description: "Allow permission", category: "Permissions" },
  { key: "N", description: "Deny permission", category: "Permissions" },
];

// Category Icons
const categoryIcons: Record<string, typeof FiCommand> = {
  Global: FiCommand,
  Chat: FiMessageSquare,
  Navigation: FiNavigation,
  Permissions: FiGrid,
};

// ============================================================================
// Kbd Shortcut Component (DaisyUI kbd)
// ============================================================================

export interface KbdShortcutProps {
  keys: string | string[];
  class?: string;
}

export const KbdShortcut: Component<KbdShortcutProps> = (props) => {
  const keys = () => Array.isArray(props.keys) ? props.keys : [props.keys];

  return (
    <div class={cn("flex items-center gap-1", props.class)}>
      {keys().map((key, index) => (
        <>
          <kbd class="kbd kbd-sm">{key}</kbd>
          {index < keys().length - 1 && (
            <span class="text-base-content/40 text-xs">+</span>
          )}
        </>
      ))}
    </div>
  );
};

// ============================================================================
// Keyboard Shortcuts Dialog
// ============================================================================

export const KeyboardShortcutsDialog: Component<KeyboardShortcutsDialogProps> = (props) => {
  // Group shortcuts by category
  const groupedShortcuts = () => {
    const groups: Record<string, KeyboardShortcut[]> = {};
    for (const shortcut of shortcuts) {
      if (!groups[shortcut.category]) {
        groups[shortcut.category] = [];
      }
      groups[shortcut.category].push(shortcut);
    }
    return groups;
  };

  // Handle Escape key
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open) {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const CategoryIcon: Component<{ category: string }> = (iconProps) => {
    const Icon = categoryIcons[iconProps.category] || FiCommand;
    return (
      <div class="p-1.5 rounded-md bg-base-200">
        <Icon size={14} class="text-base-content/60" />
      </div>
    );
  };

  return (
    <Show when={props.open}>
      <Portal>
        {/* Backdrop */}
        <div
          class="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
          onClick={props.onClose}
        />

        {/* Dialog - DaisyUI card style */}
        <div
          class={cn(
            "fixed inset-0 z-[101] flex items-center justify-center p-4",
            "pointer-events-none"
          )}
        >
          <div
            class={cn(
              "card w-full max-w-lg bg-base-100 shadow-2xl",
              "pointer-events-auto",
              props.class
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div class="card-body p-0">
              <div class="flex items-center justify-between p-4 border-b border-base-300">
                <div class="flex items-center gap-3">
                  <div class="p-2 bg-primary/10 rounded-xl">
                    <FiHelpCircle size={20} class="text-primary" />
                  </div>
                  <div>
                    <h2 class="text-lg font-bold">Keyboard Shortcuts</h2>
                    <p class="text-sm text-base-content/50">Press ? to toggle</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={props.onClose}
                  class="btn btn-sm btn-ghost btn-square"
                >
                  <FiX size={20} />
                </button>
              </div>

              {/* Content */}
              <div class="p-4 max-h-[60vh] overflow-y-auto">
                <div class="space-y-4">
                  <For each={Object.entries(groupedShortcuts())}>
                    {([category, items]) => (
                      <div class="space-y-2">
                        {/* Category Header */}
                        <div class="flex items-center gap-2">
                          <CategoryIcon category={category} />
                          <h3 class="text-sm font-semibold text-base-content/70 uppercase tracking-wide">
                            {category}
                          </h3>
                        </div>

                        {/* Shortcuts List */}
                        <div class="space-y-1">
                          <For each={items}>
                            {(shortcut) => (
                              <div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-base-200/50">
                                <span class="text-sm">{shortcut.description}</span>
                                <kbd class="kbd kbd-sm">{shortcut.key}</kbd>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* Footer */}
              <div class="p-4 border-t border-base-300 bg-base-200/30">
                <div class="flex items-center justify-between text-xs text-base-content/50">
                  <div class="flex items-center gap-1">
                    <span>Press</span>
                    <kbd class="kbd kbd-xs">?</kbd>
                    <span>anytime</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <kbd class="kbd kbd-xs">Esc</kbd>
                    <span>to close</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

// ============================================================================
// Keyboard Shortcuts Provider
// ============================================================================

export interface KeyboardShortcutsProviderProps {
  children: any;
  onToggleShortcuts: () => void;
}

export const KeyboardShortcutsProvider: Component<KeyboardShortcutsProviderProps> = (props) => {
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        props.onToggleShortcuts();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return props.children;
};

export { shortcuts };