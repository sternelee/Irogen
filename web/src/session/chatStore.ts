/**
 * Chat Store
 *
 * Manages chat state for AI agent sessions
 */

import { Store } from '@tanstack/store'
import type { ChatMessage } from './types'

// ============================================================================
// State
// ============================================================================

interface ToolStatus {
  id: string
  toolName: string
  status: 'started' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  input?: unknown
  output?: string
  timestamp: number
}

interface PermissionData {
  id: string
  sessionId: string
  toolName: string
  toolParams?: unknown
  description: string
  message?: string
  requestedAt: number
  status: 'pending' | 'approved' | 'denied'
}

interface ChatState {
  messages: Record<string, ChatMessage[]>
  pendingPermissions: Record<string, PermissionData[]>
  toolStatus: Record<string, Record<string, ToolStatus>>
  unreadCounts: Record<string, number>
  streamingContent: Record<string, string>
  isStreaming: Record<string, boolean>
}

// ============================================================================
// Store
// ============================================================================

export const chatStore = new Store<ChatState>({
  messages: {},
  pendingPermissions: {},
  toolStatus: {},
  unreadCounts: {},
  streamingContent: {},
  isStreaming: {},
})

// ============================================================================
// Helper
// ============================================================================

const generateId = () => crypto.randomUUID()

// ============================================================================
// Actions
// ============================================================================

export const chatActions = {
  // Message operations
  addMessage: (sessionId: string, message: { role: 'user' | 'assistant'; content: string }) => {
    chatStore.setState((state) => {
      const messages = state.messages[sessionId] || []
      return {
        ...state,
        messages: {
          ...state.messages,
          [sessionId]: [
            ...messages,
            {
              ...message,
              id: generateId(),
              timestamp: Date.now(),
            },
          ],
        },
      }
    })
  },

  clearMessages: (sessionId: string) => {
    chatStore.setState((state) => ({
      ...state,
      messages: {
        ...state.messages,
        [sessionId]: [],
      },
    }))
  },

  // Streaming operations
  startStreaming: (sessionId: string) => {
    chatStore.setState((state) => ({
      ...state,
      isStreaming: { ...state.isStreaming, [sessionId]: true },
      streamingContent: { ...state.streamingContent, [sessionId]: '' },
    }))
  },

  appendStreamingContent: (sessionId: string, content: string) => {
    chatStore.setState((state) => ({
      ...state,
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: (state.streamingContent[sessionId] || '') + content,
      },
    }))
  },

  stopStreaming: (sessionId: string) => {
    chatStore.setState((state) => ({
      ...state,
      isStreaming: { ...state.isStreaming, [sessionId]: false },
    }))
  },

  // Permission operations
  addPermissionRequest: (
    sessionId: string,
    request: {
      sessionId: string
      toolName: string
      toolParams?: unknown
      description: string
      message?: string
    }
  ) => {
    const permission: PermissionData = {
      ...request,
      id: generateId(),
      requestedAt: Date.now(),
      status: 'pending',
    }
    chatStore.setState((state) => {
      const permissions = state.pendingPermissions[sessionId] || []
      return {
        ...state,
        pendingPermissions: {
          ...state.pendingPermissions,
          [sessionId]: [...permissions, permission],
        },
      }
    })
    return permission.id
  },

  respondToPermission: (
    sessionId: string,
    requestId: string,
    _status: 'approved' | 'denied'
  ) => {
    chatStore.setState((state) => {
      const permissions = state.pendingPermissions[sessionId]
      if (!permissions) return state
      return {
        ...state,
        pendingPermissions: {
          ...state.pendingPermissions,
          [sessionId]: permissions.filter((p) => p.id !== requestId),
        },
      }
    })
  },

  // Tool status operations
  updateToolStatus: (sessionId: string, toolStatus: ToolStatus) => {
    chatStore.setState((state) => {
      const tools = state.toolStatus[sessionId] || {}
      return {
        ...state,
        toolStatus: {
          ...state.toolStatus,
          [sessionId]: {
            ...tools,
            [toolStatus.id]: toolStatus,
          },
        },
      }
    })
  },

  // Unread count operations
  incrementUnread: (sessionId: string) => {
    chatStore.setState((state) => ({
      ...state,
      unreadCounts: {
        ...state.unreadCounts,
        [sessionId]: (state.unreadCounts[sessionId] || 0) + 1,
      },
    }))
  },

  markAsRead: (sessionId: string) => {
    chatStore.setState((state) => ({
      ...state,
      unreadCounts: { ...state.unreadCounts, [sessionId]: 0 },
    }))
  },
}

// ============================================================================
// Selectors
// ============================================================================

export const chatSelectors = {
  getMessages: (sessionId: string) => (state: ChatState) =>
    state.messages[sessionId] || [],

  getPendingPermissions: (sessionId: string) => (state: ChatState) =>
    state.pendingPermissions[sessionId] || [],

  getToolStatus: (sessionId: string) => (state: ChatState) =>
    state.toolStatus[sessionId] || {},

  getUnreadCount: (sessionId: string) => (state: ChatState) =>
    state.unreadCounts[sessionId] || 0,

  hasUnread: (sessionId: string) => (state: ChatState) =>
    (state.unreadCounts[sessionId] || 0) > 0,

  isStreaming: (sessionId: string) => (state: ChatState) =>
    state.isStreaming[sessionId] || false,

  getStreamingContent: (sessionId: string) => (state: ChatState) =>
    state.streamingContent[sessionId] || '',
}
