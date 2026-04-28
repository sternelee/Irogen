/**
 * WorkspaceShell Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import { createSignal, createMemo, Show, type Component } from "solid-js";
import { AgentPanel } from "./AgentPanel";
import { FileBrowserView } from "./FileBrowserView";
import { GitDiffView } from "./GitDiffView";
import { PermissionHistory } from "./ui/PermissionHistory";
import { sessionStore } from "../stores/sessionStore";
import { FiFolder, FiGitBranch, FiX, FiShield } from "solid-icons/fi";
import { cn } from "~/lib/utils";

export const WorkspaceShell: Component = () => {
  const [rightPanelView, setRightPanelView] = createSignal<
    "none" | "file" | "git" | "permissions"
  >("none");

  const closeRightPanel = () => setRightPanelView("none");

  const activeSession = createMemo(() => sessionStore.getActiveSession());

  const toggleRightPanel = (view: "file" | "git" | "permissions") => {
    setRightPanelView((prev) => (prev === view ? "none" : view));
  };

  return (
    <>
      {/* Main Content - AgentPanel handles multi-tab */}
      <div class="flex-1 flex min-h-0">
        <AgentPanel class="flex-1" />
      </div>

      {/* Right Panel Toggle Buttons */}
      <div class="fixed top-4 right-4 z-30 flex items-center gap-1 bg-background border border-black/10">
        <button
          type="button"
          class={cn(
            "px-3 py-1.5 text-xs font-medium border-r border-black/10",
            rightPanelView() === "file"
              ? "bg-zinc-100 dark:bg-zinc-800 text-foreground"
              : "text-zinc-500 hover:text-foreground",
          )}
          onClick={() => toggleRightPanel("file")}
          title="Files"
        >
          <FiFolder size={14} />
        </button>
        <button
          type="button"
          class={cn(
            "px-3 py-1.5 text-xs font-medium border-r border-black/10",
            rightPanelView() === "git"
              ? "bg-zinc-100 dark:bg-zinc-800 text-foreground"
              : "text-zinc-500 hover:text-foreground",
          )}
          onClick={() => toggleRightPanel("git")}
          title="Git"
        >
          <FiGitBranch size={14} />
        </button>
        <button
          type="button"
          class={cn(
            "px-3 py-1.5 text-xs font-medium",
            rightPanelView() === "permissions"
              ? "bg-zinc-100 dark:bg-zinc-800 text-foreground"
              : "text-zinc-500 hover:text-foreground",
          )}
          onClick={() => toggleRightPanel("permissions")}
          title="Permissions"
        >
          <FiShield size={14} />
        </button>
      </div>

      {/* Right Panel (Tools) */}
      <Show when={rightPanelView() !== "none"}>
        <button
          type="button"
          class="fixed inset-0 z-40 bg-black/30"
          onClick={closeRightPanel}
          aria-label="Close tools panel"
        />
        <aside class="fixed top-0 bottom-0 right-0 z-50 w-full sm:w-120 bg-background border-l border-black/10 flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 border-b border-black/10">
            <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Show when={rightPanelView() === "file"}>
                <FiFolder size={14} />
                <span>Files</span>
              </Show>
              <Show when={rightPanelView() === "git"}>
                <FiGitBranch size={14} />
                <span>Git</span>
              </Show>
              <Show when={rightPanelView() === "permissions"}>
                <FiShield size={14} />
                <span>Permissions</span>
              </Show>
            </div>
            <button
              type="button"
              class="text-zinc-400 hover:text-foreground"
              onClick={closeRightPanel}
              title="Close"
            >
              <FiX size={16} />
            </button>
          </div>
          <div class="flex-1 overflow-auto">
            <Show when={rightPanelView() === "file"}>
              <FileBrowserView
                class="h-full"
                projectPath={activeSession()?.projectPath}
                sessionMode={activeSession()?.mode}
                controlSessionId={activeSession()?.controlSessionId}
              />
            </Show>
            <Show when={rightPanelView() === "git"}>
              <GitDiffView
                class="h-full"
                projectPath={activeSession()?.projectPath}
                sessionMode={activeSession()?.mode}
                controlSessionId={activeSession()?.controlSessionId}
              />
            </Show>
            <Show when={rightPanelView() === "permissions"}>
              <PermissionHistory
                class="h-full"
                sessionId={activeSession()?.sessionId ?? ""}
              />
            </Show>
          </div>
        </aside>
      </Show>
    </>
  );
};

