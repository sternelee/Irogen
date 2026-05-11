import { useState } from "react";
import {
  Terminal,
  Smartphone,
  Monitor,
  MoreVertical,
  Pause,
  Trash2,
  Power,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { AgentSession, SessionMode } from "@/types/api";

// Agent icons by type
const agentIcons: Record<string, string> = {
  claude: "Cl",
  cursor: "Cu",
  cline: "Cn",
  pi: "Pi",
  qwen: "Qw",
  opencode: "Oc",
  gemini: "Ge",
  codex: "Cd",
  copilot: "Cp",
  qoder: "Qo",
};

const agentColors: Record<string, string> = {
  claude: "bg-orange-500",
  cursor: "bg-green-600",
  cline: "bg-blue-600",
  pi: "bg-purple-600",
  qwen: "bg-cyan-600",
  opencode: "bg-yellow-600",
  gemini: "bg-blue-500",
  codex: "bg-red-600",
  copilot: "bg-indigo-500",
  qoder: "bg-pink-600",
};

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SessionItem({
  session,
  isSelected,
  onSelect,
  onStop,
  onClose,
  onDelete,
}: {
  session: AgentSession;
  isSelected: boolean;
  onSelect: () => void;
  onStop?: () => void;
  onClose?: () => void;
  onDelete?: () => void;
}) {
  const icon = agentIcons[session.agentType] ?? "Ag";
  const color = agentColors[session.agentType] ?? "bg-gray-500";
  const osIcon =
    session.os === "linux" ? (
      <Terminal className="h-3 w-3" />
    ) : session.os === "android" || session.os === "ios" ? (
      <Smartphone className="h-3 w-3" />
    ) : (
      <Monitor className="h-3 w-3" />
    );

  const displayName =
    session.summary ??
    (session.currentDir && session.currentDir.split("/").pop()) ??
    session.sessionId.slice(0, 8);

  const [showMenu, setShowMenu] = useState(false);

  return (
    <div
      className={cn(
        "session-list-item group/item relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors",
        isSelected ? "bg-[var(--app-subtle-bg)]" : ""
      )}
    >
      {/* Click area for selection */}
      <div
        role="button"
        tabIndex={0}
        className="flex flex-1 items-start gap-2.5 min-w-0"
        onClick={onSelect}
        onKeyDown={(e) => e.key === "Enter" && onSelect()}
      >
        {/* Agent icon */}
        <div
          className={cn(
            "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white",
            color
          )}
        >
          {icon}
        </div>

        {/* Session info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate text-[var(--app-fg)]">
              {displayName}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-[var(--app-hint)] truncate">
              {session.currentDir}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1 text-[var(--app-hint)]">
              {osIcon}
              <span className="text-[10px]">{session.hostname}</span>
            </div>
            {session.gitBranch && (
              <span className="text-[10px] text-[var(--app-git-unstaged-color)]">
                {session.gitBranch}
              </span>
            )}
            <span className="text-[10px] text-[var(--app-hint)]">
              {formatTime(session.startedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Status + Actions */}
      <div className="shrink-0 flex flex-col items-end gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              session.active ? "bg-green-500" : "bg-gray-400"
            )}
          />
          <span className="text-[10px] text-[var(--app-hint)] uppercase">
            {session.mode}
          </span>
          {/* Actions menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 rounded-md text-[var(--app-hint)] hover:text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] opacity-0 group-hover/item:opacity-100 transition-opacity"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] shadow-lg py-1">
                {session.active && onStop && (
                  <button
                    type="button"
                    onClick={() => {
                      onStop();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Stop
                  </button>
                )}
                {session.active && onClose && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                  >
                    <Power className="h-3.5 w-3.5" />
                    Close Session
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      onDelete();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--app-hint)] opacity-60"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
        <path d="M8 14h8" />
        <path d="M8 17h5" />
      </svg>
      <div className="text-base font-medium text-[var(--app-fg)]">
        {t("sessions.empty.title")}
      </div>
      <div className="max-w-sm text-sm text-[var(--app-hint)]">
        {t("sessions.empty.hint")}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={onNewSession}
          className="px-4 py-1.5 text-sm rounded-lg bg-[var(--app-button)] text-[var(--app-button-text)] font-medium hover:opacity-90 transition-opacity"
        >
          {t("sessions.empty.startSession")}
        </button>
      </div>
    </div>
  );
}

export function SessionList({
  sessions,
  selectedSessionId,
  onSelect,
  onNewSession,
  onStopSession,
  onCloseSession,
  onDeleteSession,
}: {
  sessions?: AgentSession[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onStopSession?: (sessionId: string, mode: SessionMode) => void;
  onCloseSession?: (sessionId: string, mode: SessionMode) => void;
  onDeleteSession?: (sessionId: string) => void;
}) {
  const items = sessions ?? [];

  // Group sessions by project
  const groups = (() => {
    const map = new Map<
      string,
      { directory: string; sessions: AgentSession[] }
    >();
    for (const s of items) {
      const dir = s.projectPath
        ? s.projectPath.split("/").slice(0, -1).join("/") || "Other"
        : "Other";
      if (!map.has(dir)) {
        map.set(dir, { directory: dir, sessions: [] });
      }
      map.get(dir)!.sessions.push(s);
    }
    return Array.from(map.values());
  })();

  if (items.length === 0) {
    return <EmptyState onNewSession={onNewSession} />;
  }

  return (
    <div className="pb-4">
      {groups.map((group) => (
        <div key={group.directory}>
          <div className="px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-wider text-[var(--app-hint)] font-medium">
              {group.directory}
            </span>
          </div>
          {group.sessions.map((session) => (
            <SessionItem
              key={session.sessionId}
              session={session}
              isSelected={selectedSessionId === session.sessionId}
              onSelect={() => onSelect(session.sessionId)}
              onStop={
                onStopSession
                  ? () => onStopSession(session.sessionId, session.mode ?? "local")
                  : undefined
              }
              onClose={
                onCloseSession
                  ? () => onCloseSession(session.sessionId, session.mode ?? "local")
                  : undefined
              }
              onDelete={
                onDeleteSession
                  ? () => onDeleteSession(session.sessionId)
                  : undefined
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
