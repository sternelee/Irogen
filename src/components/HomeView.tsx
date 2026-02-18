/**
 * HomeView Component
 *
 * Redesigned home screen with dual mode support:
 * - Remote Mode: Connect via P2P ticket to remote CLI
 * - Local Mode: Directly enter session management for local agents
 */

import { createSignal, Show, For, onMount } from "solid-js";
import { toast } from "solid-sonner";
import { getDeviceCapabilities } from "../utils/mobile";
import {
  getLastTicket,
  saveTicket,
  getTicketHistory,
} from "../utils/localStorage";
import { getTicketDisplayId } from "../utils/ticketParser";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardTitle } from "./ui/card";
import { Dialog } from "./ui/dialog";
import { CardActions, CardBody, Input, Spinner } from "./ui/primitives";

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
  // New: Direct entry to local mode
  onEnterLocalMode?: () => void;
}

export function HomeView(props: HomeViewProps) {
  const [showLoginModal, setShowLoginModal] = createSignal(false);
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [ticketHistory, setTicketHistory] = createSignal<string[]>([]);
  const [activeTab, setActiveTab] = createSignal<"remote" | "local">("remote");

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

  const handleEnterLocalMode = () => {
    if (props.onEnterLocalMode) {
      props.onEnterLocalMode();
    }
  };

  // Login Modal
  const renderLoginModal = () => (
    <Show when={showLoginModal()}>
      <Dialog
        open={showLoginModal()}
        onClose={() => setShowLoginModal(false)}
        contentClass="max-w-md"
      >
        <Card class="border-0 shadow-none">
          <CardBody class="p-0">
            <CardTitle class="mb-4 justify-center text-2xl">
              Account Login
            </CardTitle>

            <div class="space-y-4">
              <div class="space-y-2">
                <label for="username-input" class="text-sm font-medium">
                  Username
                </label>
                <Input
                  id="username-input"
                  type="text"
                  placeholder="Enter username"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                />
              </div>

              <div class="space-y-2">
                <label for="password-input" class="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="password-input"
                  type="password"
                  placeholder="Enter password"
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
            </div>

            <CardActions class="mt-8 justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowLoginModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleLogin}
                disabled={!username().trim() || !password().trim()}
              >
                Login
              </Button>
            </CardActions>
          </CardBody>
        </Card>
      </Dialog>
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
          <h1 class="text-4xl font-bold mb-2">ClawdChat</h1>
          <p class="text-base-content/60">Secure P2P Agent Collaboration</p>
        </div>

        {/* Tab Navigation */}
        <div class="mb-8 inline-flex rounded-xl border border-border bg-muted p-1">
          <Button
            variant={activeTab() === "remote" ? "primary" : "ghost"}
            size="lg"
            class="h-9"
            onClick={() => setActiveTab("remote")}
          >
            🌐 Remote Session
          </Button>
          <Button
            variant={activeTab() === "local" ? "primary" : "ghost"}
            size="lg"
            class="h-9"
            onClick={() => setActiveTab("local")}
          >
            💻 Local Agent
          </Button>
        </div>

        {/* Remote Mode Content */}
        <Show when={activeTab() === "remote"}>
          <Card class="w-full max-w-lg overflow-hidden shadow-xl">
            <CardBody class="p-8">
              <CardTitle class="mb-6 text-xl">
                Connect to Remote Session
              </CardTitle>

              <div class="w-full space-y-2">
                <div class="flex w-full gap-2">
                  <Input
                    type="text"
                    value={props.sessionTicket}
                    onInput={(e) => props.onTicketInput(e.currentTarget.value)}
                    placeholder="Paste session ticket here..."
                    class="h-11 flex-1 text-base"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && props.sessionTicket.trim()) {
                        handleConnect();
                      }
                    }}
                    autofocus
                    aria-label="Session Ticket"
                  />
                  <Show when={isMobile}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      class="h-11 w-11"
                      onClick={handleShowQRScanner}
                      title="Scan QR Code"
                    >
                      📷
                    </Button>
                  </Show>
                </div>
                <Show when={props.connectionError}>
                  <div class="text-sm text-error">
                    <span class="flex items-center gap-1">
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

              <CardActions class="mt-6">
                <Button
                  type="button"
                  size="lg"
                  class="w-full shadow-lg hover:shadow-xl"
                  onClick={handleConnect}
                  disabled={!props.sessionTicket.trim() || props.connecting}
                >
                  <Show
                    when={props.connecting}
                    fallback={<span>Connect Now</span>}
                  >
                    <Spinner />
                    Connecting...
                  </Show>
                </Button>
              </CardActions>
            </CardBody>

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
          </Card>
        </Show>

        {/* Local Mode Content */}
        <Show when={activeTab() === "local"}>
          <Card class="w-full max-w-lg overflow-hidden shadow-xl">
            <CardBody class="p-8 text-center">
              <div class="w-16 h-16 rounded-2xl bg-primary/10 text-primary text-3xl flex items-center justify-center mx-auto mb-4">
                💻
              </div>
              <CardTitle class="mb-2 justify-center text-xl">
                Local Agent Mode
              </CardTitle>
              <p class="text-base-content/60 mb-6">
                Manage AI agents directly on your machine without connecting to
                a remote CLI.
              </p>

              <div class="space-y-3">
                <Button
                  type="button"
                  size="lg"
                  class="w-full"
                  onClick={handleEnterLocalMode}
                >
                  Enter Session Manager
                </Button>

                <div class="relative py-1 text-center text-base-content/40">
                  <div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
                  <span class="relative bg-card px-2 text-sm">or</span>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  class="w-full"
                  onClick={() => setActiveTab("remote")}
                >
                  Connect to Remote CLI
                </Button>
              </div>

              <div class="mt-6 p-4 bg-base-200 rounded-lg text-left">
                <h4 class="font-semibold text-sm mb-2">Supported Agents:</h4>
                <div class="flex flex-wrap gap-2">
                  <Badge variant="primary">Claude Code</Badge>
                  <Badge variant="secondary">Gemini CLI</Badge>
                  <Badge>OpenCode</Badge>
                  <Badge variant="neutral">GitHub Copilot</Badge>
                </div>
              </div>
            </CardBody>
          </Card>
        </Show>

        {/* Footer */}
        <div class="mt-12 text-center text-sm text-base-content/40">
          <p>Powered by Tauri v2 & SolidJS</p>
        </div>
      </div>

      {renderLoginModal()}
    </div>
  );
}
