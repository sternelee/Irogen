/**
 * SessionSidebar Component
 *
 * Left navigation sidebar inspired by OpenChamber's clean design.
 * Shows navigation menu with session-aware indicators.
 * Uses bg-sidebar, bg-background, and border tokens for consistency.
 */

import { Show, For, type Component, createMemo } from "solid-js";
import {
  FiActivity,
  FiSettings,
  FiChevronRight,
  FiHome,
  FiList,
  FiMonitor,
} from "solid-icons/fi";
import {
  navigationStore,
  type NavigationView,
} from "../stores/navigationStore";
import { sessionStore } from "../stores/sessionStore";
import { cn } from "~/lib/utils";

import { t } from "../stores/i18nStore";

// ============================================================================
// Navigation Items
// ============================================================================

interface NavItem {
  id: NavigationView;
  label: () => string;
  icon: typeof FiActivity;
  description?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: () => t("sidebar.home") as string, icon: FiHome },
  {
    id: "sessions",
    label: () => t("sidebar.sessions") as string,
    icon: FiList,
  },
  {
    id: "devices",
    label: () => t("sidebar.devices") as string,
    icon: FiMonitor,
  },
  {
    id: "settings",
    label: () => t("sidebar.settings") as string,
    icon: FiSettings,
  },
];

// ============================================================================
// Connection Status Badge
// ============================================================================

const ConnectionBadge: Component = () => {
  const connectionState = () => sessionStore.state.connectionState;
  const isConnected = () => connectionState() === "connected";
  const isReconnecting = () => connectionState() === "reconnecting";

  return (
    <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
      <span
        class={cn(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          isConnected() && "bg-green-500",
          isReconnecting() && "bg-yellow-500",
          !isConnected() && !isReconnecting() && "bg-muted-foreground/40",
        )}
      >
        <Show when={isConnected()}>
          <span class="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping" />
        </Show>
        <Show when={isReconnecting()}>
          <span class="absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75 animate-ping" />
        </Show>
      </span>
      <span class="text-xs font-medium text-muted-foreground">
        {isConnected()
          ? t("sidebar.connected")
          : isReconnecting()
            ? t("sidebar.reconnecting")
            : t("sidebar.disconnected")}
      </span>
    </div>
  );
};

// ============================================================================
// Nav Item Component
// ============================================================================

interface NavItemButtonProps {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}

const NavItemButton: Component<NavItemButtonProps> = (props) => {
  const Icon = props.item.icon;
  const hasActiveSession =
    props.item.id === "workspace" &&
    sessionStore.getActiveSessions().length > 0;

  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cn(
        "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150",
        "hover:bg-muted/60",
        props.isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {/* Active indicator bar */}
      <span
        class={cn(
          "absolute left-0 h-8 w-1 rounded-r-full bg-primary transition-all duration-200",
          props.isActive ? "opacity-100" : "opacity-0 -translate-x-1",
        )}
      />

      <Icon
        size={18}
        class={cn(
          "transition-colors shrink-0",
          props.isActive
            ? "text-primary"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span class="flex-1 text-left text-sm font-medium">
        {props.item.label()}
      </span>

      {/* Active session indicator */}
      <Show when={hasActiveSession}>
        <span class="flex h-2 w-2">
          <span class="absolute h-2 w-2 rounded-full bg-primary opacity-75 animate-ping" />
          <span class="relative h-2 w-2 rounded-full bg-primary" />
        </span>
      </Show>

      <FiChevronRight
        size={14}
        class={cn(
          "transition-all text-muted-foreground/40",
          props.isActive && "text-primary/60 rotate-90",
        )}
      />
    </button>
  );
};

// ============================================================================
// SessionSidebar Component
// ============================================================================

interface SessionSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const activeView = () => navigationStore.state.activeView;
  const sessions = createMemo(() => sessionStore.getSessions());
  const activeSession = createMemo(() => sessionStore.getActiveSession());

  const handleNavClick = (view: NavigationView) => {
    navigationStore.setActiveView(view);
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 768) {
      props.onToggle();
    }
  };

  return (
    <aside class="flex h-full w-full flex-col bg-sidebar border-r border-border/50">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-4 border-b border-border/50">
        <div class="flex items-center gap-3">
          {/* App Logo */}
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/20">
            <span class="text-primary-content font-black text-base">P</span>
          </div>
          <div>
            <h1 class="text-sm font-bold tracking-tight text-foreground leading-none">
              Irogen
            </h1>
            <p class="text-[10px] text-muted-foreground mt-0.5 font-medium uppercase tracking-wider">
              {t("sidebar.agentControl")}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div class="flex-1 overflow-y-auto px-3 py-4">
        {/* Section label */}
        <div class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {t("sidebar.navigation")}
        </div>

        {/* Nav items */}
        <nav class="relative space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavItemButton
              item={item}
              isActive={activeView() === item.id}
              onClick={() => handleNavClick(item.id)}
            />
          ))}
        </nav>

        {/* Active Sessions Quick View */}
        <Show when={sessions().length > 0}>
          <div class="mt-6">
            <div class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {t("sidebar.activeSessions")}
            </div>
            <div class="space-y-1">
              <For each={sessions().slice(0, 3)}>
                {(session) => (
                  <button
                    type="button"
                    class={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-150",
                      activeSession()?.sessionId === session.sessionId
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() => {
                      sessionStore.setActiveSession(session.sessionId);
                      navigationStore.setActiveView("workspace");
                    }}
                  >
                    {/* Status dot */}
                    <span
                      class={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        session.active
                          ? "bg-green-500"
                          : "bg-muted-foreground/40",
                      )}
                    />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium">
                        {session.agentType}
                      </div>
                      <div class="truncate text-[10px] text-muted-foreground/70">
                        {session.projectPath.split("/").pop()}
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      {/* Footer - Connection Status */}
      <div class="border-t border-border/50 p-3">
        <ConnectionBadge />
      </div>
    </aside>
  );
};

export default SessionSidebar;
