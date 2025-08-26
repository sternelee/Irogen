import {
  createSignal,
  createEffect,
  onMount,
  createMemo,
  onCleanup,
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
  const [currentView, setCurrentView] = createSignal<"home" | "terminal">(
    "home",
  );
  const [currentTime, setCurrentTime] = createSignal(
    new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  );

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
    // Initialize enhanced mobile utilities
    initializeMobileUtils();

    // Time update timer
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }, 1000);

    // Enhanced keyboard visibility tracking with the new mobile utilities
    const unsubscribeKeyboard = MobileKeyboard.onVisibilityChange(
      (visible: boolean, keyboardInfo?: KeyboardInfo) => {
        setKeyboardVisible(visible);

        if (keyboardInfo) {
          setKeyboardHeight(keyboardInfo.height);
          setEffectiveViewportHeight(
            keyboardInfo.viewportHeight - (keyboardInfo.viewportOffsetTop || 0),
          );

          // Enhanced debug info
          setDebugInfo(
            `Keyboard: ${visible ? "Visible" : "Hidden"}, ` +
            `Height: ${keyboardInfo.height}px, ` +
            `Viewport: ${keyboardInfo.viewportHeight}px, ` +
            `Effective: ${keyboardInfo.viewportHeight - (keyboardInfo.viewportOffsetTop || 0)}px`,
          );
        } else {
          setKeyboardHeight(0);
          setEffectiveViewportHeight(window.innerHeight);
          setDebugInfo("Keyboard: Hidden");
        }
      },
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

  onMount(() => {
    // 初始化网络
    initializeNetwork();
  });

  const handleTerminalReady = (term: Terminal, addon: FitAddon) => {
    terminalInstance = term;
    fitAddon = addon;
    window.addEventListener("resize", () => addon.fit());
  };

  const handleTerminalInput = (data: string) => {
    if (isConnected() && sessionIdRef) {
      invoke("send_terminal_input", {
        sessionId: sessionIdRef,
        input: data,
      }).catch((error) => {
        console.error("Failed to send input:", error);
        terminalInstance?.writeln(`\r\n❌ Failed to send input: ${error}`);
      });
    }
  };

  const handleDisconnect = async () => {
    if (terminalInstance) {
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

    if (sessionIdRef) {
      try {
        await invoke("disconnect_session", { sessionId: sessionIdRef });
      } catch (error) {
        console.error("Failed to disconnect:", error);
      }
    }

    if (unlistenRef) {
      unlistenRef();
      unlistenRef = null;
    }

    setIsConnected(false);
    sessionIdRef = null;
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
      const connectPromise = invoke<string>("connect_to_peer", {
        sessionTicket: ticket,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Connection timed out after 5 seconds")),
          5000,
        ),
      );

      const actualSessionId = await Promise.race([
        connectPromise,
        timeoutPromise,
      ]);

      sessionIdRef = actualSessionId;
      setActiveTicket(ticket);
      setIsConnected(true);
      setCurrentView("terminal");
      updateHistoryEntry(ticket, { description: "Connection established." });

      const unlisten = await listen<any>(
        `terminal-event-${actualSessionId}`,
        (event) => {
          const termEvent = event.payload;
          console.log("📜 Received terminal event:", termEvent);
          if (terminalInstance) {
            if (termEvent.event_type === "Output") {
              terminalInstance.write(termEvent.data);
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

                // 更新连接历史记录
                updateHistoryEntry(ticket, {
                  description: `Connected with history (Shell: ${shell}, CWD: ${cwd})`,
                });

                console.log(
                  `✅ History displayed: ${logs.length} characters, Shell: ${shell}, CWD: ${cwd}`,
                );
              } catch (error) {
                console.error("❌ Failed to parse history data:", error);
                terminalInstance.writeln(
                  "\r\n\x1b[1;31m❌ Failed to parse session history\x1b[0m\r\n",
                );
              }
            }
          }
        },
      );

      unlistenRef = unlisten;
      setStatus(t("connection.status.connected"));
      setNetworkStrength(4);
      terminalInstance?.clear();
      terminalInstance?.writeln(
        "\r\n\x1b[1;32m🚀 P2P Connection established!\x1b[0m",
      );
      terminalInstance?.focus();
    } catch (error) {
      console.error("Connection failed:", error);
      setStatus(t("connection.status.failed"));
      updateHistoryEntry(ticket, {
        status: "Failed",
        description: String(error),
      });
      setConnectionError(String(error));
      setNetworkStrength(1);
    } finally {
      setConnecting(false);
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
          status={status()}
          currentTime={currentTime()}
          onDisconnect={handleDisconnect}
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

        {/* Main Content */}
        <div
          class="flex-1 overflow-hidden" // 改为overflow-hidden防止滚动问题
          style={{
            height: keyboardVisible()
              ? `${effectiveViewportHeight() - 60}px` // 导航栏高度约60px
              : "auto",
            "max-height": keyboardVisible()
              ? `${effectiveViewportHeight() - 60}px`
              : "none",
            transition:
              "height 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {currentView() === "terminal" && isConnected() ? (
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
            />
          ) : (
            <HomeView
              sessionTicket={sessionTicket()}
              onTicketInput={setSessionTicket}
              onConnect={handleConnect}
              onShowSettings={() => setIsSettingsOpen(true)}
              connecting={connecting()}
              connectionError={connectionError()}
              history={history()}
              isLoggedIn={isLoggedIn()}
              onLogin={handleLogin}
              onSkipLogin={handleSkipLogin}
              isConnected={isConnected()}
              activeTicket={activeTicket()}
              onReturnToSession={() => setCurrentView("terminal")}
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
