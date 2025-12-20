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
import { AIHelper } from "./AIHelper";

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
  hasPendingInput?: boolean; // 是否有待发送的输入
}

// 截断路径，显示末尾部分，前面用...省略
const truncatePath = (path: string, maxLength: number = 24): string => {
  if (path.length <= maxLength) return path;
  return "..." + path.slice(-(maxLength - 3));
};

// 加载本地 Nerd Font 字体文件
const loadLocalFont = async (): Promise<{ loaded: boolean; fontName: string }> => {
  try {
    // 尝试不同的字体文件路径
    const fontPaths = [
      './src/FiraCodeNerdFont-Regular.ttf',
      '/src/FiraCodeNerdFont-Regular.ttf',
      './FiraCodeNerdFont-Regular.ttf',
      '/FiraCodeNerdFont-Regular.ttf'
    ];

    let loadedFont = null;

    for (const fontPath of fontPaths) {
      try {
        console.log(`🔍 Trying font path: ${fontPath}`);
        const font = new FontFace(
          'FiraCode Nerd Font',
          `url(${fontPath}) format('truetype')`
        );

        // 尝试加载字体
        await font.load();
        document.fonts.add(font);
        loadedFont = font;
        console.log(`✅ FiraCode Nerd Font loaded successfully from: ${fontPath}`);
        break;
      } catch (pathError) {
        console.log(`❌ Failed to load from ${fontPath}:`, pathError);
        continue;
      }
    }

    if (loadedFont) {
      return { loaded: true, fontName: 'FiraCode Nerd Font' };
    } else {
      throw new Error("All font paths failed");
    }
  } catch (error) {
    console.error("❌ Failed to load local FiraCode Nerd Font:", error);
    return { loaded: false, fontName: '' };
  }
};

// 检测系统字体支持
const detectFontSupport = () => {
  const testFonts = [
    { name: 'FiraCode Nerd Font', type: 'local' },
    { name: 'Menlo', type: 'system' },
    { name: 'Monaco', type: 'system' },
    { name: '"Courier New"', type: 'system' },
    { name: 'monospace', type: 'fallback' }
  ];

  // 测试字体是否可用
  for (const font of testFonts) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `16px ${font.name}`;
      const testChar = '\uf0e7'; // Git 图标
      const width = context.measureText(testChar).width;

      if (width > 0) {
        console.log(`✅ Font available: ${font.name} (${font.type})`);
        return font;
      }
    }
  }

  console.warn("⚠️ No suitable fonts found, using fallback");
  return { name: 'monospace', type: 'fallback' };
};

export function RemoteSessionView(props: RemoteSessionViewProps) {
  const [terminals, setTerminals] = createSignal<TerminalInfo[]>([]);
  const [terminalSessions, setTerminalSessions] = createSignal<
    Map<string, TerminalSession>
  >(new Map());
  const [activeTerminalId, setActiveTerminalId] = createSignal<string | null>(
    null,
  );
  const [bestFont, setBestFont] = createSignal<string>('monospace');

  // 优化后的输入发送函数
  const sendInputImmediately = (
    sessionId: string,
    terminalId: string,
    session: TerminalSession,
  ) => {
    // 清除防抖定时器
    if (session.sendTimeout) {
      clearTimeout(session.sendTimeout);
      session.sendTimeout = null;
    }

    if (session.inputBuffer && session.inputBuffer.length > 0) {
      const dataToSend = session.inputBuffer;
      console.log("🚀 Sending input immediately:", JSON.stringify(dataToSend));

      // 清空输入缓冲区
      session.inputBuffer = "";

      // 保存命令到会话（如果有实际内容）
      const trimmedCommand = dataToSend.trim();
      if (trimmedCommand) {
        // 从会话管理器获取对应的 Hook 来保存命令
        const terminalSessionHook = session.terminalSession;
        if (terminalSessionHook) {
          terminalSessionHook.saveCommand(trimmedCommand);
        }
      }

      invoke("send_terminal_input_to_terminal", {
        sessionId: sessionId,
        terminalId: terminalId,
        input: dataToSend,
      }).catch((error) => {
        console.error("❌ Failed to send terminal input:", error);
        // 发送失败时重置状态
        session.hasPendingInput = false;
      });
    }
  };

  // 防抖输入发送调度
  const scheduleInputSend = (
    session: TerminalSession,
    sendCallback: () => void,
  ) => {
    // 清除现有定时器
    if (session.sendTimeout) {
      clearTimeout(session.sendTimeout);
    }

    // 设置新的防抖定时器（减少到200ms提高响应性）
    session.sendTimeout = setTimeout(sendCallback, 200);
  };

  // 全局会话管理
  const terminalSessionManager = useTerminalSessions();

  // 创建终端相关状态
  const [terminalName, setTerminalName] = createSignal("");

  const [showAddMenu, setShowAddMenu] = createSignal(false);
  const [showCreateTerminalModal, setShowCreateTerminalModal] = createSignal(false);
  const [showTcpForwardingModal, setShowTcpForwardingModal] = createSignal(false);


  // 侧边栏标签页状态
  const [activeSidebarTab, setActiveSidebarTab] = createSignal<
    "terminals" | "services"
  >("terminals");

  // 侧边栏状态
  const [sidebarOpen, setSidebarOpen] = createSignal(true); // 默认开启，由CSS控制响应式

  // Helper functions for AI integration
  const handleExecuteCommand = async (command: string) => {
    const activeId = activeTerminalId();
    if (!activeId) return;

    try {
      await invoke("send_terminal_input_to_terminal", {
        sessionId: props.sessionId,
        terminalId: activeId,
        input: command + "\n",
      });
    } catch (error) {
      console.error("Failed to execute command:", error);
    }
  };

  const handleCreateTerminal = async (config?: { name?: string; rows?: number; cols?: number }): Promise<string> => {
    const size = calculateTerminalSize();
    const terminalId = await invoke<string>("create_terminal", {
      sessionId: props.sessionId,
      name: config?.name,
      size: config?.rows && config?.cols ? [config.rows, config.cols] : [size.rows, size.cols],
    });
    return terminalId;
  };

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
  const [tcpForwardingType, setTcpForwardingType] = createSignal<"ListenToRemote" | "ConnectToRemote">("ListenToRemote");

  // TCP会话详情Modal状态
  const [selectedTcpSession, setSelectedTcpSession] = createSignal<{
    id: string;
    local_addr: string;
    remote_target: string;
    forwarding_type: string;
    active_connections: number;
    bytes_sent: number;
    bytes_received: number;
    status: string;
    created_at: number;
  } | null>(null);

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

  // 智能刷新列表 - 根据当前活动标签刷新对应内容
  const handleRefreshList = () => {
    if (activeSidebarTab() === "services") {
      // 当前在服务标签页，刷新TCP转发会话
      loadTcpSessions();
    } else {
      // 默认刷新终端列表
      fetchTerminals();
    }
  };

  // 停止 TCP 转发会话
  const stopTcpSession = async (tcpSessionId: string) => {
    try {
      await invoke("stop_tcp_forwarding_session", {
        sessionId: props.sessionId,
        tcpSessionId
      });

      // 立即从前端TCP会话列表中移除
      const currentSessions = tcpSessions();
      const updatedSessions = currentSessions.filter(s => s.id !== tcpSessionId);
      setTcpSessions(updatedSessions);
      console.log("🗑️ Removed TCP session from list:", tcpSessionId);

      // 关闭详情模态框（如果显示的是被删除的会话）
      const selectedSession = selectedTcpSession();
      if (selectedSession && selectedSession.id === tcpSessionId) {
        setSelectedTcpSession(null);
      }
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


  // 获取转发类型的简短显示
  const getForwardingTypeLabel = (type: string): string => {
    return type.includes('ListenToRemote') ? '监听远程' : '连接本地';
  };

  // 处理TCP会话点击
  const handleTcpSessionClick = async (session: any) => {
    // 先刷新TCP会话列表以获取最新统计信息
    console.log("🔄 Refreshing TCP sessions before showing details");
    try {
      await loadTcpSessions();

      // 等待一小段时间确保数据已更新
      setTimeout(() => {
        // 根据ID找到最新的会话数据
        const currentSessions = tcpSessions();
        const updatedSession = currentSessions.find(s => s.id === session.id);
        if (updatedSession) {
          console.log("📊 Updated session data:", updatedSession);
          setSelectedTcpSession(updatedSession);
        } else {
          // 如果找不到，使用原始数据
          setSelectedTcpSession(session);
        }
      }, 300);
    } catch (error) {
      console.error("Failed to refresh TCP sessions:", error);
      // 如果刷新失败，使用原始数据
      setSelectedTcpSession(session);
    }
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

      // 立即从前端终端列表中移除
      const currentTerminals = terminals();
      const updatedTerminals = currentTerminals.filter(t => t.id !== terminalId);
      setTerminals(updatedTerminals);
      console.log("🗑️ Removed terminal from list:", terminalId);

      // 清理本地终端会话
      const sessions = terminalSessions();
      const session = sessions.get(terminalId);
      if (session) {

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
        fontFamily: bestFont(),
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
        hasPendingInput: false,
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


      // 设置终端数据处理器 - 优化版本
      terminal.onData((data) => {
        console.log("📝 Terminal input:", JSON.stringify(data));

        // 特殊处理 Ctrl+C
        if (data === "\x03") {
          console.log("🎯 检测到 Ctrl+C 输入");
          // Ctrl+C handled directly by sending to remote
          // 依赖远端回显，不在本地写入
          invoke("send_terminal_input_to_terminal", {
            sessionId: props.sessionId,
            terminalId: terminalId,
            input: data,
          }).catch((error) => {
            console.error("Failed to send Ctrl+C:", error);
          });
          return;
        }

        // 累积输入到会话缓冲区（仅用于发送）
        terminalSession.inputBuffer = (terminalSession.inputBuffer || "") + data;
        terminalSession.hasPendingInput = true;

        // 依赖远程终端的输出来显示，不做本地输入处理
        console.log("📝 Terminal input:", JSON.stringify(data));

        // 检查是否是回车键，如果是则立即发送
        if (data === "\r" || data === "\n") {
          console.log("🚀 Enter key detected, sending immediately");
          sendInputImmediately(props.sessionId, terminalId, terminalSession);
        } else {
          // 对于其他输入，使用防抖机制
          scheduleInputSend(terminalSession, () => {
            sendInputImmediately(props.sessionId, terminalId, terminalSession);
          });
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

      // console.log("📤 Received terminal output:", {
      //   terminalId,
      //   dataLength: data?.length,
      // });
      console.log("   Preview:", data);

      const sessions = terminalSessions();
      const session = sessions.get(terminalId);

      if (session && session.isActive) {
        // 确保数据是字符串类型
        let outputData = typeof data === "string" ? data : String(data || "");

        // 只有当还有数据时才写入
        if (outputData.length > 0) {
          session.terminal.write(outputData);
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

    // 尝试加载本地字体文件
    console.log("🔤 Loading local FiraCode Nerd Font...");
    const localFontResult = await loadLocalFont();

    if (localFontResult.loaded) {
      // 本地字体加载成功，使用它
      setBestFont('FiraCode Nerd Font');
      console.log("✅ Using local FiraCode Nerd Font");
    } else {
      // 本地字体加载失败，检测系统字体
      console.log("🔍 Local font failed, checking system fonts...");
      const detectedFont = detectFontSupport();
      setBestFont(detectedFont.name);

      if (detectedFont.type !== 'fallback') {
        console.log(`✅ Using system font: ${detectedFont.name}`);
      } else {
        console.warn("⚠️ Using fallback font. Icons may not display correctly.");
      }
    }

    // 初始加载数据
    await fetchTerminals();
    await loadTcpSessions();

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

  // 监听标签页切换，自动刷新TCP会话列表
  createEffect(() => {
    const currentTab = activeSidebarTab();
    if (currentTab === "services") {
      console.log("🔄 Switched to services tab, refreshing TCP sessions");
      loadTcpSessions();
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
          <div class="flex items-center gap-1">
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
            <div class="flex items-center gap-1">
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
            <div class="flex items-center gap-1">
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
            <div class="space-y-2">
              <For each={tcpSessions()}>
                {(session) => (
                  <div
                    class="card card-compact bg-base-200 hover:bg-base-300 transition-all duration-200 cursor-pointer"
                    onClick={() => handleTcpSessionClick(session)}
                  >
                    <div class="card-body p-0">
                      <div class="flex items-center justify-between">
                        <div class="flex flex-col gap-3 flex-1 min-w-0">
                          {/* 类型标签 */}
                          <div class="badge badge-outline badge-sm">
                            {getForwardingTypeLabel(session.forwarding_type)}
                            <div class="flex items-center gap-2">
                              {/* 状态指示器 */}
                              <div class={`w-2 h-2 rounded-full ${session.status === 'running' ? 'bg-success' :
                                session.status === 'stopped' ? 'bg-error' :
                                  'bg-warning'
                                }`} title={session.status}>
                              </div>

                              {/* 连接数 */}
                              <Show when={session.active_connections > 0}>
                                <div class="badge badge-primary badge-xs">
                                  {session.active_connections}
                                </div>
                              </Show>
                            </div>
                          </div>

                          {/* 本地端口 */}
                          <div class="flex items-center gap-1 text-xs">
                            <span class="text-base-content/50">local:</span>
                            <span class="font-semibold">{session.local_addr}</span>
                          </div>

                          {/* 远程端口 */}
                          <div class="flex items-center gap-1 text-xs">
                            <span class="text-base-content/50">remote:</span>
                            <span class="font-semibold">{session.remote_target}</span>
                          </div>
                        </div>

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
          onClick={() => handleRefreshList()}
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
        {/* Mobile AI Helper Bar */}
        <AIHelper
          sessionId={props.sessionId}
          terminals={terminals}
          activeTerminalId={activeTerminalId}
          systemInfo={systemInfo}
          onExecuteCommand={handleExecuteCommand}
          onCreateTerminal={handleCreateTerminal}
        />

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
            <div class="form-control hidden">
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
          <div class="navbar min-h-12 px-2 md:px-4">
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
              <div role="tablist" class="tabs tabs-lift gap-1 p-1">
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
          {/* AI Helper - 桌面端显示 */}
          <Show when={activeTerminalId() && !isMobile}>
            <div class="border-t border-base-300 bg-base-200">
              <AIHelper
                sessionId={props.sessionId}
                terminals={terminals}
                activeTerminalId={activeTerminalId}
                systemInfo={systemInfo}
                onExecuteCommand={handleExecuteCommand}
                onCreateTerminal={handleCreateTerminal}
              />
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

      {/* TCP会话详情Modal */}
      <Show when={selectedTcpSession()}>
        <div class="modal modal-open">
          <div class="modal-box max-w-md">
            <h3 class="font-bold text-lg mb-4">TCP 转发会话详情</h3>

            <div class="space-y-4">
              {/* 基本信息 */}
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="text-sm text-base-content/50">会话ID</div>
                  <div class="font-mono text-xs bg-base-200 p-2 rounded mt-1 truncate">
                    {selectedTcpSession()?.id}
                  </div>
                </div>
                <div>
                  <div class="text-sm text-base-content/50">状态</div>
                  <div class={`badge badge-sm mt-1 ${selectedTcpSession()?.status === 'running' ? 'badge-success' :
                    selectedTcpSession()?.status === 'stopped' ? 'badge-error' :
                      'badge-warning'
                    }`}>
                    {selectedTcpSession()?.status}
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="text-sm text-base-content/50">转发类型</div>
                  <div class="badge badge-outline badge-sm mt-1">
                    {getForwardingTypeLabel(selectedTcpSession()?.forwarding_type || '')}
                  </div>
                </div>
                <div>
                  <div class="text-sm text-base-content/50">创建时间</div>
                  <div class="text-xs mt-1">
                    {formatDate(selectedTcpSession()?.created_at || 0)}
                  </div>
                </div>
              </div>

              {/* 地址信息 */}
              <div class="divider">地址配置</div>

              <div>
                <div class="text-sm text-base-content/50">本地地址</div>
                <div class="font-mono text-sm bg-base-200 p-2 rounded mt-1">
                  {selectedTcpSession()?.local_addr}
                </div>
              </div>

              <div>
                <div class="text-sm text-base-content/50">远程目标</div>
                <div class="font-mono text-sm bg-base-200 p-2 rounded mt-1">
                  {selectedTcpSession()?.remote_target}
                </div>
              </div>

              {/* 统计信息 */}
              <div class="divider">传输统计</div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="text-sm text-base-content/50">活跃连接</div>
                  <div class="text-2xl font-bold text-primary mt-1">
                    {selectedTcpSession()?.active_connections}
                  </div>
                </div>
                <div>
                  <div class="text-sm text-base-content/50">总连接数</div>
                  <div class="text-2xl font-bold text-secondary mt-1">
                    {selectedTcpSession()?.active_connections}
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <div class="text-sm text-base-content/50">已发送</div>
                  <div class="text-lg font-semibold text-success mt-1">
                    {formatBytes(selectedTcpSession()?.bytes_sent || 0)}
                  </div>
                </div>
                <div>
                  <div class="text-sm text-base-content/50">已接收</div>
                  <div class="text-lg font-semibold text-info mt-1">
                    {formatBytes(selectedTcpSession()?.bytes_received || 0)}
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div class="divider">操作</div>

              <div class="flex gap-2">
                <button
                  class="btn btn-error btn-sm flex-1"
                  onClick={() => {
                    const session = selectedTcpSession();
                    if (session) {
                      stopTcpSession(session.id);
                      setSelectedTcpSession(null);
                    }
                  }}
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  停止会话
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={() => setSelectedTcpSession(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
