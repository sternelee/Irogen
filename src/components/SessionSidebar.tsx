/**
 * SessionSidebar Component
 *
 * Sidebar for managing AI agent sessions in a unified list.
 */

import { createSignal, onMount, Show, For, type Component } from "solid-js";
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
import {
  Alert,
  Button,
  Dialog,
  Input,
  Select,
  Textarea,
  Label,
} from "./ui/primitives";

// ============================================================================
// Agent Icons
// ============================================================================

const getAgentIcon = (agentType: AgentType) => {
  const iconClass = "w-4 h-4";
  switch (agentType) {
    case "claude":
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
            {session()?.agentType === "gemini" && "Gemini"}
            {session()?.agentType === "opencode" && "OpenCode"}
            {session()?.agentType === "copilot" && "Copilot"}
            {session()?.agentType === "qwen" && "Qwen"}
            {session()?.agentType === "codex" && "Codex"}
            {session()?.agentType === "zeroclaw" && "ZeroClaw"}
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
  const [showNewSessionModal, setShowNewSessionModal] = createSignal(false);
  const [newSessionAgent, setNewSessionAgent] =
    createSignal<AgentType>("claude");
  const [newSessionPath, setNewSessionPath] = createSignal("");
  const [newSessionMode, setNewSessionMode] = createSignal<"remote" | "local">(
    "remote",
  );

  // ZeroClaw provider config
  const [zeroClawProvider, setZeroClawProvider] = createSignal("ollama");
  const [zeroClawModel, setZeroClawModel] = createSignal("qwen3:8b");
  const [zeroClawApiKey, setZeroClawApiKey] = createSignal("");
  const [zeroClawTemperature, setZeroClawTemperature] = createSignal("0.7");

  // Remote connection state
  const [sessionTicket, setSessionTicket] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);
  const [connectionError, setConnectionError] = createSignal<string | null>(
    null,
  );

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

  // Handle remote ticket connection
  const handleRemoteConnect = async () => {
    const ticket = sessionTicket().trim();
    if (!ticket) {
      setConnectionError("Please enter a session ticket");
      return;
    }

    setConnecting(true);
    setConnectionError(null);

    try {
      const sessionId = await invoke<string>("connect_to_host", {
        sessionTicket: ticket,
      });

      // Add remote session to store
      sessionStore.addSession({
        sessionId,
        agentType: newSessionAgent(),
        projectPath: "",
        startedAt: Date.now(),
        active: true,
        controlledByRemote: false,
        hostname: "remote",
        os: "remote",
        currentDir: "",
        machineId: "remote",
        mode: "remote",
      });

      sessionStore.setActiveSession(sessionId);
      setShowNewSessionModal(false);
      setSessionTicket("");
      notificationStore.success("Connected to remote host", "System");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setConnectionError(errorMessage);
      notificationStore.error(`Connection failed: ${errorMessage}`, "Error");
    } finally {
      setConnecting(false);
    }
  };

  const handleCreateSession = () => {
    if (newSessionMode() === "remote") {
      handleRemoteConnect();
      return;
    }

    if (!newSessionPath().trim()) {
      notificationStore.error("Please enter a project path", "Error");
      return;
    }

    // Create local agent session
    // Build extra args for ZeroClaw provider config
    const extraArgs: string[] = [];
    if (newSessionAgent() === "zeroclaw") {
      extraArgs.push(zeroClawProvider());
      extraArgs.push(zeroClawModel());
      if (zeroClawApiKey().trim()) {
        extraArgs.push(zeroClawApiKey().trim());
      } else {
        extraArgs.push(""); // placeholder for api_key
      }
      extraArgs.push(zeroClawTemperature());
    }

    invoke<string>("local_start_agent", {
      agentTypeStr: newSessionAgent(),
      projectPath: newSessionPath(),
      sessionId: undefined,
      extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
    })
      .then((sessionId) => {
        const newSession = {
          sessionId,
          agentType: newSessionAgent(),
          projectPath: newSessionPath(),
          startedAt: Date.now(),
          active: true,
          controlledByRemote: false,
          hostname: "localhost",
          os: navigator.userAgent,
          currentDir: newSessionPath(),
          machineId: "local",
          mode: "local" as const,
        };

        sessionStore.addSession(newSession);
        sessionStore.setActiveSession(sessionId);
        setShowNewSessionModal(false);
        setNewSessionPath("");
        notificationStore.success("Local agent session started", "System");
      })
      .catch((error) => {
        console.error(
          "[handleCreateSession] Failed to start local agent:",
          error,
        );
        notificationStore.error("Failed to start local agent", "Error");
      });
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
              onClick={() => setShowNewSessionModal(true)}
              title="New Session"
            >
              <FiPlus size={18} />
            </Button>
          </div>
        </div>
      </aside>

      {/* New Session Modal */}
      <Show when={showNewSessionModal()}>
        <Dialog
          open={showNewSessionModal()}
          onClose={() => setShowNewSessionModal(false)}
          contentClass="max-w-md max-h-[90%] overflow-auto"
        >
          <div>
            <h3 class="font-bold text-lg mb-4 flex items-center gap-2">
              <FiPlus size={20} />
              New Session
            </h3>

            {/* Mode Toggle */}
            <div class="flex gap-2 mb-4">
              <Button
                type="button"
                variant={newSessionMode() === "remote" ? "primary" : "ghost"}
                onClick={() => {
                  setNewSessionMode("remote");
                  setConnectionError(null);
                }}
              >
                <FiCloud class="mr-1" /> Remote
              </Button>
              <Button
                type="button"
                variant={newSessionMode() === "local" ? "primary" : "ghost"}
                onClick={() => {
                  setNewSessionMode("local");
                  setConnectionError(null);
                }}
              >
                <FiHome class="mr-1" /> Local
              </Button>
            </div>

            {/* Remote Mode: Ticket Input */}
            <Show when={newSessionMode() === "remote"}>
              <div class="mb-4 space-y-2">
                <Label for="session-ticket">Session Ticket</Label>
                <Textarea
                  id="session-ticket"
                  class="h-24 font-mono text-sm"
                  placeholder="Paste the session ticket from CLI host..."
                  value={sessionTicket()}
                  onInput={(e) => {
                    setSessionTicket(e.currentTarget.value);
                    setConnectionError(null);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      sessionTicket().trim()
                    ) {
                      e.preventDefault();
                      handleRemoteConnect();
                    }
                  }}
                />
                <p class="text-xs text-base-content/50">
                  Run `cli host` to get a session ticket
                </p>
              </div>

              <Show when={connectionError()}>
                <Alert variant="error" class="mb-4 py-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4 shrink-0"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <title>Error</title>
                    <path
                      fill-rule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <span class="text-sm">{connectionError()}</span>
                </Alert>
              </Show>
            </Show>

            {/* Local Mode: Agent Config */}
            <Show when={newSessionMode() === "local"}>
              <div class="mb-4 space-y-2">
                <Label for="agent-type">Agent Type</Label>
                <Select
                  id="agent-type"
                  value={newSessionAgent()}
                  onChange={(e) =>
                    setNewSessionAgent(e.currentTarget.value as AgentType)
                  }
                >
                  <option value="claude">Claude Code</option>
                  <option value="codex">Codex</option>
                  <option value="zeroclaw">ZeroClaw</option>
                  <option value="gemini">Gemini CLI</option>
                  <option value="opencode">OpenCode</option>
                  <option value="copilot">GitHub Copilot</option>
                  <option value="qwen">Qwen Code</option>
                  <option value="custom">Custom</option>
                </Select>
              </div>

              {/* ZeroClaw Provider Config */}
              <Show when={newSessionAgent() === "zeroclaw"}>
                <div class="mb-4 space-y-2">
                  <Label for="provider">Provider</Label>
                  <Select
                    id="provider"
                    value={zeroClawProvider()}
                    onChange={(e) => {
                      setZeroClawProvider(e.currentTarget.value);
                      // Set sensible default model per provider
                      const defaults: Record<string, string> = {
                        ollama: "qwen3:8b",
                        anthropic: "claude-sonnet-4-20250514",
                        openai: "gpt-4o",
                        gemini: "gemini-2.0-flash",
                        deepseek: "deepseek-chat",
                        openrouter: "anthropic/claude-sonnet-4",
                        groq: "llama-3.3-70b-versatile",
                        mistral: "mistral-large-latest",
                        glm: "glm-4-plus",
                      };
                      const model = defaults[e.currentTarget.value];
                      if (model) setZeroClawModel(model);
                    }}
                  >
                    <option value="ollama">Ollama (Local)</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="groq">Groq</option>
                    <option value="mistral">Mistral</option>
                    <option value="glm">GLM / Zhipu</option>
                    <option value="opencode">OpenCode</option>
                    <option value="zai">Z.AI</option>
                  </Select>
                </div>

                <div class="mb-4 space-y-2">
                  <Label for="model">Model</Label>
                  <Input
                    id="model"
                    type="text"
                    value={zeroClawModel()}
                    onInput={(e) => setZeroClawModel(e.currentTarget.value)}
                    placeholder="e.g. qwen3:8b"
                    class="font-mono text-sm"
                  />
                </div>

                <Show when={zeroClawProvider() !== "ollama"}>
                  <div class="mb-4 space-y-2">
                    <Label for="api-key">API Key</Label>
                    <Input
                      id="api-key"
                      type="password"
                      value={zeroClawApiKey()}
                      onInput={(e) => setZeroClawApiKey(e.currentTarget.value)}
                      placeholder="sk-... (or leave empty to use env var)"
                      class="font-mono text-sm"
                    />
                    <p class="text-xs text-base-content/50">
                      Leave empty to use environment variable
                    </p>
                  </div>
                </Show>

                <div class="mb-4 space-y-2">
                  <Label for="temperature">Temperature</Label>
                  <Input
                    id="temperature"
                    type="number"
                    value={zeroClawTemperature()}
                    onInput={(e) =>
                      setZeroClawTemperature(e.currentTarget.value)
                    }
                    placeholder="0.7"
                    class="font-mono text-sm w-24"
                    min="0"
                    max="2"
                    step="0.1"
                  />
                </div>
              </Show>

              <div class="mb-4 space-y-2">
                <Label for="project-path">Project Path</Label>
                <Input
                  id="project-path"
                  type="text"
                  value={newSessionPath()}
                  onInput={(e) => setNewSessionPath(e.currentTarget.value)}
                  placeholder="/path/to/project"
                  class="font-mono text-sm"
                />
              </div>
            </Show>

            <div class="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowNewSessionModal(false);
                  setConnectionError(null);
                  setSessionTicket("");
                }}
              >
                Cancel
              </Button>
              <Show
                when={newSessionMode() === "remote"}
                fallback={
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleCreateSession}
                    disabled={!newSessionPath().trim()}
                  >
                    Create Session
                  </Button>
                }
              >
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleRemoteConnect}
                  disabled={!sessionTicket().trim() || connecting()}
                  loading={connecting()}
                >
                  <Show when={connecting()} fallback={<span>Connect</span>}>
                    Connecting...
                  </Show>
                </Button>
              </Show>
            </div>
          </div>
        </Dialog>
      </Show>
    </>
  );
};

export default SessionSidebar;
