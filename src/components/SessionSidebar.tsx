/**
 * SessionSidebar Component
 *
 * Sidebar for managing AI agent sessions in a unified list.
 */

import { onMount, Show, For, createSignal, type Component } from "solid-js";
import { FiPlus, FiX, FiRefreshCw, FiTrash2, FiClock } from "solid-icons/fi";
import { invoke } from "@tauri-apps/api/core";
import { sessionStore } from "../stores/sessionStore";
import { chatStore } from "../stores/chatStore";
import { notificationStore } from "../stores/notificationStore";
import { isMobile } from "../stores/deviceStore";
import type { AgentType, SessionRecord } from "../stores/sessionStore";
import { Button } from "./ui/primitives";

// ============================================================================
// Agent Icons - Using @lobehub/icons CDN
// ============================================================================

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
    copilot: "/github-copilot-dark.svg",
    "gh-copilot": "/github-copilot-dark.svg",
    qwen: "/qwen.svg",
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
  onClick: () => void;
  onClose: (e: Event) => void;
  onSpawnRemoteSession?: () => void;
}

const SessionItem: Component<SessionItemProps> = (props) => {
  const session = () => props.session;

  return (
    <div
      role="button"
      tabIndex={0}
      class={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 mx-1
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
        {getAgentIcon(session()?.agentType || "claude")}
      </div>

      {/* Session Info */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span
            class={`font-medium text-sm truncate ${props.isActive ? "text-foreground" : "text-foreground/80"}`}
          >
            {session()?.agentType === "claude" && "Claude"}
            {session()?.agentType === "gemini" && "Gemini"}
            {session()?.agentType === "opencode" && "OpenCode"}
            {session()?.agentType === "copilot" && "Copilot"}
            {session()?.agentType === "qwen" && "Qwen"}
            {session()?.agentType === "codex" && "Codex"}
            {session()?.agentType === "custom" && "Custom"}
          </span>
          <span
            class={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              session()?.mode === "local"
                ? "bg-primary/15 text-primary/80"
                : "bg-muted text-muted-foreground/60"
            }`}
          >
            {session()?.mode === "local" ? "Local" : "Remote"}
          </span>
        </div>
        <div class="text-xs text-muted-foreground/50 truncate mt-0.5">
          {session()?.projectPath?.split("/").pop() || "No project"}
        </div>
      </div>

      {/* Status Indicator */}
      <div
        class={`w-2 h-2 rounded-full ${session()?.active !== false ? "bg-green-500/80" : "bg-muted"}`}
      />

      {/* Close Button */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        class={`p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150 -mr-1
          ${props.isActive ? "hover:bg-primary/20" : "hover:bg-muted"}`}
        onClick={props.onClose}
        title="Close session"
      >
        <FiX size={14} />
      </Button>
    </div>
  );
};

// ============================================================================
// Saved Session Item Component
// ============================================================================

interface SavedSessionItemProps {
  session: SessionRecord;
  onRestore: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

const SavedSessionItem: Component<SavedSessionItemProps> = (props) => {
  const [isDeleting, setIsDeleting] = createSignal(false);

  const handleRestore = async () => {
    setIsDeleting(true);
    try {
      await props.onRestore(props.session.sessionId);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this saved session?")) {
      setIsDeleting(true);
      try {
        await props.onDelete(props.session.sessionId);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div
      class="group relative flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 mx-1
        hover:bg-muted/60 border border-transparent"
      onClick={handleRestore}
    >
      {/* Agent Icon */}
      <div class="shrink-0 text-muted-foreground/50">
        <FiClock size={16} />
      </div>

      {/* Session Info */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-sm truncate text-foreground/80">
            {props.session.agentType === "claudeCode" && "Claude"}
            {props.session.agentType === "gemini" && "Gemini"}
            {props.session.agentType === "openCode" && "OpenCode"}
            {props.session.agentType === "copilot" && "Copilot"}
            {props.session.agentType === "qwen" && "Qwen"}
            {props.session.agentType === "codex" && "Codex"}
            {props.session.agentType === "custom" && "Custom"}
            {/* Also handle lowercase versions from frontend */}
            {props.session.agentType === "claude" && "Claude"}
            {props.session.agentType === "opencode" && "OpenCode"}
          </span>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground/60 font-medium">
            {props.session.messages?.length || 0} msgs
          </span>
        </div>
        <div class="text-xs text-muted-foreground/40 truncate mt-0.5">
          {props.session.projectPath?.split("/").pop() || "No project"}
        </div>
        <div class="text-[10px] text-muted-foreground/30 mt-0.5">
          {formatDate(props.session.lastActiveAt)}
        </div>
      </div>

      {/* Action Buttons */}
      <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="p-1.5 rounded-md hover:bg-primary/20 text-muted-foreground/60 hover:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            handleRestore();
          }}
          title="Restore session"
          disabled={isDeleting()}
        >
          <FiRefreshCw size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground/60 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          title="Delete session"
          disabled={isDeleting()}
        >
          <FiTrash2 size={14} />
        </Button>
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

export const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const sessions = () => sessionStore.getSessions();
  const activeSession = () => sessionStore.getActiveSession();
  const activeSessions = () => sessionStore.getActiveSessions();

  // Saved sessions state
  const [savedSessions, setSavedSessions] = createSignal<SessionRecord[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = createSignal(false);
  const [showSaved, setShowSaved] = createSignal(false);

  // Load local sessions on mount
  const handleLoadLocalSessions = async () => {
    try {
      // 定义后端返回的类型
      type BackendSessionMetadata = {
        session_id: string;
        agentType: string;
        projectPath: string;
        startedAt: number;
        active: boolean;
        controlledByRemote: boolean;
        hostname: string;
        os: string;
        agentVersion?: string;
        currentDir: string;
        gitBranch?: string;
        machineId: string;
      };

      const localSessions =
        await invoke<BackendSessionMetadata[]>("local_list_agents");
      // Add mode property to each session and convert session_id to sessionId
      const sessionsWithMode = localSessions.map((s) => ({
        sessionId: s.session_id,
        agentType: s.agentType as AgentType,
        projectPath: s.projectPath,
        startedAt: s.startedAt,
        active: s.active,
        controlledByRemote: s.controlledByRemote,
        hostname: s.hostname,
        os: s.os,
        agentVersion: s.agentVersion,
        currentDir: s.currentDir,
        gitBranch: s.gitBranch,
        machineId: s.machineId,
        mode: "local" as const,
      }));

      // Update sessions in store
      for (const session of sessionsWithMode) {
        sessionStore.addSession(session);
      }
    } catch (error) {
      console.error("Failed to load local sessions:", error);
    }
  };

  const handleCloseSession = (e: Event, sessionId: string) => {
    e.stopPropagation();
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
  });

  // Load saved sessions
  const loadSavedSessions = async () => {
    setIsLoadingSaved(true);
    try {
      const sessions = await sessionStore.loadSavedSessions({ limit: 20 });
      setSavedSessions(sessions);
    } catch (error) {
      console.error("Failed to load saved sessions:", error);
    } finally {
      setIsLoadingSaved(false);
    }
  };

  // Toggle saved sessions panel
  const handleToggleSaved = async () => {
    const newShow = !showSaved();
    setShowSaved(newShow);
    if (newShow && savedSessions().length === 0) {
      await loadSavedSessions();
    }
  };

  // Restore a saved session
  const handleRestoreSession = async (sessionId: string) => {
    try {
      const newSessionId = await sessionStore.restoreSession(sessionId);
      if (newSessionId) {
        notificationStore.success("Session restored successfully", "Restore");
        // Reload saved sessions
        await loadSavedSessions();
      }
    } catch (error) {
      console.error("Failed to restore session:", error);
      notificationStore.error("Failed to restore session", "Error");
    }
  };

  // Delete a saved session
  const handleDeleteSavedSession = async (sessionId: string) => {
    try {
      await sessionStore.deleteSavedSession(sessionId);
      // Clear chat messages for this session
      chatStore.clearMessages(sessionId);
      // Update local state
      setSavedSessions(
        savedSessions().filter((s) => s.sessionId !== sessionId),
      );
      notificationStore.success("Session deleted", "Delete");
    } catch (error) {
      console.error("Failed to delete session:", error);
      notificationStore.error("Failed to delete session", "Error");
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
        class={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-gradient-to-b from-background to-base-200/50 border-r border-border/60
          transform transition-transform duration-300 ease-in-out backdrop-blur-sm
          ${props.isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          pt-safe lg:pt-0
        `}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-4 border-b border-border/60 bg-background/50 backdrop-blur">
          <div class="flex items-center gap-2">
            {/* App Logo */}
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
              <span class="text-white font-bold text-sm">R</span>
            </div>
            <div>
              <p class="text-[10px] text-muted-foreground/60 -mt-0.5">
                AI Terminal
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              class="text-xs h-7 text-muted-foreground hover:text-foreground"
              onClick={handleToggleSaved}
              title={
                showSaved() ? "Hide saved sessions" : "Show saved sessions"
              }
            >
              <FiClock size={14} />
            </Button>
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
        <div class="overflow-y-auto flex-1 p-2 space-y-1">
          {/* Active Sessions */}
          <Show when={!showSaved()}>
            <Show when={sessions().length > 0}>
              <div class="px-2 py-2 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                Active Sessions
              </div>
              <For each={sessions()}>
                {(session) => (
                  <SessionItem
                    session={session}
                    isActive={session.sessionId === activeSession()?.sessionId}
                    onClick={() =>
                      sessionStore.setActiveSession(session.sessionId)
                    }
                    onClose={(e) => handleCloseSession(e, session.sessionId)}
                    onSpawnRemoteSession={handleSpawnRemoteSession}
                  />
                )}
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
          </Show>

          {/* Saved Sessions */}
          <Show when={showSaved()}>
            <div class="pt-2 border-t border-border/40">
              <div class="px-2 py-2 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
                Saved Sessions ({savedSessions().length})
              </div>
            </div>
            <Show when={isLoadingSaved()}>
              <div class="flex items-center justify-center py-6">
                <div class="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            </Show>
            <Show when={!isLoadingSaved() && savedSessions().length > 0}>
              <For each={savedSessions()}>
                {(session) => (
                  <SavedSessionItem
                    session={session}
                    onRestore={handleRestoreSession}
                    onDelete={handleDeleteSavedSession}
                  />
                )}
              </For>
            </Show>
            <Show when={!isLoadingSaved() && savedSessions().length === 0}>
              <div class="flex flex-col items-center justify-center py-8 text-center px-4">
                <p class="text-sm text-muted-foreground/60">
                  No saved sessions
                </p>
                <p class="text-xs text-muted-foreground/40 mt-1">
                  Sessions will be saved automatically
                </p>
              </div>
            </Show>
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
