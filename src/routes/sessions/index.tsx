import { useCallback, useEffect } from "react";
import {
  Outlet,
  useLocation,
  useMatchRoute,
  useNavigate,
} from "@tanstack/react-router";
import { SessionList } from "@/components/SessionList";
import { useSessionStore } from "@/lib/session-store";
import { useTranslation } from "@/hooks/useTranslation";
import {
  localStopAgent,
  closeAgentSession,
  localCloseAgentSession,
  disconnectSession,
  localListAgents,
  remoteListAgents,
} from "@/lib/tauri-api";
import { Plus, Settings, FolderOpen, RefreshCw } from "lucide-react";
import type { SessionMode } from "@/types/api";

function SessionsPage() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const matchRoute = useMatchRoute();
  const { t } = useTranslation();
  const {
    sessions,
    addSession,
    removeSession,
    updateSession,
    getConnectedHosts,
  } = useSessionStore();

  const projectCount =
    new Set(sessions.map((s) => s.projectPath ?? "").filter(Boolean)).size;

  const sessionMatch = matchRoute({
    to: "/sessions/$sessionId",
    fuzzy: true,
  });
  const selectedSessionId =
    sessionMatch && sessionMatch.sessionId !== "new"
      ? sessionMatch.sessionId
      : null;
  const isSessionsIndex =
    pathname === "/sessions" || pathname === "/sessions/";

  const handleStopSession = useCallback(
    async (sessionId: string, mode: SessionMode) => {
      try {
        if (mode === "local") {
          await localStopAgent(sessionId);
        }
        // Remote sessions can't be "stopped" directly — just mark inactive
        updateSession(sessionId, { active: false });
      } catch (err) {
        console.error("Failed to stop session:", err);
      }
    },
    [updateSession]
  );

  const handleCloseSession = useCallback(
    async (sessionId: string, mode: SessionMode) => {
      try {
        if (mode === "local") {
          await localCloseAgentSession(sessionId);
        } else {
          await closeAgentSession(sessionId);
        }
        updateSession(sessionId, { active: false });
      } catch (err) {
        console.error("Failed to close session:", err);
      }
    },
    [updateSession]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const session = sessions.find((s) => s.sessionId === sessionId);
        if (session?.mode === "remote") {
          await disconnectSession(sessionId);
        } else if (session?.active) {
          await localStopAgent(sessionId);
        }
        removeSession(sessionId);
      } catch (err) {
        console.error("Failed to delete session:", err);
      }
    },
    [sessions, removeSession]
  );

  // Refresh session list from local + every connected remote host.
  const refreshSessions = useCallback(async () => {
    type RemoteMeta = Awaited<ReturnType<typeof remoteListAgents>>[number];
    const upsert = (
      meta: RemoteMeta,
      mode: SessionMode,
      controlSessionId?: string,
      machineId: string = "local"
    ) => {
      const existing = sessions.find((s) => s.sessionId === meta.sessionId);
      if (!existing) {
        addSession({
          sessionId: meta.sessionId ?? "",
          agentType: meta.agentType as import("@/types/api").AgentType,
          projectPath: meta.projectPath ?? meta.currentDir ?? "",
          additionalProjectPaths: [],
          startedAt: meta.startedAt ?? Date.now(),
          active: meta.active ?? true,
          controlledByRemote: meta.controlledByRemote ?? mode === "remote",
          hostname: meta.hostname ?? mode,
          os: meta.os ?? "unknown",
          currentDir: meta.currentDir ?? meta.projectPath ?? "",
          machineId,
          mode,
          controlSessionId,
          lastReceivedSequence: 0,
          agentVersion: meta.agentVersion,
        });
      } else {
        updateSession(meta.sessionId, {
          active: meta.active,
          currentDir: meta.currentDir,
          agentVersion: meta.agentVersion,
        });
      }
    };

    // Local
    try {
      const localSessions = await localListAgents();
      for (const meta of localSessions) {
        upsert(meta, "local");
      }
    } catch {
      // ignore
    }

    // Remote — one query per connected host, isolated failures
    const hosts = getConnectedHosts();
    await Promise.all(
      hosts.map(async (host) => {
        try {
          const remoteSessions = await remoteListAgents(host.controlSessionId);
          for (const meta of remoteSessions) {
            upsert(meta, "remote", host.controlSessionId, host.machineId);
          }
        } catch {
          // ignore individual host failures so others still refresh
        }
      })
    );
  }, [sessions, addSession, updateSession, getConnectedHosts]);

  // Refresh once on mount.
  useEffect(() => {
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0">
      {/* Session list sidebar */}
      <div
        className={`${
          isSessionsIndex ? "flex" : "hidden lg:flex"
        } w-full shrink-0 flex-col bg-[var(--app-bg)]`}
      >
        <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
          <div className="mx-auto w-full flex items-center justify-between px-3 py-2">
            <div className="text-xs text-[var(--app-hint)]">
              {t("sessions.count", {
                n: sessions.length,
                m: projectCount,
              })}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                title={t("browse.nav")}
              >
                <FolderOpen className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => void refreshSessions()}
                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => navigate({ to: "/settings" })}
                className="p-1.5 rounded-full text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                title={t("settings.title")}
              >
                <Settings className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => navigate({ to: "/sessions/new" })}
                className="p-1.5 rounded-full text-[var(--app-link)] transition-colors session-list-new-button"
                title={t("sessions.new")}
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="app-scroll-y flex-1 min-h-0">
          <SessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelect={(sessionId) =>
              navigate({
                to: "/sessions/$sessionId",
                params: { sessionId },
              })
            }
            onNewSession={() => navigate({ to: "/sessions/new" })}
            onStopSession={handleStopSession}
            onCloseSession={handleCloseSession}
            onDeleteSession={handleDeleteSession}
          />
        </div>
      </div>

      {/* Resize handle - desktop only */}
      <div className="sidebar-resize-handle hidden lg:block shrink-0" />

      {/* Content area */}
      <div
        className={`${
          isSessionsIndex ? "hidden lg:flex" : "flex"
        } min-w-0 flex-1 flex-col bg-[var(--app-bg)]`}
      >
        <div className="flex-1 min-h-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export { SessionsPage };
