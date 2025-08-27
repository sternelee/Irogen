import {
  createSignal,
  createEffect,
  onMount,
  createMemo,
  onCleanup,
  For,
} from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";
import {
  createConnectionHistory,
  HistoryEntry,
} from "./hooks/useConnectionHistory";
import { EnhancedTerminalView } from "./components/EnhancedTerminalView";
import { SettingsModal } from "./components/SettingsModal";
import { HomeView } from "./components/HomeView";
import { MobileNavigation } from "./components/ui/MobileNavigation";
import { P2PBackground } from "./components/P2PBackground";
import { t } from "./stores/settingsStore";
import {
  initializeMobileUtils,
  getDeviceCapabilities,
  MobileKeyboard,
  KeyboardInfo,
} from "./utils/mobile";
import { globalBatteryOptimizer } from "./utils/batteryOptimizer";

function App() {
  const [sessionTicket, setSessionTicket] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);
  const [status, setStatus] = createSignal("Disconnected");
  const [connectionError, setConnectionError] = createSignal<string | null>(
    null
  );
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [isLoggedIn, setIsLoggedIn] = createSignal(false);
  const [networkStrength, setNetworkStrength] = createSignal(3);
  const [currentView, setCurrentView] = createSignal<"home" | "terminal">(
    "home"
  );

  // Enhanced Multi-session state management with proper lifecycle
  type SessionStatus = "connecting" | "connected" | "failed" | "disconnected" | "reconnecting";

  interface SessionState {
    sessionId: string;
    ticket: string;
    status: SessionStatus;
    terminal: Terminal | null;
    fitAddon: FitAddon | null;
    unlisten: (() => void) | null;
    connectTime?: Date;
    lastError?: string;
    retryCount: number;
    terminalInfo: {
      sessionTitle: string;
      terminalType: string;
      workingDirectory: string;
    };
  }

  const [activeSessions, setActiveSessions] = createSignal<Map<string, SessionState>>(new Map());
  const [currentSessionTicket, setCurrentSessionTicket] = createSignal<string | null>(null);
  const [globalConnectionState, setGlobalConnectionState] = createSignal<{
    activeConnections: number;
    pendingConnections: number;
    failedConnections: number;
  }>({ activeConnections: 0, pendingConnections: 0, failedConnections: 0 });

  // Session management utilities
  const updateSessionState = (ticket: string, updates: Partial<SessionState>) => {
    const sessions = activeSessions();
    const session = sessions.get(ticket);
    if (session) {
      const updatedSession = { ...session, ...updates };
      sessions.set(ticket, updatedSession);
      setActiveSessions(new Map(sessions));

      // Update global connection state
      updateGlobalConnectionState();

      console.log(`🔄 Session ${ticket.substring(0, 8)} status updated:`, updatedSession.status);
    }
  };

  const updateGlobalConnectionState = () => {
    const sessions = Array.from(activeSessions().values());
    const state = {
      activeConnections: sessions.filter(s => s.status === "connected").length,
      pendingConnections: sessions.filter(s => s.status === "connecting" || s.status === "reconnecting").length,
      failedConnections: sessions.filter(s => s.status === "failed").length,
    };
    setGlobalConnectionState(state);

    // Update overall status based on session states
    if (state.activeConnections > 0) {
      if (state.activeConnections === 1) {
        setStatus("Connected");
      } else {
        setStatus(`Connected to ${state.activeConnections} sessions`);
      }
      setNetworkStrength(4);
    } else if (state.pendingConnections > 0) {
      setStatus(`Connecting to ${state.pendingConnections} session(s)...`);
      setNetworkStrength(2);
    } else if (state.failedConnections > 0) {
      setStatus(`${state.failedConnections} connection(s) failed`);
      setNetworkStrength(1);
    } else {
      setStatus("Disconnected");
      setNetworkStrength(3);
    }
  };

  const removeSession = async (ticket: string, reason: string = "User disconnected") => {
    const sessions = activeSessions();
    const session = sessions.get(ticket);

    if (session) {
      console.log(`🗑️ Removing session ${ticket.substring(0, 8)}: ${reason}`);

      // Show disconnect message in terminal
      if (session.terminal && session.status === "connected") {
        session.terminal.writeln(`\r\n\x1b[1;33m👋 ${reason}\x1b[0m`);
      }

      // Clean up resources
      try {
        if (session.sessionId && session.status === "connected") {
          await invoke("disconnect_session", { sessionId: session.sessionId });
        }
      } catch (error) {
        console.warn(`Failed to disconnect session ${session.sessionId}:`, error);
      }

      // Clean up event listener
      if (session.unlisten) {
        session.unlisten();
      }

      // Clean up terminal resources
      if (session.terminal) {
        try {
          session.terminal.dispose();
        } catch (error) {
          console.warn("Failed to dispose terminal:", error);
        }
      }

      // Remove from sessions
      sessions.delete(ticket);
      setActiveSessions(new Map(sessions));

      // Update history
      updateHistoryEntry(ticket, {
        status: session.status === "failed" ? "Failed" : "Completed",
        description: reason,
      });

      // Handle current session switching
      if (currentSessionTicket() === ticket) {
        const remainingSessions = Array.from(sessions.keys());
        if (remainingSessions.length > 0) {
          setCurrentSessionTicket(remainingSessions[0]);
        } else {
          setCurrentSessionTicket(null);
          setCurrentView("home");
        }
      }

      updateGlobalConnectionState();
    }
  };

  const [currentTime, setCurrentTime] = createSignal(
    new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  // Enhanced mobile keyboard state management
  const [keyboardVisible, setKeyboardVisible] = createSignal(false);
  const [keyboardHeight, setKeyboardHeight] = createSignal(0);
  const [effectiveViewportHeight, setEffectiveViewportHeight] = createSignal(
    window.innerHeight
  );
  const [debugInfo, setDebugInfo] = createSignal("");

  // Computed values for current session using enhanced state management
  const isConnected = createMemo(() => {
    const state = globalConnectionState();
    return state.activeConnections > 0;
  });

  const isConnecting = createMemo(() => {
    const state = globalConnectionState();
    return state.pendingConnections > 0;
  });

  const activeTicket = createMemo(() => currentSessionTicket());

  const currentSession = createMemo(() => {
    const ticket = currentSessionTicket();
    return ticket ? activeSessions().get(ticket) : null;
  });

  const terminalInfo = createMemo(() => {
    const session = currentSession();
    return session?.terminalInfo || {
      sessionTitle: "RiTerm",
      terminalType: "shell",
      workingDirectory: "~"
    };
  });

  const sessionsList = createMemo(() => {
    return Array.from(activeSessions().values()).sort((a, b) => {
      // Sort by connection time, connected sessions first
      if (a.status === "connected" && b.status !== "connected") return -1;
      if (b.status === "connected" && a.status !== "connected") return 1;
      return (a.connectTime?.getTime() || 0) - (b.connectTime?.getTime() || 0);
    });
  });

  const { history, addHistoryEntry, updateHistoryEntry, deleteHistoryEntry } =
    createConnectionHistory();

  // Enhanced mobile initialization and keyboard state management
  onMount(() => {
    // Initialize enhanced mobile utilities
    initializeMobileUtils();

    // Initialize battery optimizer
    globalBatteryOptimizer.initialize().catch(console.error);

    // Time update timer
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    }, 1000);

    // Enhanced keyboard visibility tracking with the new mobile utilities
    const unsubscribeKeyboard = MobileKeyboard.onVisibilityChange(
      (visible: boolean, keyboardInfo?: KeyboardInfo) => {
        setKeyboardVisible(visible);

        if (keyboardInfo) {
          setKeyboardHeight(keyboardInfo.height);
          setEffectiveViewportHeight(
            keyboardInfo.viewportHeight - (keyboardInfo.viewportOffsetTop || 0)
          );

          // Enhanced debug info
          setDebugInfo(
            `Keyboard: ${visible ? "Visible" : "Hidden"}, ` +
            `Height: ${keyboardInfo.height}px, ` +
            `Viewport: ${keyboardInfo.viewportHeight}px, ` +
            `Effective: ${keyboardInfo.viewportHeight -
            (keyboardInfo.viewportOffsetTop || 0)
            }px`
          );
        } else {
          setKeyboardHeight(0);
          setEffectiveViewportHeight(window.innerHeight);
          setDebugInfo("Keyboard: Hidden");
        }
      }
    );

    onCleanup(() => {
      clearInterval(timer);
      unsubscribeKeyboard();
    });
  });

  const initializeNetwork = async () => {
    try {
      const nodeId = await invoke<string>("initialize_network");
      setStatus(`Ready - Node ID: ${nodeId.substring(0, 8)}...`);
      setNetworkStrength(4); // Full network strength when connected
    } catch (error) {
      console.error("Failed to initialize network:", error);
      setStatus("Failed to initialize network");
      setNetworkStrength(0); // No network when failed
    }
  };

  // Helper function to get session display info
  const getSessionDisplayInfo = createMemo(() => {
    const state = globalConnectionState();
    const { activeConnections, pendingConnections, failedConnections } = state;

    if (activeConnections > 0) {
      if (pendingConnections > 0) {
        return {
          count: activeConnections + pendingConnections,
          status: `${activeConnections} connected, ${pendingConnections} connecting`
        };
      }
      return {
        count: activeConnections,
        status: activeConnections === 1 ? "Connected" : `Connected to ${activeConnections} sessions`
      };
    }

    if (pendingConnections > 0) {
      return {
        count: pendingConnections,
        status: `Connecting to ${pendingConnections} session(s)...`
      };
    }

    if (failedConnections > 0) {
      return {
        count: failedConnections,
        status: `${failedConnections} connection(s) failed`
      };
    }

    return { count: 0, status: "Disconnected" };
  });

  onMount(() => {
    // 初始化网络
    initializeNetwork();
  });

  const handleTerminalReady = (term: Terminal, addon: FitAddon) => {
    const ticket = currentSessionTicket();
    if (!ticket) return;

    const session = activeSessions().get(ticket);
    if (session && session.status === "connected") {
      // Update session with terminal instances
      updateSessionState(ticket, {
        terminal: term,
        fitAddon: addon,
      });

      // Set up resize handler for this specific terminal
      const resizeHandler = () => {
        try {
          addon.fit();
        } catch (error) {
          console.warn(`Failed to fit terminal for session ${ticket.substring(0, 8)}:`, error);
        }
      };

      window.addEventListener("resize", resizeHandler);

      // Store cleanup function
      const originalUnlisten = session.unlisten;
      const enhancedUnlisten = () => {
        window.removeEventListener("resize", resizeHandler);
        originalUnlisten?.();
      };

      updateSessionState(ticket, { unlisten: enhancedUnlisten });

      // Initialize terminal with welcome message
      term.clear();
      const welcomeMessage = [
        `\x1b[1;32m🚀 Connected to session: ${ticket.substring(0, 8)}\x1b[0m`,
        `\x1b[36mShell: ${session.terminalInfo.terminalType}\x1b[0m`,
        `\x1b[36mWorking Directory: ${session.terminalInfo.workingDirectory}\x1b[0m`,
        "\x1b[33mWaiting for session data...\x1b[0m",
        "",
      ].join("\r\n");

      term.writeln(welcomeMessage);
      term.focus();

      console.log(`🖥️ Terminal ready for session: ${ticket.substring(0, 8)}`);
    } else {
      console.warn(`⚠️ Terminal ready but session not found or not connected: ${ticket?.substring(0, 8)}`);
    }
  };

  const handleTerminalInput = (data: string) => {
    const session = currentSession();
    if (session?.sessionId) {
      invoke("send_terminal_input", {
        sessionId: session.sessionId,
        input: data,
      }).catch((error) => {
        console.error("Failed to send input:", error);
        session.terminal?.writeln(`\r\n❌ Failed to send input: ${error}`);
      });
    }
  };

  const handleDisconnect = async (ticketToDisconnect?: string) => {
    const ticket = ticketToDisconnect || currentSessionTicket();
    if (!ticket) return;

    await removeSession(ticket, "Disconnected by user");
  };

  const handleConnect = async (ticketOverride?: string) => {
    const ticket = (ticketOverride || sessionTicket()).trim();
    if (!ticket) {
      setConnectionError("Please enter a session ticket.");
      return;
    }

    // Check if this ticket is already connected or connecting
    const sessions = activeSessions();
    const existingSession = sessions.get(ticket);

    if (existingSession) {
      if (existingSession.status === "connected") {
        // Already connected to this ticket, just switch to it
        setCurrentSessionTicket(ticket);
        setCurrentView("terminal");
        setConnectionError(null);
        console.log(`🔄 Switched to existing session: ${ticket.substring(0, 8)}`);
        return;
      } else if (existingSession.status === "connecting") {
        // Already connecting to this ticket
        setConnectionError("Already connecting to this session.");
        return;
      } else if (existingSession.status === "failed") {
        // Remove failed session and retry
        console.log(`🔄 Retrying failed session: ${ticket.substring(0, 8)}`);
        await removeSession(ticket, "Retrying connection");
      }
    }

    // If a new ticket is used, add it to history
    if (!history().some((h) => h.ticket === ticket)) {
      addHistoryEntry(ticket);
    }

    // Create initial session state
    const initialSession: SessionState = {
      sessionId: "", // Will be set when connection succeeds
      ticket: ticket,
      status: "connecting",
      terminal: null,
      fitAddon: null,
      unlisten: null,
      connectTime: new Date(),
      retryCount: 0,
      terminalInfo: {
        sessionTitle: `Connecting to ${ticket.substring(0, 8)}...`,
        terminalType: "shell",
        workingDirectory: "~",
      },
    };

    // Add to sessions and update state
    const updatedSessions = new Map(sessions);
    updatedSessions.set(ticket, initialSession);
    setActiveSessions(updatedSessions);

    // Set as current session and switch to terminal view
    setCurrentSessionTicket(ticket);
    setCurrentView("terminal");
    setConnectionError(null);

    console.log(`🚀 Starting connection to: ${ticket.substring(0, 8)}`);

    try {
      const connectPromise = invoke<string>("connect_to_peer", {
        sessionTicket: ticket,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Connection timed out after 10 seconds")),
          10000 // Increased timeout for better reliability
        )
      );

      const actualSessionId = await Promise.race([
        connectPromise,
        timeoutPromise,
      ]);

      // Update session with successful connection
      updateSessionState(ticket, {
        sessionId: actualSessionId,
        status: "connected",
        connectTime: new Date(),
        lastError: undefined,
        terminalInfo: {
          sessionTitle: `Session ${ticket.substring(0, 8)}`,
          terminalType: "shell",
          workingDirectory: "~",
        },
      });

      // Set up event listener for this session
      const unlisten = await listen<any>(
        `terminal-event-${actualSessionId}`,
        (event) => {
          const termEvent = event.payload;
          console.log(`📜 [${ticket.substring(0, 8)}] Received terminal event:`, termEvent);

          const currentSessions = activeSessions();
          const session = currentSessions.get(ticket);

          if (session?.terminal && session.status === "connected") {
            try {
              if (termEvent.event_type === "Output") {
                session.terminal.write(termEvent.data);
              } else if (termEvent.event_type === "End") {
                console.log(`📝 [${ticket.substring(0, 8)}] Remote session ended`);
                // Mark as disconnected but don't auto-remove (let user decide)
                updateSessionState(ticket, {
                  status: "disconnected",
                  lastError: "Remote session ended",
                });
                session.terminal.writeln("\r\n\x1b[1;33m📝 Remote session ended\x1b[0m");
              } else if (termEvent.event_type === "HistoryData") {
                // 处理接收到的历史记录数据
                console.log(`📜 [${ticket.substring(0, 8)}] Received session history`);

                try {
                  const historyData = JSON.parse(termEvent.data);
                  const { logs, shell, cwd } = historyData;

                  // 更新终端信息
                  updateSessionState(ticket, {
                    terminalInfo: {
                      sessionTitle: `${shell} @ ${cwd}`,
                      terminalType: shell || "shell",
                      workingDirectory: cwd || "~",
                    },
                  });

                  // 在终端中显示历史记录
                  session.terminal.writeln(
                    "\r\n\x1b[1;36m📜 Session History Received\x1b[0m"
                  );
                  session.terminal.writeln(`\x1b[1;33mShell:\x1b[0m ${shell}`);
                  session.terminal.writeln(
                    `\x1b[1;33mWorking Directory:\x1b[0m ${cwd}`
                  );
                  session.terminal.writeln(
                    "\x1b[1;33m--- History Start ---\x1b[0m"
                  );
                  session.terminal.write(logs);
                  session.terminal.writeln(
                    "\x1b[1;33m--- History End ---\x1b[0m\r\n"
                  );

                  // 更新连接历史记录
                  updateHistoryEntry(ticket, {
                    description: `Connected with history (${shell} @ ${cwd})`,
                  });

                  console.log(
                    `✅ [${ticket.substring(0, 8)}] History displayed: ${logs.length} characters, Shell: ${shell}, CWD: ${cwd}`
                  );
                } catch (error) {
                  console.error(`❌ [${ticket.substring(0, 8)}] Failed to parse history data:`, error);
                  session.terminal.writeln(
                    "\r\n\x1b[1;31m❌ Failed to parse session history\x1b[0m\r\n"
                  );
                }
              }
            } catch (error) {
              console.error(`❌ [${ticket.substring(0, 8)}] Error processing terminal event:`, error);
            }
          } else if (!session) {
            console.warn(`⚠️ Received event for unknown session: ${ticket.substring(0, 8)}`);
          }
        }
      );

      // Update session with event listener
      updateSessionState(ticket, { unlisten });
      updateHistoryEntry(ticket, { description: "Connection established." });

      console.log(`✅ Connected successfully to session: ${ticket.substring(0, 8)}`);
    } catch (error) {
      console.error(`❌ Connection failed for ${ticket.substring(0, 8)}:`, error);

      const errorMessage = String(error);
      updateSessionState(ticket, {
        status: "failed",
        lastError: errorMessage,
      });

      updateHistoryEntry(ticket, {
        status: "Failed",
        description: errorMessage,
      });

      setConnectionError(errorMessage);

      // Auto-remove failed sessions after a delay
      setTimeout(async () => {
        const currentSession = activeSessions().get(ticket);
        if (currentSession?.status === "failed") {
          await removeSession(ticket, "Auto-removed failed connection");
        }
      }, 5000);
    }
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
    history().find((entry) => entry.ticket === activeTicket())
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
        transition:
          "height 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        overflow: "hidden", // 防止滚动
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
          transition:
            "height 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Mobile Navigation */}
        <MobileNavigation
          currentView={currentView()}
          onViewChange={setCurrentView}
          isConnected={isConnected()}
          networkStrength={networkStrength()}
          status={getSessionDisplayInfo().status}
          currentTime={currentTime()}
          onDisconnect={() => handleDisconnect()}
          onShowSettings={() => setIsSettingsOpen(true)}
        />

        {/* Debug Info - 开发时显示 */}
        {/* {window.location.hostname === "localhost" && ( */}
        {/*   <div class="bg-yellow-100 text-black text-xs p-2 border-b shrink-0"> */}
        {/*     Debug: {debugInfo()} | KB: {keyboardVisible() ? "Yes" : "No"} | */}
        {/*     EffectiveVH: {effectiveViewportHeight()}px | KH: {keyboardHeight()} */}
        {/*     px */}
        {/*   </div> */}
        {/* )} */}

        {/* Session Tabs - Show when multiple sessions are active */}
        {activeSessions().size > 1 && currentView() === "terminal" && (
          <div class="bg-gray-800 border-b border-gray-700 px-2 py-1 flex gap-1 overflow-x-auto">
            <For each={sessionsList()}>
              {(session) => (
                <button
                  class={`px-3 py-1 text-xs rounded-t-lg border-b-2 whitespace-nowrap flex items-center gap-2 ${currentSessionTicket() === session.ticket
                    ? "bg-gray-700 border-blue-500 text-white"
                    : session.status === "connected"
                      ? "bg-gray-900 border-transparent text-gray-300 hover:text-white hover:bg-gray-800"
                      : session.status === "connecting"
                        ? "bg-yellow-900 border-yellow-500 text-yellow-200 animate-pulse"
                        : "bg-red-900 border-red-500 text-red-200"
                    }`}
                  onClick={() => session.status === "connected" && setCurrentSessionTicket(session.ticket)}
                  disabled={session.status !== "connected"}
                  title={`${session.terminalInfo.sessionTitle} - ${session.status}`}
                >
                  <div class="flex items-center space-x-1">
                    {session.status === "connecting" && (
                      <div class="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                    )}
                    {session.status === "connected" && (
                      <div class="w-2 h-2 bg-green-400 rounded-full"></div>
                    )}
                    {session.status === "failed" && (
                      <div class="w-2 h-2 bg-red-400 rounded-full"></div>
                    )}
                    {session.status === "disconnected" && (
                      <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
                    )}
                    <span class="truncate max-w-24">{session.terminalInfo.sessionTitle}</span>
                  </div>
                  <button
                    class="text-red-400 hover:text-red-300 ml-1 opacity-70 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDisconnect(session.ticket);
                    }}
                    title="Close session"
                  >
                    ×
                  </button>
                </button>
              )}
            </For>
          </div>
        )}

        {/* Main Content */}
        <div
          class="flex-1 overflow-hidden" // 改为overflow-hidden防止滚动问题
          style={{
            height: keyboardVisible()
              ? `${effectiveViewportHeight() - (activeSessions().size > 1 && currentView() === "terminal" ? 100 : 60)}px` // 导航栏高度约60px，标签栏40px
              : "auto",
            "max-height": keyboardVisible()
              ? `${effectiveViewportHeight() - (activeSessions().size > 1 && currentView() === "terminal" ? 100 : 60)}px`
              : "none",
            transition:
              "height 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {currentView() === "terminal" && isConnected() && currentSession() ? (
            <EnhancedTerminalView
              onReady={handleTerminalReady}
              onInput={handleTerminalInput}
              isConnected={isConnected()}
              onDisconnect={() => handleDisconnect()}
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
              // 新增标签页支持 - 使用新的会话状态管理
              sessionTabs={sessionsList().map((session) => ({
                id: session.ticket,
                ticket: session.ticket,
                title: session.terminalInfo.sessionTitle,
                terminalType: session.terminalInfo.terminalType,
                workingDirectory: session.terminalInfo.workingDirectory,
                isActive: session.ticket === currentSessionTicket(),
              }))}
              currentSessionId={currentSessionTicket() || undefined}
              onTabSwitch={(sessionId) => {
                setCurrentSessionTicket(sessionId);
                console.log("Switched to session:", sessionId);
              }}
              onTabClose={(sessionId) => {
                handleDisconnect(sessionId);
                console.log("Closed session:", sessionId);
              }}
              enableTabSwitching={activeSessions().size > 1}
            />
          ) : (
            <HomeView
              sessionTicket={sessionTicket()}
              onTicketInput={setSessionTicket}
              onConnect={handleConnect}
              onShowSettings={() => setIsSettingsOpen(true)}
              connecting={isConnecting()}
              connectionError={connectionError()}
              history={history()}
              isLoggedIn={isLoggedIn()}
              onLogin={handleLogin}
              onSkipLogin={handleSkipLogin}
              isConnected={isConnected()}
              activeTicket={activeTicket()}
              onReturnToSession={() => {
                if (activeSessions().size > 0) {
                  const firstSession = Array.from(activeSessions().keys())[0];
                  setCurrentSessionTicket(firstSession);
                  setCurrentView("terminal");
                }
              }}
              onDeleteHistory={deleteHistoryEntry}
              onDisconnect={handleDisconnect}
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
    </div>
  );
}

export default App;
