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
import { chatStore } from "../stores/chatStore";
import { notificationStore } from "../stores/notificationStore";
import { sessionEventRouter } from "../stores/sessionEventRouter";
import { isMobile } from "../stores/deviceStore";
import type { AgentType, AgentSessionMetadata } from "../stores/sessionStore";
import { Button } from "./ui/primitives";
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
    <div class={`${iconClass} bg-muted`}>
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
  onClick: () => void;
  onClose: () => void;
  onSpawnRemoteSession?: () => void;
  onToggleHistory?: () => void;
  historyOpen?: boolean;
  historyDisabled?: boolean;
}

const SessionItem: Component<SessionItemProps> = (props) => {
  const mobileSessionActions = () => [
    {
      id: "history",
      label: props.historyOpen ? "Hide history" : "Show history",
      disabled: props.historyDisabled,
      icon: FiClock,
    },
    { id: "divider", label: "", divider: true },
    {
      id: "close",
      label: "Close session",
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
      class={`group relative flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-all duration-200 mx-1
        ${
          props.isActive
            ? "bg-gradient-to-r from-primary/15 to-primary/5 border border-primary/20 shadow-sm"
            : "hover:bg-muted/60 border border-transparent"
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
        class={`shrink-0 ${props.isActive ? "text-primary" : "text-muted-foreground/70"}`}
      >
        {getAgentIcon(props.session?.agentType || "claude")}
      </div>

      {/* Session Info */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span
            class={`font-medium text-sm truncate ${props.isActive ? "text-foreground" : "text-foreground/80"}`}
          >
            {props.session?.agentType === "claude" && "Claude"}
            {props.session?.agentType === "gemini" && "Gemini"}
            {props.session?.agentType === "opencode" && "OpenCode"}
            {props.session?.agentType === "codex" && "Codex"}
            {props.session?.agentType === "openclaw" && "OpenClaw"}
          </span>
          <span
            class={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              props.session?.mode === "local"
                ? "bg-primary/15 text-primary/80"
                : "bg-muted text-muted-foreground/60"
            }`}
          >
            {props.session?.mode === "local" ? "Local" : "Remote"}
          </span>
        </div>
        <div class="text-xs text-muted-foreground/50 truncate mt-0.5">
          {props.session?.projectPath?.split("/").pop() || "No project"}
        </div>
      </div>

      {/* Status Indicator */}
      <Show when={props.hasUnread && !props.isActive}>
        <div class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
      </Show>

      {/* Close Button */}
      <div class="flex items-center gap-1">
        <div class="hidden md:flex items-center gap-1">
          <Show when={props.onToggleHistory}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class={`p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150
                ${props.isActive ? "hover:bg-primary/20" : "hover:bg-muted"}`}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleHistory?.();
              }}
              title={props.historyOpen ? "Hide history" : "Show history"}
              disabled={props.historyDisabled}
            >
              <FiClock size={14} />
            </Button>
          </Show>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class={`p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150 -mr-1
              ${props.isActive ? "hover:bg-primary/20" : "hover:bg-muted"}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onClose();
            }}
            title="Close session"
          >
            <FiX size={14} />
          </Button>
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
                class="btn btn-ghost btn-sm btn-square h-9 w-9"
                title="Session actions"
              >
                <FiMoreVertical size={12} />
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

export const SessionSidebar: Component<SessionSidebarProps> = (props) => {
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
          notificationStore.error("Failed to stop local agent", "Error");
        });
      } else {
        invoke("local_stop_agent", { sessionId }).catch((err) => {
          console.error("Failed to stop local agent:", err);
          notificationStore.error("Failed to stop local agent", "Error");
        });
      }
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

    // Trigger remote session spawn via CLI
    invoke("remote_spawn_session", {
      connectionSessionId: session.sessionId,
      agentType: session.agentType,
      projectPath: session.projectPath,
      args: [],
    }).catch((err) => {
      console.error("Failed to spawn remote session:", err);
      notificationStore.error("Failed to spawn remote session", "Error");
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
      await Promise.all([handleLoadLocalSessions(), handleLoadRemoteSessions()]);
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  };

  const loadHistoryForSession = async (session: AgentSessionMetadata) => {
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
        const parsed = JSON.parse(response);
        if (parsed.success && parsed.data?.type === "history_list") {
          entries = parsed.data.entries;
        } else {
          throw new Error(parsed.message || "Failed to load history");
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
      notificationStore.error("Failed to load agent history", "Error");
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
        const parsed = JSON.parse(response);
        if (!parsed.success || parsed.data?.type !== "session_loaded") {
          throw new Error(parsed.message || "Failed to load history session");
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

      notificationStore.success("History session loaded", "History");
    } catch (error) {
      console.error("Failed to load history session:", error);
      notificationStore.error("Failed to load history session", "Error");
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
        class={`fixed lg:static inset-y-0 left-0 z-50 w-[min(86vw,18rem)] lg:w-72 bg-gradient-to-b from-background to-base-200/50 border-r border-border/60
          transform transition-transform duration-300 ease-in-out backdrop-blur-sm
          ${props.isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          pt-safe lg:pt-0
          h-[var(--effective-viewport-height,100vh)] flex flex-col
        `}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-4 border-b border-border/60 bg-background/50 backdrop-blur">
          <div class="flex items-center gap-2">
            {/* App Logo */}
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <span class="text-white font-bold text-sm">P</span>
            </div>
            <div>
              <p class="text-[10px] text-muted-foreground/60 -mt-0.5">
                AI Copilot workspace
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              class="h-7 w-7 lg:hidden"
              onClick={props.onToggle}
            >
              <FiX size={16} />
            </Button>
          </div>
        </div>

        {/* Session List */}
        <div
          ref={sessionListEl}
          class="overflow-y-auto flex-1 p-2 space-y-1"
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
              class="flex items-center justify-center text-xs text-muted-foreground/70 transition-all"
              style={{
                height: `${isRefreshing() ? 42 : Math.max(18, pullDistance())}px`,
              }}
            >
              <Show
                when={!isRefreshing()}
                fallback={
                  <span class="inline-flex items-center gap-1.5">
                    <span class="loading loading-spinner loading-xs" />
                    Refreshing sessions...
                  </span>
                }
              >
                {pullDistance() >= 56
                  ? "Release to refresh"
                  : "Pull to refresh"}
              </Show>
            </div>
          </Show>
          <Show when={sessions().length > 0}>
            <div class="px-2 py-2 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
              Active Sessions
            </div>
            <For each={sessions()}>
              {(session) => {
                const isExpanded = () => !!historyExpanded()[session.sessionId];
                const historyEntries = () =>
                  historyEntriesBySession()[session.sessionId] || [];
                const isLoading = () =>
                  historyLoadingBySession()[session.sessionId] || false;
                const canShowHistory = () => true;

                return (
                  <>
                    <SessionItem
                      session={session}
                      isActive={
                        session.sessionId === activeSession()?.sessionId
                      }
                      hasUnread={unreadSessions().has(session.sessionId)}
                      onClick={() => {
                        sessionStore.setActiveSession(session.sessionId);
                        if (isMobile() && props.isOpen) {
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
                      <div class="mx-2 mb-2 rounded-lg border border-border/60 bg-muted/30 p-2">
                        <div class="flex items-center justify-between mb-2">
                          <span class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                            History
                          </span>
                          <div class="flex items-center gap-2">
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              onClick={() => loadHistoryForSession(session)}
                              title="Refresh history"
                            >
                              <FiRefreshCw size={12} />
                            </Button>
                          </div>
                        </div>
                        <Show when={!canShowHistory()}>
                          <p class="text-xs text-muted-foreground/60">
                            History is available for local sessions only.
                          </p>
                        </Show>
                        <Show when={canShowHistory() && isLoading()}>
                          <div class="flex items-center justify-center py-4">
                            <div class="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                          </div>
                        </Show>
                        <Show when={canShowHistory() && !isLoading()}>
                          <Show when={historyEntries().length > 0}>
                            <For each={historyEntries()}>
                              {(entry) => (
                                <button
                                  type="button"
                                  class="group w-full text-left p-2 rounded-lg hover:bg-muted/60 transition-colors"
                                  onClick={() =>
                                    handleLoadHistorySession(session, entry)
                                  }
                                >
                                  <span class="block text-sm font-medium truncate">
                                    {entry.title ||
                                      entry.session_id.slice(0, 8)}
                                  </span>
                                  <span class="block text-[10px] text-muted-foreground/60">
                                    {entry.updated_at || ""}
                                  </span>
                                </button>
                              )}
                            </For>
                          </Show>
                          <Show when={historyEntries().length === 0}>
                            <div class="flex flex-col items-center justify-center py-4 text-center px-2">
                              <p class="text-sm text-muted-foreground/60">
                                No history sessions
                              </p>
                              <p class="text-xs text-muted-foreground/40 mt-1">
                                This agent may not support history
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
            <div class="flex flex-col items-center justify-center py-10 text-center px-4">
              <div class="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
                <FiPlus size={24} class="text-muted-foreground/50" />
              </div>
              <p class="text-sm font-medium text-muted-foreground">
                No active sessions
              </p>
              <p class="text-xs text-muted-foreground/60 mt-1 max-w-[160px]">
                Create a local session or connect to a remote CLI
              </p>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="p-3 border-t border-border/60 bg-background/30 backdrop-blur">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-xs text-muted-foreground/60">
              <span class="inline-flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500/80 animate-pulse" />
                {activeSessions().length} active
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="default"
              class="h-8 px-3 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-lg shadow-primary/20"
              onClick={() => sessionStore.openNewSessionModal("local")}
              title="New Session"
            >
              <FiPlus size={16} class="mr-1" />
              <span class="text-xs font-medium">New</span>
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default SessionSidebar;
