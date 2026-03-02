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
        <div class="bg-slate-800 rounded-xl border border-slate-700 p-6">
          {/* Header */}
          <div class="flex items-center justify-center mb-6">
            <div class="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center">
              <Wifi class="w-6 h-6 text-cyan-400" />
            </div>
          </div>

          <h2 class="text-xl font-semibold text-center text-white mb-2">
            Connect to Remote Agent
          </h2>
          <p class="text-sm text-slate-400 text-center mb-6">
            Enter the session ticket from your CLI host to connect
          </p>

          {/* Error Message */}
          <Show when={props.error}>
            <div class="flex items-center gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle class="w-4 h-4 text-red-400 flex-shrink-0" />
              <span class="text-sm text-red-400">{props.error}</span>
            </div>
          </Show>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div class="mb-4">
              <label class="block text-sm font-medium text-slate-300 mb-2">
                Session Ticket
              </label>
              <input
                type="text"
                value={ticket()}
                onInput={(e) => setTicket(e.currentTarget.value)}
                placeholder="Paste ticket or scan QR code..."
                disabled={props.isConnecting}
                class="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            <div class="flex gap-3">
              <button
                type="submit"
                disabled={!ticket().trim() || props.isConnecting}
                class="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                <Show when={props.isConnecting} fallback={<Wifi class="w-4 h-4" />}>
                  <Loader2 class="w-4 h-4 animate-spin" />
                </Show>
                <Show when={props.isConnecting} fallback="Connect">
                  Connecting...
                </Show>
              </button>

              <button
                type="button"
                class="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                title="Scan QR Code (coming soon)"
              >
                <QrCode class="w-4 h-4" />
              </button>
            </div>
          </form>

          {/* Instructions */}
          <div class="mt-6 pt-6 border-t border-slate-700">
            <h3 class="text-sm font-medium text-slate-300 mb-3">
              How to get a session ticket:
            </h3>
            <ol class="text-sm text-slate-400 space-y-2">
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-xs">
                  1
                </span>
                <span>Run <code class="px-1.5 py-0.5 bg-slate-900 rounded text-cyan-400">clawdpilot host</code> on your machine</span>
              </li>
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-xs">
                  2
                </span>
                <span>Copy the displayed session ticket or scan QR code</span>
              </li>
              <li class="flex gap-2">
                <span class="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-xs">
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
