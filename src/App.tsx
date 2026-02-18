/**
 * ClawdChat App
 *
 * Main application entry point - AI Agent P2P Remote Management
 * Multi-session management with SolidJS + Solid UI tokens
 */

import { createSignal, onMount, onCleanup } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "solid-sonner";

// Components
import { AppLayout } from "./components/AppLayout";
import { SettingsModal } from "./components/SettingsModal";
import { NewSessionModal } from "./components/NewSessionModal";
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
    // Listen for agent session creation events
    setupEventListeners();
  });

  const setupEventListeners = async () => {
    // Listen for agent session creation responses from CLI
    const unlistenAgentCreated = await listen(
      "agent-session-created",
      (event) => {
        const payload = event.payload as {
          session_id: string;
          agent_type: string;
          project_path: string;
          control_session_id?: string;
        };

        console.log("Agent session created event:", payload);

        // Parse agent type
        const agentType = parseAgentType(payload.agent_type);

        // Find connection metadata if available
        let hostname = "remote";
        let os = "remote";
        let machineId = "remote";

        if (payload.control_session_id) {
          const controlSession = sessionStore.getSession(
            payload.control_session_id,
          );
          if (controlSession) {
            hostname = controlSession.hostname;
            os = controlSession.os;
            machineId = controlSession.machineId;
          }
        }

        // Add session to store
        sessionStore.addSession({
          sessionId: payload.session_id,
          agentType,
          projectPath: payload.project_path,
          startedAt: Date.now(),
          active: true,
          controlledByRemote: true,
          hostname,
          os,
          currentDir: payload.project_path,
          machineId,
          mode: "remote",
          controlSessionId: payload.control_session_id,
        });

        // Set as active session
        sessionStore.setActiveSession(payload.session_id);

        notificationStore.success(`${agentType} session created`, "Session");
      },
    );

    // Listen for peer disconnection events
    const unlistenPeerDisconnected = await listen(
      "peer-disconnected",
      (event) => {
        const payload = event.payload as { sessionId: string };
        console.log("Peer disconnected event:", payload);

        const disconnectedControlId = payload.sessionId;

        // Find all agent sessions that depend on this control session
        const sessions = sessionStore.getSessions();
        sessions.forEach((session) => {
          if (session.controlSessionId === disconnectedControlId) {
            // Update session state to inactive
            sessionStore.updateSession(session.sessionId, {
              active: false,
            });
            notificationStore.error(
              `Connection lost for session ${session.sessionId}`,
              "Connection Lost",
            );
          }

          // Also if the control session itself is in the store, mark it inactive
          if (session.sessionId === disconnectedControlId) {
            sessionStore.updateSession(session.sessionId, {
              active: false,
            });
          }
        });
      },
    );

    // Cleanup on unmount
    onCleanup(() => {
      unlistenAgentCreated();
      unlistenPeerDisconnected();
    });
  };

  const parseAgentType = (agentTypeStr: string): AgentType => {
    const lower = agentTypeStr.toLowerCase().replace(/-/g, "_");
    if (lower === "claudeacp" || lower === "claude_acp") return "claude_acp";
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

      {/* New Session Modal */}
      <NewSessionModal />

      {/* Notification Display */}
      <NotificationDisplay position="top-right" />

      {/* Toaster for solid-sonner */}
      <Toaster richColors position="top-right" />
    </>
  );
}
