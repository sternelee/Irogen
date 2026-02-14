import { createSignal, Show, For, onMount } from "solid-js";
import { toast } from "solid-sonner";
import { getDeviceCapabilities } from "../utils/mobile";
import {
  getLastTicket,
  saveTicket,
  getTicketHistory,
} from "../utils/localStorage";
import { getTicketDisplayId } from "../utils/ticketParser";

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
  const [ticketHistory, setTicketHistory] = createSignal<string[]>([]);

  // Device capabilities
  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;

  // Load saved tickets on component mount
  onMount(() => {
    const lastTicket = getLastTicket();
    if (lastTicket && !props.sessionTicket) {
      props.onTicketInput(lastTicket);
    }
    setTicketHistory(getTicketHistory());
  });

  const handleLogin = () => {
    props.onLogin(username(), password());
    setShowLoginModal(false);
  };

  const handleQuickConnect = (ticket: string) => {
    saveTicket(ticket);
    props.onConnect(ticket);
  };

  const handleConnect = () => {
    const ticket = props.sessionTicket.trim();
    if (ticket) {
      saveTicket(ticket);
      props.onConnect(ticket);
    }
  };

  const handleShowQRScanner = async () => {
    try {
      const { scan, checkPermissions, requestPermissions } =
        await import("@tauri-apps/plugin-barcode-scanner");
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== "granted") {
        permissionStatus = await requestPermissions();
      }
      if (permissionStatus !== "granted") {
        toast.error("Camera permission is required to scan QR codes");
        return;
      }
      const result = await scan();
      if (result && result.content) {
        if (is_valid_session_ticket(result.content)) {
          props.onTicketInput(result.content);
          handleQuickConnect(result.content);
        } else {
          toast.error("Invalid ticket format");
        }
      }
    } catch (error) {
      console.error("QR Scanner error:", error);
    }
  };

  // Login Modal
  const renderLoginModal = () => (
    <Show when={showLoginModal()}>
      <div class="fixed inset-0 bg-base-300/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="card bg-base-100 shadow-2xl w-full max-w-md">
          <div class="card-body">
            <h2 class="card-title justify-center text-2xl mb-4">
              Account Login
            </h2>

            <div class="form-control w-full">
              <label class="label" for="username-input">
                <span class="label-text">Username</span>
              </label>
              <input
                id="username-input"
                type="text"
                placeholder="Enter username"
                class="input input-bordered w-full"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </div>

            <div class="form-control w-full mt-4">
              <label class="label" for="password-input">
                <span class="label-text">Password</span>
              </label>
              <input
                id="password-input"
                type="password"
                placeholder="Enter password"
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

            <div class="card-actions justify-end mt-8">
              <button
                type="button"
                class="btn btn-ghost"
                onClick={() => setShowLoginModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-primary"
                onClick={handleLogin}
                disabled={!username().trim() || !password().trim()}
              >
                Login
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );

  return (
    <div class="min-h-screen bg-base-200 flex flex-col items-center justify-center p-4">
      <div class="max-w-3xl w-full flex flex-col items-center">
        {/* Logo/Header */}
        <div class="text-center mb-12">
          <div class="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-primary/10 text-primary text-5xl mb-6 shadow-lg">
            ⚡
          </div>
          <h1 class="text-4xl font-bold mb-2">RiTerm AI</h1>
          <p class="text-base-content/60">Secure P2P Agent Collaboration</p>
        </div>

        {/* Main Card */}
        <div class="card bg-base-100 shadow-xl w-full max-w-lg overflow-hidden">
          <div class="card-body p-8">
            <h2 class="card-title text-xl mb-6">Connect to Session</h2>

            <div class="form-control w-full">
              <div class="join w-full">
                <input
                  type="text"
                  value={props.sessionTicket}
                  onInput={(e) => props.onTicketInput(e.currentTarget.value)}
                  placeholder="Paste session ticket here..."
                  class="input input-bordered input-lg w-full join-item focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && props.sessionTicket.trim()) {
                      handleConnect();
                    }
                  }}
                  autofocus
                  aria-label="Session Ticket"
                />
                <Show when={isMobile}>
                  <button
                    type="button"
                    class="btn btn-lg btn-square join-item"
                    onClick={handleShowQRScanner}
                    title="Scan QR Code"
                  >
                    📷
                  </button>
                </Show>
              </div>
              <Show when={props.connectionError}>
                <div class="label">
                  <span class="label-text-alt text-error flex items-center gap-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <title>Error</title>
                      <path
                        fill-rule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    {props.connectionError}
                  </span>
                </div>
              </Show>
            </div>

            <div class="card-actions mt-6">
              <button
                type="button"
                class="btn btn-primary btn-lg w-full shadow-lg hover:shadow-xl transition-shadow"
                onClick={handleConnect}
                disabled={!props.sessionTicket.trim() || props.connecting}
              >
                <Show
                  when={props.connecting}
                  fallback={<span>Connect Now</span>}
                >
                  <span class="loading loading-spinner"></span>
                  Connecting...
                </Show>
              </button>
            </div>
          </div>

          {/* History Section */}
          <Show when={ticketHistory().length > 0}>
            <div class="bg-base-200/50 p-6 border-t border-base-200">
              <h3 class="text-xs font-bold text-base-content/50 uppercase tracking-wider mb-3">
                Recent Sessions
              </h3>
              <div class="space-y-2">
                <For each={ticketHistory().slice(0, 3)}>
                  {(ticket) => (
                    <button
                      type="button"
                      class="w-full text-left p-3 rounded-lg bg-base-100 hover:bg-base-200 border border-base-200 transition-colors flex items-center justify-between group"
                      onClick={() => handleQuickConnect(ticket)}
                    >
                      <div class="flex items-center gap-3 overflow-hidden">
                        <div class="w-2 h-2 rounded-full bg-success"></div>
                        <span class="font-mono text-sm truncate opacity-70 group-hover:opacity-100 transition-opacity">
                          {getTicketDisplayId(ticket)}
                        </span>
                      </div>
                      <span class="text-base-content/30 group-hover:text-primary transition-colors">
                        →
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="mt-12 text-center text-sm text-base-content/40">
          <p>Powered by Tauri v2 & SolidJS</p>
        </div>
      </div>

      {renderLoginModal()}
    </div>
  );
}
