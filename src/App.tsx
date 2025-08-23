import { createSignal, createEffect, onMount, createMemo } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "xterm-addon-fit";
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
import { settingsStore, t } from "./stores/settingsStore";

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

  let sessionIdRef: string | null = null;
  let terminalInstance: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let unlistenRef: (() => void) | null = null;

  const { history, addHistoryEntry, updateHistoryEntry, deleteHistoryEntry } =
    createConnectionHistory();

  // 更新时间
  onMount(() => {
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }, 1000);

    return () => clearInterval(timer);
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
          if (terminalInstance) {
            if (termEvent.event_type === "Output") {
              terminalInstance.write(termEvent.data);
            } else if (termEvent.event_type === "End") {
              terminalInstance.writeln("\r\n\r\n[Session Ended]");
              handleDisconnect();
            } else if (termEvent.event_type === "HistoryData") {
              // 处理接收到的历史记录数据
              console.log("📜 Received session history:", termEvent.data);

              // 解析历史记录数据
              try {
                const historyData = JSON.parse(termEvent.data);
                const { logs, shell, cwd } = historyData;

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
    <div class="w-full h-screen font-mono" data-theme="riterm-mobile">
      {/* P2P Background */}
      <P2PBackground />

      {/* Main Layout - Mobile First */}
      <div class="relative z-20 w-full h-screen flex flex-col overflow-hidden">
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

        {/* Main Content */}
        <div class="flex-1 overflow-auto">
          {currentView() === "terminal" && isConnected() ? (
            <EnhancedTerminalView
              onReady={handleTerminalReady}
              onInput={handleTerminalInput}
              isConnected={isConnected()}
              onDisconnect={handleDisconnect}
              onShowKeyboard={() => {
                /* TODO: Implement mobile keyboard */
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
