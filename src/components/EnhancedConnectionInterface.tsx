/**
 * Enhanced Connection Interface with new message architecture support
 * Provides better error handling, connection management, and event processing
 */

import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { createConnectionHandler } from "../hooks/useConnection";
import { createMessageHandler } from "../utils/messageHandler";
import { createApiClient } from "../utils/api";
import { invoke } from "@tauri-apps/api/core";
import {
  NetworkMessage,
  StructuredEvent,
  TerminalEvent,
  PortForwardEvent,
  FileTransferEvent,
  SystemEvent,
  MessageDomain
} from "../types/messages";

interface EnhancedConnectionInterfaceProps {
  onConnectionEstablished?: (sessionId: string, nodeTicket?: string) => void;
  onConnectionLost?: (sessionId: string) => void;
  onTerminalEvent?: (event: TerminalEvent) => void;
  onPortForwardEvent?: (event: PortForwardEvent) => void;
  onFileTransferEvent?: (event: FileTransferEvent) => void;
  onSystemEvent?: (event: SystemEvent) => void;
  onError?: (error: Error) => void;
}

export function EnhancedConnectionInterface(props: EnhancedConnectionInterfaceProps) {
  // Connection state
  const [ticket, setTicket] = createSignal("");
  const [connected, setConnected] = createSignal(false);
  const [sessionId, setSessionId] = createSignal<string | null>(null);

  // Enhanced connection handler
  const connectionHandler = createConnectionHandler();

  // Message handlers for different sessions
  const [messageHandlers, setMessageHandlers] = createSignal<Map<string, any>>(new Map());

  // Connection history
  const [connectionHistory, setConnectionHistory] = createSignal<string[]>([]);

  // Real-time stats
  const [connectionStats, setConnectionStats] = createSignal({
    messagesReceived: 0,
    lastMessageTime: 0,
    activeTerminals: 0,
    activePortForwards: 0
  });

  // Error state
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    loadConnectionHistory();
  });

  onCleanup(() => {
    // Cleanup all message handlers
    messageHandlers().forEach(async (handler) => {
      if (handler && handler.isActive()) {
        await handler.stopListening();
      }
    });
  });

  const loadConnectionHistory = async () => {
    try {
      // For now, we'll use localStorage for connection history
      // This could be enhanced with backend storage in the future
      const stored = localStorage.getItem("connectionHistory");
      if (stored) {
        setConnectionHistory(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load connection history:", error);
    }
  };

  const handleConnect = async () => {
    const ticketValue = ticket().trim();
    if (!ticketValue) {
      setError("Please enter a connection ticket");
      return;
    }

    setError(null);

    try {
      const newSessionId = await connectionHandler.connect(ticketValue, {
        timeout: 15000,
        retries: 3,
        onProgressUpdate: (progress) => {
          console.log("Connection progress:", progress);
        }
      });

      // For DumbPipe connections, we also have access to the node ticket
      const activeNodeTicket = connectionHandler.activeNodeTicket();
      console.log("Connection established - SessionId:", newSessionId);
      console.log("Active NodeTicket:", activeNodeTicket);

      setSessionId(newSessionId);
      setConnected(true);

      // For DumbPipe connections, skip the traditional message handler setup
      // as we use direct API calls instead
      if (!activeNodeTicket) {
        // Only setup message handler for traditional connections
        await setupMessageHandler(newSessionId);
      }

      // Add to history
      const newHistory = [newSessionId, ...connectionHistory().slice(0, 9)];
      setConnectionHistory(newHistory);
      localStorage.setItem("connectionHistory", JSON.stringify(newHistory));

      // Notify parent with both sessionId and nodeTicket if available
      props.onConnectionEstablished?.(newSessionId, activeNodeTicket);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      props.onError?.(error as Error);
    }
  };

  const handleDisconnect = async () => {
    const currentSessionId = sessionId();
    if (!currentSessionId) return;

    try {
      await invoke("disconnect_session", { sessionId: currentSessionId });

      // Cleanup message handler
      const handlers = messageHandlers();
      const handler = handlers.get(currentSessionId);
      if (handler) {
        await handler.stopListening();
        const newHandlers = new Map(handlers);
        newHandlers.delete(currentSessionId);
        setMessageHandlers(newHandlers);
      }

      setSessionId(null);
      setConnected(false);
      setConnectionStats({
        messagesReceived: 0,
        lastMessageTime: 0,
        activeTerminals: 0,
        activePortForwards: 0
      });

      props.onConnectionLost?.(currentSessionId);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      props.onError?.(error as Error);
    }
  };

  const setupMessageHandler = async (sessionId: string) => {
    try {
      const handler = createMessageHandler(sessionId, {
        onTerminalEvent: (event) => {
          console.log("Terminal event:", event);
          updateConnectionStats();
          props.onTerminalEvent?.(event);
        },
        onPortForwardEvent: (event) => {
          console.log("Port forward event:", event);
          updateConnectionStats();
          props.onPortForwardEvent?.(event);
        },
        onFileTransferEvent: (event) => {
          console.log("File transfer event:", event);
          props.onFileTransferEvent?.(event);
        },
        onSystemEvent: (event) => {
          console.log("System event:", event);
          if (event.type === "stats_response") {
            updateConnectionStats(event.data);
          }
          props.onSystemEvent?.(event);
        },
        onRawMessage: (message: NetworkMessage) => {
          updateConnectionStats();
        },
        onError: (error) => {
          console.error("Message handler error:", error);
          props.onError?.(error);
        }
      });

      await handler.startListening();

      // Store handler
      const newHandlers = new Map(messageHandlers());
      newHandlers.set(sessionId, handler);
      setMessageHandlers(newHandlers);

      // Request initial stats
      const apiClient = createApiClient(sessionId);
      await apiClient.getSystemStats();

    } catch (error) {
      console.error("Failed to setup message handler:", error);
      props.onError?.(error as Error);
    }
  };

  const updateConnectionStats = (systemData?: any) => {
    setConnectionStats(prev => ({
      messagesReceived: prev.messagesReceived + 1,
      lastMessageTime: Date.now(),
      activeTerminals: systemData?.terminal_stats?.active_terminals || prev.activeTerminals,
      activePortForwards: systemData?.port_forward_stats?.active_services || prev.activePortForwards
    }));
  };

  const connectToHistorySession = async (historySessionId: string) => {
    try {
      // For now, we'll just try to reconnect using the stored session ID
      // In a real implementation, you'd need to store and reuse the original ticket
      setError("Reconnect to history sessions not implemented yet");
      // TODO: Implement proper session reconnection with stored tickets
    } catch (error) {
      setError("Failed to reconnect to session");
      props.onError?.(error as Error);
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div class="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-800 mb-2">Enhanced P2P Connection</h2>
        <p class="text-gray-600">Connect to remote CLI services using the new message architecture</p>
      </div>

      {/* Connection Status */}
      <div class="mb-6 p-4 bg-gray-50 rounded-lg">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div class={`w-3 h-3 rounded-full ${connected() ? "bg-green-500" : "bg-red-500"}`}></div>
            <span class="font-medium">
              {connected() ? "Connected" : "Disconnected"}
            </span>
            {sessionId() && (
              <span class="text-sm text-gray-500">
                Session: {sessionId()!.slice(0, 8)}...
              </span>
            )}
          </div>
          <div class="text-sm text-gray-500">
            {connectionStats().messagesReceived} messages received
          </div>
        </div>

        {connectionStats().lastMessageTime > 0 && (
          <div class="mt-2 text-xs text-gray-400">
            Last activity: {formatTimeAgo(connectionStats().lastMessageTime)}
          </div>
        )}
      </div>

      {/* Connection Form */}
      <Show when={!connected()}>
        <div class="mb-6">
          <div class="flex space-x-3">
            <input
              type="text"
              value={ticket()}
              onInput={(e) => setTicket(e.currentTarget.value)}
              placeholder="Enter connection ticket..."
              class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyPress={(e) => e.key === "Enter" && handleConnect()}
            />
            <button
              onClick={handleConnect}
              disabled={connectionHandler.connecting() || !ticket().trim()}
              class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connectionHandler.connecting() ? "Connecting..." : "Connect"}
            </button>
          </div>

          {/* Connection Progress */}
          <Show when={connectionHandler.connecting()}>
            <div class="mt-3">
              <div class="flex justify-between text-sm text-gray-600 mb-1">
                <span>Connecting...</span>
                <span>{Math.round(connectionHandler.connectionProgress()?.percentage || 0)}%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${connectionHandler.connectionProgress()?.percentage || 0}%` }}
                ></div>
              </div>
              <Show when={connectionHandler.connectionProgress()?.error}>
                <div class="mt-1 text-sm text-red-600">
                  {connectionHandler.connectionProgress()?.error}
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      {/* Error Display */}
      <Show when={error()}>
        <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div class="flex items-center space-x-2">
            <span class="text-red-600 font-medium">Error:</span>
            <span class="text-red-600">{error()}</span>
          </div>
          <button
            onClick={() => setError(null)}
            class="mt-2 text-sm text-red-600 hover:text-red-800"
          >
            Dismiss
          </button>
        </div>
      </Show>

      {/* Connected State */}
      <Show when={connected()}>
        <div class="space-y-4">
          {/* Connection Stats */}
          <div class="grid grid-cols-3 gap-4">
            <div class="bg-blue-50 p-3 rounded-lg">
              <div class="text-sm text-blue-600 font-medium">Active Terminals</div>
              <div class="text-2xl font-bold text-blue-800">{connectionStats().activeTerminals}</div>
            </div>
            <div class="bg-green-50 p-3 rounded-lg">
              <div class="text-sm text-green-600 font-medium">Active Services</div>
              <div class="text-2xl font-bold text-green-800">{connectionStats().activePortForwards}</div>
            </div>
            <div class="bg-purple-50 p-3 rounded-lg">
              <div class="text-sm text-purple-600 font-medium">Messages</div>
              <div class="text-2xl font-bold text-purple-800">{connectionStats().messagesReceived}</div>
            </div>
          </div>

          {/* Disconnect Button */}
          <button
            onClick={handleDisconnect}
            class="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Disconnect
          </button>
        </div>
      </Show>

      {/* Connection History */}
      <Show when={connectionHistory().length > 0}>
        <div class="mt-8">
          <h3 class="text-lg font-semibold text-gray-800 mb-3">Recent Sessions</h3>
          <div class="space-y-2">
            <For each={connectionHistory()}>
              {(historySessionId) => (
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div class="flex items-center space-x-3">
                    <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
                    <span class="text-sm font-mono">{historySessionId.slice(0, 16)}...</span>
                  </div>
                  <button
                    onClick={() => connectToHistorySession(historySessionId)}
                    class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Reconnect
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}