import {
  Show,
  For,
  createSignal,
  createEffect,
  createMemo,
  type Component,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  FiClock,
  FiFolder,
  FiChevronRight,
  FiChevronDown,
} from "solid-icons/fi";
import {
  sessionStore,
  AgentType,
  type AgentSessionMetadata,
} from "../stores/sessionStore";
import { isMobile } from "../stores/deviceStore";
import { notificationStore } from "../stores/notificationStore";
import { Button } from "./ui/primitives";
import { Dialog } from "./ui/dialog";
import { Select } from "./ui/primitives";
import { Label } from "./ui/primitives";
import { SpinnerWithLabel } from "./ui/Spinner";

interface AgentHistoryEntry {
  agent_type: AgentType;
  session_id: string;
  title?: string;
  updated_at?: string;
  cwd?: string;
  meta?: unknown;
}

interface HistoryTreeNode {
  id: string;
  label: string;
  timestamp: string;
  path: string;
  children?: HistoryTreeNode[];
  isExpanded?: boolean;
}

interface HistorySelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostMachineId?: string;
  defaultProjectPath?: string;
  agentType?: AgentType;
}

export const HistorySelectionModal: Component<HistorySelectionModalProps> = (
  props,
) => {
  const [agentType, setAgentType] = createSignal<AgentType>(
    props.agentType || "claude",
  );
  const [projectPath, setProjectPath] = createSignal<string>("");
  const [historySessions, setHistorySessions] = createSignal<
    AgentHistoryEntry[]
  >([]);
  const [isLoadingHistory, setIsLoadingHistory] = createSignal(false);
  const [isLoadingSession, setIsLoadingSession] = createSignal(false);
  const [selectedSession, setSelectedSession] = createSignal<string | null>(
    null,
  );
  const [autoLoadTriggered, setAutoLoadTriggered] = createSignal(false);
  const [expandedNodes, setExpandedNodes] = createSignal<Set<string>>(
    new Set(),
  );

  // Convert flat list to tree structure (grouped by date)
  const buildSessionTree = (
    sessions: AgentHistoryEntry[],
  ): HistoryTreeNode[] => {
    const grouped: Map<string, AgentHistoryEntry[]> = new Map();

    sessions.forEach((session) => {
      const dateStr = session.updated_at
        ? new Date(session.updated_at).toLocaleDateString()
        : "Unknown Date";

      if (!grouped.has(dateStr)) {
        grouped.set(dateStr, []);
      }
      grouped.get(dateStr)!.push(session);
    });

    const nodes: HistoryTreeNode[] = [];
    grouped.forEach((sessions, dateStr) => {
      const dateNode: HistoryTreeNode = {
        id: `date-${dateStr}`,
        label: dateStr,
        timestamp: dateStr,
        path: "",
        isExpanded: true,
        children: sessions.map((session) => ({
          id: session.session_id,
          label: session.title || formatCwd(session.cwd),
          timestamp: session.updated_at || "Unknown",
          path: session.cwd || "Unknown directory",
        })),
      };
      nodes.push(dateNode);
    });

    return nodes.reverse(); // Most recent first
  };

  const toggleNodeExpanded = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  createEffect(() => {
    if (props.isOpen) {
      setHistorySessions([]);
      setSelectedSession(null);
      setIsLoadingHistory(false);
      setIsLoadingSession(false);
      setAutoLoadTriggered(false);
      if (props.defaultProjectPath) {
        setProjectPath(props.defaultProjectPath);
      }
      if (props.agentType) {
        setAgentType(props.agentType);
      }
    }
  });

  // Auto-load history when modal opens with agent type and project path
  createEffect(() => {
    if (
      props.isOpen &&
      props.agentType &&
      props.defaultProjectPath &&
      !autoLoadTriggered()
    ) {
      setAutoLoadTriggered(true);
      loadHistory();
    }
  });

  const loadHistory = async () => {
    if (!projectPath().trim()) {
      notificationStore.error("Please enter a project path", "Error");
      return;
    }

    if (isMobile()) {
      notificationStore.error(
        "History loading is only available on desktop",
        "Error",
      );
      return;
    }

    setIsLoadingHistory(true);
    setHistorySessions([]);
    setSelectedSession(null);

    try {
      const entries = await invoke<AgentHistoryEntry[]>(
        "local_list_agent_history",
        {
          agentTypeStr: agentType(),
          projectPath: projectPath(),
        },
      );
      setHistorySessions(entries);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Failed to load history:", error);
      notificationStore.error(
        `Failed to load history: ${errorMessage}`,
        "Error",
      );
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadSelectedSession = async () => {
    if (isLoadingSession()) return;

    const sessionId = selectedSession();
    if (!sessionId) return;

    setIsLoadingSession(true);

    try {
      const newSessionId = await invoke<string>("local_load_agent_history", {
        agentTypeStr: agentType(),
        historySessionId: sessionId,
        projectPath: projectPath(),
        resume: true,
        extraArgs: null,
        targetSessionId: null,
      });

      const newSession: AgentSessionMetadata = {
        sessionId: newSessionId,
        agentType: agentType(),
        projectPath: projectPath(),
        startedAt: Date.now(),
        active: true,
        controlledByRemote: false,
        hostname: "localhost",
        os: navigator.userAgent,
        currentDir: projectPath(),
        machineId: "local",
        mode: "local",
        lastReceivedSequence: 0,
      };

      sessionStore.addSession(newSession);
      sessionStore.setActiveSession(newSessionId);
      sessionStore.closeNewSessionModal();

      notificationStore.success(
        "History session loaded successfully",
        "Success",
      );

      props.onClose();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Failed to load history session:", error);
      notificationStore.error(
        `Failed to load history session: ${errorMessage}`,
        "Error",
      );
    } finally {
      setIsLoadingSession(false);
    }
  };

  const formatCwd = (cwd: string | undefined) => {
    if (!cwd) return "Unknown directory";
    const parts = cwd.split("/");
    return parts[parts.length - 1] || cwd;
  };

  const sessionTree = createMemo(() => buildSessionTree(historySessions()));

  return (
    <Dialog
      open={props.isOpen}
      onClose={props.onClose}
      class="modal-bottom sm:modal-middle"
      contentClass="rounded-t-3xl rounded-b-none sm:rounded-2xl"
    >
      <div class="p-4">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <FiClock class="w-5 h-5 text-primary" />
            <h3 class="text-lg font-semibold">Load History Session</h3>
          </div>
        </div>

        <Show when={isMobile()}>
          <div class="alert alert-warning mb-4">
            <span>History loading is only available on desktop platforms.</span>
          </div>
        </Show>

        <Show when={!props.agentType}>
          <div class="space-y-1.5 mb-4">
            <Label for="history-agent-type" class="text-xs">
              Agent Type
            </Label>
            <Select
              id="history-agent-type"
              class="select-sm"
              value={agentType()}
              onChange={(val) => setAgentType(val as AgentType)}
            >
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="cursor">Cursor</option>
              <option value="cline">Cline</option>
              <option value="pi">Pi</option>
              <option value="qwen">Qwen Code</option>
              <option value="opencode">OpenCode</option>
              <option value="gemini">Gemini CLI</option>
            </Select>
          </div>
        </Show>

        <Show when={!props.defaultProjectPath}>
          <div class="space-y-1.5 mb-4">
            <Label for="history-project-path" class="text-xs">
              Project Path
            </Label>
            <input
              id="history-project-path"
              type="text"
              class="input input-sm input-bordered w-full font-mono text-sm"
              placeholder="Enter project path"
              value={projectPath()}
              onInput={(e) => setProjectPath(e.currentTarget.value)}
            />
          </div>
        </Show>

        <Show when={!props.agentType || !props.defaultProjectPath}>
          <Button
            variant="outline"
            size="sm"
            class="w-full mb-4"
            onClick={loadHistory}
            disabled={isLoadingHistory() || !projectPath().trim()}
          >
            <Show
              when={isLoadingHistory()}
              fallback={
                <>
                  <FiClock class="mr-1.5 size-4" /> Load History
                </>
              }
            >
              <SpinnerWithLabel text="Loading..." size="sm" />
            </Show>
          </Button>
        </Show>

        <Show when={historySessions().length > 0}>
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground">
              Available Sessions ({historySessions().length})
            </Label>
            <div class="max-h-64 overflow-y-auto space-y-1">
              <For each={sessionTree()}>
                {(node) => (
                  <div>
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-base-content/5 transition-colors"
                      onClick={() => toggleNodeExpanded(node.id)}
                    >
                      <Show
                        when={node.children && node.children.length > 0}
                        fallback={<div class="w-4" />}
                      >
                        <Show
                          when={expandedNodes().has(node.id)}
                          fallback={
                            <FiChevronRight
                              size={14}
                              class="text-muted-foreground shrink-0"
                            />
                          }
                        >
                          <FiChevronDown
                            size={14}
                            class="text-muted-foreground shrink-0"
                          />
                        </Show>
                      </Show>
                      <FiClock
                        size={12}
                        class="text-muted-foreground shrink-0"
                      />
                      <span class="text-xs font-semibold text-base-content/70">
                        {node.label}
                      </span>
                    </button>

                    {/* Child nodes (individual sessions) */}
                    <Show when={expandedNodes().has(node.id)}>
                      <div class="space-y-1 pl-6">
                        <For each={node.children || []}>
                          {(child) => (
                            <button
                              type="button"
                              class={`w-full p-2 rounded-lg border text-left transition-all text-xs ${
                                selectedSession() === child.id
                                  ? "border-primary bg-primary/10"
                                  : "border-base-content/10 hover:bg-base-content/5"
                              }`}
                              onClick={() => setSelectedSession(child.id)}
                            >
                              <div class="flex items-start gap-2">
                                <FiFolder
                                  size={12}
                                  class="mt-0.5 text-muted-foreground shrink-0"
                                />
                                <div class="flex-1 min-w-0">
                                  <div class="font-medium text-xs truncate">
                                    {child.label}
                                  </div>
                                  <div class="text-xs text-muted-foreground/60 font-mono truncate mt-0.5">
                                    {child.path}
                                  </div>
                                </div>
                              </div>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show
          when={
            !isLoadingHistory() &&
            historySessions().length === 0 &&
            projectPath().trim()
          }
        >
          <div class="text-center py-8 text-muted-foreground">
            <FiClock class="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p class="text-sm">No history sessions found for this project</p>
          </div>
        </Show>

        <Show when={selectedSession()}>
          <Button
            variant="default"
            size="sm"
            class="w-full mt-4"
            onClick={loadSelectedSession}
            disabled={isLoadingSession()}
          >
            <Show when={isLoadingSession()} fallback="Load Selected Session">
              <SpinnerWithLabel text="Loading Session..." size="sm" />
            </Show>
          </Button>
        </Show>
      </div>
    </Dialog>
  );
};

export default HistorySelectionModal;
