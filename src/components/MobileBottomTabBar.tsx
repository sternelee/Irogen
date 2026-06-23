/**
 * MobileBottomTabBar
 *
 * Mobile-only navigation: 4 fixed tabs along the bottom edge.
 * Visible only on small screens (md:hidden). Provides quick access to
 * the primary destinations (Home, Sessions, Devices, Settings).
 */

import { For, Show, type Component, createMemo } from "solid-js";
import {
  FiHome,
  FiMessageSquare,
  FiServer,
  FiSettings,
} from "solid-icons/fi";
import {
  navigationStore,
  type NavigationView,
} from "../stores/navigationStore";
import { sessionStore } from "../stores/sessionStore";
import { chatStore } from "../stores/chatStore";
import { t } from "../stores/i18nStore";
import { cn } from "~/lib/utils";

interface Tab {
  id: NavigationView;
  label: () => string;
  icon: typeof FiHome;
  badge?: () => number;
}

export const MobileBottomTabBar: Component = () => {
  const activeView = createMemo(() => navigationStore.state.activeView);

  const totalActive = createMemo(() =>
    sessionStore.getSessions().filter((s) => s.active).length,
  );
  const totalUnread = createMemo(() => {
    let count = 0;
    for (const s of sessionStore.getSessions()) {
      count += chatStore.getUnreadCount(s.sessionId);
    }
    return count;
  });

  const TABS: Tab[] = [
    { id: "home", label: () => t("sidebar.home") as string, icon: FiHome },
    {
      id: "sessions",
      label: () => t("sidebar.sessions") as string,
      icon: FiMessageSquare,
      badge: () => totalUnread(),
    },
    {
      id: "devices",
      label: () => t("sidebar.devices") as string,
      icon: FiServer,
      badge: () => totalActive(),
    },
    { id: "settings", label: () => t("sidebar.settings") as string, icon: FiSettings },
  ];

  const isActive = (id: NavigationView) => {
    if (id === "sessions") {
      return activeView() === "sessions" ||
        activeView() === "workspace" ||
        activeView() === "chat";
    }
    return activeView() === id;
  };

  const handleClick = (id: NavigationView) => {
    // Close any open sidebar on mobile
    if (navigationStore.state.sidebarOpen) {
      navigationStore.setSidebarOpen(false);
    }
    // If a session is active and user taps Sessions, jump into the workspace
    if (id === "sessions") {
      const active = sessionStore.getActiveSession();
      if (active) {
        navigationStore.setActiveView("workspace");
        return;
      }
    }
    navigationStore.setActiveView(id);
  };

  return (
    <nav
      class="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-base-100 border-t border-base-content/10 flex items-stretch animate-slide-up"
      style={{ "padding-bottom": "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary mobile navigation"
    >
      <For each={TABS}>
        {(tab) => {
          const Icon = tab.icon;
          const active = () => isActive(tab.id);
          const badgeCount = () => tab.badge?.() ?? 0;
          return (
            <button
              type="button"
              class={cn(
                "relative flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors active:scale-95",
                active()
                  ? "text-primary"
                  : "text-base-content/40 hover:text-base-content/70",
              )}
              onClick={() => handleClick(tab.id)}
              aria-current={active() ? "page" : undefined}
              aria-label={tab.label()}
            >
              <div class="relative">
                <Icon size={20} />
                <Show when={badgeCount() > 0}>
                  <span
                    class={cn(
                      "absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold leading-none flex items-center justify-center",
                      tab.id === "sessions"
                        ? "bg-primary text-primary-content"
                        : "bg-success text-success-content",
                    )}
                  >
                    {badgeCount() > 99 ? "99+" : badgeCount()}
                  </span>
                </Show>
              </div>
              <span class="text-[10px] font-medium leading-none">
                {tab.label()}
              </span>
              <span
                class={cn(
                  "absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full bg-primary transition-all duration-200",
                  active() ? "w-8 opacity-100" : "w-0 opacity-0",
                )}
              />
            </button>
          );
        }}
      </For>
    </nav>
  );
};

export default MobileBottomTabBar;
