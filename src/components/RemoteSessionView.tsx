import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ConnectionApi } from "../utils/api";
import { createConnectionHandler } from "../hooks/useConnection";
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
  associated_webshares: number[];
}

interface WebShareInfo {
  local_port: number;
  public_port: number;
  service_name: string;
  terminal_id?: string;
  status: "Starting" | "Active" | "Error" | "Stopped" | string;
  created_at: number;
}

interface RemoteSessionViewProps {
  nodeTicket: string;
  onDisconnect: () => void;
  onBack: () => void;
}

interface TerminalSession {
  terminalId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  isActive: boolean;
}

export function RemoteSessionView(props: RemoteSessionViewProps) {
  const [terminals, setTerminals] = createSignal<TerminalInfo[]>([]);
  const [webshares, setWebshares] = createSignal<WebShareInfo[]>([]);
  const [terminalSessions, setTerminalSessions] = createSignal<
    Map<string, TerminalSession>
  >(new Map());
  const [activeTerminalId, setActiveTerminalId] = createSignal<string | null>(
    null
  );

  // 创建终端弹窗相关状态
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [terminalName, setTerminalName] = createSignal("");

  // 错误提示状态
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [showError, setShowError] = createSignal(false);

  // 连接状态
  const [connectionStatus, setConnectionStatus] = createSignal<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isLoading, setIsLoading] = createSignal(false);

  // 文本输入相关状态
  const [textInput, setTextInput] = createSignal("");
  const [isInputFocused, setIsInputFocused] = createSignal(false);

  // AI修正和上传相关状态
  const [isCorrectingText, setIsCorrectingText] = createSignal(false);
  const [uploadedImages, setUploadedImages] = createSignal<string[]>([]);
  const [isRecording, setIsRecording] = createSignal(false);

  // 显示错误信息
  const showErrorMessage = (message: string) => {
    setErrorMessage(message);
    setShowError(true);
    setTimeout(() => {
      setShowError(false);
      setErrorMessage(null);
    }, 5000); // 5秒后自动消失
  };

  // 更新连接状态
  const updateConnectionStatus = (status: 'connecting' | 'connected' | 'disconnected') => {
    setConnectionStatus(status);
    if (status === 'disconnected') {
      showErrorMessage("与远程会话的连接已断开，请重新连接");
    }
  };

  // 顶部导航栏显示的终端和WebShare信息
  const getActiveTerminalDisplay = () => {
    if (activeTerminalId()) {
      const terminal = terminals().find(t => t.id === activeTerminalId());
      return `term:${terminal?.name || `Terminal ${activeTerminalId()?.slice(0, 8)}`}`;
    }
    return `term:${terminals().length > 0 ? terminals()[0].name || `Terminal ${terminals()[0].id.slice(0, 8)}` : '无终端'}`;
  };

  const getWebShareDisplay = () => {
    if (webshares().length === 0) {
      return 'web:无服务';
    } else if (webshares().length === 1) {
      return `web:${webshares()[0].public_port}`;
    } else {
      return `web:${webshares().map(ws => ws.public_port).join(',')}`;
    }
  };


  let containerRef: HTMLDivElement | undefined;

  // 带重试机制的获取终端列表 (简化为 DumbPipe 模式)
  const fetchTerminalsWithRetry = async (retryCount = 3, delay = 1000) => {
    setIsLoading(true);
    try {
      // For DumbPipe, we don't have a traditional list command
      // Terminals are created and managed on demand
      setTerminals([]);
      updateConnectionStatus('connected');
    } catch (error) {
      console.error("Failed to initialize terminal state:", error);
      showErrorMessage("Failed to initialize terminal management");
    } finally {
      setIsLoading(false);
    }
  };

  // 带重试机制的获取WebShare列表 (简化为 DumbPipe 模式)
  const fetchWebSharesWithRetry = async (retryCount = 3, delay = 1000) => {
    try {
      // For DumbPipe, WebShares are managed differently
      // We'll start with an empty list and manage them manually
      setWebshares([]);
    } catch (error) {
      console.error("Failed to initialize WebShare state:", error);
      showErrorMessage("Failed to initialize WebShare management");
    }
  };

  // 保持原有函数的兼容性
  const fetchTerminals = () => fetchTerminalsWithRetry();
  const fetchWebShares = () => fetchWebSharesWithRetry();

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
    setShowCreateDialog(true);
  };

  // 确认创建终端
  const confirmCreateTerminal = async () => {
    const size = calculateTerminalSize();
    await createTerminal({
      name: terminalName() || undefined,
      rows: size.rows,
      cols: size.cols,
    });
    setShowCreateDialog(false);
  };

  // 创建新终端（带重试机制）
  const createTerminal = async (config?: {
    name?: string;
    shell_path?: string;
    working_dir?: string;
    rows?: number;
    cols?: number;
  }, retryCount = 2, delay = 1000) => {
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        // Use DumbPipe API for terminal creation
        const result = await ConnectionApi.createDumbPipeTerminal(
          props.nodeTicket,
          config?.name,
          config?.shell_path,
          config?.working_dir,
          config?.rows,
          config?.cols
        );
        console.log("Terminal created:", result);
        return; // 成功则退出
      } catch (error) {
        console.error(`Failed to create terminal (attempt ${attempt + 1}/${retryCount}):`, error);

        // 如果是最后一次尝试，显示错误
        if (attempt === retryCount - 1) {
          // 提供用户友好的错误信息
          let userMessage = "创建终端失败";
          if (error && typeof error === 'string') {
            if (error.includes("No active connection for session")) {
              userMessage = "会话连接尚未建立，请稍后重试或刷新页面";
            } else if (error.includes("Connection refused")) {
              userMessage = "无法连接到服务器，请检查网络连接";
            } else if (error.includes("timeout")) {
              userMessage = "请求超时，请稍后重试";
            } else {
              userMessage = `创建终端失败: ${error}`;
            }
          } else if (error && typeof error === 'object' && 'message' in error) {
            userMessage = `创建终端失败: ${error.message}`;
          }

          showErrorMessage(userMessage);
        } else if (error && typeof error === 'string' && error.includes("No active connection for session")) {
          // 如果是连接问题，等待后重试
          console.log(`Retrying create_terminal in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // 指数退避
        } else {
          // 其他类型的错误不重试
          let userMessage = "创建终端失败";
          if (error && typeof error === 'string') {
            if (error.includes("Connection refused")) {
              userMessage = "无法连接到服务器，请检查网络连接";
            } else if (error.includes("timeout")) {
              userMessage = "请求超时，请稍后重试";
            } else {
              userMessage = `创建终端失败: ${error}`;
            }
          } else if (error && typeof error === 'object' && 'message' in error) {
            userMessage = `创建终端失败: ${error.message}`;
          }
          showErrorMessage(userMessage);
          return;
        }
      }
    }
  };

  // 创建WebShare
  const createWebShare = async (config: {
    local_port: number;
    public_port?: number;
    service_name: string;
    terminal_id?: string;
  }) => {
    try {
      // For DumbPipe, WebShare creation is handled differently
      // TODO: Implement DumbPipe WebShare creation
      console.log("WebShare creation not yet implemented for DumbPipe");
    } catch (error) {
      console.error("Failed to create webshare:", error);

      let userMessage = "创建WebShare失败";
      if (error && typeof error === 'string') {
        if (error.includes("No active connection for session")) {
          userMessage = "会话连接已断开，请重新连接";
        } else if (error.includes("Port already in use")) {
          userMessage = "端口已被使用，请选择其他端口";
        } else {
          userMessage = `创建WebShare失败: ${error}`;
        }
      }
      showErrorMessage(userMessage);
    }
  };

  // 停止终端
  const stopTerminal = async (terminalId: string) => {
    try {
      // For DumbPipe, send exit command to stop terminal
      try {
        const result = await ConnectionApi.sendDumbPipeCommand(props.nodeTicket, "exit");
        console.log("Terminal stop command sent:", result);
      } catch (error) {
        console.error("Failed to stop terminal:", error);
      }

      // 清理本地终端会话
      const sessions = terminalSessions();
      const session = sessions.get(terminalId);
      if (session) {
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

      let userMessage = "停止终端失败";
      if (error && typeof error === 'string') {
        if (error.includes("No active connection for session")) {
          userMessage = "会话连接已断开，请重新连接";
        } else {
          userMessage = `停止终端失败: ${error}`;
        }
      }
      showErrorMessage(userMessage);
    }
  };

  // 发送文本到终端
  const sendTextToTerminal = async () => {
    const text = textInput();
    const activeId = activeTerminalId();

    if (!text.trim() || !activeId) return;

    try {
      // Use DumbPipe API for sending input
      const result = await ConnectionApi.sendDumbPipeInput(props.nodeTicket, text);
      console.log("Text sent:", result);
      setTextInput(""); // 发送后清空输入框
    } catch (error) {
      console.error("Failed to send text to terminal:", error);
      showErrorMessage("发送文本失败");
    }
  };

  // 处理键盘快捷键
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      sendTextToTerminal();
    }
  };

  // AI修正文本语法
  const correctTextWithAI = async () => {
    const text = textInput();
    if (!text.trim()) return;

    setIsCorrectingText(true);
    try {
      // 这里可以集成AI API来修正文本
      // 目前先提供一个占位实现
      showErrorMessage("AI修正功能开发中...");
      // TODO: 集成实际的AI修正API
      // const correctedText = await invoke("correct_text_with_ai", { text });
      // setTextInput(correctedText);
    } catch (error) {
      console.error("AI correction failed:", error);
      showErrorMessage("AI修正失败");
    } finally {
      setIsCorrectingText(false);
    }
  };

  // 处理图片上传
  const handleImageUpload = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const files = target.files;

    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          setUploadedImages(prev => [...prev, result]);
          showErrorMessage(`已上传图片: ${file.name}`);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  // 处理语音输入
  const toggleVoiceRecording = () => {
    if (isRecording()) {
      // 停止录音
      setIsRecording(false);
      showErrorMessage("语音功能开发中...");
      // TODO: 实现实际的语音转文字功能
    } else {
      // 开始录音
      setIsRecording(true);
      showErrorMessage("语音功能开发中...");
      // TODO: 实现实际的语音录制和转换
    }
  };

  // 连接到终端
  const connectToTerminal = async (terminalId: string) => {
    try {
      // 检查是否已有该终端的会话
      const sessions = terminalSessions();
      if (sessions.has(terminalId)) {
        setActiveTerminalId(terminalId);
        return;
      }

      // 创建新的终端实例
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: "#1a1a1a",
          foreground: "#f0f0f0",
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      // 创建终端会话
      const terminalSession: TerminalSession = {
        terminalId,
        terminal,
        fitAddon,
        isActive: true,
      };

      // 添加到会话映射
      const newSessions = new Map(sessions);
      newSessions.set(terminalId, terminalSession);
      setTerminalSessions(newSessions);
      setActiveTerminalId(terminalId);

      // 设置终端数据处理器
      terminal.onData(async (data) => {
        try {
          const result = await ConnectionApi.sendDumbPipeInput(props.nodeTicket, data);
          console.log("Input sent:", result);
        } catch (error) {
          console.error("Failed to send terminal input:", error);
        };
      });

      // 告诉CLI端我们连接到了这个终端
      // For DumbPipe, we don't need to connect to terminal separately
      // The connection is established through the node ticket
      console.log(`Connected to terminal ${terminalId}`);
    } catch (error) {
      console.error("Failed to connect to terminal:", error);
    }
  };

  // 监听终端输出
  const setupTerminalEventListeners = async () => {
    await listen(`terminal-output-${props.nodeTicket.replace(/[^a-zA-Z0-9-_:/]/g, '')}`, (event) => {
      const { terminalId, data } = event.payload;
      const sessions = terminalSessions();
      const session = sessions.get(terminalId);

      if (session && session.isActive) {
        session.terminal.write(data);
      }
    });

    await listen(`terminal-event-${props.nodeTicket.replace(/[^a-zA-Z0-9-_:/]/g, '')}`, (event) => {
      console.log("Terminal event:", event.payload);

      // 处理终端列表响应 - 使用新的结构化数据
      if (
        event.payload.event_type &&
        typeof event.payload.event_type === "object" &&
        "TerminalList" in event.payload.event_type
      ) {
        try {
          // 新的结构化格式直接从event_type中获取终端列表
          console.log("Received structured TerminalList event:", event.payload);
          const terminalData =
            (event.payload.event_type as any).TerminalList || [];
          console.log("Parsed terminal list:", terminalData);
          setTerminals(terminalData);
        } catch (error) {
          console.error(
            "Failed to parse structured terminal list event:",
            error
          );
        }
      }

      // 兼容旧的字符串格式
      if (
        event.payload.data &&
        event.payload.data.includes("[Terminal List Response:")
      ) {
        try {
          // 解析终端列表响应格式: "[Terminal List Response: X terminals] [{\"id\":\"...\"}]"
          const match = event.payload.data.match(
            /\[Terminal List Response: (\d+) terminals\] (.+)/
          );
          if (match && match[2]) {
            const terminalData = JSON.parse(match[2]);
            console.log("Parsed terminal list (legacy):", terminalData);
            setTerminals(terminalData);
          }
        } catch (error) {
          console.error(
            "Failed to parse legacy terminal list response:",
            error
          );
        }
      }

      // 处理终端输出事件 - 使用新的结构化数据
      if (
        event.payload.event_type &&
        typeof event.payload.event_type === "object" &&
        "TerminalOutput" in event.payload.event_type
      ) {
        try {
          // 新的结构化格式直接从event_type中提取数据
          console.log(
            "Received structured TerminalOutput event:",
            event.payload
          );

          const terminalOutput = (event.payload.event_type as any)
            .TerminalOutput;
          if (
            terminalOutput &&
            terminalOutput.terminal_id &&
            terminalOutput.data
          ) {
            const terminalId = terminalOutput.terminal_id;
            const outputData = terminalOutput.data;

            console.log(
              "🔥 Terminal output for terminal:",
              terminalId,
              "data:",
              outputData
            );
            console.log(
              "🔥 Available terminal sessions:",
              Array.from(terminalSessions().keys())
            );

            const sessions = terminalSessions();
            const session = sessions.get(terminalId);

            if (session && session.isActive) {
              console.log("✅ Writing to terminal session:", terminalId);
              session.terminal.write(outputData);
            } else {
              console.warn(
                "⚠️ No active terminal session found for:",
                terminalId
              );
              // 如果没有找到对应的终端会话，可能需要自动创建一个
              console.log(
                "🔄 Attempting to auto-connect to terminal:",
                terminalId
              );
              connectToTerminal(terminalId);
            }
          }
        } catch (error) {
          console.error(
            "Failed to parse structured terminal output event:",
            error
          );
        }
      }

      // 兼容旧的字符串格式（保留作为后备）
      if (
        event.payload.data &&
        event.payload.data.includes("[Terminal Output:")
      ) {
        try {
          // 解析终端输出格式: "[Terminal Output: terminal_id] data"
          const rawData = event.payload.data;
          console.log("Raw data (repr):", JSON.stringify(rawData));
          console.log("Raw data (length):", rawData.length);
          console.log(
            "Raw data (contains Terminal Output):",
            rawData.includes("[Terminal Output:")
          );

          // 尝试多种匹配方式
          let match = rawData.match(/\[Terminal Output: ([^]]+)\] (.*)/);
          console.log("First match attempt:", match);

          if (!match) {
            // 尝试包含换行符的匹配
            match = rawData.match(/\[Terminal Output: ([^\]]+)\]\s*(.*)/s);
            console.log("Second match attempt (with whitespace):", match);
          }

          if (!match) {
            // 尝试更宽松的匹配
            match = rawData.match(/\[Terminal Output:[^\]]*\]([^\]]*)\](.*)/);
            console.log("Third match attempt (loose):", match);
          }
          if (match && match[1] && match[2]) {
            const terminalId = match[1];
            const outputData = match[2];

            console.log(
              "🔥 Legacy terminal output for terminal:",
              terminalId,
              "data:",
              outputData
            );

            const sessions = terminalSessions();
            const session = sessions.get(terminalId);

            if (session && session.isActive) {
              console.log(
                "✅ Writing to terminal session (legacy):",
                terminalId
              );
              session.terminal.write(outputData);
            } else {
              console.warn(
                "⚠️ No active terminal session found for (legacy):",
                terminalId
              );
            }
          }
        } catch (error) {
          console.error("Failed to parse legacy terminal output event:", error);
        }
      }

      // 处理WebShare列表响应 - 使用新的结构化数据
      if (
        event.payload.event_type &&
        typeof event.payload.event_type === "object" &&
        "WebShareList" in event.payload.event_type
      ) {
        try {
          // 新的结构化格式直接从event_type中获取WebShare列表
          console.log("Received structured WebShareList event:", event.payload);
          const webshareData =
            (event.payload.event_type as any).WebShareList || [];
          console.log("Parsed webshare list:", webshareData);
          setWebshares(webshareData);
        } catch (error) {
          console.error(
            "Failed to parse structured webshare list event:",
            error
          );
        }
      }

      // 兼容旧的字符串格式
      if (
        event.payload.data &&
        event.payload.data.includes("[WebShare List Response:")
      ) {
        try {
          // 解析WebShare列表响应格式: "[WebShare List Response: X webshares] [{\"local_port\":...}]"
          const match = event.payload.data.match(
            /\[WebShare List Response: (\d+) webshares\] (.+)/
          );
          if (match && match[2]) {
            const webshareData = JSON.parse(match[2]);
            console.log("Parsed webshare list (legacy):", webshareData);
            setWebshares(webshareData);
          }
        } catch (error) {
          console.error(
            "Failed to parse legacy webshare list response:",
            error
          );
        }
      }
    });
  };

  // 组件挂载时初始化
  onMount(async () => {
    await setupTerminalEventListeners();

    // 等待一段时间让CLI端建立session连接，然后初始加载数据
    console.log("Waiting for session to be established...");
    await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒

    console.log("Initializing data fetch...");
    await Promise.all([fetchTerminals(), fetchWebShares()]);
  });

  // 响应式更新
  createEffect(() => {
    if (activeTerminalId()) {
      setTimeout(() => {
        const sessions = terminalSessions();
        const session = sessions.get(activeTerminalId()!);
        if (session) {
          session.fitAddon.fit();
        }
      }, 100);
    }
  });


  // 渲染活动终端
  const renderActiveTerminal = () => {
    const terminalId = activeTerminalId();
    if (!terminalId) return null;

    const sessions = terminalSessions();
    const session = sessions.get(terminalId);
    if (!session) return null;

    return (
      <div class="flex-1 bg-black p-4">
        <div class="bg-base-100 rounded-t-lg px-4 py-2 flex justify-between items-center">
          <div class="text-sm font-medium">
            {terminals().find((t) => t.id === terminalId)?.name ||
              `Terminal ${terminalId.slice(0, 8)}`}
          </div>
          <button
            class="btn btn-ghost btn-sm"
            onClick={() => setActiveTerminalId(null)}
            title="关闭终端"
          >
            ✖️
          </button>
        </div>
        <div
          ref={(el) => {
            if (el && el.children.length === 0) {
              session.terminal.open(el);
              session.fitAddon.fit();
            }
          }}
          class="h-full"
          style={{ height: "calc(100% - 48px)" }}
        />
      </div>
    );
  };

  return (
    <div class="h-full flex flex-col">
      {/* 错误提示 */}
      <Show when={showError() && errorMessage()}>
        <div class="alert alert-error fixed top-4 right-4 w-80 z-50 shadow-lg">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{errorMessage()}</span>
          <button
            class="btn btn-ghost btn-sm"
            onClick={() => setShowError(false)}
          >
            ✕
          </button>
        </div>
      </Show>

      {/* 创建终端对话框 */}
      <Show when={showCreateDialog()}>
        <div class="modal modal-open">
          <div class="modal-box">
            <h3 class="font-bold text-lg mb-4">创建新终端</h3>
            <div class="form-control">
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
                class="btn btn-ghost"
                onClick={() => setShowCreateDialog(false)}
              >
                取消
              </button>
              <button class="btn btn-primary" onClick={confirmCreateTerminal}>
                创建
              </button>
            </div>
          </div>
          <div
            class="modal-backdrop"
            onClick={() => setShowCreateDialog(false)}
          />
        </div>
      </Show>

      {/* 头部 */}
      <div class="navbar bg-base-100 border-b min-h-[48px] px-2 sm:px-4">
        <div class="flex-1 flex items-center">
          <button class="btn btn-ghost btn-sm" onClick={props.onBack}>
            ← 返回
          </button>
        </div>

        {/* 中间信息显示区域 */}
        <div class="flex-none flex items-center space-x-2 sm:space-x-4">
          {/* 终端信息 */}
          <div
            class="badge badge-outline badge-sm sm:badge-md cursor-pointer hover:badge-primary"
            onClick={() => {
              // 如果有终端但没有活动的，自动连接第一个可用终端
              if (terminals().length > 0 && !activeTerminalId()) {
                const runningTerminal = terminals().find(t => t.status === "Running") || terminals()[0];
                connectToTerminal(runningTerminal.id);
              }
            }}
            title={activeTerminalId() ? "当前活动终端" : "点击连接终端"}
          >
            {getActiveTerminalDisplay()}
          </div>

          {/* WebShare信息 */}
          <div
            class="badge badge-outline badge-sm sm:badge-md cursor-pointer hover:badge-primary"
            onClick={() => {
              // 如果没有WebShare，创建一个默认的
              if (webshares().length === 0) {
                createWebShare({
                  local_port: 3000,
                  service_name: "Local Development Server",
                });
              }
            }}
            title={webshares().length > 0 ? "WebShare服务运行中" : "点击创建WebShare服务"}
          >
            {getWebShareDisplay()}
          </div>
        </div>

        <div class="flex-none flex items-center space-x-1">
          <button
            class="btn btn-ghost btn-sm"
            onClick={() => {
              console.log("Manual refresh triggered");
              Promise.all([fetchTerminalsWithRetry(5, 500), fetchWebSharesWithRetry(5, 500)]);
            }}
            title="刷新"
          >
            🔄
          </button>

          <button
            class="btn btn-ghost btn-sm"
            onClick={props.onDisconnect}
            title="断开连接"
          >
            🔌 断开
          </button>
        </div>
      </div>


      {/* 主内容 */}
      <div class="flex-1 flex flex-col overflow-hidden">
        {/* 终端显示区域 */}
        <div ref={containerRef} class="flex-1 flex overflow-hidden">
          {renderActiveTerminal()}

          {/* 无活动终端时的占位符 */}
          {!activeTerminalId() && (
            <div class="flex-1 flex items-center justify-center bg-base-200">
              <div class="text-center opacity-50 px-4">
                <div class="text-6xl mb-4">💻</div>
                <div class="text-xl">选择一个终端开始</div>
                <div class="text-sm mt-2">
                  点击顶部终端标签连接，或刷新按钮获取最新状态
                </div>
                <button
                  class="btn btn-primary btn-sm mt-4"
                  onClick={openCreateDialog}
                >
                  创建新终端
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 文本输入框和底部工具栏 */}
        <Show when={activeTerminalId()}>
          <div class="border-t bg-base-100">
            {/* 输入框区域 */}
            <div class="p-2">
              <textarea
                class="w-full textarea textarea-bordered textarea-sm resize-none"
                placeholder="输入命令或文本，Ctrl+Enter 发送..."
                value={textInput()}
                onInput={(e) => setTextInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                rows={isInputFocused() ? 4 : 2}
                style="min-height: 60px; max-height: 200px;"
              />

              {/* 显示已上传的图片 */}
              <Show when={uploadedImages().length > 0}>
                <div class="mt-2 flex flex-wrap gap-2">
                  <For each={uploadedImages()}>
                    {(imageSrc, index) => (
                      <div class="relative">
                        <img
                          src={imageSrc}
                          alt={`Uploaded ${index()}`}
                          class="w-12 h-12 object-cover rounded border"
                        />
                        <button
                          class="absolute -top-1 -right-1 btn btn-xs btn-circle btn-ghost bg-base-100 border"
                          onClick={() => {
                            setUploadedImages(prev => prev.filter((_, i) => i !== index()));
                          }}
                          title="移除图片"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* 底部工具栏 */}
            <div class="flex justify-between items-center px-2 pb-2">
              <div class="flex items-center space-x-2">
                {/* 闪电按钮 - AI修正文本语法 */}
                <button
                  class="btn btn-ghost btn-xs btn-circle"
                  onClick={correctTextWithAI}
                  disabled={!textInput().trim() || isCorrectingText()}
                  title="AI修正文本语法"
                >
                  <span class={`text-lg ${isCorrectingText() ? 'loading loading-spinner' : ''}`}>
                    ⚡
                  </span>
                </button>

                {/* 图片上传按钮 */}
                <div class="relative">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    class="hidden"
                    id="image-upload"
                    onChange={handleImageUpload}
                  />
                  <label
                    for="image-upload"
                    class="btn btn-ghost btn-xs btn-circle cursor-pointer"
                    title="上传图片"
                  >
                    🖼️
                  </label>
                </div>

                {/* 清空按钮 */}
                <button
                  class="btn btn-ghost btn-xs btn-circle"
                  onClick={() => setTextInput("")}
                  disabled={!textInput()}
                  title="清空输入"
                >
                  🗑️
                </button>
              </div>

              <div class="flex items-center space-x-2">
                {/* 发送按钮 */}
                <button
                  class="btn btn-primary btn-sm"
                  onClick={sendTextToTerminal}
                  disabled={!textInput().trim() || !activeTerminalId()}
                  title="发送到终端"
                >
                  发送
                </button>

                {/* 语音输入按钮 */}
                <button
                  class={`btn btn-ghost btn-xs btn-circle ${isRecording() ? 'btn-error animate-pulse' : ''}`}
                  onClick={toggleVoiceRecording}
                  title={isRecording() ? "停止录音" : "开始语音输入"}
                >
                  🎤
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
