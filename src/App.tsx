/**
 * RiTerm App
 *
 * Main application entry point - AI Agent P2P Remote Management
 * Multi-session management with SolidJS + Solid UI tokens
 */

import { createSignal, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "solid-sonner";

// Components
import { AppLayout } from "./components/AppLayout";
import { SettingsModal } from "./components/SettingsModal";
import { NotificationDisplay } from "./components/NotificationDisplay";

// Stores
import { sessionStore } from "./stores/sessionStore";
import { notificationStore } from "./stores/notificationStore";

// Types
import type { AgentType } from "./stores/sessionStore";

export default function App() {
  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);

  // Initialize app on mount
  onMount(() => {
    initializeApp();
  });

  const initializeApp = async () => {
    try {
      // Initialize P2P network
      const nodeId = await invoke<string>("initialize_network");
      console.log("Network initialized:", nodeId);

      // Listen for agent session creation events
      setupEventListeners();
    } catch (error) {
      console.error("Failed to initialize app:", error);
      notificationStore.error("Failed to initialize app", "Error");
    }
  };

  const setupEventListeners = async () => {
    // Listen for agent session creation responses from CLI
    const unlisten = await listen("agent-session-created", (event) => {
      const payload = event.payload as {
        session_id: string;
        agent_type: string;
        project_path: string;
      };

      console.log("Agent session created event:", payload);

      // Parse agent type
      const agentType = parseAgentType(payload.agent_type);

      // Add session to store
      sessionStore.addSession({
        sessionId: payload.session_id,
        agentType,
        projectPath: payload.project_path,
        startedAt: Date.now(),
        active: true,
        controlledByRemote: false,
        hostname: "localhost",
        os: navigator.userAgent,
        currentDir: payload.project_path,
        machineId: "local",
      });

      // Set as active session
      sessionStore.setActiveSession(payload.session_id);

      notificationStore.success(`${agentType} session created`, "Session");
    });

    // Cleanup on unmount
    onCleanup(() => {
      unlisten();
    });
  };

  const parseAgentType = (agentTypeStr: string): AgentType => {
    const lower = agentTypeStr.toLowerCase();
    if (lower.includes("claude")) return "claude";
    if (lower.includes("open")) return "opencode";
    if (lower.includes("gemini")) return "gemini";
    if (lower.includes("copilot")) return "copilot";
    if (lower.includes("qwen")) return "qwen";
    if (lower.includes("zeroclaw")) return "zeroclaw";
    if (lower.includes("codex")) return "codex";
    return "custom";
  };

  return (
    <>
      {/* Main Layout */}
      <AppLayout />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen()}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Notification Display */}
      <NotificationDisplay position="top-right" />

      {/* Toaster for solid-sonner */}
      <Toaster richColors position="top-right" />
    </>
  );
}
