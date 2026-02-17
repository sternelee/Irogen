/**
 * AI Agent Session Store
 *
 * Manages AI agent session state including:
 * - Active sessions
 * - Session metadata
 * - Connection state
 */

import { createStore, produce } from "solid-js/store";

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
}

const initialState: SessionState = {
  sessions: {},
  activeSessionId: null,
  connectionState: "disconnected",
  lastConnected: null,
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
  // Connection State
  // ========================================================================

  const setConnectionState = (connectionState: ConnectionState) => {
    setState("connectionState", connectionState);
    if (connectionState === "connected") {
      setState("lastConnected", Date.now());
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

    // Connection
    setConnectionState,

    // Derived
    getActiveSessions,
    getSessionCount,
  };
};

// Global store instance
export const sessionStore = createSessionStore();
