/**
 * PermissionCard Component
 *
 * Displays a permission request from the agent
 */

import { createSignal, Show } from 'solid-js'
import { Shield, Check, X } from 'lucide-solid'
import { cn } from '~/lib/utils'
import type { PermissionRequest } from '../types'

interface PermissionCardProps {
  permission: PermissionRequest
  onRespond: (requestId: string, approved: boolean, reason?: string) => Promise<void>
}

export function PermissionCard(props: PermissionCardProps) {
  const [isResponding, setIsResponding] = createSignal(false)
  const [reason, setReason] = createSignal('')
  const [showReasonInput, setShowReasonInput] = createSignal(false)

  const handleRespond = async (approved: boolean) => {
    setIsResponding(true)
    try {
      await props.onRespond(
        props.permission.id,
        approved,
        approved ? undefined : reason() || undefined
      )
    } finally {
      setIsResponding(false)
    }
  }

  const isPending = () => props.permission.status === 'pending'

  return (
    <div class="my-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
      {/* Header */}
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
          <Shield class="w-5 h-5 text-amber-400" />
        </div>

        <div class="flex-1 min-w-0">
          {/* Title */}
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-medium text-amber-400">
              Permission Request
            </span>
            <Show when={!isPending()}>
              <span
                class={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  props.permission.status === 'approved'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-red-500/20 text-red-400'
                )}
              >
                {props.permission.status}
              </span>
            </Show>
          </div>

          {/* Tool Name */}
          <div class="text-white font-medium mb-2">
            {props.permission.toolName}
          </div>

          {/* Description */}
          <div class="text-sm text-slate-300 mb-3">
            {props.permission.description}
          </div>

          {/* Tool Params (collapsible) */}
          <Show when={props.permission.toolParams}>
            <details class="mb-3">
              <summary class="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
                View parameters
              </summary>
              <pre class="mt-2 p-2 bg-slate-900 rounded text-xs text-slate-300 overflow-x-auto">
                {JSON.stringify(props.permission.toolParams, null, 2)}
              </pre>
            </details>
          </Show>

          {/* Reason Input */}
          <Show when={showReasonInput()}>
            <div class="mb-3">
              <textarea
                value={reason()}
                onInput={(e) => setReason(e.currentTarget.value)}
                placeholder="Enter reason for denial..."
                class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                rows={2}
              />
            </div>
          </Show>

          {/* Actions */}
          <Show when={isPending()}>
            <div class="flex items-center gap-2">
              <button
                onClick={() => handleRespond(true)}
                disabled={isResponding()}
                class="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Check class="w-4 h-4" />
                Allow
              </button>

              <Show when={!showReasonInput()}>
                <button
                  onClick={() => setShowReasonInput(true)}
                  disabled={isResponding()}
                  class="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <X class="w-4 h-4" />
                  Deny
                </button>
              </Show>

              <Show when={showReasonInput()}>
                <button
                  onClick={() => handleRespond(false)}
                  disabled={isResponding() || !reason().trim()}
                  class="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <X class="w-4 h-4" />
                  Deny with reason
                </button>

                <button
                  onClick={() => {
                    setShowReasonInput(false)
                    setReason('')
                  }}
                  class="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
