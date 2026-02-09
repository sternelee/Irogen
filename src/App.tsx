/**
 * RiTerm App
 *
 * Main application entry point - AI Agent P2P Remote Management
 */

import { createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Toaster } from "solid-sonner";
import { SettingsModal } from "./components/SettingsModal";
import { HomeView } from "./components/HomeView";
import { ChatView } from "./components/ChatView";
import { SessionListView } from "./components/SessionListView";
import { FileBrowserView } from "./components/FileBrowserView";
import { GitDiffView } from "./components/GitDiffView";
import { NotificationDisplay } from "./components/NotificationDisplay";
import { P2PBackground } from "./components/P2PBackground";
import type { AgentType } from "./stores/sessionStore";

type ViewType = "home" | "chat" | "sessions" | "files" | "git";

export default function Page() {
  // Connection state
  const [sessionTicket, setSessionTicket] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);
  const [connectionError, setConnectionError] = createSignal<string | null>(null);
  const [isConnected, setIsConnected] = createSignal(false);
  const [activeTicket, setActiveTicket] = createSignal<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = createSignal(false);

  // Navigation state
  const [currentView, setCurrentView] = createSignal<ViewType>("home");
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);

  // Session state
  let sessionIdRef: string | null = null;
  let activeAgentType: AgentType = "claude";

  // Initialize network on mount
  onMount(() => {
    initializeNetwork();

    // Clean up old connection history
    try {
      localStorage.removeItem("riterm-connection-history");
    } catch (error) {
      console.log("Failed to clean up history data:", error);
    }
  });

  const initializeNetwork = async () => {
    try {
      const nodeId = await invoke<string>("initialize_network");
      console.log("Network initialized:", nodeId);
    } catch (error) {
      console.error("Failed to initialize network:", error);
    }
  };

  // Connection handlers
  const handleConnect = async () => {
    const ticket = sessionTicket().trim();
    if (!ticket) {
      setConnectionError("Please enter a valid ticket");
      return;
    }

    setConnecting(true);
    setConnectionError(null);

    try {
      const sessionId = await invoke<string>("connect_to_host", { sessionTicket: ticket });
      sessionIdRef = sessionId;
      setIsConnected(true);
      setActiveTicket(ticket);
      setCurrentView("chat");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to connect";
      setConnectionError(errorMsg);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (sessionIdRef) {
      try {
        await invoke("disconnect_session", { sessionId: sessionIdRef });
      } catch (error) {
        console.error("Failed to disconnect:", error);
      }
    }

    sessionIdRef = null;
    setIsConnected(false);
    setActiveTicket(null);
    setCurrentView("home");
  };

  const handleLogin = () => {
    setIsLoggedIn(true);
  };

  const handleSkipLogin = () => {
    setIsLoggedIn(true);
  };

  const handleReturnToSession = () => {
    if (isConnected()) {
      setCurrentView("chat");
    }
  };

  // Remote session spawn handler
  const handleSpawnRemoteSession = async (
    agentType: AgentType,
    projectPath: string,
    args: string[]
  ) => {
    if (!sessionIdRef) {
      throw new Error("Not connected to session");
    }

    await invoke("remote_spawn_session", {
      sessionId: sessionIdRef,
      agentType,
      projectPath,
      args,
    });

    // Switch to the new session view
    activeAgentType = agentType;
    setCurrentView("chat");
  };

  // Send message to AI agent
  const handleSendMessage = async (message: string) => {
    if (!sessionIdRef) {
      throw new Error("Not connected to session");
    }

    await invoke("send_agent_message", {
      sessionId: sessionIdRef,
      content: message,
    });
  };

  return (
    <>
      {/* Background */}
      <P2PBackground />

      {/* Main App */}
      <div class="min-h-screen bg-base-200">
        {/* Home View - Connection Screen */}
        {currentView() === "home" && (
          <HomeView
            sessionTicket={sessionTicket()}
            onTicketInput={setSessionTicket}
            onConnect={handleConnect}
            onShowSettings={() => setIsSettingsOpen(true)}
            connecting={connecting()}
            connectionError={connectionError()}
            isLoggedIn={isLoggedIn()}
            onLogin={handleLogin}
            onSkipLogin={handleSkipLogin}
            isConnected={isConnected()}
            activeTicket={activeTicket()}
            onReturnToSession={handleReturnToSession}
            onDisconnect={handleDisconnect}
          />
        )}

        {/* Chat View - AI Agent Chat Interface */}
        {currentView() === "chat" && sessionIdRef && (
          <div class="h-screen flex flex-col">
            <ChatView
              sessionId={sessionIdRef}
              agentType={activeAgentType}
              onSpawnRemoteSession={handleSpawnRemoteSession}
              onSendMessage={handleSendMessage}
            />
            {/* Back button for mobile */}
            <div class="fixed top-4 left-4 z-50 md:hidden">
              <button
                class="btn btn-circle btn-ghost"
                onClick={() => setCurrentView("sessions")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Sessions View - Session List */}
        {currentView() === "sessions" && (
          <SessionListView
            onSelectSession={(sessionId: string) => {
              sessionIdRef = sessionId;
              setCurrentView("chat");
            }}
            onBack={() => setCurrentView("home")}
          />
        )}

        {/* File Browser View */}
        {currentView() === "files" && (
          <div class="h-screen flex flex-col">
            <FileBrowserView />
            {/* Back button */}
            <div class="fixed top-4 left-4 z-50">
              <button
                class="btn btn-circle btn-ghost"
                onClick={() => setCurrentView("chat")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Git Diff View */}
        {currentView() === "git" && (
          <div class="h-screen flex flex-col">
            <GitDiffView projectPath="." />
            {/* Back button */}
            <div class="fixed top-4 left-4 z-50">
              <button
                class="btn btn-circle btn-ghost"
                onClick={() => setCurrentView("chat")}
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen()}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Notification Display */}
      <NotificationDisplay position="top-right" />

      {/* Toaster */}
      <Toaster richColors position="top-right" />
    </>
  );
}
