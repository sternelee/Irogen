import { createSignal, Show, For } from "solid-js";
import { HistoryEntry } from "../hooks/useConnectionHistory";
import { getDeviceCapabilities } from "../utils/mobile";

interface HomeViewProps {
  sessionTicket: string;
  onTicketInput: (value: string) => void;
  onConnect: (ticket?: string) => void;
  onShowSettings: () => void;
  onShowEnhancedConnection: () => void;
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
  sessionStats?: {
    activeTerminals: number;
    activePortForwards: number;
    messagesReceived: number;
    lastMessageTime: number;
  };
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
              <button
                class="btn btn-primary flex-1"
                onClick={handleLogin}
                disabled={!username().trim() || !password().trim()}
              >
                🔑 登录
              </button>
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

  const formatLastActivity = (timestamp: number) => {
    if (timestamp === 0) return "无活动";
    const diff = Date.now() - timestamp;
    if (diff < 1000) return "刚刚";
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    return `${Math.floor(diff / 3600000)}小时前`;
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
                      <button
                        class="btn btn-primary btn-sm"
                        onClick={() => {
                          handleQuickConnect(entry.ticket);
                          setShowHistoryModal(false);
                        }}
                        disabled={props.connecting}
                      >
                        连接
                      </button>
                      <button
                        class="btn btn-ghost btn-sm"
                        onClick={() => props.onDeleteHistory(entry.ticket)}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          <div class="mt-6 pt-4 border-t border-base-300">
            <button
              class="btn btn-ghost w-full"
              onClick={() => setShowHistoryModal(false)}
            >
              ✖️ 关闭
            </button>
          </div>
        </div>
      </div>
    </Show>
  );

  // 主页渲染 - 简洁设计
  const renderMainView = () => (
    <div class="min-h-screen bg-base-100 flex flex-col">
      {/* 主内容区域 - Logo 和 Slogan */}
      <div class="flex-1 flex flex-col items-center justify-center p-6">
        {/* Logo */}
        <div class="text-center mb-12">
          <div class="text-6xl text-primary mb-6">⚡</div>
          <h1 class="text-4xl font-bold mb-3">
            RiTerm
          </h1>
          <p class="text-lg text-base-content/70 max-w-sm">
            P2P 终端远程连接工具
          </p>
        </div>

        {/* 连接输入框 */}
        <div class="w-full max-w-md mb-4">
          <div class="flex items-center space-x-2">
            <div class="flex-1">
              <input
                type="text"
                value={props.sessionTicket}
                onInput={(e) => props.onTicketInput(e.currentTarget.value)}
                placeholder="输入会话票据..."
                class="input input-bordered w-full"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && props.sessionTicket.trim()) {
                    props.onConnect();
                  }
                }}
                autoFocus
              />
              {props.connectionError && (
                <div class="text-error text-sm mt-1">{props.connectionError}</div>
              )}
            </div>
            {/* 扫码按钮 - 仅移动端显示 */}
            <Show when={isMobile}>
              <button
                class="btn btn-outline"
                onClick={handleShowQRScanner}
              >
                📷
              </button>
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

        {/* 连接按钮组 */}
        <div class="flex flex-col space-y-3 max-w-md w-full">
          {/* 标准连接按钮 */}
          <button
            class="btn btn-primary w-full"
            onClick={() => props.onConnect()}
            disabled={props.connecting || !props.sessionTicket.trim()}
          >
            {props.connecting ? (
              <>
                <span class="loading loading-spinner loading-sm"></span>
                连接中...
              </>
            ) : (
              <>
                🚀 快速连接
              </>
            )}
          </button>

          {/* 增强连接按钮 */}
          <button
            class="btn btn-secondary w-full"
            onClick={props.onShowEnhancedConnection}
          >
            🔧 增强连接
          </button>

          {/* 历史连接按钮 */}
          <Show when={props.history.length > 0}>
            <button
              class="btn btn-ghost w-full"
              onClick={() => setShowHistoryModal(true)}
            >
              📚 历史连接
            </button>
          </Show>
        </div>

        {/* 会话统计信息 */}
        <Show when={props.sessionStats && props.isConnected}>
          <div class="w-full max-w-md mt-6">
            <div class="stats stats-vertical lg:stats-horizontal shadow">
              <div class="stat">
                <div class="stat-title">活跃终端</div>
                <div class="stat-value text-primary">{props.sessionStats?.activeTerminals || 0}</div>
              </div>

              <div class="stat">
                <div class="stat-title">端口转发</div>
                <div class="stat-value text-secondary">{props.sessionStats?.activePortForwards || 0}</div>
              </div>

              <div class="stat">
                <div class="stat-title">消息数</div>
                <div class="stat-value text-accent">{props.sessionStats?.messagesReceived || 0}</div>
              </div>
            </div>

            <div class="text-center text-sm opacity-70 mt-2">
              最后活动: {formatLastActivity(props.sessionStats?.lastMessageTime || 0)}
            </div>
          </div>
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
