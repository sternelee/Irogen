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
  | "gemini"
  | "copilot"
  | "qwen"
  | "codex"
  | "openclaw"
  | "goose"
  | "custom";

export type SessionMode = "remote" | "local";

export type SessionStatus = "active" | "paused" | "completed";

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

// Chat message for persistent storage
export interface ChatMessage {
  id: string;
  isUser: boolean;
  content: string;
  timestamp: number;
  sequence: number;
}

// Session record for persistent storage
// Note: agentType can be either camelCase from backend (claudeCode, openCode) or lowercase from frontend (claude, opencode)
export interface SessionRecord {
  sessionId: string;
  agentType: AgentType | string;
  projectPath: string;
  startedAt: number;
  lastActiveAt: number;
  status: SessionStatus;
  hostname: string;
  os: string;
  messages: ChatMessage[];
  metadataJson: string;
}

// Session filter for listing
export interface SessionFilter {
  agentType?: AgentType;
  status?: SessionStatus;
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

  // Saved/Persistent sessions
  savedSessions: SessionRecord[];
  isLoadingSavedSessions: boolean;

  // New Session Modal State
  isNewSessionModalOpen: boolean;
  newSessionMode: SessionMode;
  newSessionAgent: AgentType;
  newSessionPath: string;
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
}

const initialState: SessionState = {
  sessions: {},
  activeSessionId: null,
  connectionState: "disconnected",
  lastConnected: null,

  savedSessions: [],
  isLoadingSavedSessions: false,

  isNewSessionModalOpen: false,
  newSessionMode: "remote",
  newSessionAgent: "claude",
  newSessionPath: "",
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
    return [];
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
  // Persistent Session Storage
  // ========================================================================

  const loadSavedSessions = async (filter?: SessionFilter) => {
    setState("isLoadingSavedSessions", true);
    try {
      const sessions = await invoke<SessionRecord[]>("list_sessions", {
        agentType: filter?.agentType,
        status: filter?.status,
        projectPath: filter?.projectPath,
        limit: filter?.limit,
        offset: filter?.offset,
      });
      setState("savedSessions", sessions);
      return sessions;
    } catch (error) {
      console.error("Failed to load saved sessions:", error);
      notificationStore.error("Failed to load saved sessions", "Error");
      return [];
    } finally {
      setState("isLoadingSavedSessions", false);
    }
  };

  const saveSession = async (
    sessionId: string,
    agentType: AgentType,
    projectPath: string,
    messages: ChatMessage[],
    metadataJson: string = "{}",
  ) => {
    try {
      const hostname = "localhost"; // Could be dynamically determined
      const os = navigator.userAgent;

      await invoke("save_session", {
        sessionId,
        agentType,
        projectPath,
        hostname,
        os,
        messages,
        metadataJson,
      });
      console.log("Session saved:", sessionId);
    } catch (error) {
      console.error("Failed to save session:", error);
      notificationStore.error("Failed to save session", "Error");
    }
  };

  const addSessionMessage = async (sessionId: string, message: ChatMessage) => {
    try {
      await invoke("addSessionMessage", {
        sessionId,
        message,
      });
    } catch (error) {
      console.error("Failed to add session message:", error);
    }
  };

  const loadSession = async (
    sessionId: string,
  ): Promise<SessionRecord | null> => {
    try {
      const session = await invoke<SessionRecord | null>("loadSession", {
        sessionId,
      });
      return session;
    } catch (error) {
      console.error("Failed to load session:", error);
      notificationStore.error("Failed to load session", "Error");
      return null;
    }
  };

  const deleteSavedSession = async (sessionId: string) => {
    try {
      await invoke("deleteSession", { sessionId });
      // Update local state
      setState(
        produce((s: SessionState) => {
          s.savedSessions = s.savedSessions.filter(
            (session) => session.sessionId !== sessionId,
          );
        }),
      );
      console.log("Session deleted:", sessionId);
    } catch (error) {
      console.error("Failed to delete session:", error);
      notificationStore.error("Failed to delete session", "Error");
    }
  };

  const updateSessionStatus = async (
    sessionId: string,
    status: SessionStatus,
  ) => {
    try {
      await invoke("updateSessionStatus", {
        sessionId,
        status,
      });
      console.log("Session status updated:", sessionId, status);
    } catch (error) {
      console.error("Failed to update session status:", error);
      notificationStore.error("Failed to update session status", "Error");
    }
  };

  // Restore a saved session - starts a new agent session with the saved context
  const restoreSession = async (sessionId: string): Promise<string | null> => {
    try {
      // Load the saved session
      const savedSession = await loadSession(sessionId);
      if (!savedSession) {
        notificationStore.error("Session not found", "Error");
        return null;
      }

      // Start a new agent session
      const newSessionId = await invoke<string>("local_start_agent", {
        agentTypeStr: savedSession.agentType,
        projectPath: savedSession.projectPath,
        sessionId: undefined,
        extraArgs: undefined,
      });

      // Replay messages to restore context
      if (savedSession.messages && savedSession.messages.length > 0) {
        console.log(
          "[restoreSession] Replaying",
          savedSession.messages.length,
          "messages to session",
          newSessionId,
        );

        // Convert stored messages to the format expected by replay command
        const replayMessages = savedSession.messages.map((msg) => ({
          id: msg.id,
          isUser: msg.isUser,
          content: msg.content,
          timestamp: msg.timestamp,
          sequence: msg.sequence,
        }));

        await invoke("replayAgentMessages", {
          sessionId: newSessionId,
          messages: replayMessages,
        });
      }

      // Mark the saved session as "paused" since it's now active
      await updateSessionStatus(sessionId, "paused");

      // Reload saved sessions
      await loadSavedSessions();

      return newSessionId;
    } catch (error) {
      console.error("Failed to restore session:", error);
      notificationStore.error("Failed to restore session", "Error");
      return null;
    }
  };

  // Auto-save helper - converts chat messages to storage format and saves
  const autoSaveSession = async (
    sessionId: string,
    chatMessages: Array<{ role: string; content: string; thinking?: boolean }>,
  ) => {
    const session = state.sessions[sessionId];
    if (!session) {
      console.warn("[autoSaveSession] Session not found:", sessionId);
      return;
    }

    // Convert chat messages to storage format
    const messages: ChatMessage[] = chatMessages.map((msg, index) => ({
      id: crypto.randomUUID(),
      isUser: msg.role === "user",
      content: msg.content,
      timestamp: Date.now() + index, // Use index to ensure ordering
      sequence: index,
    }));

    await saveSession(
      sessionId,
      session.agentType,
      session.projectPath,
      messages,
      JSON.stringify({
        hostname: session.hostname,
        os: session.os,
        currentDir: session.currentDir,
        gitBranch: session.gitBranch,
      }),
    );
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
    handleCreateSession,
    handleRemoteConnect,
    handleRemoteSpawn,

    // Persistent Session Storage
    loadSavedSessions,
    saveSession,
    addSessionMessage,
    loadSession,
    deleteSavedSession,
    updateSessionStatus,
    restoreSession,
    autoSaveSession,

    // Derived
    getActiveSessions,
    getSessionCount,
  };
};

// Global store instance
export const sessionStore = createSessionStore();
