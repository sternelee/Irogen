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
  onRespond: (
    requestId: string,
    approved: boolean,
    reason?: string,
  ) => Promise<void>
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
        approved ? undefined : reason() || undefined,
      )
    } finally {
      setIsResponding(false)
    }
  }

  const isPending = () => props.permission.status === 'pending'

  return (
    <div class="my-4 bg-warning/10 border border-warning/20 rounded-xl p-4">
      {/* Header */}
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center flex-shrink-0">
          <Shield class="w-5 h-5 text-warning-content" />
        </div>

        <div class="flex-1 min-w-0">
          {/* Title */}
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-medium text-warning-content">
              Permission Request
            </span>
            <Show when={!isPending()}>
              <span
                class={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  props.permission.status === 'approved'
                    ? 'bg-success/20 text-success-content'
                    : 'bg-error/20 text-error-content',
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
          <div class="text-sm text-base-content mb-3">
            {props.permission.description}
          </div>

          {/* Tool Params (collapsible) */}
          <Show when={props.permission.toolParams}>
            <details class="mb-3">
              <summary class="text-xs text-neutral cursor-pointer hover:text-base-content">
                View parameters
              </summary>
              <pre class="mt-2 p-2 bg-base-100 rounded text-xs text-base-content overflow-x-auto">
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
                class="w-full px-3 py-2 bg-base-100 border border-base-300 rounded-lg text-white placeholder-base-content/50 text-sm focus:outline-none focus:ring-2 focus:ring-warning"
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
                class="flex items-center gap-1.5 px-3 py-1.5 bg-success hover:bg-success/90 disabled:bg-base-300 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Check class="w-4 h-4" />
                Allow
              </button>

              <Show when={!showReasonInput()}>
                <button
                  onClick={() => setShowReasonInput(true)}
                  disabled={isResponding()}
                  class="flex items-center gap-1.5 px-3 py-1.5 bg-error hover:bg-error/90 disabled:bg-base-300 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <X class="w-4 h-4" />
                  Deny
                </button>
              </Show>

              <Show when={showReasonInput()}>
                <button
                  onClick={() => handleRespond(false)}
                  disabled={isResponding() || !reason().trim()}
                  class="flex items-center gap-1.5 px-3 py-1.5 bg-error hover:bg-error/90 disabled:bg-base-300 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <X class="w-4 h-4" />
                  Deny with reason
                </button>

                <button
                  onClick={() => {
                    setShowReasonInput(false)
                    setReason('')
                  }}
                  class="px-3 py-1.5 bg-base-300 hover:bg-base-200 text-white text-sm rounded-lg transition-colors"
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
