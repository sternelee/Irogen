/**
 * SessionSidebar Component
 *
 * Sidebar for managing AI agent sessions in a unified list.
 */

import {
  onMount,
  Show,
  For,
  createSignal,
  createMemo,
  createEffect,
  type Component,
} from "solid-js";
import {
  FiPlus,
  FiX,
  FiRefreshCw,
  FiClock,
  FiMoreVertical,
} from "solid-icons/fi";
import { invoke } from "@tauri-apps/api/core";
import {
  type BackendSessionMetadata,
  mapBackendSessionMetadata,
  sessionStore,
} from "../stores/sessionStore";
import { i18nStore } from "../stores/i18nStore";
import { chatStore } from "../stores/chatStore";
import { notificationStore } from "../stores/notificationStore";
import { sessionEventRouter } from "../stores/sessionEventRouter";
import { isMobile } from "../stores/deviceStore";
import type { AgentType, AgentSessionMetadata } from "../stores/sessionStore";
import { Dropdown } from "./ui/Dropdown";

const getAgentIcon = (agentType: AgentType) => {
  const normalizedType = agentType?.toLowerCase() || "";
  const iconClass = "w-9 h-9 rounded-xl flex items-center justify-center";

  // Map agent types to local SVG icons in public folder
  const iconPaths: Record<string, string> = {
    claude: "/claude-ai.svg",
    claudecode: "/claude-ai.svg",
    "claude-code": "/claude-ai.svg",
    codex: "/openai-light.svg",
    cursor: "/cursor.svg",
    opencode: "/opencode-wordmark-dark.svg",
    open: "/openai-light.svg",
    openai: "/openai-light.svg",
    gemini: "/google-gemini.svg",
    "gemini-cli": "/google-gemini.svg",
    openclaw: "/openclaw.svg",
    "open-claw": "/openclaw.svg",
  };

  const iconPath = iconPaths[normalizedType];

  if (iconPath) {
    return (
      <div class={iconClass}>
        <img src={iconPath} alt={normalizedType} class="w-6 h-6" />
      </div>
    );
  }

  // Default fallback
  return (
    <div class={`${iconClass} bg-base-300`}>
      <span class="text-lg">🤖</span>
    </div>
  );
};

// ============================================================================
// Session Item Component
// ============================================================================

interface SessionItemProps {
  session: ReturnType<typeof sessionStore.getSession>;
  isActive: boolean;
  hasUnread?: boolean;
  isStreaming?: boolean;
  gitStatusText?: string | null;
  onClick: () => void;
  onClose: () => void;
  onSpawnRemoteSession?: () => void;
  onToggleHistory?: () => void;
  historyOpen?: boolean;
  historyDisabled?: boolean;
}

const SessionItem: Component<SessionItemProps> = (props) => {
  const t = i18nStore.t;
  const mobileSessionActions = () => [
    {
      id: "history",
      label: props.historyOpen
        ? t("sidebar.hideHistory")
        : t("sidebar.showHistory"),
      disabled: props.historyDisabled,
      icon: FiClock,
    },
    { id: "divider", label: "", divider: true },
    {
      id: "close",
      label: t("sidebar.closeSession"),
      danger: true,
      icon: FiX,
    },
  ];

  const handleMobileAction = (value: string) => {
    if (value === "history") {
      props.onToggleHistory?.();
      return;
    }
    if (value === "close") {
      props.onClose();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      class={`group relative flex items-center gap-3 px-4 py-4 rounded-2xl cursor-pointer transition-all duration-200 mx-2 mb-1
        ${
          props.isActive
            ? "border border-primary/20 bg-base-100 shadow-lg shadow-base-content/5 scale-[1.01] z-10"
            : "border border-transparent hover:bg-base-content/5 active:scale-[0.98] active:bg-base-content/10"
        }`}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick();
        }
      }}
    >
      {/* Agent Icon */}
      <div
        class={`shrink-0 transition-transform duration-200 ${props.isActive ? "rounded-xl bg-primary/10 p-0.5 scale-110 ring-1 ring-primary/20" : ""}`}
      >
        {getAgentIcon(props.session?.agentType || "claude")}
      </div>

      {/* Session Info */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-bold text-[15px] tracking-tight truncate text-base-content">
            {props.session?.agentType === "claude" && "Claude"}
            {props.session?.agentType === "gemini" && "Gemini"}
            {props.session?.agentType === "opencode" && "OpenCode"}
            {props.session?.agentType === "codex" && "Codex"}
            {props.session?.agentType === "cursor" && "Cursor"}
            {props.session?.agentType === "openclaw" && "OpenClaw"}
          </span>
          <span
            class={`text-[8px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-widest ${
              props.isActive
                ? "bg-primary/12 text-primary ring-1 ring-primary/15"
                : props.session?.mode === "local"
                  ? "bg-primary/12 text-primary"
                  : "bg-base-content/10 text-base-content/60"
            }`}
          >
            {props.session?.mode === "local"
              ? t("common.local")
              : t("common.remote")}
          </span>
        </div>
        <div
          class={`mt-0.5 truncate font-mono text-[11px] ${props.isActive ? "text-base-content/80" : "text-base-content/55"}`}
        >
          {props.session?.projectPath?.split("/").pop() || "No project"}
        </div>
        <div class="flex items-center gap-2 mt-1">
          <Show when={props.isStreaming}>
            <span class="inline-flex items-center gap-1 rounded-md bg-info/12 px-1.5 py-0.5 text-[9px] font-bold text-info ring-1 ring-info/15">
              <span class="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
              {t("sidebar.thinking")}
            </span>
          </Show>
          <Show when={props.session?.gitBranch}>
            <span
              class={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md ${
                props.isActive
                  ? "bg-base-content/6 text-base-content/75 ring-1 ring-base-content/8"
                  : "bg-base-content/10 text-base-content/60"
              }`}
            >
              <svg
                class="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              {props.session?.gitBranch}
            </span>
          </Show>
          <Show when={props.gitStatusText}>
            <span
              class={`text-[9px] font-mono font-bold px-1 py-0.5 rounded ${
                props.isActive
                  ? "bg-base-content/6 text-base-content/75 ring-1 ring-base-content/8"
                  : "bg-base-content/8 text-base-content/55"
              }`}
            >
              {props.gitStatusText}
            </span>
          </Show>
        </div>
      </div>

      {/* Status Indicator */}
      <Show when={props.hasUnread && !props.isActive}>
        <div class="w-2.5 h-2.5 rounded-full bg-error animate-pulse shrink-0 shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
      </Show>

      {/* Actions */}
      <div class="flex items-center gap-1">
        <div class="hidden md:flex items-center gap-1">
          <Show when={props.onToggleHistory}>
            <button
              type="button"
              class={`btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100 transition-all duration-150
                ${props.isActive ? "text-base-content/70 hover:bg-base-content/8" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleHistory?.();
              }}
              title={
                props.historyOpen
                  ? t("sidebar.hideHistory")
                  : t("sidebar.showHistory")
              }
              disabled={props.historyDisabled}
            >
              <FiClock size={14} />
            </button>
          </Show>
          <button
            type="button"
            class={`btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100 transition-all duration-150
              ${props.isActive ? "text-base-content/70 hover:bg-base-content/8" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onClose();
            }}
            title={t("sidebar.closeSession")}
          >
            <FiX size={14} />
          </button>
        </div>
        <div class="md:hidden" onClick={(e) => e.stopPropagation()}>
          <Dropdown
            class="min-w-0"
            options={mobileSessionActions()}
            value=""
            onChange={handleMobileAction}
            compact
            trigger={
              <button
                type="button"
                class={`btn btn-ghost btn-sm btn-square h-10 w-10 rounded-xl ${props.isActive ? "text-base-content/70 hover:bg-base-content/8" : "bg-base-content/5"}`}
                title={t("sidebar.sessionActions")}
              >
                <FiMoreVertical size={16} />
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Session Sidebar Component
// ============================================================================

interface SessionSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface AgentHistoryEntry {
  agent_type: string;
  session_id: string;
  title?: string | null;
  updated_at?: string | null;
  cwd?: string | null;
}

const unwrapAgentControlResponse = (response: string): any => {
  const parsed = JSON.parse(response);
  if (
    parsed &&
    typeof parsed === "object" &&
    "success" in parsed &&
    "data" in parsed
  ) {
    if (!parsed.success) {
      throw new Error(parsed.message || "Agent control request failed");
    }
    return parsed.data;
  }
  return parsed;
};

export const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const t = i18nStore.t;
  const sessions = createMemo(() => sessionStore.getSessions());
  const activeSession = createMemo(() => sessionStore.getActiveSession());
  const activeSessions = createMemo(() => sessionStore.getActiveSessions());
  const [touchStartX, setTouchStartX] = createSignal<number | null>(null);
  const [listTouchStartY, setListTouchStartY] = createSignal<number | null>(
    null,
  );
  const [pullDistance, setPullDistance] = createSignal(0);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  let sessionListEl: HTMLDivElement | undefined;

  // Track sessions with unread messages
  const [unreadSessions, setUnreadSessions] = createSignal<Set<string>>(
    new Set(),
  );

  const isSessionStreaming = (sessionId: string) => {
    return sessionEventRouter.getStreamingState(sessionId).isStreaming;
  };

  interface GitStatusCount {
    added: number;
    modified: number;
    deleted: number;
    untracked: number;
  }

  const [gitStatusBySession, setGitStatusBySession] = createSignal<
    Record<string, GitStatusCount>
  >({});

  const fetchGitStatus = async (session: AgentSessionMetadata) => {
    try {
      if (session.mode === "remote" && !session.controlSessionId) {
        return;
      }

      const response =
        session.mode === "remote"
          ? await invoke<{ success: boolean; status?: string }>(
              "remote_git_status",
              {
                controlSessionId: session.controlSessionId,
                path: session.projectPath || ".",
              },
            )
          : await invoke<{ success: boolean; status?: string }>("git_status", {
              path: session.projectPath || ".",
            });
      if (response?.success && response.status) {
        const lines = response.status.split("\n").filter(Boolean);
        let added = 0,
          modified = 0,
          deleted = 0,
          untracked = 0;
        for (const line of lines) {
          if (line.length < 3) continue;
          const [x, y] = [line[0], line[1]];
          if (x === "?" && y === "?") untracked++;
          else if (x === "A" || x === "a") added++;
          else if (x === "D" || x === "d") deleted++;
          else if (x === "M" || x === "m") modified++;
          else if (x === "R" || x === "r") modified++;
          if (y === "A" || y === "a") added++;
          else if (y === "D" || y === "d") deleted++;
          else if (y === "M" || y === "m") modified++;
        }
        setGitStatusBySession((prev) => ({
          ...prev,
          [session.sessionId]: { added, modified, deleted, untracked },
        }));
      }
    } catch (err) {
      console.error(
        `Failed to fetch git status for session ${session.sessionId}:`,
        err,
      );
    }
  };

  const getGitStatusDisplay = (sessionId: string) => {
    const status = gitStatusBySession()[sessionId];
    if (!status) return null;
    const parts: string[] = [];
    if (status.added > 0) parts.push(`+${status.added}`);
    if (status.modified > 0) parts.push(`~${status.modified}`);
    if (status.deleted > 0) parts.push(`-${status.deleted}`);
    if (status.untracked > 0) parts.push(`?${status.untracked}`);
    return parts.length > 0 ? parts.join(" ") : null;
  };

  // Set up unread change listener
  onMount(() => {
    sessionEventRouter.setOnUnreadChange((sessionId, hasUnread) => {
      setUnreadSessions((prev) => {
        const next = new Set(prev);
        if (hasUnread) {
          next.add(sessionId);
        } else {
          next.delete(sessionId);
        }
        return next;
      });
    });
  });

  // Clear unread when active session changes
  createEffect(() => {
    const active = activeSession();
    if (active) {
      sessionEventRouter.setActiveSession(active.sessionId);
      sessionEventRouter.clearUnread(active.sessionId);
      setUnreadSessions((prev) => {
        const next = new Set(prev);
        next.delete(active.sessionId);
        return next;
      });
      void fetchGitStatus(active);
    }
  });

  const [historyExpanded, setHistoryExpanded] = createSignal<
    Record<string, boolean>
  >({});
  const [historyEntriesBySession, setHistoryEntriesBySession] = createSignal<
    Record<string, AgentHistoryEntry[]>
  >({});
  const [historyLoadingBySession, setHistoryLoadingBySession] = createSignal<
    Record<string, boolean>
  >({});

  const supportsHistory = (session: AgentSessionMetadata) =>
    session.agentType !== "cursor";

  // Load local sessions on mount
  const handleLoadLocalSessions = async () => {
    try {
      const localSessions =
        await invoke<BackendSessionMetadata[]>("local_list_agents");
      console.log(
        "[handleLoadLocalSessions] Raw localSessions:",
        localSessions,
      );

      const sessionsWithMode = localSessions.map((s) =>
        mapBackendSessionMetadata(s, "local"),
      );

      console.log(
        "[handleLoadLocalSessions] Mapped sessions:",
        sessionsWithMode,
      );

      // Update sessions in store
      for (const session of sessionsWithMode) {
        sessionStore.addSession(session);
      }

      // Set first session as active if no active session exists
      if (sessionsWithMode.length > 0 && !sessionStore.getActiveSession()) {
        sessionStore.setActiveSession(sessionsWithMode[0].sessionId);
      }

      console.log(
        "[handleLoadLocalSessions] Sessions in store after add:",
        sessionStore.getSessions(),
      );
    } catch (error) {
      console.error("Failed to load local sessions:", error);
    }
  };

  // Load remote sessions from connected CLI on mount
  const handleLoadRemoteSessions = async () => {
    try {
      const controlSessionId = sessionStore.state.targetControlSessionId;
      if (!controlSessionId) {
        return;
      }

      const remoteSessions = await invoke<BackendSessionMetadata[]>(
        "remote_list_agents",
        {
          controlSessionId,
        },
      );

      const sessionsWithMode = remoteSessions.map((s) =>
        mapBackendSessionMetadata(s, "remote", controlSessionId),
      );

      for (const session of sessionsWithMode) {
        sessionStore.addSession(session);
      }
    } catch (error) {
      console.error("Failed to load remote sessions:", error);
    }
  };

  const handleCloseSession = (sessionId: string) => {
    const session = sessionStore.getSession(sessionId);
    if (session?.mode === "local") {
      // Stop local agent (mobile uses mobile_stop_agent)
      if (isMobile()) {
        invoke("mobile_stop_agent", { sessionId }).catch((err) => {
          console.error("Failed to stop mobile agent:", err);
          notificationStore.error(
            t("sidebar.failedStopLocalAgent"),
            t("sidebar.errorTitle"),
          );
        });
      } else {
        invoke("local_stop_agent", { sessionId }).catch((err) => {
          console.error("Failed to stop local agent:", err);
          notificationStore.error(
            t("sidebar.failedStopLocalAgent"),
            t("sidebar.errorTitle"),
          );
        });
      }
    } else if (session?.mode === "remote") {
      // Stop remote agent on CLI
      invoke("remote_stop_agent", {
        sessionId,
        controlSessionId: session.controlSessionId,
      }).catch((err) => {
        console.error("Failed to stop remote agent:", err);
        notificationStore.error(
          t("sidebar.failedStopRemoteAgent"),
          t("sidebar.errorTitle"),
        );
      });
    }
    // Clear chat messages for this session
    chatStore.clearMessages(sessionId);
    sessionStore.removeSession(sessionId);
  };

  // Handle spawning remote session from local session
  const handleSpawnRemoteSession = () => {
    const session = activeSession();
    if (!session || session?.mode !== "local") {
      return;
    }

    const controlSessionId = sessionStore.state.targetControlSessionId;
    if (!controlSessionId) {
      notificationStore.error(
        t("sidebar.noRemoteConnection"),
        t("sidebar.errorTitle"),
      );
      return;
    }

    // Trigger remote session spawn via CLI
    invoke("remote_spawn_session", {
      connectionSessionId: controlSessionId,
      agentType: session.agentType,
      projectPath: session.projectPath,
      args: [],
    }).catch((err) => {
      console.error("Failed to spawn remote session:", err);
      notificationStore.error(
        t("sidebar.failedSpawnRemoteSession"),
        t("sidebar.errorTitle"),
      );
    });
  };

  onMount(() => {
    void handleLoadLocalSessions();
    void handleLoadRemoteSessions();
  });

  const refreshSessions = async () => {
    if (isRefreshing()) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        handleLoadLocalSessions(),
        handleLoadRemoteSessions(),
      ]);
      notificationStore.success(
        t("sidebar.refreshSessionsSuccess"),
        t("sidebar.refreshSessionsTitle"),
      );
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
      notificationStore.error(
        t("sidebar.refreshSessionsFailed"),
        t("sidebar.refreshSessionsTitle"),
      );
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  };

  const loadHistoryForSession = async (session: AgentSessionMetadata) => {
    if (!supportsHistory(session)) {
      notificationStore.info(
        t("sidebar.cursorHistoryUnavailable"),
        t("sidebar.historyUnavailableTitle"),
      );
      return;
    }

    setHistoryLoadingBySession((prev) => ({
      ...prev,
      [session.sessionId]: true,
    }));

    try {
      const projectPath =
        session.projectPath || sessionStore.state.newSessionPath || ".";
      let entries: AgentHistoryEntry[];

      if (session.mode === "local") {
        entries = await invoke<AgentHistoryEntry[]>(
          "local_list_agent_history",
          {
            agentTypeStr: session.agentType,
            projectPath,
          },
        );
      } else if (session.controlSessionId) {
        const response = await invoke<string>("send_agent_control", {
          connectionSessionId: session.controlSessionId,
          agentSessionId: session.sessionId,
          actionStr: "list_history",
          actionParams: {
            agentType: session.agentType,
            projectPath,
          },
        });
        const parsed = unwrapAgentControlResponse(response);
        if (parsed?.type === "history_list" && Array.isArray(parsed.entries)) {
          entries = parsed.entries;
        } else {
          throw new Error("Failed to load history");
        }
      } else {
        throw new Error("Remote session without control session");
      }

      setHistoryEntriesBySession((prev) => ({
        ...prev,
        [session.sessionId]: entries,
      }));
    } catch (error) {
      console.error("Failed to load agent history:", error);
      notificationStore.error(
        t("sidebar.historyLoadFailed"),
        t("sidebar.errorTitle"),
      );
    } finally {
      setHistoryLoadingBySession((prev) => ({
        ...prev,
        [session.sessionId]: false,
      }));
    }
  };

  const handleToggleHistory = async (
    session: AgentSessionMetadata,
    e?: Event,
  ) => {
    e?.stopPropagation();

    if (!supportsHistory(session)) {
      notificationStore.info(
        t("sidebar.cursorHistoryUnavailable"),
        t("sidebar.historyUnavailableTitle"),
      );
      return;
    }

    setHistoryExpanded((prev) => ({
      ...prev,
      [session.sessionId]: !prev[session.sessionId],
    }));

    const existing = historyEntriesBySession()[session.sessionId];
    if (!existing) {
      await loadHistoryForSession(session);
    }
  };

  const handleLoadHistorySession = async (
    session: AgentSessionMetadata,
    entry: AgentHistoryEntry,
  ) => {
    let targetSessionId = session.sessionId;

    try {
      sessionStore.setHistoryLoading(true);
      const projectPath =
        entry.cwd ||
        session.projectPath ||
        sessionStore.state.newSessionPath ||
        ".";
      chatStore.clearMessages(session.sessionId);

      if (session.mode === "local") {
        const sessionId = await invoke<string>("local_load_agent_history", {
          agentTypeStr: session.agentType,
          historySessionId: entry.session_id,
          projectPath,
          resume: false,
          extraArgs: [],
          targetSessionId: session.sessionId,
        });

        targetSessionId = sessionId;
        sessionStore.updateSession(sessionId, {
          projectPath,
          currentDir: projectPath,
          startedAt: Date.now(),
          active: true,
        });
        sessionStore.setActiveSession(sessionId);
      } else if (session.controlSessionId) {
        const response = await invoke<string>("send_agent_control", {
          connectionSessionId: session.controlSessionId,
          agentSessionId: session.sessionId,
          actionStr: "load_history",
          actionParams: {
            agentType: session.agentType,
            historySessionId: entry.session_id,
            projectPath,
            targetSessionId: session.sessionId,
          },
        });
        const parsed = unwrapAgentControlResponse(response);
        if (parsed?.type !== "session_loaded") {
          throw new Error("Failed to load history session");
        }

        sessionStore.updateSession(session.sessionId, {
          projectPath,
          currentDir: projectPath,
          startedAt: Date.now(),
          active: true,
        });
        sessionStore.setActiveSession(session.sessionId);
      } else {
        throw new Error("Remote session without control session");
      }

      sessionEventRouter.resetStreamingState(targetSessionId);
      notificationStore.success(
        t("sidebar.historyLoadedSuccess"),
        t("sidebar.historyLoadedTitle"),
      );
    } catch (error) {
      console.error("Failed to load history session:", error);
      notificationStore.error(
        t("sidebar.historySessionLoadFailed"),
        t("sidebar.errorTitle"),
      );
    } finally {
      sessionStore.setHistoryLoading(false);
    }
  };

  return (
    <>
      {/* Mobile Overlay */}
      <Show when={props.isOpen}>
        <button
          type="button"
          class="fixed inset-0 bg-black/50 z-40 lg:hidden w-full h-full border-none cursor-default"
          onClick={props.onToggle}
          aria-label="Close sidebar"
        />
      </Show>

      {/* Sidebar */}
      <aside
        onTouchStart={(e) => {
          if (!isMobile() || !props.isOpen || e.touches.length !== 1) return;
          setTouchStartX(e.touches[0].clientX);
        }}
        onTouchEnd={(e) => {
          const startX = touchStartX();
          setTouchStartX(null);
          if (!isMobile() || !props.isOpen || startX === null) return;
          const endX = e.changedTouches[0]?.clientX ?? startX;
          if (startX - endX > 70) {
            props.onToggle();
          }
        }}
        class={`fixed lg:static inset-y-0 left-0 z-50 w-[min(86vw,18rem)] lg:w-72 bg-base-200 border-r border-base-content/10
          transform transition-transform duration-300 ease-in-out backdrop-blur-md
          ${props.isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          pt-safe lg:pt-0
          h-dvh flex flex-col shadow-2xl lg:shadow-none
        `}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-5 py-1 border-b border-base-content/10 bg-base-100/50 backdrop-blur">
          <div class="flex items-center gap-3">
            {/* App Logo */}
            <div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <span class="text-primary-content font-black text-lg">P</span>
            </div>
            <div>
              <h1 class="text-sm font-black tracking-tight uppercase leading-none">
                Irogen
              </h1>
              <p class="text-[10px] opacity-40 mt-0.5 font-bold uppercase tracking-wider">
                {t("sidebar.platform")}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-square lg:hidden"
              onClick={props.onToggle}
            >
              <FiX size={18} />
            </button>
          </div>
        </div>

        {/* Session List */}
        <div
          ref={sessionListEl}
          class="overflow-y-auto flex-1 p-2 space-y-1.5 bg-base-200/30"
          onTouchStart={(e) => {
            if (!isMobile() || isRefreshing() || !sessionListEl) return;
            if (sessionListEl.scrollTop > 0) return;
            if (e.touches.length !== 1) return;
            setListTouchStartY(e.touches[0].clientY);
          }}
          onTouchMove={(e) => {
            const startY = listTouchStartY();
            if (
              !isMobile() ||
              isRefreshing() ||
              startY === null ||
              !sessionListEl
            ) {
              return;
            }
            if (sessionListEl.scrollTop > 0) {
              setListTouchStartY(null);
              setPullDistance(0);
              return;
            }
            const currentY = e.touches[0]?.clientY ?? startY;
            const delta = currentY - startY;
            if (delta > 0) {
              setPullDistance(Math.min(delta * 0.45, 84));
            } else {
              setPullDistance(0);
            }
          }}
          onTouchEnd={() => {
            const shouldRefresh = pullDistance() >= 56;
            setListTouchStartY(null);
            if (shouldRefresh) {
              void refreshSessions();
            } else {
              setPullDistance(0);
            }
          }}
          onTouchCancel={() => {
            setListTouchStartY(null);
            setPullDistance(0);
          }}
        >
          <Show when={isMobile() && (pullDistance() > 0 || isRefreshing())}>
            <div
              class="flex items-center justify-center text-xs opacity-60 transition-all font-bold"
              style={{
                height: `${isRefreshing() ? 42 : Math.max(18, pullDistance())}px`,
                transform: `translateY(${Math.min(pullDistance() * 0.15, 10)}px)`,
              }}
            >
              <Show
                when={!isRefreshing()}
                fallback={
                  <span class="inline-flex items-center gap-2">
                    <span class="loading loading-spinner loading-xs text-primary" />
                    {t("sidebar.refreshing")}
                  </span>
                }
              >
                {pullDistance() >= 56
                  ? t("sidebar.releaseToRefresh")
                  : t("sidebar.pullToRefresh")}
              </Show>
            </div>
          </Show>
          <Show when={sessions().length > 0}>
            <div class="px-3 py-2 text-[10px] font-black text-base-content/30 uppercase tracking-[0.15em]">
              {t("sidebar.sessions")}
            </div>
            <For each={sessions()}>
              {(session) => {
                const isExpanded = () => !!historyExpanded()[session.sessionId];
                const historyEntries = () =>
                  historyEntriesBySession()[session.sessionId] || [];
                const isLoading = () =>
                  historyLoadingBySession()[session.sessionId] || false;
                const canShowHistory = () => supportsHistory(session);

                return (
                  <>
                    <SessionItem
                      session={session}
                      isActive={
                        session.sessionId === activeSession()?.sessionId
                      }
                      hasUnread={unreadSessions().has(session.sessionId)}
                      isStreaming={isSessionStreaming(session.sessionId)}
                      gitStatusText={getGitStatusDisplay(session.sessionId)}
                      onClick={() => {
                        sessionStore.setActiveSession(session.sessionId);
                        setHistoryExpanded({});
                        if (props.isOpen) {
                          props.onToggle();
                        }
                      }}
                      onClose={() => handleCloseSession(session.sessionId)}
                      onSpawnRemoteSession={handleSpawnRemoteSession}
                      onToggleHistory={() => void handleToggleHistory(session)}
                      historyOpen={isExpanded()}
                      historyDisabled={!canShowHistory()}
                    />
                    <Show when={isExpanded()}>
                      <div class="mx-2 mb-2 rounded-xl border border-base-content/5 bg-base-300/50 p-2.5 shadow-inner">
                        <div class="flex items-center justify-between mb-2 px-1">
                          <span class="text-[9px] font-black text-base-content/40 uppercase tracking-widest">
                            {t("sidebar.history")}
                          </span>
                          <div class="flex items-center gap-2">
                            <button
                              type="button"
                              class="btn btn-ghost btn-xs btn-square"
                              onClick={() => loadHistoryForSession(session)}
                              title={t("sidebar.refreshHistory")}
                            >
                              <FiRefreshCw size={12} class="opacity-50" />
                            </button>
                          </div>
                        </div>
                        <Show when={canShowHistory() && isLoading()}>
                          <div class="flex items-center justify-center py-6">
                            <span class="loading loading-ring loading-sm text-primary/40" />
                          </div>
                        </Show>
                        <Show when={canShowHistory() && !isLoading()}>
                          <Show when={historyEntries().length > 0}>
                            <div class="space-y-1">
                              <For each={historyEntries()}>
                                {(entry) => (
                                  <button
                                    type="button"
                                    class="group w-full text-left p-2.5 rounded-lg hover:bg-primary/10 hover:text-primary transition-all duration-200 border border-transparent hover:border-primary/10"
                                    onClick={async () => {
                                      await handleLoadHistorySession(
                                        session,
                                        entry,
                                      );
                                      setHistoryExpanded({});
                                      if (props.isOpen) {
                                        props.onToggle();
                                      }
                                    }}
                                  >
                                    <span class="block text-xs font-bold truncate">
                                      {entry.title ||
                                        entry.session_id.slice(0, 8)}
                                    </span>
                                    <span class="block text-[9px] opacity-40 group-hover:opacity-60 font-mono mt-0.5">
                                      {entry.updated_at || ""}
                                    </span>
                                  </button>
                                )}
                              </For>
                            </div>
                          </Show>
                          <Show when={historyEntries().length === 0}>
                            <div class="flex flex-col items-center justify-center py-6 text-center px-2">
                              <p class="text-[11px] font-bold opacity-30">
                                {t("sidebar.noHistoryFound")}
                              </p>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    </Show>
                  </>
                );
              }}
            </For>
          </Show>
          <Show when={sessions().length === 0}>
            <div class="flex flex-col items-center justify-center py-16 text-center px-6">
              <div class="w-16 h-16 rounded-4xl bg-base-300 flex items-center justify-center mb-4 border border-base-content/5 shadow-inner">
                <FiPlus size={28} class="opacity-20" />
              </div>
              <p class="text-sm font-bold opacity-40">
                {t("sidebar.activeSessionsEmpty")}
              </p>
              <p class="text-[11px] opacity-30 mt-2 max-w-35 leading-relaxed">
                {t("sidebar.activeSessionsHint")}
              </p>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="px-4 py-2 border-t border-base-content/10 bg-base-100/50 backdrop-blur">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-tighter opacity-40">
                <span class="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                {t("common.onlineCount", { count: activeSessions().length })}
              </span>
            </div>
            <button
              type="button"
              class="btn btn-primary btn-sm rounded-xl px-4 font-black shadow-lg shadow-primary/20 h-10 min-h-10"
              onClick={() => sessionStore.openNewSessionModal("local")}
              title={t("home.createSession")}
            >
              <FiPlus size={18} class="-ml-1" />
              <span class="text-xs uppercase tracking-widest">
                {t("common.new")}
              </span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default SessionSidebar;
