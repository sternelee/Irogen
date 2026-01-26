import { createSignal, Show, For, onMount } from "solid-js";
import { getDeviceCapabilities } from "../utils/mobile";
import { getLastTicket, saveTicket, getTicketHistory } from "../utils/localStorage";
import { getTicketDisplayId } from "../utils/ticketParser";

/**
 * Validate a session ticket format.
 * Tickets should be Base32-encoded strings with reasonable length.
 */
function is_valid_session_ticket(ticket: string): boolean {
  if (!ticket || ticket.trim().length === 0) {
    return false;
  }
  // Basic validation - ticket should be > 20 chars and contain valid characters
  const trimmed = ticket.trim();
  return trimmed.length > 20 && /^[a-z2-7]+$/.test(trimmed);
}

interface HomeViewProps {
  sessionTicket: string;
  onTicketInput: (value: string) => void;
  onConnect: (ticket?: string) => void;
  onShowSettings: () => void;
  connecting: boolean;
  connectionError: string | null;
  isLoggedIn: boolean;
  onLogin: (username: string, password: string) => void;
  onSkipLogin: () => void;
  isConnected: boolean;
  activeTicket: string | null;
  onReturnToSession: () => void;
  onDisconnect: () => void;
}

export function HomeView(props: HomeViewProps) {
  const [showLoginModal, setShowLoginModal] = createSignal(false);
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [inputFocused, setInputFocused] = createSignal(false);
  const [loginInputFocused, setLoginInputFocused] = createSignal(false);
  const [ticketHistory, setTicketHistory] = createSignal<string[]>([]);

  // 检测设备类型
  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;

  // Load saved tickets on component mount
  onMount(() => {
    // Load last ticket and set it if no current ticket is provided
    const lastTicket = getLastTicket();
    if (lastTicket && !props.sessionTicket) {
      props.onTicketInput(lastTicket);
    }

    // Load ticket history
    setTicketHistory(getTicketHistory());
  });

  const handleLogin = () => {
    props.onLogin(username(), password());
    setShowLoginModal(false);
  };

  const handleQuickConnect = (ticket: string) => {
    // Save ticket to localStorage before connecting
    saveTicket(ticket);
    props.onConnect(ticket);
  };

  const handleConnect = () => {
    const ticket = props.sessionTicket.trim();
    if (ticket) {
      // Save ticket to localStorage before connecting
      saveTicket(ticket);
      props.onConnect(ticket);
    }
  };

  const handleShowQRScanner = async () => {
    try {
      // 使用Tauri的条码扫描插件
      const { scan } = await import("@tauri-apps/plugin-barcode-scanner");
      const result = await scan();
      console.log(result);
      if (result && result.content) {
        // Validate ticket format before setting
        if (is_valid_session_ticket(result.content)) {
          props.onTicketInput(result.content);
          // Auto-connect on successful scan
          handleQuickConnect(result.content);
        } else {
          console.error("Invalid ticket format");
          // Could show a toast notification here
        }
      }
    } catch (error) {
      console.error("QR Scanner error:", error);
      // Handle user cancellation vs actual errors
    }
  };

  // 登录模态框
  const renderLoginModal = () => (
    <Show when={showLoginModal()}>
      <div
        class="fixed inset-0 bg-black/50 z-50 flex justify-center transition-all duration-300"
        classList={{
          "items-end md:items-center": !loginInputFocused() || !isMobile,
          "items-start pt-12": loginInputFocused() && isMobile
        }}
        onClick={() => setShowLoginModal(false)}
      >
        <div
          class="bg-base-100 w-full max-w-md rounded-t-3xl md:rounded-2xl p-6 transform transition-all duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            class="text-center transition-all duration-300"
            classList={{
              "mb-6": !loginInputFocused() || !isMobile,
              "mb-4": loginInputFocused() && isMobile
            }}
          >
            <div class="w-12 h-1 bg-base-300 rounded-full mx-auto mb-4 md:hidden"></div>
            <h2
              class="font-bold transition-all duration-300"
              classList={{
                "text-2xl mb-2": !loginInputFocused() || !isMobile,
                "text-xl mb-1": loginInputFocused() && isMobile
              }}
            >
              登录
            </h2>
            <Show when={!loginInputFocused() || !isMobile}>
              <p class="text-sm opacity-70">登录后解锁完整功能</p>
            </Show>
          </div>

          <div class="space-y-4">
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">用户名</span>
              </label>
              <input
                type="text"
                placeholder="输入用户名"
                class="input input-bordered w-full text-base"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                onFocus={() => setLoginInputFocused(true)}
                onBlur={() => setLoginInputFocused(false)}
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">密码</span>
              </label>
              <input
                type="password"
                placeholder="输入密码"
                class="input input-bordered w-full text-base"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                onFocus={() => setLoginInputFocused(true)}
                onBlur={() => setLoginInputFocused(false)}
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

            <Show when={!loginInputFocused() || !isMobile}>
              <div class="text-center text-xs opacity-50 mt-4">
                <p>登陆后解锁完整功能</p>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );


  // 主页渲染 - 简洁设计
  const renderMainView = () => (
    <div class="min-h-screen bg-base-100 flex flex-col">
      {/* 主内容区域 - Logo 和 Slogan */}
      <div
        class="flex-1 flex flex-col items-center p-6 transition-all duration-300"
        classList={{
          "justify-center": !inputFocused() || !isMobile,
          "justify-start pt-20": inputFocused() && isMobile
        }}
      >
        {/* Logo */}
        <div
          class="text-center transition-all duration-300"
          classList={{
            "mb-12": !inputFocused() || !isMobile,
            "mb-8 scale-90": inputFocused() && isMobile
          }}
        >
          <div
            class="text-6xl text-primary transition-all duration-300"
            classList={{
              "mb-6": !inputFocused() || !isMobile,
              "mb-3": inputFocused() && isMobile
            }}
          >
            ⚡
          </div>
          <h1
            class="font-bold transition-all duration-300"
            classList={{
              "text-4xl mb-3": !inputFocused() || !isMobile,
              "text-3xl mb-2": inputFocused() && isMobile
            }}
          >
            RiTerm
          </h1>
          <Show when={!inputFocused() || !isMobile}>
            <p class="text-lg text-base-content/70 max-w-sm">
              P2P 终端远程连接工具
            </p>
          </Show>
        </div>

        {/* 连接输入框 */}
        <div class="w-full max-w-md mb-4">
          <div class="flex items-center space-x-2">
            <div class="flex-1">
              <input
                type="text"
                value={props.sessionTicket}
                onInput={(e) => props.onTicketInput(e.currentTarget.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="输入会话票据..."
                class="input input-bordered w-full text-base"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && props.sessionTicket.trim()) {
                    handleConnect();
                  }
                }}
                autofocus
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

        {/* 票据历史 */}
        <Show when={ticketHistory().length > 0}>
          <div class="w-full max-w-md mb-4">
            <div class="text-sm opacity-70 mb-2">最近连接:</div>
            <div class="space-y-1">
              <For each={ticketHistory()}>
                {(ticket) => (
                  <div
                    class="p-2 bg-base-200 rounded-lg cursor-pointer hover:bg-base-300 transition-colors flex items-center justify-between"
                    onClick={() => {
                      props.onTicketInput(ticket);
                      handleConnect();
                    }}
                  >
                    <div class="font-mono text-sm font-medium">
                      {getTicketDisplayId(ticket)}
                    </div>
                    <div class="text-xs opacity-50">点击连接</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

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
      </div>
    </div>
  );

  return (
    <div class="font-mono">
      {/* 主页内容 */}
      {renderMainView()}

      {/* 登录模态框 */}
      {renderLoginModal()}

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
