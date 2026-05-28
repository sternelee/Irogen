/**
 * ChatHeader Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import { type Component, Show, createMemo } from "solid-js";
import {
  FiTerminal,
  FiSidebar,
  FiFolder,
  FiGitBranch,
} from "solid-icons/fi";
import { sessionStore, type PermissionMode } from "../../stores/sessionStore";
import { sessionEventRouter } from "../../stores/sessionEventRouter";
import { PermissionModeSwitcher } from "../ui/PermissionModeSwitcher";
import { cn } from "~/lib/utils";

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
      case "online":
        return "bg-green-500";
      case "reconnecting":
        return "bg-yellow-500";
      case "offline":
        return "bg-red-500";
      default:
        return "bg-zinc-400";
    }
  });

  const statusColor = createMemo(() => {
    const sess = session();
    if (!sess?.active) return "bg-zinc-400";
    const routerState = sessionEventRouter.getStreamingState(props.sessionId);
    if (routerState?.isStreaming) return "bg-blue-500";
    return "bg-green-500";
  });

  const statusText = createMemo(() => {
    const sess = session();
    if (!sess?.active) return "Offline";
    const routerState = sessionEventRouter.getStreamingState(props.sessionId);
    if (routerState?.isStreaming) return "Streaming";
    return "Online";
  });

  const projectName = createMemo(() => {
    const path = props.projectPath || session()?.projectPath;
    if (!path) return null;
    return path.split("/").pop() || path;
  });

  return (
    <header class="z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-black/10 px-4 py-3 sm:min-h-14">
      {/* Left: Sidebar toggle (mobile) + Session info */}
      <div class="flex items-center gap-3 min-w-0 flex-1">
        {/* Sidebar toggle button */}
        <button
          type="button"
          class="h-11 w-11 border border-black/10 flex items-center justify-center text-zinc-500 hover:text-foreground hover:border-zinc-400 shrink-0"
          onClick={props.onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <FiSidebar size={18} />
        </button>

        {/* Session info */}
        <Show when={props.agentType}>
          <div class="flex items-center gap-3 min-w-0">
            {/* Agent icon */}
            <div class="hidden sm:flex h-9 w-9 items-center justify-center border border-black/10 shrink-0">
              <FiTerminal size={17} class="text-zinc-600" />
            </div>

            {/* Session details */}
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-sm truncate max-w-[100px] sm:max-w-[180px] text-foreground">
                  {props.agentType?.charAt(0).toUpperCase() +
                    (props.agentType?.slice(1) || "")}
                </span>
                {/* Status indicator */}
                <span
                  class={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shrink-0",
                    statusText() === "Online" &&
                      "bg-green-500/10 text-green-600",
                    statusText() === "Streaming" &&
                      "bg-blue-500/10 text-blue-600",
                    statusText() === "Offline" && "bg-zinc-200 text-zinc-600",
                  )}
                >
                  <span class={cn("h-1.5 w-1.5", statusColor())} />
                  <span class="hidden xs:inline">{statusText()}</span>
                </span>
              </div>
              <Show when={projectName()}>
                <span class="text-[11px] text-zinc-500 truncate block max-w-[140px] sm:max-w-[220px] font-mono">
                  {projectName()}
                </span>
              </Show>
              <Show when={hostName()}>
                <span class="flex items-center gap-1 mt-0.5">
                  <span
                    class={cn(
                      "h-1.5 w-1.5 shrink-0",
                      hostStatusDot() ?? "bg-zinc-400",
                    )}
                  />
                  <span class="text-[11px] text-zinc-500 font-medium truncate max-w-[120px] sm:max-w-[180px]">
                    {hostName()}
                  </span>
                </span>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* Right: Tool toggles + Settings */}
      <div class="flex items-center gap-1.5">
        {/* Mobile agent indicator */}
        <Show when={!props.agentType}>
          <span class="text-sm font-medium text-zinc-500 mr-2">Chat</span>
        </Show>

        {/* Permission mode switcher */}
        <Show when={props.agentType && props.onPermissionModeChange}>
          <PermissionModeSwitcher
            mode={permissionMode()}
            compact
            onChange={(mode) => props.onPermissionModeChange?.(mode)}
          />
        </Show>

        {/* File browser toggle */}
        <Show when={props.agentType && props.onToggleFileBrowser}>
          <button
            type="button"
            class={cn(
              "h-11 w-11 flex items-center justify-center border",
              props.rightPanelView === "file"
                ? "text-zinc-900 border-zinc-900 dark:text-white dark:border-white"
                : "text-zinc-500 border-black/10 hover:border-zinc-400",
            )}
            onClick={props.onToggleFileBrowser}
            title="Files"
          >
            <FiFolder size={16} />
          </button>
        </Show>

        {/* Git toggle */}
        <Show when={props.agentType && props.onToggleGitPanel}>
          <button
            type="button"
            class={cn(
              "h-11 w-11 flex items-center justify-center border",
              props.rightPanelView === "git"
                ? "text-zinc-900 border-zinc-900 dark:text-white dark:border-white"
                : "text-zinc-500 border-black/10 hover:border-zinc-400",
            )}
            onClick={props.onToggleGitPanel}
            title="Git"
          >
            <FiGitBranch size={16} />
          </button>
        </Show>
      </div>
    </header>
  );
};

export default ChatHeader;
