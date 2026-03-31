/**
 * ToolCallDisplay Component
 *
 * Displays tool call status and results
 */

import { Show } from 'solid-js'
import { Wrench, CheckCircle, XCircle, Loader, ChevronDown } from 'lucide-solid'
import { cn } from '~/lib/utils'

interface ToolCall {
  id: string
  toolName: string
  status: 'started' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  input?: unknown
  output?: string
  timestamp: number
}

interface ToolCallDisplayProps {
  toolCall: ToolCall
  expanded?: boolean
  onToggleExpand?: () => void
}

export function ToolCallDisplay(props: ToolCallDisplayProps) {
  const getStatusIcon = () => {
    switch (props.toolCall.status) {
      case 'started':
      case 'in_progress':
        return <Loader class="w-4 h-4 text-warning-content animate-spin" />
      case 'completed':
        return <CheckCircle class="w-4 h-4 text-success-content" />
      case 'failed':
      case 'cancelled':
        return <XCircle class="w-4 h-4 text-error-content" />
      default:
        return <Wrench class="w-4 h-4 text-neutral" />
    }
  }

  const getStatusColor = () => {
    switch (props.toolCall.status) {
      case 'started':
      case 'in_progress':
        return 'border-warning/30 bg-warning/5'
      case 'completed':
        return 'border-success/30 bg-success/5'
      case 'failed':
      case 'cancelled':
        return 'border-error/30 bg-error/5'
      default:
        return 'border-base-300 bg-base-200'
    }
  }

  return (
    <div class={cn('border rounded-lg overflow-hidden', getStatusColor())}>
      {/* Header */}
      <div
        class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5"
        onClick={props.onToggleExpand}
      >
        {getStatusIcon()}
        <span class="flex-1 text-sm font-medium text-white">
          {props.toolCall.toolName}
        </span>
        <span class="text-xs text-neutral uppercase">
          {props.toolCall.status}
        </span>
        <ChevronDown
          class={cn(
            'w-4 h-4 text-slate-400 transition-transform',
            props.expanded && 'rotate-180',
          )}
        />
      </div>

      {/* Expanded Content */}
      <Show when={props.expanded}>
        <div class="border-t border-base-300">
          {/* Input */}
          <Show when={props.toolCall.input}>
            <div class="p-3 border-b border-base-300">
              <div class="text-xs text-neutral mb-1">Input</div>
              <pre class="text-xs text-base-content overflow-x-auto">
                {JSON.stringify(props.toolCall.input, null, 2)}
              </pre>
            </div>
          </Show>

          {/* Output */}
          <Show when={props.toolCall.output}>
            <div class="p-3">
              <div class="text-xs text-neutral mb-1">Output</div>
              <pre class="text-xs text-base-content overflow-x-auto whitespace-pre-wrap">
                {props.toolCall.output}
              </pre>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
