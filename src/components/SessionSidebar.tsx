/**
 * SessionSidebar Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import { Show, For, type Component, createMemo, createSignal } from "solid-js";
import {
  FiActivity,
  FiSettings,
  FiChevronDown,
  FiFolder,
  FiHome,
  FiList,
  FiMessageSquare,
  FiMonitor,
  FiPlus,
  FiStopCircle,
  FiX,
} from "solid-icons/fi";
import {
  navigationStore,
  type NavigationView,
} from "../stores/navigationStore";
import { sessionStore } from "../stores/sessionStore";
import type { AgentSessionMetadata } from "../stores/sessionStore";
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
// Types
// ============================================================================

interface ThreadGroup {
  projectPath: string;
  projectName: string;
  sessions: AgentSessionMetadata[];
  lastStartedAt: number;
}

// ============================================================================
// Thread Item Component
// ============================================================================

interface ThreadItemProps {
  session: AgentSessionMetadata;
  isActive: boolean;
  onSelect: () => void;
  onStop: () => void;
  onArchive: () => void;
}

const ThreadItem: Component<ThreadItemProps> = (props) => {
  return (
    <div
      class={cn(
        "flex items-center gap-2 px-2 py-1.5 border-b border-black/5",
        props.isActive
          ? "bg-zinc-100 dark:bg-zinc-800 text-foreground"
          : "text-zinc-500 hover:text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900",
      )}
    >
      <span
        class={cn(
          "w-2 h-2 rounded-full shrink-0",
          props.session.active ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-600",
        )}
      />
      <button
        type="button"
        class="flex-1 min-w-0 text-left text-xs font-medium truncate capitalize"
        onClick={props.onSelect}
      >
        {props.session.agentType}
      </button>
      <Show when={props.session.active}>
        <button
          type="button"
          class="text-zinc-400 hover:text-yellow-600"
          onClick={(event) => {
            event.stopPropagation();
            props.onStop();
          }}
          title="Stop"
          aria-label="Stop thread"
        >
          <FiStopCircle size={11} />
        </button>
      </Show>
      <button
        type="button"
        class="text-zinc-400 hover:text-red-500"
        onClick={(event) => {
          event.stopPropagation();
          props.onArchive();
        }}
        title="Close"
        aria-label="Close thread"
      >
        <FiX size={11} />
      </button>
    </div>
  );
};

// ============================================================================
// Thread Group Component (Collapsible)
// ============================================================================

interface ThreadGroupSectionProps {
  group: ThreadGroup;
  activeSessionId: string | null;
  onSelectThread: (sessionId: string) => void;
  onStopThread: (sessionId: string) => void;
  onArchiveThread: (sessionId: string) => void;
  onNewThread: (session: AgentSessionMetadata) => void;
}

const ThreadGroupSection: Component<ThreadGroupSectionProps> = (props) => {
  const [isCollapsed, setIsCollapsed] = createSignal(false);

  const activeCount = () => props.group.sessions.filter(s => s.active).length;

  return (
    <div class="border border-black/10 dark:border-white/10">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 px-2 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        onClick={() => setIsCollapsed(c => !c)}
      >
        <div class="flex items-center gap-2 min-w-0">
          <FiFolder size={12} class="text-zinc-400 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-foreground truncate">
                {props.group.projectName}
              </span>
              <Show when={activeCount() > 0}>
                <span class="text-[10px] font-medium text-green-600 dark:text-green-400">
                  {activeCount()}
                </span>
              </Show>
            </div>
            <div class="text-[10px] text-zinc-400 truncate">
              {props.group.projectPath}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="text-zinc-400 hover:text-foreground p-1"
            onClick={(event) => {
              event.stopPropagation();
              if (props.group.sessions[0]) {
                props.onNewThread(props.group.sessions[0]);
              }
            }}
            title="New thread"
            aria-label="New thread in this project"
          >
            <FiPlus size={11} />
          </button>
          <FiChevronDown
            size={11}
            class={cn(
              "text-zinc-400",
              isCollapsed() && "-rotate-90"
            )}
          />
        </div>
      </button>
      <Show when={!isCollapsed()}>
        <div>
          <For each={props.group.sessions}>
            {(session) => (
              <ThreadItem
                session={session}
                isActive={props.activeSessionId === session.sessionId}
                onSelect={() => props.onSelectThread(session.sessionId)}
                onStop={() => props.onStopThread(session.sessionId)}
                onArchive={() => props.onArchiveThread(session.sessionId)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const getProjectName = (projectPath: string) => {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || projectPath || "Untitled";
};

// ============================================================================
// Connection Status Badge
// ============================================================================

const ConnectionBadge: Component = () => {
  const connectionState = () => sessionStore.state.connectionState;
  const isConnected = () => connectionState() === "connected";
  const isReconnecting = () => connectionState() === "reconnecting";

  return (
    <div class="flex items-center gap-2 px-2 py-1.5 border-t border-black/10">
      <span
        class={cn(
          "w-2 h-2 rounded-full",
          isConnected() && "bg-green-500",
          isReconnecting() && "bg-yellow-500",
          !isConnected() && !isReconnecting() && "bg-zinc-300",
        )}
      />
      <span class="text-[11px] text-zinc-500">
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
        "flex w-full items-center gap-3 px-3 py-2 text-sm font-medium border-l-2",
        props.isActive
          ? "border-l-primary bg-zinc-100 dark:bg-zinc-800 text-foreground"
          : "border-l-transparent text-zinc-500 hover:text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900",
      )}
    >
      <Icon
        size={16}
        class={cn(
          props.isActive ? "text-primary" : "text-zinc-400",
        )}
      />
      <span class="flex-1 text-left">{props.item.label()}</span>
      <Show when={hasActiveSession}>
        <span class="w-2 h-2 rounded-full bg-primary" />
      </Show>
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
  const threadGroups = createMemo<ThreadGroup[]>(() => {
    const groups = new Map<string, ThreadGroup>();

    for (const session of sessions()) {
      const existing = groups.get(session.projectPath);
      if (existing) {
        existing.sessions.push(session);
        existing.lastStartedAt = Math.max(
          existing.lastStartedAt,
          session.startedAt,
        );
      } else {
        groups.set(session.projectPath, {
          projectPath: session.projectPath,
          projectName: getProjectName(session.projectPath),
          sessions: [session],
          lastStartedAt: session.startedAt,
        });
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        sessions: group.sessions.sort((a, b) => b.startedAt - a.startedAt),
      }))
      .sort((a, b) => b.lastStartedAt - a.lastStartedAt);
  });

  const handleNavClick = (view: NavigationView) => {
    navigationStore.setActiveView(view);
    if (window.innerWidth < 768) {
      props.onToggle();
    }
  };

  const openThread = (sessionId: string) => {
    sessionStore.setActiveSession(sessionId);
    navigationStore.setActiveView("workspace");
    if (window.innerWidth < 768) {
      props.onToggle();
    }
  };

  const startThreadForProject = (session: AgentSessionMetadata) => {
    sessionStore.openNewSessionModal(
      session.mode || "remote",
      session.controlSessionId,
      false,
      session.projectPath,
      true,
    );
    sessionStore.setNewSessionAgent(session.agentType);
  };

  return (
    <aside class="flex h-full w-full flex-col bg-zinc-50 dark:bg-zinc-950 border-r border-black/10">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-black/10">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center bg-black dark:bg-white text-white dark:text-black text-sm font-bold">
            P
          </div>
          <div>
            <h1 class="text-sm font-bold text-foreground leading-none">
              Irogen
            </h1>
            <p class="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">
              Agent Control
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div class="flex-1 overflow-y-auto py-2">
        <div class="px-3 py-2">
          <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">
            Navigation
          </span>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavItemButton
              item={item}
              isActive={activeView() === item.id}
              onClick={() => handleNavClick(item.id)}
            />
          ))}
        </nav>

        <div class="mt-4">
          <div class="flex items-center justify-between px-3 py-2">
            <div class="flex items-center gap-2">
              <FiMessageSquare size={11} class="text-zinc-400" />
              <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">
                Threads
              </span>
            </div>
            <button
              type="button"
              class="text-zinc-400 hover:text-foreground p-1"
              onClick={() => sessionStore.openNewSessionModal()}
              title="New thread"
              aria-label="New thread"
            >
              <FiPlus size={13} />
            </button>
          </div>
          <Show
            when={threadGroups().length > 0}
            fallback={
              <div class="px-3 py-6 text-center">
                <p class="text-xs text-zinc-500">
                  No threads yet
                </p>
              </div>
            }
          >
            <div class="space-y-2 px-3">
              <For each={threadGroups()}>
                {(group) => (
                  <ThreadGroupSection
                    group={group}
                    activeSessionId={activeSession()?.sessionId ?? null}
                    onSelectThread={openThread}
                    onStopThread={(sessionId) => void sessionStore.stopSession(sessionId)}
                    onArchiveThread={(sessionId) => sessionStore.archiveSession(sessionId)}
                    onNewThread={startThreadForProject}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={sessions().length > 0}>
          <div class="mt-4">
            <div class="px-3 py-2">
              <span class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">
                Library
              </span>
            </div>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-500 hover:text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-900"
              onClick={() => handleNavClick("sessions")}
            >
              <FiList size={14} />
              <span class="flex-1 text-left">{t("sidebar.sessions")}</span>
              <span class="text-xs text-zinc-400">{sessions().length}</span>
            </button>
          </div>
        </Show>
      </div>

      {/* Footer - Connection Status */}
      <ConnectionBadge />
    </aside>
  );
};

export default SessionSidebar;