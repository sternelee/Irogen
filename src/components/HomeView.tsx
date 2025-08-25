import { createSignal, Show, For } from "solid-js";
import { TypingAnimation } from "./ui/CyberEffects";
import { HistoryEntry } from "../hooks/useConnectionHistory";
import { EnhancedButton, EnhancedInput } from "./ui/EnhancedComponents";
import { getDeviceCapabilities } from "../utils/mobile";

interface HomeViewProps {
  sessionTicket: string;
  onTicketInput: (value: string) => void;
  onConnect: (ticket?: string) => void;
  onShowSettings: () => void;
  connecting: boolean;
  connectionError: string | null;
  history: HistoryEntry[];
  isLoggedIn: boolean;
  onLogin: (username: string, password: string) => void;
  onSkipLogin: () => void;
  isConnected: boolean;
  activeTicket: string | null;
  onReturnToSession: () => void;
  onDeleteHistory: (ticket: string) => void;
  onDisconnect: () => void;
}

export function HomeView(props: HomeViewProps) {
  const [showLoginModal, setShowLoginModal] = createSignal(false);
  const [showHistoryModal, setShowHistoryModal] = createSignal(false);
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");

  // 检测设备类型
  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;

  const handleLogin = () => {
    props.onLogin(username(), password());
    setShowLoginModal(false);
  };

  const handleQuickConnect = (ticket: string) => {
    props.onConnect(ticket);
  };

  const handleShowQRScanner = async () => {
    try {
      // 使用Tauri的条码扫描插件
      const { scan } = await import("@tauri-apps/plugin-barcode-scanner");
      const result = await scan();
      console.log(result);
      if (result) {
        props.onTicketInput(result.content);
      }
    } catch (error) {
      console.error("QR Scanner error:", error);
    }
  };

  // 登录模态框
  const renderLoginModal = () => (
    <Show when={showLoginModal()}>
      <div
        class="fixed inset-0 bg-black/50 z-50 flex items-end justify-center md:items-center"
        onClick={() => setShowLoginModal(false)}
      >
        <div
          class="bg-base-100 w-full max-w-md rounded-t-3xl md:rounded-2xl p-6 transform transition-transform"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="text-center mb-6">
            <div class="w-12 h-1 bg-base-300 rounded-full mx-auto mb-4 md:hidden"></div>
            <h2 class="text-2xl font-bold mb-2">登录</h2>
            <p class="text-sm opacity-70">登录后解锁完整功能</p>
          </div>

          <div class="space-y-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">用户名</span>
              </label>
              <input
                type="text"
                placeholder="输入用户名"
                class="input input-bordered w-full"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">密码</span>
              </label>
              <input
                type="password"
                placeholder="输入密码"
                class="input input-bordered w-full"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    username().trim() &&
                    password().trim()
                  ) {
                    handleLogin();
                  }
                }}
              />
            </div>

            <div class="flex space-x-3 mt-6">
              <EnhancedButton
                variant="primary"
                fullWidth
                onClick={handleLogin}
                disabled={!username().trim() || !password().trim()}
                icon="🔑"
                haptic
              >
                登录
              </EnhancedButton>
            </div>

            <div class="text-center text-xs opacity-50 mt-4">
              <p>登陆后解锁完整功能</p>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );

  // 历史连接模态框
  const renderHistoryModal = () => (
    <Show when={showHistoryModal()}>
      <div
        class="fixed inset-0 bg-black/50 z-50 flex items-end justify-center md:items-center"
        onClick={() => setShowHistoryModal(false)}
      >
        <div
          class="bg-base-100 w-full max-w-md max-h-[80vh] rounded-t-3xl md:rounded-2xl p-6 transform transition-transform overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="text-center mb-6">
            <div class="w-12 h-1 bg-base-300 rounded-full mx-auto mb-4 md:hidden"></div>
            <h2 class="text-2xl font-bold mb-2">历史连接</h2>
            <p class="text-sm opacity-70">选择一个历史连接来快速连接</p>
          </div>

          <div class="space-y-3">
            <For each={props.history}>
              {(entry) => {
                const getConnectionStatusIcon = (entry: HistoryEntry) => {
                  if (props.activeTicket === entry.ticket) return "🟢";
                  switch (entry.status) {
                    case "Completed":
                      return "✅";
                    case "Failed":
                      return "❌";
                    case "Active":
                      return "🟡";
                    default:
                      return "⚪";
                  }
                };

                const formatConnectionTime = (timestamp: string | number) => {
                  const date = new Date(timestamp);
                  const now = new Date();
                  const diff = now.getTime() - date.getTime();

                  if (diff < 60000) return "刚才";
                  if (diff < 3600000)
                    return `${Math.floor(diff / 60000)} 分钟前`;
                  if (diff < 86400000)
                    return `${Math.floor(diff / 3600000)} 小时前`;
                  return date.toLocaleDateString();
                };

                return (
                  <div class="flex items-center justify-between p-4 bg-base-200 rounded-lg hover:bg-base-300 transition-colors">
                    <div class="flex items-center space-x-3 flex-1 min-w-0">
                      <span class="text-lg">
                        {getConnectionStatusIcon(entry)}
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="font-medium truncate">{entry.title}</div>
                        <div class="text-xs opacity-70 font-mono truncate">
                          {entry.ticket.substring(0, 16)}...
                        </div>
                        <div class="text-xs opacity-50">
                          {formatConnectionTime(entry.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div class="flex space-x-2">
                      <EnhancedButton
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          handleQuickConnect(entry.ticket);
                          setShowHistoryModal(false);
                        }}
                        disabled={props.connecting}
                        haptic
                      >
                        连接
                      </EnhancedButton>
                      <EnhancedButton
                        variant="ghost"
                        size="sm"
                        onClick={() => props.onDeleteHistory(entry.ticket)}
                        icon="🗑️"
                        haptic
                      />
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          <div class="mt-6 pt-4 border-t border-base-300">
            <EnhancedButton
              variant="ghost"
              fullWidth
              onClick={() => setShowHistoryModal(false)}
              icon="✖️"
            >
              关闭
            </EnhancedButton>
          </div>
        </div>
      </div>
    </Show>
  );

  // 主页渲染 - 移动端优先设计
  const renderMainView = () => (
    <div class="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 flex flex-col">
      {/* 主内容区域 - Logo 和 Slogan */}
      <div class="flex-1 flex flex-col items-center justify-center p-6">
        {/* Logo */}
        <div class="text-center mb-12">
          <div class="text-8xl text-primary mb-6 animate-bounce">⚡</div>
          <h1 class="text-5xl font-bold mb-3">
            <TypingAnimation text="RiTerm" speed={100} />
          </h1>
          <p class="text-lg opacity-70 font-mono max-w-sm">
            P2P 终端远程连接工具
          </p>
        </div>

        {/* 连接输入框 */}
        <div class="w-full max-w-md mb-4">
          <div class="flex items-center space-x-2">
            <div class="flex-1">
              <EnhancedInput
                value={props.sessionTicket}
                onInput={props.onTicketInput}
                placeholder="输入会话票据..."
                icon="🎫"
                class="text-center"
                error={props.connectionError || undefined}
                onEnter={() => {
                  if (props.sessionTicket.trim()) {
                    props.onConnect();
                  }
                }}
                autoFocus
              />
            </div>
            {/* 扫码按钮 - 仅移动端显示 */}
            <Show when={isMobile}>
              <EnhancedButton
                variant="outline"
                onClick={handleShowQRScanner}
                icon="📷"
                haptic
                class="shrink-0"
              />
            </Show>
          </div>
        </div>

        {/* 登录按钮 */}
        {/* <EnhancedButton */}
        {/*   variant="primary" */}
        {/*   size="lg" */}
        {/*   fullWidth */}
        {/*   onClick={() => setShowLoginModal(true)} */}
        {/*   icon="🚀" */}
        {/*   haptic */}
        {/*   class="max-w-md" */}
        {/* > */}
        {/*   帐号登录 */}
        {/* </EnhancedButton> */}

        {/* 历史连接按钮 */}
        <Show when={props.history.length > 0}>
          <EnhancedButton
            variant="ghost"
            fullWidth
            onClick={() => setShowHistoryModal(true)}
            icon="📚"
            class="max-w-md md:mt-4"
          >
            历史连接
          </EnhancedButton>
        </Show>
      </div>
    </div>
  );

  return (
    <div class="font-mono">
      {/* 主页内容 */}
      {renderMainView()}

      {/* 登录模态框 */}
      {renderLoginModal()}

      {/* 历史连接模态框 */}
      {renderHistoryModal()}

      {/* 正在连接的加载遮罩 */}
      <Show when={props.connecting}>
        <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div class="bg-base-100 p-8 rounded-2xl text-center">
            <div class="loading loading-spinner loading-lg mb-4"></div>
            <div class="font-medium">正在连接...</div>
            <div class="text-sm opacity-70 mt-2">请稍候</div>
          </div>
        </div>
      </Show>
    </div>
  );
}
