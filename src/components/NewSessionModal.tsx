/**
 * NewSessionModal Component
 *
 * Global modal for creating new AI agent sessions (local or remote).
 * Managed by sessionStore for global accessibility.
 */

import {
  Show,
  createEffect,
  createMemo,
  For,
  type Component,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { FiPlus, FiHome, FiCloud, FiDownload } from "solid-icons/fi";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  checkPermissions,
  Format,
  requestPermissions,
  scan,
} from "@tauri-apps/plugin-barcode-scanner";
// import { openUrl } from "@tauri-apps/plugin-opener";
// import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { sessionStore, AgentType } from "../stores/sessionStore";
import { isMobile } from "../stores/deviceStore";
import { notificationStore } from "../stores/notificationStore";
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

interface RemoteConnectionOption {
  controlSessionId: string;
  hostname: string;
}

export const NewSessionModal: Component = () => {
  const [dirEntries, setDirEntries] = createSignal<DirEntry[]>([]);
  const [rawDirEntries, setRawDirEntries] = createSignal<DirEntry[]>([]);
  const [listedDirectory, setListedDirectory] = createSignal<string>("");
  const [currentRequestId, setCurrentRequestId] = createSignal<string | null>(
    null,
  );
  const [isInstallingAcp, setIsInstallingAcp] = createSignal(false);
  const [isAdvancedExpanded, setIsAdvancedExpanded] = createSignal(false);

  let unlistenDirListing: UnlistenFn | null = null;

  onMount(async () => {
    // Listen for remote directory listing responses
    unlistenDirListing = await listen<{ entries: RemoteDirEntry[] }>(
      "remote-directory-listing",
      (event) => {
        const requestId = currentRequestId();
        if (!requestId) return;

        const entries = event.payload.entries || [];
        const toName = (e: string | RemoteDirEntry) => {
          if (typeof e === "string") return e;
          if (Array.isArray((e as any).name?.Unix)) {
            return String.fromCharCode(...((e as any).name.Unix as number[]));
          }
          return String(e.name ?? "");
        };

        const dirs = entries
          .filter((e) => (typeof e === "string" ? true : e.is_dir))
          .map((e) => ({
            name: toName(e),
            path: "", // Remote doesn't provide full path
            is_dir: true,
          }))
          .filter((e) => e.name && !e.name.startsWith("."));
        setRawDirEntries(dirs);

        const query = getPathQueryParts(sessionStore.state.newSessionPath);
        const filtered =
          query && query.dirToList === listedDirectory()
            ? filterDirEntriesByPartial(dirs, query.partialName)
            : dirs;
        setDirEntries(filtered);
      },
    );

    // On mobile, get the app directory as default path
    if (isMobile()) {
      try {
        const appDir = "~";
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
    const query = getPathQueryParts(path);
    if (!query) {
      setDirEntries([]);
      setRawDirEntries([]);
      setListedDirectory("");
      return;
    }

    const { dirToList, partialName } = query;
    const shouldReuseCurrentList =
      listedDirectory() === dirToList && rawDirEntries().length > 0;

    if (shouldReuseCurrentList) {
      setDirEntries(filterDirEntriesByPartial(rawDirEntries(), partialName));
      return;
    }

    setListedDirectory(dirToList);

    // Check if we have an active remote session
    const targetSessionId = sessionStore.state.targetControlSessionId || null;
    const remoteSession =
      remoteConnections().find(
        (connection) => connection.controlSessionId === targetSessionId,
      ) || remoteConnections()[0];
    const isRemote =
      sessionStore.state.newSessionMode === "remote" &&
      (!!targetSessionId || !!remoteSession);

    if (isRemote) {
      // Use P2P to list remote directory
      const controlSessionId =
        remoteSession?.controlSessionId || targetSessionId;
      try {
        const requestId = await invoke<string>("list_remote_directory", {
          sessionId: controlSessionId,
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
        const dirs = entries.filter((e) => e.is_dir && !e.name.startsWith("."));
        const filtered = filterDirEntriesByPartial(dirs, partialName);
        setRawDirEntries(dirs);
        setDirEntries(filtered);
      } catch (err) {
        console.error("Failed to list directory:", err);
        setRawDirEntries([]);
        setDirEntries([]);
      }
    }
  };

  const getPathQueryParts = (path: string) => {
    // Only start directory suggestions once user starts typing nested paths.
    if (!path.includes("/")) {
      return null;
    }

    const lastSlashIndex = path.lastIndexOf("/");
    const dirToList = path.slice(0, lastSlashIndex + 1) || "/";
    const partialName = path.slice(lastSlashIndex + 1);
    return { dirToList, partialName };
  };

  const filterDirEntriesByPartial = (
    entries: DirEntry[],
    partialName: string,
  ) => {
    const keyword = partialName.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(keyword));
  };

  const remoteConnections = createMemo<RemoteConnectionOption[]>(() => {
    const seen = new Set<string>();
    const connections: RemoteConnectionOption[] = [];

    for (const session of sessionStore.getSessions()) {
      if (
        session.mode !== "remote" ||
        !session.active ||
        !session.controlSessionId
      ) {
        continue;
      }
      if (seen.has(session.controlSessionId)) {
        continue;
      }
      seen.add(session.controlSessionId);
      connections.push({
        controlSessionId: session.controlSessionId,
        hostname: session.hostname || "Remote Host",
      });
    }

    return connections;
  });

  const isConnectingToNew = () =>
    sessionStore.state.newSessionMode === "remote" &&
    !sessionStore.state.targetControlSessionId;

  const remoteControlSessionId = () =>
    sessionStore.state.newSessionMode === "remote"
      ? sessionStore.state.targetControlSessionId
      : null;

  const showAgentConfig = () =>
    sessionStore.state.newSessionMode === "local" || !!remoteControlSessionId();

  createEffect(() => {
    if (!isMobile() || !sessionStore.state.isNewSessionModalOpen) return;

    if (sessionStore.state.newSessionMode !== "remote") {
      sessionStore.setNewSessionMode("remote");
      sessionStore.setConnectionError(null);
    }

    if (!sessionStore.state.targetControlSessionId) {
      const connections = remoteConnections();
      if (connections.length > 0) {
        sessionStore.setTargetControlSessionId(connections[0].controlSessionId);
      }
    }
  });

  const agentArgsConfig = createMemo(() => {
    const agent = sessionStore.state.newSessionAgent;

    switch (agent) {
      case "codex":
        return {
          supported: true,
          placeholder:
            'e.g. --model gpt-5 --profile default or ["--model","gpt-5"]',
          hint: "Passed to Codex CLI. Supports JSON array or space-separated args.",
        };
      case "claude":
        return {
          supported: true,
          placeholder:
            'e.g. --model sonnet --allowedTools "Read,Edit" or ["--model","sonnet"]',
          hint: "Passed to Claude Code process. Supports JSON array or space-separated args.",
        };
      case "gemini":
        return {
          supported: true,
          placeholder:
            'e.g. --model gemini-2.5-pro --yolo or ["--model","gemini-2.5-pro"]',
          hint: "Passed to Gemini CLI process. Supports JSON array or space-separated args.",
        };
      case "cursor":
        return {
          supported: true,
          placeholder:
            'e.g. --sandbox danger-full-access or ["--sandbox","danger-full-access"]',
          hint: "Passed to Cursor ACP process (`cursor-agent acp`). Supports JSON array or space-separated args.",
        };
      case "opencode":
        return {
          supported: true,
          placeholder:
            'e.g. --model gpt-5 --provider openai or ["--model","gpt-5"]',
          hint: "Passed to OpenCode process. Supports JSON array or space-separated args.",
        };
      case "openclaw":
        return {
          supported: false,
          placeholder: "",
          hint: "OpenClaw does not support custom Agent Args.",
        };
      default:
        return {
          supported: true,
          placeholder:
            'e.g. --model gpt-5 --max-tokens 2048 or ["--model","gpt-5"]',
          hint: "Passed to the agent process. Supports JSON array or space-separated args.",
        };
    }
  });

  const handleScanBarcode = async () => {
    try {
      let permissionStatus = await checkPermissions();
      if (permissionStatus !== "granted") {
        permissionStatus = await requestPermissions();
      }

      if (permissionStatus !== "granted") {
        notificationStore.error(
          "Camera permission is required to scan QR codes",
          "Scan Error",
        );
        return;
      }

      const result = await scan({ formats: [Format.QRCode] });
      if (result?.content) {
        sessionStore.setSessionTicket(result.content);
        sessionStore.setConnectionError(null);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Scan error:", error);
      notificationStore.error(`Scan failed: ${msg}`, "Scan Error");
    }
  };

  return (
    <Show when={sessionStore.state.isNewSessionModalOpen}>
      <Dialog
        open={sessionStore.state.isNewSessionModalOpen}
        onClose={() => sessionStore.closeNewSessionModal()}
        contentClass="max-w-md max-h-[90%] overflow-auto"
      >
        <div>
          <h3 class="font-semibold text-base mb-3 flex items-center gap-2">
            <FiPlus size={18} />
            New Session
          </h3>

          {/* Mode Toggle */}
          <div class="hidden sm:flex gap-2 mb-4">
            <Button
              type="button"
              size="sm"
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
                    connections[0].controlSessionId,
                  );
                }
              }}
            >
              <FiCloud class="mr-1.5" /> Remote
            </Button>
            <Button
              type="button"
              size="sm"
              class="hidden flex-1 sm:inline-flex"
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
              <FiHome class="mr-1.5" /> Local
            </Button>
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
                    <option value={conn.controlSessionId}>
                      {conn.hostname} ({conn.controlSessionId.slice(0, 8)})
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
              <div class="flex items-center justify-between gap-2">
                <Label for="session-ticket">Session Ticket</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="sm:hidden"
                  onClick={handleScanBarcode}
                >
                  Scan QR
                </Button>
              </div>
              <Textarea
                id="session-ticket"
                class="h-20 font-mono text-sm"
                placeholder="Paste session ticket..."
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

          {/* Remote Mode: Connected Summary */}
          <Show
            when={
              sessionStore.state.newSessionMode === "remote" &&
              !!remoteControlSessionId()
            }
          >
            <Alert variant="info" class="mb-3 py-1.5">
              <div class="flex items-center justify-between gap-2 w-full">
                <span class="text-xs">
                  Remote: {(remoteControlSessionId() || "").slice(0, 8)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    sessionStore.setTargetControlSessionId(null);
                    sessionStore.setConnectionError(null);
                  }}
                >
                  Change
                </Button>
              </div>
            </Alert>
          </Show>

          {/* Agent Config (Local or Remote with active connection) */}
          <Show when={showAgentConfig()}>
            <div class="space-y-3">
              <div class="space-y-1">
                <Label for="agent-type" class="text-xs">
                  Agent
                </Label>
                <Select
                  id="agent-type"
                  class="select-sm"
                  value={sessionStore.state.newSessionAgent}
                  onChange={(val) => {
                    const nextAgent = val as AgentType;
                    sessionStore.setNewSessionAgent(nextAgent);
                    if (nextAgent === "openclaw") {
                      sessionStore.setNewSessionArgs("");
                    }
                  }}
                >
                  <Show
                    when={
                      sessionStore.state.newSessionMode === "local" &&
                      isMobile()
                    }
                    fallback={
                      <>
                        <option value="claude">Claude Code</option>
                        <option value="codex">Codex</option>
                        <option value="cursor">Cursor</option>
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

              {/* ACP Install Button */}
              <Show
                when={
                  sessionStore.state.newSessionAgent === "codex" ||
                  sessionStore.state.newSessionAgent === "opencode" ||
                  sessionStore.state.newSessionAgent === "claude" ||
                  sessionStore.state.newSessionAgent === "gemini"
                }
              >
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  class="w-full"
                  disabled={isInstallingAcp()}
                  loading={isInstallingAcp()}
                  onClick={async () => {
                    setIsInstallingAcp(true);
                    try {
                      if (sessionStore.state.newSessionMode === "remote") {
                        // Remote mode: send P2P message to CLI
                        const targetSessionId =
                          sessionStore.state.targetControlSessionId;
                        if (!targetSessionId) {
                          notificationStore.error(
                            "No remote connection selected",
                            "Installation Error",
                          );
                          return;
                        }
                        await invoke("install_acp_package_remote", {
                          sessionId: targetSessionId,
                          agentType: sessionStore.state.newSessionAgent,
                        });
                      } else {
                        // Local mode: install directly
                        await invoke("install_acp_package_local", {
                          agentType: sessionStore.state.newSessionAgent,
                        });
                      }
                      notificationStore.success(
                        `${sessionStore.state.newSessionAgent.toUpperCase()} ACP installed`,
                        "Done",
                      );
                    } catch (error) {
                      const msg =
                        error instanceof Error ? error.message : String(error);
                      console.error("Failed to install ACP:", error);
                      notificationStore.error(`Failed: ${msg}`, "Error");
                    } finally {
                      setIsInstallingAcp(false);
                    }
                  }}
                >
                  <Show when={!isInstallingAcp()}>
                    <FiDownload class="mr-1.5 size-3" />
                  </Show>
                  <Show
                    when={isInstallingAcp()}
                    fallback="Install / Upgrade ACP"
                  >
                    Installing...
                  </Show>
                </Button>
              </Show>
            </div>

            <div class="space-y-1.5">
              <Label for="project-path" class="text-xs">
                Path
              </Label>
              <Combobox
                value={sessionStore.state.newSessionPath}
                onChange={(value) => {
                  sessionStore.setNewSessionPath(value);
                }}
                onInputChange={(value) => {
                  sessionStore.setNewSessionPath(value);
                  if (value.includes("/")) {
                    loadDirectory(value);
                  } else {
                    setDirEntries([]);
                    setRawDirEntries([]);
                    setListedDirectory("");
                  }
                }}
                items={dirEntries().map((e) => {
                  const query = getPathQueryParts(
                    sessionStore.state.newSessionPath,
                  );
                  const basePath = query?.dirToList || "";
                  return {
                    value: basePath + e.name,
                    label: e.name,
                  };
                })}
                placeholder="Project path"
                class="font-mono text-sm"
              />
              <p class="text-xs text-muted-foreground">
                Type path to autocomplete
              </p>
            </div>

            <Show
              when={
                agentArgsConfig().supported ||
                sessionStore.state.newSessionAgent !== "openclaw"
              }
              fallback={<div class="h-4" />}
            >
              <div class="space-y-3">
                <button
                  type="button"
                  class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded())}
                >
                  <span
                    class={`text-xs transition-transform ${isAdvancedExpanded() ? "rotate-90" : ""}`}
                  >
                    ▶
                  </span>
                  <span class="font-medium">Advanced Options</span>
                </button>
                <Show when={isAdvancedExpanded()}>
                  <Show when={agentArgsConfig().supported}>
                    <div class="space-y-1.5">
                      <Label for="agent-args" class="text-xs">
                        Agent Args
                      </Label>
                      <Textarea
                        id="agent-args"
                        class="h-16 text-sm"
                        placeholder={agentArgsConfig().placeholder}
                        value={sessionStore.state.newSessionArgs}
                        onInput={(e) => {
                          sessionStore.setNewSessionArgs(e.currentTarget.value);
                        }}
                      />
                      <p class="text-xs text-muted-foreground">
                        {agentArgsConfig().hint}
                      </p>
                    </div>
                  </Show>
                  <Show
                    when={sessionStore.state.newSessionAgent !== "openclaw"}
                  >
                    <div class="space-y-1.5">
                      <Label for="mcp-servers" class="text-xs">
                        MCP Servers
                      </Label>
                      <Textarea
                        id="mcp-servers"
                        class="h-16 text-xs"
                        placeholder='[{"type":"stdio","name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}]'
                        value={sessionStore.state.newSessionMcpServers}
                        onInput={(e) => {
                          sessionStore.setNewSessionMcpServers(
                            e.currentTarget.value,
                          );
                        }}
                      />
                      <p class="text-xs text-muted-foreground">
                        ACP `mcpServers` JSON array
                      </p>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </Show>

          <div class="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                sessionStore.closeNewSessionModal();
                sessionStore.setConnectionError(null);
                sessionStore.setNewSessionArgs("");
                sessionStore.setNewSessionMcpServers("");
                setIsAdvancedExpanded(false);
              }}
            >
              Cancel
            </Button>
            <Show
              when={isConnectingToNew()}
              fallback={
                <Button
                  type="button"
                  size="sm"
                  onClick={() => sessionStore.handleCreateSession()}
                  disabled={
                    !sessionStore.state.newSessionPath.trim() ||
                    sessionStore.state.isStartingAgent
                  }
                  loading={sessionStore.state.isStartingAgent}
                >
                  <Show
                    when={sessionStore.state.isStartingAgent}
                    fallback={<span>Create</span>}
                  >
                    Creating...
                  </Show>
                </Button>
              }
            >
              <Button
                type="button"
                size="sm"
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
