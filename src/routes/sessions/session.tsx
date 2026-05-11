import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { useSessionStore } from "@/lib/session-store";
import { useTranslation } from "@/hooks/useTranslation";
import { createUserMessage } from "@/lib/chat-reducer";
import { ChatThread } from "@/components/chat/ChatThread";
import { ChatComposer } from "@/components/chat/ChatComposer";
import {
  sendAgentMessage,
  localSendAgentMessage,
  abortAgentAction,
  localAbortAgentAction,
  closeAgentSession,
  localCloseAgentSession,
  setAgentMode,
  localSetAgentMode,
  setAgentModel,
  localSetAgentModel,
  setPermissionMode,
  localSetPermissionMode,
  getAgentStatus,
  localGetAgentStatus,
  getAgentLifecycle,
  localGetAgentLifecycle,
  respondToAgentPermission,
  localRespondToAgentPermission,
} from "@/lib/tauri-api";
import {
  ArrowLeft,
  RefreshCw,
  Power,
  FolderOpen,
  GitBranch,
} from "lucide-react";
import { FileBrowserDialog } from "@/components/FileBrowserDialog";
import { GitStatusDialog } from "@/components/GitStatusDialog";
import { LoadingState } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const agentLabels: Record<string, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  cline: "Cline",
  pi: "Pi",
  qwen: "Qwen",
  copilot: "Copilot",
  qoder: "Qoder",
};

function getOutlineTitle(session: import("@/types/api").AgentSession): string {
  if (session.summary) return session.summary;
  if (session.projectPath) {
    const parts = session.projectPath.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? session.sessionId.slice(0, 8);
  }
  return session.sessionId.slice(0, 8);
}

export function SessionDetailPage() {
  const { sessionId } = useParams({ strict: false });
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    sessions,
    messagesBySession,
    permissionsBySession,
    typingBySession,
    addMessage,
    resolvePermission,
    updateSession,
    removeSession,
  } = useSessionStore();

  const [currentModel, setCurrentModel] = useState("default");
  const [currentMode, setCurrentMode] = useState("default");
  const [currentPermissionMode, setCurrentPermissionMode] = useState<import("@/types/api").PermissionMode>("alwaysAsk");
  const [statusLoading, setStatusLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<unknown>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showGitStatus, setShowGitStatus] = useState(false);

  const session = useMemo(
    () => sessions.find((s) => s.sessionId === sessionId),
    [sessions, sessionId]
  );

  // Sync local settings state when session changes
  useEffect(() => {
    if (session) {
      setCurrentModel(session.agentVersion ?? "default");
      setCurrentMode(session.mode ?? "default");
      setCurrentPermissionMode(session.permissionMode ?? "alwaysAsk");
    }
  }, [session?.sessionId]);

  const messages = useMemo(
    () => (sessionId ? messagesBySession[sessionId] ?? [] : []),
    [messagesBySession, sessionId]
  );

  const permissions = useMemo(
    () => (sessionId ? permissionsBySession[sessionId] ?? [] : []),
    [permissionsBySession, sessionId]
  );

  const isTyping = useMemo(
    () => (sessionId ? typingBySession[sessionId] ?? false : false),
    [typingBySession, sessionId]
  );

  // Extract latest usage data from messages for StatusBar
  const latestUsage = useMemo(() => {
    if (!sessionId) return null;
    const msgs = messagesBySession[sessionId] ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (msg.type === "usage") {
        return {
          inputTokens: msg.inputTokens,
          outputTokens: msg.outputTokens,
          cachedTokens: msg.cachedTokens,
          modelContextWindow: msg.modelContextWindow,
        };
      }
    }
    return null;
  }, [messagesBySession, sessionId]);

  // Refresh status when session changes
  useEffect(() => {
    if (!session || !sessionId) return;
    let cancelled = false;
    const doRefresh = async () => {
      setStatusLoading(true);
      try {
        const status =
          session.mode === "local"
            ? await localGetAgentStatus(sessionId)
            : await getAgentStatus(sessionId, session.controlSessionId);
        if (!cancelled) setAgentStatus(status);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };
    doRefresh();
    return () => {
      cancelled = true;
    };
  }, [sessionId, session?.mode, session?.controlSessionId]);

  const handleSend = useCallback(
    async (text: string, attachments?: string[]) => {
      if (!sessionId || !session) return;

      const userMsg = createUserMessage(sessionId, text, attachments);
      addMessage(sessionId, userMsg);

      try {
        if (session.mode === "local") {
          await localSendAgentMessage(sessionId, text, attachments ?? []);
        } else {
          await sendAgentMessage(
            sessionId,
            text,
            attachments ?? [],
            session.controlSessionId
          );
        }
      } catch (err) {
        console.error("Failed to send message:", err);
      }
    },
    [sessionId, session, addMessage]
  );

  const handleAbort = useCallback(async () => {
    if (!sessionId || !session) return;
    try {
      if (session.mode === "local") {
        await localAbortAgentAction(sessionId);
      } else {
        await abortAgentAction(sessionId, session.controlSessionId);
      }
    } catch (err) {
      console.error("Failed to abort:", err);
    }
  }, [sessionId, session]);

  const handleResolvePermission = useCallback(
    async (requestId: string, optionId: string) => {
      if (!sessionId || !session) return;

      const request = permissions.find((p) => p.requestId === requestId);
      if (!request) return;

      const approved = optionId.startsWith("allow");
      const approveForSession = optionId === "allow_always";

      try {
        if (session.mode === "local") {
          await localRespondToAgentPermission(
            sessionId,
            requestId,
            approved,
            approveForSession
          );
        } else {
          await respondToAgentPermission(
            sessionId,
            requestId,
            approved,
            approveForSession,
            session.controlSessionId
          );
        }
        resolvePermission(sessionId, requestId);
      } catch (err) {
        console.error("Failed to resolve permission:", err);
      }
    },
    [sessionId, session, permissions, resolvePermission]
  );

  const handleCloseSession = useCallback(async () => {
    if (!sessionId || !session) return;
    try {
      if (session.mode === "local") {
        await localCloseAgentSession(sessionId);
      } else {
        await closeAgentSession(sessionId, session.controlSessionId);
      }
      updateSession(sessionId, { active: false });
    } catch (err) {
      console.error("Failed to close session:", err);
    }
  }, [sessionId, session, updateSession]);

  const handleModelSelect = useCallback(async (value: string) => {
    if (!sessionId || !session) return;
    try {
      if (session.mode === "local") {
        await localSetAgentModel(sessionId, value);
      } else {
        await setAgentModel(sessionId, value, session.controlSessionId);
      }
      setCurrentModel(value);
      updateSession(sessionId, { agentVersion: value });
    } catch (err) {
      console.error("Failed to set model:", err);
    }
  }, [sessionId, session, updateSession]);

  const handleModeSelect = useCallback(async (value: string) => {
    if (!sessionId || !session) return;
    try {
      if (session.mode === "local") {
        await localSetAgentMode(sessionId, value);
      } else {
        await setAgentMode(sessionId, value, session.controlSessionId);
      }
      setCurrentMode(value);
      updateSession(sessionId, { mode: value as import("@/types/api").SessionMode });
    } catch (err) {
      console.error("Failed to set mode:", err);
    }
  }, [sessionId, session, updateSession]);

  const handlePermissionModeSelect = useCallback(async (value: import("@/types/api").PermissionMode) => {
    if (!sessionId || !session) return;
    try {
      if (session.mode === "local") {
        await localSetPermissionMode(sessionId, value);
      } else {
        await setPermissionMode(sessionId, value, session.controlSessionId);
      }
      setCurrentPermissionMode(value);
      updateSession(sessionId, { permissionMode: value });
    } catch (err) {
      console.error("Failed to set permission mode:", err);
    }
  }, [sessionId, session, updateSession]);

  const handleRefreshStatus = useCallback(async () => {
    if (!sessionId || !session) return;
    setStatusLoading(true);
    try {
      const status =
        session.mode === "local"
          ? await localGetAgentStatus(sessionId)
          : await getAgentStatus(sessionId, session.controlSessionId);
      setAgentStatus(status);
    } catch (err) {
      console.error("Failed to get status:", err);
    } finally {
      setStatusLoading(false);
    }
  }, [sessionId, session]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <LoadingState label="Loading session…" />
      </div>
    );
  }

  const title = getOutlineTitle(session);

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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{title}</span>
            <Badge variant={session.active ? "success" : "default"}>
              {session.active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div className="text-xs text-[var(--app-hint)] truncate">
            {agentLabels[session.agentType] ?? session.agentType}
            {" · "}
            {session.currentDir}
            {session.gitBranch ? ` · ${session.gitBranch}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefreshStatus}
            disabled={statusLoading}
            title="Refresh status"
          >
            <RefreshCw
              className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowFileBrowser(true)}
            disabled={!session.active}
            title="File browser"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowGitStatus(true)}
            disabled={!session.active}
            title="Git status"
          >
            <GitBranch className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCloseSession}
            disabled={!session.active}
            title="Close session"
          >
            <Power className="h-4 w-4 text-red-400" />
          </Button>
        </div>
      </div>

      {/* File browser dialog */}
      <FileBrowserDialog
        open={showFileBrowser}
        onOpenChange={setShowFileBrowser}
        basePath={session.projectPath}
        controlSessionId={session.controlSessionId}
      />

      {/* Git status dialog */}
      <GitStatusDialog
        open={showGitStatus}
        onOpenChange={setShowGitStatus}
        projectPath={session.projectPath}
        controlSessionId={session.controlSessionId}
      />

      {/* Chat thread */}
      <ChatThread
        messages={messages}
        permissions={permissions}
        isTyping={isTyping}
        onResolvePermission={handleResolvePermission}
      />

      {/* Composer */}
      <ChatComposer
        onSend={handleSend}
        onAbort={handleAbort}
        isRunning={isTyping}
        placeholder={
          session.active
            ? "Ask anything…"
            : "Session is inactive"
        }
        active={session.active}
        permissionCount={permissions.length}
        contextSize={latestUsage?.inputTokens ?? undefined}
        contextWindow={latestUsage?.modelContextWindow ?? null}
        permissionMode={session.permissionMode}
        model={session.agentVersion ?? null}
        agentType={session.agentType}
        settingsPanel={(
          <div>
            {/* Permission Mode */}
            <div className="py-2">
              <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                Permission Mode
              </div>
              {[
                { value: "alwaysAsk" as const, label: "Always ask" },
                { value: "acceptEdits" as const, label: "Accept edits" },
                { value: "autoApprove" as const, label: "Auto approve" },
                { value: "plan" as const, label: "Plan" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={!session.active}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    !session.active
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-[var(--app-secondary-bg)]"
                  }`}
                  onClick={() => handlePermissionModeSelect(option.value)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      currentPermissionMode === option.value
                        ? "border-[var(--app-link)]"
                        : "border-[var(--app-hint)]"
                    }`}
                  >
                    {currentPermissionMode === option.value && (
                      <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                    )}
                  </div>
                  <span className={currentPermissionMode === option.value ? "text-[var(--app-link)]" : ""}>
                    {option.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="mx-3 h-px bg-[var(--app-border)]" />

            {/* Model */}
            <div className="py-2">
              <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                Model
              </div>
              {[
                { value: "default", label: "Default (auto)" },
                { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
                { value: "claude-opus-4", label: "Claude Opus 4" },
                { value: "gpt-4o", label: "GPT-4o" },
                { value: "gpt-4o-mini", label: "GPT-4o Mini" },
                { value: "o3-mini", label: "o3-mini" },
                { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={!session.active}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    !session.active
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-[var(--app-secondary-bg)]"
                  }`}
                  onClick={() => handleModelSelect(option.value)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      currentModel === option.value
                        ? "border-[var(--app-link)]"
                        : "border-[var(--app-hint)]"
                    }`}
                  >
                    {currentModel === option.value && (
                      <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                    )}
                  </div>
                  <span className={currentModel === option.value ? "text-[var(--app-link)]" : ""}>
                    {option.label}
                  </span>
                </button>
              ))}
            </div>

            <div className="mx-3 h-px bg-[var(--app-border)]" />

            {/* Mode */}
            <div className="py-2">
              <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                Mode
              </div>
              {[
                { value: "default", label: "Default" },
                { value: "code", label: "Code" },
                { value: "plan", label: "Plan" },
                { value: "ask", label: "Ask" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={!session.active}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    !session.active
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-[var(--app-secondary-bg)]"
                  }`}
                  onClick={() => handleModeSelect(option.value)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                      currentMode === option.value
                        ? "border-[var(--app-link)]"
                        : "border-[var(--app-hint)]"
                    }`}
                  >
                    {currentMode === option.value && (
                      <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                    )}
                  </div>
                  <span className={currentMode === option.value ? "text-[var(--app-link)]" : ""}>
                    {option.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Status preview */}
            {agentStatus != null && (
              <>
                <div className="mx-3 h-px bg-[var(--app-border)]" />
                <div className="px-3 py-2">
                  <div className="pb-1 text-xs font-semibold text-[var(--app-hint)]">Status</div>
                  <pre className="whitespace-pre-wrap text-xs font-mono text-[var(--app-hint)]">
                    {JSON.stringify(agentStatus as Record<string, unknown>, null, 2)}
                  </pre>
                </div>
              </>
            )}
          </div>
        )}
      />
    </div>
  );
}
