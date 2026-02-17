/**
 * SessionSidebar Component
 *
 * Sidebar for managing AI agent sessions in a unified list.
 */

import { onMount, Show, For, type Component } from "solid-js";
import {
  FiPlus,
  FiX,
  FiHome,
  FiCloud,
  FiTerminal,
  FiMessageSquare,
  FiCode,
  FiActivity,
} from "solid-icons/fi";
import { SiGoogle, SiGithub } from "solid-icons/si";
import { invoke } from "@tauri-apps/api/core";
import { sessionStore } from "../stores/sessionStore";
import { notificationStore } from "../stores/notificationStore";
import type { AgentType } from "../stores/sessionStore";
import { Button } from "./ui/primitives";

// ============================================================================
// Agent Icons
// ============================================================================

const getAgentIcon = (agentType: AgentType) => {
  const iconClass = "w-4 h-4";
  switch (agentType) {
    case "claude":
    case "claude_acp":
      return (
        <div class={`${iconClass} text-purple-500`}>
          <FiTerminal size={16} />
        </div>
      );
    case "codex":
      return (
        <div class={`${iconClass} text-emerald-500`}>
          <FiCode size={16} />
        </div>
      );
    case "opencode":
      return (
        <div class={`${iconClass} text-primary`}>
          <FiCode size={16} />
        </div>
      );
    case "gemini":
      return (
        <div class={`${iconClass} text-blue-500`}>
          <SiGoogle size={16} />
        </div>
      );
    case "copilot":
      return (
        <div class={`${iconClass} text-gray-500`}>
          <SiGithub size={16} />
        </div>
      );
    case "qwen":
      return (
        <div class={`${iconClass} text-indigo-500`}>
          <FiMessageSquare size={16} />
        </div>
      );
    case "zeroclaw":
      return (
        <div class={`${iconClass} text-orange-500`}>
          <FiActivity size={16} />
        </div>
      );
    default:
      return (
        <div class={`${iconClass} text-base-content/50`}>
          <FiTerminal size={16} />
        </div>
      );
  }
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
      class={`group relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200
        ${
          props.isActive
            ? "bg-primary/10 border-r-2 border-primary"
            : "hover:bg-base-200/50 border-r-2 border-transparent"
        }`}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick();
        }
      }}
    >
      {/* Mode Indicator */}
      <div class="flex-shrink-0">
        <Show
          when={session()?.mode === "local"}
          fallback={<FiCloud size={18} class="text-base-content/60" />}
        >
          <FiHome size={18} class="text-base-content/60" />
        </Show>
      </div>

      {/* Agent Icon */}
      <div class={`flex-shrink-0 ${props.isActive ? "text-primary" : ""}`}>
        {getAgentIcon(session()?.agentType || "claude")}
      </div>

      {/* Session Info */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span
            class={`font-medium text-sm truncate ${props.isActive ? "text-primary" : ""}`}
          >
            {session()?.agentType === "claude" && "Claude"}
            {session()?.agentType === "claude_acp" && "Claude (ACP)"}
            {session()?.agentType === "gemini" && "Gemini"}
            {session()?.agentType === "opencode" && "OpenCode"}
            {session()?.agentType === "copilot" && "Copilot"}
            {session()?.agentType === "qwen" && "Qwen"}
            {session()?.agentType === "codex" && "Codex"}
            {session()?.agentType === "zeroclaw" && "ClawdAI"}
            {session()?.agentType === "custom" && "Custom"}
          </span>
          <span
            class={`text-xs text-base-content/50 ${
              session()?.mode === "local"
                ? "bg-primary/20 px-2 py-0.5 rounded-full"
                : "bg-base-200 px-2 py-0.5 rounded-full"
            }`}
          >
            {session()?.mode === "local" ? "Local" : "Remote"}
          </span>
        </div>
        <div class="text-xs text-base-content/60 truncate">
          {session()?.projectPath?.split("/").pop() || "No project"}
        </div>
      </div>

      {/* Status Indicator */}
      <div class="flex items-center gap-2">
        {session()?.active && (
          <span class="w-2 h-2 rounded-full bg-success animate-pulse" />
        )}
        <Show when={session()?.mode === "local" && props.onSpawnRemoteSession}>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="h-6 px-2"
            onClick={(e) => {
              e.stopPropagation();
              if (props.onSpawnRemoteSession) {
                props.onSpawnRemoteSession();
              }
            }}
            title="Spawn remote session"
          >
            <FiPlus size={16} />
          </Button>
        </Show>
      </div>

      {/* Close Button */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        class={`p-1 rounded opacity-0 inline-flex items-center justify-center group-hover:opacity-100 transition-opacity
          ${props.isActive ? "hover:bg-primary/20" : "hover:bg-base-300"}`}
        onClick={props.onClose}
        title="Close session"
      >
        <FiX size={16} />
      </Button>
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
      // Stop local agent
      invoke("local_stop_agent", { sessionId }).catch((err) => {
        console.error("Failed to stop local agent:", err);
        notificationStore.error("Failed to stop local agent", "Error");
      });
    }
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
      sessionId: session.sessionId,
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
        class={`fixed lg:static inset-y-0 left-0 z-50 w-80 bg-base-100 border-r border-base-300
          transform transition-transform duration-300 ease-in-out
          ${props.isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Header */}
        <div class="flex items-center justify-between p-4 border-b border-base-300">
          <h3 class="text-sm font-semibold">Sessions</h3>
          <Button
            size="icon"
            variant="ghost"
            class="h-8 w-8 lg:hidden"
            onClick={props.onToggle}
          >
            <FiX size={18} />
          </Button>
        </div>

        {/* Session List */}
        <div class="overflow-y-auto flex-1 p-2">
          <Show when={sessions().length > 0}>
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
            <div class="text-center py-8 text-base-content/50">
              <p class="text-sm">No active sessions</p>
              <p class="text-xs mt-1">
                Create a local session or connect to a remote CLI
              </p>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="p-3 border-t border-base-300">
          <div class="flex items-center justify-between">
            <div class="text-xs text-base-content/50">
              {activeSessions().length} active session
              {activeSessions().length !== 1 ? "s" : ""}
            </div>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => sessionStore.openNewSessionModal("local")}
              title="New Session"
            >
              <FiPlus size={18} />
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default SessionSidebar;
