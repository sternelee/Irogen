/**
 * SessionSidebar Component
 *
 * LobeHub-inspired redesign:
 * - Search bar for filtering sessions
 * - Agent avatar with colored initial + status dot
 * - Sessions grouped by project with unread badges
 * - Last message preview text
 * - Clean nav items with active indicators
 * - Smooth hover transitions
 */

import {
  Show,
  For,
  type Component,
  createMemo,
  createSignal,
} from "solid-js";
import {
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
  FiSearch,
} from "solid-icons/fi";
import {
  navigationStore,
  type NavigationView,
} from "../stores/navigationStore";
import { sessionStore } from "../stores/sessionStore";
import { chatStore } from "../stores/chatStore";
import type { AgentSessionMetadata } from "../stores/sessionStore";
import { cn } from "~/lib/utils";
import { t } from "../stores/i18nStore";

// ============================================================================
// Agent Avatar Helpers
// ============================================================================

const AGENT_COLORS: Record<string, string> = {
  claude: "bg-primary text-primary-content",
  gemini: "bg-info text-info-content",
  codex: "bg-success text-success-content",
  opencode: "bg-warning text-warning-content",
  default: "bg-accent text-accent-content",
};

function agentColor(agentType: string): string {
  return AGENT_COLORS[agentType.toLowerCase()] || AGENT_COLORS.default;
}

function agentInitial(agentType: string): string {
  return agentType.charAt(0).toUpperCase();
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// ============================================================================
// Navigation Items
// ============================================================================

interface NavItem {
  id: NavigationView;
  label: () => string;
  icon: typeof FiHome;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: () => t("sidebar.home") as string, icon: FiHome },
  { id: "devices", label: () => t("sidebar.devices") as string, icon: FiMonitor },
  { id: "settings", label: () => t("sidebar.settings") as string, icon: FiSettings },
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
// Search Bar
// ============================================================================

const SearchBar: Component<{
  value: string;
  onInput: (v: string) => void;
}> = (props) => {
  return (
    <div class="relative px-3 py-2">
      <FiSearch
        size={13}
        class="absolute left-5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none"
      />
      <input
        type="text"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder="Search sessions..."
        class="input input-bordered input-sm w-full pl-8"
      />
      <Show when={props.value}>
        <button
          type="button"
          class="absolute right-5 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content"
          onClick={() => props.onInput("")}
        >
          <FiX size={12} />
        </button>
      </Show>
    </div>
  );
};

// ============================================================================
// Nav Item Button
// ============================================================================

const NavItemButton: Component<{
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}> = (props) => {
  const Icon = props.item.icon;

  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-150",
        props.isActive
          ? "bg-base-200 text-base-content"
          : "text-base-content/50 hover:text-base-content hover:bg-base-200/50",
      )}
    >
      <Icon
        size={16}
        class={cn(props.isActive ? "text-primary" : "text-base-content/40")}
      />
      <span>{props.item.label()}</span>
    </button>
  );
};

// ============================================================================
// Session Item
// ============================================================================

const SessionItem: Component<{
  session: AgentSessionMetadata;
  isActive: boolean;
  onSelect: () => void;
  onStop: () => void;
  onArchive: () => void;
}> = (props) => {
  const unread = createMemo(() => chatStore.getUnreadCount(props.session.sessionId));
  const lastMessage = createMemo(() => {
    const msgs = chatStore.getMessages(props.session.sessionId);
    if (msgs.length === 0) return null;
    const last = msgs[msgs.length - 1];
    const text = last.content || "";
    // Strip markdown formatting for preview
    return text.replace(/[#*`\[\]]/g, "").substring(0, 60);
  });

  return (
    <div
      class={cn(
        "group flex items-start gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150",
        props.isActive
          ? "bg-base-200"
          : "hover:bg-base-200/50",
      )}
      onClick={props.onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && props.onSelect()}
    >
      {/* Agent Avatar */}
      <div class={cn(
        "w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 mt-0.5",
        agentColor(props.session.agentType),
      )}>
        {agentInitial(props.session.agentType)}
      </div>

      {/* Content */}
      <div class="flex-1 min-w-0">
        {/* Title row */}
        <div class="flex items-center gap-1.5">
          <span class={cn(
            "text-xs font-semibold truncate",
            props.isActive ? "text-base-content" : "text-base-content/70",
          )}>
            {props.session.agentType}
          </span>
          <span class={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            props.session.active ? "bg-success" : "bg-base-content/20",
          )} />
          <span class="text-[9px] text-base-content/30 ml-auto shrink-0">
            {formatRelativeTime(props.session.startedAt)}
          </span>
        </div>

        {/* Last message preview */}
        <Show
          when={lastMessage()}
          fallback={
            <div class="text-[10px] text-base-content/30 italic mt-0.5 truncate">
              No messages yet
            </div>
          }
        >
          <div class="text-[10px] text-base-content/40 mt-0.5 truncate leading-relaxed">
            {lastMessage()}
          </div>
        </Show>
      </div>

      {/* Unread badge */}
      <Show when={unread() > 0}>
        <span class="px-1.5 py-0.5 rounded-full bg-primary text-primary-content text-[9px] font-bold min-w-[16px] text-center leading-none mt-1">
          {unread() > 99 ? "99+" : unread()}
        </span>
      </Show>

      {/* Actions (hover) */}
      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
        <Show when={props.session.active}>
          <button
            type="button"
            class="p-1 rounded text-base-content/30 hover:text-warning transition-colors"
            onClick={(e) => { e.stopPropagation(); props.onStop(); }}
            title="Stop"
          >
            <FiStopCircle size={11} />
          </button>
        </Show>
        <button
          type="button"
          class="p-1 rounded text-base-content/30 hover:text-error transition-colors"
          onClick={(e) => { e.stopPropagation(); props.onArchive(); }}
          title="Close"
        >
          <FiX size={11} />
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// Project Group
// ============================================================================

const ProjectGroup: Component<{
  group: ThreadGroup;
  activeSessionId: string | null;
  searchQuery: string;
  onSelectThread: (sessionId: string) => void;
  onStopThread: (sessionId: string) => void;
  onArchiveThread: (sessionId: string) => void;
  onNewThread: () => void;
}> = (props) => {
  const [collapsed, setCollapsed] = createSignal(false);
  const activeCount = () => props.group.sessions.filter((s) => s.active).length;

  // Filter sessions by search
  const filteredSessions = createMemo(() => {
    if (!props.searchQuery) return props.group.sessions;
    const q = props.searchQuery.toLowerCase();
    return props.group.sessions.filter(
      (s) =>
        s.agentType.toLowerCase().includes(q) ||
        s.projectPath.toLowerCase().includes(q),
    );
  });

  if (filteredSessions().length === 0) return null;

  return (
    <div class="rounded-lg border border-base-content/5 overflow-hidden">
      {/* Group header */}
      <div
        class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-base-200/30 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setCollapsed((c) => !c)}
      >
        <FiChevronDown
          size={11}
          class={cn(
            "text-base-content/30 transition-transform duration-150",
            collapsed() && "-rotate-90",
          )}
        />
        <FiFolder size={12} class="text-base-content/40 shrink-0" />
        <span class="text-xs font-semibold text-base-content truncate">
          {props.group.projectName}
        </span>
        <Show when={activeCount() > 0}>
          <span class="px-1.5 py-0.5 rounded-full bg-success/10 text-success text-[9px] font-medium leading-none">
            {activeCount()} active
          </span>
        </Show>
        <span class="text-[10px] text-base-content/30 ml-auto">
          {props.group.sessions.length}
        </span>
      </div>

      {/* Session list */}
      <Show when={!collapsed()}>
        <div class="pb-1">
          <For each={filteredSessions()}>
            {(session) => (
              <SessionItem
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

// ============================================================================
// Connection Badge
// ============================================================================

const ConnectionBadge: Component = () => {
  const connectionState = () => sessionStore.state.connectionState;
  const isConnected = () => connectionState() === "connected";
  const isReconnecting = () => connectionState() === "reconnecting";

  return (
    <div class="flex items-center gap-2 px-3 py-2 border-t border-base-content/10">
      <span
        class={cn(
          "w-1.5 h-1.5 rounded-full",
          isConnected() && "bg-success",
          isReconnecting() && "bg-warning animate-pulse",
          !isConnected() && !isReconnecting() && "bg-base-content/20",
        )}
      />
      <span class="text-[10px] text-base-content/50">
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
// Sidebar Component
// ============================================================================

interface SessionSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const getProjectName = (projectPath: string) => {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || projectPath || "Untitled";
};

export const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal("");

  const activeView = () => navigationStore.state.activeView;
  const sessions = createMemo(() => sessionStore.getSessions());
  const activeSession = createMemo(() => sessionStore.getActiveSession());

  // Build thread groups
  const threadGroups = createMemo<ThreadGroup[]>(() => {
    const groups = new Map<string, ThreadGroup>();
    for (const session of sessions()) {
      const existing = groups.get(session.projectPath);
      if (existing) {
        groups.set(session.projectPath, {
          ...existing,
          sessions: [...existing.sessions, session],
          lastStartedAt: Math.max(existing.lastStartedAt, session.startedAt),
        });
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
      .map((g) => ({
        ...g,
        sessions: [...g.sessions].sort((a, b) => b.startedAt - a.startedAt),
      }))
      .sort((a, b) => b.lastStartedAt - a.lastStartedAt);
  });

  const handleNavClick = (view: NavigationView) => {
    navigationStore.setActiveView(view);
    if (window.innerWidth < 768) props.onToggle();
  };

  const openThread = (sessionId: string) => {
    sessionStore.setActiveSession(sessionId);
    navigationStore.setActiveView("workspace");
    if (window.innerWidth < 768) props.onToggle();
  };

  const totalActive = createMemo(() => sessions().filter((s) => s.active).length);
  const totalUnread = createMemo(() => {
    let count = 0;
    for (const s of sessions()) {
      count += chatStore.getUnreadCount(s.sessionId);
    }
    return count;
  });

  return (
    <aside class="flex h-full w-full flex-col bg-base-100 border-r border-base-content/10">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-base-content/10">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary text-primary-content dark:from-primary/80 dark:to-secondary/80 text-sm font-bold shadow-sm">
            I
          </div>
          <div>
            <h1 class="text-sm font-bold text-base-content leading-none">
              Irogen
            </h1>
            <p class="text-[9px] text-base-content/40 mt-0.5 uppercase tracking-wider font-medium">
              Agent Control
            </p>
          </div>
        </div>
        <button
          type="button"
          class="md:hidden h-8 w-8 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors"
          onClick={props.onToggle}
        >
          <FiX size={15} />
        </button>
      </div>

      {/* Search */}
      <SearchBar value={searchQuery()} onInput={setSearchQuery} />

      {/* Navigation */}
      <div class="px-2 py-1">
        <For each={NAV_ITEMS}>
          {(item) => (
            <NavItemButton
              item={item}
              isActive={activeView() === item.id}
              onClick={() => handleNavClick(item.id)}
            />
          )}
        </For>
      </div>

      {/* Sessions section */}
      <div class="flex-1 overflow-y-auto px-2 pb-2">
        <div class="flex items-center justify-between px-1 py-2 mt-1">
          <div class="flex items-center gap-1.5">
            <FiMessageSquare size={11} class="text-base-content/40" />
            <span class="text-[10px] font-semibold text-base-content/40 uppercase tracking-wider">
              Sessions
            </span>
            <Show when={totalActive() > 0}>
              <span class="px-1.5 py-0.5 rounded-full bg-success/10 text-success text-[9px] font-medium leading-none">
                {totalActive()}
              </span>
            </Show>
            <Show when={totalUnread() > 0}>
              <span class="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-medium leading-none">
                {totalUnread()} new
              </span>
            </Show>
          </div>
          <button
            type="button"
            class="p-1 rounded text-base-content/30 hover:text-base-content hover:bg-base-200 transition-colors"
            onClick={() => sessionStore.openNewSessionModal()}
            title="New session"
          >
            <FiPlus size={13} />
          </button>
        </div>

        <Show
          when={threadGroups().length > 0}
          fallback={
            <div class="px-3 py-8 text-center">
              <div class="w-10 h-10 rounded-xl bg-base-200/50 flex items-center justify-center mx-auto mb-3 text-base-content/20">
                <FiMessageSquare size={18} />
              </div>
              <p class="text-xs text-base-content/40 font-medium">No sessions yet</p>
              <p class="text-[10px] text-base-content/30 mt-1">
                Start a new session to begin
              </p>
            </div>
          }
        >
          <div class="space-y-1.5">
            <For each={threadGroups()}>
              {(group) => (
                <ProjectGroup
                  group={group}
                  activeSessionId={activeSession()?.sessionId ?? null}
                  searchQuery={searchQuery()}
                  onSelectThread={openThread}
                  onStopThread={(id) => void sessionStore.stopSession(id)}
                  onArchiveThread={(id) => sessionStore.archiveSession(id)}
                  onNewThread={() => {
                    const first = group.sessions[0];
                    if (first) {
                      sessionStore.openNewSessionModal(
                        first.mode || "local",
                        first.controlSessionId,
                        false,
                        first.projectPath,
                        true,
                      );
                      sessionStore.setNewSessionAgent(first.agentType);
                    }
                  }}
                />
              )}
            </For>
          </div>
        </Show>

        {/* View all sessions */}
        <Show when={sessions().length > 5}>
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 mt-1 text-xs text-base-content/40 hover:text-base-content rounded-lg hover:bg-base-200/50 transition-colors"
            onClick={() => handleNavClick("sessions")}
          >
            <FiList size={13} />
            <span>View all {sessions().length} sessions</span>
          </button>
        </Show>
      </div>

      {/* Footer */}
      <ConnectionBadge />
    </aside>
  );
};

export default SessionSidebar;
