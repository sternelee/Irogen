/**
 * AppLayout Component
 *
 * Main application layout integrating SessionSidebar and ChatView
 * for multi-session AI agent management.
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
import { sessionStore } from "../stores/sessionStore";
import { isMobile } from "../stores/deviceStore";
import { notificationStore } from "../stores/notificationStore";
import { Button } from "./ui/primitives";
import { KeyboardShortcutsDialog } from "./ui/KeyboardShortcuts";
import { SpinnerWithLabel } from "./ui/Spinner";
import { ThemeSwitcher } from "./ui/ThemeSwitcher";
import { FiPlus, FiFolder, FiGitBranch, FiX } from "solid-icons/fi";

// ============================================================================
// Icons
// ============================================================================

const MenuIcon: Component = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="w-6 h-6"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <title>Menu</title>
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M4 6h16M4 12h16M4 18h16"
    />
  </svg>
);

// ============================================================================
// Main Layout Component
// ============================================================================

export const AppLayout: Component = () => {
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = createSignal(false);
  const [rightPanelView, setRightPanelView] = createSignal<
    "none" | "file" | "git"
  >("none");
  const [rightPanelTouchStartX, setRightPanelTouchStartX] = createSignal<
    number | null
  >(null);

  // Toggle functions for right panel
  const toggleRightPanel = (view: "file" | "git") => {
    setRightPanelView((prev) => (prev === view ? "none" : view));
  };
  const closeRightPanel = () => setRightPanelView("none");
  const mobile = createMemo(() => isMobile());

  createEffect(() => {
    const shouldLockScroll =
      mobile() && (sidebarOpen() || rightPanelView() !== "none");
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

      // Press 'b' to toggle sidebar
      if (e.key === "b" || e.key === "B") {
        setSidebarOpen((prev) => !prev);
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

  return (
    <div class="flex min-h-0 h-[var(--effective-viewport-height,100vh)] bg-muted overflow-hidden max-md:text-sm max-md:leading-5">
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen()}
        onClose={() => setShortcutsDialogOpen(false)}
      />
      <Show when={sessionStore.state.isHistoryLoading}>
        <div class="fixed inset-0 z-[60px] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="rounded-2xl bg-card/90 border border-border/60 px-6 py-5 shadow-2xl">
            <SpinnerWithLabel
              label="Loading history…"
              size="lg"
              variant="primary"
            />
          </div>
        </div>
      </Show>
      {/* Mobile Menu Button */}
      <Button
        class="fixed left-3 top-2 z-50 flex h-11 w-11 rounded-xl bg-card/95 shadow-md lg:hidden fixed-top-safe"
        size="icon"
        variant="ghost"
        onClick={() => setSidebarOpen(!sidebarOpen())}
        title="Open sessions"
      >
        <MenuIcon />
      </Button>
      {/* Sidebar */}
      <SessionSidebar
        isOpen={sidebarOpen()}
        onToggle={() => setSidebarOpen(!sidebarOpen())}
      />
      {/* Main Content */}
      <main class="flex-1 flex min-h-0 flex-col min-w-0 lg:ml-0">
        <Show
          when={activeSession()}
          fallback={
            <div class="flex-1 flex items-center justify-center p-8">
              {/* Theme Switcher - Top Right */}
              <div class="fixed top-4 right-4 fixed-top-safe">
                <ThemeSwitcher />
              </div>

              <div class="text-center max-w-lg">
                {/* Logo */}
                <div class="w-20 h-20 mx-auto mb-6 rounded-3xl flex items-center justify-center shadow-2xl shadow-primary/30">
                  <img
                    src="/clawdpilot-icon.svg"
                    alt="ClawdPilot logo"
                    class="h-20 w-20 rounded-2xl object-cover"
                  />
                </div>
                <h2 class="text-3xl font-bold mb-3 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Welcome to ClawdPilot
                </h2>
                <p class="text-muted-foreground/70 mb-8 max-w-xs mx-auto leading-relaxed">
                  Manage multiple AI agent sessions in one place. Create a new
                  session to get started.
                </p>
                <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button
                    variant="default"
                    size="lg"
                    class="px-6 h-12 text-sm font-medium bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-xl shadow-primary/20"
                    onClick={() => sessionStore.openNewSessionModal("local")}
                  >
                    <FiPlus size={18} class="mr-2" />
                    Create Session
                  </Button>
                </div>
                {/* Features */}
                <div class="grid grid-cols-3 gap-4 mt-12 text-left">
                  <div class="p-3 rounded-xl bg-muted/50 border border-border/50">
                    <div class="text-lg mb-1">🤖</div>
                    <div class="text-xs font-medium">AI Agents</div>
                    <div class="text-[10px] text-muted-foreground/60">
                      Claude, Codex & more
                    </div>
                  </div>
                  <div class="p-3 rounded-xl bg-muted/50 border border-border/50">
                    <div class="text-lg mb-1">🔒</div>
                    <div class="text-xs font-medium">P2P Secure</div>
                    <div class="text-[10px] text-muted-foreground/60">
                      End-to-end encrypted
                    </div>
                  </div>
                  <div class="p-3 rounded-xl bg-muted/50 border border-border/50">
                    <div class="text-lg mb-1">💬</div>
                    <div class="text-xs font-medium">Agent</div>
                    <div class="text-[10px] text-muted-foreground/60">
                      Real-time sharing
                    </div>
                  </div>
                </div>
              </div>
            </div>
          }
        >
          {(session) => {
            // session is already the AgentSessionMetadata object
            return (
              <>
                <ChatView
                  sessionId={session().sessionId}
                  agentType={session().agentType}
                  projectPath={session().projectPath}
                  sessionMode={session().mode}
                  onSendMessage={handleSendMessage}
                  rightPanelView={rightPanelView()}
                  onToggleFileBrowser={() => toggleRightPanel("file")}
                  onToggleGitPanel={() => toggleRightPanel("git")}
                />
                {/* Right Panel - File Browser / Git Changes */}
                <Show when={rightPanelView() !== "none"}>
                  <button
                    type="button"
                    class="fixed inset-0 bg-black/50 z-40 lg:hidden w-full h-full border-none cursor-default"
                    onClick={closeRightPanel}
                    aria-label="Close tools panel"
                  />
                </Show>
                <aside
                  onTouchStart={(e) => {
                    if (!mobile() || e.touches.length !== 1) return;
                    setRightPanelTouchStartX(e.touches[0].clientX);
                  }}
                  onTouchEnd={(e) => {
                    const startX = rightPanelTouchStartX();
                    setRightPanelTouchStartX(null);
                    if (!mobile() || startX === null) return;
                    const endX = e.changedTouches[0]?.clientX ?? startX;
                    if (endX - startX > 70) {
                      closeRightPanel();
                    }
                  }}
                  class={`fixed right-0 inset-y-0 z-50 w-screen sm:w-[28rem] md:w-[340px] lg:w-[360px] border-l border-border/60 bg-gradient-to-b from-background to-base-200/50 backdrop-blur-md flex flex-col overflow-hidden shadow-2xl shadow-black/20
                    transform transition-transform duration-300 ease-in-out
                    ${rightPanelView() !== "none" ? "translate-x-0" : "translate-x-full"}
                    ${mobile() ? "pt-safe pb-safe" : ""}
                  `}
                >
                  <div class="h-11 px-3 border-b border-border/60 flex items-center justify-between">
                    <div class="text-sm font-medium flex items-center gap-2">
                      <Show
                        when={rightPanelView() === "file"}
                        fallback={<FiGitBranch size={14} />}
                      >
                        <FiFolder size={14} />
                      </Show>
                      <span>
                        {rightPanelView() === "file" ? "File Browser" : "Git Changes"}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      class="btn btn-ghost btn-xs btn-square h-9 w-9"
                      onClick={closeRightPanel}
                      title="Close panel"
                    >
                      <FiX size={12} />
                    </Button>
                  </div>
                  <div class="flex-1 overflow-auto scrollbar-thin">
                    <Show when={rightPanelView() === "file"}>
                      <FileBrowserView
                        class="h-full"
                        projectPath={session()?.projectPath}
                      />
                    </Show>
                    <Show when={rightPanelView() === "git"}>
                      <GitDiffView
                        class="h-full"
                        projectPath={session()?.projectPath}
                      />
                    </Show>
                  </div>
                </aside>
              </>
            );
          }}
        </Show>
      </main>
    </div>
  );
};

export default AppLayout;
