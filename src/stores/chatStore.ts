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

export interface FollowingLocation {
  path: string
  line?: number
}

export interface TodoEntry {
  content: string
  status: string
}

export interface SlashCommandItem {
  name: string
  description?: string
}

export interface CustomPromptItem {
  name: string
  description?: string
  command?: string
}

export type SystemCard =
  | {
      type: 'following'
      locations: FollowingLocation[]
    }
  | {
      type: 'edit_review'
      path: string
      oldText: string
      newText: string
    }
  | {
      type: 'todo_list'
      entries: TodoEntry[]
    }
  | {
      type: 'terminal'
      terminalId: string
      title?: string
      mode?: string
      status?: string
    }

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  thinking?: boolean
  messageId?: string
  toolCalls?: ToolCall[]
  attachments?: Attachment[]
  systemCard?: SystemCard
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

// User question - when agent asks user to select from options
export interface UserQuestion {
  id: string
  sessionId: string
  question: string
  options: string[]
  selectedIndex?: number
  requestedAt: number
  status: 'pending' | 'answered'
}

// ============================================================================
// Store
// ============================================================================

interface ChatState {
  messages: Record<string, ChatMessage[]>
  pendingPermissions: Record<string, PermissionRequest[]>
  pendingQuestions: Record<string, UserQuestion[]>
  inputValues: Record<string, string>
  activeSession: string | null
  toolStatus: Record<string, Record<string, ToolCall>>
  attachments: Record<string, Attachment[]>
  // Unread message counts per session (for sidebar notification)
  unreadCounts: Record<string, number>
  // Per-session custom slash commands from agent runtime updates
  slashCommands: Record<string, SlashCommandItem[]>
  // Per-session custom prompts from agent runtime updates
  customPrompts: Record<string, CustomPromptItem[]>
}

const initialState: ChatState = {
  messages: {},
  pendingPermissions: {},
  pendingQuestions: {},
  inputValues: {},
  activeSession: null,
  toolStatus: {},
  attachments: {},
  unreadCounts: {},
  slashCommands: {},
  customPrompts: {},
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
    request: Omit<PermissionRequest, 'id' | 'requestedAt' | 'status'> & {
      id?: string
      requestedAt?: number
      status?: PermissionRequest['status']
    },
  ) => {
    const permission: PermissionRequest = {
      ...request,
      id: request.id ?? crypto.randomUUID(),
      requestedAt: request.requestedAt ?? Date.now(),
      status: request.status ?? 'pending',
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

  const setPendingPermissions = (sessionId: string, permissions: PermissionRequest[]) => {
    setState(
      produce((s: ChatState) => {
        s.pendingPermissions[sessionId] = permissions
      }),
    )
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
  // User Question Operations
  // ========================================================================

  const getPendingQuestions = (sessionId: string): UserQuestion[] => {
    return state.pendingQuestions[sessionId] || []
  }

  const addUserQuestion = (
    sessionId: string,
    question: { id?: string; sessionId: string; question: string; options: string[] },
  ) => {
    const id = question.id || crypto.randomUUID()
    const userQuestion: UserQuestion = {
      ...question,
      id,
      requestedAt: Date.now(),
      status: 'pending',
    }

    setState(
      produce((s: ChatState) => {
        if (!s.pendingQuestions[sessionId]) {
          s.pendingQuestions[sessionId] = []
        }
        s.pendingQuestions[sessionId]!.push(userQuestion)
      }),
    )

    return id
  }

  const answerQuestion = (sessionId: string, questionId: string, answer: string) => {
    setState(
      produce((s: ChatState) => {
        const questions = s.pendingQuestions[sessionId]
        if (!questions) return
        const question = questions.find((q) => q.id === questionId)
        if (question) {
          question.status = 'answered'
          question.selectedIndex = question.options.indexOf(answer)
        }
      }),
    )
  }

  const clearQuestion = (sessionId: string, questionId: string) => {
    setState(
      produce((s: ChatState) => {
        const questions = s.pendingQuestions[sessionId]
        if (!questions) return
        s.pendingQuestions[sessionId] = questions.filter((q) => q.id !== questionId)
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

  // ========================================================================
  // Unread Count Operations
  // ========================================================================

  const getUnreadCount = (sessionId: string): number => {
    return state.unreadCounts[sessionId] || 0
  }

  const hasUnread = (sessionId: string): boolean => {
    return (state.unreadCounts[sessionId] || 0) > 0
  }

  const incrementUnread = (sessionId: string) => {
    setState(
      produce((s: ChatState) => {
        s.unreadCounts[sessionId] = (s.unreadCounts[sessionId] || 0) + 1
      }),
    )
  }

  const markAsRead = (sessionId: string) => {
    setState(
      produce((s: ChatState) => {
        s.unreadCounts[sessionId] = 0
      }),
    )
  }

  const clearUnread = (sessionId: string) => {
    setState(
      produce((s: ChatState) => {
        delete s.unreadCounts[sessionId]
      }),
    )
  }

  // ========================================================================
  // Slash Commands
  // ========================================================================

  const getSlashCommands = (sessionId: string): SlashCommandItem[] => {
    return state.slashCommands[sessionId] || []
  }

  const setSlashCommands = (sessionId: string, commands: SlashCommandItem[]) => {
    setState(
      produce((s: ChatState) => {
        s.slashCommands[sessionId] = commands
      }),
    )
  }

  const clearSlashCommands = (sessionId: string) => {
    setState(
      produce((s: ChatState) => {
        delete s.slashCommands[sessionId]
      }),
    )
  }

  const getCustomPrompts = (sessionId: string): CustomPromptItem[] => {
    return state.customPrompts[sessionId] || []
  }

  const setCustomPrompts = (sessionId: string, prompts: CustomPromptItem[]) => {
    setState(
      produce((s: ChatState) => {
        s.customPrompts[sessionId] = prompts
      }),
    )
  }

  const clearCustomPrompts = (sessionId: string) => {
    setState(
      produce((s: ChatState) => {
        delete s.customPrompts[sessionId]
      }),
    )
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
    setPendingPermissions,
    respondToPermission,
    clearPermission,

    // User Questions
    getPendingQuestions,
    addUserQuestion,
    answerQuestion,
    clearQuestion,

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

    // Unread Counts
    getUnreadCount,
    hasUnread,
    incrementUnread,
    markAsRead,
    clearUnread,

    // Slash Commands
    getSlashCommands,
    setSlashCommands,
    clearSlashCommands,
    getCustomPrompts,
    setCustomPrompts,
    clearCustomPrompts,
  }
}

// Global store instance
export const chatStore = createChatStore()
