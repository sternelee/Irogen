/**
 * Permission History Component
 *
 * Displays completed permission requests for a session with:
 * - Status badges (Approved / ApprovedForSession / Denied / Canceled)
 * - Tool name + parameter summary
 * - Timestamp
 * - Allowed tools list (for session-level approvals)
 */

import {
  type Component,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import {
  FiCheck,
  FiX,
  FiClock,
  FiShield,
  FiChevronDown,
  FiChevronUp,
  FiRotateCcw,
  FiTerminal,
  FiFile,
  FiGlobe,
  FiEdit,
} from "solid-icons/fi";
import { sessionStore, type CompletedPermission } from "~/stores/sessionStore";
import { cn } from "~/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface PermissionHistoryProps {
  sessionId: string;
  class?: string;
}

interface PermissionHistoryItemProps {
  entry: CompletedPermission;
}

// ============================================================================
// Helpers
// ============================================================================

const statusConfig = {
  Approved: {
    label: "Approved",
    badge: "badge-success",
    icon: FiCheck,
    textColor: "text-success",
  },
  Denied: {
    label: "Denied",
    badge: "badge-error",
    icon: FiX,
    textColor: "text-error",
  },
  Canceled: {
    label: "Canceled",
    badge: "badge-ghost",
    icon: FiClock,
    textColor: "text-base-content/50",
  },
} as const;

const decisionLabel: Record<string, string> = {
  Approved: "Once",
  ApprovedForSession: "For Session",
  Abort: "Aborted",
};

const getToolIcon = (toolName: string) => {
  const lower = toolName.toLowerCase();
  if (lower.includes("bash") || lower.includes("terminal") || lower.includes("exec"))
    return FiTerminal;
  if (lower.includes("web") || lower.includes("fetch") || lower.includes("http"))
    return FiGlobe;
  if (lower.includes("edit") || lower.includes("write") || lower.includes("patch"))
    return FiEdit;
  return FiFile;
};

const formatTime = (secs: number): string => {
  const d = new Date(secs * 1000);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

const formatDate = (secs: number): string => {
  const d = new Date(secs * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const summarizeParams = (params: unknown): string => {
  if (!params) return "";
  if (typeof params === "string") return params.slice(0, 80);
  try {
    const str = JSON.stringify(params);
    return str.slice(0, 100) + (str.length > 100 ? "…" : "");
  } catch {
    return "";
  }
};

// ============================================================================
// Single History Item
// ============================================================================

const PermissionHistoryItem: Component<PermissionHistoryItemProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const config = createMemo(
    () => statusConfig[props.entry.status] ?? statusConfig.Canceled,
  );
  const ToolIcon = createMemo(() => getToolIcon(props.entry.toolName));
  const StatusIconComp = createMemo(() => config().icon);

  const isSessionApproval = () => props.entry.decision === "ApprovedForSession";
  const paramSummary = createMemo(() => summarizeParams(props.entry.toolParams));

  return (
    <div
      class={cn(
        "rounded-xl border border-base-300/50 bg-base-100/60 p-3 transition-colors hover:bg-base-100",
        props.entry.status === "Denied" && "border-error/20",
        props.entry.status === "Approved" && "border-success/20",
      )}
    >
      <div class="flex items-start gap-3">
        {/* Tool Icon */}
        <div
          class={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            props.entry.status === "Approved" && "bg-success/10",
            props.entry.status === "Denied" && "bg-error/10",
            props.entry.status === "Canceled" && "bg-base-200",
          )}
        >
          {(() => { const T = ToolIcon(); return <T size={15} class={config().textColor} />; })()}
        </div>

        {/* Content */}
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-medium text-base-content truncate font-mono">
                {props.entry.toolName}
              </span>
              {/* Decision badge */}
              <Show when={props.entry.decision}>
                <span
                  class={cn(
                    "badge badge-xs shrink-0",
                    config().badge,
                  )}
                >
                  {(() => { const S = StatusIconComp(); return <S size={9} class="mr-0.5" />; })()}
                  {decisionLabel[props.entry.decision!] ?? props.entry.decision}
                </span>
              </Show>
              <Show when={isSessionApproval()}>
                <span class="badge badge-xs badge-info">Session</span>
              </Show>
            </div>
            <span class="text-[10px] text-base-content/40 shrink-0">
              {formatDate(props.entry.completedAt)} {formatTime(props.entry.completedAt)}
            </span>
          </div>

          {/* Param summary */}
          <Show when={paramSummary()}>
            <p class="mt-0.5 text-[11px] text-base-content/50 font-mono truncate">
              {paramSummary()}
            </p>
          </Show>

          {/* Reason */}
          <Show when={props.entry.reason}>
            <p class="mt-0.5 text-[11px] text-base-content/40 italic">
              {props.entry.reason}
            </p>
          </Show>

          {/* Session allowed tools */}
          <Show when={isSessionApproval() && props.entry.allowedTools?.length}>
            <button
              type="button"
              class="mt-1 flex items-center gap-1 text-[11px] text-info hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              <FiShield size={10} />
              {props.entry.allowedTools!.length} session tool(s)
              {expanded() ? <FiChevronUp size={10} /> : <FiChevronDown size={10} />}
            </button>
            <Show when={expanded()}>
              <div class="mt-1.5 flex flex-wrap gap-1">
                <For each={props.entry.allowedTools}>
                  {(tool) => (
                    <span class="badge badge-xs badge-info badge-outline font-mono">
                      {tool}
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Permission History Panel
// ============================================================================

export const PermissionHistory: Component<PermissionHistoryProps> = (props) => {
  const [permissionState, setPermissionState] = createSignal<{
    allowedTools: string[];
    completedRequests: CompletedPermission[];
  } | null>(null);
  const [loading, setLoading] = createSignal(false);

  const reload = async () => {
    setLoading(true);
    try {
      const result = await sessionStore.loadPermissionState(props.sessionId);
      if (result) {
        setPermissionState({
          allowedTools: result.allowedTools,
          completedRequests: result.completedRequests,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  onMount(reload);

  const sorted = createMemo(() => {
    const entries = permissionState()?.completedRequests ?? [];
    return [...entries].sort((a, b) => b.completedAt - a.completedAt);
  });

  const approvedCount = createMemo(
    () => sorted().filter((e) => e.status === "Approved").length,
  );
  const deniedCount = createMemo(
    () => sorted().filter((e) => e.status === "Denied").length,
  );
  const sessionTools = createMemo(() => permissionState()?.allowedTools ?? []);

  return (
    <div class={cn("flex flex-col h-full", props.class)}>
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-base-300/50 shrink-0">
        <div>
          <h3 class="text-sm font-semibold text-base-content">Permission History</h3>
          <p class="text-[11px] text-base-content/50 mt-0.5">
            {sorted().length} requests ·{" "}
            <span class="text-success">{approvedCount()} approved</span>
            {deniedCount() > 0 && (
              <> · <span class="text-error">{deniedCount()} denied</span></>
            )}
          </p>
        </div>
        <button
          type="button"
          class={cn(
            "btn btn-ghost btn-xs btn-square rounded-lg text-base-content/50 hover:text-base-content",
            loading() && "loading loading-spinner",
          )}
          onClick={reload}
          disabled={loading()}
          title="Refresh"
        >
          {!loading() && <FiRotateCcw size={13} />}
        </button>
      </div>

      {/* Session-allowed tools summary */}
      <Show when={sessionTools().length > 0}>
        <div class="px-4 py-2.5 border-b border-base-300/50 bg-info/5 shrink-0">
          <div class="flex items-center gap-1.5 text-[11px] text-info font-medium mb-1.5">
            <FiShield size={11} />
            Session Auto-Approved Tools
          </div>
          <div class="flex flex-wrap gap-1">
            <For each={sessionTools()}>
              {(tool) => (
                <span class="badge badge-xs badge-info badge-outline font-mono">
                  {tool}
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* List */}
      <div class="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-2">
        <Show
          when={!loading()}
          fallback={
            <div class="flex items-center justify-center py-12">
              <span class="loading loading-spinner loading-sm text-base-content/30" />
            </div>
          }
        >
          <Show
            when={sorted().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-16 text-center">
                <FiShield size={32} class="text-base-content/20 mb-3" />
                <p class="text-sm text-base-content/40 font-medium">No permission history</p>
                <p class="text-xs text-base-content/30 mt-1">
                  Approved and denied requests will appear here
                </p>
              </div>
            }
          >
            <For each={sorted()}>
              {(entry) => <PermissionHistoryItem entry={entry} />}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default PermissionHistory;
