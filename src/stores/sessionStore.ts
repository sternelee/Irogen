/**
 * AI Agent Session Store
 *
 * Manages AI agent session state including:
 * - Active sessions
 * - Session metadata
 * - Connection state
 * - Persistent session storage
 */

import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { notificationStore } from "./notificationStore";

// ============================================================================
// Types
// ============================================================================

export type AgentType =
  | "claude"
  | "opencode"
  | "codex"
  | "gemini"
  | "openclaw";

export type SessionMode = "remote" | "local";

export interface AgentSessionMetadata {
  sessionId: string;
  agentType: AgentType;
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
  summary?: string;
  thinking?: boolean;
  mode?: SessionMode;
  controlSessionId?: string; // ID of the connection session
}

export interface BackendSessionMetadata {
  session_id: string;
  agent_type: string;
  project_path: string;
  started_at: number;
  active: boolean;
  controlled_by_remote: boolean;
  hostname: string;
  os: string;
  agent_version?: string;
  current_dir: string;
  git_branch?: string;
  machine_id: string;
}

export const normalizeAgentType = (type: string): AgentType => {
  const lower = type.toLowerCase();
  if (lower === "claudecode" || lower === "claude-code") return "claude";
  if (lower === "opencode") return "opencode";
  if (lower === "gemini-cli") return "gemini";
  if (lower === "open-claw") return "openclaw";
  return lower as AgentType;
};

export const mapBackendSessionMetadata = (
  session: BackendSessionMetadata,
  mode: SessionMode,
  controlSessionId?: string,
): AgentSessionMetadata => ({
  sessionId: session.session_id,
  agentType: normalizeAgentType(session.agent_type),
  projectPath: session.project_path,
  startedAt: session.started_at,
  active: session.active,
  controlledByRemote: session.controlled_by_remote,
  hostname: session.hostname,
  os: session.os,
  agentVersion: session.agent_version,
  currentDir: session.current_dir,
  gitBranch: session.git_branch,
  machineId: session.machine_id,
  mode,
  controlSessionId,
});

// Session filter for listing (reserved for future use)
export interface SessionFilter {
  agentType?: AgentType;
  projectPath?: string;
  limit?: number;
  offset?: number;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// ============================================================================
// Store
// ============================================================================

interface SessionState {
  sessions: Record<string, AgentSessionMetadata>;
  activeSessionId: string | null;
  connectionState: ConnectionState;
  lastConnected: number | null;

  // New Session Modal State
  isNewSessionModalOpen: boolean;
  newSessionMode: SessionMode;
  newSessionAgent: AgentType;
  newSessionPath: string;
  newSessionArgs: string;
  sessionTicket: string;
  targetControlSessionId: string | null;

  // ZeroClaw provider config
  zeroClawProvider: string;
  zeroClawModel: string;
  zeroClawApiKey: string;
  zeroClawTemperature: string;
  zeroClawMaxIterations: number;
  zeroClawSystemPrompt: string;
  zeroClawEnabledTools: string[];
  isZeroClawConfigOpen: boolean;

  // Network and Loading States
  isNetworkInitialized: boolean;
  isStartingAgent: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  nodeId: string | null;
  isHistoryLoading: boolean;
}

const initialState: SessionState = {
  sessions: {},
  activeSessionId: null,
  connectionState: "disconnected",
  lastConnected: null,

  isNewSessionModalOpen: false,
  newSessionMode: "remote",
  newSessionAgent: "claude",
  newSessionPath: "",
  newSessionArgs: "",
  sessionTicket: "",
  targetControlSessionId: null,

  zeroClawProvider: "ollama",
  zeroClawModel: "qwen3:8b",
  zeroClawApiKey: "",
  zeroClawTemperature: "0.7",
  zeroClawMaxIterations: 20,
  zeroClawSystemPrompt: "",
  zeroClawEnabledTools: [
    "shell",
    "file_read",
    "file_write",
    "enhanced_screenshot",
    "git_operations",
    "http_request",
    "image_info",
    "memory_store",
    "memory_recall",
    "memory_forget",
    "browser",
    "browser_open",
    "composio",
  ],
  isZeroClawConfigOpen: false,

  isNetworkInitialized: false,
  isStartingAgent: false,
  isConnecting: false,
  connectionError: null,
  nodeId: null,
  isHistoryLoading: false,
};

export const createSessionStore = () => {
  const [state, setState] = createStore<SessionState>(initialState);

  // ========================================================================
  // Session Operations
  // ========================================================================

  const getSessions = (): AgentSessionMetadata[] => {
    return Object.values(state.sessions);
  };

  const getSession = (sessionId: string): AgentSessionMetadata | undefined => {
    return state.sessions[sessionId];
  };

  const getActiveSession = (): AgentSessionMetadata | undefined => {
    if (state.activeSessionId) {
      return state.sessions[state.activeSessionId];
    }
    return undefined;
  };

  const addSession = (metadata: AgentSessionMetadata) => {
    setState(
      produce((s: SessionState) => {
        s.sessions[metadata.sessionId] = metadata;
      }),
    );
  };

  const updateSession = (
    sessionId: string,
    updates: Partial<AgentSessionMetadata>,
  ) => {
    setState(
      produce((s: SessionState) => {
        const session = s.sessions[sessionId];
        if (session) {
          Object.assign(session, updates);
        }
      }),
    );
  };

  const removeSession = (sessionId: string) => {
    setState(
      produce((s: SessionState) => {
        delete s.sessions[sessionId];
        if (s.activeSessionId === sessionId) {
          s.activeSessionId = null;
        }
      }),
    );
  };

  const setActiveSession = (sessionId: string | null) => {
    setState("activeSessionId", sessionId);
  };

  // ========================================================================
  // Modal Operations
  // ========================================================================

  const openNewSessionModal = (
    mode: SessionMode = "remote",
    controlSessionId: string | null = null,
  ) => {
    setState(
      produce((s: SessionState) => {
        s.isNewSessionModalOpen = true;
        s.newSessionMode = mode;
        s.targetControlSessionId = controlSessionId;
      }),
    );
  };

  const setTargetControlSessionId = (id: string | null) => {
    setState("targetControlSessionId", id);
  };

  const closeNewSessionModal = () => {
    setState("isNewSessionModalOpen", false);
  };

  const setNewSessionMode = (mode: SessionMode) => {
    setState("newSessionMode", mode);
  };

  const setNewSessionAgent = (agent: AgentType) => {
    setState("newSessionAgent", agent);
  };

  const setNewSessionPath = (path: string) => {
    setState("newSessionPath", path);
  };

  const setNewSessionArgs = (args: string) => {
    setState("newSessionArgs", args);
  };

  const setSessionTicket = (ticket: string) => {
    setState("sessionTicket", ticket);
  };

  const setConnectionError = (error: string | null) => {
    setState("connectionError", error);
  };

  const setConnecting = (connecting: boolean) => {
    setState("isConnecting", connecting);
  };

  // ZeroClaw Config
  const setZeroClawProvider = (provider: string) => {
    setState("zeroClawProvider", provider);
  };

  const setZeroClawModel = (model: string) => {
    setState("zeroClawModel", model);
  };

  const setZeroClawApiKey = (apiKey: string) => {
    setState("zeroClawApiKey", apiKey);
  };

  const setZeroClawTemperature = (temp: string) => {
    setState("zeroClawTemperature", temp);
  };

  const setZeroClawMaxIterations = (iterations: number) => {
    setState("zeroClawMaxIterations", iterations);
  };

  const setZeroClawSystemPrompt = (prompt: string) => {
    setState("zeroClawSystemPrompt", prompt);
  };

  const setZeroClawEnabledTools = (tools: string[]) => {
    setState("zeroClawEnabledTools", tools);
  };

  const toggleZeroClawTool = (tool: string) => {
    setState(
      produce((s: SessionState) => {
        const idx = s.zeroClawEnabledTools.indexOf(tool);
        if (idx >= 0) {
          s.zeroClawEnabledTools.splice(idx, 1);
        } else {
          s.zeroClawEnabledTools.push(tool);
        }
      }),
    );
  };

  const setZeroClawConfigOpen = (open: boolean) => {
    setState("isZeroClawConfigOpen", open);
  };

  // ========================================================================
  // Connection and Loading State
  // ========================================================================

  const setConnectionState = (connectionState: ConnectionState) => {
    setState("connectionState", connectionState);
    if (connectionState === "connected") {
      setState("lastConnected", Date.now());
    }
  };

  const setNetworkInitialized = (
    initialized: boolean,
    nodeId: string | null = null,
  ) => {
    setState(
      produce((s: SessionState) => {
        s.isNetworkInitialized = initialized;
        s.nodeId = nodeId;
      }),
    );
  };

  const setStartingAgent = (starting: boolean) => {
    setState("isStartingAgent", starting);
  };

  const setHistoryLoading = (loading: boolean) => {
    setState("isHistoryLoading", loading);
  };

  const handleRemoteConnect = async () => {
    const ticket = state.sessionTicket.trim();
    if (!ticket) {
      setConnectionError("Please enter a session ticket");
      return;
    }

    setConnecting(true);
    setConnectionError(null);

    try {
      await initializeNetwork();

      // Connect to remote host and get the connection session ID
      const connectionSessionId = await invoke<string>("connect_to_host", {
        sessionTicket: ticket,
      });

      // Set as target control session to show agent config in modal
      setTargetControlSessionId(connectionSessionId);

      // Load existing remote agent sessions from connected CLI
      const remoteSessions = await invoke<BackendSessionMetadata[]>(
        "remote_list_agents",
        {
          controlSessionId: connectionSessionId,
        },
      );

      for (const s of remoteSessions) {
        addSession(
          mapBackendSessionMetadata(s, "remote", connectionSessionId),
        );
      }

      // Don't close modal - continue with agent config flow
      // User will select agent type and project path, then click "Create Session"
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setConnectionError(errorMessage);
      notificationStore.error(`Connection failed: ${errorMessage}`, "Error");
    } finally {
      setConnecting(false);
    }
  };

  const buildExtraArgs = (): string[] => {
    if (state.newSessionAgent === "openclaw") {
      return [];
    }

    const raw = state.newSessionArgs.trim();
    if (!raw) return [];

    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
          return parsed;
        }
        notificationStore.error(
          "Args must be a JSON array of strings",
          "Invalid Args",
        );
        return [];
      } catch {
        notificationStore.error("Args JSON is invalid", "Invalid Args");
        return [];
      }
    }

    const matches = raw.match(/(?:[^\s\"]+|\"[^\"]*\")+/g) || [];
    return matches.map((arg) => arg.replace(/^\"|\"$/g, ""));
  };

  const handleRemoteSpawn = async () => {
    const controlSessionId = state.targetControlSessionId;
    if (!controlSessionId) {
      notificationStore.error("No remote connection selected", "Error");
      return;
    }

    if (!state.newSessionPath.trim()) {
      notificationStore.error("Please enter a project path", "Error");
      return;
    }

    setStartingAgent(true);

    try {
      await invoke("remote_spawn_session", {
        connectionSessionId: controlSessionId,
        agentType: state.newSessionAgent,
        projectPath: state.newSessionPath,
        args: buildExtraArgs(),
      });

      notificationStore.success(
        `Spawn request sent for ${state.newSessionAgent} on remote host`,
        "Spawn Session",
      );
      closeNewSessionModal();
      setNewSessionPath("");
      setNewSessionArgs("");
    } catch (error) {
      console.error(
        "[handleRemoteSpawn] Failed to spawn remote session:",
        error,
      );
      notificationStore.error("Failed to spawn remote session", "Error");
    } finally {
      setStartingAgent(false);
    }
  };

  const handleCreateSession = async () => {
    if (state.newSessionMode === "remote") {
      if (state.targetControlSessionId) {
        return handleRemoteSpawn();
      }
      return handleRemoteConnect();
    }

    if (!state.newSessionPath.trim()) {
      notificationStore.error("Please enter a project path", "Error");
      return;
    }

    setStartingAgent(true);

    try {
      const extraArgs = buildExtraArgs();

      let sessionId: string;

      // Use standard local_start_agent
      sessionId = await invoke<string>("local_start_agent", {
        agentTypeStr: state.newSessionAgent,
        projectPath: state.newSessionPath,
        sessionId: undefined,
        extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
      });

      const newSession: AgentSessionMetadata = {
        sessionId,
        agentType: state.newSessionAgent,
        projectPath: state.newSessionPath,
        startedAt: Date.now(),
        active: true,
        controlledByRemote: false,
        hostname: "localhost",
        os: navigator.userAgent,
        currentDir: state.newSessionPath,
        machineId: "local",
        mode: "local",
      };

      addSession(newSession);
      setActiveSession(sessionId);
      closeNewSessionModal();
      setNewSessionPath("");
      setNewSessionArgs("");
    } catch (error) {
      console.error(
        "[handleCreateSession] Failed to start local agent:",
        error,
      );
      notificationStore.error("Failed to start local agent", "Error");
    } finally {
      setStartingAgent(false);
    }
  };

  const initializeNetwork = async () => {
    if (state.isNetworkInitialized) {
      return state.nodeId;
    }

    try {
      console.log("Initializing P2P network...");
      const nodeId = await invoke<string>("initialize_network");
      console.log("Network initialized:", nodeId);
      setNetworkInitialized(true, nodeId);
      return nodeId;
    } catch (error) {
      console.error("Failed to initialize network:", error);
      notificationStore.error("Failed to initialize network", "Error");
      throw error;
    }
  };

  // ========================================================================
  // Derived State
  // ========================================================================

  const getActiveSessions = (): AgentSessionMetadata[] => {
    return Object.values(state.sessions).filter((s) => s.active);
  };

  const getSessionCount = (): number => {
    return Object.keys(state.sessions).length;
  };

  return {
    // State
    state,

    // Sessions
    getSessions,
    getSession,
    getActiveSession,
    addSession,
    updateSession,
    removeSession,
    setActiveSession,

    // Modal
    openNewSessionModal,
    closeNewSessionModal,
    setTargetControlSessionId,
    setNewSessionMode,
    setNewSessionAgent,
    setNewSessionPath,
    setNewSessionArgs,
    setSessionTicket,
    setConnectionError,
    setConnecting,
    setZeroClawProvider,
    setZeroClawModel,
    setZeroClawApiKey,
    setZeroClawTemperature,
    setZeroClawMaxIterations,
    setZeroClawSystemPrompt,
    setZeroClawEnabledTools,
    toggleZeroClawTool,
    setZeroClawConfigOpen,

    // Connection and Network
    setConnectionState,
    setNetworkInitialized,
    initializeNetwork,
    setStartingAgent,
    setHistoryLoading,
    handleCreateSession,
    handleRemoteConnect,
    handleRemoteSpawn,

    // Derived
    getActiveSessions,
    getSessionCount,
  };
};

// Global store instance
export const sessionStore = createSessionStore();
