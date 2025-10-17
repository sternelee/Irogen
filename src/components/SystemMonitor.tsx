import { createSignal, createEffect, onMount, Show, onCleanup } from "solid-js";
import { createMessageHandler } from "../utils/messageHandler";
import { createApiClient } from "../utils/api";
import { SystemEvent } from "../types/messages";

interface TerminalStats {
  total: number;
  running: number;
  errors: number;
  stopped: number;
}

interface PortForwardStats {
  total: number;
  active: number;
  errors: number;
  stopped: number;
  // New fields from enhanced stats
  activeServices: number;
  totalServicesCreated: number;
  totalConnections: number;
  totalBytesTransferred: number;
}

interface SystemStatsResponse {
  terminal_stats: {
    active_terminals: number;
    total_terminals_created: number;
    total_commands_executed: number;
    average_session_duration: number;
  };
  port_forward_stats: PortForwardStats;
  node_id: string;
  timestamp: number;
}

export function SystemMonitor(props: {
  sessionId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = createSignal(false);
  const [lastUpdate, setLastUpdate] = createSignal<Date | null>(null);
  const [nodeInfo, setNodeInfo] = createSignal<string>("");

  const [terminalStats, setTerminalStats] = createSignal<TerminalStats>({
    total: 0,
    running: 0,
    errors: 0,
    stopped: 0,
  });

  const [portForwardStats, setPortForwardStats] = createSignal<PortForwardStats>({
    total: 0,
    active: 0,
    errors: 0,
    stopped: 0,
    activeServices: 0,
    totalServicesCreated: 0,
    totalConnections: 0,
    totalBytesTransferred: 0,
  });

  // Message handler for real-time stats
  let messageHandler: ReturnType<typeof createMessageHandler> | null = null;
  let apiClient: ReturnType<typeof createApiClient> | null = null;

  // Load stats on mount and set up auto-refresh
  onMount(() => {
    apiClient = createApiClient(props.sessionId);

    // Setup message handler for real-time updates
    messageHandler = createMessageHandler(props.sessionId, {
      onSystemEvent: handleSystemEvent,
      onError: (error) => {
        console.error("System monitor message handler error:", error);
      }
    });

    messageHandler.startListening().then(() => {
      console.log("System monitor message handler started");
    });

    // Initial stats load
    loadStats();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      loadStats();
    }, 30000);

    onCleanup(() => {
      clearInterval(interval);
      if (messageHandler) {
        messageHandler.stopListening();
      }
    });
  });

  const loadStats = async () => {
    if (!apiClient) return;

    setLoading(true);
    try {
      const response = await apiClient.getSystemStats();
      if (!response.success) {
        throw new Error(response.error || "Failed to get system stats");
      }
      // Stats will be received via system events
    } catch (error) {
      console.error("Failed to load system stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSystemEvent = (event: SystemEvent) => {
    if (event.type === "stats_response") {
      const data = event.data;

      console.log("Received system stats:", data);

      setNodeInfo(data.node_id);
      setLastUpdate(new Date(data.timestamp));

      // Update terminal stats
      setTerminalStats(prev => ({
        total: data.terminal_stats.total_terminals_created,
        running: data.terminal_stats.active_terminals,
        errors: 0, // Error tracking could be added later
        stopped: Math.max(0, data.terminal_stats.total_terminals_created - data.terminal_stats.active_terminals),
      }));

      // Update port forward stats (unified for TCP + WebShare)
      setPortForwardStats(prev => ({
        total: data.port_forward_stats.totalServicesCreated,
        active: data.port_forward_stats.activeServices,
        errors: 0, // Error tracking could be added later
        stopped: Math.max(0, data.port_forward_stats.totalServicesCreated - data.port_forward_stats.activeServices),
        activeServices: data.port_forward_stats.activeServices,
        totalServicesCreated: data.port_forward_stats.totalServicesCreated,
        totalConnections: data.port_forward_stats.total_connections,
        totalBytesTransferred: data.port_forward_stats.total_bytes_transferred,
      }));
    }
  };

  const getStatPercentage = (count: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((count / total) * 100);
  };

  const getStatusColor = (type: string, status: string) => {
    if (type === "terminal") {
      switch (status) {
        case "running": return "bg-green-500";
        case "stopped": return "bg-gray-400";
        case "errors": return "bg-red-500";
        default: return "bg-gray-300";
      }
    } else if (type === "portforward") {
      switch (status) {
        case "active": return "bg-green-500";
        case "stopped": return "bg-gray-400";
        case "errors": return "bg-red-500";
        default: return "bg-gray-300";
      }
    } else {
      switch (status) {
        case "active": return "bg-green-500";
        case "stopped": return "bg-gray-400";
        case "errors": return "bg-red-500";
        default: return "bg-gray-300";
      }
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) return `${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div class="bg-purple-800 text-white p-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center">
              <span class="text-white font-bold">📊</span>
            </div>
            <h2 class="text-xl font-semibold">System Monitor</h2>
            <span class="text-sm text-gray-300">Session: {props.sessionId.slice(0, 8)}...</span>
          </div>
          <div class="flex items-center space-x-2">
            <button
              onClick={loadStats}
              disabled={loading()}
              class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
            >
              {loading() ? "Loading..." : "Refresh"}
            </button>
            <button
              onClick={props.onClose}
              class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-6">
          {/* Node Information */}
          <div class="bg-gray-50 rounded-lg p-4 mb-6">
            <h3 class="text-lg font-semibold mb-2">Remote Node Information</h3>
            <div class="text-sm text-gray-600">
              <div>Node ID: {nodeInfo() || "Loading..."}</div>
              <div>
                Last Update:{" "}
                {lastUpdate() ? formatTimeAgo(lastUpdate()) : "Never"}
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Terminal Stats */}
            <div class="bg-white border rounded-lg p-4 shadow-sm">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-semibold">Terminal Statistics</h3>
                <div class="text-2xl">💻</div>
              </div>

              <div class="space-y-3">
                <div class="flex justify-between items-center">
                  <span class="text-sm text-gray-600">Total Terminals</span>
                  <span class="font-semibold">{terminalStats().total}</span>
                </div>

                {/* Progress bars for terminal stats */}
                <div class="space-y-2">
                  <div>
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm text-green-600">Running</span>
                      <span class="text-sm">{terminalStats().running}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div
                        class={`h-2 rounded-full transition-all duration-300 ${getStatusColor("terminal", "running")}`}
                        style={`width: ${getStatPercentage(terminalStats().running, terminalStats().total)}%`}
                      />
                    </div>
                  </div>

                  <div>
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm text-gray-600">Stopped</span>
                      <span class="text-sm">{terminalStats().stopped}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div
                        class={`h-2 rounded-full transition-all duration-300 ${getStatusColor("terminal", "stopped")}`}
                        style={`width: ${getStatPercentage(terminalStats().stopped, terminalStats().total)}%`}
                      />
                    </div>
                  </div>

                  <div>
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm text-red-600">Errors</span>
                      <span class="text-sm">{terminalStats().errors}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div
                        class={`h-2 rounded-full transition-all duration-300 ${getStatusColor("terminal", "errors")}`}
                        style={`width: ${getStatPercentage(terminalStats().errors, terminalStats().total)}%`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Port Forward Statistics (Unified for TCP + WebShare) */}
            <div class="bg-white border rounded-lg p-4 shadow-sm">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-semibold">Port Forward Services</h3>
                <div class="text-2xl">🔌</div>
              </div>

              <div class="space-y-3">
                <div class="flex justify-between items-center">
                  <span class="text-sm text-gray-600">Total Services</span>
                  <span class="font-semibold">{portForwardStats().total}</span>
                </div>

                <div class="flex justify-between items-center">
                  <span class="text-sm text-gray-600">Active Services</span>
                  <span class="font-semibold text-green-600">{portForwardStats().activeServices}</span>
                </div>

                <div class="flex justify-between items-center">
                  <span class="text-sm text-gray-600">Total Connections</span>
                  <span class="font-semibold">{portForwardStats().totalConnections}</span>
                </div>

                <div class="flex justify-between items-center">
                  <span class="text-sm text-gray-600">Data Transferred</span>
                  <span class="font-semibold">{formatBytes(portForwardStats().totalBytesTransferred)}</span>
                </div>

                {/* Progress bars for service stats */}
                <div class="space-y-2">
                  <div>
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm text-green-600">Active</span>
                      <span class="text-sm">{portForwardStats().active}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div
                        class={`h-2 rounded-full transition-all duration-300 ${getStatusColor("portforward", "active")}`}
                        style={`width: ${getStatPercentage(portForwardStats().active, portForwardStats().total)}%`}
                      />
                    </div>
                  </div>

                  <div>
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm text-gray-600">Stopped</span>
                      <span class="text-sm">{portForwardStats().stopped}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div
                        class={`h-2 rounded-full transition-all duration-300 ${getStatusColor("portforward", "stopped")}`}
                        style={`width: ${getStatPercentage(portForwardStats().stopped, portForwardStats().total)}%`}
                      />
                    </div>
                  </div>

                  <div>
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm text-red-600">Errors</span>
                      <span class="text-sm">{portForwardStats().errors}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                      <div
                        class={`h-2 rounded-full transition-all duration-300 ${getStatusColor("portforward", "errors")}`}
                        style={`width: ${getStatPercentage(portForwardStats().errors, portForwardStats().total)}%`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Additional Information */}
          <div class="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="text-sm text-blue-800">
              <div class="font-semibold mb-2">💡 System Information:</div>
              <div class="space-y-1">
                <div>• Terminal statistics show the current state of all managed terminals</div>
                <div>• Port Forward services display unified TCP and HTTP forwarding services</div>
                <div>• Data updates automatically every 30 seconds with real-time events</div>
                <div>• Click refresh to manually update the statistics</div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div class="bg-gray-100 p-3 border-t text-sm text-gray-600 text-center">
          <div>Monitoring: {props.sessionId}</div>
          <div class="text-xs text-gray-500 mt-1">
            📊 Real-time system statistics for remote terminal management
          </div>
        </div>
      </div>
    </div>
  );
}