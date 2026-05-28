/**
 * AgentPanel Component
 *
 * Multi-tab parallel agent workspace panel.
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import {
  Show,
  For,
  type Component,
  createMemo,
  createSignal,
} from "solid-js";
import { FiPlus, FiX, FiMessageSquare, FiFolder } from "solid-icons/fi";
import { sessionStore, type AgentSessionMetadata } from "../stores/sessionStore";
import { ChatView } from "./ChatView";
import { cn } from "~/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface AgentTab {
  sessionId: string;
  session: AgentSessionMetadata;
}

// ============================================================================
// Additional Projects Section (Cross-Project Threads)
// ============================================================================

interface AdditionalProjectsProps {
  sessionId: string;
  projectPath: string;
  additionalProjectPaths: string[];
  onAddProject: (path: string) => void;
  onRemoveProject: (path: string) => void;
}

const AdditionalProjects: Component<AdditionalProjectsProps> = (props) => {
  const [isAdding, setIsAdding] = createSignal(false);
  const [newPath, setNewPath] = createSignal("");

  const handleAdd = () => {
    const path = newPath().trim();
    if (path) {
      props.onAddProject(path);
      setNewPath("");
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAdd();
    } else if (e.key === "Escape") {
      setIsAdding(false);
      setNewPath("");
    }
  };

  return (
    <div class="flex items-center gap-2 px-3 py-2 border-b border-black/10 dark:border-white/10 bg-base-200/50">
      <span class="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        Projects
      </span>

      {/* Main project tag */}
      <span class="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
        <FiFolder size={10} />
        {props.projectPath.split("/").pop() || props.projectPath}
      </span>

      {/* Additional project tags */}
      <For each={props.additionalProjectPaths}>
        {(path) => (
          <span class="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span class="w-3 h-px bg-zinc-300 dark:bg-zinc-600" />
            <span class="truncate max-w-[100px]">{path.split("/").pop() || path}</span>
            <button
              type="button"
              class="text-zinc-400 hover:text-red-500"
              onClick={() => props.onRemoveProject(path)}
              aria-label="Remove project"
            >
              <FiX size={10} />
            </button>
          </span>
        )}
      </For>

      {/* Add project input or button */}
      <Show
        when={isAdding()}
        fallback={
          <button
            type="button"
            class="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            onClick={() => setIsAdding(true)}
          >
            + Add
          </button>
        }
      >
        <div class="flex items-center gap-1">
          <input
            type="text"
            class="text-xs bg-transparent border border-black/20 dark:border-white/20 px-2 py-0.5 w-32 focus:outline-none focus:border-zinc-400"
            placeholder="/path/to/project"
            value={newPath()}
            onInput={(e) => setNewPath(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            autofocus
          />
          <button
            type="button"
            class="text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white"
            onClick={handleAdd}
          >
            Add
          </button>
          <button
            type="button"
            class="text-xs text-zinc-400 hover:text-zinc-600"
            onClick={() => {
              setIsAdding(false);
              setNewPath("");
            }}
          >
            Cancel
          </button>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Tab Bar Component
// ============================================================================

interface TabBarProps {
  tabs: AgentTab[];
  activeTabId: string | null;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onNewTab: () => void;
}

const TabBar: Component<TabBarProps> = (props) => {
  return (
    <div class="flex items-center border-b border-black/10 dark:border-white/10 bg-base-100">
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => props.activeTabId === tab.sessionId;
          return (
            <button
              type="button"
              class={cn(
                "flex items-center gap-2 px-3 py-2 text-xs font-medium border-r border-black/10 dark:border-white/10",
                isActive()
                  ? "bg-background text-foreground border-b-2 border-b-background"
                  : "text-zinc-500 hover:text-foreground hover:bg-base-200",
              )}
              onClick={() => props.onSelectTab(tab.sessionId)}
            >
              <span
                class={cn(
                  "w-1.5 h-1.5 rounded-full",
                  tab.session.active
                    ? "bg-green-500"
                    : "bg-zinc-300 dark:bg-zinc-600",
                )}
              />
              <span class="capitalize">{tab.session.agentType}</span>
              <Show when={!isActive()}>
                <button
                  type="button"
                  class="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCloseTab(tab.sessionId);
                  }}
                  aria-label="Close tab"
                >
                  <FiX size={10} />
                </button>
              </Show>
            </button>
          );
        }}
      </For>
      <button
        type="button"
        class="px-3 py-2 text-zinc-400 hover:text-foreground"
        onClick={props.onNewTab}
        title="New thread"
        aria-label="New thread"
      >
        <FiPlus size={14} />
      </button>
    </div>
  );
};

// ============================================================================
// AgentPanel Component
// ============================================================================

interface AgentPanelProps {
  class?: string;
  rightPanelView?: "none" | "file" | "git" | "permissions";
  onToggleFileBrowser?: () => void;
  onToggleGitPanel?: () => void;
  onTogglePermissions?: () => void;
}

export const AgentPanel: Component<AgentPanelProps> = (props) => {
  const sessions = createMemo(() => sessionStore.getSessions());
  const activeSessionId = createMemo(() => sessionStore.state.activeSessionId);

  const tabs = createMemo<AgentTab[]>(() =>
    sessions().map((s) => ({ sessionId: s.sessionId, session: s })),
  );

  const activeTab = createMemo(() =>
    tabs().find((t) => t.sessionId === activeSessionId()) ?? tabs()[0],
  );

  const handleSelectTab = (sessionId: string) => {
    sessionStore.setActiveSession(sessionId);
  };

  const handleCloseTab = (sessionId: string) => {
    sessionStore.archiveSession(sessionId);
  };

  const handleNewTab = () => {
    sessionStore.openNewSessionModal();
  };

  const handleAddProject = (sessionId: string, path: string) => {
    sessionStore.addAdditionalProjectPath(sessionId, path);
  };

  const handleRemoveProject = (sessionId: string, path: string) => {
    sessionStore.removeAdditionalProjectPath(sessionId, path);
  };

  return (
    <div class={cn("flex flex-col h-full bg-background", props.class)}>
      <Show
        when={tabs().length > 0}
        fallback={<EmptyState onNewTab={handleNewTab} />}
      >
        <TabBar
          tabs={tabs()}
          activeTabId={activeTab()?.sessionId ?? null}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
        />
        <Show when={activeTab()}>
          {(tab) => (
            <>
              <AdditionalProjects
                sessionId={tab().sessionId}
                projectPath={tab().session.projectPath}
                additionalProjectPaths={tab().session.additionalProjectPaths}
                onAddProject={(path) => handleAddProject(tab().sessionId, path)}
                onRemoveProject={(path) => handleRemoveProject(tab().sessionId, path)}
              />
              <div class="flex-1 min-h-0">
                <ChatView
                  sessionId={tab().sessionId}
                  agentType={tab().session.agentType}
                  projectPath={tab().session.projectPath}
                  sessionMode={tab().session.mode}
                  rightPanelView={props.rightPanelView}
                  onToggleFileBrowser={props.onToggleFileBrowser}
                  onToggleGitPanel={props.onToggleGitPanel}
                  onTogglePermissions={props.onTogglePermissions}
                />
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
};

// ============================================================================
// Empty State
// ============================================================================

const EmptyState: Component<{ onNewTab: () => void }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center h-full text-center p-6">
      <FiMessageSquare size={32} class="text-zinc-300 dark:text-zinc-600 mb-4" />
      <p class="text-sm font-medium text-foreground mb-1">
        No active threads
      </p>
      <p class="text-xs text-muted-foreground mb-4 max-w-xs">
        Start a new session to run agents in parallel
      </p>
      <button
        type="button"
        class="text-xs font-medium text-foreground hover:text-zinc-700 dark:hover:text-zinc-300 border border-black/10 dark:border-white/20 px-3 py-1.5"
        onClick={props.onNewTab}
      >
        New Thread
      </button>
    </div>
  );
};

export default AgentPanel;