/**
 * SessionSidebar Component
 *
 * Displays list of agent sessions
 */

import { For, Show } from 'solid-js'
import { Plus, MessageSquare, Terminal, Trash2, Bot } from 'lucide-solid'
import { cn } from '~/lib/utils'
import type { AgentSessionMetadata } from '../types'

interface SessionSidebarProps {
  sessions: AgentSessionMetadata[]
  activeSessionId: string | null
  unreadCounts?: Record<string, number>
  onSelectSession: (sessionId: string) => void
  onDeleteSession?: (sessionId: string) => void
  onNewSession: () => void
}

export function SessionSidebar(props: SessionSidebarProps) {
  const getSessionIcon = (agentType: string) => {
    switch (agentType) {
      case 'claude':
        return <Bot class="w-4 h-4" />
      case 'opencode':
        return <Terminal class="w-4 h-4" />
      default:
        return <MessageSquare class="w-4 h-4" />
    }
  }

  const getAgentLabel = (agentType: string) => {
    switch (agentType) {
      case 'claude':
        return 'Claude'
      case 'opencode':
        return 'OpenCode'
      case 'codex':
        return 'Codex'
      case 'gemini':
        return 'Gemini'
      case 'openclaw':
        return 'OpenClaw'
      default:
        return agentType
    }
  }

  return (
    <div class="flex flex-col h-full bg-base-200">
      {/* Header */}
      <div class="p-3 border-b border-base-300">
        <button
          onClick={props.onNewSession}
          class="flex items-center justify-center gap-2 w-full px-3 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
        >
          <Plus class="w-4 h-4" />
          New Session
        </button>
      </div>

      {/* Session List */}
      <div class="flex-1 overflow-y-auto">
        <Show when={props.sessions.length === 0}>
          <div class="flex flex-col items-center justify-center h-full text-neutral p-4">
            <MessageSquare class="w-8 h-8 mb-2 opacity-50" />
            <p class="text-sm text-center">No sessions yet</p>
            <p class="text-xs text-center mt-1">
              Connect to a remote host to start
            </p>
          </div>
        </Show>

        <For each={props.sessions}>
          {(session) => (
            <div
              class={cn(
                'group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-300/50 transition-colors',
                session.sessionId === props.activeSessionId &&
                  'bg-base-300/50 border-l-2 border-primary',
              )}
              onClick={() => props.onSelectSession(session.sessionId)}
            >
              <div class="flex-shrink-0 text-neutral">
                {getSessionIcon(session.agentType)}
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-white truncate">
                    {getAgentLabel(session.agentType)}
                  </span>
                  <Show when={session.thinking}>
                    <span class="flex items-center gap-1 text-xs text-primary">
                      <span class="animate-pulse">●</span>
                      thinking
                    </span>
                  </Show>
                </div>
                <span class="text-xs text-neutral truncate block">
                  {session.projectPath}
                </span>
              </div>

              {/* Unread indicator */}
              <Show
                when={
                  props.unreadCounts?.[session.sessionId] &&
                  props.unreadCounts[session.sessionId] > 0 &&
                  session.sessionId !== props.activeSessionId
                }
              >
                <span class="flex-shrink-0 w-5 h-5 flex items-center justify-center text-xs font-medium bg-primary text-white rounded-full">
                  {props.unreadCounts![session.sessionId]}
                </span>
              </Show>

              {/* Delete button */}
              <Show when={props.onDeleteSession}>
                <button
                  class="flex-shrink-0 p-1 text-neutral hover:text-error-content opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onDeleteSession?.(session.sessionId)
                  }}
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Footer */}
      <div class="p-3 border-t border-base-300">
        <div class="text-xs text-neutral text-center">
          Irogen Web Terminal
        </div>
      </div>
    </div>
  )
}
