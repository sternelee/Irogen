import { createSignal, createEffect, onMount, For, Show, onCleanup } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { createMessageHandler, extractTerminalInfo } from "../utils/messageHandler";
import { createApiClient, ApiValidators, ConnectionApi } from "../utils/api";
import { TerminalInfo, TerminalEvent, MessageDomain } from "../types/messages";
import { createConnectionHandler } from "../hooks/useConnection";

// Use the new TerminalInfo type from messages.ts
type Terminal = TerminalInfo;

interface CreateTerminalRequest {
  name?: string;
  shell_path?: string;
  working_dir?: string;
  rows?: number;
  cols?: number;
}

interface TerminalInputRequest {
  input: string;
}

interface TerminalResizeRequest {
  rows: number;
  cols: number;
}

interface TerminalStopRequest {
  // No parameters needed for dumbpipe
}

export function TerminalManager(props: {
  nodeTicket: string;
  onClose: () => void;
}) {
  const [terminals, setTerminals] = createSignal<Terminal[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [showCreateForm, setShowCreateForm] = createSignal(false);
  const [selectedTerminal, setSelectedTerminal] = createSignal<string | null>(null);
  const [terminalInput, setTerminalInput] = createSignal("");

  // Create terminal form state
  const [newTerminalName, setNewTerminalName] = createSignal("");
  const [newTerminalShell, setNewTerminalShell] = createSignal("");
  const [newTerminalDir, setNewTerminalDir] = createSignal("");
  const [newTerminalRows, setNewTerminalRows] = createSignal(24);
  const [newTerminalCols, setNewTerminalCols] = createSignal(80);

  // Create connection handler and message handler
  let connectionHandler: ReturnType<typeof createConnectionHandler>;
  let messageHandler: ReturnType<typeof createMessageHandler>;
  let apiClient: ReturnType<typeof createApiClient>;

  // Load terminals on mount
  onMount(() => {
    connectionHandler = createConnectionHandler();
    
    // For DumbPipe, we'll use direct API calls instead of message events
    // So we don't need to establish a traditional session
    loadTerminals();
  });

  // Cleanup on unmount
  onCleanup(async () => {
    if (connectionHandler) {
      await connectionHandler.disconnect(undefined, props.nodeTicket);
    }
    if (messageHandler) {
      await messageHandler.stopListening();
    }
  });

  const loadTerminals = async () => {
    setLoading(true);
    try {
      // For DumbPipe, terminals are managed differently
      // We don't have a traditional list command, so we'll start with an empty list
      // Terminals will be created on demand
      setTerminals([]);
    } catch (error) {
      console.error("Failed to load terminals:", error);
    } finally {
      setLoading(false);
    }
  };

  const setupEventListeners = async () => {
    // For DumbPipe, we don't use traditional message events
    // Terminal management is done through direct API calls
  };

  const handleTerminalEvent = (event: TerminalEvent) => {
    console.log("Terminal event:", event);

    switch (event.type) {
      case "created":
        const terminalInfo = extractTerminalInfo(event);
        if (terminalInfo) {
          setTerminals(prev => [...prev, terminalInfo]);
        }
        break;

      case "stopped":
        setTerminals(prev => prev.filter(t => t.id !== event.terminal_id));
        if (selectedTerminal() === event.terminal_id) {
          setSelectedTerminal(null);
        }
        break;

      case "status_update":
        setTerminals(prev =>
          prev.map(terminal =>
            terminal.id === event.terminal_id
              ? { ...terminal, status: event.data.status }
              : terminal
          )
        );
        break;

      case "output":
        // Handle terminal output for specific terminal if needed
        console.log(`Terminal ${event.terminal_id} output:`, event.data.data);
        break;

      case "directory_changed":
        setTerminals(prev =>
          prev.map(terminal =>
            terminal.id === event.terminal_id
              ? { ...terminal, current_dir: event.data.new_dir }
              : terminal
          )
        );
        break;

      case "resize":
        setTerminals(prev =>
          prev.map(terminal =>
            terminal.id === event.terminal_id
              ? { ...terminal, size: [event.data.rows, event.data.cols] }
              : terminal
          )
        );
        break;

      case "list_response":
        setTerminals(event.data.terminals || []);
        break;

      default:
        console.log(`Unhandled terminal event type: ${event.type}`);
    }
  };

  const createTerminal = async () => {
    setCreating(true);
    try {
      // Use DumbPipe API for terminal creation
      const result = await ConnectionApi.createDumbPipeTerminal(
        props.nodeTicket,
        newTerminalName() || undefined,
        newTerminalShell() || undefined,
        newTerminalDir() || undefined,
        newTerminalRows(),
        newTerminalCols()
      );

      console.log("Terminal created:", result);
      setShowCreateForm(false);
      resetCreateForm();
      
      // Terminal will be added via events, no need to refresh list
    } catch (error) {
      console.error("Failed to create terminal:", error);
      showErrorMessage(`Failed to create terminal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCreating(false);
    }
  };

  const stopTerminal = async (terminalId: string) => {
    try {
      // For DumbPipe, we can send a command to stop the terminal
      const result = await ConnectionApi.sendDumbPipeCommand(props.nodeTicket, "exit");
      console.log("Terminal stop command sent:", result);
      
      // Remove terminal from local list
      setTerminals(prev => prev.filter(t => t.id !== terminalId));
      if (selectedTerminal() === terminalId) {
        setSelectedTerminal(null);
      }
    } catch (error) {
      console.error("Failed to stop terminal:", error);
      showErrorMessage(`Failed to stop terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendInputToTerminal = async (terminalId: string, input: string) => {
    try {
      // Use DumbPipe API for sending input
      const result = await ConnectionApi.sendDumbPipeInput(props.nodeTicket, input);
      console.log("Input sent:", result);
    } catch (error) {
      console.error("Failed to send input to terminal:", error);
      showErrorMessage(`Failed to send input: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resizeTerminal = async (terminalId: string, rows: number, cols: number) => {
    try {
      // Use DumbPipe resize API
      const result = await ConnectionApi.resizeDumbPipeTerminal(props.nodeTicket, rows, cols);
      console.log("Terminal resized:", result);
      
      // Update terminal size in local list
      setTerminals(prev =>
        prev.map(terminal =>
          terminal.id === terminalId
            ? { ...terminal, size: [rows, cols] }
            : terminal
        )
      );
    } catch (error) {
      console.error("Failed to resize terminal:", error);
      showErrorMessage(`Failed to resize terminal: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resetCreateForm = () => {
    setNewTerminalName("");
    setNewTerminalShell("");
    setNewTerminalDir("");
    setNewTerminalRows(24);
    setNewTerminalCols(80);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Running": return "text-green-500";
      case "Starting": return "text-yellow-500";
      case "Paused": return "text-blue-500";
      case "Stopped": return "text-gray-500";
      case "Error": return "text-red-500";
      default: return "text-gray-500";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Running": return "▶";
      case "Starting": return "⏳";
      case "Paused": return "⏸";
      case "Stopped": return "⏹";
      case "Error": return "⚠";
      default: return "❓";
    }
  };

  const showErrorMessage = (message: string) => {
    console.error("Terminal Manager Error:", message);
    // TODO: Show error to user in UI
    alert(message); // Temporary implementation
  };

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div class="bg-gray-800 text-white p-4 flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
              <span class="text-white font-bold">T</span>
            </div>
            <h2 class="text-xl font-semibold">Terminal Manager</h2>
            <span class="text-sm text-gray-300">Node: {props.nodeTicket.slice(0, 8)}...</span>
          </div>
          <div class="flex items-center space-x-2">
            <button
              onClick={loadTerminals}
              disabled={loading()}
              class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
            >
              {loading() ? "Loading..." : "Refresh"}
            </button>
            <button
              onClick={() => setShowCreateForm(true)}
              class="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm"
            >
              + New Terminal
            </button>
            <button
              onClick={props.onClose}
              class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              Close
            </button>
          </div>
        </div>

        {/* Create Terminal Form */}
        <Show when={showCreateForm()}>
          <div class="bg-gray-100 p-4 border-b">
            <h3 class="font-semibold mb-3">Create New Terminal</h3>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Name (optional)</label>
                <input
                  type="text"
                  value={newTerminalName()}
                  onInput={(e) => setNewTerminalName(e.currentTarget.value)}
                  placeholder="Terminal name"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Shell Path (optional)</label>
                <input
                  type="text"
                  value={newTerminalShell()}
                  onInput={(e) => setNewTerminalShell(e.currentTarget.value)}
                  placeholder="/bin/bash"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Working Directory (optional)</label>
                <input
                  type="text"
                  value={newTerminalDir()}
                  onInput={(e) => setNewTerminalDir(e.currentTarget.value)}
                  placeholder="~/"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Rows</label>
                  <input
                    type="number"
                    value={newTerminalRows()}
                    onInput={(e) => setNewTerminalRows(parseInt(e.currentTarget.value) || 24)}
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Cols</label>
                  <input
                    type="number"
                    value={newTerminalCols()}
                    onInput={(e) => setNewTerminalCols(parseInt(e.currentTarget.value) || 80)}
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
            <div class="flex justify-end space-x-2 mt-3">
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  resetCreateForm();
                }}
                class="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={createTerminal}
                disabled={creating()}
                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
              >
                {creating() ? "Creating..." : "Create Terminal"}
              </button>
            </div>
          </div>
        </Show>

        {/* Terminal List */}
        <div class="flex-1 overflow-y-auto p-4">
          <Show
            when={terminals().length > 0}
            fallback={<div class="text-center text-gray-500 py-8">No terminals found. Create one to get started.</div>}
          >
            <div class="grid gap-3">
              <For each={terminals()}>
                {(terminal) => (
                  <div
                    class={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      selectedTerminal() === terminal.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                    onClick={() => setSelectedTerminal(terminal.id)}
                  >
                    <div class="flex justify-between items-start mb-2">
                      <div class="flex-1">
                        <div class="flex items-center space-x-2">
                          <h3 class="font-semibold text-lg">
                            {terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}
                          </h3>
                          <span class={`text-sm ${getStatusColor(terminal.status)}`}>
                            {getStatusIcon(terminal.status)} {terminal.status}
                          </span>
                        </div>
                        <div class="text-sm text-gray-600 mt-1">
                          <div>Shell: {terminal.shell_type}</div>
                          <div>Directory: {terminal.current_dir}</div>
                          <div>Size: {terminal.size[0]}x{terminal.size[1]}</div>
                          <div>PID: {terminal.process_id || "N/A"}</div>
                          <div>WebShares: {terminal.associated_webshares.length}</div>
                        </div>
                      </div>
                      <div class="flex flex-col space-y-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            stopTerminal(terminal.id);
                          }}
                          class="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded"
                        >
                          Stop
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            resizeTerminal(terminal.id, 30, 100);
                          }}
                          class="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded"
                        >
                          Resize
                        </button>
                      </div>
                    </div>

                    {/* Terminal Input Section */}
                    <Show when={selectedTerminal() === terminal.id && terminal.status === "Running"}>
                      <div class="mt-3 pt-3 border-t">
                        <div class="flex space-x-2">
                          <input
                            type="text"
                            value={terminalInput()}
                            onInput={(e) => setTerminalInput(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && terminalInput().trim()) {
                                sendInputToTerminal(terminal.id, terminalInput() + "\n");
                                setTerminalInput("");
                              }
                            }}
                            placeholder="Enter command..."
                            class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => {
                              if (terminalInput().trim()) {
                                sendInputToTerminal(terminal.id, terminalInput() + "\n");
                                setTerminalInput("");
                              }
                            }}
                            disabled={!terminalInput().trim()}
                            class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="bg-gray-100 p-3 border-t text-sm text-gray-600 text-center">
          <div>Connected to: {props.nodeTicket}</div>
          <div>Total terminals: {terminals().length}</div>
        </div>
      </div>
    </div>
  );
}