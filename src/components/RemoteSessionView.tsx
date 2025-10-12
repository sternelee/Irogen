import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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
  sessionId: string;
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
  const [loading, setLoading] = createSignal(true);
  const [selectedTerminalId, setSelectedTerminalId] = createSignal<
    string | null
  >(null);
  const [terminalSessions, setTerminalSessions] = createSignal<
    Map<string, TerminalSession>
  >(new Map());
  const [activeTerminalId, setActiveTerminalId] = createSignal<string | null>(
    null
  );

  // 创建终端弹窗相关状态
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [terminalName, setTerminalName] = createSignal("");
  let containerRef: HTMLDivElement | undefined;

  // 获取终端列表
  const fetchTerminals = async () => {
    try {
      await invoke("get_terminal_list", { sessionId: props.sessionId });
    } catch (error) {
      console.error("Failed to fetch terminal list:", error);
    }
  };

  // 获取WebShare列表
  const fetchWebShares = async () => {
    try {
      await invoke("get_webshare_list", { sessionId: props.sessionId });
    } catch (error) {
      console.error("Failed to fetch webshare list:", error);
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

  // 创建新终端
  const createTerminal = async (config?: {
    name?: string;
    shell_path?: string;
    working_dir?: string;
    rows?: number;
    cols?: number;
  }) => {
    try {
      const request = {
        session_id: props.sessionId,
        name: config?.name,
        shell_path: config?.shell_path,
        working_dir: config?.working_dir,
        size:
          config?.rows && config?.cols ? [config.rows, config.cols] : undefined,
      };
      await invoke("create_terminal", { request });
    } catch (error) {
      console.error("Failed to create terminal:", error);
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
      const request = {
        session_id: props.sessionId,
        ...config,
      };
      await invoke("create_webshare", { request });
    } catch (error) {
      console.error("Failed to create webshare:", error);
    }
  };

  // 停止终端
  const stopTerminal = async (terminalId: string) => {
    try {
      await invoke("stop_terminal", {
        sessionId: props.sessionId,
        terminalId,
      });

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
    }
  };

  // 连接到终端
  const connectToTerminal = async (terminalId: string) => {
    try {
      setSelectedTerminalId(terminalId);

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
      terminal.onData((data) => {
        invoke("send_terminal_input_to_terminal", {
          request: {
            session_id: props.sessionId,
            terminal_id: terminalId,
            input: data,
          },
        }).catch((error) => {
          console.error("Failed to send terminal input:", error);
        });
      });

      // 告诉CLI端我们连接到了这个终端
      await invoke("connect_to_terminal", {
        sessionId: props.sessionId,
        terminalId,
      });
    } catch (error) {
      console.error("Failed to connect to terminal:", error);
    }
  };

  // 监听终端输出
  const setupTerminalEventListeners = async () => {
    await listen(`terminal-output-${props.sessionId}`, (event) => {
      const { terminalId, data } = event.payload;
      const sessions = terminalSessions();
      const session = sessions.get(terminalId);

      if (session && session.isActive) {
        session.terminal.write(data);
      }
    });

    await listen(`terminal-event-${props.sessionId}`, (event) => {
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

    // 初始加载数据
    await Promise.all([fetchTerminals(), fetchWebShares()]);

    setLoading(false);
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

  // 渲染终端列表
  const renderTerminalList = () => (
    <div class="space-y-2">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold">终端列表</h3>
        <button
          class="btn btn-primary btn-sm"
          onClick={openCreateDialog}
          title="创建新终端"
        >
          ➕ 新建终端
        </button>
      </div>

      <For each={terminals()}>
        {(terminal) => (
          <div
            class={`card bg-base-200 shadow-sm p-4 ${
              activeTerminalId() === terminal.id ? "ring-2 ring-primary" : ""
            }`}
          >
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="font-medium">
                  {terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}
                </div>
                <div class="text-sm opacity-70">
                  {terminal.shell_type} • {terminal.current_dir}
                </div>
                <div class="text-xs opacity-50 mt-1">
                  状态: {terminal.status} • 大小: {terminal.size[0]}x
                  {terminal.size[1]}
                </div>
              </div>
              <div class="flex space-x-2">
                {activeTerminalId() === terminal.id ? (
                  <div class="badge badge-primary">活动中</div>
                ) : (
                  <button
                    class="btn btn-primary btn-sm"
                    onClick={() => connectToTerminal(terminal.id)}
                    disabled={terminal.status !== "Running"}
                  >
                    连接
                  </button>
                )}
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={() => stopTerminal(terminal.id)}
                  title="停止终端"
                >
                  🛑
                </button>
              </div>
            </div>
          </div>
        )}
      </For>

      {terminals().length === 0 && (
        <div class="text-center py-8 opacity-50">
          <div class="text-4xl mb-2">💻</div>
          <div>暂无终端</div>
          <button
            class="btn btn-primary btn-sm mt-4"
            onClick={openCreateDialog}
          >
            创建第一个终端
          </button>
        </div>
      )}
    </div>
  );

  // 渲染WebShare列表
  const renderWebShareList = () => (
    <div class="space-y-2">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold">WebShare 服务</h3>
        <button
          class="btn btn-primary btn-sm"
          onClick={() => {
            // 这里可以打开创建WebShare的模态框
            createWebShare({
              local_port: 3000,
              service_name: "Local Development Server",
            });
          }}
          title="创建WebShare"
        >
          ➕ 新建服务
        </button>
      </div>

      <For each={webshares()}>
        {(webshare) => (
          <div class="card bg-base-200 shadow-sm p-4">
            <div class="flex justify-between items-start">
              <div class="flex-1">
                <div class="font-medium">{webshare.service_name}</div>
                <div class="text-sm opacity-70">
                  端口: {webshare.public_port} → {webshare.local_port}
                </div>
                <div class="text-xs opacity-50 mt-1">
                  状态: {webshare.status}
                </div>
              </div>
              <div class="flex space-x-2">
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `http://localhost:${webshare.public_port}`
                    );
                  }}
                  title="复制URL"
                >
                  📋
                </button>
              </div>
            </div>
          </div>
        )}
      </For>

      {webshares().length === 0 && (
        <div class="text-center py-8 opacity-50">
          <div class="text-4xl mb-2">🌐</div>
          <div>暂无WebShare服务</div>
        </div>
      )}
    </div>
  );

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
      <div class="navbar bg-base-100 border-b">
        <div class="flex-1">
          <button class="btn btn-ghost btn-sm" onClick={props.onBack}>
            ← 返回
          </button>
          <span class="ml-2 font-medium">远程会话</span>
        </div>
        <div class="flex-none">
          <button
            class="btn btn-ghost btn-sm"
            onClick={() => Promise.all([fetchTerminals(), fetchWebShares()])}
            title="刷新"
          >
            🔄
          </button>
          <button
            class="btn btn-ghost btn-sm ml-2"
            onClick={props.onDisconnect}
            title="断开连接"
          >
            🔌 断开
          </button>
        </div>
      </div>

      {/* 主内容 */}
      <div ref={containerRef} class="flex-1 flex overflow-hidden">
        {/* 侧边栏 - 终端和WebShare列表 */}
        <div class="w-80 bg-base-100 border-r overflow-y-auto p-4">
          {loading() ? (
            <div class="text-center py-8">
              <div class="loading loading-spinner"></div>
              <div class="mt-2">加载中...</div>
            </div>
          ) : (
            <div class="space-y-8">
              {renderTerminalList()}
              {renderWebShareList()}
            </div>
          )}
        </div>

        {/* 终端显示区域 */}
        {renderActiveTerminal()}

        {/* 无活动终端时的占位符 */}
        {!activeTerminalId() && (
          <div class="flex-1 flex items-center justify-center bg-base-200">
            <div class="text-center opacity-50">
              <div class="text-6xl mb-4">💻</div>
              <div class="text-xl">选择一个终端开始</div>
              <div class="text-sm mt-2">从左侧列表中选择或创建新终端</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
