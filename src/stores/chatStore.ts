/**
 * AI Agent Chat Store
 *
 * Manages chat state for AI agent sessions including:
 * - Message history
 * - Input state
 * - Permission requests
 * - Tool call status
 */

import { createStore, produce } from 'solid-js/store'

// ============================================================================
// Types
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  thinking?: boolean
  messageId?: string
  toolCalls?: ToolCall[]
  attachments?: Attachment[]
}

export interface ToolCall {
  id: string
  toolName: string
  status: 'started' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  output?: string
  timestamp: number
}

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  path?: string
  previewUrl?: string
}

export interface PermissionRequest {
  id: string
  sessionId: string
  toolName: string
  toolParams: unknown
  description: string
  requestedAt: number
  status: 'pending' | 'approved' | 'denied'
  response?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
}

// ============================================================================
// Store
// ============================================================================

interface ChatState {
  messages: Record<string, ChatMessage[]>
  pendingPermissions: Record<string, PermissionRequest[]>
  inputValues: Record<string, string>
  activeSession: string | null
  toolStatus: Record<string, Record<string, ToolCall>>
  attachments: Record<string, Attachment[]>
}

const initialState: ChatState = {
  messages: {},
  pendingPermissions: {},
  inputValues: {},
  activeSession: null,
  toolStatus: {},
  attachments: {},
}

export const createChatStore = () => {
  const [state, setState] = createStore<ChatState>(initialState)

  // ========================================================================
  // Message Operations
  // ========================================================================

  const getMessages = (sessionId: string): ChatMessage[] => {
    return state.messages[sessionId] || []
  }

  const addMessage = (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setState(
      produce((s: ChatState) => {
        if (!s.messages[sessionId]) {
          s.messages[sessionId] = []
        }
        s.messages[sessionId]!.push({
          ...message,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        })
      }),
    )
  }

  const updateMessage = (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => {
    setState(
      produce((s: ChatState) => {
        const messages = s.messages[sessionId]
        if (!messages) return
        const msg = messages.find((m) => m.id === messageId)
        if (msg) {
          Object.assign(msg, updates)
        }
      }),
    )
  }

  const clearMessages = (sessionId: string) => {
    setState(
      produce((s: ChatState) => {
        s.messages[sessionId] = []
      }),
    )
  }

  // ========================================================================
  // Permission Operations
  // ========================================================================

  const getPendingPermissions = (sessionId: string): PermissionRequest[] => {
    return state.pendingPermissions[sessionId] || []
  }

  const addPermissionRequest = (
    sessionId: string,
    request: Omit<PermissionRequest, 'id' | 'requestedAt' | 'status'>,
  ) => {
    const permission: PermissionRequest = {
      ...request,
      id: crypto.randomUUID(),
      requestedAt: Date.now(),
      status: 'pending',
    }

    setState(
      produce((s: ChatState) => {
        if (!s.pendingPermissions[sessionId]) {
          s.pendingPermissions[sessionId] = []
        }
        s.pendingPermissions[sessionId]!.push(permission)
      }),
    )

    return permission.id
  }

  const respondToPermission = (
    sessionId: string,
    permissionId: string,
    response: PermissionRequest['response'],
  ) => {
    setState(
      produce((s: ChatState) => {
        const permissions = s.pendingPermissions[sessionId]
        if (!permissions) return
        const perm = permissions.find((p) => p.id === permissionId)
        if (perm) {
          perm.response = response
          perm.status = response === 'denied' || response === 'abort' ? 'denied' : 'approved'
        }
      }),
    )
  }

  const clearPermission = (sessionId: string, permissionId: string) => {
    setState(
      produce((s: ChatState) => {
        const permissions = s.pendingPermissions[sessionId]
        if (!permissions) return
        s.pendingPermissions[sessionId] = permissions.filter((p) => p.id !== permissionId)
      }),
    )
  }

  // ========================================================================
  // Attachment Operations
  // ========================================================================

  const getAttachments = (sessionId: string): Attachment[] => {
    return state.attachments[sessionId] || []
  }

  const addAttachment = (sessionId: string, attachment: Omit<Attachment, 'id'>) => {
    setState(
      produce((s: ChatState) => {
        if (!s.attachments[sessionId]) {
          s.attachments[sessionId] = []
        }
        s.attachments[sessionId]!.push({
          ...attachment,
          id: crypto.randomUUID(),
        })
      }),
    )
  }

  const removeAttachment = (sessionId: string, attachmentId: string) => {
    setState(
      produce((s: ChatState) => {
        const attachments = s.attachments[sessionId]
        if (!attachments) return
        s.attachments[sessionId] = attachments.filter((a) => a.id !== attachmentId)
      }),
    )
  }

  const clearAttachments = (sessionId: string) => {
    setState(
      produce((s: ChatState) => {
        s.attachments[sessionId] = []
      }),
    )
  }

  // ========================================================================
  // Input Operations
  // ========================================================================

  const getInputValue = (sessionId: string): string => {
    return state.inputValues[sessionId] || ''
  }

  const setInputValue = (sessionId: string, value: string) => {
    setState(
      produce((s: ChatState) => {
        s.inputValues[sessionId] = value
      }),
    )
  }

  // ========================================================================
  // Tool Status Operations
  // ========================================================================

  const updateToolStatus = (sessionId: string, toolCall: ToolCall) => {
    setState(
      produce((s: ChatState) => {
        if (!s.toolStatus[sessionId]) {
          s.toolStatus[sessionId] = {}
        }
        s.toolStatus[sessionId]![toolCall.id] = toolCall
      }),
    )
  }

  const getToolStatus = (sessionId: string): Record<string, ToolCall> => {
    return state.toolStatus[sessionId] || {}
  }

  // ========================================================================
  // Active Session
  // ========================================================================

  const setActiveSession = (sessionId: string | null) => {
    setState('activeSession', sessionId)
  }

  return {
    // State
    state,

    // Messages
    getMessages,
    addMessage,
    updateMessage,
    clearMessages,

    // Permissions
    getPendingPermissions,
    addPermissionRequest,
    respondToPermission,
    clearPermission,

    // Input
    getInputValue,
    setInputValue,

    // Tool Status
    updateToolStatus,
    getToolStatus,

    // Attachments
    getAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,

    // Active Session
    setActiveSession,
  }
}

// Global store instance
export const chatStore = createChatStore()
