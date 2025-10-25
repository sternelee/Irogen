import {
  createSignal,
  createEffect,
  onMount,
  createMemo,
  onCleanup,
} from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import {
  createConnectionHistory,
  HistoryEntry,
} from "./hooks/useConnectionHistory";
import { EnhancedTerminalView } from "./components/EnhancedTerminalView";
import { SettingsModal } from "./components/SettingsModal";
import { HomeView } from "./components/HomeView";
import { RemoteSessionView } from "./components/RemoteSessionView";
import { P2PBackground } from "./components/P2PBackground";
import { EnhancedConnectionInterface } from "./components/EnhancedConnectionInterface";
import { t } from "./stores/settingsStore";
import {
  initializeMobileUtils,
  getDeviceCapabilities,
  MobileKeyboard,
  KeyboardInfo,
} from "./utils/mobile";
import { getViewportManager } from "./utils/mobile/ViewportManager";
import { getLayoutCalculator } from "./utils/mobile/LayoutCalculator";
import type { ViewportDimensions } from "./utils/mobile/ViewportManager";
import { createConnectionHandler } from "./hooks/useConnection";
import { createMessageHandler } from "./utils/messageHandler";
import { createApiClient } from "./utils/api";
import { TerminalEvent, PortForwardEvent, FileTransferEvent, SystemEvent } from "./types/messages";

function App() {
  const [sessionTicket, setSessionTicket] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);
  const [status, setStatus] = createSignal("Disconnected");
  const [isConnected, setIsConnected] = createSignal(false);
  const [connectionError, setConnectionError] = createSignal<string | null>(
    null,
  );
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [activeTicket, setActiveTicket] = createSignal<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = createSignal(false);
  const [networkStrength, setNetworkStrength] = createSignal(3);
  const [currentView, setCurrentView] = createSignal<"home" | "remote" | "terminal" | "connection">(
    "home",
  );
  const [currentTime, setCurrentTime] = createSignal(
    new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  );

  // New message architecture state
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [showEnhancedConnection, setShowEnhancedConnection] = createSignal(false);

  // Enhanced connection handler
  const connectionHandler = createConnectionHandler();
  const nodeTicket = () => connectionHandler.activeNodeTicket();

  // Message handlers for different sessions
  const [messageHandlers, setMessageHandlers] = createSignal<Map<string, any>>(new Map());

  // Session stats
  const [sessionStats, setSessionStats] = createSignal({
    activeTerminals: 0,
    activePortForwards: 0,
    messagesReceived: 0,
    lastMessageTime: 0
  });

  // Enhanced mobile keyboard state management
  const [keyboardVisible, setKeyboardVisible] = createSignal(false);
  const [keyboardHeight, setKeyboardHeight] = createSignal(0);
  const [effectiveViewportHeight, setEffectiveViewportHeight] = createSignal(
    window.innerHeight,
  );
  const [debugInfo, setDebugInfo] = createSignal("");

  // Terminal information state
  const [terminalInfo, setTerminalInfo] = createSignal<{
    sessionTitle: string;
    terminalType: string;
    workingDirectory: string;
  }>({ sessionTitle: "RiTerm", terminalType: "shell", workingDirectory: "~" });

  let sessionIdRef: string | null = null;
  let terminalInstance: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let unlistenRef: (() => void) | null = null;

  const { history, addHistoryEntry, updateHistoryEntry, deleteHistoryEntry } =
    createConnectionHistory();

  // Enhanced mobile initialization and keyboard state management
  onMount(() => {
    // Time update timer
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }, 1000);

    // Get ViewportManager instance
    const viewportManager = getViewportManager();

    // Subscribe to viewport changes (includes keyboard state)
    const unsubscribeViewport = viewportManager.onViewportChange(
      (dimensions: ViewportDimensions) => {
        setKeyboardHeight(dimensions.keyboardHeight);
        setEffectiveViewportHeight(dimensions.effectiveHeight);
        setKeyboardVisible(dimensions.keyboardHeight > 0);

        // Enhanced debug info
        setDebugInfo(
          `Keyboard: ${dimensions.keyboardHeight > 0 ? "Visible" : "Hidden"}, ` +
          `Height: ${dimensions.keyboardHeight}px, ` +
          `Viewport: ${dimensions.height}px, ` +
          `Effective: ${dimensions.effectiveHeight}px`,
        );
      },
    );

    // Also keep the original MobileKeyboard subscription for backward compatibility
    const unsubscribeKeyboard = MobileKeyboard.onVisibilityChange(
      (visible: boolean, keyboardInfo?: KeyboardInfo) => {
        // Update ViewportManager with keyboard info
        if (keyboardInfo) {
          viewportManager.updateKeyboardState(keyboardInfo);
        }
      },
    );

    onCleanup(() => {
      clearInterval(timer);
      unsubscribeViewport();
      unsubscribeKeyboard();

      // Cleanup all message handlers
      messageHandlers().forEach(async (handler) => {
        if (handler && handler.isActive()) {
          await handler.stopListening();
        }
      });
    });
  });

  const initializeNetwork = async () => {
    try {
      setStatus("Initializing P2P Network...");
      setNetworkStrength(2); // Initializing state

      // Call the backend network initialization command
      const nodeId = await invoke<string>("initialize_network");

      console.log("P2P Network initialized successfully with node ID:", nodeId);
      setStatus("Ready - P2P Network Initialized");
      setNetworkStrength(3); // Ready state (not connected to peer yet)

    } catch (error) {
      console.error("Failed to initialize network:", error);
      setStatus("Failed to initialize network: " + String(error));
      setNetworkStrength(0); // No network when failed
    }
  };

  const setupMessageHandler = async (sessionId: string) => {
    try {
      const handler = createMessageHandler(sessionId, {
        onTerminalEvent: handleTerminalEvent,
        onPortForwardEvent: handlePortForwardEvent,
        onFileTransferEvent: handleFileTransferEvent,
        onSystemEvent: handleSystemEvent,
        onRawMessage: handleRawMessage,
        onError: (error) => {
          console.error("Message handler error:", error);
          setConnectionError(error.message);
        }
      });

      await handler.startListening();

      // Store handler
      const newHandlers = new Map(messageHandlers());
      newHandlers.set(sessionId, handler);
      setMessageHandlers(newHandlers);

    } catch (error) {
      console.error("Failed to setup message handler:", error);
      setConnectionError(error.message);
    }
  };

  const cleanupMessageHandler = async (sessionId: string) => {
    const handlers = messageHandlers();
    const handler = handlers.get(sessionId);
    if (handler) {
      await handler.stopListening();
      const newHandlers = new Map(handlers);
      newHandlers.delete(sessionId);
      setMessageHandlers(newHandlers);
    }
  };

  onMount(() => {
    // 初始化网络
    initializeNetwork();
  });

  const handleTerminalReady = (term: Terminal, addon: FitAddon) => {
    terminalInstance = term;
    fitAddon = addon;

    // 移动端调试信息
    const deviceCapabilities = getDeviceCapabilities();
    if (deviceCapabilities.isMobile) {
      console.log("[Mobile Debug] Terminal ready callback triggered:", {
        terminal: !!term,
        isDisposed: !!(term as any)._isDisposed,
        element: !!term.element,
        rows: term.rows,
        cols: term.cols,
        terminalInstanceRef: !!terminalInstance
      });
    }

    window.addEventListener("resize", () => addon.fit());
  };

  const handleTerminalInput = (data: string) => {
    const currentSessionId = sessionId();
    if (currentSessionId) {
      const apiClient = createApiClient(currentSessionId);
      apiClient.sendTerminalInput({
        session_id: currentSessionId,
        terminal_id: "default", // This should be dynamic
        input: data
      }).catch((error) => {
        console.error("Failed to send input:", error);
        if (terminalInstance && !(terminalInstance as any)._isDisposed) {
          terminalInstance.writeln(`\r\n❌ Failed to send input: ${error}`);
        }
      });
    }
  };

  // New message architecture event handlers
  const handleTerminalEvent = (event: TerminalEvent) => {
    console.log("Terminal event:", event);

    if (terminalInstance && !(terminalInstance as any)._isDisposed) {
      switch (event.type) {
        case "output":
          terminalInstance.write(event.data.data);
          break;
        case "status_update":
          console.log(`Terminal ${event.terminal_id} status: ${event.data.status}`);
          break;
        case "directory_changed":
          setTerminalInfo(prev => ({
            ...prev,
            workingDirectory: event.data.new_dir
          }));
          break;
        default:
          console.log(`Unhandled terminal event: ${event.type}`);
      }
    }

    updateSessionStats();
  };

  const handlePortForwardEvent = (event: PortForwardEvent) => {
    console.log("Port forward event:", event);
    updateSessionStats();
  };

  const handleFileTransferEvent = (event: FileTransferEvent) => {
    console.log("File transfer event:", event);
  };

  const handleSystemEvent = (event: SystemEvent) => {
    console.log("System event:", event);

    if (event.type === "stats_response") {
      updateSessionStats(event.data);
    }
  };

  const handleRawMessage = (message: any) => {
    updateSessionStats();
  };

  const updateSessionStats = (systemData?: any) => {
    setSessionStats(prev => ({
      messagesReceived: prev.messagesReceived + 1,
      lastMessageTime: Date.now(),
      activeTerminals: systemData?.terminal_stats?.active_terminals || prev.activeTerminals,
      activePortForwards: systemData?.port_forward_stats?.active_services || prev.activePortForwards
    }));
  };

  const handleDisconnect = async () => {
    if (terminalInstance && !(terminalInstance as any)._isDisposed) {
      terminalInstance.writeln(
        "\r\n\x1b[1;33m👋 Disconnected from session\x1b[0m",
      );
    }

    const currentActiveTicket = activeTicket();
    if (currentActiveTicket) {
      updateHistoryEntry(currentActiveTicket, {
        status: "Completed",
        description: "Session ended by user.",
      });
    }

    const currentSessionId = sessionId();
    if (currentSessionId) {
      try {
        await invoke("disconnect_session", { sessionId: currentSessionId });
        await cleanupMessageHandler(currentSessionId);
      } catch (error) {
        console.error("Failed to disconnect:", error);
      }
    }

    if (unlistenRef) {
      unlistenRef();
      unlistenRef = null;
    }

    setIsConnected(false);
    setSessionId(null);
    setActiveTicket(null);
    setCurrentView("home");
    setStatus(t("connection.status.disconnected"));
    setNetworkStrength(3);
    setSessionStats({
      activeTerminals: 0,
      activePortForwards: 0,
      messagesReceived: 0,
      lastMessageTime: 0
    });
  };

  // 处理会话清理
  const cleanupSession = async () => {
    if (sessionIdRef) {
      try {
        await invoke("disconnect_session", { sessionId: sessionIdRef });
      } catch (error) {
        console.error("Failed to disconnect session during cleanup:", error);
      }
      sessionIdRef = null;
    }

    if (unlistenRef) {
      unlistenRef();
      unlistenRef = null;
    }

    setIsConnected(false);
    setActiveTicket(null);
    setCurrentView("home");
    setStatus(t("connection.status.disconnected"));
    setNetworkStrength(3);
  };

  const handleConnect = async (ticketOverride?: string) => {
    const ticket = (ticketOverride || sessionTicket()).trim();
    if (!ticket) {
      setConnectionError("Please enter a session ticket.");
      return;
    }

    // If a new ticket is used, add it to history.
    if (!history().some((h) => h.ticket === ticket)) {
      addHistoryEntry(ticket);
    }
    setConnecting(true);
    setStatus(t("connection.status.connecting"));
    setConnectionError(null);

    try {
      // Use the enhanced connection handler
      const newSessionId = await connectionHandler.connect(ticket, {
        timeout: 15000,
        retries: 3,
        onProgressUpdate: (progress) => {
          setStatus(`Connecting... ${Math.round(progress.percentage)}%`);
        }
      });

      setSessionId(newSessionId);
      setActiveTicket(ticket);
      setIsConnected(true);
      setCurrentView("remote");
      updateHistoryEntry(ticket, { description: "Connected to remote CLI host." });

      // Setup message handler for this session
      await setupMessageHandler(newSessionId);

      // Setup legacy terminal event listener for backward compatibility
      const unlisten = await listen<any>(
        'terminal-event',
        (event) => {
          const termEvent = event.payload;
          if (terminalInstance && !(terminalInstance as any)._isDisposed) {
            if (termEvent.event_type === "Output") {
              try {
                terminalInstance.write(termEvent.data);
                console.log(`[Mobile Debug] Successfully wrote to terminal: ${termEvent.data.length} chars`);
              } catch (error) {
                console.error("[Mobile Debug] Failed to write to terminal:", error);
              }
            } else if (termEvent.event_type === "End") {
              // INFO: 其他端退出不影响本端
              // terminalInstance.writeln("\r\n\r\n[Session Ended]");
              // handleDisconnect();
            } else if (termEvent.event_type === "HistoryData") {
              // 处理接收到的历史记录数据
              console.log("📜 Received session history:", termEvent.data);

              // 解析历史记录数据
              try {
                const historyData = JSON.parse(termEvent.data);
                const { logs, shell, cwd } = historyData;

                // 更新终端信息
                setTerminalInfo({
                  sessionTitle: `Remote Shell`,
                  terminalType: shell || "shell",
                  workingDirectory: cwd || "~",
                });

                // 在终端中显示历史记录
                if (terminalInstance && !(terminalInstance as any)._isDisposed) {
                  terminalInstance.writeln(
                    "\r\n\x1b[1;36m📜 Session History Received\x1b[0m",
                  );
                  terminalInstance.writeln(`\x1b[1;33mShell:\x1b[0m ${shell}`);
                  terminalInstance.writeln(
                    `\x1b[1;33mWorking Directory:\x1b[0m ${cwd}`,
                  );
                  terminalInstance.writeln(
                    "\x1b[1;33m--- History Start ---\x1b[0m",
                  );
                  terminalInstance.write(logs);
                  terminalInstance.writeln(
                    "\x1b[1;33m--- History End ---\x1b[0m\r\n",
                  );
                } else {
                  console.error("[Mobile Debug] Cannot display history - terminal not ready");
                }

                // 更新连接历史记录
                updateHistoryEntry(ticket, {
                  description: `Connected with history (Shell: ${shell}, CWD: ${cwd})`,
                });

                console.log(
                  `✅ History displayed: ${logs.length} characters, Shell: ${shell}, CWD: ${cwd}`,
                );
              } catch (error) {
                console.error("❌ Failed to parse history data:", error);
                if (terminalInstance && !(terminalInstance as any)._isDisposed) {
                  terminalInstance.writeln(
                    "\r\n\x1b[1;31m❌ Failed to parse session history\x1b[0m\r\n",
                  );
                }
              }
            }
          }
        },
      );

      unlistenRef = unlisten;
      setStatus(t("connection.status.connected"));
      setNetworkStrength(4);
      if (terminalInstance && !(terminalInstance as any)._isDisposed) {
        terminalInstance.clear();
        terminalInstance.writeln(
          "\r\n\x1b[1;32m🚀 P2P Connection established!\x1b[0m",
        );
        terminalInstance.focus();
      }
    } catch (error) {
      console.error("Connection failed:", error);
      const errorMessage = String(error);

      setStatus(t("connection.status.failed"));
      updateHistoryEntry(ticket, {
        status: "Failed",
        description: errorMessage,
      });
      setConnectionError(errorMessage);
      setNetworkStrength(1);
    } finally {
      setConnecting(false);
    }
  };

  // Enhanced connection using the new interface
  const handleEnhancedConnection = async (ticket: string) => {
    setSessionTicket(ticket);
    await handleConnect(ticket);
  };

  const handleLogin = (username: string, password: string) => {
    // TODO: Implement actual authentication
    console.log("Login attempt:", username);
    setIsLoggedIn(true);
  };

  const handleSkipLogin = () => {
    setIsLoggedIn(true);
  };

  const activeHistoryEntry = createMemo(() =>
    history().find((entry) => entry.ticket === activeTicket()),
  );

  return (
    <div
      class="w-full font-mono mobile-viewport"
      data-theme="riterm-mobile"
      style={{
        height: keyboardVisible() ? `${effectiveViewportHeight()}px` : "100vh",
        "max-height": keyboardVisible()
          ? `${effectiveViewportHeight()}px`
          : "100vh",
        "padding-top": "env(safe-area-inset-top)",
        "padding-bottom": keyboardVisible()
          ? "0px"
          : "env(safe-area-inset-bottom)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* P2P Background */}
      <P2PBackground />

      {/* Main Layout - Mobile First */}
      <div
        class="relative z-20 w-full flex flex-col overflow-hidden"
        style={{
          height: keyboardVisible() ? `${effectiveViewportHeight()}px` : "100%",
          "max-height": keyboardVisible()
            ? `${effectiveViewportHeight()}px`
            : "100%",
        }}
      >

        {/* Debug Info - 开发时显示 */}
        {/* {window.location.hostname === "localhost" && ( */}
        {/*   <div class="bg-yellow-100 text-black text-xs p-2 border-b shrink-0"> */}
        {/*     Debug: {debugInfo()} | KB: {keyboardVisible() ? "Yes" : "No"} | */}
        {/*     EffectiveVH: {effectiveViewportHeight()}px | KH: {keyboardHeight()} */}
        {/*     px */}
        {/*   </div> */}
        {/* )} */}

        {/* Main Content */}
        <div
          class="flex-1 overflow-hidden"
          style={{
            height: keyboardVisible()
              ? `${effectiveViewportHeight() - 48}px` // 终端头部高度约48px
              : "auto",
            "max-height": keyboardVisible()
              ? `${effectiveViewportHeight() - 48}px`
              : "none",
          }}
        >
          {currentView() === "home" && (
            <HomeView
              sessionTicket={sessionTicket()}
              onTicketInput={setSessionTicket}
              onConnect={handleConnect}
              onShowSettings={() => setIsSettingsOpen(true)}
              onShowEnhancedConnection={() => setShowEnhancedConnection(true)}
              connecting={connecting()}
              connectionError={connectionError()}
              history={history()}
              isLoggedIn={isLoggedIn()}
              onLogin={handleLogin}
              onSkipLogin={handleSkipLogin}
              isConnected={isConnected()}
              activeTicket={activeTicket()}
              onReturnToSession={() => setCurrentView("remote")}
              onDeleteHistory={deleteHistoryEntry}
              onDisconnect={handleDisconnect}
              sessionStats={sessionStats()}
            />
          )}

          {currentView() === "remote" && isConnected() && nodeTicket() && (
            <RemoteSessionView
              nodeTicket={nodeTicket()}
              onDisconnect={handleDisconnect}
              onBack={() => setCurrentView("home")}
            />
          )}

          {currentView() === "terminal" && isConnected() && (
            <EnhancedTerminalView
              onReady={handleTerminalReady}
              onInput={handleTerminalInput}
              isConnected={isConnected()}
              onDisconnect={handleDisconnect}
              onShowKeyboard={() => {
                /* TODO: Implement mobile keyboard */
              }}
              sessionTitle={terminalInfo().sessionTitle}
              terminalType={terminalInfo().terminalType}
              workingDirectory={terminalInfo().workingDirectory}
              keyboardVisible={keyboardVisible()}
              safeViewportHeight={effectiveViewportHeight()}
              onKeyboardToggle={(visible) => {
                // 处理内部移动键盘状态变化
                console.log("Terminal internal keyboard toggled:", visible);
              }}
              onShowSettings={() => setIsSettingsOpen(true)}
              sessionId={sessionId()}
            />
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen()}
        onClose={() => setIsSettingsOpen(false)}
        entry={activeHistoryEntry() || null}
        onSave={(ticket, updates) => updateHistoryEntry(ticket, updates)}
      />

      {/* Enhanced Connection Modal */}
      {showEnhancedConnection() && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div class="flex justify-between items-center p-4 border-b">
              <h2 class="text-xl font-semibold">Enhanced P2P Connection</h2>
              <button
                onClick={() => setShowEnhancedConnection(false)}
                class="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div class="p-4">
              <EnhancedConnectionInterface
                onConnectionEstablished={(newSessionId, nodeTicket) => {
                  console.log("Connection established with session:", newSessionId);
                  console.log("Node ticket:", nodeTicket);
                  
                  setSessionId(newSessionId); // Keep for compatibility
                  setIsConnected(true);
                  setShowEnhancedConnection(false);
                  setCurrentView("remote");
                }}
                onConnectionLost={(lostSessionId) => {
                  console.log("Connection lost for session:", lostSessionId);
                  setIsConnected(false);
                  setSessionId(null);
                  setCurrentView("home");
                  
                  // Clear the active node ticket
                  connectionHandler.disconnect(lostSessionId);
                }}
                onTerminalEvent={handleTerminalEvent}
                onPortForwardEvent={handlePortForwardEvent}
                onFileTransferEvent={handleFileTransferEvent}
                onSystemEvent={handleSystemEvent}
                onError={(error) => {
                  setConnectionError(error.message);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
