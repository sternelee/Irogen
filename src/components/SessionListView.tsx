/**
 * SessionListView Component
 *
 * Displays list of AI agent sessions with controls for session management.
 */

import { For, Show, createSignal } from "solid-js";
import { sessionStore } from "../stores/sessionStore";
import type { AgentSessionMetadata, AgentType } from "../stores/sessionStore";

// ========================================================================
// Types
// ============================================================================

interface SessionListViewProps {
  onSelectSession?: (sessionId: string) => void;
  onStartNewSession?: () => void;
  onStopSession?: (sessionId: string) => void;
  onBack?: () => void;
}

// ========================================================================
// Helper Components
// ========================================================================

function AgentIcon(props: { agentType: AgentType; class?: string }) {
  const getIcon = () => {
    switch (props.agentType) {
      case "claude":
        return (
          <svg class={props.class} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        );
      case "opencode":
        return (
          <svg class={props.class} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        );
      case "gemini":
        return (
          <svg class={props.class} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        );
      default:
        return (
          <svg
            class={props.class}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        );
    }
  };

  return getIcon();
}

function SessionCard(props: {
  session: AgentSessionMetadata;
  onSelect: () => void;
  onStop: () => void;
}) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getProjectName = () => {
    const parts = props.session.projectPath.split("/");
    return parts[parts.length - 1] || props.session.projectPath;
  };

  return (
    <div class="bg-card rounded-xl p-4 hover:bg-card/80 transition-colors cursor-pointer border border-border">
      <div class="flex items-start gap-3">
        <div class="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <AgentIcon
            agentType={props.session.agentType}
            class="w-5 h-5 text-primary"
          />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2 mb-1">
            <h3 class="font-semibold text-foreground text-sm truncate">
              {getProjectName()}
            </h3>
            <Show when={props.session.active}>
              <span class="shrink-0 w-2 h-2 rounded-full bg-success" />
            </Show>
          </div>
          <p class="text-xs text-muted-foreground truncate mb-2">
            {props.session.currentDir}
          </p>
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">
              {formatTime(props.session.startedAt)}
            </span>
            <div class="flex items-center gap-2">
              <button
                onClick={props.onSelect}
                class="px-3 py-1 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Open
              </button>
              <button
                onClick={props.onStop}
                class="px-2 py-1 text-xs font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              >
                <svg
                  class="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
          <Show when={props.session.gitBranch}>
            <div class="flex items-center gap-1 mt-2">
              <svg
                class="w-3 h-3 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span class="text-xs text-muted-foreground">
                {props.session.gitBranch}
              </span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ========================================================================
// Main Component
// ========================================================================

export function SessionListView(props: SessionListViewProps) {
  const [filter, setFilter] = createSignal<"all" | "active">("all");

  const sessions = () => {
    const allSessions = sessionStore.getSessions();
    if (filter() === "active") {
      return allSessions.filter((s) => s.active);
    }
    return allSessions;
  };

  const activeCount = () => sessionStore.getActiveSessions().length;

  const handleStopSession = (sessionId: string) => {
    props.onStopSession?.(sessionId);
  };

  const handleSelectSession = (sessionId: string) => {
    props.onSelectSession?.(sessionId);
  };

  return (
    <div class="flex flex-col h-full bg-background">
      {/* Header */}
      <div class="p-4 border-b border-border">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-foreground">Sessions</h2>
          <button
            onClick={props.onStartNewSession}
            class="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Session
          </button>
        </div>

        {/* Filter Tabs */}
        <div class="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            class={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter() === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            All ({sessions().length})
          </button>
          <button
            onClick={() => setFilter("active")}
            class={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter() === "active"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Active ({activeCount()})
          </button>
        </div>
      </div>

      {/* Session List */}
      <div class="flex-1 overflow-y-auto p-4">
        <Show
          when={sessions().length === 0}
          fallback={
            <div class="space-y-3">
              <For each={sessions()}>
                {(session) => (
                  <SessionCard
                    session={session}
                    onSelect={() => handleSelectSession(session.sessionId)}
                    onStop={() => handleStopSession(session.sessionId)}
                  />
                )}
              </For>
            </div>
          }
        >
          <div class="flex flex-col items-center justify-center h-full text-center py-12">
            <div class="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <svg
                class="w-8 h-8 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-foreground mb-2">
              No active sessions
            </h3>
            <p class="text-sm text-muted-foreground max-w-xs mb-6">
              Start a new AI agent session to begin coding assistance
            </p>
            <button
              onClick={props.onStartNewSession}
              class="px-6 py-2.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Start New Session
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
