/**
 * Session Store
 *
 * Manages AI agent session state for remote terminal interface
 */

import { Store } from '@tanstack/store'
import type { AgentType, SessionMode } from './types'

// ============================================================================
// Types
// ============================================================================

export interface SessionMetadata {
  sessionId: string
  agentType: AgentType
  projectPath: string
  startedAt: number
  active: boolean
  hostname?: string
  currentDir?: string
  gitBranch?: string
  summary?: string
  thinking?: boolean
}

interface SessionState {
  sessions: Record<string, SessionMetadata>
  activeSessionId: string | null
  isNewSessionModalOpen: boolean
  newSessionMode: SessionMode
  newSessionAgent: AgentType
  newSessionPath: string
}

// ============================================================================
// Store
// ============================================================================

export const sessionStore = new Store<SessionState>({
  sessions: {},
  activeSessionId: null,
  isNewSessionModalOpen: false,
  newSessionMode: 'remote',
  newSessionAgent: 'claude',
  newSessionPath: '',
})

// ============================================================================
// Actions
// ============================================================================

export const sessionActions = {
  // Session operations
  addSession: (metadata: SessionMetadata) => {
    sessionStore.setState((state) => ({
      ...state,
      sessions: {
        ...state.sessions,
        [metadata.sessionId]: metadata,
      },
    }))
  },

  updateSession: (
    sessionId: string,
    updates: Partial<SessionMetadata>
  ) => {
    sessionStore.setState((state) => {
      const session = state.sessions[sessionId]
      if (!session) return state
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, ...updates },
        },
      }
    })
  },

  removeSession: (sessionId: string) => {
    sessionStore.setState((state) => {
      const { [sessionId]: _, ...rest } = state.sessions
      return {
        ...state,
        sessions: rest,
        activeSessionId:
          state.activeSessionId === sessionId ? null : state.activeSessionId,
      }
    })
  },

  setActiveSession: (sessionId: string | null) => {
    sessionStore.setState((state) => ({
      ...state,
      activeSessionId: sessionId,
    }))
  },

  setSessionThinking: (sessionId: string, thinking: boolean) => {
    sessionActions.updateSession(sessionId, { thinking })
  },

  // Modal operations
  openNewSessionModal: (mode: SessionMode = 'remote') => {
    sessionStore.setState((state) => ({
      ...state,
      isNewSessionModalOpen: true,
      newSessionMode: mode,
    }))
  },

  closeNewSessionModal: () => {
    sessionStore.setState((state) => ({
      ...state,
      isNewSessionModalOpen: false,
    }))
  },

  setNewSessionMode: (mode: SessionMode) => {
    sessionStore.setState((state) => ({
      ...state,
      newSessionMode: mode,
    }))
  },

  setNewSessionAgent: (agent: AgentType) => {
    sessionStore.setState((state) => ({
      ...state,
      newSessionAgent: agent,
    }))
  },

  setNewSessionPath: (path: string) => {
    sessionStore.setState((state) => ({
      ...state,
      newSessionPath: path,
    }))
  },
}

// ============================================================================
// Selectors
// ============================================================================

export const sessionSelectors = {
  getSessions: (state: SessionState) => Object.values(state.sessions),

  getSession: (sessionId: string) => (state: SessionState) =>
    state.sessions[sessionId],

  getActiveSession: (state: SessionState) =>
    state.activeSessionId ? state.sessions[state.activeSessionId] : null,

  getActiveSessionId: (state: SessionState) => state.activeSessionId,

  isNewSessionModalOpen: (state: SessionState) => state.isNewSessionModalOpen,

  getNewSessionMode: (state: SessionState) => state.newSessionMode,

  getNewSessionAgent: (state: SessionState) => state.newSessionAgent,

  getNewSessionPath: (state: SessionState) => state.newSessionPath,

  getActiveSessions: (state: SessionState) =>
    Object.values(state.sessions).filter((s) => s.active),

  getSessionCount: (state: SessionState) => Object.keys(state.sessions).length,
}
