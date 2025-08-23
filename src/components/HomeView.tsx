import { createSignal, Show, For } from "solid-js";
import { settingsStore, t } from "../stores/settingsStore";
import {
  ModernCard,
  ModernButton,
  ModernInput,
  TypingAnimation,
} from "./ui/CyberEffects";
import { HistoryEntry } from "../hooks/useConnectionHistory";
import { ConnectionInterface } from "./ConnectionInterface";
import { SessionManagement } from "./SessionManagement";
import { EnhancedCard, EnhancedButton } from "./ui/EnhancedComponents";

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
  const [viewMode, setViewMode] = createSignal<
    "login" | "guest" | "main" | "sessions"
  >("login");
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");

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

  const handleShowDetails = (entry: HistoryEntry) => {
    // TODO: Implement session details modal
    console.log("Show details for:", entry);
  };

  const handleExportHistory = () => {
    // TODO: Implement history export
    console.log("Export history");
  };

  const handleImportHistory = () => {
    // TODO: Implement history import
    console.log("Import history");
  };

  const renderLoginScreen = () => (
    <div class="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        {/* Logo Section */}
        <div class="text-center mb-8">
          <div class="text-6xl text-primary mb-4 animate-bounce">⚡</div>
          <h1 class="text-4xl font-bold mb-2">
            <TypingAnimation text="RiTerm" speed={100} />
          </h1>
          <p class="text-sm opacity-70 font-mono">{t("app.title")}</p>
        </div>

        {/* Login Card */}
        <EnhancedCard variant="default" class="backdrop-blur-sm">
          <div class="space-y-4">
            <div class="text-center mb-6">
              <h2 class="text-xl font-semibold mb-2">Welcome Back</h2>
              <p class="text-sm opacity-70">
                Sign in to access your P2P terminal sessions
              </p>
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Username</span>
              </label>
              <input
                type="text"
                placeholder="Enter your username"
                class="input input-bordered w-full"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
              />
            </div>

            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">Password</span>
              </label>
              <input
                type="password"
                placeholder="Enter your password"
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

            <EnhancedButton
              variant="primary"
              fullWidth
              size="lg"
              onClick={handleLogin}
              disabled={!username().trim() || !password().trim()}
              icon="🔑"
              haptic
            >
              Sign In
            </EnhancedButton>

            <div class="divider text-sm opacity-50">OR</div>

            <EnhancedButton
              variant="ghost"
              fullWidth
              onClick={handleGuestMode}
              icon="👻"
              haptic
            >
              Continue as Guest
            </EnhancedButton>

            <div class="text-center text-xs opacity-50 mt-4">
              <p>Guest mode provides limited functionality</p>
            </div>
          </div>
        </EnhancedCard>

        {/* Features Preview */}
        <div class="mt-8 grid grid-cols-2 gap-3">
          <div class="text-center p-3">
            <div class="text-2xl mb-1">🌐</div>
            <div class="text-xs opacity-70">P2P Network</div>
          </div>
          <div class="text-center p-3">
            <div class="text-2xl mb-1">🔐</div>
            <div class="text-xs opacity-70">Secure Shell</div>
          </div>
          <div class="text-center p-3">
            <div class="text-2xl mb-1">📱</div>
            <div class="text-xs opacity-70">Mobile Ready</div>
          </div>
          <div class="text-center p-3">
            <div class="text-2xl mb-1">⚡</div>
            <div class="text-xs opacity-70">Real-time Sync</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderMainScreen = () => (
    <div class="min-h-screen bg-base-200">
      {/* Header */}
      <div class="bg-base-100 shadow-sm border-b border-base-300">
        <div class="navbar px-4">
          <div class="navbar-start">
            <div class="flex items-center space-x-3">
              <span class="text-2xl text-primary">⚡</span>
              <h1 class="text-xl font-bold hidden sm:inline">RiTerm</h1>
            </div>
          </div>

          <div class="navbar-center">
            <div class="tabs tabs-boxed">
              <button
                class={`tab tab-sm ${viewMode() === "main" ? "tab-active" : ""}`}
                onClick={() => setViewMode("main")}
              >
                Connect
              </button>
              <button
                class={`tab tab-sm ${viewMode() === "sessions" ? "tab-active" : ""}`}
                onClick={() => setViewMode("sessions")}
              >
                Sessions
              </button>
            </div>
          </div>

          <div class="navbar-end">
            <EnhancedButton
              variant="ghost"
              size="sm"
              onClick={props.onShowSettings}
              icon="⚙️"
            >
              <span class="hidden sm:inline">Settings</span>
            </EnhancedButton>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div class="container mx-auto py-6">
        <Show
          when={viewMode() === "sessions"}
          fallback={
            <ConnectionInterface
              sessionTicket={props.sessionTicket}
              onTicketInput={props.onTicketInput}
              onConnect={props.onConnect}
              connecting={props.connecting}
              connectionError={props.connectionError}
              history={props.history}
              isConnected={props.isConnected}
              activeTicket={props.activeTicket}
              onReturnToSession={props.onReturnToSession}
              onDeleteHistory={props.onDeleteHistory}
              onDisconnect={props.onDisconnect}
              onQuickConnect={handleQuickConnect}
            />
          }
        >
          <SessionManagement
            history={props.history}
            activeTicket={props.activeTicket}
            isConnected={props.isConnected}
            onConnect={props.onConnect}
            onDisconnect={props.onDisconnect}
            onDeleteHistory={props.onDeleteHistory}
            onUpdateHistory={(ticket, updates) => {
              // TODO: Implement history update
              console.log("Update history:", ticket, updates);
            }}
            onReturnToSession={props.onReturnToSession}
            onShowDetails={handleShowDetails}
            onExportHistory={handleExportHistory}
            onImportHistory={handleImportHistory}
          />
        </Show>
      </div>
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
