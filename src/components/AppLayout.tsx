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
import { WorkspaceShell } from "./WorkspaceShell";
import { SessionsView } from "./SessionsView";
import { DevicesView } from "./DevicesView";
import { SettingsView } from "./SettingsView";
import { HomeView } from "./HomeView";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import { i18nStore } from "../stores/i18nStore";
import { isMobile } from "../stores/deviceStore";
import { KeyboardShortcutsDialog } from "./ui/KeyboardShortcuts";
import { SpinnerWithLabel } from "./ui/Spinner";

// ============================================================================
// Main Layout Component
// ============================================================================

export const AppLayout: Component = () => {
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = createSignal(false);
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

  const renderMainContent = () => {
    switch (activeView()) {
      case "settings":
        return <SettingsView />;
      case "devices":
      case "hosts":
      case "proxies":
        return <DevicesView />;
      case "sessions":
        return <SessionsView />;
      case "workspace":
      case "chat":
        return <WorkspaceShell />;
      case "home":
      case "dashboard":
      default:
        return <HomeView />;
    }
  };

  return (
    <div class="app-root flex h-full max-sm:text-sm max-sm:leading-5 bg-background">
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen()}
        onClose={() => setShortcutsDialogOpen(false)}
      />

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
