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
  Switch,
  Match,
  For,
  onMount,
  onCleanup,
  type Component,
} from "solid-js";
import { FiHome, FiMessageSquare, FiMonitor, FiSettings } from "solid-icons/fi";
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
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

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

  return (
    <div class="flex h-full bg-base-100">
      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen()}
        onClose={() => setShortcutsDialogOpen(false)}
      />

      {/* History loading overlay */}
      <Show when={sessionStore.state.isHistoryLoading}>
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-base-content/60">
          <div class="bg-base-100 border border-base-content/10 px-6 py-4">
            <SpinnerWithLabel text={i18nStore.t("common.loadingHistory")} size="lg" variant="primary" />
          </div>
        </div>
      </Show>

      {/* Mobile backdrop */}
      <Show when={navigationStore.state.sidebarOpen && isMobile()}>
        <button
          type="button"
          class="fixed inset-0 z-40 bg-base-content/50 md:hidden"
          onClick={() => navigationStore.setSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      </Show>

      {/* Sidebar */}
      <div
        class={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] md:relative md:z-auto transition-all duration-200",
          sidebarCollapsed() ? "md:w-16" : "md:w-72 lg:w-80",
          "transform md:translate-x-0",
          navigationStore.state.sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        style={{ "padding-top": "env(safe-area-inset-top, 0px)" }}
      >
        <SessionSidebar
          isOpen={navigationStore.state.sidebarOpen}
          onToggle={() => navigationStore.toggleSidebar()}
          collapsed={sidebarCollapsed()}
          onCollapseToggle={() => setSidebarCollapsed((c) => !c)}
        />
      </div>

      {/* Main Content */}
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <main class="flex-1 flex min-h-0 flex-col min-w-0 pb-14 md:pb-0">
          {/* Keyed wrapper forces re-mount on view change → animate-fade-in triggers */}
          <Switch>
            <Match when={activeView() === "settings"}><div class="flex-1 flex min-h-0 animate-fade-in"><SettingsView /></div></Match>
            <Match when={activeView() === "devices" || activeView() === "hosts" || activeView() === "proxies"}><div class="flex-1 flex min-h-0 animate-fade-in"><DevicesView /></div></Match>
            <Match when={activeView() === "sessions"}><div class="flex-1 flex min-h-0 animate-fade-in"><SessionsView /></div></Match>
            <Match when={activeView() === "workspace" || activeView() === "chat"}><div class="flex-1 flex min-h-0 animate-fade-in"><WorkspaceShell /></div></Match>
            <Match when={true}><div class="flex-1 flex min-h-0 animate-fade-in"><HomeView /></div></Match>
          </Switch>
        </main>

        {/* Mobile bottom tab bar */}
        <nav class="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center border-t border-base-content/10 bg-base-100/95 backdrop-blur-md safe-area-bottom">
          <For each={[
            { id: "home" as const, icon: FiHome, label: "Home" },
            { id: "sessions" as const, icon: FiMessageSquare, label: "Sessions" },
            { id: "devices" as const, icon: FiMonitor, label: "Devices" },
            { id: "settings" as const, icon: FiSettings, label: "Settings" },
          ]}>
            {(tab) => {
              const isActive = () => activeView() === tab.id || 
                (tab.id === "devices" && (activeView() === "hosts" || activeView() === "proxies"));
              return (
                <button
                  type="button"
                  class={cn(
                    "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors duration-150",
                    isActive() ? "text-primary" : "text-base-content/40 hover:text-base-content/60",
                  )}
                  onClick={() => navigationStore.setActiveView(tab.id)}
                >
                  <tab.icon size={18} />
                  <span class="text-[9px] font-medium">{tab.label}</span>
                </button>
              );
            }}
          </For>
        </nav>
      </div>
    </div>
  );
};