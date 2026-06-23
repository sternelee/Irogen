/**
 * WorkspaceShell Component
 *
 * LobeHub-inspired redesign:
 * - Right panel slides in smoothly on desktop (side-by-side)
 * - Right panel overlays on mobile with backdrop blur
 * - Desktop: right panel pushes content left
 * - Mobile: right panel slides over with animated backdrop
 * - Smooth width transition on desktop
 */

import { createSignal, createMemo, Show, type Component } from "solid-js";
import { AgentPanel } from "./AgentPanel";
import { FileBrowserView } from "./FileBrowserView";
import { GitDiffView } from "./GitDiffView";
import { PermissionHistory } from "./ui/PermissionHistory";
import { sessionStore } from "../stores/sessionStore";
import { isMobile } from "../stores/deviceStore";
import { FiX, FiFolder, FiGitBranch, FiShield } from "solid-icons/fi";

// ============================================================================
// Panel Config
// ============================================================================

interface PanelConfig {
  icon: typeof FiFolder;
  label: string;
}

const PANEL_CONFIG: Record<string, PanelConfig> = {
  file: { icon: FiFolder, label: "Files" },
  git: { icon: FiGitBranch, label: "Git" },
  permissions: { icon: FiShield, label: "Permissions" },
};

// ============================================================================
// Right Panel Header
// ============================================================================

const RightPanelHeader: Component<{
  view: string;
  onClose: () => void;
}> = (props) => {
  const label = () => PANEL_CONFIG[props.view]?.label ?? props.view;

  return (
    <div class="flex items-center justify-between px-4 py-3 border-b border-base-content/10 bg-base-100">
      <div class="flex items-center gap-2 text-sm font-semibold text-base-content">
        <Show when={props.view === "file"}><FiFolder size={14} /></Show>
        <Show when={props.view === "git"}><FiGitBranch size={14} /></Show>
        <Show when={props.view === "permissions"}><FiShield size={14} /></Show>
        <span>{label()}</span>
      </div>
      <button
        type="button"
        class="h-8 w-8 rounded-lg flex items-center justify-center text-base-content/40 hover:text-base-content hover:bg-base-200 transition-colors"
        onClick={props.onClose}
        title="Close panel"
      >
        <FiX size={15} />
      </button>
    </div>
  );
};

// ============================================================================
// Right Panel Content
// ============================================================================

const RightPanelContent: Component<{
  view: string;
  activeSession: ReturnType<typeof sessionStore.getActiveSession>;
}> = (props) => {
  return (
    <div class="flex-1 overflow-auto">
      <Show when={props.view === "file"}>
        <FileBrowserView
          class="h-full"
          projectPath={props.activeSession?.projectPath}
          sessionMode={props.activeSession?.mode}
          controlSessionId={props.activeSession?.controlSessionId}
        />
      </Show>
      <Show when={props.view === "git"}>
        <GitDiffView
          class="h-full"
          projectPath={props.activeSession?.projectPath}
          sessionMode={props.activeSession?.mode}
          controlSessionId={props.activeSession?.controlSessionId}
        />
      </Show>
      <Show when={props.view === "permissions"}>
        <PermissionHistory
          class="h-full"
          sessionId={props.activeSession?.sessionId ?? ""}
        />
      </Show>
    </div>
  );
};

// ============================================================================
// Workspace Shell
// ============================================================================

export const WorkspaceShell: Component = () => {
  const [rightPanelView, setRightPanelView] = createSignal<
    "none" | "file" | "git" | "permissions"
  >("none");

  const mobile = () => isMobile();
  const activeSession = createMemo(() => sessionStore.getActiveSession());

  const closeRightPanel = () => setRightPanelView("none");

  const toggleRightPanel = (view: "file" | "git" | "permissions") => {
    setRightPanelView((prev) => (prev === view ? "none" : view));
  };

  const isOpen = () => rightPanelView() !== "none";

  return (
    <div class="flex-1 flex min-h-0 overflow-hidden">
      {/* Main Content */}
      <div
        class="flex flex-col min-w-0 transition-all duration-300 ease-out"
        classList={{
          "flex-1": true, // always flex-1 to take remaining space
        }}
      >
        <AgentPanel
          class="flex-1"
          rightPanelView={rightPanelView()}
          onToggleFileBrowser={() => toggleRightPanel("file")}
          onToggleGitPanel={() => toggleRightPanel("git")}
          onTogglePermissions={() => toggleRightPanel("permissions")}
        />
      </div>

      {/* Desktop: side-by-side right panel */}
      <Show when={!mobile() && isOpen()}>
        <div class="w-80 xl:w-96 flex flex-col border-l border-base-content/10 bg-base-100 animate-slide-in-right shrink-0">
          <RightPanelHeader view={rightPanelView()} onClose={closeRightPanel} />
          <RightPanelContent view={rightPanelView()} activeSession={activeSession()} />
        </div>
      </Show>

      {/* Mobile: overlay right panel */}
      <Show when={mobile() && isOpen()}>
        {/* Backdrop */}
        <div
          class="fixed inset-0 z-40 bg-base-content/20 backdrop-blur-sm animate-fade-in"
          onClick={closeRightPanel}
        />

        {/* Panel */}
        <div class="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-base-100 border-l border-base-content/10 flex flex-col shadow-xl animate-slide-in-right">
          <RightPanelHeader view={rightPanelView()} onClose={closeRightPanel} />
          <RightPanelContent view={rightPanelView()} activeSession={activeSession()} />
        </div>
      </Show>
    </div>
  );
};
