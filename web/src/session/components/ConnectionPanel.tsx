/**
 * ConnectionPanel Component
 *
 * Displays connection form for connecting to remote agent
 */

import { createSignal, Show } from 'solid-js'
import { Wifi, Loader2, QrCode, AlertCircle } from 'lucide-solid'

interface ConnectionPanelProps {
  onConnect: (ticket: string) => Promise<void>
  isConnecting: boolean
  error: string | null
}

export function ConnectionPanel(props: ConnectionPanelProps) {
  const [ticket, setTicket] = createSignal('')

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    const ticketValue = ticket().trim()
    if (!ticketValue) return
    await props.onConnect(ticketValue)
  }

  return (
    <div class="flex items-center justify-center h-full p-6">
      <div class="w-full max-w-md">
        <div class="bg-base-200 rounded-xl border border-base-300 p-6">
          {/* Header */}
          <div class="flex items-center justify-center mb-6">
            <div class="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Wifi class="w-6 h-6 text-primary" />
            </div>
          </div>

          <h2 class="text-xl font-semibold text-center text-white mb-2">
            Connect to Remote Agent
          </h2>
          <p class="text-sm text-neutral text-center mb-6">
            Enter the session ticket from your CLI host to connect
          </p>

          {/* Error Message */}
          <Show when={props.error}>
            <div class="flex items-center gap-2 p-3 mb-4 bg-error/10 border border-error/20 rounded-lg">
              <AlertCircle class="w-4 h-4 text-error-content flex-shrink-0" />
              <span class="text-sm text-error-content">{props.error}</span>
            </div>
          </Show>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div class="mb-4">
              <label class="block text-sm font-medium text-base-content mb-2">
                Session Ticket
              </label>
              <input
                type="text"
                value={ticket()}
                onInput={(e) => setTicket(e.currentTarget.value)}
                placeholder="Paste ticket or scan QR code..."
                disabled={props.isConnecting}
                class="w-full px-4 py-3 bg-base-100 border border-base-300 rounded-lg text-white placeholder-base-content/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
              />
            </div>

            <div class="flex gap-3">
              <button
                type="submit"
                disabled={!ticket().trim() || props.isConnecting}
                class="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/90 disabled:bg-base-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                <Show
                  when={props.isConnecting}
                  fallback={<Wifi class="w-4 h-4" />}
                >
                  <Loader2 class="w-4 h-4 animate-spin" />
                </Show>
                <Show when={props.isConnecting} fallback="Connect">
                  Connecting...
                </Show>
              </button>

              <button
                type="button"
                class="px-4 py-3 bg-base-300 hover:bg-base-200 text-white rounded-lg transition-colors"
                title="Scan QR Code (coming soon)"
              >
                <QrCode class="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* Instructions */}
          <div class="mt-6 pt-6 border-t border-base-300">
            <h3 class="text-sm font-medium text-base-content mb-3">
              How to get a session ticket:
            </h3>
            <ol class="text-sm text-neutral space-y-2">
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-5 h-5 rounded-full bg-base-300 flex items-center justify-center text-xs">
                  1
                </span>
                <span>
                  Run{' '}
                  <code class="px-1.5 py-0.5 bg-base-100 rounded text-primary">
                    clawdpilot host
                  </code>{' '}
                  on your machine
                </span>
              </li>
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-5 h-5 rounded-full bg-base-300 flex items-center justify-center text-xs">
                  2
                </span>
                <span>Copy the displayed session ticket or scan QR code</span>
              </li>
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-5 h-5 rounded-full bg-base-300 flex items-center justify-center text-xs">
                  3
                </span>
                <span>Paste the ticket above and click Connect</span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
