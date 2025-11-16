import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { getDeviceCapabilities } from "../stores/deviceStore";
import { useTerminalSessions } from "../stores/terminalSessionStore";
import { useTerminalSession } from "../hooks/useTerminalSession";
import { MobileKeyboard } from "../utils/mobile";
// Import types from the shared library
interface TerminalInfo {
  id: string;
  name?: string;
  shell_type: string;
  current_dir: string;
  status: "Starting" | "Running" | "Paused" | "Stopped" | string;
  created_at: number;
  last_activity: number;
  size: [number, number];
  process_id?: number;
}

interface RemoteSessionViewProps {
  sessionId: string;
  onDisconnect: () => void;
  onBack: () => void;
}

interface TerminalSession {
  terminalId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  canvasAddon: CanvasAddon;
  isActive: boolean;
  terminalSession?: ReturnType<typeof useTerminalSession>;
  inputBuffer?: string;
  sendTimeout?: ReturnType<typeof setTimeout> | null;
  localInputLength?: number; // 记录本次本地输入的字符数
  hasPendingInput?: boolean; // 是否有待发送的输入
  smartCtrlCHandler?: SmartCtrlCHandler; // 智能 Ctrl+C 处理器
}

// 截断路径，显示末尾部分，前面用...省略
const truncatePath = (path: string, maxLength: number = 24): string => {
  if (path.length <= maxLength) return path;
  return "..." + path.slice(-(maxLength - 3));
};

// 智能 Ctrl+C 处理器
class SmartCtrlCHandler {
  private lastCtrlCTime: number = 0;
  private pendingCtrlCCount: number = 0;
  private readonly rapidPressThreshold = 500; // 500ms内视为快速连按
  private readonly maxRetries = 3;

  constructor(private onSendData: (data: string) => void) { }

  handleCtrlC(): void {
    const now = Date.now();
    const timeSinceLastCtrlC = now - this.lastCtrlCTime;

    // 检测快速连按
    if (timeSinceLastCtrlC < this.rapidPressThreshold) {
      this.pendingCtrlCCount++;
      console.log(
        `🔄 检测到快速连按 Ctrl+C (第 ${this.pendingCtrlCCount + 1} 次)`,
      );

      // 如果是第三次或更多次快速连按，发送更强力的中断信号
      if (this.pendingCtrlCCount >= this.maxRetries - 1) {
        console.log("🚨 发送强力的中断信号序列");
        this.sendForcefulInterrupt();
        this.reset();
        return;
      }
    } else {
      this.pendingCtrlCCount = 0;
    }

    this.lastCtrlCTime = now;

    // 发送标准的 Ctrl+C 信号
    console.log("⚡ 发送 Ctrl+C 信号");
    this.onSendData("\x03");

    // 设置延迟检查，看看是否需要重试
    setTimeout(() => {
      this.checkRetryNeeded();
    }, 1000);
  }

  private checkRetryNeeded(): void {
    // 这个方法可以结合终端输出来判断是否需要重试
    // 目前简化为如果有待处理的 Ctrl+C 计数，则自动重试
    if (this.pendingCtrlCCount > 0) {
      console.log("🔄 检测到可能需要重试中断");
      setTimeout(() => {
        if (this.pendingCtrlCCount > 0) {
          console.log("🔁 自动重试发送 Ctrl+C");
          this.onSendData("\x03");
          this.pendingCtrlCCount--;
        }
      }, 500);
    }
  }

  private sendForcefulInterrupt(): void {
    // 发送更强力的中断序列：多次 Ctrl+C + Ctrl+Z + Ctrl+D
    const interruptSequence = "\x03\x03\x1a\x04"; // Ctrl+C Ctrl+C Ctrl+Z Ctrl+D
    this.onSendData(interruptSequence);
  }

  private reset(): void {
    this.pendingCtrlCCount = 0;
    this.lastCtrlCTime = 0;
  }

  resetOnOutput(): void {
    // 当检测到新的终端输出时，重置状态
    if (Date.now() - this.lastCtrlCTime > 2000) {
      this.reset();
    }
  }
}

export function RemoteSessionView(props: RemoteSessionViewProps) {
  const [terminals, setTerminals] = createSignal<TerminalInfo[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [terminalSessions, setTerminalSessions] = createSignal<
    Map<string, TerminalSession>
  >(new Map());
  const [activeTerminalId, setActiveTerminalId] = createSignal<string | null>(
    null,
  );

  // 创建发送输入到远程终端的函数
  const sendBufferedInput = (
    sessionId: string,
    terminalId: string,
    session: TerminalSession,
  ) => {
    if (session.inputBuffer && session.inputBuffer.length > 0) {
      const dataToSend = session.inputBuffer;
      session.inputBuffer = ""; // 清空缓冲区
      session.hasPendingInput = false; // 重置待发送标记
      // 注意：保留 localInputLength，用于远程输出去重

      console.log("Sending buffered input:", dataToSend);
      invoke("send_terminal_input_to_terminal", {
        sessionId: sessionId,
        terminalId: terminalId,
        input: dataToSend,
      }).catch((error) => {
        console.error("Failed to send terminal input:", error);
        // 发送失败时重置标记
        session.hasPendingInput = false;
        session.localInputLength = 0;
      });
    }
  };

  // 全局会话管理
  const terminalSessionManager = useTerminalSessions();

  // 创建终端相关状态
  const [terminalName, setTerminalName] = createSignal("");

  // 移动端下拉菜单状态
  const [showTerminalMenu, setShowTerminalMenu] = createSignal(false);
  const [showMainMenu, setShowMainMenu] = createSignal(false);
  const [showAddMenu, setShowAddMenu] = createSignal(false);
  const [showCreateTerminalModal, setShowCreateTerminalModal] = createSignal(false);
  const [showTcpForwardingModal, setShowTcpForwardingModal] = createSignal(false);

  // AI Chat 相关状态
  const [aiChatInput, setAiChatInput] = createSignal("");
  const [, setAiChatFocused] = createSignal(false);
  const [chatMessages, setChatMessages] = createSignal<
    Array<{
      id: string;
      role: "user" | "ai";
      content: string;
      timestamp: number;
      command?: string;
    }>
  >([]);
  const [isAiThinking, setIsAiThinking] = createSignal(false);
  const [showChatHistory, setShowChatHistory] = createSignal(false);

  // OpenAI 响应相关状态
  const [aiResponse, setAiResponse] = createSignal<{
    commands: Array<{
      id: string;
      command: string;
      description: string;
      explanation: string;
    }>;
    explanation: string;
  } | null>(null);

  // 侧边栏标签页状态
  const [activeSidebarTab, setActiveSidebarTab] = createSignal<
    "terminals" | "services"
  >("terminals");

  // 侧边栏状态
  const [sidebarOpen, setSidebarOpen] = createSignal(true); // 默认开启，由CSS控制响应式

  // TCP 转发相关状态
  const [tcpSessions, setTcpSessions] = createSignal<
    Array<{
      id: string;
      local_addr: string;
      remote_target: string;
      forwarding_type: string;
      active_connections: number;
      bytes_sent: number;
      bytes_received: number;
      status: string;
      created_at: number;
    }>
  >([]);
  const [tcpRemotePort, setTcpRemotePort] = createSignal("");
  const [tcpLocalAddr, setTcpLocalAddr] = createSignal("127.0.0.1:8080");
  const [tcpRemoteHost, setTcpRemoteHost] = createSignal("127.0.0.1");
  const [tcpForwardingType, setTcpForwardingType] = createSignal<"ListenToRemote" | "ConnectToRemote">("ConnectToRemote");

  // 系统信息相关状态
  const [systemInfo] = createSignal<{
    os_info: {
      name: string;
      version: string;
      arch: string;
    };
    shell_info: {
      shell_type: string;
      shell_path: string;
      version?: string;
    };
    available_tools: {
      package_managers: string[];
      editors: string[];
      search_tools: string[];
      version_control: string[];
      development_tools: string[];
    };
    environment_vars: Record<string, string>;
    architecture: string;
    hostname: string;
    user_info: {
      username: string;
      home_dir: string;
    };
  } | null>(null);

  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;

  let containerRef: HTMLDivElement | undefined;
  let terminalContainerRef: HTMLDivElement | undefined;

  // 发送快捷键到终端
  const sendShortcut = (key: string) => {
    const activeId = activeTerminalId();
    if (!activeId) return;

    const sessions = terminalSessions();
    const session = sessions.get(activeId);
    if (!session) return;

    // 映射快捷键到终端控制字符
    const keyMap: Record<string, string> = {
      esc: "\x1b", // ESC
      tab: "\t", // Tab
      enter: "\r", // Enter/Return
      up: "\x1b[A", // Up arrow
      down: "\x1b[B", // Down arrow
      left: "\x1b[D", // Left arrow
      right: "\x1b[C", // Right arrow
      "ctrl-c": "\x03", // Ctrl+C
      "ctrl-t": "\x14", // Ctrl+T
      "ctrl-d": "\x04", // Ctrl+D
      "ctrl-z": "\x1a", // Ctrl+Z
      "ctrl-l": "\x0c", // Ctrl+L (clear)
    };

    const data = keyMap[key];
    if (data) {
      // 发送到后端终端
      invoke("send_terminal_input_to_terminal", {
        sessionId: props.sessionId,
        terminalId: activeId,
        input: data,
      }).catch((error) => {
        console.error("Failed to send terminal input:", error);
      });
    }
  };

  // 获取终端列表
  const fetchTerminals = async () => {
    try {
      await invoke("get_terminal_list", { sessionId: props.sessionId });
    } catch (error) {
      console.error("Failed to fetch terminal list:", error);
    }
  };

  // 打开 TCP 转发对话框
  const openTcpDialog = () => {
    setTcpLocalAddr("127.0.0.1:8080");
    setTcpRemoteHost("127.0.0.1");
    setTcpRemotePort("3000");
    setTcpForwardingType("ConnectToRemote");
    setShowTcpForwardingModal(true);
    setShowAddMenu(false);
  };

  // 确认创建 TCP 转发
  const confirmCreateTcpForwarding = async () => {
    try {
      await invoke("create_tcp_forwarding_session", {
        sessionId: props.sessionId,
        localAddr: tcpLocalAddr(),
        remoteHost: tcpRemoteHost() || undefined,
        remotePort: tcpRemotePort() ? parseInt(tcpRemotePort()) : undefined,
        forwardingType: tcpForwardingType()
      });

      setShowTcpForwardingModal(false);

      // 延迟刷新列表
      setTimeout(() => loadTcpSessions(), 500);
    } catch (error) {
      console.error("Failed to create TCP forwarding session:", error);
      alert("创建 TCP 转发会话失败: " + error);
    }
  };

  // 加载 TCP 转发会话列表
  const loadTcpSessions = async () => {
    try {
      await invoke("list_tcp_forwarding_sessions", { sessionId: props.sessionId });
    } catch (error) {
      console.error("Failed to load TCP forwarding sessions:", error);
    }
  };

  // 停止 TCP 转发会话
  const stopTcpSession = async (tcpSessionId: string) => {
    try {
      await invoke("stop_tcp_forwarding_session", {
        sessionId: props.sessionId,
        tcpSessionId
      });

      // 延迟刷新列表
      setTimeout(() => loadTcpSessions(), 500);
    } catch (error) {
      console.error("Failed to stop TCP forwarding session:", error);
      alert("停止 TCP 转发会话失败: " + error);
    }
  };

  // 格式化字节数
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // 格式化日期
  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  // 计算终端大小（基于容器宽度）
  const calculateTerminalSize = () => {
    if (!containerRef) {
      return { rows: 24, cols: 80 }; // 默认值
    }

    const width = containerRef.offsetWidth - 32; // 减去 padding
    const height = containerRef.offsetHeight - 100; // 减去标题栏等

    // 假设每个字符约 9px 宽，14px 高
    const cols = Math.floor(width / 9);
    const rows = Math.floor(height / 14);

    return {
      rows: Math.max(rows, 24),
      cols: Math.max(cols, 80),
    };
  };

  // 打开创建终端对话框
  const openCreateDialog = () => {
    setTerminalName("");
    setShowCreateTerminalModal(true);
    setShowAddMenu(false);
  };

  // 确认创建终端
  const confirmCreateTerminal = async () => {
    const size = calculateTerminalSize();
    await createTerminal({
      name: terminalName() || undefined,
      rows: size.rows,
      cols: size.cols,
    });
    setShowCreateTerminalModal(false);
  };

  // 创建新终端
  const createTerminal = async (config?: {
    name?: string;
    shell_path?: string;
    working_dir?: string;
    rows?: number;
    cols?: number;
  }) => {
    try {
      const terminalId = await invoke<string>("create_terminal", {
        sessionId: props.sessionId,
        name: config?.name,
        shell_path: config?.shell_path,
        working_dir: config?.working_dir,
        size:
          config?.rows && config?.cols ? [config.rows, config.cols] : undefined,
      });

      // 创建会话记录
      const session = terminalSessionManager.getSession(props.sessionId);
      if (session) {
        terminalSessionManager.updateSession(props.sessionId, {
          status: "Running",
          lastActivity: Date.now(),
        });
      }

      return terminalId;
    } catch (error) {
      console.error("Failed to create terminal:", error);
      throw error;
    }
  };

  // 停止终端
  const stopTerminal = async (terminalId: string) => {
    try {
      await invoke("stop_terminal", {
        sessionId: props.sessionId,
        terminalId: terminalId,
      });

      // 清理本地终端会话
      const sessions = terminalSessions();
      const session = sessions.get(terminalId);
      if (session) {
        // 先发送剩余的缓冲数据
        sendBufferedInput(props.sessionId, terminalId, session);

        // 清理定时器
        if (session.sendTimeout) {
          clearTimeout(session.sendTimeout);
        }

        // 清理终端
        session.terminal.dispose();
        const newSessions = new Map(sessions);
        newSessions.delete(terminalId);
        setTerminalSessions(newSessions);
      }

      if (activeTerminalId() === terminalId) {
        setActiveTerminalId(null);
      }
    } catch (error) {
      console.error("Failed to stop terminal:", error);
    }
  };

  // 连接到终端
  const connectToTerminal = async (terminalId: string) => {
    try {
      // 检查是否已有该终端的会话
      const sessions = terminalSessions();
      if (sessions.has(terminalId)) {
        setActiveTerminalId(terminalId);
        terminalSessionManager.setActiveTerminal(terminalId);
        // 重新 fit 终端以确保正确显示
        const existingSession = sessions.get(terminalId);
        if (existingSession && terminalContainerRef) {
          setTimeout(() => {
            try {
              existingSession.fitAddon.fit();
            } catch (error) {
              console.error("Error refitting existing terminal:", error);
            }
          }, 100);
        }
        return;
      }

      // 创建新的终端实例
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: "#000000",
          foreground: "#ffffff",
          cursor: "#ffffff",
          selection: "#ffffff40",
        },
        scrollback: 1000,
        convertEol: true,
        allowProposedApi: true,
        rows: 30, // 增加默认行数
        cols: 100, // 增加默认列数
      } as any);

      const fitAddon = new FitAddon();
      const canvasAddon = new CanvasAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(canvasAddon);

      // 创建终端会话
      const terminalSession: TerminalSession = {
        terminalId,
        terminal,
        fitAddon,
        canvasAddon,
        isActive: true,
        inputBuffer: "",
        sendTimeout: null,
        localInputLength: 0,
        hasPendingInput: false,
      };

      // 创建智能 Ctrl+C 处理器
      const createSmartCtrlCHandler = (onSendData: (data: string) => void) => {
        return new SmartCtrlCHandler(onSendData);
      };

      // 添加到会话映射
      const newSessions = new Map(sessions);
      newSessions.set(terminalId, terminalSession);
      setTerminalSessions(newSessions);
      setActiveTerminalId(terminalId);

      // 获取或创建会话记录
      let session = terminalSessionManager.getSession(terminalId);
      if (!session) {
        // 从终端信息创建会话记录
        const terminalInfo = terminals().find((t) => t.id === terminalId);
        if (terminalInfo) {
          terminalSessionManager.addSession({
            terminalId,
            sessionId: props.sessionId,
            name: terminalInfo.name,
            shellType: terminalInfo.shell_type,
            currentDir: terminalInfo.current_dir,
            status: "Running",
            createdAt: Date.now(),
            size: terminalInfo.size,
            processId: terminalInfo.process_id,
          });
          session = terminalSessionManager.getSession(terminalId);
        }
      }

      // 设置活动终端
      terminalSessionManager.setActiveTerminal(terminalId);

      // 初始化终端会话Hook
      const terminalSessionHook = useTerminalSession(
        terminal,
        () => terminalId,
        {
          saveInterval: 3000,
          maxContentLength: 5000,
        },
      );

      // 创建智能 Ctrl+C 处理器
      const smartCtrlCHandler = createSmartCtrlCHandler((data: string) => {
        console.log("🔗 Smart Ctrl+C Handler sending:", JSON.stringify(data));
        // 创建临时会话对象发送数据
        const tempSession = { ...terminalSession, inputBuffer: data };
        sendBufferedInput(props.sessionId, terminalId, tempSession);
      });

      // 将智能处理器添加到终端会话
      terminalSession.smartCtrlCHandler = smartCtrlCHandler;

      // 设置终端数据处理器
      terminal.onData((data) => {
        console.log("data:", data);

        // 特殊处理 Ctrl+C
        if (data === "\x03") {
          console.log("🎯 检测到 Ctrl+C 输入");
          smartCtrlCHandler.handleCtrlC();
          // 立即在本地显示
          terminal.write(data);
          return;
        }

        // 累积输入到会话缓冲区
        terminalSession.inputBuffer += data;
        terminalSession.localInputLength =
          (terminalSession.localInputLength || 0) + data.length;
        terminalSession.hasPendingInput = true;

        // 立即在本地显示所有输入以保持响应性
        terminal.write(data);
        console.log("📝 Buffer updated:", {
          data: JSON.stringify(data),
          buffer: JSON.stringify(terminalSession.inputBuffer || ""),
          length: (terminalSession.inputBuffer || "").length,
        });

        // 保存命令到会话（如果有实际内容）
        if (data.trim()) {
          terminalSessionHook.saveCommand(
            (terminalSession.inputBuffer || "").trim(),
          );
        }

        // 检查是否是回车键，如果是则立即发送
        if (data === "\r" || data === "\n") {
          console.log("🚀 Enter key detected, sending immediately");

          // 清除防抖定时器
          if (terminalSession.sendTimeout) {
            clearTimeout(terminalSession.sendTimeout);
            terminalSession.sendTimeout = null;
          }

          // 立即发送缓冲区内容
          sendBufferedInput(props.sessionId, terminalId, terminalSession);
        } else {
          // 对于其他输入，使用1秒防抖
          if (terminalSession.sendTimeout) {
            clearTimeout(terminalSession.sendTimeout);
          }

          terminalSession.sendTimeout = setTimeout(() => {
            console.log(
              "⏰ Timer triggered, checking buffer:",
              terminalSession.inputBuffer,
            );
            sendBufferedInput(props.sessionId, terminalId, terminalSession);
          }, 1000);
        }
      });

      // 更新会话引用
      terminalSession.terminalSession = terminalSessionHook;

      // 告诉CLI端我们连接到了这个终端
      await invoke("connect_to_terminal", {
        sessionId: props.sessionId,
        terminalId: terminalId,
      });

      // 更新连接状态
      terminalSessionManager.updateConnectionState(terminalId, "connected");

      // 发送终端初始化信号
      console.log("📡 Sending terminal initialization signal to:", terminalId);

      // 确保终端焦点
      setTimeout(() => {
        if (terminalSession && terminalSession.terminal) {
          terminalSession.terminal.focus();
        }
      }, 100);
    } catch (error) {
      console.error("Failed to connect to terminal:", error);
      // 更新连接状态为失败
      terminalSessionManager.updateConnectionState(terminalId, "disconnected");
    }
  };

  // 监听终端输出
  const setupTerminalEventListeners = async () => {
    // 监听响应消息
    await listen(`session-response-${props.sessionId}`, (event: any) => {
      console.log("Received response message:", event.payload);

      const response = event.payload as any;
      if (response.success && response.data) {
        try {
          // 解析 JSON 字符串
          const data = JSON.parse(response.data);
          console.log("Parsed response data:", data);

          // 如果是终端列表响应
          if (data.terminals) {
            console.log("Setting terminal list:", data.terminals);
            setTerminals(data.terminals);
            setLoading(false);
          }

          // 如果是终端创建响应
          if (data.terminal_id) {
            console.log("Terminal created:", data.terminal_id);
            // 重新获取终端列表
            fetchTerminals();
            // 自动连接到新创建的终端
            setTimeout(() => {
              console.log(
                "Auto-connecting to newly created terminal:",
                data.terminal_id,
              );
              connectToTerminal(data.terminal_id);
            }, 500); // 等待终端列表更新
          }

          // 如果是 TCP 转发会话列表响应
          if (data.sessions && Array.isArray(data.sessions)) {
            console.log("Setting TCP sessions:", data.sessions);
            setTcpSessions(data.sessions);
          }
        } catch (error) {
          console.error("Failed to parse response data:", error, response.data);
        }
      }
    });

    // 监听 TCP 转发事件
    await listen(`tcp-forwarding-${props.sessionId}`, (event: any) => {
      console.log("TCP forwarding event:", event.payload);
      if (event.payload.sessions && Array.isArray(event.payload.sessions)) {
        setTcpSessions(event.payload.sessions);
      }
    });

    // 监听 TCP 数据事件
    await listen(`tcp-data-${props.sessionId}`, (event: any) => {
      console.log("TCP data event:", event.payload);
      // TCP 数据事件不需要刷新会话列表
    });

    // 监听终端管理消息
    await listen(`terminal-management-${props.sessionId}`, (event: any) => {
      console.log("Received terminal management message:", event.payload);
      // 终端创建、停止等操作后，重新获取列表
      fetchTerminals();
    });

    await listen(`terminal-output-${props.sessionId}`, (event: any) => {
      const payload = event.payload as any;
      const terminalId = payload.terminal_id || payload.terminalId;
      const data = payload.data;

      console.log("📤 Received terminal output:", {
        terminalId,
        dataLength: data?.length,
      });
      console.log("   Preview:", data);

      const sessions = terminalSessions();
      const session = sessions.get(terminalId);

      if (session && session.isActive) {
        // 确保数据是字符串类型
        let outputData = typeof data === "string" ? data : String(data || "");

        // 如果有待发送的输入，去除重复的回显
        if (
          session.hasPendingInput &&
          session.localInputLength &&
          session.localInputLength > 0
        ) {
          const charsToRemove = Math.min(
            session.localInputLength,
            outputData.length,
          );
          if (charsToRemove > 0) {
            console.log("🧹 Removing duplicate echo:", {
              localInputLength: session.localInputLength,
              outputDataLength: outputData.length,
              removing: charsToRemove,
            });

            // 移除与本地输入重复的部分
            outputData = outputData.substring(charsToRemove);

            // 重置标记
            session.localInputLength = 0;
            session.hasPendingInput = false;
          }
        }

        // 只有当还有数据时才写入
        if (outputData.length > 0) {
          session.terminal.write(outputData);
        }

        // 重置智能 Ctrl+C 处理器状态（当有新输出时）
        if (session.smartCtrlCHandler) {
          session.smartCtrlCHandler.resetOnOutput();
        }

        // 触发会话保存（通过解析输出更新工作目录等）
        if (session.terminalSession) {
          session.terminalSession.updateWorkingDirectory(outputData);
        }
      } else {
        console.warn(
          "⚠️ Terminal session not found or inactive for output:",
          terminalId,
        );
        // 如果没有找到对应的终端会话，尝试自动创建一个
        if (terminalId && !sessions.has(terminalId)) {
          console.log("🔄 Auto-connecting to terminal for output:", terminalId);
          connectToTerminal(terminalId);
        }
      }
    });

    await listen(`terminal-event-${props.sessionId}`, (event: any) => {
      console.log("Terminal event:", event.payload);

      // 处理终端列表响应 - 使用新的结构化数据
      if (
        (event.payload as any).event_type &&
        typeof (event.payload as any).event_type === "object" &&
        "TerminalList" in (event.payload as any).event_type
      ) {
        try {
          // 新的结构化格式直接从event_type中获取终端列表
          console.log("Received structured TerminalList event:", event.payload);
          const terminalData =
            ((event.payload as any).event_type as any).TerminalList || [];
          console.log("Parsed terminal list:", terminalData);
          setTerminals(terminalData);
        } catch (error) {
          console.error(
            "Failed to parse structured terminal list event:",
            error,
          );
        }
      }

      // 处理终端输出事件 - 使用新的结构化数据
      if (
        (event.payload as any).event_type &&
        typeof (event.payload as any).event_type === "object" &&
        "TerminalOutput" in (event.payload as any).event_type
      ) {
        try {
          // 新的结构化格式直接从event_type中提取数据
          console.log(
            "Received structured TerminalOutput event:",
            event.payload,
          );

          const terminalOutput = ((event.payload as any).event_type as any)
            .TerminalOutput;
          if (
            terminalOutput &&
            terminalOutput.terminal_id &&
            terminalOutput.data
          ) {
            const terminalId = terminalOutput.terminal_id;
            const outputData = terminalOutput.data;

            console.log("🔥 Structured terminal output:", {
              terminalId,
              dataLength: outputData?.length,
            });
            console.log("   Preview:", outputData?.substring(0, 100));

            const sessions = terminalSessions();
            const session = sessions.get(terminalId);

            if (session && session.isActive) {
              console.log(
                "✅ Writing structured data to terminal session:",
                terminalId,
              );

              // 确保数据是字符串类型
              let dataStr =
                typeof outputData === "string"
                  ? outputData
                  : String(outputData || "");

              // 如果有待发送的输入，去除重复的回显
              if (
                session.hasPendingInput &&
                session.localInputLength &&
                session.localInputLength > 0
              ) {
                const charsToRemove = Math.min(
                  session.localInputLength,
                  dataStr.length,
                );
                if (charsToRemove > 0) {
                  console.log(
                    "🧹 Removing duplicate echo from structured data:",
                    {
                      localInputLength: session.localInputLength,
                      dataStrLength: dataStr.length,
                      removing: charsToRemove,
                    },
                  );

                  // 移除与本地输入重复的部分
                  dataStr = dataStr.substring(charsToRemove);

                  // 重置标记
                  session.localInputLength = 0;
                  session.hasPendingInput = false;
                }
              }

              // 只有当还有数据时才写入
              if (dataStr.length > 0) {
                session.terminal.write(dataStr);
              }

              // 触发会话保存
              if (session.terminalSession) {
                session.terminalSession.updateWorkingDirectory(dataStr);
              }
            } else {
              console.warn(
                "⚠️ No active terminal session found for:",
                terminalId,
              );
              // 自动连接到终端
              if (!sessions.has(terminalId)) {
                console.log(
                  "🔄 Auto-connecting to terminal for structured output:",
                  terminalId,
                );
                connectToTerminal(terminalId);
              }
            }
          }
        } catch (error) {
          console.error(
            "Failed to parse structured terminal output event:",
            error,
          );
        }
      }
    });
  };

  // 组件挂载时初始化
  onMount(async () => {
    await setupTerminalEventListeners();

    // 初始加载数据
    await fetchTerminals();
    await loadTcpSessions();

    setLoading(false);

    // 添加 resize 监听器 - 使用 debounce
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(() => {
        const sessions = terminalSessions();
        sessions.forEach((session) => {
          try {
            if (containerRef && containerRef.clientWidth > 0) {
              session.fitAddon.fit();
              console.log("Terminal resized:", {
                rows: session.terminal.rows,
                cols: session.terminal.cols,
              });
            }
          } catch (error) {
            console.error("Error fitting terminal on resize:", error);
          }
        });
      }, 150); // 150ms debounce
    };

    window.addEventListener("resize", handleResize);

    // 清理函数
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  });

  // 响应式更新 - 改进版
  createEffect(() => {
    const activeId = activeTerminalId();
    if (activeId) {
      // 使用双重 requestAnimationFrame 确保 DOM 完全更新
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const sessions = terminalSessions();
          const session = sessions.get(activeId);
          if (session && containerRef) {
            try {
              // 确保容器有尺寸
              if (
                containerRef.clientWidth > 0 &&
                containerRef.clientHeight > 0
              ) {
                session.fitAddon.fit();
                console.log("Terminal refitted:", {
                  rows: session.terminal.rows,
                  cols: session.terminal.cols,
                });
              }
            } catch (error) {
              console.error("Error fitting terminal:", error);
            }
          }
        });
      });
    }
  });

  // 自动选择第一个可用终端
  createEffect(() => {
    const availableTerminals = terminals();
    const hasActiveTerminal = activeTerminalId();
    const availableTerminalIds = availableTerminals.map((t) => t.id);

    // 如果没有活动终端但有可用终端，自动连接到第一个
    if (!hasActiveTerminal && availableTerminalIds.length > 0) {
      const firstTerminalId = availableTerminalIds[0];
      console.log("Auto-connecting to first terminal:", firstTerminalId);
      connectToTerminal(firstTerminalId);
    }

    // 如果当前活动终端不在可用列表中，清空选择
    if (
      hasActiveTerminal &&
      !availableTerminalIds.includes(hasActiveTerminal)
    ) {
      setActiveTerminalId(null);
    }
  });

  // 渲染左侧边栏内容
  const renderSidebar = () => (
    <>
      {/* 侧边栏头部 */}
      <div class="p-4 border-b border-base-300 bg-base-200">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-3 h-3 rounded-full bg-success animate-pulse" />
            <h2 class="text-lg font-bold">RiTerm</h2>
          </div>
          <div class="flex items-center gap-2">
            {/* 桌面端侧边栏切换按钮 */}
            <Show when={!isMobile}>
              <label
                for="left-sidebar-drawer"
                class="btn btn-ghost btn-sm btn-square cursor-pointer"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                  />
                </svg>
              </label>
            </Show>
          </div>
        </div>

        {/* Tab Navigation */}
        <div role="tablist" class="tabs">
          <a
            role="tab"
            class={`tab tab-sm ${activeSidebarTab() === "terminals" ? "tab-active" : ""}`}
            onClick={() => setActiveSidebarTab("terminals")}
          >
            <div class="flex items-center gap-2">
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              终端
              <div class="badge badge-neutral badge-xs">
                {terminals().length}
              </div>
            </div>
          </a>
          <a
            class={`tab tab-sm ${activeSidebarTab() === "services" ? "tab-active" : ""}`}
            onClick={() => setActiveSidebarTab("services")}
          >
            <div class="flex items-center gap-2">
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                />
              </svg>
              TCP 服务
              <div class="badge badge-neutral badge-xs">
                {tcpSessions().length}
              </div>
            </div>
          </a>
        </div>
        <div class="tabs tabs-boxed bg-base-300 p-1"></div>
      </div>

      {/* Tab Content */}
      <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-base-300 scrollbar-track-transparent">
        {/* 终端标签页内容 */}
        <Show when={activeSidebarTab() === "terminals"}>
          <div class="p-4">
            {/* 新建终端按钮 */}
            <button
              class="btn btn-primary w-full gap-2 mb-4"
              onClick={() => openCreateDialog()}
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              新建终端
            </button>

            {/* 终端列表 */}
            <div class="space-y-3">
              <For each={terminals()}>
                {(terminal) => {
                  const isActive = activeTerminalId() === terminal.id;
                  return (
                    <div
                      class={`card card-compact p-0! cursor-pointer transition-all duration-200 group ${isActive
                        ? "bg-primary/5 border border-primary shadow-sm"
                        : "bg-base-200 hover:bg-base-300"
                        }`}
                      onClick={() => {
                        if (terminal.status === "Running") {
                          connectToTerminal(terminal.id);
                        }
                      }}
                    >
                      <div class="card-body pt-0!">
                        <div class="flex flex-col gap-1">
                          <div class="flex items-center justify-between gap-2">
                            <div
                              class={`font-semibold truncate text-base flex-1 ${isActive ? "text-primary" : "text-base-content"
                                }`}
                            >
                              {terminal.name ||
                                `Terminal ${terminal.id.slice(0, 8)}`}
                            </div>
                            <button
                              class={`btn btn-ghost btn-error btn-xs p-0 btn-square opacity-0 group-hover:opacity-100 transition-opacity ${isActive
                                ? "opacity-100 hover:bg-error/20 hover:text-error"
                                : ""
                                }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                stopTerminal(terminal.id);
                              }}
                              title="停止终端"
                            >
                              <svg
                                class="w-3 h-3"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                          <div class="text-xs text-base-content/50 truncate">
                            {truncatePath(terminal.current_dir)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>

              {terminals().length === 0 && (
                <div class="text-center py-8 px-4">
                  <div class="mask mask-squircle w-16 h-16 mx-auto mb-4 bg-base-200 flex items-center justify-center">
                    <svg
                      class="w-8 h-8 text-base-content/30"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div class="text-sm text-base-content/60 mb-4">暂无终端</div>
                </div>
              )}
            </div>
          </div>
        </Show>

        {/* TCP 服务标签页内容 */}
        <Show when={activeSidebarTab() === "services"}>
          <div class="p-4">
            {/* 新建 TCP 转发按钮 */}
            <button
              class="btn btn-primary w-full gap-2 mb-4"
              onClick={() => openTcpDialog()}
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              新建 TCP 转发
            </button>

            {/* TCP 会话列表 */}
            <div class="space-y-3">
              <For each={tcpSessions()}>
                {(session) => (
                  <div class="card card-compact bg-base-200 hover:bg-base-300 transition-all duration-200">
                    <div class="card-body">
                      <div class="flex items-center justify-between mb-2">
                        <div class="font-semibold truncate text-sm">
                          {session.id.slice(0, 12)}...
                        </div>
                        <div class={`badge badge-xs ${session.status === 'running' ? 'badge-success' :
                          session.status === 'stopped' ? 'badge-error' :
                            'badge-warning'
                          }`}>
                          {session.status}
                        </div>
                      </div>

                      <div class="space-y-2 text-xs">
                        <div class="flex items-center justify-between">
                          <span class="text-base-content/70">本地:</span>
                          <span class="font-mono bg-base-300 px-2 py-0.5 rounded">
                            {session.local_addr}
                          </span>
                        </div>
                        <div class="flex items-center justify-between">
                          <span class="text-base-content/70">远程:</span>
                          <span class="font-mono bg-base-300 px-2 py-0.5 rounded">
                            {session.remote_target}
                          </span>
                        </div>
                        <div class="flex items-center justify-between">
                          <span class="text-base-content/70">类型:</span>
                          <span class="badge badge-outline badge-xs">
                            {session.forwarding_type}
                          </span>
                        </div>

                        <div class="divider my-2"></div>

                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <div class="text-base-content/50">连接数</div>
                            <div class="font-semibold">{session.active_connections}</div>
                          </div>
                          <div>
                            <div class="text-base-content/50">已发送</div>
                            <div class="font-mono text-success text-xs">
                              {formatBytes(session.bytes_sent)}
                            </div>
                          </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <div>
                            <div class="text-base-content/50">已接收</div>
                            <div class="font-mono text-info text-xs">
                              {formatBytes(session.bytes_received)}
                            </div>
                          </div>
                          <div>
                            <div class="text-base-content/50">创建时间</div>
                            <div class="text-xs truncate">
                              {new Date(session.created_at).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="card-actions justify-end mt-3">
                        <button
                          class="btn btn-error btn-xs"
                          onClick={() => stopTcpSession(session.id)}
                        >
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          停止
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </For>

              {tcpSessions().length === 0 && (
                <div class="text-center py-8 px-4">
                  <div class="mask mask-squircle w-16 h-16 mx-auto mb-4 bg-base-200 flex items-center justify-center">
                    <svg
                      class="w-8 h-8 text-base-content/30"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                      />
                    </svg>
                  </div>
                  <div class="text-sm text-base-content/60 mb-4">暂无 TCP 转发</div>
                </div>
              )}
            </div>
          </div>
        </Show>
      </div>

      {/* 侧边栏底部操作 */}
      <div class="p-4 border-t border-base-300 space-y-2 bg-base-200">
        <button
          class="btn btn-ghost btn-sm w-full justify-start gap-2"
          onClick={() => fetchTerminals()}
        >
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          刷新列表
        </button>
        <button
          class="btn btn-ghost btn-sm w-full justify-start gap-2 hover:bg-error/10 hover:text-error"
          onClick={props.onDisconnect}
        >
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          断开连接
        </button>
      </div>
    </>
  );

  // 渲染终端列表 - 移动端用
  const renderTerminalList = (inDropdown = false) => (
    <div class={inDropdown ? "space-y-2" : "space-y-2"}>
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold">终端列表</h3>
        <button
          class="btn btn-primary btn-sm"
          onClick={() => {
            openCreateDialog();
            if (inDropdown) setShowTerminalMenu(false);
          }}
          title="创建新终端"
        >
          ➕ 新建
        </button>
      </div>

      <For each={terminals()}>
        {(terminal) => (
          <div
            class={`card bg-base-200 shadow-sm p-3 ${activeTerminalId() === terminal.id ? "ring-2 ring-primary" : ""
              }`}
          >
            <div class="flex flex-col gap-1">
              <div class="flex justify-between items-center">
                <div class="font-medium truncate flex-1">
                  {terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}
                </div>
                <div class="flex space-x-1 ml-2">
                  {activeTerminalId() === terminal.id ? (
                    <div class="badge badge-primary badge-sm">活动</div>
                  ) : (
                    <button
                      class="btn btn-primary btn-xs"
                      onClick={() => {
                        connectToTerminal(terminal.id);
                        if (inDropdown) setShowTerminalMenu(false);
                      }}
                      disabled={terminal.status !== "Running"}
                    >
                      连接
                    </button>
                  )}
                  <button
                    class="btn btn-ghost btn-xs"
                    onClick={() => stopTerminal(terminal.id)}
                    title="停止终端"
                  >
                    🛑
                  </button>
                </div>
              </div>
              <div class="text-xs opacity-70 truncate">
                {terminal.shell_type} • {truncatePath(terminal.current_dir)}
              </div>
              <div class="text-xs opacity-50">
                {terminal.status} • {terminal.size[0]}x{terminal.size[1]}
              </div>
            </div>
          </div>
        )}
      </For>

      {terminals().length === 0 && (
        <div class="text-center py-8 opacity-50">
          <div class="text-4xl mb-2">💻</div>
          <div>暂无终端</div>
        </div>
      )}
    </div>
  );

  // 渲染快捷键按钮栏
  const renderShortcutBar = () => {
    if (!activeTerminalId()) return null;

    const shortcuts = [
      { key: "esc", label: "Esc", color: "bg-base-200" },
      { key: "tab", label: "Tab", color: "bg-base-200" },
      { key: "up", label: "↑", color: "bg-base-200" },
      { key: "down", label: "↓", color: "bg-base-200" },
      { key: "enter", label: "↵", color: "bg-primary text-primary-content" },
      { key: "ctrl-c", label: "^C", color: "bg-error/80 text-error-content" },
    ];

    return (
      <>
        {/* Mobile AI Chat Bar */}
        <div class="border-t bg-base-200 p-2">
          <div class="flex items-center gap-2">
            <button
              class={`btn btn-sm btn-square ${showChatHistory() ? "btn-primary" : "btn-ghost"
                }`}
              onClick={() => setShowChatHistory(!showChatHistory())}
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </button>

            <div class="flex-1">
              <input
                type="text"
                placeholder="询问AI助手..."
                class="input input-bordered input-sm w-full"
                value={aiChatInput()}
                onInput={(e) => setAiChatInput(e.currentTarget.value)}
                onKeyPress={handleAiChatKeyPress}
                disabled={isAiThinking()}
              />
            </div>

            <button
              class="btn btn-primary btn-sm"
              onClick={handleAiChatSubmit}
              disabled={
                !aiChatInput().trim() || !activeTerminalId() || isAiThinking()
              }
            >
              <Show
                when={isAiThinking()}
                fallback={
                  <svg
                    class="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                }
              >
                <span class="loading loading-spinner loading-xs"></span>
              </Show>
            </button>
          </div>

          {/* Mobile Chat History */}
          <Show when={showChatHistory() && chatMessages().length > 0}>
            <div class="max-h-32 overflow-y-auto mt-2 p-2 bg-base-100 rounded-lg">
              <div class="space-y-1">
                <For each={chatMessages()}>
                  {(message) => (
                    <div
                      class={`text-xs ${message.role === "user" ? "text-right" : "text-left"
                        }`}
                    >
                      <div
                        class={`inline-block px-2 py-1 rounded ${message.role === "user"
                          ? "bg-primary text-primary-content"
                          : "bg-base-300 text-base-content"
                          }`}
                      >
                        {message.content}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Mobile AI Commands List */}
          <Show when={aiResponse() && aiResponse()!.commands.length > 0}>
            <div class="mt-2">
              <div class="bg-base-100 rounded-lg border border-base-300">
                <div class="p-2 border-b border-base-200">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1">
                      <svg
                        class="w-3 h-3 text-primary"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                      <span class="text-xs font-medium">AI 命令</span>
                    </div>
                    <button
                      class="btn btn-ghost btn-xs btn-square w-4 h-4"
                      onClick={() => setAiResponse(null)}
                      title="关闭"
                    >
                      <svg
                        class="w-2 h-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <div class="max-h-40 overflow-y-auto">
                  <For each={aiResponse()!.commands}>
                    {(command, index) => (
                      <div
                        class={`p-2 border-b border-base-200 last:border-b-0 ${index() === 0 ? "bg-primary/5" : ""
                          }`}
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1 mb-1">
                              <div class="badge badge-primary badge-xs text-xs">
                                {index() + 1}
                              </div>
                              <span class="text-xs font-medium truncate">
                                {command.description}
                              </span>
                            </div>

                            <div class="bg-base-200 rounded p-1 mb-1">
                              <code class="text-xs font-mono break-all">
                                {command.command}
                              </code>
                            </div>

                            <div class="text-xs text-base-content/50 line-clamp-2">
                              {command.explanation}
                            </div>
                          </div>

                          <div class="flex flex-col gap-1">
                            <button
                              class="btn btn-primary btn-xs w-6 h-6 p-0"
                              onClick={() => executeAiCommand(command.command)}
                              title="执行"
                            >
                              <svg
                                class="w-2 h-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                />
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            </button>

                            <button
                              class="btn btn-ghost btn-xs w-6 h-6 p-0"
                              onClick={() =>
                                navigator.clipboard.writeText(command.command)
                              }
                              title="复制"
                            >
                              <svg
                                class="w-2 h-2"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </Show>
        </div>

        {/* Traditional Shortcut Bar */}
        <div
          class="border-t bg-base-100 px-2 py-2 shrink-0"
          style={{ "padding-bottom": "env(safe-area-inset-bottom, 0.5rem)" }}
        >
          <div class="flex items-center justify-between gap-1 max-w-full overflow-x-auto scrollbar-hide">
            <For each={shortcuts}>
              {(shortcut) => (
                <button
                  class={`btn btn-sm ${shortcut.color} hover:brightness-90 border-base-300 flex-1 min-w-0 px-2 transition-transform active:scale-95`}
                  onClick={() => sendShortcut(shortcut.key)}
                  onTouchStart={(e) => {
                    e.currentTarget.classList.add("scale-95");
                  }}
                  onTouchEnd={(e) => {
                    e.currentTarget.classList.remove("scale-95");
                  }}
                >
                  <span class="text-xs sm:text-sm truncate font-mono">
                    {shortcut.label}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </>
    );
  };

  // 渲染活动终端
  const renderActiveTerminal = () => {
    const terminalId = activeTerminalId();
    if (!terminalId) return null;

    const sessions = terminalSessions();
    const session = sessions.get(terminalId);
    if (!session) return null;

    return (
      <div
        ref={(el) => {
          terminalContainerRef = el;
          if (el && el.children.length === 0) {
            try {
              console.log("Opening terminal in container:", el);

              // 确保容器样式正确
              el.style.height = "100%";
              el.style.width = "100%";
              el.style.overflow = "hidden";
              el.style.backgroundColor = "#000000";
              el.style.padding = "10px";
              el.style.boxSizing = "border-box";

              // 打开终端
              session.terminal.open(el);

              // 清除初始内容
              session.terminal.clear();

              // 立即 fit 一次
              setTimeout(() => {
                try {
                  session.fitAddon.fit();
                  console.log("Initial terminal fit:", {
                    width: el.clientWidth,
                    height: el.clientHeight,
                    rows: session.terminal.rows,
                    cols: session.terminal.cols,
                  });
                } catch (error) {
                  console.error("Error in initial fit:", error);
                }
              }, 50);

              // 设置定时 resize 监听
              const resizeObserver = new ResizeObserver(() => {
                try {
                  session.fitAddon.fit();
                  console.log("Terminal resized:", {
                    rows: session.terminal.rows,
                    cols: session.terminal.cols,
                  });
                } catch (error) {
                  console.error("Error in resize observer:", error);
                }
              });

              resizeObserver.observe(el);

              // 清理函数
              setTimeout(() => {
                resizeObserver.disconnect();
              }, 10000); // 10秒后断开观察者，避免内存泄漏
            } catch (error) {
              console.error("Error opening terminal:", error);
            }
          }
        }}
        class="w-full h-full"
        style={{
          overflow: "hidden",
          "background-color": "#000000",
          "font-family": 'Menlo, Monaco, "Courier New", monospace',
        }}
      />
    );
  };

  // 键盘快捷键支持
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const digit = parseInt(e.key);
      if (!isNaN(digit) && digit >= 1 && digit <= 9) {
        const availableTerminals = terminals();
        if (digit <= availableTerminals.length) {
          e.preventDefault();
          setActiveTerminalId(availableTerminals[digit - 1].id);
        }
      }
    }
  };

  // AI Chat 处理函数
  const handleAiChatSubmit = async () => {
    const message = aiChatInput().trim();
    if (!message) return;

    const activeId = activeTerminalId();
    if (!activeId) return;

    // 添加用户消息到聊天历史
    const userMessage = {
      id: Date.now().toString(),
      role: "user" as const,
      content: message,
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMessage]);

    // 清空输入框
    setAiChatInput("");
    setIsAiThinking(true);

    try {
      // 生成AI响应和终端命令
      const response = await generateAiResponse(message);

      // 保存AI响应到状态
      setAiResponse(response);

      // 添加AI响应到聊天历史
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        role: "ai" as const,
        content: response.explanation,
        timestamp: Date.now(),
        commands: response.commands,
      };
      setChatMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error("Failed to generate AI response:", error);

      // 添加错误消息
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        role: "ai" as const,
        content: "抱歉，我遇到了一些问题。请直接输入终端命令。",
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsAiThinking(false);
    }
  };

  // 执行AI生成的命令
  const executeAiCommand = async (command: string) => {
    const activeId = activeTerminalId();
    if (!activeId) return;

    try {
      await sendCommandToTerminal(command);

      // 添加命令执行记录到聊天历史
      const executionMessage = {
        id: Date.now().toString(),
        role: "user" as const,
        content: `执行命令: ${command}`,
        timestamp: Date.now(),
        command: command,
      };
      setChatMessages((prev) => [...prev, executionMessage]);

      // 清空AI响应，避免重复显示
      setAiResponse(null);
    } catch (error) {
      console.error("Failed to execute command:", error);

      // 添加错误消息
      const errorMessage = {
        id: Date.now().toString(),
        role: "ai" as const,
        content: `命令执行失败: ${error}`,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    }
  };

  // 调用 OpenAI API 生成终端命令
  const generateAiResponse = async (
    userMessage: string,
  ): Promise<{
    commands: Array<{
      id: string;
      command: string;
      description: string;
      explanation: string;
    }>;
    explanation: string;
  }> => {
    try {
      // 获取系统信息用于构建提示词
      const sysInfo = systemInfo();

      // 构建系统环境描述
      const buildSystemContext = () => {
        if (!sysInfo) {
          // 如果没有系统信息，使用默认的通用描述
          return `你是一个专业的终端命令助手。请根据用户的需求生成相应的终端命令。

【系统环境信息】
- 操作系统：通用 Unix-like 系统
- 默认Shell：bash/zsh (兼容常用语法)
- 可用工具：常见的 Unix 工具如 git, vim, curl, wget, grep, find, sed, awk 等

请以以下 JSON 格式返回响应：
{
  "explanation": "对用户需求的整体解释和说明",
  "commands": [
    {
      "id": "唯一标识符",
      "command": "具体的终端命令",
      "description": "命令的简短描述",
      "explanation": "命令的详细解释，包括作用、参数说明等"
    }
  ]
}`;
        }

        const {
          os_info,
          shell_info,
          available_tools,
          environment_vars,
          architecture,
          hostname,
          user_info,
        } = sysInfo;

        // 构建可用工具列表
        const toolsList = [
          ...available_tools.package_managers,
          ...available_tools.editors,
          ...available_tools.search_tools,
          ...available_tools.version_control,
          ...available_tools.development_tools,
        ].filter((tool, index, arr) => arr.indexOf(tool) === index); // 去重

        // 构建包管理器说明
        const packageManagerInfo = available_tools.package_managers
          .map((pm) => {
            switch (pm) {
              case "brew":
                return "- Homebrew (brew): macOS 包管理器，用于安装软件包";
              case "apt":
                return "- APT (apt): Debian/Ubuntu 包管理器";
              case "yum":
                return "- YUM: CentOS/RHEL 包管理器";
              case "dnf":
                return "- DNF: Fedora 包管理器";
              case "pacman":
                return "- Pacman: Arch Linux 包管理器";
              case "npm":
                return "- NPM: Node.js 包管理器";
              case "pip":
                return "- pip: Python 包管理器";
              case "cargo":
                return "- Cargo: Rust 包管理器";
              default:
                return `- ${pm}: 包管理器`;
            }
          })
          .join("\n");

        // 构建搜索工具说明
        const searchToolInfo = available_tools.search_tools
          .map((tool) => {
            switch (tool) {
              case "rg":
                return "- ripgrep (rg): 超快的文本搜索工具，支持正则表达式和递归搜索";
              case "fd":
                return "- fd: find 的现代替代品，用户友好的文件查找工具";
              case "grep":
                return "- grep: 传统文本搜索工具";
              case "find":
                return "- find: 文件和目录查找工具";
              case "ack":
                return "- ack: 为程序员设计的文本搜索工具";
              case "ag":
                return "- ag (silversearcher-ag): 代码搜索工具";
              default:
                return `- ${tool}: 搜索工具`;
            }
          })
          .join("\n");

        // 构建编辑器说明
        const editorInfo = available_tools.editors
          .map((editor) => {
            switch (editor) {
              case "vim":
                return "- vim: 强大的文本编辑器，支持插件和配置";
              case "nvim":
                return "- neovim: vim 的现代分支，有更好的性能和用户体验";
              case "nano":
                return "- nano: 简单易用的文本编辑器";
              case "emacs":
                return "- emacs: 功能强大的可扩展文本编辑器";
              case "code":
                return "- VS Code: 现代化的代码编辑器";
              default:
                return `- ${editor}: 文本编辑器`;
            }
          })
          .join("\n");

        return `你是一个专业的 ${os_info.name} 系统终端命令助手。请根据用户的需求生成相应的终端命令。

【系统环境信息】
- 操作系统：${os_info.name} ${os_info.version} (${os_info.arch})
- 架构：${architecture}
- 主机名：${hostname}
- 用户：${user_info.username} (主目录: ${user_info.home_dir})
- Shell：${shell_info.shell_type} (${shell_info.shell_path})${shell_info.version ? ` 版本: ${shell_info.version}` : ""}
- 可用工具：${toolsList.join(", ")}

【包管理器】
${packageManagerInfo}

【搜索工具】
${searchToolInfo}

【文本编辑器】
${editorInfo}

【重要环境变量】
${Object.entries(environment_vars)
            .slice(0, 5)
            .map(([key, value]) => `- ${key}: ${value}`)
            .join("\n")}

请以以下 JSON 格式返回响应：
{
  "explanation": "对用户需求的整体解释和说明",
  "commands": [
    {
      "id": "唯一标识符",
      "command": "具体的终端命令",
      "description": "命令的简短描述",
      "explanation": "命令的详细解释，包括作用、参数说明等"
    }
  ]
}

【命令生成要求】
1. 优先使用适合 ${os_info.name} 的命令和工具
2. ${available_tools.search_tools.includes("rg") ? "推荐使用 ripgrep (rg) 而不是 grep 进行文本搜索" : "使用系统可用的搜索工具进行文本搜索"}
3. ${available_tools.search_tools.includes("fd") ? "推荐使用 fd 而不是 find 进行文件查找" : "使用系统可用的工具进行文件查找"}
4. 对于代码编辑，${available_tools.editors.length > 0 ? `推荐使用 ${available_tools.editors.slice(0, 2).join(" 或 ")}` : "使用系统可用的文本编辑器"}
5. ${available_tools.package_managers.length > 0 ? `对于软件安装，使用 ${available_tools.package_managers[0]} install` : "使用系统适合的包管理器安装软件"}
6. 命令必须安全且实用
7. 提供清晰的解释，包括参数说明
8. 如果涉及文件操作，提醒用户注意事项和备份建议
9. 优先提供最常用和最有效的命令
10. 如果有多个解决方案，提供2-3个最佳选项，并说明各自的优缺点
11. 考虑 ${shell_info.shell_type} 的特性和语法
12. 对于复杂的操作，提供步骤化的命令组合`;
      };

      // 构建 OpenAI API 请求
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY || "your-openai-api-key"}`, // 实际使用时需要配置环境变量
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content: buildSystemContext(),
              },
              {
                role: "user",
                content: userMessage,
              },
            ],
            temperature: 0.7,
            max_tokens: 1000,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `OpenAI API 请求失败: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      const aiContent = data.choices[0]?.message?.content;

      if (!aiContent) {
        throw new Error("OpenAI API 返回了空内容");
      }

      // 尝试解析 JSON 响应
      let parsedResponse;
      try {
        // 查找 JSON 部分（可能包含在代码块中）
        const jsonMatch =
          aiContent.match(/```json\s*([\s\S]*?)\s*```/) ||
          aiContent.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : aiContent;
        parsedResponse = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error("解析 OpenAI 响应失败:", parseError);
        // 如果解析失败，返回简单的文本响应
        return {
          explanation: aiContent,
          commands: [
            {
              id: "default",
              command: 'echo "请查看上方AI说明"',
              description: "显示AI说明",
              explanation: aiContent,
            },
          ],
        };
      }

      // 确保响应格式正确
      if (!parsedResponse.commands || !Array.isArray(parsedResponse.commands)) {
        return {
          explanation: parsedResponse.explanation || aiContent,
          commands: [
            {
              id: "default",
              command: 'echo "请查看上方AI说明"',
              description: "显示AI说明",
              explanation: parsedResponse.explanation || aiContent,
            },
          ],
        };
      }

      return {
        explanation:
          parsedResponse.explanation || "根据您的需求，我为您生成了以下命令：",
        commands: parsedResponse.commands.map((cmd: any, index: number) => ({
          id: cmd.id || `cmd-${index}`,
          command: cmd.command || "",
          description: cmd.description || "执行命令",
          explanation: cmd.explanation || cmd.command,
        })),
      };
    } catch (error) {
      console.error("OpenAI API 调用失败:", error);

      // 降级到本地规则匹配
      return generateFallbackResponse(userMessage);
    }
  };

  // 降级响应生成器（本地规则匹配）
  const generateFallbackResponse = (
    userMessage: string,
  ): {
    commands: Array<{
      id: string;
      command: string;
      description: string;
      explanation: string;
    }>;
    explanation: string;
  } => {
    const message = userMessage.toLowerCase();
    const sysInfoData = systemInfo();

    // 获取系统相关信息
    const getSystemSpecificInfo = (): {
      osName: string;
      defaultShell: string;
      packageManager: string;
      preferredSearchTool: string;
      preferredFindTool: string;
      preferredEditor: string;
    } => {
      if (!sysInfoData) {
        return {
          osName: "Unix-like 系统",
          defaultShell: "bash/zsh",
          packageManager: "系统包管理器",
          preferredSearchTool: "grep",
          preferredFindTool: "find",
          preferredEditor: "vim",
        };
      }

      const { os_info, shell_info, available_tools } = sysInfoData as any;

      return {
        osName: os_info.name,
        defaultShell: shell_info.shell_type,
        packageManager: available_tools.package_managers[0] || "系统包管理器",
        preferredSearchTool: available_tools.search_tools.includes("rg")
          ? "rg"
          : available_tools.search_tools.includes("ag")
            ? "ag"
            : available_tools.search_tools.includes("ack")
              ? "ack"
              : "grep",
        preferredFindTool: available_tools.search_tools.includes("fd")
          ? "fd"
          : "find",
        preferredEditor: available_tools.editors[0] || "vim",
      };
    };

    const localSystemInfo = getSystemSpecificInfo();

    if (
      message.includes("list") ||
      message.includes("文件") ||
      message.includes("目录")
    ) {
      const lsOptions = localSystemInfo.osName.toLowerCase().includes("macos")
        ? "-laG"
        : "-la";
      return {
        explanation: `我来帮您列出当前目录的文件和文件夹。在 ${localSystemInfo.osName} 上，ls 命令支持详细显示和格式选项。`,
        commands: [
          {
            id: "list-files",
            command: `ls ${lsOptions}`,
            description: "列出详细文件信息",
            explanation: `ls ${lsOptions} 会显示当前目录下所有文件和文件夹的详细信息，包括隐藏文件、权限、所有者、大小和修改时间。${localSystemInfo.osName.toLowerCase().includes("macos") ? "在 macOS 上，-G 参数会启用颜色输出。" : ""}`,
          },
        ],
      };
    } else if (message.includes("当前目录") || message.includes("pwd")) {
      return {
        explanation: `显示当前工作目录的完整路径。在 ${localSystemInfo.osName} 上，pwd 会显示当前工作目录。`,
        commands: [
          {
            id: "show-pwd",
            command: "pwd",
            description: "显示当前目录路径",
            explanation:
              "pwd (print working directory) 命令会显示当前所在工作目录的完整路径。",
          },
        ],
      };
    } else if (message.includes("创建目录") || message.includes("mkdir")) {
      const match = message.match(/创建\s*目录\s*["']?([^"'\s]+)["']?/);
      const dirName = match ? match[1] : "new_folder";
      return {
        explanation: `创建一个名为 "${dirName}" 的新目录。在 ${localSystemInfo.osName} 上，mkdir 支持创建多级目录。`,
        commands: [
          {
            id: "create-dir",
            command: `mkdir -p ${dirName}`,
            description: `创建目录 ${dirName}`,
            explanation: `mkdir -p 命令用于创建新目录。-p 参数会自动创建父目录（如果不存在），并且如果目录已存在也不会报错。目录名 "${dirName}" 将在当前位置创建。`,
          },
        ],
      };
    } else if (message.includes("搜索") || message.includes("查找")) {
      if (message.includes("文本") || message.includes("内容")) {
        const searchCommand =
          localSystemInfo.preferredSearchTool === "rg"
            ? "rg -i 'search_term' ."
            : localSystemInfo.preferredSearchTool === "ag"
              ? "ag -i 'search_term'"
              : localSystemInfo.preferredSearchTool === "ack"
                ? "ack -i 'search_term'"
                : "grep -r 'search_term' .";
        return {
          explanation: `在当前目录及其子目录中搜索文本内容。推荐使用 ${localSystemInfo.preferredSearchTool}，它在 ${localSystemInfo.osName} 上效率很高。`,
          commands: [
            {
              id: "search-text",
              command: searchCommand,
              description: "递归搜索文本内容",
              explanation: `${localSystemInfo.preferredSearchTool} 是一个高效的文本搜索工具。-i 参数表示不区分大小写，'search_term' 需要替换为实际搜索内容。${localSystemInfo.preferredSearchTool === "rg" ? "rg 递归搜索当前目录（. 表示当前目录）。" : ""}`,
            },
          ],
        };
      } else if (message.includes("文件") || message.includes("file")) {
        const findCommand =
          localSystemInfo.preferredFindTool === "fd"
            ? "fd -t f 'filename'"
            : "find . -name 'filename'";
        return {
          explanation: `查找文件。推荐使用 ${localSystemInfo.preferredFindTool} 工具，它在 ${localSystemInfo.osName} 上性能很好。`,
          commands: [
            {
              id: "find-files",
              command: findCommand,
              description: "查找文件",
              explanation: `${localSystemInfo.preferredFindTool} ${localSystemInfo.preferredFindTool === "fd" ? "是 find 的现代替代品，" : ""}用于查找文件。-t f 参数表示只查找文件，'filename' 需要替换为实际文件名。`,
            },
          ],
        };
      }
    } else if (
      message.includes("git") &&
      (message.includes("状态") || message.includes("status"))
    ) {
      return {
        explanation: `检查Git仓库的状态，显示修改的文件。Git 在 ${localSystemInfo.osName} 上可以通过 ${localSystemInfo.packageManager} 安装和管理。`,
        commands: [
          {
            id: "git-status",
            command: "git status",
            description: "查看Git仓库状态",
            explanation:
              "git status 会显示工作目录和暂存区的状态，包括已修改、已添加和未跟踪的文件。",
          },
        ],
      };
    } else if (message.includes("安装") || message.includes("install")) {
      if (message.includes(localSystemInfo.packageManager)) {
        return {
          explanation: `使用 ${localSystemInfo.packageManager} 安装软件包。${localSystemInfo.packageManager} 是 ${localSystemInfo.osName} 上的包管理器。`,
          commands: [
            {
              id: "install-package",
              command: `${localSystemInfo.packageManager} install package_name`,
              description: `使用 ${localSystemInfo.packageManager} 安装软件包`,
              explanation: `${localSystemInfo.packageManager} install 命令会从仓库下载并安装指定的软件包。package_name 需要替换为实际要安装的软件名称。`,
            },
          ],
        };
      } else {
        return {
          explanation: `在 ${localSystemInfo.osName} 上，推荐使用 ${localSystemInfo.packageManager} 来安装软件和工具。`,
          commands: [
            {
              id: "install-generic",
              command: `${localSystemInfo.packageManager} install package_name`,
              description: `使用 ${localSystemInfo.packageManager} 安装软件`,
              explanation: `对于大多数软件，可以使用 '${localSystemInfo.packageManager} install 软件名' 来安装。如果不知道具体包名，可以使用 '${localSystemInfo.packageManager} search 关键词' 来搜索。`,
            },
          ],
        };
      }
    } else if (message.includes("编辑") || message.includes("edit")) {
      return {
        explanation: `打开文本编辑器。在 ${localSystemInfo.osName} 上，有多种编辑器可供选择。`,
        commands: [
          {
            id: "edit-main",
            command: `${localSystemInfo.preferredEditor} filename`,
            description: `使用 ${localSystemInfo.preferredEditor} 编辑器打开文件`,
            explanation: `${localSystemInfo.preferredEditor} 是强大的文本编辑器，支持语法高亮和配置。`,
          },
        ],
      };
    } else if (message.includes("系统信息") || message.includes("system")) {
      const systemCommand = localSystemInfo.osName
        .toLowerCase()
        .includes("macos")
        ? "system_profiler SPSoftwareDataType"
        : localSystemInfo.osName.toLowerCase().includes("linux")
          ? "uname -a && lsb_release -a"
          : "uname -a";
      return {
        explanation: `显示 ${localSystemInfo.osName} 系统信息。`,
        commands: [
          {
            id: "system-info",
            command: systemCommand,
            description: "显示系统信息",
            explanation: `${systemCommand} 会显示操作系统的详细信息，包括版本、架构、主机名等。`,
          },
        ],
      };
    } else if (
      message.includes("运行") ||
      message.includes("执行") ||
      message.includes("启动")
    ) {
      if (message.includes("npm")) {
        return {
          explanation: `使用npm运行项目。Node.js 在 ${localSystemInfo.osName} 上可以通过 ${localSystemInfo.packageManager} 安装。`,
          commands: [
            {
              id: "npm-start",
              command: "npm start",
              description: "启动npm项目",
              explanation:
                "npm start 会运行 package.json 中 scripts.start 定义的命令，通常用于启动开发服务器。",
            },
          ],
        };
      } else if (message.includes("python") || message.includes("py")) {
        const pythonCommand = localSystemInfo.osName
          .toLowerCase()
          .includes("macos")
          ? "python3 script.py"
          : "python3 script.py";
        return {
          explanation: `运行 Python 脚本。在 ${localSystemInfo.osName} 上推荐使用 Python 3.x。`,
          commands: [
            {
              id: "run-python",
              command: pythonCommand,
              description: "使用 Python 3 运行脚本",
              explanation: `${pythonCommand.split(" ")[0]} 命令会使用 Python 3.x 解释器运行指定的 Python 脚本。`,
            },
          ],
        };
      }
    }

    // 默认响应
    return {
      explanation: `我理解您想要执行相关操作。这是 ${localSystemInfo.osName} 系统，我可以帮您处理各种终端操作。您可以询问关于文件管理、软件安装、Git操作、系统信息等。`,
      commands: [
        {
          id: "help-command",
          command: `echo 'RiTerm AI助手 - ${localSystemInfo.osName} 终端助手。试试：列出文件、搜索内容、安装软件、查看系统信息等'`,
          description: "显示帮助信息",
          explanation: `这是一个帮助命令。我可以帮助您处理 ${localSystemInfo.osName} 系统上的各种终端操作，包括文件管理、软件安装、版本控制等。`,
        },
      ],
    };
  };

  // 发送命令到终端
  const sendCommandToTerminal = async (command: string) => {
    const activeId = activeTerminalId();
    if (!activeId) return;

    try {
      await invoke("send_terminal_input_to_terminal", {
        sessionId: props.sessionId,
        terminalId: activeId,
        input: command + "\n",
      });
    } catch (error) {
      console.error("Failed to send command to terminal:", error);
    }
  };

  // 清空聊天历史
  const clearChatHistory = () => {
    setChatMessages([]);
  };

  const handleAiChatKeyPress = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAiChatSubmit();
    }
  };

  return (
    <div
      class="drawer lg:drawer-open"
      onKeyDown={handleKeyboardShortcuts}
      tabIndex={0}
    >
      {/* 创建终端 Modal */}
      <input type="checkbox" id="create_terminal_modal" class="modal-toggle" checked={showCreateTerminalModal()} />
      <div class="modal" onClick={() => setShowCreateTerminalModal(false)}>
        <div class="modal-box" onClick={(e) => e.stopPropagation()}>
          <h3 class="font-bold text-lg">创建新终端</h3>
          <div class="form-control mt-4">
            <label class="label">
              <span class="label-text">终端名称（可选）</span>
            </label>
            <input
              type="text"
              placeholder="例如：开发环境、生产服务器"
              class="input input-bordered"
              value={terminalName()}
              onInput={(e) => setTerminalName(e.currentTarget.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  confirmCreateTerminal();
                }
              }}
            />
          </div>
          <div class="mt-4 text-sm text-base-content/70">
            <p>终端大小将自动适配当前页面宽度</p>
            <p class="mt-1">
              预计大小: {calculateTerminalSize().cols} 列 ×{" "}
              {calculateTerminalSize().rows} 行
            </p>
          </div>
          <div class="modal-action">
            <button
              class="btn"
              onClick={() => setShowCreateTerminalModal(false)}
            >
              取消
            </button>
            <button class="btn btn-primary" onClick={confirmCreateTerminal}>
              创建
            </button>
          </div>
        </div>
      </div>

      {/* TCP 转发 Modal */}
      <input type="checkbox" id="tcp_forwarding_modal" class="modal-toggle" checked={showTcpForwardingModal()} />
      <div class="modal" onClick={() => setShowTcpForwardingModal(false)}>
        <div class="modal-box" onClick={(e) => e.stopPropagation()}>
          <h3 class="font-bold text-lg">新增 TCP 转发</h3>
          <div class="space-y-4 mt-4">
            {/* 转发类型选择 */}
            <div class="form-control">
              <label class="label">
                <span class="label-text">转发类型</span>
              </label>
              <select
                class="select select-bordered"
                value={tcpForwardingType()}
                onChange={(e) => setTcpForwardingType(e.currentTarget.value as "ListenToRemote" | "ConnectToRemote")}
              >
                <option value="ConnectToRemote">连接到远程 (Connect to Remote)</option>
                <option value="ListenToRemote">监听远程 (Listen to Remote)</option>
              </select>
              <label class="label">
                <span class="label-text-alt text-base-content/50">
                  选择转发方向
                </span>
              </label>
            </div>

            {/* 本地地址 */}
            <div class="form-control">
              <label class="label">
                <span class="label-text">本地地址</span>
              </label>
              <input
                type="text"
                placeholder="例如：127.0.0.1:8080"
                class="input input-bordered"
                value={tcpLocalAddr()}
                onInput={(e) => setTcpLocalAddr(e.currentTarget.value)}
              />
              <label class="label">
                <span class="label-text-alt text-base-content/50">
                  本地监听地址和端口
                </span>
              </label>
            </div>

            {/* 远程主机 */}
            <div class="form-control">
              <label class="label">
                <span class="label-text">远程主机</span>
              </label>
              <input
                type="text"
                placeholder="例如：127.0.0.1"
                class="input input-bordered"
                value={tcpRemoteHost()}
                onInput={(e) => setTcpRemoteHost(e.currentTarget.value)}
              />
              <label class="label">
                <span class="label-text-alt text-base-content/50">
                  远程服务器地址
                </span>
              </label>
            </div>

            {/* 远程端口 */}
            <div class="form-control">
              <label class="label">
                <span class="label-text">远程端口</span>
              </label>
              <input
                type="number"
                placeholder="例如：3000"
                class="input input-bordered"
                value={tcpRemotePort()}
                onInput={(e) => setTcpRemotePort(e.currentTarget.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    confirmCreateTcpForwarding();
                  }
                }}
                min="1"
                max="65535"
              />
              <label class="label">
                <span class="label-text-alt text-base-content/50">
                  远程服务端口 (1-65535)
                </span>
              </label>
            </div>
          </div>

          <div class="mt-4 p-3 bg-base-200 rounded-lg">
            <div class="text-sm text-base-content/70">
              <p class="font-medium mb-1">转发说明：</p>
              <Show when={tcpForwardingType() === "ConnectToRemote"}>
                <p>• 本地 {tcpLocalAddr()} 的连接将转发到远程 {tcpRemoteHost()}:{tcpRemotePort()}</p>
              </Show>
              <Show when={tcpForwardingType() === "ListenToRemote"}>
                <p>• 远程将监听并转发到本地 {tcpLocalAddr()}</p>
              </Show>
              <p>• 确保端口未被占用</p>
              <p>• 支持HTTP、数据库、SSH等各种TCP服务</p>
            </div>
          </div>

          <div class="modal-action">
            <button
              class="btn"
              onClick={() => setShowTcpForwardingModal(false)}
            >
              取消
            </button>
            <button
              class="btn btn-primary"
              onClick={confirmCreateTcpForwarding}
              disabled={!tcpLocalAddr() || !tcpRemoteHost() || !tcpRemotePort()}
            >
              创建
            </button>
          </div>
        </div>
      </div>

      {/* 侧边栏控制 */}
      <input
        id="left-sidebar-drawer"
        type="checkbox"
        class="drawer-toggle"
        checked={sidebarOpen()}
        onChange={(e) => setSidebarOpen(e.target.checked)}
      />

      {/* 主内容区域 - 必须在 drawer-side 之前 */}
      <div class="drawer-content flex flex-col overflow-hidden h-screen">
        {/* 统一顶部栏 - 桌面端和移动端通用 */}
        <div class="bg-base-100 border-b border-base-300">
          {/* 导航栏 */}
          <div class="navbar min-h-[48px] px-2 md:px-4">
            <div class="flex-none">
              {/* 侧边栏切换按钮 */}
              <label
                for="left-sidebar-drawer"
                class="btn btn-ghost btn-sm btn-square cursor-pointer"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </label>
            </div>

            {/* Tabs 终端列表 */}
            <div class="flex-1 overflow-x-auto scrollbar-hide">
              <div role="tablist" class="tabs tabs-boxed bg-transparent gap-1 p-1">
                <For each={terminals()}>
                  {(terminal) => {
                    const isActive = activeTerminalId() === terminal.id;
                    return (
                      <a
                        role="tab"
                        class={`tab tab-sm md:tab-md whitespace-nowrap gap-2 ${isActive ? "tab-active" : ""}`}
                        onClick={() => {
                          if (terminal.status === "Running") {
                            connectToTerminal(terminal.id);
                          }
                        }}
                      >
                        <span
                          class={`w-2 h-2 rounded-full ${terminal.status === "Running"
                            ? "bg-success"
                            : terminal.status === "Starting"
                              ? "bg-warning"
                              : "bg-base-300"
                            }`}
                        />
                        <span class="hidden md:inline">
                          {terminal.name || `Term ${terminal.id.slice(0, 6)}`}
                        </span>
                        <span class="md:hidden">
                          {terminal.name?.slice(0, 8) || terminal.id.slice(0, 4)}
                        </span>
                      </a>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* 添加按钮 - 下拉菜单 */}
            <div class="flex-none">
              <div class="dropdown dropdown-end">
                <button
                  class="btn btn-primary btn-sm btn-square"
                  onClick={() => setShowAddMenu(!showAddMenu())}
                >
                  <svg
                    class="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </button>
                <Show when={showAddMenu()}>
                  <ul
                    class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-52 mt-2 z-50"
                    onClick={() => setShowAddMenu(false)}
                  >
                    <li>
                      <button
                        onClick={() => openCreateDialog()}
                        class="flex items-center gap-3"
                      >
                        <svg
                          class="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        <div class="flex flex-col items-start">
                          <span class="font-medium">新建终端</span>
                          <span class="text-xs opacity-60">
                            创建新的终端会话
                          </span>
                        </div>
                      </button>
                    </li>
                    <li>
                      <button
                        onClick={() => openTcpDialog()}
                        class="flex items-center gap-3"
                      >
                        <svg
                          class="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                          />
                        </svg>
                        <div class="flex flex-col items-start">
                          <span class="font-medium">TCP转发</span>
                          <span class="text-xs opacity-60">
                            添加端口转发服务
                          </span>
                        </div>
                      </button>
                    </li>
                  </ul>
                </Show>
              </div>
            </div>
          </div>
        </div>

        {/* 主终端显示区域 - 占据剩余空间 */}
        <div class="flex-1 overflow-hidden min-h-0">
          <Show
            when={activeTerminalId()}
            fallback={
              <div class="w-full h-full flex items-center justify-center bg-base-200">
                <div class="text-center opacity-50 px-4">
                  <div class="text-6xl mb-4">💻</div>
                  <div class="text-xl">选择一个终端开始</div>
                  <div class="text-sm mt-2">
                    {isMobile
                      ? "点击顶部标签或菜单选择终端"
                      : terminals().length > 0
                        ? "从左侧边栏选择终端"
                        : "点击左侧边栏新建按钮创建第一个终端"}
                  </div>
                  <Show when={isMobile && terminals().length === 0}>
                    <button
                      class="btn btn-primary btn-sm mt-4"
                      onClick={() => setShowMainMenu(true)}
                    >
                      打开菜单
                    </button>
                  </Show>
                </div>
              </div>
            }
          >
            {/* 终端显示容器 - 直接填充父容器 */}
            {renderActiveTerminal()}
          </Show>
        </div>

        {/* 底部工具栏区域 - 固定在底部 */}
        <div class="shrink-0">
          {/* AI Chat 工具栏 - 桌面端显示 */}
          <Show when={activeTerminalId()}>
            <div class="border-t border-base-300 bg-base-200">
              {/* Chat History - 可展开 */}
              <Show when={showChatHistory() && chatMessages().length > 0}>
                <div class="max-h-48 overflow-y-auto p-3 bg-base-100 border-b border-base-300">
                  <div class="space-y-2">
                    <For each={chatMessages()}>
                      {(message) => (
                        <div
                          class={`flex gap-2 ${message.role === "user"
                            ? "justify-end"
                            : "justify-start"
                            }`}
                        >
                          <div
                            class={`max-w-xs lg:max-w-md px-3 py-2 rounded-lg ${message.role === "user"
                              ? "bg-primary text-primary-content"
                              : "bg-base-300 text-base-content"
                              }`}
                          >
                            <div class="text-sm">{message.content}</div>
                            {message.command && (
                              <div class="text-xs opacity-70 mt-1 font-mono bg-black/20 px-2 py-1 rounded">
                                {message.command}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* AI Commands List - 显示在输入框上方 */}
              <Show when={aiResponse() && aiResponse()!.commands.length > 0}>
                <div class="max-w-4xl mx-auto px-3 pb-2">
                  <div class="bg-base-100 rounded-lg border border-base-300 shadow-sm">
                    <div class="p-3 border-b border-base-200">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <svg
                            class="w-4 h-4 text-primary"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          </svg>
                          <span class="text-sm font-medium">AI 生成的命令</span>
                        </div>
                        <button
                          class="btn btn-ghost btn-xs btn-circle"
                          onClick={() => setAiResponse(null)}
                          title="关闭命令列表"
                        >
                          <svg
                            class="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                      <div class="text-xs text-base-content/60 mt-1">
                        {aiResponse()!.explanation}
                      </div>
                    </div>

                    <div class="max-h-64 overflow-y-auto">
                      <For each={aiResponse()!.commands}>
                        {(command, index) => (
                          <div
                            class={`p-3 border-b border-base-200 last:border-b-0 hover:bg-base-50 transition-colors ${index() === 0 ? "bg-primary/5" : ""
                              }`}
                          >
                            <div class="flex items-start justify-between gap-3">
                              <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 mb-1">
                                  <div class="badge badge-primary badge-xs">
                                    {index() + 1}
                                  </div>
                                  <span class="text-sm font-medium text-base-content">
                                    {command.description}
                                  </span>
                                </div>

                                <div class="bg-base-200 rounded p-2 mb-2">
                                  <code class="text-xs font-mono text-base-content break-all">
                                    {command.command}
                                  </code>
                                </div>

                                <div class="text-xs text-base-content/60">
                                  {command.explanation}
                                </div>
                              </div>

                              <div class="flex flex-col gap-1">
                                <button
                                  class="btn btn-primary btn-xs"
                                  onClick={() =>
                                    executeAiCommand(command.command)
                                  }
                                  title="执行此命令"
                                >
                                  <svg
                                    class="w-3 h-3"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                                    />
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                  执行
                                </button>

                                <button
                                  class="btn btn-ghost btn-xs"
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      command.command,
                                    );
                                    // 可以添加一个临时的提示
                                    // const originalText = command.command; // Unused for now
                                    setTimeout(() => {
                                      // 可以显示复制成功的反馈
                                    }, 100);
                                  }}
                                  title="复制命令"
                                >
                                  <svg
                                    class="w-3 h-3"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                                    />
                                  </svg>
                                  复制
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>

                    <div class="p-2 bg-base-50 border-t border-base-200">
                      <div class="text-xs text-base-content/50 text-center">
                        💡
                        提示：点击执行按钮直接运行命令，或复制命令自行修改后执行
                      </div>
                    </div>
                  </div>
                </div>
              </Show>

              {/* Main Chat Input */}
              <div class="p-3">
                <div class="flex items-center gap-2 max-w-4xl mx-auto">
                  {/* Chat Toggle Button */}
                  <button
                    class={`btn btn-sm btn-square ${showChatHistory() ? "btn-primary" : "btn-ghost"
                      }`}
                    onClick={() => setShowChatHistory(!showChatHistory())}
                    title="聊天历史"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                    {chatMessages().length > 0 && (
                      <div class="badge badge-xs badge-primary absolute -top-1 -right-1">
                        {chatMessages().length}
                      </div>
                    )}
                  </button>

                  {/* AI Status Indicator */}
                  <div class="flex items-center gap-1">
                    <div
                      class={`w-2 h-2 rounded-full ${isAiThinking()
                        ? "bg-warning animate-pulse"
                        : "bg-success"
                        }`}
                    />
                    <span class="text-xs text-base-content/60">
                      {isAiThinking() ? "AI思考中..." : "AI助手"}
                    </span>
                  </div>

                  {/* Input Field */}
                  <div class="flex-1 relative">
                    <input
                      type="text"
                      placeholder="用自然语言描述你想要执行的操作..."
                      class="input input-bordered input-sm w-full"
                      value={aiChatInput()}
                      onInput={(e) => setAiChatInput(e.currentTarget.value)}
                      onKeyPress={handleAiChatKeyPress}
                      onFocus={() => setAiChatFocused(true)}
                      onBlur={() =>
                        setTimeout(() => setAiChatFocused(false), 200)
                      }
                      disabled={isAiThinking()}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div class="flex items-center gap-1">
                    {/* Clear History */}
                    <Show when={chatMessages().length > 0}>
                      <button
                        class="btn btn-ghost btn-xs btn-square"
                        onClick={clearChatHistory}
                        title="清空聊天历史"
                      >
                        <svg
                          class="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </Show>

                    {/* Send Button */}
                    <button
                      class="btn btn-primary btn-sm"
                      onClick={handleAiChatSubmit}
                      disabled={
                        !aiChatInput().trim() ||
                        !activeTerminalId() ||
                        isAiThinking()
                      }
                    >
                      <Show
                        when={isAiThinking()}
                        fallback={
                          <>
                            <svg
                              class="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                              />
                            </svg>
                            发送
                          </>
                        }
                      >
                        <span class="loading loading-spinner loading-xs"></span>
                      </Show>
                    </button>
                  </div>
                </div>

                {/* Quick Actions */}
                <div class="flex items-center gap-2 mt-2 max-w-4xl mx-auto">
                  <span class="text-xs text-base-content/50">
                    {(() => {
                      const sysInfo = systemInfo();
                      return sysInfo
                        ? `${sysInfo.os_info.name} 快捷操作:`
                        : "快捷操作:";
                    })()}
                  </span>
                  <button
                    class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
                    onClick={() => {
                      setAiChatInput("列出当前目录文件并显示详细信息");
                      handleAiChatSubmit();
                    }}
                    disabled={isAiThinking()}
                  >
                    列出文件
                  </button>
                  <button
                    class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
                    onClick={() => {
                      setAiChatInput("搜索文件中的文本内容");
                      handleAiChatSubmit();
                    }}
                    disabled={isAiThinking()}
                  >
                    搜索文本
                  </button>
                  <button
                    class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
                    onClick={() => {
                      setAiChatInput("检查Git仓库状态和修改");
                      handleAiChatSubmit();
                    }}
                    disabled={isAiThinking()}
                  >
                    Git状态
                  </button>
                  <button
                    class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
                    onClick={() => {
                      const sysInfo = systemInfo();
                      const packageManager =
                        sysInfo?.available_tools.package_managers[0] ||
                        "包管理器";
                      setAiChatInput(`使用${packageManager}安装软件`);
                      handleAiChatSubmit();
                    }}
                    disabled={isAiThinking()}
                  >
                    安装软件
                  </button>
                  <button
                    class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
                    onClick={() => {
                      const sysInfo = systemInfo();
                      const osName = sysInfo?.os_info.name || "系统";
                      setAiChatInput(`查看${osName}系统信息`);
                      handleAiChatSubmit();
                    }}
                    disabled={isAiThinking()}
                  >
                    系统信息
                  </button>
                </div>
              </div>
            </div>
          </Show>

          {/* 底部快捷键栏 - 移动端显示 */}
          <Show when={isMobile && activeTerminalId()}>
            {renderShortcutBar()}
          </Show>
        </div>
      </div>

      {/* 左侧边栏 - 必须在 drawer-content 之后 */}
      <div class="drawer-side z-40">
        <label for="left-sidebar-drawer" class="drawer-overlay"></label>
        <aside class="w-72 min-h-full bg-base-100 border-r border-base-300 flex flex-col">
          {renderSidebar()}
        </aside>
      </div>
    </div>
  );
}
