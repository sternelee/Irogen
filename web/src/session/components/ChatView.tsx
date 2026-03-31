/**
 * ChatView Component
 *
 * Main chat interface for agent conversation
 */

import { createEffect, For, Show } from 'solid-js'
import { Bot, Loader } from 'lucide-solid'
import type { ChatMessage, PermissionRequest } from '../types'
import { ChatInput } from './ChatInput'
import { MessageBubble } from './MessageBubble'
import { PermissionCard } from './PermissionCard'

interface ChatViewProps {
  sessionId: string
  messages: ChatMessage[]
  streamingContent: string
  isStreaming: boolean
  pendingPermissions: PermissionRequest[]
  thinking: boolean
  toolStatus?: Record<
    string,
    { toolName: string; status: string; output?: string }
  >
  onSendMessage: (content: string) => Promise<void>
  onPermissionResponse: (
    requestId: string,
    approved: boolean,
    reason?: string,
  ) => Promise<void>
  onInterrupt: () => Promise<void>
}

export function ChatView(props: ChatViewProps) {
  let messagesEndRef: HTMLDivElement | undefined

  // Auto-scroll to bottom
  createEffect(() => {
    props.messages.length
    props.streamingContent
    props.thinking
    if (messagesEndRef) {
      messagesEndRef.scrollIntoView({ behavior: 'smooth' })
    }
  })

  return (
    <div class="flex flex-col h-full">
      {/* Messages Area */}
      <div class="flex-1 overflow-y-auto">
        <div class="max-w-4xl mx-auto px-4 py-6">
          {/* Empty State */}
          <Show when={props.messages.length === 0 && !props.isStreaming}>
            <div class="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Bot class="w-8 h-8 text-primary" />
              </div>
              <h2 class="text-xl font-semibold text-white mb-2">
                Start a conversation
              </h2>
              <p class="text-neutral max-w-md">
                Send a message to start interacting with the AI agent
              </p>
            </div>
          </Show>

          {/* Messages */}
          <For each={props.messages}>
            {(message) => (
              <MessageBubble message={message} toolStatus={props.toolStatus} />
            )}
          </For>

          {/* Streaming Content */}
          <Show when={props.isStreaming && props.streamingContent}>
            <MessageBubble
              message={{
                id: 'streaming',
                role: 'assistant',
                content: props.streamingContent,
                timestamp: Date.now(),
              }}
              isStreaming={true}
            />
          </Show>

          {/* Thinking Indicator */}
          <Show when={props.thinking && !props.isStreaming}>
            <div class="flex items-start gap-3 py-4">
              <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Loader class="w-4 h-4 text-primary animate-spin" />
              </div>
              <div class="flex items-center gap-2 text-neutral">
                <span>Thinking</span>
                <span class="flex gap-1">
                  <span
                    class="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                    style={{ 'animation-delay': '0ms' }}
                  />
                  <span
                    class="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                    style={{ 'animation-delay': '150ms' }}
                  />
                  <span
                    class="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                    style={{ 'animation-delay': '300ms' }}
                  />
                </span>
              </div>
            </div>
          </Show>

          {/* Pending Permissions */}
          <For each={props.pendingPermissions}>
            {(permission) => (
              <PermissionCard
                permission={permission}
                onRespond={props.onPermissionResponse}
              />
            )}
          </For>

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div class="flex-shrink-0 border-t border-base-300 bg-base-200/50">
        <div class="max-w-4xl mx-auto p-4">
          <ChatInput
            onSend={props.onSendMessage}
            onInterrupt={props.onInterrupt}
            isStreaming={props.isStreaming}
            disabled={props.pendingPermissions.length > 0}
          />
        </div>
      </div>
    </div>
  )
}
