/**
 * AI Agent Session Store
 *
 * Manages AI agent session state including:
 * - Active sessions
 * - Session metadata
 * - Connection state
 */

import { createStore, produce } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { notificationStore } from "./notificationStore";

// ============================================================================
// Types
// ============================================================================

export type AgentType =
  | "claude"
  | "claude_acp"
  | "opencode"
  | "gemini"
  | "copilot"
  | "qwen"
  | "codex"
  | "zeroclaw"
  | "custom";

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
  sessionTicket: string;

  // ZeroClaw provider config
  zeroClawProvider: string;
  zeroClawModel: string;
  zeroClawApiKey: string;
  zeroClawTemperature: string;

  // Network and Loading States
  isNetworkInitialized: boolean;
  isStartingAgent: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  nodeId: string | null;
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
  sessionTicket: "",

  zeroClawProvider: "ollama",
  zeroClawModel: "qwen3:8b",
  zeroClawApiKey: "",
  zeroClawTemperature: "0.7",

  isNetworkInitialized: false,
  isStartingAgent: false,
  isConnecting: false,
  connectionError: null,
  nodeId: null,
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

  const openNewSessionModal = (mode: SessionMode = "remote") => {
    setState(
      produce((s: SessionState) => {
        s.isNewSessionModalOpen = true;
        s.newSessionMode = mode;
      }),
    );
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

      const sessionId = await invoke<string>("connect_to_host", {
        sessionTicket: ticket,
      });

      // Add remote session to store
      addSession({
        sessionId,
        agentType: state.newSessionAgent,
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

      setActiveSession(sessionId);
      closeNewSessionModal();
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

  const handleCreateSession = async () => {
    if (state.newSessionMode === "remote") {
      return handleRemoteConnect();
    }

    if (!state.newSessionPath.trim()) {
      notificationStore.error("Please enter a project path", "Error");
      return;
    }

    setStartingAgent(true);

    try {
      // Build extra args for ZeroClaw provider config
      const extraArgs: string[] = [];
      if (state.newSessionAgent === "zeroclaw") {
        extraArgs.push(state.zeroClawProvider);
        extraArgs.push(state.zeroClawModel);
        if (state.zeroClawApiKey.trim()) {
          extraArgs.push(state.zeroClawApiKey.trim());
        } else {
          extraArgs.push(""); // placeholder for api_key
        }
        extraArgs.push(state.zeroClawTemperature);
      }

      const sessionId = await invoke<string>("local_start_agent", {
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
    setNewSessionMode,
    setNewSessionAgent,
    setNewSessionPath,
    setSessionTicket,
    setConnectionError,
    setConnecting,
    setZeroClawProvider,
    setZeroClawModel,
    setZeroClawApiKey,
    setZeroClawTemperature,

    // Connection and Network
    setConnectionState,
    setNetworkInitialized,
    initializeNetwork,
    setStartingAgent,
    handleCreateSession,
    handleRemoteConnect,

    // Derived
    getActiveSessions,
    getSessionCount,
  };
};

// Global store instance
export const sessionStore = createSessionStore();
