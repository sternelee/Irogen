import {
  Show,
  For,
  createSignal,
  createEffect,
  type Component,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { FiClock, FiFolder, FiChevronRight, FiX } from "solid-icons/fi";
import { sessionStore, AgentType, type AgentSessionMetadata } from "../stores/sessionStore";
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

interface HistorySelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostMachineId?: string;
  defaultProjectPath?: string;
}

export const HistorySelectionModal: Component<HistorySelectionModalProps> = (
  props,
) => {
  const [agentType, setAgentType] = createSignal<AgentType>("claude");
  const [projectPath, setProjectPath] = createSignal<string>("");
  const [historySessions, setHistorySessions] = createSignal<AgentHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = createSignal(false);
  const [isLoadingSession, setIsLoadingSession] = createSignal(false);
  const [selectedSession, setSelectedSession] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.isOpen) {
      setHistorySessions([]);
      setSelectedSession(null);
      setIsLoadingHistory(false);
      setIsLoadingSession(false);
      if (props.defaultProjectPath) {
        setProjectPath(props.defaultProjectPath);
      }
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

  const formatTime = (timestamp: string | undefined) => {
    if (!timestamp) return "Unknown";
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const formatCwd = (cwd: string | undefined) => {
    if (!cwd) return "Unknown directory";
    const parts = cwd.split("/");
    return parts[parts.length - 1] || cwd;
  };

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
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square"
            onClick={props.onClose}
          >
            <FiX size={18} />
          </button>
        </div>

        <Show when={isMobile()}>
          <div class="alert alert-warning mb-4">
            <span>
              History loading is only available on desktop platforms.
            </span>
          </div>
        </Show>

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
            <option value="opencode">OpenCode</option>
            <option value="gemini">Gemini CLI</option>
          </Select>
        </div>

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

        <Button
          variant="outline"
          size="sm"
          class="w-full mb-4"
          onClick={loadHistory}
          disabled={isLoadingHistory() || !projectPath().trim()}
        >
          <Show when={isLoadingHistory()} fallback={<><FiClock class="mr-1.5 size-4" /> Load History</>}>
            <SpinnerWithLabel label="Loading..." size="sm" />
          </Show>
        </Button>

        <Show when={historySessions().length > 0}>
          <div class="space-y-2">
            <Label class="text-xs text-muted-foreground">
              Available Sessions ({historySessions().length})
            </Label>
            <div class="max-h-64 overflow-y-auto space-y-2">
              <For each={historySessions()}>
                {(session) => (
                  <button
                    type="button"
                    class={`w-full p-3 rounded-lg border text-left transition-all ${
                      selectedSession() === session.session_id
                        ? "border-primary bg-primary/10"
                        : "border-base-content/10 hover:bg-base-content/5"
                    }`}
                    onClick={() => setSelectedSession(session.session_id)}
                  >
                    <div class="flex items-start gap-3">
                      <FiFolder class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2">
                          <span class="font-medium text-sm truncate">
                            {session.title || formatCwd(session.cwd)}
                          </span>
                          <FiChevronRight class="w-4 h-4 text-muted-foreground shrink-0" />
                        </div>
                        <div class="flex items-center gap-2 mt-1">
                          <span class="text-xs text-muted-foreground">
                            {formatTime(session.updated_at)}
                          </span>
                          <span class="text-xs text-muted-foreground">
                            •
                          </span>
                          <span class="text-xs text-muted-foreground font-mono truncate">
                            {session.cwd}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={!isLoadingHistory() && historySessions().length === 0 && projectPath().trim()}>
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
              <SpinnerWithLabel label="Loading Session..." size="sm" />
            </Show>
          </Button>
        </Show>
      </div>
    </Dialog>
  );
};

export default HistorySelectionModal;
