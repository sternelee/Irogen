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
        return <Loader class="w-4 h-4 text-yellow-400 animate-spin" />
      case 'completed':
        return <CheckCircle class="w-4 h-4 text-green-400" />
      case 'failed':
      case 'cancelled':
        return <XCircle class="w-4 h-4 text-red-400" />
      default:
        return <Wrench class="w-4 h-4 text-slate-400" />
    }
  }

  const getStatusColor = () => {
    switch (props.toolCall.status) {
      case 'started':
      case 'in_progress':
        return 'border-yellow-500/30 bg-yellow-500/5'
      case 'completed':
        return 'border-green-500/30 bg-green-500/5'
      case 'failed':
      case 'cancelled':
        return 'border-red-500/30 bg-red-500/5'
      default:
        return 'border-slate-600 bg-slate-800'
    }
  }

  return (
    <div
      class={cn(
        'border rounded-lg overflow-hidden',
        getStatusColor()
      )}
    >
      {/* Header */}
      <div
        class="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/5"
        onClick={props.onToggleExpand}
      >
        {getStatusIcon()}
        <span class="flex-1 text-sm font-medium text-white">
          {props.toolCall.toolName}
        </span>
        <span class="text-xs text-slate-400 uppercase">
          {props.toolCall.status}
        </span>
        <ChevronDown
          class={cn(
            'w-4 h-4 text-slate-400 transition-transform',
            props.expanded && 'rotate-180'
          )}
        />
      </div>

      {/* Expanded Content */}
      <Show when={props.expanded}>
        <div class="border-t border-slate-700">
          {/* Input */}
          <Show when={props.toolCall.input}>
            <div class="p-3 border-b border-slate-700">
              <div class="text-xs text-slate-400 mb-1">Input</div>
              <pre class="text-xs text-slate-300 overflow-x-auto">
                {JSON.stringify(props.toolCall.input, null, 2)}
              </pre>
            </div>
          </Show>

          {/* Output */}
          <Show when={props.toolCall.output}>
            <div class="p-3">
              <div class="text-xs text-slate-400 mb-1">Output</div>
              <pre class="text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">
                {props.toolCall.output}
              </pre>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
