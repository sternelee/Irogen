/**
 * AppLayout Component
 *
 * Main application layout integrating SessionSidebar and ChatView
 * for multi-session AI agent management.
 * UI refactored to match OpenChamber's clean, modern design language.
 */

import {
  createSignal,
  createEffect,
  createMemo,
  Show,
  onMount,
  onCleanup,
  type Component,
} from "solid-js";
import { SessionSidebar } from "./SessionSidebar";
import { ChatView } from "./ChatView";
import { FileBrowserView } from "./FileBrowserView";
import { GitDiffView } from "./GitDiffView";
import { SetupGuide } from "./mobile/SetupGuide";
import { ConnectView } from "./mobile/ConnectView";
import { Dashboard } from "./Dashboard";
import { SettingsView } from "./SettingsView";
import { ConnectHostModal } from "./ConnectHostModal";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import { i18nStore } from "../stores/i18nStore";
import { isMobile } from "../stores/deviceStore";
import { notificationStore } from "../stores/notificationStore";
import { KeyboardShortcutsDialog } from "./ui/KeyboardShortcuts";
import { SpinnerWithLabel } from "./ui/Spinner";
import { FiFolder, FiGitBranch, FiX, FiPlus, FiServer, FiMessageSquare } from "solid-icons/fi";

// ============================================================================
// Main Layout Component
// ============================================================================

export const AppLayout: Component = () => {
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = createSignal(false);
  const [showSetupGuide, setShowSetupGuide] = createSignal(false);
  const [showConnectModal, setShowConnectModal] = createSignal(false);
  const [rightPanelView, setRightPanelView] = createSignal<
    "none" | "file" | "git"
  >("none");

  // Toggle functions for right panel
  const toggleRightPanel = (view: "file" | "git") => {
    setRightPanelView((prev) => (prev === view ? "none" : view));
  };
  const closeRightPanel = () => setRightPanelView("none");

  createEffect(() => {
    const shouldLockScroll =
      navigationStore.state.sidebarOpen || rightPanelView() !== "none";
    document.body.style.overflow = shouldLockScroll ? "hidden" : "";
  });

  onCleanup(() => {
    document.body.style.overflow = "";
  });

  // Keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Press 'b' to toggle sidebar (desktop only)
      if ((e.key === "b" || e.key === "B") && !isMobile()) {
        navigationStore.toggleSidebar();
      }

      // Press ? to show keyboard shortcuts
      if (e.key === "?") {
        setShortcutsDialogOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // Use createMemo to make activeSession reactive
  const activeSession = createMemo(() => sessionStore.getActiveSession());

  // Navigation state
  const activeView = createMemo(() => navigationStore.state.activeView);

  // Auto-expand sidebar on desktop (md and above)
  createEffect(() => {
    if (window.innerWidth >= 768 && !navigationStore.state.sidebarOpen) {
      navigationStore.setSidebarOpen(true);
    }
  });

  createEffect(() => {
    if (activeView() !== "chat" || !activeSession()) {
      closeRightPanel();
    }
  });

  // Debug logging
  createEffect(() => {
    const session = activeSession();
    console.log(
      "[AppLayout] activeSession changed:",
      session?.sessionId,
      "projectPath:",
      session?.projectPath,
      "agentType:",
      session?.agentType,
      "mode:",
      session?.mode,
    );
  });

  const handleSendMessage = (message: string) => {
    const session = activeSession();
    if (!session) {
      notificationStore.error("No active session", "Error");
      return;
    }

    // For local sessions, send to local agent backend
    if (session?.mode === "local") {
      console.log(
        "Sending message to local session:",
        session.sessionId,
        message,
      );
      // Local agent message is handled directly in ChatView
    } else {
      // For remote sessions, notify via callback
      console.log(
        "Sending message to remote session:",
        session.sessionId,
        message,
      );
    }
  };

  const handleConnectWithTicket = async (ticket: string) => {
    if (!ticket) {
      setShowConnectModal(true);
      return;
    }
    sessionStore.setSessionTicket(ticket);
    sessionStore.setConnectionError(null);
    try {
      await sessionStore.handleRemoteConnect();
      notificationStore.success("Connected to host", "Success");
      sessionStore.openNewSessionModal();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      notificationStore.error(`Connection failed: ${msg}`, "Error");
    }
  };

  const handleScanQRForConnect = async () => {
    try {
      const { checkPermissions, Format, requestPermissions, scan } =
        await import("@tauri-apps/plugin-barcode-scanner");
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== "granted") {
        permissionStatus = await requestPermissions();
      }
      if (permissionStatus !== "granted") {
        notificationStore.error(
          "Camera permission is required to scan QR codes",
          "Scan Error",
        );
        return;
      }
      const result = await scan({ formats: [Format.QRCode] });
      if (result?.content) {
        await handleConnectWithTicket(result.content);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      notificationStore.error(`Scan failed: ${msg}`, "Scan Error");
    }
  };

  const renderChatEmptyState = () => (
    <div class="flex flex-col h-full min-h-0 flex-1 overflow-hidden bg-background">
      {/* Empty State Header */}
      <header class="z-20 flex min-h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-md sm:min-h-16 sm:px-6">
        <button
          type="button"
          class="btn btn-square btn-ghost h-10 w-10 rounded-xl md:hidden"
          onClick={() => navigationStore.setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg
            width="20"
            height="20"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="inline-block h-5 w-5 stroke-current"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            ></path>
          </svg>
        </button>
        <h1 class="text-lg font-semibold tracking-tight text-foreground">
          Chat
        </h1>
      </header>
      <div class="flex flex-1 items-center justify-center p-6">
        <div class="flex flex-col items-center text-center gap-5 max-w-xs">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
            <FiMessageSquare size={28} class="text-primary/60" />
          </div>
          <div>
            <p class="text-base font-semibold text-foreground">
              No active session
            </p>
            <p class="mt-1 text-sm text-muted-foreground/70">
              Start a new session or connect to a remote host
            </p>
          </div>
          <div class="flex flex-col gap-2 w-full">
            <button
              type="button"
              class="btn btn-primary btn-sm rounded-xl w-full gap-2"
              onClick={() => sessionStore.openNewSessionModal()}
            >
              <FiPlus size={15} />
              New Session
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm rounded-xl w-full gap-2"
              onClick={() => navigationStore.setActiveView("hosts")}
            >
              <FiServer size={15} />
              Connect to Host
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderChatWorkspace = () => (
    <Show when={activeSession()} fallback={renderChatEmptyState()}>
      {(session) => (
        <>
          <ChatView
            sessionId={session().sessionId}
            agentType={session().agentType}
            projectPath={session().projectPath}
            sessionMode={session().mode}
            sidebarOpen={navigationStore.state.sidebarOpen}
            onSendMessage={handleSendMessage}
            onToggleSidebar={() => navigationStore.setSidebarOpen(true)}
            rightPanelView={rightPanelView()}
            onToggleFileBrowser={() => toggleRightPanel("file")}
            onToggleGitPanel={() => toggleRightPanel("git")}
          />
          {/* Right Panel - File Browser / Git Changes */}
          <Show when={rightPanelView() !== "none"}>
            <button
              type="button"
              class="fixed inset-0 z-40 h-full w-full cursor-default border-none bg-black/40 backdrop-blur-sm"
              onClick={closeRightPanel}
              aria-label="Close tools panel"
            />
          </Show>
          <aside
            class={`fixed bottom-0 left-0 right-0 z-50 h-[min(86dvh,42rem)] rounded-t-2xl border-t border-border/50 bg-base-200 shadow-2xl
              flex flex-col overflow-hidden pb-safe sm:top-0 sm:bottom-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-80 md:w-96 lg:w-md
              transform transition-transform duration-300 ease-out
              ${rightPanelView() !== "none" ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"}
            `}
          >
            {/* Mobile handle */}
            <div class="flex justify-center py-2.5 sm:hidden">
              <div class="h-1 w-8 rounded-full bg-muted-foreground/20" />
            </div>
            {/* Panel header */}
            <div class="flex h-12 items-center justify-between border-b border-border/50 bg-muted/30 px-4 sm:h-13">
              <div class="flex items-center gap-2 text-sm font-semibold">
                <Show
                  when={rightPanelView() === "file"}
                  fallback={<FiGitBranch size={16} class="text-primary" />}
                >
                  <FiFolder size={16} class="text-primary" />
                </Show>
                <span class="tracking-tight">
                  {rightPanelView() === "file" ? "Files" : "Git"}
                </span>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square h-8 w-8 rounded-lg"
                onClick={closeRightPanel}
                title="Close panel"
              >
                <FiX size={16} />
              </button>
            </div>
            <div class="flex-1 overflow-auto">
              <Show when={rightPanelView() === "file"}>
                <FileBrowserView
                  class="h-full"
                  projectPath={session()?.projectPath}
                  sessionMode={session()?.mode}
                  controlSessionId={session()?.controlSessionId}
                />
              </Show>
              <Show when={rightPanelView() === "git"}>
                <GitDiffView
                  class="h-full"
                  projectPath={session()?.projectPath}
                  sessionMode={session()?.mode}
                  controlSessionId={session()?.controlSessionId}
                />
              </Show>
            </div>
          </aside>
        </>
      )}
    </Show>
  );

  const renderMainContent = () => {
    switch (activeView()) {
      case "settings":
        return <SettingsView />;
      case "hosts":
        return (
          <>
            <ConnectView
              onConnect={handleConnectWithTicket}
              onOpenGuide={() => setShowSetupGuide(true)}
              onOpenSettings={() => navigationStore.setActiveView("settings")}
              onScanQR={handleScanQRForConnect}
              onToggleSidebar={() => navigationStore.setSidebarOpen(true)}
              isConnecting={
                sessionStore.state.isConnecting ||
                sessionStore.state.connectionState === "connecting"
              }
            />
            <ConnectHostModal
              isOpen={showConnectModal()}
              onClose={() => setShowConnectModal(false)}
            />
          </>
        );
      case "proxies":
        return <Dashboard view="proxies" />;
      case "chat":
        return renderChatWorkspace();
      case "dashboard":
      default:
        return <Dashboard view="topology" />;
    }
  };

  return (
    <div class="app-root flex h-full max-sm:text-sm max-sm:leading-5 bg-background">
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen()}
        onClose={() => setShortcutsDialogOpen(false)}
      />

      {/* Setup Guide - Full Screen Overlay */}
      <Show when={showSetupGuide()}>
        <div class="fixed inset-0 z-70 bg-background pb-safe">
          <SetupGuide
            onClose={() => setShowSetupGuide(false)}
            onSkip={() => setShowSetupGuide(false)}
          />
        </div>
      </Show>

      {/* History loading overlay */}
      <Show when={sessionStore.state.isHistoryLoading}>
        <div class="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div class="rounded-2xl bg-background/90 border border-border/50 px-6 py-5 shadow-2xl">
            <SpinnerWithLabel
              text={i18nStore.t("common.loadingHistory")}
              size="lg"
              variant="primary"
            />
          </div>
        </div>
      </Show>

      {/* Mobile overlay backdrop - hidden on desktop (md+) */}
      <button
        type="button"
        class={`fixed inset-0 z-40 h-full w-full cursor-default border-none bg-black/50 backdrop-blur-sm transition-all duration-300 md:hidden ${
          navigationStore.state.sidebarOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => navigationStore.setSidebarOpen(false)}
        aria-label="Close sidebar"
      />

      {/* Session Sidebar */}
      {/* Mobile: fixed overlay, slides in from left. Desktop (md+): always visible inline */}
      <div
        class={`flex-shrink-0 transition-all duration-300 ease-out md:relative md:inset-auto md:z-auto md:w-64 lg:w-68 md:shadow-none md:border-0
          fixed inset-y-0 left-0 z-50 w-[85vw] max-w-80 shadow-2xl
          ${navigationStore.state.sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        }`}
      >
        <SessionSidebar
          isOpen={navigationStore.state.sidebarOpen}
          onToggle={() => navigationStore.toggleSidebar()}
        />
      </div>

      {/* Main Content */}
      <div class="flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
        {/* Main Content Area */}
        <main class="flex-1 flex min-h-0 flex-col min-w-0">
          {renderMainContent()}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
