/**
 * Connection Store
 *
 * Manages WASM client connection state for remote agent sessions
 */

import { Store } from '@tanstack/store'
import type { ConnectionState } from './types'

// ============================================================================
// State
// ============================================================================

interface ConnectionStateData {
  connectionState: ConnectionState
  sessionTicket: string
  nodeId: string | null
  connectionError: string | null
  isConnecting: boolean
  lastConnected: number | null
}

// ============================================================================
// Store
// ============================================================================

export const connectionStore = new Store<ConnectionStateData>({
  connectionState: 'disconnected',
  sessionTicket: '',
  nodeId: null,
  connectionError: null,
  isConnecting: false,
  lastConnected: null,
})

// ============================================================================
// Actions
// ============================================================================

export const connectionActions = {
  setSessionTicket: (ticket: string) => {
    connectionStore.setState((state) => ({
      ...state,
      sessionTicket: ticket,
    }))
  },

  setConnectionState: (connectionState: ConnectionState) => {
    connectionStore.setState((state) => ({
      ...state,
      connectionState,
      lastConnected:
        connectionState === 'connected' ? Date.now() : state.lastConnected,
    }))
  },

  setNodeId: (nodeId: string | null) => {
    connectionStore.setState((state) => ({
      ...state,
      nodeId,
    }))
  },

  setConnectionError: (error: string | null) => {
    connectionStore.setState((state) => ({
      ...state,
      connectionError: error,
      connectionState: error ? 'error' : state.connectionState,
    }))
  },

  setConnecting: (connecting: boolean) => {
    connectionStore.setState((state) => ({
      ...state,
      isConnecting: connecting,
      connectionState: connecting ? 'connecting' : state.connectionState,
    }))
  },

  disconnect: () => {
    connectionStore.setState(() => ({
      connectionState: 'disconnected',
      sessionTicket: '',
      nodeId: null,
      connectionError: null,
      isConnecting: false,
      lastConnected: null,
    }))
  },
}

// ============================================================================
// Selectors
// ============================================================================

export const connectionSelectors = {
  getConnectionState: (state: ConnectionStateData) => state.connectionState,
  getSessionTicket: (state: ConnectionStateData) => state.sessionTicket,
  getNodeId: (state: ConnectionStateData) => state.nodeId,
  getConnectionError: (state: ConnectionStateData) => state.connectionError,
  isConnecting: (state: ConnectionStateData) => state.isConnecting,
  isConnected: (state: ConnectionStateData) => state.connectionState === 'connected',
  getLastConnected: (state: ConnectionStateData) => state.lastConnected,
}
