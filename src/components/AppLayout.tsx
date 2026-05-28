/**
 * AppLayout Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
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
import { cn } from "~/lib/utils";

// ============================================================================
// Main Layout Component
// ============================================================================

export const AppLayout: Component = () => {
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = createSignal(false);

  // Keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if ((e.key === "b" || e.key === "B") && !isMobile()) {
        navigationStore.toggleSidebar();
      }
      if (e.key === "?") {
        setShortcutsDialogOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const activeView = createMemo(() => navigationStore.state.activeView);

  // Auto-expand sidebar on desktop
  createEffect(() => {
    if (window.innerWidth >= 768 && !navigationStore.state.sidebarOpen) {
      navigationStore.setSidebarOpen(true);
    }
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
    <div class="flex h-full bg-background">
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen()}
        onClose={() => setShortcutsDialogOpen(false)}
      />

      {/* History loading overlay */}
      <Show when={sessionStore.state.isHistoryLoading}>
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div class="bg-background border border-black/10 px-6 py-4">
            <SpinnerWithLabel text={i18nStore.t("common.loadingHistory")} size="lg" variant="primary" />
          </div>
        </div>
      </Show>

      {/* Mobile backdrop */}
      <Show when={navigationStore.state.sidebarOpen && isMobile()}>
        <button
          type="button"
          class="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => navigationStore.setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      </Show>

      {/* Sidebar */}
      <div
        class={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] md:relative md:z-auto md:w-64 lg:w-64",
          "transform transition-transform duration-200 md:translate-x-0",
          navigationStore.state.sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        style={{ "padding-top": "env(safe-area-inset-top, 0px)" }}
      >
        <SessionSidebar
          isOpen={navigationStore.state.sidebarOpen}
          onToggle={() => navigationStore.toggleSidebar()}
        />
      </div>

      {/* Main Content */}
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <main class="flex-1 flex min-h-0 flex-col min-w-0">
          {renderMainContent()}
        </main>
      </div>
    </div>
  );
};