import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getDeviceCapabilities } from "../stores/deviceStore";
import { useTerminalSessions } from "../stores/terminalSessionStore";
import { useTerminalSession } from "../hooks/useTerminalSession";
import { MobileKeyboard, InputFocusManager } from "../utils/mobile";
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
  terminalSession?: ReturnType<typeof useTerminalSession>;
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

  // 全局会话管理
  const terminalSessionManager = useTerminalSessions();

  // 创建终端弹窗相关状态
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [terminalName, setTerminalName] = createSignal("");
  const [dialogInputFocused, setDialogInputFocused] = createSignal(false);

  // 移动端下拉菜单状态
  const [showTerminalMenu, setShowTerminalMenu] = createSignal(false);
  const [showMainMenu, setShowMainMenu] = createSignal(false);

  // 桌面端终端标签栏下拉状态
  const [showDesktopTerminalDropdown, setShowDesktopTerminalDropdown] = createSignal(false);

  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;

  let containerRef: HTMLDivElement | undefined;
  let tabsContainerRef: HTMLDivElement | undefined;
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
      'esc': '\x1b',          // ESC
      'tab': '\t',            // Tab
      'enter': '\r',          // Enter/Return
      'up': '\x1b[A',         // Up arrow
      'down': '\x1b[B',       // Down arrow
      'left': '\x1b[D',       // Left arrow
      'right': '\x1b[C',      // Right arrow
      'ctrl-c': '\x03',       // Ctrl+C
      'ctrl-t': '\x14',       // Ctrl+T
      'ctrl-d': '\x04',       // Ctrl+D
      'ctrl-z': '\x1a',       // Ctrl+Z
      'ctrl-l': '\x0c',       // Ctrl+L (clear)
    };

    const data = keyMap[key];
    if (data) {
      // 发送到后端终端
      invoke("send_terminal_input_to_terminal", {
        request: {
          session_id: props.sessionId,
          terminal_id: activeId,
          input: data,
        },
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
      const terminalId = await invoke<string>("create_terminal", { request });

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
        terminalSessionManager.setActiveTerminal(terminalId);
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
        scrollback: 1000,
        convertEol: true,
        allowProposedApi: true,
        rows: 24,  // 默认行数
        cols: 80,  // 默认列数
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

      // 获取或创建会话记录
      let session = terminalSessionManager.getSession(terminalId);
      if (!session) {
        // 从终端信息创建会话记录
        const terminalInfo = terminals().find(t => t.id === terminalId);
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
      const terminalSessionHook = useTerminalSession(terminal, () => terminalId, {
        saveInterval: 3000,
        maxContentLength: 5000,
      });

      // 设置终端数据处理器
      terminal.onData((data) => {
        // 保存命令到会话
        if (data.trim()) {
          terminalSessionHook.saveCommand(data.trim());
        }

        // 发送到远程终端
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

      // 更新会话引用
      terminalSession.terminalSession = terminalSessionHook;

      // 告诉CLI端我们连接到了这个终端
      await invoke("connect_to_terminal", {
        sessionId: props.sessionId,
        terminalId,
      });

      // 更新连接状态
      terminalSessionManager.updateConnectionState(terminalId, 'connected');

    } catch (error) {
      console.error("Failed to connect to terminal:", error);
      // 更新连接状态为失败
      terminalSessionManager.updateConnectionState(terminalId, 'disconnected');
    }
  };

  // 监听终端输出
  const setupTerminalEventListeners = async () => {
    // 监听响应消息
    await listen(`session-response-${props.sessionId}`, (event: any) => {
      console.log("Received response message:", event.payload);
      
      const response = event.payload;
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
              console.log("Auto-connecting to newly created terminal:", data.terminal_id);
              connectToTerminal(data.terminal_id);
            }, 500); // 等待终端列表更新
          }
        } catch (error) {
          console.error("Failed to parse response data:", error, response.data);
        }
      }
    });
    
    // 监听终端管理消息
    await listen(`terminal-management-${props.sessionId}`, (event: any) => {
      console.log("Received terminal management message:", event.payload);
      // 终端创建、停止等操作后，重新获取列表
      fetchTerminals();
    });
    
    await listen(`terminal-output-${props.sessionId}`, (event: any) => {
      const payload = event.payload;
      const terminalId = payload.terminal_id || payload.terminalId;
      const data = payload.data;
      
      console.log("📤 Received terminal output:", { terminalId, dataLength: data?.length });
      
      const sessions = terminalSessions();
      const session = sessions.get(terminalId);

      if (session) {
        console.log("✅ Writing to terminal:", terminalId);
        session.terminal.write(data);

        // 触发会话保存（通过解析输出更新工作目录等）
        if (session.terminalSession) {
          session.terminalSession.updateWorkingDirectory(data);
        }
      } else {
        console.warn("⚠️ Terminal session not found for output:", terminalId);
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
    });
  };

  // 组件挂载时初始化
  onMount(async () => {
    await setupTerminalEventListeners();

    // 初始加载数据
    await fetchTerminals();

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
                cols: session.terminal.cols
              });
            }
          } catch (error) {
            console.error("Error fitting terminal on resize:", error);
          }
        });
      }, 150); // 150ms debounce
    };

    window.addEventListener('resize', handleResize);

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
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
              if (containerRef.clientWidth > 0 && containerRef.clientHeight > 0) {
                session.fitAddon.fit();
                console.log("Terminal refitted:", {
                  rows: session.terminal.rows,
                  cols: session.terminal.cols
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
    const availableTerminalIds = availableTerminals.map(t => t.id);

    // 如果没有活动终端但有可用终端，自动连接到第一个
    if (!hasActiveTerminal && availableTerminalIds.length > 0) {
      const firstTerminalId = availableTerminalIds[0];
      console.log("Auto-connecting to first terminal:", firstTerminalId);
      connectToTerminal(firstTerminalId);
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


  // 渲染快捷键按钮栏
  const renderShortcutBar = () => {
    if (!activeTerminalId()) return null;

    const shortcuts = [
      { key: 'esc', label: 'Esc', color: 'bg-base-200' },
      { key: 'tab', label: 'Tab', color: 'bg-base-200' },
      { key: 'up', label: '↑', color: 'bg-base-200' },
      { key: 'down', label: '↓', color: 'bg-base-200' },
      { key: 'enter', label: '↵', color: 'bg-primary text-primary-content' },
      { key: 'ctrl-c', label: '^C', color: 'bg-error/80 text-error-content' },
    ];

    return (
      <div class="border-t bg-base-100 px-2 py-2 flex-shrink-0" style={{ "padding-bottom": "env(safe-area-inset-bottom, 0.5rem)" }}>
        <div class="flex items-center justify-between gap-1 max-w-full overflow-x-auto scrollbar-hide">
          <For each={shortcuts}>
            {(shortcut) => (
              <button
                class={`btn btn-sm ${shortcut.color} hover:brightness-90 border-base-300 flex-1 min-w-0 px-2 transition-transform active:scale-95`}
                onClick={() => sendShortcut(shortcut.key)}
                onTouchStart={(e) => {
                  e.currentTarget.classList.add('scale-95');
                }}
                onTouchEnd={(e) => {
                  e.currentTarget.classList.remove('scale-95');
                }}
              >
                <span class="text-xs sm:text-sm truncate font-mono">{shortcut.label}</span>
              </button>
            )}
          </For>
        </div>
      </div>
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
      <div class="w-full h-full bg-black flex flex-col">
        {/* 终端显示区域 - 固定高度避免 xterm-scroll-area 溢出 */}
        <div
          ref={(el) => {
            terminalContainerRef = el;
            if (el && el.children.length === 0) {
              try {
                console.log("Opening terminal in container:", el);

                // 打开终端
                session.terminal.open(el);

                // 立即设置容器样式防止滚动问题
                el.style.height = '100%';
                el.style.overflow = 'hidden';

                // 等待 DOM 更新后再 fit
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    try {
                      console.log("Fitting terminal, container size:", {
                        width: el.clientWidth,
                        height: el.clientHeight
                      });
                      session.fitAddon.fit();

                      // 获取终端实际的行列数
                      console.log("Terminal fitted to:", {
                        rows: session.terminal.rows,
                        cols: session.terminal.cols
                      });

                      // 强制设置 xterm-screen 的高度
                      const xtermElement = el.querySelector('.xterm');
                      if (xtermElement) {
                        (xtermElement as HTMLElement).style.height = '100%';
                      }

                      // 限制 xterm-viewport 的高度
                      const viewportElement = el.querySelector('.xterm-viewport');
                      if (viewportElement) {
                        (viewportElement as HTMLElement).style.height = '100%';
                      }
                    } catch (error) {
                      console.error("Error fitting terminal:", error);
                    }
                  });
                });
              } catch (error) {
                console.error("Error opening terminal:", error);
              }
            }
          }}
          class="flex-1 w-full overflow-hidden"
          style={{
            height: '100%',
            'min-height': '0'
          }}
        />
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
        <div
          class="modal modal-open"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreateDialog(false);
            }
          }}
        >
          <div 
            class="modal-box transition-all duration-300 max-w-md"
            classList={{
              "translate-y-0": !dialogInputFocused() || !isMobile,
              "-translate-y-32": dialogInputFocused() && isMobile
            }}
            style={{
              "margin-bottom": dialogInputFocused() && isMobile ? `${MobileKeyboard.getKeyboardHeight()}px` : "0"
            }}
          >
            <h3
              class="font-bold transition-all duration-300"
              classList={{
                "text-lg mb-4": !dialogInputFocused() || !isMobile,
                "text-base mb-2": dialogInputFocused() && isMobile
              }}
            >
              创建新终端
            </h3>
            <div class="form-control">
              <label class="label">
                <span class="label-text">终端名称（可选）</span>
              </label>
              <input
                type="text"
                placeholder="例如：开发环境、生产服务器"
                class="input input-bordered text-base"
                value={terminalName()}
                onInput={(e) => setTerminalName(e.currentTarget.value)}
                onFocus={() => {
                  setDialogInputFocused(true);
                  // 延迟调整以等待键盘弹出
                  setTimeout(() => {
                    MobileKeyboard.forceScrollAdjustment();
                  }, 300);
                }}
                onBlur={() => {
                  setTimeout(() => setDialogInputFocused(false), 100);
                }}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    confirmCreateTerminal();
                  }
                }}
              />
            </div>
            <Show when={!dialogInputFocused() || !isMobile}>
              <div class="mt-4 text-sm text-base-content/70">
                <p>终端大小将自动适配当前页面宽度</p>
                <p class="mt-1">
                  预计大小: {calculateTerminalSize().cols} 列 ×{" "}
                  {calculateTerminalSize().rows} 行
                </p>
              </div>
            </Show>
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
            {/* 移动端：创建按钮 */}
            <Show when={isMobile}>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => openCreateDialog()}
                title="新建终端"
              >
                ➕
              </button>
            </Show>

            {/* 桌面端按钮 */}
            <Show when={!isMobile}>
              <button
                class="btn btn-ghost btn-sm"
                onClick={() => fetchTerminals()}
                title="刷新"
              >
                🔄
              </button>
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

            {/* 移动端：菜单按钮 */}
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
          </div>
        </div>

        {/* 移动端终端标签栏 - 水平滚动 */}
        <Show when={isMobile && terminals().length > 0}>
          <div class="border-t bg-base-100 overflow-x-auto scrollbar-hide">
            <div class="flex px-2 py-1 min-w-max">
              <For each={terminals()}>
                {(terminal) => {
                  const isActive = activeTerminalId() === terminal.id;
                  return (
                    <button
                      class={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap mr-2 ${isActive
                        ? "bg-primary text-primary-content shadow-md"
                        : "bg-base-200 hover:bg-base-300 text-base-content"
                        }`}
                      onClick={() => {
                        setActiveTerminalId(terminal.id);
                        terminalSessionManager.setActiveTerminal(terminal.id);
                      }}
                    >
                      <span
                        class={`w-2 h-2 rounded-full ${terminal.status === "Running"
                          ? "bg-green-400"
                          : terminal.status === "Starting"
                            ? "bg-yellow-400"
                            : "bg-gray-400"
                          }`}
                      />
                      <span class="truncate max-w-[120px]">
                        {terminal.name || `Term ${terminal.id.slice(0, 6)}`}
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* 桌面端终端标签页 */}
        <Show when={!isMobile}>
          <div class="border-t bg-base-200 relative">
            <div class="flex items-center">
              {/* 标签容器 - 隐藏滚动条 */}
              <div
                ref={tabsContainerRef}
                class="flex-1 overflow-x-auto scrollbar-hide"
              >
                <Show
                  when={terminals().length > 0}
                  fallback={
                    <div class="text-sm text-gray-500 px-3 py-2">
                      暂无终端，点击"新建"创建第一个终端
                    </div>
                  }
                >
                  <div class="flex space-x-1 px-2 py-1">
                    <For each={terminals()}>
                      {(terminal, index) => {
                        const isActive = activeTerminalId() === terminal.id;
                        const tabIndex = index() + 1;
                        const session = terminalSessionManager.getSession(terminal.id);
                        const hasSessionData = session && (session.terminalContent || session.commandHistory?.length);

                        return (
                          <button
                            class={`flex items-center space-x-2 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors whitespace-nowrap group ${isActive
                              ? "bg-base-100 border border-b-0 border-gray-300 text-base-content shadow-sm"
                              : "bg-base-300/50 hover:bg-base-300 text-base-content/70"
                              }`}
                            onClick={() => {
                              setActiveTerminalId(terminal.id);
                              terminalSessionManager.setActiveTerminal(terminal.id);
                            }}
                            title={`终端 ${tabIndex} - ${terminal.name || `Terminal ${terminal.id.slice(0, 8)}`} (${isActive ? "Ctrl+" + tabIndex + " 切换" : "Ctrl+" + tabIndex + " 打开"})${hasSessionData ? " - 有保存的会话数据" : ""}`}
                          >
                            <span class="flex items-center space-x-1">
                              <span
                                class={`w-2 h-2 rounded-full ${terminal.status === "Running" ? "bg-green-500" :
                                  terminal.status === "Starting" ? "bg-yellow-500" :
                                    terminal.status === "Stopped" ? "bg-gray-500" :
                                      "bg-red-500"
                                  }`}
                              />
                              <span class="flex items-center space-x-1">
                                <Show when={tabIndex <= 9}>
                                  <span class={`text-xs ${isActive ? "text-gray-600" : "text-gray-500"} font-mono`}>
                                    {tabIndex}
                                  </span>
                                </Show>
                                <span>{terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}</span>
                                {hasSessionData && (
                                  <span class="text-xs text-blue-500" title="有保存的会话数据">
                                    💾
                                  </span>
                                )}
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

              {/* 下拉菜单按钮 - 仅在终端超过一定数量时显示 */}
              <Show when={terminals().length > 5}>
                <div class="relative border-l border-base-300">
                  <button
                    class="btn btn-ghost btn-sm h-full rounded-none px-3"
                    onClick={() => setShowDesktopTerminalDropdown(!showDesktopTerminalDropdown())}
                    title="显示所有终端"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* 下拉列表 */}
                  <Show when={showDesktopTerminalDropdown()}>
                    <div
                      class="absolute right-0 top-full mt-1 w-64 max-h-96 overflow-y-auto bg-base-100 border border-base-300 rounded-lg shadow-xl z-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div class="p-2">
                        <For each={terminals()}>
                          {(terminal, index) => {
                            const isActive = activeTerminalId() === terminal.id;
                            const tabIndex = index() + 1;

                            return (
                              <button
                                class={`w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-sm transition-colors ${isActive
                                  ? "bg-primary text-primary-content"
                                  : "hover:bg-base-200"
                                  }`}
                                onClick={() => {
                                  setActiveTerminalId(terminal.id);
                                  terminalSessionManager.setActiveTerminal(terminal.id);
                                  setShowDesktopTerminalDropdown(false);
                                }}
                              >
                                <span
                                  class={`w-2 h-2 rounded-full flex-shrink-0 ${terminal.status === "Running" ? "bg-green-500" :
                                    terminal.status === "Starting" ? "bg-yellow-500" :
                                      terminal.status === "Stopped" ? "bg-gray-500" :
                                        "bg-red-500"
                                    }`}
                                />
                                <span class="text-xs font-mono flex-shrink-0">{tabIndex}</span>
                                <span class="truncate flex-1 text-left">
                                  {terminal.name || `Terminal ${terminal.id.slice(0, 8)}`}
                                </span>
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* 点击外部关闭桌面端下拉菜单 */}
      <Show when={showDesktopTerminalDropdown()}>
        <div
          class="fixed inset-0 z-40"
          onClick={() => setShowDesktopTerminalDropdown(false)}
        />
      </Show>

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
      <div ref={containerRef} class="flex-1 flex overflow-hidden flex-col min-h-0">
        {/* 终端显示区域 */}
        <div class="flex-1 flex overflow-hidden min-h-0">
          {/* 桌面端和移动端终端显示 */}
          {renderActiveTerminal()}

          {/* 无活动终端时的占位符 */}
          {!activeTerminalId() && (
            <div class="flex-1 flex items-center justify-center bg-base-200">
              <div class="text-center opacity-50 px-4">
                <div class="text-6xl mb-4">💻</div>
                <div class="text-xl">选择一个终端开始</div>
                <div class="text-sm mt-2">
                  {isMobile
                    ? "点击右上角菜单选择或创建终端"
                    : terminals().length > 0
                      ? "点击顶部标签页选择终端"
                      : "点击顶部新建按钮创建第一个终端"}
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

        {/* 底部快捷键栏 - 移动端显示 */}
        <Show when={isMobile}>
          {renderShortcutBar()}
        </Show>
      </div>

    </div>
  );
}
