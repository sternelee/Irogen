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
  type Component,
} from "solid-js";
import { SessionSidebar } from "./SessionSidebar";
import { ChatView } from "./ChatView";
import { sessionStore } from "../stores/sessionStore";
import { notificationStore } from "../stores/notificationStore";
import { Button } from "./ui/primitives";

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
    <div class="flex h-screen bg-base-200 overflow-hidden">
      {/* Mobile Menu Button */}
      <Button
        class="fixed left-4 top-4 z-50 flex bg-card shadow-md lg:hidden"
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
              <div class="text-center max-w-md">
                <div class="text-6xl mb-4">💬</div>
                <h2 class="text-2xl font-bold mb-2">Welcome to RiTerm</h2>
                <p class="text-base-content/70 mb-6">
                  Manage multiple AI agent sessions in one place. Create a new
                  session to get started.
                </p>
                <Button variant="primary" onClick={() => setSidebarOpen(true)}>
                  Create Session
                </Button>
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
