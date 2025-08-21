import { createSignal, Show, For } from "solid-js";
import { settingsStore, t } from "../stores/settingsStore";
import {
  ModernCard,
  ModernButton,
  ModernInput,
  TypingAnimation,
} from "./ui/CyberEffects";
import { HistoryEntry } from "../hooks/useConnectionHistory";

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
}

export function HomeView(props: HomeViewProps) {
  const [viewMode, setViewMode] = createSignal<"login" | "guest" | "main">(
    "login",
  );
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [showQuickConnect, setShowQuickConnect] = createSignal(false);

  const handleLogin = () => {
    props.onLogin(username(), password());
    setViewMode("main");
  };

  const handleGuestMode = () => {
    props.onSkipLogin();
    setViewMode("main");
  };

  const handleQuickConnect = (ticket: string) => {
    props.onConnect(ticket);
  };

  const renderLoginScreen = () => (
    <div class="hero min-h-screen">
      <div class="hero-content flex-col lg:flex-row-reverse">
        <div class="text-center lg:text-left">
          <div class="text-6xl text-primary mb-4">⚡</div>
          <h1 class="text-5xl font-bold">
            <TypingAnimation text="RiTerm" speed={100} />
          </h1>
          <p class="py-6 font-mono">{t("app.title")}</p>
        </div>

        <div class="card bg-base-100 w-full max-w-sm shrink-0 shadow-2xl">
          <div class="card-body">
            <div class="form-control">
              <label class="label">
                <span class="label-text">Username</span>
              </label>
              <input
                type="text"
                placeholder="username"
                class="input input-bordered"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text">Password</span>
              </label>
              <input
                type="password"
                placeholder="password"
                class="input input-bordered"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
              />
            </div>

            <div class="form-control mt-6">
              <button
                class="btn btn-primary"
                onClick={handleLogin}
                disabled={!username().trim() || !password().trim()}
              >
                {t("connection.connect")}
              </button>
            </div>

            <div class="divider">OR</div>

            <button class="btn btn-ghost" onClick={handleGuestMode}>
              Continue as Guest 👻
            </button>

            <button
              class="btn btn-outline btn-sm"
              onClick={() => setShowQuickConnect(!showQuickConnect())}
            >
              Quick Connect 🎯
            </button>

            <Show when={showQuickConnect()}>
              <div class="card bg-base-200 mt-4">
                <div class="card-body card-compact">
                  <h3 class="card-title text-sm">Quick Connect</h3>
                  <div class="form-control">
                    <input
                      type="text"
                      placeholder={t("connection.ticket.placeholder")}
                      class="input input-bordered input-sm"
                      value={props.sessionTicket}
                      onInput={(e) =>
                        props.onTicketInput(e.currentTarget.value)
                      }
                    />
                  </div>
                  <div class="card-actions justify-end">
                    <button
                      class="btn btn-primary btn-sm"
                      onClick={() => handleQuickConnect(props.sessionTicket)}
                      disabled={!props.sessionTicket.trim() || props.connecting}
                    >
                      {props.connecting ? "Connecting..." : "Connect Now"}
                    </button>
                  </div>

                  {props.connectionError && (
                    <div class="alert alert-error text-xs">
                      <span>❌ {props.connectionError}</span>
                    </div>
                  )}
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMainScreen = () => (
    <div class="min-h-screen bg-base-200">
      {/* Navbar */}
      <div class="navbar bg-base-100 shadow-lg">
        <div class="navbar-start">
          <div class="flex items-center space-x-3">
            <span class="text-2xl text-primary">⚡</span>
            <h1 class="text-xl font-bold">RiTerm</h1>
          </div>
        </div>
        <div class="navbar-end">
          <button
            class="btn btn-ghost btn-square"
            onClick={props.onShowSettings}
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div class="hero min-h-screen bg-base-200">
        <div class="hero-content text-center">
          <div class="max-w-2xl">
            {/* Connection Section */}
            <div class="card bg-base-100 shadow-xl mb-8">
              <div class="card-body">
                <h2 class="card-title justify-center text-2xl">
                  {t("connection.title")} 🖥️
                </h2>
                <p class="text-sm opacity-70 mb-6">
                  Enter session ticket to connect to remote terminal
                </p>

                <div class="form-control w-full">
                  <input
                    type="text"
                    placeholder={t("connection.ticket.placeholder")}
                    class="input input-bordered w-full"
                    value={props.sessionTicket}
                    onInput={(e) => props.onTicketInput(e.currentTarget.value)}
                  />
                </div>

                <div class="card-actions justify-center mt-4">
                  <button
                    class={`btn btn-primary btn-lg ${
                      props.connecting ? "loading" : ""
                    }`}
                    onClick={() => props.onConnect()}
                    disabled={!props.sessionTicket.trim() || props.connecting}
                  >
                    {props.connecting ? "Connecting..." : "Connect 🚀"}
                  </button>
                </div>

                {props.connectionError && (
                  <div class="alert alert-error mt-4">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="stroke-current shrink-0 h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>{props.connectionError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Connection History */}
            <Show when={props.history.length > 0}>
              <div class="card bg-base-100 shadow-xl mb-8">
                <div class="card-body">
                  <h2 class="card-title">Recent Connections 📝</h2>
                  <div class="max-h-40 overflow-y-auto">
                    <For each={props.history.slice(0, 5)}>
                      {(entry) => (
                        <div class="flex items-center justify-between p-3 hover:bg-base-200 rounded-lg transition-colors">
                          <div class="flex-1 min-w-0">
                            <div class="font-mono text-sm truncate font-semibold">
                              {entry.title}
                            </div>
                            <div class="text-xs opacity-70 font-mono">
                              {entry.ticket.substring(0, 20)}...
                            </div>
                          </div>
                          <div class="flex items-center space-x-2">
                            <div
                              class={`badge badge-sm ${
                                entry.status === "Completed"
                                  ? "badge-success"
                                  : entry.status === "Failed"
                                    ? "badge-error"
                                    : "badge-warning"
                              }`}
                            >
                              {entry.status}
                            </div>
                            <button
                              class="btn btn-ghost btn-xs"
                              onClick={() => handleQuickConnect(entry.ticket)}
                            >
                              Connect
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </Show>

            {/* Features Grid */}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="card bg-base-100 shadow-xl">
                <div class="card-body">
                  <h2 class="card-title">
                    <span class="text-primary">🌐</span>
                    P2P Network
                  </h2>
                  <p class="text-sm opacity-80">
                    Direct peer-to-peer terminal connections without central
                    servers
                  </p>
                </div>
              </div>

              <div class="card bg-base-100 shadow-xl">
                <div class="card-body">
                  <h2 class="card-title">
                    <span class="text-primary">🔐</span>
                    Secure Shell
                  </h2>
                  <p class="text-sm opacity-80">
                    End-to-end encrypted terminal sessions with full shell
                    support
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer class="footer footer-center p-4 bg-base-300 text-base-content">
        <div>
          <p class="text-xs font-mono opacity-70">
            RiTerm v1.0 - P2P Terminal Client
          </p>
        </div>
      </footer>
    </div>
  );

  return (
    <div class="font-mono">
      <Show when={viewMode() === "login"} fallback={renderMainScreen()}>
        {renderLoginScreen()}
      </Show>
    </div>
  );
}

