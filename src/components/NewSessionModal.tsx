/**
 * NewSessionModal Component
 *
 * Global modal for creating new AI agent sessions (local or remote).
 * Managed by sessionStore for global accessibility.
 */

import {
  Show,
  createMemo,
  For,
  type Component,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { FiPlus, FiHome, FiCloud } from "solid-icons/fi";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { sessionStore, AgentType } from "../stores/sessionStore";
import { isMobile } from "../stores/deviceStore";
import { Alert } from "./ui/primitives";
import { Button } from "./ui/primitives";
import { Combobox } from "./ui/combobox";
import { Dialog } from "./ui/primitives";
import { Label } from "./ui/primitives";
import { Select } from "./ui/primitives";
import { Textarea } from "./ui/primitives";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface RemoteDirEntry {
  name: string;
  is_dir: boolean;
  size?: number;
}

export const NewSessionModal: Component = () => {
  const [dirEntries, setDirEntries] = createSignal<DirEntry[]>([]);
  const [currentRequestId, setCurrentRequestId] = createSignal<string | null>(
    null,
  );

  let unlistenDirListing: UnlistenFn | null = null;

  onMount(async () => {
    // Listen for remote directory listing responses
    unlistenDirListing = await listen<{ entries: RemoteDirEntry[] }>(
      "remote-directory-listing",
      (event) => {
        const requestId = currentRequestId();
        if (!requestId) return;

        const entries = event.payload.entries || [];
        const dirs = entries
          .filter((e) => e.is_dir)
          .map((e) => ({
            name: e.name,
            path: "", // Remote doesn't provide full path
            is_dir: true,
          }));
        setDirEntries(dirs);
      },
    );

    // On mobile, get the app directory as default path
    if (isMobile()) {
      try {
        const appDir = await invoke<string>("get_app_dir");
        if (appDir) {
          sessionStore.setNewSessionPath(appDir);
        }
      } catch (err) {
        console.error("Failed to get app directory:", err);
      }
    }
  });

  onCleanup(() => {
    if (unlistenDirListing) {
      unlistenDirListing();
    }
  });

  const loadDirectory = async (path: string) => {
    // If path doesn't end with /, get the parent directory to list completions
    let dirToList: string;
    let partialName = "";

    if (path.endsWith("/")) {
      // Full path with trailing slash - list directly
      dirToList = path;
    } else {
      // Partial path - extract parent directory and partial name
      const lastSlashIndex = path.lastIndexOf("/");
      if (lastSlashIndex === -1) {
        // No slash found - list current directory with partial filter
        dirToList = ".";
        partialName = path;
      } else {
        dirToList = path.slice(0, lastSlashIndex + 1) || "/";
        partialName = path.slice(lastSlashIndex + 1);
      }
    }

    // Check if we have an active remote session
    const remoteSession = remoteConnections()[0];
    const isRemote =
      sessionStore.state.newSessionMode === "remote" && remoteSession;

    if (isRemote) {
      // Use P2P to list remote directory
      try {
        const requestId = await invoke<string>("list_remote_directory", {
          sessionId: remoteSession.sessionId,
          path: dirToList,
        });
        setCurrentRequestId(requestId);
        // Response will come via event listener
      } catch (err) {
        console.error("Failed to list remote directory:", err);
        setDirEntries([]);
      }
    } else {
      // Use local file system
      try {
        const entries = await invoke<DirEntry[]>("list_directory", {
          path: dirToList,
        });
        // Filter directories by partial name if provided
        const filtered = entries.filter(
          (e) =>
            e.is_dir &&
            (!partialName ||
              e.name.toLowerCase().includes(partialName.toLowerCase())),
        );
        setDirEntries(filtered);
      } catch (err) {
        console.error("Failed to list directory:", err);
        setDirEntries([]);
      }
    }
  };

  const remoteConnections = createMemo(() =>
    sessionStore.getSessions().filter((s) => s.mode === "remote" && s.active),
  );

  const isConnectingToNew = () =>
    sessionStore.state.newSessionMode === "remote" &&
    !sessionStore.state.targetControlSessionId;

  const showAgentConfig = () =>
    sessionStore.state.newSessionMode === "local" ||
    (sessionStore.state.newSessionMode === "remote" &&
      sessionStore.state.targetControlSessionId);

  return (
    <Show when={sessionStore.state.isNewSessionModalOpen}>
      <Dialog
        open={sessionStore.state.isNewSessionModalOpen}
        onClose={() => sessionStore.closeNewSessionModal()}
        contentClass="max-w-md max-h-[90%] overflow-auto"
      >
        <div>
          <h3 class="font-bold text-lg mb-4 flex items-center gap-2">
            <FiPlus size={20} />
            New Session
          </h3>

          {/* Mode Toggle */}
          <div class="flex gap-2 mb-6">
            <Button
              type="button"
              class="flex-1"
              variant={
                sessionStore.state.newSessionMode === "remote"
                  ? "primary"
                  : "ghost"
              }
              onClick={() => {
                sessionStore.setNewSessionMode("remote");
                sessionStore.setConnectionError(null);
                // Auto-select first remote connection if available
                const connections = remoteConnections();
                if (connections.length > 0) {
                  sessionStore.setTargetControlSessionId(
                    connections[0].sessionId,
                  );
                }
              }}
            >
              <FiCloud class="mr-2" /> Remote
            </Button>
            <Show when={!isMobile()}>
              <Button
                type="button"
                class="flex-1"
                variant={
                  sessionStore.state.newSessionMode === "local"
                    ? "primary"
                    : "ghost"
                }
                onClick={() => {
                  sessionStore.setNewSessionMode("local");
                  sessionStore.setConnectionError(null);
                }}
              >
                <FiHome class="mr-2" /> Local
              </Button>
            </Show>
          </div>

          {/* Remote Connection Selector */}
          <Show
            when={
              sessionStore.state.newSessionMode === "remote" &&
              remoteConnections().length > 0
            }
          >
            <div class="mb-4 space-y-2">
              <Label for="remote-connection">Remote Host</Label>
              <Select
                id="remote-connection"
                value={sessionStore.state.targetControlSessionId || "new"}
                onChange={(val) => {
                  sessionStore.setTargetControlSessionId(
                    val === "new" ? null : val,
                  );
                }}
              >
                <For each={remoteConnections()}>
                  {(conn) => (
                    <option value={conn.sessionId}>
                      {conn.hostname || "Remote Host"} (
                      {conn.sessionId.slice(0, 8)})
                    </option>
                  )}
                </For>
                <option value="new">+ Connect to New Host</option>
              </Select>
            </div>
          </Show>

          {/* Remote Mode: Ticket Input */}
          <Show when={isConnectingToNew()}>
            <div class="mb-4 space-y-2">
              <Label for="session-ticket">Session Ticket</Label>
              <Textarea
                id="session-ticket"
                class="h-24 font-mono text-sm"
                placeholder="Paste the session ticket from CLI host..."
                value={sessionStore.state.sessionTicket}
                onInput={(e) => {
                  sessionStore.setSessionTicket(e.currentTarget.value);
                  sessionStore.setConnectionError(null);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    sessionStore.state.sessionTicket.trim()
                  ) {
                    e.preventDefault();
                    sessionStore.handleRemoteConnect();
                  }
                }}
              />
              <p class="text-xs text-muted-foreground">
                Run `cli` to get a session ticket
              </p>
            </div>

            <Show when={sessionStore.state.connectionError}>
              <Alert variant="destructive" class="mb-auto mt-0.5 py-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <title>Error</title>
                  <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span class="text-sm break-all">
                  {sessionStore.state.connectionError}
                </span>
              </Alert>
            </Show>
          </Show>

          {/* Agent Config (Local or Remote with active connection) */}
          <Show when={showAgentConfig()}>
            <div class="mb-4 space-y-2">
              <Label for="agent-type">Agent Type</Label>
              <Select
                id="agent-type"
                value={sessionStore.state.newSessionAgent}
                onChange={(val) =>
                  sessionStore.setNewSessionAgent(val as AgentType)
                }
              >
                {/* Local mode on mobile only supports ClawdAI */}
                <Show
                  when={
                    sessionStore.state.newSessionMode === "local" && isMobile()
                  }
                  fallback={
                    <>
                      <option value="claude">Claude Code</option>
                      <option value="codex">Codex</option>
                      <option value="openclaw">OpenClaw</option>
                      <option value="opencode">OpenCode</option>
                      <option value="gemini">Gemini CLI</option>
                    </>
                  }
                >
                  <option value="">Select an agent</option>
                </Show>
              </Select>
            </div>

            <div class="mb-4 space-y-2">
              <Label for="project-path">Project Path</Label>
              <Combobox
                value={sessionStore.state.newSessionPath}
                onChange={(value) => {
                  // Remove trailing slash if present
                  const cleanPath = value.endsWith("/")
                    ? value.slice(0, -1)
                    : value;
                  sessionStore.setNewSessionPath(cleanPath);
                  setDirEntries([]);
                }}
                onInputChange={(value) => {
                  sessionStore.setNewSessionPath(value);
                  if (value.endsWith("/")) {
                    loadDirectory(value);
                  }
                }}
                items={dirEntries().map((e) => {
                  // Build the path: if current input ends with /, add to it; otherwise handle partial paths
                  const basePath = sessionStore.state.newSessionPath.endsWith(
                    "/",
                  )
                    ? sessionStore.state.newSessionPath
                    : sessionStore.state.newSessionPath.includes("/")
                      ? sessionStore.state.newSessionPath.slice(
                          0,
                          sessionStore.state.newSessionPath.lastIndexOf("/") +
                            1,
                        )
                      : "";
                  return {
                    value: basePath + e.name,
                    label: e.name,
                  };
                })}
                placeholder={isMobile() ? "app directory" : "/path/to/project"}
                class="font-mono"
              />
              <p class="text-xs text-muted-foreground">
                {isMobile()
                  ? "Subdirectory name (default: app directory)"
                  : "Type a path to autocomplete directory names"}
              </p>
            </div>

            <div class="mb-4 space-y-2">
              <Label for="agent-args">Agent Args</Label>
              <Textarea
                id="agent-args"
                class="h-20 font-mono text-sm"
                placeholder='e.g. --model gpt-5 --max-tokens 2048 or ["--model","gpt-5"]'
                value={sessionStore.state.newSessionArgs}
                onInput={(e) => {
                  sessionStore.setNewSessionArgs(e.currentTarget.value);
                }}
              />
              <p class="text-xs text-muted-foreground">
                Passed to the agent process. Supports JSON array or
                space-separated args.
              </p>
            </div>
          </Show>

          <div class="mt-8 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                sessionStore.closeNewSessionModal();
                sessionStore.setConnectionError(null);
                sessionStore.setSessionTicket("");
                sessionStore.setNewSessionArgs("");
              }}
            >
              Cancel
            </Button>
            <Show
              when={isConnectingToNew()}
              fallback={
                <Button
                  type="button"
                  variant="default"
                  onClick={() => sessionStore.handleCreateSession()}
                  disabled={
                    !sessionStore.state.newSessionPath.trim() ||
                    sessionStore.state.isStartingAgent
                  }
                  loading={sessionStore.state.isStartingAgent}
                >
                  <Show
                    when={sessionStore.state.isStartingAgent}
                    fallback={<span>Create Session</span>}
                  >
                    Creating...
                  </Show>
                </Button>
              }
            >
              <Button
                type="button"
                variant="default"
                onClick={() => sessionStore.handleRemoteConnect()}
                disabled={
                  !sessionStore.state.sessionTicket.trim() ||
                  sessionStore.state.isConnecting
                }
                loading={sessionStore.state.isConnecting}
              >
                <Show
                  when={sessionStore.state.isConnecting}
                  fallback={<span>Connect</span>}
                >
                  Connecting...
                </Show>
              </Button>
            </Show>
          </div>
        </div>
      </Dialog>
    </Show>
  );
};
