import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import { getDeviceCapabilities } from "../utils/mobile";
import { getLastTicket, saveTicket, getTicketHistory, updateTicketHostname, type TicketHistoryItem } from "../utils/localStorage";
import { getTicketDisplayId } from "../utils/ticketParser";
import { listen } from "@tauri-apps/api/event";

/**
 * Validate a session ticket format.
 * Supports both new iroh-tickets format (base64) and legacy format (base32 lowercase).
 */
function is_valid_session_ticket(ticket: string): boolean {
  if (!ticket || ticket.trim().length === 0) {
    return false;
  }
  const trimmed = ticket.trim();

  // New iroh-tickets format: base64 (alphanumeric + + / =), ~44-52 chars
  if (/^[A-Za-z0-9+/=]{40,60}$/.test(trimmed)) {
    return true;
  }

  // Legacy format: base32 lowercase (a-z2-7), ~150+ chars
  if (/^[a-z2-7]{100,}$/.test(trimmed)) {
    return true;
  }

  return false;
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
  const [ticketHistory, setTicketHistory] = createSignal<TicketHistoryItem[]>([]);

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

    // Listen for system-info-received event from backend
    const unlisten = listen<{ hostname: string; node_id: string }>("system-info-received", (event) => {
      const { hostname } = event.payload;
      console.log("🖥️ Received system info - hostname:", hostname);

      // Get the current ticket from localStorage (most reliable source)
      const currentTicket = getLastTicket();
      console.log("🎫 Current ticket from storage:", currentTicket?.substring(0, 8) + "...");

      if (currentTicket) {
        updateTicketHostname(currentTicket, hostname);
        // Refresh the ticket history display
        setTicketHistory(getTicketHistory());
        console.log("✅ Updated hostname for ticket");
      } else {
        console.warn("⚠️ No current ticket found to update hostname");
      }
    });

    // Cleanup listener on unmount
    onCleanup(() => {
      unlisten.then((fn) => fn());
    });
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
        class="fixed inset-0 bg-black/80 z-50 flex justify-center transition-all duration-300"
        classList={{
          "items-end md:items-center": !loginInputFocused() || !isMobile,
          "items-start pt-12": loginInputFocused() && isMobile
        }}
        onClick={() => setShowLoginModal(false)}
      >
        <div
          class="ascii-box w-full max-w-md transform transition-all duration-300"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            class="text-center transition-all duration-300"
            classList={{
              "mb-6": !loginInputFocused() || !isMobile,
              "mb-4": loginInputFocused() && isMobile
            }}
          >
            <div class="w-12 h-1 bg-primary rounded-full mx-auto mb-4 md:hidden opacity-60"></div>
            <div class="terminal-cmd mb-4">
              <span class="text-primary">&gt;&gt;&gt; 用户登录</span>
            </div>
            <Show when={!loginInputFocused() || !isMobile}>
              <p class="text-sm text-base-content/70">登录后解锁完整功能</p>
            </Show>
          </div>

          <div class="space-y-4">
            <div>
              <label class="label">
                <span class="label-text font-medium text-primary">用户名 / Username</span>
              </label>
              <input
                type="text"
                placeholder="输入用户名..."
                class="input w-full text-base bg-transparent border-primary/50 text-primary"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                onFocus={() => setLoginInputFocused(true)}
                onBlur={() => setLoginInputFocused(false)}
              />
            </div>

            <div>
              <label class="label">
                <span class="label-text font-medium text-primary">密码 / Password</span>
              </label>
              <input
                type="password"
                placeholder="输入密码..."
                class="input w-full text-base bg-transparent border-primary/50 text-primary"
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
                type="button"
                class="btn flex-1"
                onClick={handleLogin}
                disabled={!username().trim() || !password().trim()}
              >
                <span class="text-primary font-bold">[ 登录 ]</span>
              </button>
            </div>

            <Show when={!loginInputFocused() || !isMobile}>
              <div class="text-center text-xs text-base-content/50 mt-4">
                <p class="font-mono">// 登录后解锁完整功能</p>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );


  // 主页渲染 - 终端风格设计
  const renderMainView = () => (
    <div class="min-h-screen bg-base-100 flex flex-col font-mono">
      {/* 主内容区域 - Logo 和 Slogan */}
      <div
        class="flex-1 flex flex-col items-center p-6 transition-all duration-300"
        classList={{
          "justify-center": !inputFocused() || !isMobile,
          "justify-start pt-20": inputFocused() && isMobile
        }}
      >
        {/* ASCII 艺术装饰 - 仅桌面端显示 */}
        <Show when={!isMobile && (!inputFocused() || !isMobile)}>
          <div class="text-primary text-xs mb-4 opacity-60">
            <pre>
{`
╔═════════════════════════════════════════════════════════╗
║  ╔═╗╔═╗╔═╗╦ ╦╔═╗╦  ╦  ╔═╗╔═╗  ╦ ╦╔═╗╦  ╦╔═╗       ║
║  ║╣ ╠═╣║ ║║ ║╠═╝╚╗╔╝  ║ ║║ ║  ╠═╣╠═╣╚╗╔╝╠═╝       ║
║  ╚═╝╩ ╩╚═╝╚═╝╩  ╚╝ ╚╝  ╚═╝╚═╝  ╩ ╩╩ ╩ ╚╝ ╩         ║
╚═════════════════════════════════════════════════════════╝`}
            </pre>
          </div>
        </Show>

        {/* Logo 和标题 */}
        <div
          class="text-center transition-all duration-300"
          classList={{
            "mb-12": !inputFocused() || !isMobile,
            "mb-8 scale-90": inputFocused() && isMobile
          }}
        >
          <div
            class="text-6xl text-primary transition-all duration-300 mb-6 glow-text"
            classList={{
              "mb-6": !inputFocused() || !isMobile,
              "mb-3": inputFocused() && isMobile
            }}
          >
            ⚡
          </div>
          <div class="relative">
            <h1
              class="font-bold transition-all duration-300"
              classList={{
                "text-4xl mb-3": !inputFocused() || !isMobile,
                "text-3xl mb-2": inputFocused() && isMobile
              }}
            >
              <span class="text-primary">&gt;&gt;&gt;</span> RiTerm <span class="typing-cursor"></span>
            </h1>
          </div>
          <Show when={!inputFocused() || !isMobile}>
            <div class="terminal-cmd inline-block mt-2">
              <span>P2P 终端远程连接工具 v1.0</span>
            </div>
          </Show>
        </div>

        {/* 连接输入框 */}
        <div class="w-full max-w-2xl mb-6">
          <div class="ascii-box">
            <div class="text-primary text-sm mb-3 font-bold">
              &gt;&gt;&gt; 连接到远程终端
            </div>
            <div class="flex items-center space-x-2">
              <div class="flex-1">
                <input
                  type="text"
                  value={props.sessionTicket}
                  onInput={(e) => props.onTicketInput(e.currentTarget.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  placeholder="输入会话票据 (Session Ticket)..."
                  class="input w-full text-base bg-transparent border-primary/50 text-primary focus:border-primary focus:ring-1 focus:ring-primary"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && props.sessionTicket.trim()) {
                      handleConnect();
                    }
                  }}
                  autofocus
                />
                {props.connectionError && (
                  <div class="text-error text-sm mt-2 flex items-center gap-2">
                    <span class="text-lg">✕</span>
                    <span>{props.connectionError}</span>
                  </div>
                )}
              </div>
              {/* 扫码按钮 - 仅移动端显示 */}
              <Show when={isMobile}>
                <button
                  type="button"
                  class="btn btn-outline btn-square"
                  onClick={handleShowQRScanner}
                >
                  <span class="text-2xl">📷</span>
                </button>
              </Show>
            </div>
          </div>
        </div>

        {/* 票据历史 */}
        <Show when={ticketHistory().length > 0}>
          <div class="w-full max-w-2xl mb-6">
            <div class="terminal-cmd">
              <span class="text-primary">&gt;&gt;&gt; 最近连接:</span>
            </div>
            <div class="space-y-2 mt-3">
              <For each={ticketHistory()}>
                {(item) => (
                  <div
                    class="terminal-list-item flex items-center justify-between"
                    onClick={() => {
                      props.onTicketInput(item.ticket);
                      handleConnect();
                    }}
                  >
                    <div class="flex-1 min-w-0">
                      <div class="font-mono text-sm font-medium text-primary truncate">
                        {item.hostname || getTicketDisplayId(item.ticket)}
                      </div>
                      <div class="text-xs text-base-content/50 mt-1 flex items-center gap-2">
                        <Show when={item.hostname}>
                          <span>({getTicketDisplayId(item.ticket)})</span>
                        </Show>
                        <span>点击连接</span>
                      </div>
                    </div>
                    <div class="text-primary ml-2">
                      <span class="text-lg">→</span>
                    </div>
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
        <div class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center">
          <div class="ascii-box text-center">
            <div class="loading loading-spinner loading-lg mb-4 text-primary"></div>
            <div class="font-mono text-primary text-lg mb-2">
              <span class="typing-cursor inline-block mr-2"></span>
              正在连接...
            </div>
            <div class="text-sm text-base-content/70 font-mono mt-2">
              Establishing secure P2P connection...
            </div>
            <div class="text-xs text-base-content/50 font-mono mt-4">
              [████████████░░░░░░░░] 50%
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
