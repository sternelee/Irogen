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
import { Toaster } from "solid-toast";
import "./App.css";
import { SettingsModal } from "./components/SettingsModal";
import { HomeView } from "./components/HomeView";
import { RemoteSessionView } from "./components/RemoteSessionView";
import { P2PBackground } from "./components/P2PBackground";
import { t } from "./stores/settingsStore";
import {
  getDeviceCapabilities,
  MobileKeyboard,
  KeyboardInfo,
} from "./utils/mobile";
import { getViewportManager } from "./utils/mobile/ViewportManager";
import type { ViewportDimensions } from "./utils/mobile/ViewportManager";

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
  const [currentView, setCurrentView] = createSignal<"home" | "remote" | "terminal">(
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

  let sessionIdRef: string | null = null;
  let terminalInstance: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let unlistenRef: (() => void) | null = null;


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

    // Clean up history data from localStorage
    try {
      localStorage.removeItem("riterm-connection-history");
    } catch (error) {
      console.log("Failed to clean up history data:", error);
    }
  });

  const handleDisconnect = async () => {
    if (terminalInstance && !(terminalInstance as any)._isDisposed) {
      terminalInstance.writeln(
        "\r\n\x1b[1;33m👋 Disconnected from session\x1b[0m",
      );
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
      setCurrentView("remote");

      const unlisten = await listen<any>(
        `terminal-event-${actualSessionId}`,
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

      // 其他错误正常处理
      setStatus(t("connection.status.failed"));
      setConnectionError(errorMessage);
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


  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#f3f4f6',
            border: '1px solid #374151',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#ffffff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#ffffff',
            },
          },
        }}
      />
      <div
        class="w-full font-mono mobile-viewport"
        data-theme="dark"
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
              connecting={connecting()}
              connectionError={connectionError()}
              isLoggedIn={isLoggedIn()}
              onLogin={handleLogin}
              onSkipLogin={handleSkipLogin}
              isConnected={isConnected()}
              activeTicket={activeTicket()}
              onReturnToSession={() => setCurrentView("remote")}
              onDisconnect={handleDisconnect}
            />
          )}

          {currentView() === "remote" && isConnected() && sessionIdRef && (
            <RemoteSessionView
              sessionId={sessionIdRef}
              onDisconnect={handleDisconnect}
              onBack={() => setCurrentView("home")}
            />
          )}

        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen()}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
    </>
  );
}

export default App;
