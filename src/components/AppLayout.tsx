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
import { sessionStore } from "../stores/sessionStore";
import { i18nStore } from "../stores/i18nStore";
import { isMobile } from "../stores/deviceStore";
import { notificationStore } from "../stores/notificationStore";
import { Button } from "./ui/primitives";
import { KeyboardShortcutsDialog } from "./ui/KeyboardShortcuts";
import { SpinnerWithLabel } from "./ui/Spinner";
import { LanguageSwitcher, ThemeSwitcher } from "./ui/ThemeSwitcher";
import { FiPlus, FiFolder, FiGitBranch, FiX } from "solid-icons/fi";
import { HelpCircle } from "lucide-solid";

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
  const [showSetupGuide, setShowSetupGuide] = createSignal(false);
  const [rightPanelView, setRightPanelView] = createSignal<
    "none" | "file" | "git"
  >("none");
  const [rightPanelTouchStartY, setRightPanelTouchStartY] = createSignal<
    number | null
  >(null);

  // Toggle functions for right panel
  const toggleRightPanel = (view: "file" | "git") => {
    setRightPanelView((prev) => (prev === view ? "none" : view));
  };
  const closeRightPanel = () => setRightPanelView("none");
  const mobile = createMemo(() => isMobile());

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
            <div class="flex-1 overflow-y-auto bg-base-100">
              {/* Mobile Menu Button - Integrated for fallback view */}
              <Button
                class={`fixed left-4 top-4 z-50 h-12 w-12 rounded-2xl bg-base-200 shadow-lg border border-base-content/5 fixed-top-safe active:scale-95 transition-transform lg:hidden ${sidebarOpen() ? "hidden" : ""}`}
                size="icon"
                variant="ghost"
                onClick={() => setSidebarOpen(true)}
              >
                <MenuIcon />
              </Button>

              {/* Theme Switcher - Top Right */}
              <div class="fixed top-4 right-4 fixed-top-safe flex items-center gap-2">
                <LanguageSwitcher />
                <ThemeSwitcher />
              </div>

              <div class="flex min-h-full items-start justify-center p-6 pt-24 pb-10 sm:items-center sm:p-8">
                <div class="text-center max-w-lg w-full">
                  {/* Logo */}
                  <div class="w-20 h-20 mx-auto mb-6 rounded-3xl flex items-center justify-center shadow-2xl shadow-primary/30 bg-base-200">
                    <img
                      src="/irogen-icon.svg"
                      alt="Irogen logo"
                      class="h-20 w-20 rounded-2xl object-cover"
                    />
                  </div>
                  <h2 class="text-3xl font-bold mb-3 bg-linear-to-r from-base-content to-base-content/70 bg-clip-text text-transparent">
                    {i18nStore.t("home.welcomeTitle")}
                  </h2>
                  <p class="text-base-content/60 mb-8 max-w-xs mx-auto leading-relaxed">
                    {i18nStore.t("home.welcomeDescription")}
                  </p>
                  <div class="flex flex-col items-center justify-center gap-3">
                    <Button
                      variant="default"
                      size="lg"
                      class="px-8 h-12 rounded-2xl bg-primary text-sm font-bold text-primary-content shadow-xl shadow-base-content/10 hover:bg-primary/90"
                      onClick={() => sessionStore.openNewSessionModal("local")}
                    >
                      <FiPlus size={18} class="mr-2" />
                      {i18nStore.t("home.createSession")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="text-base-content/50 hover:text-base-content"
                      onClick={() => setShowSetupGuide(true)}
                    >
                      <HelpCircle size={16} class="mr-1.5" />
                      {i18nStore.t("home.setupGuide")}
                    </Button>
                  </div>
                  {/* Features */}
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12 text-left px-4 w-full">
                    <div class="flex items-center gap-3 sm:block p-4 rounded-2xl bg-base-200 border border-base-content/5 shadow-sm">
                      <div class="text-xl shrink-0 sm:mb-1.5 text-center">
                        🤖
                      </div>
                      <div class="min-w-0">
                        <div class="text-xs font-bold text-left sm:text-center">
                          {i18nStore.t("home.features.aiAgentsTitle")}
                        </div>
                        <div class="text-[10px] opacity-50 text-left sm:text-center">
                          {i18nStore.t("home.features.aiAgentsDesc")}
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-3 sm:block p-4 rounded-2xl bg-base-200 border border-base-content/5 shadow-sm">
                      <div class="text-xl shrink-0 sm:mb-1.5 text-center">
                        🔒
                      </div>
                      <div class="min-w-0">
                        <div class="text-xs font-bold text-left sm:text-center">
                          {i18nStore.t("home.features.secureTitle")}
                        </div>
                        <div class="text-[10px] opacity-50 text-left sm:text-center">
                          {i18nStore.t("home.features.secureDesc")}
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-3 sm:block p-4 rounded-2xl bg-base-200 border border-base-content/5 shadow-sm">
                      <div class="text-xl shrink-0 sm:mb-1.5 text-center">
                        💬
                      </div>
                      <div class="min-w-0">
                        <div class="text-xs font-bold text-left sm:text-center">
                          {i18nStore.t("home.features.agentTitle")}
                        </div>
                        <div class="text-[10px] opacity-50 text-left sm:text-center">
                          {i18nStore.t("home.features.agentDesc")}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          }
        >
          {(session) => {
            return (
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
                    class="fixed inset-0 bg-black/60 z-40 lg:hidden w-full h-full border-none cursor-default backdrop-blur-sm"
                    onClick={closeRightPanel}
                    aria-label="Close tools panel"
                  />
                </Show>
                <aside
                  onTouchStart={(e) => {
                    if (!mobile() || e.touches.length !== 1) return;
                    setRightPanelTouchStartY(e.touches[0].clientY);
                  }}
                  onTouchEnd={(e) => {
                    const startY = rightPanelTouchStartY();
                    setRightPanelTouchStartY(null);
                    if (!mobile() || startY === null) return;
                    const endY = e.changedTouches[0]?.clientY ?? startY;
                    if (endY - startY > 70) {
                      closeRightPanel();
                    }
                  }}
                  class={`fixed bottom-0 left-0 right-0 z-50 h-[min(86dvh,42rem)] sm:h-full rounded-t-3xl border-t border-base-content/10 bg-base-100 flex flex-col overflow-hidden shadow-2xl
                    pb-safe sm:top-0 sm:bottom-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-md sm:rounded-none sm:border-l sm:border-t-0 sm:pt-0 sm:pb-0 md:w-85 lg:w-90
                    transform transition-transform duration-300 ease-in-out
                    ${rightPanelView() !== "none" ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"}
                  `}
                >
                  <div class="flex justify-center py-3 sm:hidden">
                    <div class="h-1 w-10 rounded-full bg-base-content/20" />
                  </div>
                  <div class="compact-mobile-controls h-12 px-3 sm:h-14 sm:px-4 border-b border-base-content/10 flex items-center justify-between bg-base-200/50">
                    <div class="text-xs sm:text-sm font-bold flex items-center gap-1.5 sm:gap-2">
                      <Show
                        when={rightPanelView() === "file"}
                        fallback={
                          <FiGitBranch
                            size={14}
                            class="text-primary sm:size-4"
                          />
                        }
                      >
                        <FiFolder size={14} class="text-primary sm:size-4" />
                      </Show>
                      <span class="tracking-tight">
                        {rightPanelView() === "file"
                          ? "File Browser"
                          : "Git Changes"}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs sm:btn-sm btn-square h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl"
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
            );
          }}
        </Show>
      </main>
    </div>
  );
};

export default AppLayout;
