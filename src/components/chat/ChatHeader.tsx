/**
 * ChatHeader Component
 *
 * LobeHub-inspired redesign:
 * - Agent avatar with colored initial
 * - Status indicator (online/streaming/offline)
 * - Project path breadcrumb
 * - Connection info for remote sessions
 * - Compact permission mode switcher
 * - Tool panel toggle buttons
 */

import { type Component, Show, For, createMemo } from "solid-js";
import {
  FiSidebar,
  FiFolder,
  FiGitBranch,
  FiChevronRight,
} from "solid-icons/fi";
import { sessionStore, type PermissionMode } from "../../stores/sessionStore";
import { sessionEventRouter } from "../../stores/sessionEventRouter";
import { PermissionModeSwitcher } from "../ui/PermissionModeSwitcher";
import { cn } from "~/lib/utils";

// ============================================================================
// Helpers
// ============================================================================

function agentAvatarColor(name: string): string {
  const colors = [
    "bg-primary text-primary-content",
    "bg-secondary text-secondary-content",
    "bg-accent text-accent-content",
    "bg-info text-info-content",
    "bg-success text-success-content",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function agentInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

// ============================================================================
// Types
// ============================================================================

interface ChatHeaderProps {
  onToggleSidebar?: () => void;
  sessionId: string;
  agentType?: string;
  sessionMode?: "remote" | "local";
  projectPath?: string;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  rightPanelView?: "none" | "file" | "git" | "permissions";
  onToggleFileBrowser?: () => void;
  onToggleGitPanel?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export const ChatHeader: Component<ChatHeaderProps> = (props) => {
  const session = createMemo(() => sessionStore.getSession(props.sessionId));
  const permissionMode = createMemo(() =>
    sessionStore.getPermissionMode(props.sessionId),
  );

  const connectedHost = createMemo(() => {
    const sess = session();
    if (!sess?.controlSessionId || sess.mode !== "remote") return undefined;
    return sessionStore.getConnectedHost(sess.controlSessionId);
  });

  const hostName = createMemo(() => {
    const sess = session();
    if (!sess || sess.mode !== "remote") return null;
    return connectedHost()?.hostname || sess.hostname || null;
  });

  const hostStatusDot = createMemo(() => {
    const host = connectedHost();
    if (!host) return null;
    switch (host.status) {
      case "online": return "bg-success";
      case "reconnecting": return "bg-warning animate-pulse";
      case "offline": return "bg-error";
      default: return "bg-base-content/30";
    }
  });

  const statusColor = createMemo(() => {
    const sess = session();
    if (!sess?.active) return "bg-base-content/30";
    const routerState = sessionEventRouter.getStreamingState(props.sessionId);
    if (routerState?.isStreaming) return "bg-info";
    return "bg-success";
  });

  const statusText = createMemo(() => {
    const sess = session();
    if (!sess?.active) return "Offline";
    const routerState = sessionEventRouter.getStreamingState(props.sessionId);
    if (routerState?.isStreaming) return "Streaming";
    return "Online";
  });

  const statusBg = createMemo(() => {
    const txt = statusText();
    if (txt === "Streaming") return "bg-info/10 text-info";
    if (txt === "Online") return "bg-success/10 text-success";
    return "bg-base-200/50 text-base-content/40";
  });

  const projectParts = createMemo(() => {
    const path = props.projectPath || session()?.projectPath;
    if (!path) return [] as string[];
    return path.split("/").filter(Boolean);
  });

  const agentDisplay = createMemo(() => {
    const agentType = props.agentType || session()?.agentType || "agent";
    return agentType.charAt(0).toUpperCase() + agentType.slice(1);
  });

  return (
    <header class="z-20 flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-base-content/10 px-3 py-2.5 bg-base-100">
      {/* Left: Sidebar toggle + Session info */}
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        {/* Sidebar toggle */}
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm"
          onClick={props.onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <FiSidebar size={15} />
        </button>

        {/* Agent Avatar + Info */}
        <div class="flex items-center gap-2.5 min-w-0">
          {/* Avatar */}
          <div class={cn(
            "w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0",
            agentAvatarColor(agentDisplay()),
          )}>
            {agentInitial(agentDisplay())}
          </div>

          {/* Name + Status */}
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-base-content truncate">
                {agentDisplay()}
              </span>
              <span class={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium",
                statusBg(),
              )}>
                <span class={cn("w-1.5 h-1.5 rounded-full", statusColor())} />
                {statusText()}
              </span>
            </div>

            {/* Project path breadcrumb */}
            <div class="flex items-center gap-1 text-[10px] text-base-content/40 truncate">
              <Show
                when={projectParts().length > 0}
                fallback={<span class="italic">No project</span>}
              >
                <For each={projectParts()}>
                  {(part, i) => (
                    <>
                      <Show when={i() > 0}>
                        <FiChevronRight size={8} class="text-base-content/20" />
                      </Show>
                      <span class="truncate max-w-[80px]">{part}</span>
                    </>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>

        {/* Remote host indicator */}
        <Show when={props.sessionMode === "remote" && hostName()}>
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-base-200/70 text-[10px] text-base-content/50">
            <span class={cn("w-1.5 h-1.5 rounded-full", hostStatusDot())} />
            {hostName()}
          </div>
        </Show>
      </div>

      {/* Right: Controls */}
      <div class="flex items-center gap-1">
        {/* Permission mode */}
        <Show when={permissionMode()}>
          <div class="hidden sm:block">
            <PermissionModeSwitcher
              mode={permissionMode()}
              onChange={props.onPermissionModeChange ?? (() => {})}
            />
          </div>
        </Show>

        {/* Tool panel buttons */}
        <div class="flex items-center gap-0.5">
          <Show when={props.onToggleFileBrowser}>
            <button
              type="button"
              onClick={() => props.onToggleFileBrowser?.()}
              class={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                props.rightPanelView === "file"
                  ? "text-primary bg-primary/10"
                  : "text-base-content/30 hover:text-base-content hover:bg-base-200",
              )}
              title="Files"
              aria-label="Toggle file browser"
            >
              <FiFolder size={14} />
            </button>
          </Show>
          <Show when={props.onToggleGitPanel}>
            <button
              type="button"
              onClick={() => props.onToggleGitPanel?.()}
              class={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                props.rightPanelView === "git"
                  ? "text-primary bg-primary/10"
                  : "text-base-content/30 hover:text-base-content hover:bg-base-200",
              )}
              title="Git"
              aria-label="Toggle git panel"
            >
              <FiGitBranch size={14} />
            </button>
          </Show>
        </div>
      </div>
    </header>
  );
};
