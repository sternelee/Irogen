import { useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useAppContext } from "@/lib/app-context";
import { useSessionStore } from "@/lib/session-store";
import { useTranslation } from "@/hooks/useTranslation";
import {
  localStartAgent,
  connectToHost,
  initializeNetwork,
  remoteSpawnSession,
  installAcpPackageLocal,
  installAcpPackageRemote,
} from "@/lib/tauri-api";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { ArrowLeft, Loader2, Wand2, Plug, Wifi, CheckCircle, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentType, PermissionMode, SessionMode } from "@/types/api";

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
  { value: "gemini", label: "Gemini" },
  { value: "opencode", label: "OpenCode" },
  { value: "cline", label: "Cline" },
  { value: "pi", label: "Pi" },
  { value: "qwen", label: "Qwen" },
  { value: "copilot", label: "Copilot" },
  { value: "qoder", label: "Qoder" },
];

const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: "alwaysAsk", label: "Always ask" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "autoApprove", label: "Auto approve" },
  { value: "plan", label: "Plan" },
];

export function NewSessionPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { invoke, deviceInfo } = useAppContext();
  const { addSession } = useSessionStore();

  // Basic options
  const [agentType, setAgentType] = useState<AgentType>("claude");
  const [projectPath, setProjectPath] = useState("");
  const [mode, setMode] = useState<SessionMode>(deviceInfo.isMobile ? "remote" : "local");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("alwaysAsk");
  const [model, setModel] = useState("");
  const [mcpServers, setMcpServers] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [maxTurns, setMaxTurns] = useState("");
  const [additionalPaths, setAdditionalPaths] = useState("");

  // ACP installation
  const [installAcpState, setInstallAcpState] = useState<"idle" | "installing" | "success" | "error">("idle");
  const [installAcpError, setInstallAcpError] = useState<string | null>(null);

  // Remote connection
  const [sessionTicket, setSessionTicket] = useState("");
  const [connectionSessionId, setConnectionSessionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await invoke<string[]>("plugin:dialog|open", {
        options: { directory: true, multiple: false },
      });
      if (selected && selected.length > 0) {
        setProjectPath(selected[0]);
      }
    } catch {
      // Dialog cancelled or not supported
    }
  }, [invoke]);

  const handleCreateLocal = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    try {
      const extraArgs: string[] = [];
      if (permissionMode === "acceptEdits") {
        extraArgs.push("--accept-edits");
      } else if (permissionMode === "autoApprove") {
        extraArgs.push("--auto-approve");
      } else if (permissionMode === "plan") {
        extraArgs.push("--plan");
      }
      if (model.trim()) {
        extraArgs.push("--model");
        extraArgs.push(model.trim());
      }
      if (maxTurns.trim()) {
        extraArgs.push("--max-turns");
        extraArgs.push(maxTurns.trim());
      }
      if (allowedTools.trim()) {
        extraArgs.push("--allowed-tools");
        extraArgs.push(allowedTools.trim());
      }

      const additionalProjectPaths = additionalPaths
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const mcpConfig = mcpServers.trim()
        ? (JSON.parse(mcpServers.trim()) as Record<string, unknown>)
        : undefined;

      const sessionId = await localStartAgent({
        agentType,
        projectPath,
        extraArgs,
        mcpServers: mcpConfig,
        additionalProjectPaths: additionalProjectPaths.length > 0 ? additionalProjectPaths : undefined,
      });

      // Optimistically add session to store
      const session = {
        sessionId,
        agentType,
        projectPath,
        additionalProjectPaths: additionalProjectPaths.length > 0 ? additionalProjectPaths : [],
        startedAt: Date.now(),
        active: true,
        controlledByRemote: false,
        hostname: deviceInfo.os,
        os: deviceInfo.os,
        currentDir: projectPath,
        machineId: "local",
        mode: "local" as const,
        lastReceivedSequence: 0,
        permissionMode,
      };

      flushSync(() => addSession(session));
      navigate({ to: "/sessions/$sessionId", params: { sessionId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }, [
    agentType,
    projectPath,
    permissionMode,
    model,
    maxTurns,
    allowedTools,
    additionalPaths,
    mcpServers,
    deviceInfo,
    addSession,
    navigate,
  ]);

  const handleCreateRemote = useCallback(async () => {
    if (!sessionTicket.trim()) {
      setError("Session ticket is required for remote mode");
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      // Ensure network is initialized
      await initializeNetwork();

      // Connect to remote host
      const remoteConnId = await connectToHost(sessionTicket.trim());

      const args: string[] = [];
      if (permissionMode === "acceptEdits") {
        args.push("--accept-edits");
      } else if (permissionMode === "autoApprove") {
        args.push("--auto-approve");
      } else if (permissionMode === "plan") {
        args.push("--plan");
      }
      if (model.trim()) {
        args.push("--model");
        args.push(model.trim());
      }
      if (maxTurns.trim()) {
        args.push("--max-turns");
        args.push(maxTurns.trim());
      }
      if (allowedTools.trim()) {
        args.push("--allowed-tools");
        args.push(allowedTools.trim());
      }

      const mcpConfig = mcpServers.trim()
        ? (JSON.parse(mcpServers.trim()) as Record<string, unknown>)
        : undefined;

      const agentSessionId = await remoteSpawnSession({
        connectionSessionId: remoteConnId,
        agentType: agentType,
        projectPath,
        args,
        mcpServers: mcpConfig,
      });

      const session = {
        sessionId: agentSessionId,
        agentType,
        projectPath,
        additionalProjectPaths: [],
        startedAt: Date.now(),
        active: true,
        controlledByRemote: true,
        hostname: "remote",
        os: "remote",
        currentDir: projectPath,
        machineId: "remote",
        mode: "remote" as const,
        lastReceivedSequence: 0,
        permissionMode,
      };

      flushSync(() => addSession(session));
      navigate({ to: "/sessions/$sessionId", params: { sessionId: agentSessionId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }, [
    sessionTicket,
    agentType,
    projectPath,
    permissionMode,
    model,
    maxTurns,
    allowedTools,
    mcpServers,
    addSession,
    navigate,
  ]);

  const handleInstallAcp = useCallback(async () => {
    setInstallAcpState("installing");
    setInstallAcpError(null);
    try {
      if (mode === "remote") {
        if (!connectionSessionId) {
          throw new Error("Please connect to a remote host first");
        }
        await installAcpPackageRemote(connectionSessionId, agentType);
      } else {
        await installAcpPackageLocal(agentType);
      }
      setInstallAcpState("success");
      setTimeout(() => setInstallAcpState("idle"), 3000);
    } catch (err) {
      setInstallAcpState("error");
      setInstallAcpError(err instanceof Error ? err.message : String(err));
    }
  }, [mode, agentType, connectionSessionId]);

  const handleCreate = useCallback(async () => {
    if (!projectPath.trim()) return;
    if (mode === "local") {
      await handleCreateLocal();
    } else {
      await handleCreateRemote();
    }
  }, [mode, projectPath, handleCreateLocal, handleCreateRemote]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => navigate({ to: "/sessions" })}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 font-semibold">{t("newSession.title")}</div>
      </div>

      {/* Form */}
      <div className="app-scroll-y flex-1 min-h-0">
        <div className="mx-auto max-w-content p-4 space-y-6">
          {/* Error banner */}
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Agent selector */}
          <section>
            <label className="text-sm font-medium block mb-2">Agent Type</label>
            <div className="flex flex-wrap gap-2">
              {AGENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAgentType(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    agentType === opt.value
                      ? "bg-[var(--app-button)] text-[var(--app-button-text)]"
                      : "border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Mode selector */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Mode</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleInstallAcp}
                disabled={installAcpState === "installing" || (mode === "remote" && !connectionSessionId)}
                className="gap-1.5"
                title="Install ACP package for the selected agent"
              >
                {installAcpState === "installing" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : installAcpState === "success" ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <PackagePlus className="h-3.5 w-3.5" />
                )}
                {installAcpState === "installing"
                  ? "Installing ACP…"
                  : installAcpState === "success"
                    ? "ACP Installed"
                    : "Install ACP"}
              </Button>
            </div>
            <div className="flex gap-2">
              {(["local", "remote"] as SessionMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                    mode === m
                      ? "bg-[var(--app-button)] text-[var(--app-button-text)]"
                      : "border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            {installAcpState === "error" && installAcpError && (
              <div className="mt-2 text-xs text-red-400">{installAcpError}</div>
            )}
            {installAcpState === "success" && (
              <div className="mt-2 text-xs text-green-500">ACP package installed successfully</div>
            )}
          </section>

          {/* Remote: Session ticket */}
          {mode === "remote" && (
            <section className="space-y-3">
              <label className="text-sm font-medium block">
                Session Ticket
              </label>
              <input
                type="text"
                value={sessionTicket}
                onChange={(e) => {
                  setSessionTicket(e.target.value);
                  setConnectionState("idle");
                  setConnectionError(null);
                }}
                placeholder="Paste the session ticket from remote host…"
                className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-2.5 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
              />
              <div className="text-xs text-[var(--app-hint)]">
                Paste the ticket displayed by the remote CLI (iroh ticket format)
              </div>

              {/* Connection status */}
              {connectionState === "connecting" && (
                <div className="flex items-center gap-2 text-xs text-[var(--app-link)]">
                  <Wifi className="h-3.5 w-3.5 animate-pulse" />
                  Connecting to remote host…
                </div>
              )}
              {connectionState === "connected" && (
                <div className="flex items-center gap-2 text-xs text-green-500">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Connected successfully
                </div>
              )}
              {connectionError && (
                <div className="text-xs text-red-400">{connectionError}</div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!sessionTicket.trim()) return;
                  setConnectionState("connecting");
                  setConnectionError(null);
                  try {
                    await initializeNetwork();
                    const sid = await connectToHost(sessionTicket.trim());
                    setConnectionSessionId(sid);
                    setConnectionState("connected");
                  } catch (err) {
                    setConnectionState("error");
                    setConnectionError(
                      err instanceof Error ? err.message : String(err)
                    );
                  }
                }}
                disabled={!sessionTicket.trim() || connectionState === "connecting"}
                className="gap-1.5"
              >
                <Plug className="h-3.5 w-3.5" />
                {connectionState === "connected" ? "Reconnect" : "Connect"}
              </Button>
            </section>
          )}

          {/* Project path */}
          <section>
            <label className="text-sm font-medium block mb-2">Project Path</label>
            <DirectoryPicker
              value={projectPath}
              onChange={setProjectPath}
              placeholder="/path/to/project"
              connectionSessionId={mode === "remote" ? connectionSessionId : null}
            />
          </section>

          {/* Advanced options toggle */}
          <section>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-sm text-[var(--app-link)] hover:underline"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {showAdvanced ? "Hide advanced options" : "Show advanced options"}
            </button>
          </section>

          {/* Advanced options */}
          {showAdvanced && (
            <div className="space-y-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/30 p-4">
              {/* Permission mode */}
              <div>
                <label className="text-sm font-medium block mb-2">
                  Permission Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PERMISSION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPermissionMode(opt.value)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                        permissionMode === opt.value
                          ? "bg-[var(--app-button)] text-[var(--app-button-text)]"
                          : "border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="text-sm font-medium block mb-2">Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. claude-sonnet-4, gpt-4, gemini-2.5-pro"
                  className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-2 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                />
              </div>

              {/* Max turns */}
              <div>
                <label className="text-sm font-medium block mb-2">Max Turns</label>
                <input
                  type="number"
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(e.target.value)}
                  placeholder="Unlimited"
                  className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-2 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                />
              </div>

              {/* Allowed tools */}
              <div>
                <label className="text-sm font-medium block mb-2">
                  Allowed Tools
                </label>
                <input
                  type="text"
                  value={allowedTools}
                  onChange={(e) => setAllowedTools(e.target.value)}
                  placeholder="Comma-separated: read_file,write_file,terminal"
                  className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-2 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                />
              </div>

              {/* MCP Servers */}
              <div>
                <label className="text-sm font-medium block mb-2">
                  MCP Servers (JSON)
                </label>
                <textarea
                  value={mcpServers}
                  onChange={(e) => setMcpServers(e.target.value)}
                  placeholder='{"mcpServers": {"github": {"command": "npx", "args": ["-y", "@anthropic/mcp-github"]}}}'
                  rows={3}
                  className="w-full resize-none rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-2 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)] font-mono"
                />
              </div>

              {/* Additional project paths */}
              <div>
                <label className="text-sm font-medium block mb-2">
                  Additional Project Paths
                </label>
                <input
                  type="text"
                  value={additionalPaths}
                  onChange={(e) => setAdditionalPaths(e.target.value)}
                  placeholder="Comma-separated additional project directories"
                  className="w-full rounded-xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-4 py-2 text-sm text-[var(--app-fg)] placeholder:text-[var(--app-hint)] outline-none focus:border-[var(--app-link)]"
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleCreate}
              disabled={!projectPath.trim() || isCreating}
              className="flex-1"
            >
              {isCreating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating…
                </span>
              ) : (
                "Create Session"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/sessions" })}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
