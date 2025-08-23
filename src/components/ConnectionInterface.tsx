import { createSignal, Show, For, createEffect } from "solid-js";
import { settingsStore, t } from "../stores/settingsStore";
import { HistoryEntry } from "../hooks/useConnectionHistory";
import {
  EnhancedCard,
  EnhancedButton,
  EnhancedInput,
  SwipeGesture,
  PullToRefresh,
} from "./ui/EnhancedComponents";

interface ConnectionInterfaceProps {
  sessionTicket: string;
  onTicketInput: (value: string) => void;
  onConnect: (ticket?: string) => void;
  connecting: boolean;
  connectionError: string | null;
  history: HistoryEntry[];
  isConnected: boolean;
  activeTicket: string | null;
  onReturnToSession: () => void;
  onDeleteHistory: (ticket: string) => void;
  onDisconnect: () => void;
  onQuickConnect: (ticket: string) => void;
}

export function ConnectionInterface(props: ConnectionInterfaceProps) {
  const [viewMode, setViewMode] = createSignal<"quick" | "manual" | "qr">(
    "quick",
  );
  const [showAdvanced, setShowAdvanced] = createSignal(false);
  const [ticketError, setTicketError] = createSignal<string | null>(null);

  // QR Code scanner state
  const [scanningQR, setScanningQR] = createSignal(false);

  // Validate session ticket format
  const validateTicket = (ticket: string): boolean => {
    // Basic validation for iroh session ticket format
    if (!ticket.trim()) return false;
    if (ticket.length < 10) return false;
    // Add more specific validation if needed
    return true;
  };

  const handleTicketInput = (value: string) => {
    props.onTicketInput(value);
    if (ticketError()) {
      setTicketError(null);
    }
  };

  const handleConnect = () => {
    if (!validateTicket(props.sessionTicket)) {
      setTicketError("Please enter a valid session ticket");
      return;
    }
    setTicketError(null);
    props.onConnect();
  };

  const handleScanQR = async () => {
    setScanningQR(true);
    try {
      // Implement QR code scanning with Tauri plugin
      // const result = await invoke("scan_qr_code");
      // props.onTicketInput(result);
      // For now, simulate QR scan
      setTimeout(() => {
        setScanningQR(false);
        // Simulate scanned ticket
        props.onTicketInput("demo-scanned-ticket-12345");
      }, 2000);
    } catch (error) {
      console.error("QR scan failed:", error);
      setScanningQR(false);
    }
  };

  const formatConnectionTime = (timestamp: string | number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  const getConnectionStatusIcon = (entry: HistoryEntry) => {
    if (props.activeTicket === entry.ticket) return "🟢";
    switch (entry.status) {
      case "Completed":
        return "✅";
      case "Failed":
        return "❌";
      case "Active":
        return "🟡";
      default:
        return "⚪";
    }
  };

  const refreshConnections = async () => {
    // Simulate refreshing connection history
    await new Promise((resolve) => setTimeout(resolve, 1000));
  };

  return (
    <div class="flex flex-col space-y-6 p-4 max-w-2xl mx-auto">
      {/* Active Session Banner */}
      <Show when={props.isConnected}>
        <EnhancedCard
          variant="featured"
          icon="🚀"
          title="Session Active"
          subtitle={`Connected to ${props.activeTicket?.substring(0, 8)}...`}
          status="success"
          actions={
            <div class="flex space-x-2">
              <EnhancedButton
                variant="primary"
                size="sm"
                onClick={props.onReturnToSession}
                icon="💻"
              >
                Open Terminal
              </EnhancedButton>
              <EnhancedButton
                variant="error"
                size="sm"
                onClick={props.onDisconnect}
                icon="🔌"
              >
                Disconnect
              </EnhancedButton>
            </div>
          }
        >
          <div class="text-sm opacity-70">
            Tap "Open Terminal" to return to your active session
          </div>
        </EnhancedCard>
      </Show>

      {/* Connection Methods */}
      <Show when={!props.isConnected}>
        <EnhancedCard title="Connect to Terminal" icon="🔗" class="mb-6">
          {/* Method Selection */}
          <div class="tabs tabs-boxed mb-6">
            <button
              class={`tab ${viewMode() === "quick" ? "tab-active" : ""}`}
              onClick={() => setViewMode("quick")}
            >
              🚀 Quick
            </button>
            <button
              class={`tab ${viewMode() === "manual" ? "tab-active" : ""}`}
              onClick={() => setViewMode("manual")}
            >
              ⌨️ Manual
            </button>
            <button
              class={`tab ${viewMode() === "qr" ? "tab-active" : ""}`}
              onClick={() => setViewMode("qr")}
            >
              📷 QR Code
            </button>
          </div>

          {/* Quick Connect Mode */}
          <Show when={viewMode() === "quick"}>
            <div class="space-y-4">
              <div class="text-sm opacity-70 mb-4">
                Select from recent connections or use manual entry
              </div>

              <Show when={props.history.length > 0}>
                <PullToRefresh onRefresh={refreshConnections}>
                  <div class="space-y-2 max-h-60 overflow-y-auto">
                    <For each={props.history.slice(0, 5)}>
                      {(entry) => (
                        <SwipeGesture
                          onSwipeLeft={() =>
                            props.onDeleteHistory(entry.ticket)
                          }
                          onSwipeRight={() =>
                            props.onQuickConnect(entry.ticket)
                          }
                        >
                          <div class="flex items-center justify-between p-3 bg-base-200 rounded-lg hover:bg-base-300 transition-colors">
                            <div class="flex items-center space-x-3 flex-1 min-w-0">
                              <span class="text-lg">
                                {getConnectionStatusIcon(entry)}
                              </span>
                              <div class="flex-1 min-w-0">
                                <div class="font-medium truncate">
                                  {entry.title}
                                </div>
                                <div class="text-xs opacity-70 font-mono truncate">
                                  {entry.ticket.substring(0, 16)}...
                                </div>
                                <div class="text-xs opacity-50">
                                  {formatConnectionTime(entry.timestamp)}
                                </div>
                              </div>
                            </div>
                            <div class="flex space-x-2">
                              <EnhancedButton
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  props.onQuickConnect(entry.ticket)
                                }
                                disabled={props.connecting}
                                haptic
                              >
                                Connect
                              </EnhancedButton>
                            </div>
                          </div>
                        </SwipeGesture>
                      )}
                    </For>
                  </div>
                </PullToRefresh>
              </Show>

              <Show when={props.history.length === 0}>
                <div class="text-center py-8 opacity-50">
                  <div class="text-4xl mb-2">📭</div>
                  <div class="text-sm">No recent connections</div>
                  <div class="text-xs mt-1">Try manual entry or QR scan</div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Manual Entry Mode */}
          <Show when={viewMode() === "manual"}>
            <div class="space-y-4">
              <EnhancedInput
                value={props.sessionTicket}
                onInput={handleTicketInput}
                placeholder="Enter session ticket..."
                label="Session Ticket"
                icon="🎫"
                error={ticketError() || props.connectionError || undefined}
                onEnter={handleConnect}
                autoFocus
              />

              <div class="flex space-x-2">
                <EnhancedButton
                  variant="primary"
                  fullWidth
                  loading={props.connecting}
                  disabled={!props.sessionTicket.trim()}
                  onClick={handleConnect}
                  icon="🚀"
                  haptic
                >
                  {props.connecting ? "Connecting..." : "Connect"}
                </EnhancedButton>
              </div>

              <button
                class="btn btn-ghost btn-sm w-full"
                onClick={() => setShowAdvanced(!showAdvanced())}
              >
                {showAdvanced() ? "Hide" : "Show"} Advanced Options
              </button>

              <Show when={showAdvanced()}>
                <div class="bg-base-200 p-4 rounded-lg space-y-3">
                  <div class="text-sm font-medium">Connection Options</div>

                  <div class="form-control">
                    <label class="label cursor-pointer">
                      <span class="label-text">Auto-reconnect</span>
                      <input
                        type="checkbox"
                        class="toggle toggle-primary"
                        checked
                      />
                    </label>
                  </div>

                  <div class="form-control">
                    <label class="label cursor-pointer">
                      <span class="label-text">Save to history</span>
                      <input
                        type="checkbox"
                        class="toggle toggle-primary"
                        checked
                      />
                    </label>
                  </div>

                  <div class="form-control">
                    <label class="label">
                      <span class="label-text">
                        Connection timeout (seconds)
                      </span>
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="30"
                      value="10"
                      class="range range-primary"
                    />
                    <div class="text-xs opacity-70 mt-1">10 seconds</div>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* QR Code Mode */}
          <Show when={viewMode() === "qr"}>
            <div class="space-y-4 text-center">
              <div class="text-sm opacity-70 mb-4">
                Scan QR code from host terminal
              </div>

              <Show
                when={!scanningQR()}
                fallback={
                  <div class="flex flex-col items-center space-y-4 py-8">
                    <div class="w-32 h-32 bg-base-200 rounded-lg flex items-center justify-center">
                      <span class="loading loading-spinner loading-lg"></span>
                    </div>
                    <div class="text-sm">Scanning for QR code...</div>
                    <EnhancedButton
                      variant="ghost"
                      onClick={() => setScanningQR(false)}
                    >
                      Cancel
                    </EnhancedButton>
                  </div>
                }
              >
                <div class="flex flex-col items-center space-y-4 py-8">
                  <div class="w-32 h-32 bg-base-200 rounded-lg flex items-center justify-center text-4xl">
                    📷
                  </div>
                  <EnhancedButton
                    variant="primary"
                    size="lg"
                    onClick={handleScanQR}
                    icon="📱"
                    haptic
                  >
                    Start Camera
                  </EnhancedButton>
                  <div class="text-xs opacity-50 max-w-xs">
                    Point your camera at the QR code displayed on the host
                    terminal
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </EnhancedCard>
      </Show>

      {/* Help Card */}
      <EnhancedCard variant="minimal" title="Need Help?" icon="💡">
        <div class="space-y-2 text-sm opacity-70">
          <div>
            • <strong>Session tickets</strong> are provided by the host terminal
          </div>
          <div>
            • <strong>QR codes</strong> can be scanned from the host screen
          </div>
          <div>
            • <strong>Swipe left</strong> on history items to delete them
          </div>
          <div>
            • <strong>Pull down</strong> to refresh connection history
          </div>
        </div>
      </EnhancedCard>
    </div>
  );
}

