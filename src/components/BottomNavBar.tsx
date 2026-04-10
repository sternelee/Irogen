/**
 * BottomNavBar Component
 *
 * Mobile bottom navigation bar with Topology, Chat, Hosts, and Preview tabs
 */

import { Show, type Component, For } from "solid-js";
import {
  navigationStore,
  type NavigationView,
} from "../stores/navigationStore";
import { sessionStore } from "../stores/sessionStore";
import { FiActivity, FiServer, FiMessageSquare, FiBox } from "solid-icons/fi";
import { cn } from "../lib/utils";

// ============================================================================
// Types
// ============================================================================

interface NavItem {
  id: NavigationView;
  icon: typeof FiActivity;
}

// ============================================================================
// Navigation Items
// ============================================================================

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: FiActivity },
  { id: "chat", icon: FiMessageSquare },
  { id: "hosts", icon: FiServer },
  { id: "proxies", icon: FiBox },
];

// ============================================================================
// Component
// ============================================================================

export const BottomNavBar: Component = () => {
  const activeView = () => navigationStore.state.activeView;

  const handleNavClick = (view: NavigationView) => {
    navigationStore.setActiveView(view);
  };

  return (
    <footer class="fixed bottom-0 z-50 flex h-12 w-full items-stretch justify-around rounded-t-2xl border-t border-base-content/10 bg-base-100 pb-safe shadow-2xl md:hidden">
      <For each={NAV_ITEMS}>
        {(item) => {
          const isActive = () => activeView() === item.id;
          const Icon = item.icon;

          return (
            <button
              type="button"
              aria-label={item.id}
              class={cn(
                "relative my-0.5 flex h-[calc(100%-0.25rem)] min-w-0 flex-1 items-center justify-center rounded-xl px-2 transition-all duration-200",
                isActive()
                  ? "bg-primary/10 text-primary ring-1 ring-primary/15"
                  : "text-base-content/40 hover:bg-base-content/5 hover:text-base-content/70",
              )}
              onClick={() => handleNavClick(item.id)}
            >
              <Icon size={18} class={isActive() ? "text-primary" : ""} />
              <Show
                when={
                  item.id === "chat" &&
                  sessionStore.getActiveSessions().length > 0
                }
              >
                <span class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              </Show>
            </button>
          );
        }}
      </For>
    </footer>
  );
};

export default BottomNavBar;
