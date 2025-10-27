import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getDeviceCapabilities } from "../utils/mobile";
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
  isActive: boolean;
}

export function RemoteSessionView(props: RemoteSessionViewProps) {
  const [terminals, setTerminals] = createSignal<TerminalInfo[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [terminalSessions, setTerminalSessions] = createSignal<
    Map<string, TerminalSession>
  >(new Map());
  const [activeTerminalId, setActiveTerminalId] = createSignal<string | null>(
    null
  );

  // 创建终端弹窗相关状态
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [terminalName, setTerminalName] = createSignal("");

  // 移动端下拉菜单状态
  const [showTerminalMenu, setShowTerminalMenu] = createSignal(false);
  const [showMainMenu, setShowMainMenu] = createSignal(false);

  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;

  let containerRef: HTMLDivElement | undefined;

  // 获取终端列表
  const fetchTerminals = async () => {
    try {
      await invoke("get_terminal_list", { sessionId: props.sessionId });
    } catch (error) {
      console.error("Failed to fetch terminal list:", error);
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
          const rawData = event.payload.data;
          const match = rawData.match(/\[Terminal Output: ([^]]+)\] (.*)/s);

          if (match && match[1] && match[2]) {
            const terminalId = match[1];
            const outputData = match[2];

            const sessions = terminalSessions();
            const session = sessions.get(terminalId);

            if (session && session.isActive) {
              session.terminal.write(outputData);
            }
          }
        } catch (error) {
          console.error("Failed to parse legacy terminal output event:", error);
        }
      }
    });
  };

  // 组件挂载时初始化
  onMount(async () => {
    await setupTerminalEventListeners();

    // 初始加载数据
    await fetchTerminals();

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

  // 自动选择第一个可用终端
  createEffect(() => {
    const availableTerminals = terminals();
    const hasActiveTerminal = activeTerminalId();
    const availableTerminalIds = availableTerminals.map(t => t.id);

    // 如果没有活动终端但有可用终端，自动选择第一个
    if (!hasActiveTerminal && availableTerminalIds.length > 0) {
      const firstTerminalId = availableTerminalIds[0];
      setActiveTerminalId(firstTerminalId);
    }

    // 如果当前活动终端不在可用列表中，清空选择
    if (hasActiveTerminal && !availableTerminalIds.includes(hasActiveTerminal)) {
      setActiveTerminalId(null);
    }
  });

  // 渲染终端列表
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
            <div class="flex justify-between items-start">
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate">
                  {terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}
                </div>
                <div class="text-xs opacity-70 truncate">
                  {terminal.shell_type} • {terminal.current_dir}
                </div>
                <div class="text-xs opacity-50 mt-1">
                  {terminal.status} • {terminal.size[0]}x{terminal.size[1]}
                </div>
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
          </div>
        )}
      </For>

      {terminals().length === 0 && (
        <div class="text-center py-8 opacity-50">
          <div class="text-4xl mb-2">💻</div>
          <div>暂无终端</div>
          <button
            class="btn btn-primary btn-sm mt-4"
            onClick={() => {
              openCreateDialog();
              if (inDropdown) setShowTerminalMenu(false);
            }}
          >
            创建第一个终端
          </button>
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
      <div class="flex-1 bg-black relative">
        {/* 桌面端：直接显示终端，不重复标题栏 */}
        <Show when={!isMobile}>
          <div
            ref={(el) => {
              if (el && el.children.length === 0) {
                session.terminal.open(el);
                session.fitAddon.fit();
              }
            }}
            class="w-full h-full"
          />
        </Show>

        {/* 移动端：保持原有的标题栏设计 */}
        <Show when={isMobile}>
          <div class="bg-base-100 px-4 py-2 flex justify-between items-center">
            <div class="text-sm font-medium truncate">
              {terminals().find((t) => t.id === terminalId)?.name ||
                `Terminal ${terminalId.slice(0, 8)}`}
            </div>
            <button
              class="btn btn-ghost btn-xs"
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
            class="flex-1"
            style={{ height: "calc(100% - 48px)" }}
          />
        </Show>
      </div>
    );
  };

  // 键盘快捷键支持
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const digit = parseInt(e.key);
      if (digit >= 1 && digit <= 9) {
        const availableTerminals = terminals();
        if (digit <= availableTerminals.length) {
          e.preventDefault();
          setActiveTerminalId(availableTerminals[digit - 1].id);
        }
      }
    }
  };

  return (
    <div class="h-full flex flex-col" onKeyDown={handleKeyboardShortcuts} tabIndex={0}>
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
      <div class="bg-base-100 border-b">
        {/* 导航栏 */}
        <div class="navbar min-h-[48px] px-2 sm:px-4">
          <div class="flex-1">
            <button class="btn btn-ghost btn-sm" onClick={props.onBack}>
              ← 返回
            </button>
            <span class="ml-2 font-medium hidden sm:inline">远程会话</span>
          </div>
          <div class="flex-none flex items-center space-x-1">
            <button
              class="btn btn-ghost btn-sm"
              onClick={() => fetchTerminals()}
              title="刷新"
            >
              🔄
            </button>

            {/* 移动端下拉菜单 */}
            <Show when={isMobile}>
              <div class="dropdown dropdown-end">
                <button
                  class="btn btn-ghost btn-sm"
                  onClick={() => setShowMainMenu(!showMainMenu())}
                >
                  ☰
                </button>
                <Show when={showMainMenu()}>
                  <ul class="dropdown-content menu p-2 shadow-lg bg-base-100 rounded-box w-72 max-h-[80vh] overflow-y-auto z-50 mt-2">
                    <li class="menu-title">
                      <span>终端管理</span>
                    </li>
                    <li>
                      <button
                        onClick={() => {
                          setShowTerminalMenu(true);
                          setShowMainMenu(false);
                        }}
                      >
                        💻 终端列表 ({terminals().length})
                      </button>
                    </li>
                    <li class="menu-title">
                      <span>操作</span>
                    </li>
                    <li>
                      <button
                        onClick={() => {
                          openCreateDialog();
                          setShowMainMenu(false);
                        }}
                      >
                        ➕ 新建终端
                      </button>
                    </li>
                    <li>
                      <button
                        onClick={() => {
                          props.onDisconnect();
                          setShowMainMenu(false);
                        }}
                      >
                        🔌 断开连接
                      </button>
                    </li>
                  </ul>
                </Show>
              </div>
            </Show>

            {/* 桌面端按钮 */}
            <Show when={!isMobile}>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => openCreateDialog()}
                title="新建终端"
              >
                ➕ 新建
              </button>
              <button
                class="btn btn-ghost btn-sm"
                onClick={props.onDisconnect}
                title="断开连接"
              >
                🔌 断开
              </button>
            </Show>
          </div>
        </div>

        {/* 桌面端终端标签页 */}
        <Show when={!isMobile}>
          <div class="border-t bg-base-200">
            <div class="flex items-center px-2 py-1 overflow-x-auto">
              <Show
                when={terminals().length > 0}
                fallback={
                  <div class="text-sm text-gray-500 px-3 py-2">
                    暂无终端，点击"新建"创建第一个终端
                  </div>
                }
              >
                <div class="flex space-x-1">
                  <For each={terminals()}>
                    {(terminal, index) => {
                      const isActive = activeTerminalId() === terminal.id;
                      const tabIndex = index() + 1;
                      return (
                        <button
                          class={`flex items-center space-x-2 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors whitespace-nowrap group ${
                            isActive
                              ? "bg-base-100 border border-b-0 border-gray-300 text-base-content shadow-sm"
                              : "bg-base-300/50 hover:bg-base-300 text-base-content/70"
                          }`}
                          onClick={() => setActiveTerminalId(terminal.id)}
                          title={`终端 ${tabIndex} - ${terminal.name || `Terminal ${terminal.id.slice(0, 8)}`} (${isActive ? "Ctrl+" + tabIndex + " 切换" : "Ctrl+" + tabIndex + " 打开"})`}
                        >
                          <span class="flex items-center space-x-1">
                            <span
                              class={`w-2 h-2 rounded-full ${
                                terminal.status === "Running" ? "bg-green-500" :
                                terminal.status === "Starting" ? "bg-yellow-500" :
                                terminal.status === "Stopped" ? "bg-gray-500" :
                                "bg-red-500"
                              }`}
                            />
                            <span class="flex items-center space-x-1">
                              <Show when={!isMobile && tabIndex <= 9}>
                                <span class={`text-xs ${isActive ? "text-gray-600" : "text-gray-500"} font-mono`}>
                                  {tabIndex}
                                </span>
                              </Show>
                              <span>{terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}</span>
                            </span>
                          </span>
                          <Show when={isActive}>
                            <button
                              class="ml-1 text-gray-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                // TODO: 实现关闭终端功能
                              }}
                              title="关闭终端"
                            >
                              ✕
                            </button>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* 移动端终端列表下拉菜单 */}
      <Show when={showTerminalMenu()}>
        <div
          class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowTerminalMenu(false)}
        >
          <div
            class="absolute top-0 right-0 w-full sm:w-96 h-full bg-base-100 shadow-xl overflow-y-auto animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="sticky top-0 bg-base-100 border-b p-4 flex justify-between items-center z-10">
              <h2 class="text-lg font-semibold">终端列表</h2>
              <button
                class="btn btn-ghost btn-sm btn-circle"
                onClick={() => setShowTerminalMenu(false)}
              >
                ✕
              </button>
            </div>
            <div class="p-4">
              {loading() ? (
                <div class="text-center py-8">
                  <div class="loading loading-spinner"></div>
                  <div class="mt-2">加载中...</div>
                </div>
              ) : (
                renderTerminalList(true)
              )}
            </div>
          </div>
        </div>
      </Show>


      {/* 主内容 */}
      <div ref={containerRef} class="flex-1 flex overflow-hidden flex-col">
        {/* 终端显示区域 - 桌面端全宽，移动端保持原样 */}
        <div class="flex-1 relative">
          {/* 桌面端终端显示 */}
          <Show when={!isMobile}>
            {renderActiveTerminal()}
          </Show>

          {/* 移动端终端显示 */}
          <Show when={isMobile}>
            {renderActiveTerminal()}
          </Show>

          {/* 无活动终端时的占位符 */}
          {!activeTerminalId() && (
            <div class="absolute inset-0 flex items-center justify-center bg-base-200">
              <div class="text-center opacity-50 px-4">
                <div class="text-6xl mb-4">💻</div>
                <div class="text-xl">选择一个终端开始</div>
                <div class="text-sm mt-2">
                  {isMobile
                    ? "点击右上角菜单选择或创建终端"
                    : terminals().length > 0
                    ? "点击顶部标签页选择终端"
                    : "点击顶部"新建"按钮创建第一个终端"}
                </div>
                <Show when={isMobile}>
                  <button
                    class="btn btn-primary btn-sm mt-4"
                    onClick={() => setShowMainMenu(true)}
                  >
                    打开菜单
                  </button>
                </Show>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
