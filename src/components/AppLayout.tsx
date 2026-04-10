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
import { SetupGuide } from "./mobile/SetupGuide";
import { Dashboard } from "./Dashboard";
import { BottomNavBar } from "./BottomNavBar";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import { i18nStore } from "../stores/i18nStore";
import { isMobile } from "../stores/deviceStore";
import { notificationStore } from "../stores/notificationStore";
import { KeyboardShortcutsDialog } from "./ui/KeyboardShortcuts";
import { SpinnerWithLabel } from "./ui/Spinner";
import { FiFolder, FiGitBranch, FiX } from "solid-icons/fi";

// ============================================================================
// Main Layout Component
// ============================================================================

export const AppLayout: Component = () => {
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = createSignal(false);
  const [showSetupGuide, setShowSetupGuide] = createSignal(false);
  const [rightPanelView, setRightPanelView] = createSignal<
    "none" | "file" | "git"
  >("none");

  // Toggle functions for right panel
  const toggleRightPanel = (view: "file" | "git") => {
    setRightPanelView((prev) => (prev === view ? "none" : view));
  };
  const closeRightPanel = () => setRightPanelView("none");

  createEffect(() => {
    const shouldLockScroll = sidebarOpen() || rightPanelView() !== "none";
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

  // Navigation state
  const activeView = createMemo(() => navigationStore.state.activeView);
  const mobile = createMemo(() => isMobile());

  // Auto-expand sidebar on desktop (md and above)
  createEffect(() => {
    if (window.innerWidth >= 768 && !sidebarOpen()) {
      setSidebarOpen(true);
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

  const renderChatEmptyState = () => (
    <div class="flex h-full min-h-0 flex-1 overflow-y-auto bg-base-100">
      <div class="flex min-h-full w-full items-center justify-center p-6">
        <div class="text-center">
          <p class="text-xl font-semibold text-base-content/60">
            No agent selected
          </p>
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
            sidebarOpen={sidebarOpen()}
            onSendMessage={handleSendMessage}
            onToggleSidebar={() => setSidebarOpen(true)}
            rightPanelView={rightPanelView()}
            onToggleFileBrowser={() => toggleRightPanel("file")}
            onToggleGitPanel={() => toggleRightPanel("git")}
          />
          {/* Right Panel - File Browser / Git Changes */}
          <Show when={rightPanelView() !== "none"}>
            <button
              type="button"
              class="fixed inset-0 z-40 h-full w-full cursor-default border-none bg-black/60 backdrop-blur-sm"
              onClick={closeRightPanel}
              aria-label="Close tools panel"
            />
          </Show>
          <aside
            class={`fixed bottom-0 left-0 right-0 z-50 h-[min(86dvh,42rem)] rounded-t-3xl border-t border-base-content/10 bg-base-100 shadow-2xl
              flex flex-col overflow-hidden pb-safe sm:top-0 sm:bottom-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-md sm:rounded-none sm:border-t-0 sm:border-l sm:pt-0 sm:pb-0 md:w-85 lg:w-90
              transform transition-transform duration-300 ease-in-out
              ${rightPanelView() !== "none" ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"}
            `}
          >
            <div class="flex justify-center py-3 sm:hidden">
              <div class="h-1 w-10 rounded-full bg-base-content/20" />
            </div>
            <div class="compact-mobile-controls flex h-12 items-center justify-between border-b border-base-content/10 bg-base-200/50 px-3 sm:h-14 sm:px-4">
              <div class="flex items-center gap-1.5 text-xs font-bold sm:gap-2 sm:text-sm">
                <Show
                  when={rightPanelView() === "file"}
                  fallback={
                    <FiGitBranch size={14} class="text-primary sm:size-4" />
                  }
                >
                  <FiFolder size={14} class="text-primary sm:size-4" />
                </Show>
                <span class="tracking-tight">
                  {rightPanelView() === "file" ? "File Browser" : "Git Changes"}
                </span>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square h-8 w-8 rounded-lg sm:btn-sm sm:h-10 sm:w-10 sm:rounded-xl"
                onClick={closeRightPanel}
                title="Close panel"
              >
                <FiX size={16} class="sm:size-4.5" />
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
      case "hosts":
        return <Dashboard view="hosts" />;
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
    <div class="app-root flex h-full bg-base-200 overflow-hidden max-md:text-sm max-md:leading-5">
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen()}
        onClose={() => setShortcutsDialogOpen(false)}
      />

      {/* Setup Guide - Full Screen Overlay */}
      <Show when={showSetupGuide()}>
        <div class="fixed inset-0 z-70 bg-base-100">
          <SetupGuide
            onClose={() => setShowSetupGuide(false)}
            onSkip={() => setShowSetupGuide(false)}
          />
        </div>
      </Show>

      <Show when={sessionStore.state.isHistoryLoading}>
        <div class="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-60">
          <div class="rounded-2xl bg-base-100/90 border border-base-content/10 px-6 py-5 shadow-2xl">
            <SpinnerWithLabel
              label={i18nStore.t("common.loadingHistory")}
              size="lg"
              variant="primary"
            />
          </div>
        </div>
      </Show>

      {/* Sidebar - Desktop Only (md and above) */}
      <div class="hidden md:block">
        <SessionSidebar
          isOpen={sidebarOpen()}
          onToggle={() => setSidebarOpen(!sidebarOpen())}
        />
      </div>

      {/* Main Content */}
      <main class="flex-1 flex min-h-0 flex-col min-w-0">
        <Show when={mobile()} fallback={renderMainContent()}>
          {/* Mobile: fixed top/content/bottom structure */}
          <div class="flex flex-1 min-h-0 flex-col overflow-hidden md:hidden">
            <div class="flex-1 min-h-0 overflow-hidden pb-[calc(3rem+env(safe-area-inset-bottom,0px))]">
              {renderMainContent()}
            </div>
          </div>
        </Show>
      </main>

      {/* Bottom Navigation Bar - Mobile Only */}
      <BottomNavBar />
    </div>
  );
};

export default AppLayout;
