/**
 * MessageBubble Component
 *
 * Displays a single message in the chat
 */

import { Show, For } from 'solid-js'
import { User, Bot, Loader } from 'lucide-solid'
import { cn } from '~/lib/utils'
import type { ChatMessage } from '../types'

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
  toolStatus?: Record<
    string,
    { toolName: string; status: string; output?: string }
  >
}

export function MessageBubble(props: MessageBubbleProps) {
  const isUser = () => props.message.role === 'user'

  return (
    <div
      class={cn('flex gap-3 py-4', !isUser() && 'bg-base-200/30 -mx-4 px-4')}
    >
      {/* Avatar */}
      <div
        class={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          isUser() ? 'bg-base-300' : 'bg-primary/10',
        )}
      >
        <Show when={isUser()} fallback={<Bot class="w-4 h-4 text-primary" />}>
          <User class="w-4 h-4 text-base-content" />
        </Show>
      </div>

      {/* Content */}
      <div class="flex-1 min-w-0">
        {/* Role Label */}
        <div class="flex items-center gap-2 mb-1">
          <span class="text-sm font-medium text-base-content">
            {isUser() ? 'You' : 'Assistant'}
          </span>
          <Show when={props.isStreaming}>
            <Loader class="w-3 h-3 text-primary animate-spin" />
          </Show>
        </div>

        {/* Message Content */}
        <div class="text-base-content whitespace-pre-wrap break-words">
          {props.message.content}
          <Show when={props.isStreaming}>
            <span class="inline-block w-2 h-4 ml-1 bg-primary animate-pulse" />
          </Show>
        </div>

        {/* Tool Calls */}
        <Show
          when={props.message.toolCalls && props.message.toolCalls.length > 0}
        >
          <div class="mt-3 space-y-2">
            <For each={props.message.toolCalls}>
              {(toolCall) => (
                <div class="flex items-center gap-2 text-sm bg-base-200 rounded-lg px-3 py-2">
                  <span class="text-primary">{toolCall.toolName}</span>
                  <span
                    class={cn(
                      'text-xs',
                      toolCall.status === 'completed' && 'text-success-content',
                      toolCall.status === 'failed' && 'text-error-content',
                      toolCall.status === 'started' && 'text-warning-content',
                    )}
                  >
                    {toolCall.status}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Attachments */}
        <Show
          when={
            props.message.attachments && props.message.attachments.length > 0
          }
        >
          <div class="mt-2 flex flex-wrap gap-2">
            <For each={props.message.attachments}>
              {(attachment) => (
                <div class="flex items-center gap-2 text-xs bg-base-200 rounded px-2 py-1 text-base-content">
                  <span>📎</span>
                  <span>{attachment.filename}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
