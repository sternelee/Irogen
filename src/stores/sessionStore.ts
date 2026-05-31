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
import { navigationStore } from "./navigationStore";
import { invoke } from "@tauri-apps/api/core";
import { notificationStore } from "./notificationStore";
import { sessionEventRouter } from "./sessionEventRouter";
import {
  getLastTicket,
  saveProjectPath,
  saveTicket,
} from "../utils/localStorage";

// ============================================================================
// Types
// ============================================================================

export type AgentType =
  | "claude"
  | "opencode"
  | "codex"
  | "cursor"
  | "gemini"
  | "cline"
  | "pi"
  | "qwen";

export type SessionMode = "remote" | "local";

export interface AgentSessionMetadata {
  sessionId: string;
  agentType: AgentType;
  projectPath: string;
  additionalProjectPaths: string[]; // 附加项目列表（跨项目线程）
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
  lastReceivedSequence: number; // Last received message sequence for reconnection
}

export interface ConnectedHostMetadata {
  controlSessionId: string;
  hostname: string;
  os: string;
  machineId: string;
  status: "online" | "offline" | "reconnecting";
}

export interface BackendSessionMetadata {
  sessionId: string;
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
}

export const normalizeAgentType = (type: string | undefined | null): AgentType => {
  const lower = (type ?? "").toLowerCase();
  if (!lower) return "claude";
  if (lower === "claudecode" || lower === "claude-code") return "claude";
  if (lower === "opencode") return "opencode";
  if (lower === "cursor-agent") return "cursor";
  if (lower === "gemini-cli") return "gemini";
  if (lower === "qwencode" || lower === "qwen_code" || lower === "qwen-code")
    return "qwen";
  return lower as AgentType;
};

export const mapBackendSessionMetadata = (
  session: BackendSessionMetadata,
  mode: SessionMode,
  controlSessionId?: string,
): AgentSessionMetadata => ({
  sessionId: session.sessionId,
  agentType: normalizeAgentType(session.agentType),
  projectPath: session.projectPath,
  additionalProjectPaths: [], // 跨项目线程：附加项目列表
  startedAt: session.startedAt,
  active: session.active,
  controlledByRemote: session.controlledByRemote,
  hostname: session.hostname,
  os: session.os,
  agentVersion: session.agentVersion,
  currentDir: session.currentDir,
  gitBranch: session.gitBranch,
  machineId: session.machineId,
  mode,
  controlSessionId,
  lastReceivedSequence: 0,
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
  | "reconnecting"
  | "error";

export type PermissionMode =
  | "AlwaysAsk"
  | "AcceptEdits"
  | "Plan"
  | "AutoApprove";

export interface CompletedPermission {
  requestId: string;
  toolName: string;
  toolParams: unknown;
  status: "Approved" | "Denied" | "Canceled";
  decision: "Approved" | "ApprovedForSession" | "Abort" | null;
  reason: string | null;
  allowedTools: string[] | null;
  createdAt: number;
  completedAt: number;
}

export interface PermissionState {
  mode: PermissionMode;
  allowedTools: string[];
  pendingCount: number;
  completedRequests: CompletedPermission[];
}

// ============================================================================
// Store
// ============================================================================

interface SessionState {
  sessions: Record<string, AgentSessionMetadata>;
  connectedHosts: Record<string, ConnectedHostMetadata>;
  activeSessionId: string | null;
  connectionState: ConnectionState;
  lastConnected: number | null;

  // Permission mode per session
  permissionModes: Record<string, PermissionMode>;

  // New Session Modal State
  isNewSessionModalOpen: boolean;
  newSessionMode: SessionMode;
  newSessionModeFromHost: boolean; // true if opened from a specific host
  newSessionProjectPathLocked: boolean;
  newSessionAgent: AgentType;
  newSessionPath: string;
  newSessionArgs: string;
  newSessionMcpServers: string;
  sessionTicket: string;
  targetControlSessionId: string | null;

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
  connectedHosts: {},
  activeSessionId: null,
  connectionState: "disconnected",
  lastConnected: null,

  permissionModes: {},

  isNewSessionModalOpen: false,
  newSessionMode: "remote",
  newSessionModeFromHost: false,
  newSessionProjectPathLocked: false,
  newSessionAgent: "claude",
  newSessionPath: "",
  newSessionArgs: "",
  newSessionMcpServers: "",
  sessionTicket: getLastTicket() || "",
  targetControlSessionId: null,

  isNetworkInitialized: false,
  isStartingAgent: false,
  isConnecting: false,
  connectionError: null,
  nodeId: null,
  isHistoryLoading: false,
};

// ============================================================================
// Utility helpers
// ============================================================================

const normalizePermissionMode = (raw: string): PermissionMode => {
  switch (raw) {
    case "AcceptEdits":
      return "AcceptEdits";
    case "Plan":
      return "Plan";
    case "AutoApprove":
      return "AutoApprove";
    default:
      return "AlwaysAsk";
  }
};

const normalizeStatus = (raw: string): CompletedPermission["status"] => {
  if (raw === "Approved") return "Approved";
  if (raw === "Denied") return "Denied";
  return "Canceled";
};

const normalizeDecision = (
  raw: string | null,
): CompletedPermission["decision"] => {
  if (raw === "Approved") return "Approved";
  if (raw === "ApprovedForSession") return "ApprovedForSession";
  if (raw === "Abort") return "Abort";
  return null;
};

export const createSessionStore = () => {
  const [state, setState] = createStore<SessionState>(initialState);

  // ========================================================================
  // Session Operations
  // ========================================================================

  const getSessions = (): AgentSessionMetadata[] => {
    return Object.values(state.sessions);
  };

  const getConnectedHosts = (): ConnectedHostMetadata[] => {
    return Object.values(state.connectedHosts);
  };

  const getConnectedHost = (
    controlSessionId: string,
  ): ConnectedHostMetadata | undefined => {
    return state.connectedHosts[controlSessionId];
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

  const addConnectedHost = (metadata: ConnectedHostMetadata) => {
    setState(
      produce((s: SessionState) => {
        s.connectedHosts[metadata.controlSessionId] = metadata;
      }),
    );
  };

  const updateConnectedHost = (
    controlSessionId: string,
    updates: Partial<ConnectedHostMetadata>,
  ) => {
    setState(
      produce((s: SessionState) => {
        const host = s.connectedHosts[controlSessionId];
        if (host) {
          Object.assign(host, updates);
        }
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
    // Clean up event router state to prevent memory leaks
    sessionEventRouter.removeSession(sessionId);

    setState(
      produce((s: SessionState) => {
        delete s.sessions[sessionId];
        if (s.activeSessionId === sessionId) {
          const nextSession = Object.values(s.sessions)
            .filter((session) => session.active)
            .sort((a, b) => b.startedAt - a.startedAt)[0];
          s.activeSessionId = nextSession?.sessionId ?? null;
        }
      }),
    );
  };

  const addAdditionalProjectPath = (sessionId: string, path: string) => {
    setState(
      produce((s: SessionState) => {
        const session = s.sessions[sessionId];
        if (session && !session.additionalProjectPaths.includes(path)) {
          session.additionalProjectPaths.push(path);
        }
      }),
    );
  };

  const removeAdditionalProjectPath = (sessionId: string, path: string) => {
    setState(
      produce((s: SessionState) => {
        const session = s.sessions[sessionId];
        if (session) {
          session.additionalProjectPaths =
            session.additionalProjectPaths.filter((p) => p !== path);
        }
      }),
    );
  };

  const archiveSession = (sessionId: string) => {
    removeSession(sessionId);
  };

  const stopSession = async (sessionId: string): Promise<void> => {
    const session = getSession(sessionId);
    if (!session) {
      notificationStore.error("Session not found", "Stop Session");
      return;
    }

    try {
      if (session.mode === "local") {
        await invoke("local_stop_agent", { sessionId });
      } else {
        await invoke("remote_stop_agent", {
          sessionId,
          controlSessionId: session.controlSessionId,
        });
      }

      updateSession(sessionId, { active: false });
      notificationStore.success("Thread stopped", "Parallel Agents");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      notificationStore.error(errorMessage, "Failed to stop thread");
      throw error;
    }
  };

  const removeConnectedHost = (controlSessionId: string) => {
    setState(
      produce((s: SessionState) => {
        delete s.connectedHosts[controlSessionId];
        if (s.targetControlSessionId === controlSessionId) {
          s.targetControlSessionId = null;
        }
      }),
    );
  };

  const setActiveSession = (sessionId: string | null) => {
    // Guard against pointing the active session at an id that no longer exists
    // (e.g. a session removed by a backend disconnect before its cleanup event
    // was processed). getActiveSession already tolerates a stale id, but we
    // avoid persisting a dangling reference here.
    if (sessionId !== null && !state.sessions[sessionId]) {
      console.warn(
        `setActiveSession: session ${sessionId} does not exist, ignoring`,
      );
      return;
    }
    setState("activeSessionId", sessionId);
  };

  // ========================================================================
  // Modal Operations
  // ========================================================================

  const openNewSessionModal = (
    mode: SessionMode = "remote",
    controlSessionId?: string | null,
    fromHost: boolean = false,
    projectPath?: string,
    lockProjectPath: boolean = false,
  ) => {
    setState(
      produce((s: SessionState) => {
        s.isNewSessionModalOpen = true;
        s.newSessionMode = mode;
        s.newSessionModeFromHost = fromHost;
        s.newSessionProjectPathLocked = lockProjectPath;
        if (projectPath !== undefined) {
          s.newSessionPath = projectPath;
        }
        // Only update targetControlSessionId if explicitly provided
        // This preserves the existing connection when reopening the modal
        if (controlSessionId !== undefined) {
          s.targetControlSessionId = controlSessionId;
        }
      }),
    );
  };

  const setTargetControlSessionId = (id: string | null) => {
    setState("targetControlSessionId", id);
  };

  const closeNewSessionModal = () => {
    setState(
      produce((s: SessionState) => {
        s.isNewSessionModalOpen = false;
        s.newSessionModeFromHost = false;
        s.newSessionProjectPathLocked = false;
      }),
    );
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

  const setNewSessionMcpServers = (json: string) => {
    setState("newSessionMcpServers", json);
  };

  const setSessionTicket = (ticket: string) => {
    setState("sessionTicket", ticket);
    if (ticket.trim()) {
      saveTicket(ticket);
    }
  };

  const setConnectionError = (error: string | null) => {
    setState("connectionError", error);
  };

  const setConnecting = (connecting: boolean) => {
    setState("isConnecting", connecting);
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

  // ========================================================================
  // Message Sync (断线重连）
  // ========================================================================

  const updateLastReceivedSequence = (sessionId: string, sequence: number) => {
    setState(
      produce((s: SessionState) => {
        const session = s.sessions[sessionId];
        if (session) {
          session.lastReceivedSequence = sequence;
        }
      }),
    );
  };

  const handleRemoteConnect = async () => {
    // Guard against duplicate concurrent connect calls
    if (state.isConnecting) return;

    const ticket = state.sessionTicket.trim();
    if (!ticket) {
      setConnectionError("Please enter a session ticket");
      return;
    }

    setConnecting(true);
    setConnectionError(null);
    setConnectionState("connecting");

    try {
      await initializeNetwork();

      // Connect to remote host and get the connection session ID
      const connectionSessionId = await invoke<string>("connect_to_host", {
        sessionTicket: ticket,
      });

      setConnectionState("connected");
      setTargetControlSessionId(connectionSessionId);
      setSessionTicket("");
      addConnectedHost({
        controlSessionId: connectionSessionId,
        hostname: "Remote Host",
        os: "Connected via ticket",
        machineId: connectionSessionId,
        status: "online",
      });
      setConnectionError(null);

      // Best-effort: load existing remote sessions.
      // Readiness is now guaranteed by backend connect_to_host.
      try {
        const remoteSessions = await invoke<BackendSessionMetadata[]>(
          "remote_list_agents",
          {
            controlSessionId: connectionSessionId,
          },
        );
        for (const s of remoteSessions) {
          updateConnectedHost(connectionSessionId, {
            hostname: s.hostname || "Remote Host",
            os: s.os || "Connected via ticket",
            machineId: s.machineId || connectionSessionId,
            status: s.active ? "online" : "offline",
          });
          addSession(
            mapBackendSessionMetadata(s, "remote", connectionSessionId),
          );
        }
      } catch (listError) {
        console.warn(
          "[handleRemoteConnect] Connected, but failed to list remote agents:",
          listError,
        );
      }

      // Don't close modal - continue with agent config flow
      // User will select agent type and project path, then click "Create Session"
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setConnectionError(errorMessage);
      setConnectionState("error");
      notificationStore.error(`Connection failed: ${errorMessage}`, "Error");
    } finally {
      setConnecting(false);
    }
  };

  const buildExtraArgs = (): string[] => {
    const raw = state.newSessionArgs.trim();
    if (!raw) return [];

    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.every((v) => typeof v === "string")
        ) {
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

  const parseMcpServers = (): unknown | undefined => {
    const raw = state.newSessionMcpServers.trim();
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        notificationStore.error(
          "MCP Servers must be a JSON array",
          "Invalid MCP Config",
        );
        return undefined;
      }
      return parsed;
    } catch {
      notificationStore.error(
        "MCP Servers JSON is invalid",
        "Invalid MCP Config",
      );
      return undefined;
    }
  };

  const handleRemoteSpawn = async () => {
    if (state.isStartingAgent) {
      notificationStore.info("Session spawn already in progress...", "Please Wait");
      return;
    }

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
      const mcpServers = parseMcpServers();
      await invoke("remote_spawn_session", {
        connectionSessionId: controlSessionId,
        agentType: state.newSessionAgent,
        projectPath: state.newSessionPath,
        args: buildExtraArgs(),
        mcpServers,
      });

      saveProjectPath(state.newSessionPath);

      notificationStore.success(
        `Spawn request sent for ${state.newSessionAgent} on remote host`,
        "Spawn Session",
      );

      // Capture existing session IDs before refreshing
      const existingSessionIds = new Set(Object.keys(state.sessions));

      // Refresh the session list to include the newly spawned session
      try {
        const remoteSessions = await invoke<BackendSessionMetadata[]>(
          "remote_list_agents",
          {
            controlSessionId,
          },
        );
        let newSessionId: string | null = null;
        for (const s of remoteSessions) {
          // Only add sessions that don't already exist
          if (!state.sessions[s.sessionId]) {
            const mapped = mapBackendSessionMetadata(
              s,
              "remote",
              controlSessionId,
            );
            addSession(mapped);
            // Track the new session if it was just created
            if (!existingSessionIds.has(s.sessionId)) {
              newSessionId = s.sessionId;
            }
          }
        }
        // Auto-select the new session if exactly one was created
        if (newSessionId) {
          setActiveSession(newSessionId);
          navigationStore.setActiveView("chat");
        }
      } catch (listError) {
        console.warn(
          "[handleRemoteSpawn] Failed to refresh session list:",
          listError,
        );
        notificationStore.warning(
          "Session spawned but could not refresh the session list. Please restart the app or switch views to see the new session.",
          "Spawn Session",
        );
      }

      closeNewSessionModal();
      setNewSessionPath("");
      setNewSessionArgs("");
      setNewSessionMcpServers("");
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
    if (state.isConnecting) {
      notificationStore.info("Connection already in progress...", "Please Wait");
      return;
    }

    if (state.isStartingAgent) {
      notificationStore.info("Session spawn already in progress...", "Please Wait");
      return;
    }

    if (state.newSessionMode === "remote") {
      // If user entered a ticket, always connect (even if an old targetControlSessionId exists)
      if (state.sessionTicket.trim()) {
        return handleRemoteConnect();
      }
      // No ticket but have an existing connection — spawn directly
      if (state.targetControlSessionId) {
        return handleRemoteSpawn();
      }
      setConnectionError("Please enter a session ticket or select an existing connection");
      return;
    }

    if (!state.newSessionPath.trim()) {
      notificationStore.error("Please enter a project path", "Error");
      return;
    }

    setStartingAgent(true);

    try {
      const extraArgs = buildExtraArgs();
      const mcpServers = parseMcpServers();

      let sessionId: string;

      // Use standard local_start_agent
      sessionId = await invoke<string>("local_start_agent", {
        agentTypeStr: state.newSessionAgent,
        projectPath: state.newSessionPath,
        sessionId: undefined,
        extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
        mcpServers,
        additionalProjectPaths: undefined, // 跨项目线程：创建时暂无附加项目
      });

      saveProjectPath(state.newSessionPath);

      const newSession: AgentSessionMetadata = {
        sessionId,
        agentType: state.newSessionAgent,
        projectPath: state.newSessionPath,
        additionalProjectPaths: [], // 跨项目线程：附加项目列表
        startedAt: Date.now(),
        active: true,
        controlledByRemote: false,
        hostname: "localhost",
        os: navigator.userAgent,
        currentDir: state.newSessionPath,
        machineId: "local",
        mode: "local",
        lastReceivedSequence: 0,
      };

      addSession(newSession);
      setActiveSession(sessionId);
      navigationStore.setActiveView("chat");
      closeNewSessionModal();
      setNewSessionPath("");
      setNewSessionArgs("");
      setNewSessionMcpServers("");
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
  // Permission Management
  // ========================================================================

  const getPermissionMode = (sessionId: string): PermissionMode => {
    return state.permissionModes[sessionId] ?? "AlwaysAsk";
  };

  const setPermissionMode = (sessionId: string, mode: PermissionMode) => {
    setState("permissionModes", sessionId, mode);
  };

  const loadPermissionMode = async (
    sessionId: string,
    sessionMode: "local" | "remote",
  ) => {
    try {
      if (sessionMode === "local") {
        const mode = await invoke<string>("get_permission_mode", { sessionId });
        const normalized = normalizePermissionMode(mode);
        setPermissionMode(sessionId, normalized);
        return normalized;
      }
    } catch (error) {
      console.warn("Failed to load permission mode for", sessionId, error);
    }
    return getPermissionMode(sessionId);
  };

  const loadPermissionState = async (
    sessionId: string,
  ): Promise<PermissionState | null> => {
    try {
      const raw = await invoke<{
        mode: string;
        allowed_tools: string[];
        pending_requests: unknown[];
        completed_requests: Array<{
          request_id: string;
          tool_name: string;
          tool_params: unknown;
          status: string;
          decision: string | null;
          reason: string | null;
          allowed_tools: string[] | null;
          created_at: number;
          completed_at: number;
        }>;
      }>("local_get_permission_state", { sessionId });

      const mode = normalizePermissionMode(raw.mode);
      setPermissionMode(sessionId, mode);

      return {
        mode,
        allowedTools: raw.allowed_tools,
        pendingCount: raw.pending_requests.length,
        completedRequests: raw.completed_requests.map((c) => ({
          requestId: c.request_id,
          toolName: c.tool_name,
          toolParams: c.tool_params,
          status: normalizeStatus(c.status),
          decision: normalizeDecision(c.decision),
          reason: c.reason,
          allowedTools: c.allowed_tools,
          createdAt: c.created_at,
          completedAt: c.completed_at,
        })),
      };
    } catch (error) {
      console.warn("Failed to load permission state for", sessionId, error);
      return null;
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
    getConnectedHosts,
    getConnectedHost,
    getSession,
    getActiveSession,
    addSession,
    addConnectedHost,
    updateConnectedHost,
    updateSession,
    removeSession,
    archiveSession,
    stopSession,
    removeConnectedHost,
    setActiveSession,

    // Cross-project threads
    addAdditionalProjectPath,
    removeAdditionalProjectPath,

    // Modal
    openNewSessionModal,
    closeNewSessionModal,
    setTargetControlSessionId,
    setNewSessionMode,
    setNewSessionAgent,
    setNewSessionPath,
    setNewSessionArgs,
    setNewSessionMcpServers,
    setSessionTicket,
    setConnectionError,
    setConnecting,

    // Connection and Network
    setConnectionState,
    setNetworkInitialized,
    initializeNetwork,
    setStartingAgent,
    setHistoryLoading,

    // Message Sync
    updateLastReceivedSequence,

    handleCreateSession,
    handleRemoteConnect,
    handleRemoteSpawn,

    // Permission Management
    getPermissionMode,
    setPermissionMode,
    loadPermissionMode,
    loadPermissionState,

    // Derived
    getActiveSessions,
    getSessionCount,
  };
};

// Global store instance
export const sessionStore = createSessionStore();
