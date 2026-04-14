/**
 * Chat Header Component
 *
 * Header for the chat view with session info and controls.
 * Clean, minimal design inspired by OpenChamber.
 */

import { type Component, Show, createMemo } from "solid-js";
import { FiTerminal, FiSettings, FiSidebar } from "solid-icons/fi";
import { sessionStore } from "../../stores/sessionStore";
import { sessionEventRouter } from "../../stores/sessionEventRouter";
import { navigationStore } from "../../stores/navigationStore";
import { Button } from "../ui/primitives";
import { cn } from "~/lib/utils";

interface ChatHeaderProps {
  onToggleSidebar?: () => void;
  sessionId: string;
  agentType?: string;
  sessionMode?: "remote" | "local";
  projectPath?: string;
}

export const ChatHeader: Component<ChatHeaderProps> = (props) => {
  const session = createMemo(() => sessionStore.getSession(props.sessionId));

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
        return "bg-yellow-500 animate-pulse";
      case "offline":
        return "bg-red-500";
      default:
        return "bg-muted-foreground/40";
    }
  });

  const statusColor = createMemo(() => {
    const sess = session();
    if (!sess?.active) return "bg-muted";
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
    <header class="z-20 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-md sm:min-h-14">
      {/* Left: Sidebar toggle (mobile) + Session info */}
      <div class="flex items-center gap-3 min-w-0 flex-1">
        {/* Sidebar toggle button */}
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground shrink-0"
          onClick={props.onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <FiSidebar size={18} />
        </button>

        {/* Session info */}
        <Show when={props.agentType}>
          <div class="flex items-center gap-3 min-w-0">
            {/* Agent icon */}
            <div class="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 shrink-0">
              <FiTerminal size={17} class="text-primary" />
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
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shrink-0",
                    statusText() === "Online" &&
                      "bg-green-500/10 text-green-600 dark:text-green-400",
                    statusText() === "Streaming" &&
                      "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                    statusText() === "Offline" &&
                      "bg-muted text-muted-foreground",
                  )}
                >
                  <span class={cn("h-1.5 w-1.5 rounded-full", statusColor())} />
                  <span class="hidden xs:inline">{statusText()}</span>
                </span>
              </div>
              <Show when={projectName()}>
                <span class="text-[11px] text-muted-foreground truncate block max-w-[140px] sm:max-w-[220px] font-mono">
                  {projectName()}
                </span>
              </Show>
              <Show when={hostName()}>
                <span class="flex items-center gap-1 mt-0.5">
                  <span
                    class={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      hostStatusDot() ?? "bg-muted-foreground/40",
                    )}
                  />
                  <span class="text-[11px] text-muted-foreground/70 font-medium truncate max-w-[120px] sm:max-w-[180px]">
                    {hostName()}
                  </span>
                </span>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* Right: Tool toggles + Settings */}
      <div class="flex items-center gap-1">
        {/* Mobile agent indicator */}
        <Show when={!props.agentType}>
          <span class="text-sm font-medium text-muted-foreground mr-2">
            Chat
          </span>
        </Show>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          class="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground"
          onClick={() => navigationStore.setActiveView("settings")}
        >
          <FiSettings size={17} />
        </Button>
      </div>
    </header>
  );
};

export default ChatHeader;
