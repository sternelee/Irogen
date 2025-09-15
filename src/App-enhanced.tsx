// 在 App.tsx 中的改进版本
// 替换现有的 handleConnect 函数

import { createConnectionHandler } from "./hooks/useConnection";
import { ConnectionProgressModal } from "./components/ConnectionProgress";

// 在 App 函数内部添加连接处理器
function App() {
  // ... 现有的状态和信号 ...

  // 替换现有的连接相关状态
  const {
    connect,
    abort: abortConnection,
    connecting,
    connectionProgress,
    connectionError,
    setConnectionError
  } = createConnectionHandler();

  // ... 其他现有代码 ...

  // 改进的连接处理函数
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

    setStatus(t("connection.status.connecting"));

    try {
      // 使用新的连接处理器，支持进度监控和重试
      const actualSessionId = await connect(ticket, {
        timeout: 15000, // 15秒超时
        retries: 2,     // 重试2次
        onProgressUpdate: (progress) => {
          // 可选：在终端中显示连接进度
          if (terminalInstance && progress.phase === "retrying") {
            terminalInstance.writeln(
              `\\r\\n\\x1b[1;33m🔄 Retrying connection (attempt ${progress.attempt})...\\x1b[0m`
            );
          }
        }
      });

      sessionIdRef = actualSessionId;
      setActiveTicket(ticket);
      setIsConnected(true);
      setCurrentView("terminal");
      updateHistoryEntry(ticket, { description: "Connection established." });

      // 设置事件监听器
      const unlisten = await listen<any>(
        `terminal-event-${actualSessionId}`,
        (event) => {
          const termEvent = event.payload;
          if (terminalInstance) {
            if (termEvent.event_type === "Output") {
              terminalInstance.write(termEvent.data);
            } else if (termEvent.event_type === "End") {
              // 处理会话结束
            } else if (termEvent.event_type === "HistoryData") {
              // 处理历史数据
              try {
                const historyData = JSON.parse(termEvent.data);
                const { logs, shell, cwd } = historyData;

                setTerminalInfo({
                  sessionTitle: `Remote Shell`,
                  terminalType: shell || "shell",
                  workingDirectory: cwd || "~",
                });

                terminalInstance.writeln(
                  "\\r\\n\\x1b[1;36m📜 Session History Received\\x1b[0m"
                );
                terminalInstance.writeln(`\\x1b[1;33mShell:\\x1b[0m ${shell}`);
                terminalInstance.writeln(
                  `\\x1b[1;33mWorking Directory:\\x1b[0m ${cwd}`
                );
                terminalInstance.writeln(
                  "\\x1b[1;33m--- History Start ---\\x1b[0m"
                );
                terminalInstance.write(logs);
                terminalInstance.writeln(
                  "\\x1b[1;33m--- History End ---\\x1b[0m\\r\\n"
                );

                updateHistoryEntry(ticket, {
                  description: `Connected with history (Shell: ${shell}, CWD: ${cwd})`,
                });
              } catch (error) {
                console.error("Failed to parse history data:", error);
                terminalInstance.writeln(
                  "\\r\\n\\x1b[1;31m❌ Failed to parse session history\\x1b[0m\\r\\n"
                );
              }
            }
          }
        }
      );

      unlistenRef = unlisten;
      setStatus(t("connection.status.connected"));
      setNetworkStrength(4);
      terminalInstance?.clear();
      terminalInstance?.writeln(
        "\\r\\n\\x1b[1;32m🚀 P2P Connection established!\\x1b[0m"
      );
      terminalInstance?.focus();

    } catch (error) {
      console.error("Connection failed:", error);
      setStatus(t("connection.status.failed"));
      updateHistoryEntry(ticket, {
        status: "Failed",
        description: String(error),
      });
      setNetworkStrength(1);

      // 在终端中显示详细错误信息
      if (terminalInstance) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes("timed out")) {
          terminalInstance.writeln(
            "\\r\\n\\x1b[1;31m⏰ Connection timed out. Please check:\\x1b[0m"
          );
          terminalInstance.writeln("  • Network connectivity");
          terminalInstance.writeln("  • Session ticket validity");
          terminalInstance.writeln("  • Host availability");
        } else {
          terminalInstance.writeln(
            `\\r\\n\\x1b[1;31m❌ Connection failed: ${errorMessage}\\x1b[0m`
          );
        }
      }
    }
  };

  // 改进的断开连接处理
  const handleDisconnect = async () => {
    // 中止正在进行的连接尝试
    abortConnection();

    if (terminalInstance) {
      terminalInstance.writeln(
        "\\r\\n\\x1b[1;33m👋 Disconnected from session\\x1b[0m"
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

  // ... 其他现有代码 ...

  return (
    <div
      class="w-full font-mono mobile-viewport"
      data-theme="riterm-mobile"
      // ... 现有样式 ...
    >
      {/* 现有的P2P背景和导航 */}

      {/* 添加连接进度模态框 */}
      <ConnectionProgressModal
        progress={connectionProgress()}
        show={connecting()}
      />

      {/* 现有的主要内容 */}
      <div class="relative z-20 w-full flex flex-col overflow-hidden">
        {/* 现有的导航和内容 */}

        {/* 在HomeView中也可以显示内联进度 */}
        {currentView() === "home" && (
          <HomeView
            sessionTicket={sessionTicket()}
            onTicketInput={setSessionTicket}
            onConnect={handleConnect}
            connecting={connecting()}
            connectionError={connectionError()}
            // ... 其他现有props ...
          />
        )}
      </div>
    </div>
  );
}