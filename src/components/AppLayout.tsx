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
import { sessionStore } from "../stores/sessionStore";
import { notificationStore } from "../stores/notificationStore";
import { Button } from "./ui/primitives";
import { CommandPalette, type CommandItem } from "./ui/ChatInput";
import { KeyboardShortcutsDialog } from "./ui/KeyboardShortcuts";
import { ThemeSwitcher } from "./ui/ThemeSwitcher";
import {
  FiPlus,
  FiSettings,
  FiMoon,
  FiSidebar,
  FiHome,
  FiHelpCircle,
} from "solid-icons/fi";

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
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = createSignal(false);

  // Define command palette commands
  const commands: CommandItem[] = [
    {
      id: "new-session",
      label: "New Session",
      description: "Start a new AI agent session",
      icon: FiPlus,
      action: () => {
        // TODO: Open new session modal
        notificationStore.info("New session", "Coming soon");
      },
    },
    {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      description: "Show or hide the session sidebar",
      icon: FiSidebar,
      action: () => setSidebarOpen((prev) => !prev),
    },
    {
      id: "go-home",
      label: "Go to Home",
      description: "Return to home screen",
      icon: FiHome,
      action: () => {
        // TODO: Navigate to home
      },
    },
    {
      id: "toggle-theme",
      label: "Toggle Theme",
      description: "Switch between light and dark mode",
      icon: FiMoon,
      action: () => {
        // TODO: Toggle theme
      },
    },
    {
      id: "settings",
      label: "Settings",
      description: "Open application settings",
      icon: FiSettings,
      action: () => {
        // TODO: Open settings
      },
    },
    {
      id: "keyboard-shortcuts",
      label: "Keyboard Shortcuts",
      description: "View all keyboard shortcuts",
      icon: FiHelpCircle,
      action: () => {
        setShortcutsDialogOpen(true);
      },
    },
  ];

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

      // Press Ctrl/Cmd + K to open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
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

  const handlePermissionResponse = (
    permissionId: string,
    response: "approved" | "denied" | "approved_for_session",
  ) => {
    console.log("Permission response:", permissionId, response);
    // TODO: Implement permission response via Tauri command
  };

  return (
    <div class="flex h-screen bg-muted overflow-hidden">
      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen()}
        onClose={() => setCommandPaletteOpen(false)}
        items={commands}
        placeholder="Type a command..."
      />

      {/* Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        open={shortcutsDialogOpen()}
        onClose={() => setShortcutsDialogOpen(false)}
      />

      {/* Mobile Menu Button */}
      <Button
        class="fixed left-4 top-3 z-50 flex bg-card shadow-md lg:hidden fixed-top-safe"
        size="icon"
        variant="ghost"
        onClick={() => setSidebarOpen(!sidebarOpen())}
      >
        <MenuIcon />
      </Button>

      {/* Sidebar */}
      <SessionSidebar
        isOpen={sidebarOpen()}
        onToggle={() => setSidebarOpen(!sidebarOpen())}
      />

      {/* Main Content */}
      <main class="flex-1 flex flex-col min-w-0 lg:ml-0">
        <Show
          when={activeSession()}
          fallback={
            <div class="flex-1 flex items-center justify-center p-8">
              {/* Theme Switcher - Top Right */}
              <div class="fixed top-4 right-4 fixed-top-safe">
                <ThemeSwitcher />
              </div>

              <div class="text-center max-w-md">
                {/* Logo */}
                <div class="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-primary via-primary/90 to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/30">
                  <span class="text-5xl text-white font-bold">R</span>
                </div>
                <h2 class="text-3xl font-bold mb-3 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Welcome to riterm
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
                    <div class="text-xs font-medium">Terminal</div>
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
              <ChatView
                sessionId={session().sessionId}
                agentType={session().agentType}
                projectPath={session().projectPath}
                sessionMode={session().mode}
                onSendMessage={handleSendMessage}
                onPermissionResponse={handlePermissionResponse}
              />
            );
          }}
        </Show>
      </main>
    </div>
  );
};

export default AppLayout;
