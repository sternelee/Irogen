import { createSignal, Show, For, onCleanup } from "solid-js";
import { useChat, fetchServerSentEvents } from "@tanstack/ai-solid";
import { invoke } from "@tauri-apps/api/core";

// Types for AI messages and commands

interface AICommand {
  id: string;
  command: string;
  description: string;
  explanation: string;
}

interface AIResponse {
  commands: AICommand[];
  explanation: string;
}

interface SystemInfo {
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
}

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

interface AIHelperProps {
  sessionId: string;
  terminals: () => TerminalInfo[];
  activeTerminalId: () => string | null;
  systemInfo: () => SystemInfo | null;
  onExecuteCommand: (command: string) => Promise<void>;
  onCreateTerminal: (config?: { name?: string; rows?: number; cols?: number }) => Promise<string>;
}

// Client tools for AI operations
const executeTerminalCommand = {
  description: 'Execute a terminal command in the specified terminal session',
  parameters: {
    command: { type: 'string', description: 'The command to execute' },
    sessionId: { type: 'string', description: 'The session ID' },
    terminalId: { type: 'string', description: 'The terminal ID' },
  },
  execute: async ({ command, sessionId, terminalId }: { command: string; sessionId: string; terminalId: string }) => {
    try {
      await invoke("send_terminal_input_to_terminal", {
        sessionId,
        terminalId,
        input: command + "\n",
      });
      return {
        success: true,
        message: `命令已执行: ${command}`,
        output: `已发送命令到终端: ${command}`
      };
    } catch (error) {
      return {
        success: false,
        message: `命令执行失败: ${error}`,
        error: String(error)
      };
    }
  }
};

const getSystemInfo = {
  description: 'Get system information including OS, shell, and available tools',
  parameters: {},
  execute: async () => {
    try {
      const info = await invoke("get_system_info");
      return {
        success: true,
        systemInfo: info,
        message: "系统信息获取成功"
      };
    } catch (error) {
      return {
        success: false,
        message: `获取系统信息失败: ${error}`,
        error: String(error)
      };
    }
  }
};

const createNewTerminal = {
  description: 'Create a new terminal session',
  parameters: {
    sessionId: { type: 'string', description: 'The session ID' },
    name: { type: 'string', description: 'Terminal name (optional)' },
    rows: { type: 'number', description: 'Number of rows (optional)' },
    cols: { type: 'number', description: 'Number of columns (optional)' },
  },
  execute: async ({ sessionId, name, rows, cols }: { sessionId: string; name?: string; rows?: number; cols?: number }) => {
    try {
      const terminalId = await invoke("create_terminal", {
        sessionId,
        name,
        size: rows && cols ? [rows, cols] : undefined,
      });
      return {
        success: true,
        terminalId,
        message: `新终端已创建: ${name || terminalId}`
      };
    } catch (error) {
      return {
        success: false,
        message: `创建终端失败: ${error}`,
        error: String(error)
      };
    }
  }
};


export function AIHelper(props: AIHelperProps) {
  // State management
  const [showChatHistory, setShowChatHistory] = createSignal(false);
  const [aiResponse, setAiResponse] = createSignal<AIResponse | null>(null);
  const [showFloatingResult, setShowFloatingResult] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  // Build AI context prompt
  const buildAiContextPrompt = () => {
    const sysInfo = props.systemInfo();
    const activeId = props.activeTerminalId();
    const terminalInfo = props.terminals().find(t => t.id === activeId);

    return `你是 RiTerm 的智能终端助手，可以帮助用户执行各种终端操作。

当前环境信息：
- 操作系统: ${sysInfo?.os_info.name || "未知"} ${sysInfo?.os_info.version || ""}
- Shell: ${terminalInfo?.shell_type || sysInfo?.shell_info.shell_type || "bash"}
- 当前目录: ${terminalInfo?.current_dir || "未知"}
- 活动终端ID: ${activeId}

请根据用户需求：
1. 理解用户的自然语言请求
2. 生成合适的终端命令
3. 提供清晰的解释和说明

注意事项：
- 优先使用系统已有的工具
- 提供安全的命令建议
- 解释命令的作用和参数`;
  };

  // Use @tanstack/ai-solid chat hook with basic configuration
  const { messages, sendMessage, isLoading, error, clear } = useChat({
    connection: fetchServerSentEvents('/api/ai/chat', {
      headers: {
        'Content-Type': 'application/json',
      },
    }),
    onFinish: (message: any) => {
      // Process the response and extract commands
      if (message && message.role === 'assistant') {
        const content = message.content || '';
        const extractedCommands = extractCommandsFromResponse(content);

        if (extractedCommands.length > 0) {
          setAiResponse({
            commands: extractedCommands,
            explanation: content
          });

          // Show floating result
          setShowFloatingResult(true);
          setTimeout(() => setShowFloatingResult(false), 5000);
        }
      }
    },
    body: {
      sessionId: props.sessionId,
      systemContext: buildAiContextPrompt(),
    },
  });

  // Extract commands from AI response
  const extractCommandsFromResponse = (content: string): AICommand[] => {
    // Simple command extraction - look for code blocks or command-like patterns
    const commandRegex = /```(?:bash|shell)?\n([\s\S]*?)\n```|`([^`]+)`/g;
    const commands: AICommand[] = [];
    let match;

    while ((match = commandRegex.exec(content)) !== null) {
      const command = match[1] || match[2];
      if (command.trim()) {
        commands.push({
          id: `cmd-${commands.length}`,
          command: command.trim(),
          description: `执行命令: ${command.trim()}`,
          explanation: `AI 建议执行此命令来完成任务`
        });
      }
    }

    // If no commands found, try to generate from context
    if (commands.length === 0) {
      const fallbackResponse = generateFallbackResponse(content);
      return fallbackResponse.commands;
    }

    return commands;
  };

  // Generate fallback response when no commands are extracted
  const generateFallbackResponse = (content: string): AIResponse => {
    const lowerContent = content.toLowerCase();
    const sysInfo = props.systemInfo();

    const getSystemSpecificInfo = () => {
      if (!sysInfo) {
        return {
          osName: "Unix-like 系统",
          defaultShell: "bash/zsh",
          packageManager: "系统包管理器",
        };
      }

      const { os_info, shell_info, available_tools } = sysInfo;
      return {
        osName: os_info.name,
        defaultShell: shell_info.shell_type,
        packageManager: available_tools.package_managers[0] || "系统包管理器",
      };
    };

    const localSystemInfo = getSystemSpecificInfo();

    if (lowerContent.includes("list") || lowerContent.includes("文件") || lowerContent.includes("目录")) {
      const lsOptions = localSystemInfo.osName.toLowerCase().includes("macos") ? "-laG" : "-la";
      return {
        explanation: `我来帮您列出当前目录的文件和文件夹。`,
        commands: [
          {
            id: "list-files",
            command: `ls ${lsOptions}`,
            description: "列出详细文件信息",
            explanation: `显示当前目录下所有文件和文件夹的详细信息。`,
          },
        ],
      };
    } else if (lowerContent.includes("git") && (lowerContent.includes("状态") || lowerContent.includes("status"))) {
      return {
        explanation: `检查Git仓库的状态，显示修改的文件。`,
        commands: [
          {
            id: "git-status",
            command: "git status",
            description: "查看Git仓库状态",
            explanation: "显示工作目录和暂存区的状态。",
          },
        ],
      };
    }

    return {
      explanation: `我理解您的需求。这是 ${localSystemInfo.osName} 系统，我可以帮您处理各种终端操作。`,
      commands: [
        {
          id: "help-command",
          command: `echo 'RiTerm AI助手 - ${localSystemInfo.osName} 终端助手'`,
          description: "显示帮助信息",
          explanation: "这是一个帮助命令。我可以帮助您处理各种终端操作。",
        },
      ],
    };
  };

  // Handle chat submission
  const [input, setInput] = createSignal("");

  const handleChatSubmit = async () => {
    const message = input().trim();
    if (!message || !props.activeTerminalId()) {
      return;
    }

    try {
      await sendMessage(message);
      setInput("");
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  };

  // Execute AI generated command
  const executeAiCommand = async (command: string) => {
    try {
      await props.onExecuteCommand(command);
      console.log(`Command executed: ${command}`);
      setAiResponse(null);
    } catch (error) {
      console.error("Failed to execute command:", error);
    }
  };

  // Clear chat history
  const clearChatHistory = () => {
    clear();
    setAiResponse(null);
  };

  // Handle keyboard shortcuts
  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  };

  // Auto-resize textarea based on content
  const handleTextareaInput = (e: Event) => {
    const textarea = e.target as HTMLTextAreaElement;
    textarea.style.height = 'auto'; // Reset height to auto
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, 40), 128); // Min 2.5rem, Max 8rem
    textarea.style.height = `${newHeight}px`;
  };

  // Cleanup event listener on component unmount
  onCleanup(() => {
    if (textareaRef) {
      textareaRef.removeEventListener('input', handleTextareaInput);
    }
  });

  return (
    <div class="ai-helper relative">
      {/* Floating Result Modal - 显示在输入框上方 */}
      <Show when={showFloatingResult() && aiResponse()}>
        <div class="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md w-full">
          <div class="bg-base-100 border border-primary rounded-lg shadow-xl overflow-hidden animate-pulse">
            <div class="bg-primary text-primary-content p-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span class="font-medium">AI 生成命令</span>
                </div>
                <button
                  onClick={() => setShowFloatingResult(false)}
                  class="btn btn-ghost btn-xs btn-circle text-primary-content hover:bg-primary/80"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="p-3 max-h-48 overflow-y-auto">
              <div class="text-sm text-base-content mb-2">
                {aiResponse()!.explanation}
              </div>
              <div class="space-y-2">
                <For each={aiResponse()!.commands}>
                  {(command, index) => (
                    <div class="bg-base-200 rounded p-2">
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-1 mb-1">
                            <div class="badge badge-primary badge-xs text-xs">
                              {index() + 1}
                            </div>
                            <span class="text-xs font-medium">{command.description}</span>
                          </div>
                          <code class="text-xs font-mono text-base-content/80 break-all">
                            {command.command}
                          </code>
                        </div>
                        <div class="flex gap-1">
                          <button
                            class="btn btn-primary btn-xs"
                            onClick={() => executeAiCommand(command.command)}
                            title="执行此命令"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                          <button
                            class="btn btn-ghost btn-xs"
                            onClick={() => navigator.clipboard.writeText(command.command)}
                            title="复制命令"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
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
        </div>
      </Show>

      {/* Chat History - Collapsible */}
      <Show when={showChatHistory() && messages().length > 0}>
        <div class="max-h-48 overflow-y-auto p-3 bg-base-100 border-b border-base-300 rounded-lg mb-2">
          <div class="space-y-2">
            <For each={messages()}>
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
                    <div class="text-sm">
                      <For each={message.parts || []}>
                        {(part) => {
                          if (part.type === "text") {
                            return <span>{part.content}</span>;
                          }
                          if (part.type === "thinking") {
                            return (
                              <div class="text-sm opacity-70 italic mt-1">
                                💭 Thinking: {part.content}
                              </div>
                            );
                          }
                          if (part.type === "tool-call") {
                            return (
                              <div class="text-xs opacity-70 mt-1 font-mono bg-black/20 px-2 py-1 rounded">
                                🛠️ 工具调用: {part.name}
                              </div>
                            );
                          }
                          return null;
                        }}
                      </For>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* AI Commands List - 非浮窗模式 */}
      <Show when={!showFloatingResult() && aiResponse() && aiResponse()!.commands.length > 0}>
        <div class="bg-base-100 rounded-lg border border-base-300 shadow-sm mb-2">
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
                        onClick={() => executeAiCommand(command.command)}
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
                        onClick={() => navigator.clipboard.writeText(command.command)}
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
              💡 提示：点击执行按钮直接运行命令，或复制命令自行修改后执行
            </div>
          </div>
        </div>
      </Show>

      {/* Main Chat Input */}
      <div class="p-3 bg-base-200 border-t border-base-300">
        <div class="flex items-center gap-2 max-w-4xl mx-auto">
          {/* Chat Toggle Button */}
          <button
            class={`btn btn-sm btn-square ${showChatHistory() ? "btn-primary" : "btn-ghost"}`}
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
            {messages().length > 0 && (
              <div class="badge badge-xs badge-primary absolute -top-1 -right-1">
                {messages().length}
              </div>
            )}
          </button>

          {/* AI Status Indicator */}
          <div class="flex items-center gap-1">
            <div
              class={`w-2 h-2 rounded-full ${isLoading()
                ? "bg-warning animate-pulse"
                : "bg-success"
                }`}
            />
            <span class="text-xs text-base-content/60">
              {isLoading() ? "AI思考中..." : "AI助手"}
            </span>
          </div>

          {/* Input Field - Textarea for multi-line support */}
          <div class="flex-1 relative">
            <textarea
              ref={textareaRef}
              placeholder="用自然语言描述你想要执行的操作...&#10;Enter 发送，Shift+Enter 换行"
              class="textarea textarea-bordered textarea-sm w-full resize-none"
              value={input()}
              onInput={(e) => {
                setInput(e.currentTarget.value);
                handleTextareaInput(e);
              }}
              onKeyDown={handleKeyPress}
              disabled={isLoading()}
              rows="1"
              style="min-height: 2.5rem; max-height: 8rem; overflow-y: auto; height: 40px;"
            />
          </div>

          {/* Action Buttons */}
          <div class="flex items-center gap-1">
            {/* Clear History */}
            <Show when={messages().length > 0}>
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
              onClick={handleChatSubmit}
              disabled={!input().trim() || !props.activeTerminalId() || isLoading()}
            >
              <Show
                when={isLoading()}
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
              const sysInfo = props.systemInfo();
              return sysInfo ? `${sysInfo.os_info.name} 快捷操作:` : "快捷操作:";
            })()}
          </span>
          <button
            class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
            onClick={() => {
              setInput("列出当前目录文件并显示详细信息");
              handleChatSubmit();
            }}
            disabled={isLoading()}
          >
            列出文件
          </button>
          <button
            class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
            onClick={() => {
              setInput("搜索文件中的文本内容");
              handleChatSubmit();
            }}
            disabled={isLoading()}
          >
            搜索文本
          </button>
          <button
            class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
            onClick={() => {
              setInput("检查Git仓库状态和修改");
              handleChatSubmit();
            }}
            disabled={isLoading()}
          >
            Git状态
          </button>
          <button
            class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
            onClick={() => {
              const sysInfo = props.systemInfo();
              const packageManager = sysInfo?.available_tools.package_managers[0] || "包管理器";
              setInput(`使用${packageManager}安装软件`);
              handleChatSubmit();
            }}
            disabled={isLoading()}
          >
            安装软件
          </button>
          <button
            class="badge badge-outline badge-xs hover:badge-primary cursor-pointer"
            onClick={() => {
              const sysInfo = props.systemInfo();
              const osName = sysInfo?.os_info.name || "系统";
              setInput(`查看${osName}系统信息`);
              handleChatSubmit();
            }}
            disabled={isLoading()}
          >
            系统信息
          </button>
        </div>
      </div>
    </div>
  );
}
