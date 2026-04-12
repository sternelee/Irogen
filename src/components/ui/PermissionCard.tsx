/**
 * Permission Card Component - DaisyUI v5
 *
 * Features:
 * - DaisyUI card, badge, btn classes throughout
 * - Keyboard shortcuts (y to allow, n to deny)
 * - Syntax highlighting for parameters
 * - "Remember this choice" checkbox
 * - Better mobile responsiveness
 * - Estimated danger level indicator
 */

import { createMemo, Show, type Component, onMount, onCleanup, createSignal } from "solid-js";
import { cn } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "./primitives";
import { Button } from "./primitives";
import {
  FiShield,
  FiCheck,
  FiX,
  FiLoader,
  FiAlertTriangle,
  FiAlertCircle,
  FiEdit,
  FiFile,
  FiTerminal,
  FiGlobe,
  FiLock,
} from "solid-icons/fi";
import { SolidMarkdown } from "solid-markdown";

// Types matching Rust backend
type PermissionMode = "AlwaysAsk" | "AcceptEdits" | "AutoApprove" | "Plan";

type ApprovalDecision = "Approved" | "ApprovedForSession" | "Abort";

interface PendingPermission {
  request_id: string;
  session_id: string;
  tool_name: string;
  tool_params: unknown;
  message?: string;
  created_at: number;
  response_tx?: unknown;
}

interface PermissionCardProps {
  permission: PendingPermission;
  disabled: boolean;
  loading?: boolean;
  permissionMode: PermissionMode;
  onApprove: (decision?: ApprovalDecision) => void;
  onDeny: (reason?: string) => void;
}

// ============================================================================
// Tool Icons & Danger Level - DaisyUI Badge Style
// ============================================================================

const toolIcons: Record<string, typeof FiFile> = {
  Edit: FiEdit,
  MultiEdit: FiEdit,
  Write: FiFile,
  Read: FiFile,
  NotebookEdit: FiEdit,
  Bash: FiTerminal,
  Terminal: FiTerminal,
  WebFetch: FiGlobe,
  WebSearch: FiGlobe,
  default: FiShield,
};

const toolDangerLevels: Record<string, { level: "low" | "medium" | "high"; label: string }> = {
  Read: { level: "low", label: "Read-only" },
  WebFetch: { level: "low", label: "Network" },
  WebSearch: { level: "medium", label: "External" },
  Bash: { level: "high", label: "Shell" },
  Terminal: { level: "high", label: "Terminal" },
  Edit: { level: "medium", label: "File edit" },
  MultiEdit: { level: "medium", label: "Multi-edit" },
  Write: { level: "medium", label: "File write" },
  default: { level: "medium", label: "Tool" },
};

const dangerBadgeClass: Record<string, string> = {
  low: "badge-success",
  medium: "badge-warning",
  high: "badge-error",
};

const dangerIcon: Record<string, typeof FiAlertTriangle> = {
  low: FiCheck,
  medium: FiAlertCircle,
  high: FiAlertTriangle,
};

// ============================================================================
// Syntax Highlighted Code Block
// ============================================================================

const SyntaxHighlightedCode: Component<{ code: string; maxLines?: number }> = (props) => {
  const highlight = (code: string) => {
    try {
      const parsed = JSON.parse(code);
      const formatted = JSON.stringify(parsed, null, 2);
      return formatted
        .replace(/"([^"]+)":/g, '<span class="text-secondary font-semibold">"$1"</span>:')
        .replace(/: "([^"]+)"/g, ': <span class="text-primary">"$1"</span>')
        .replace(/: (\d+)/g, ': <span class="text-accent">$1</span>')
        .replace(/: (true|false)/g, ': <span class="text-warning">$1</span>')
        .replace(/: (null)/g, ': <span class="text-base-content/40">$1</span>');
    } catch {
      return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
  };

  const lines = props.code.split("\n");
  const maxLines = props.maxLines ?? 8;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;
  const displayCode = displayLines.join("\n");

  return (
    <div class="relative">
      <pre
        class="overflow-x-auto rounded-lg bg-base-200/50 p-3 text-xs font-mono leading-relaxed border border-base-300"
        innerHTML={highlight(displayCode)}
      />
      <Show when={truncated}>
        <div class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-base-200/80 to-transparent pointer-events-none rounded-b-lg" />
        <div class="absolute bottom-1 left-3 text-[10px] text-base-content/40">
          +{lines.length - maxLines} more
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Permission Card Component
// ============================================================================

function PermissionCard(props: PermissionCardProps) {
  const [rememberChoice, setRememberChoice] = createSignal(false);

  const toolIcon = createMemo(() => toolIcons[props.permission.tool_name] || toolIcons.default);
  const dangerInfo = createMemo(() => toolDangerLevels[props.permission.tool_name] || toolDangerLevels.default);
  const Icon = toolIcon();
  const DangerIcon = dangerIcon[dangerInfo().level];

  const shouldShowAllowForSession = createMemo(() => {
    const hideForTools = ["Edit", "MultiEdit", "Write", "NotebookEdit", "exit_plan_mode", "ExitPlanMode"];
    return !hideForTools.includes(props.permission.tool_name) && props.permissionMode !== "AutoApprove";
  });

  const shouldShowAllowAllEdits = createMemo(() => {
    return ["Edit", "MultiEdit", "Write"].includes(props.permission.tool_name) && props.permissionMode === "AcceptEdits";
  });

  const formatToolInput = (input: unknown): string => {
    if (!input) return "No parameters";
    if (typeof input === "string") return input;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  // Keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (props.disabled || props.loading) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key.toLowerCase() === "y" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        props.onApprove("Approved");
      } else if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        props.onDeny();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <Card class={cn(
      "border-l-4 border-l-warning",
      "transition-all duration-200"
    )}>
      <CardHeader class="pb-2">
        <div class="flex items-start gap-3">
          {/* Tool Icon */}
          <div class={cn(
            "shrink-0 p-2.5 rounded-xl",
            "bg-warning/10 text-warning"
          )}>
            <Icon size={18} />
          </div>

          {/* Title & Tool Name */}
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-semibold text-sm">{props.permission.tool_name}</h3>
              {/* Danger Level Badge - DaisyUI badge */}
              <span class={cn("badge badge-sm gap-1", dangerBadgeClass[dangerInfo().level])}>
                <DangerIcon size={10} />
                {dangerInfo().label}
              </span>
            </div>
            <p class="text-xs text-base-content/50 mt-0.5">
              Permission request • {new Date(props.permission.created_at).toLocaleTimeString()}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent class="space-y-3">
        {/* Message/Description */}
        <Show when={props.permission.message}>
          <div class="text-sm text-base-content/70 bg-base-200/30 rounded-lg p-3">
            <SolidMarkdown children={props.permission.message} />
          </div>
        </Show>

        {/* Tool Parameters */}
        <Show when={props.permission.tool_params}>
          <div>
            <div class="mb-1.5 text-xs font-medium text-base-content/50 flex items-center gap-1.5">
              <FiLock size={10} />
              Parameters
            </div>
            <SyntaxHighlightedCode code={formatToolInput(props.permission.tool_params)} />
          </div>
        </Show>

        {/* Remember Choice Checkbox */}
        <Show when={!props.loading}>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rememberChoice()}
              onChange={(e) => setRememberChoice(e.currentTarget.checked)}
              class="checkbox checkbox-sm checkbox-primary"
            />
            <span class="text-xs text-base-content/60">Remember this choice</span>
          </label>
        </Show>

        {/* Action Buttons - DaisyUI btn classes */}
        <Show when={!props.loading}>
          <div class="flex flex-col sm:flex-row gap-2 pt-1">
            <Button
              variant="success"
              size="sm"
              class="flex-1"
              disabled={props.disabled}
              onClick={() => props.onApprove("Approved")}
            >
              <FiCheck class="w-4 h-4 mr-1" />
              Allow
              <kbd class="kbd kbd-xs ml-auto">Y</kbd>
            </Button>

            <Show when={shouldShowAllowForSession()}>
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                disabled={props.disabled}
                onClick={() => props.onApprove("ApprovedForSession")}
              >
                Session
              </Button>
            </Show>

            <Show when={shouldShowAllowAllEdits()}>
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                disabled={props.disabled}
                onClick={() => props.onApprove("Approved")}
              >
                Allow All
              </Button>
            </Show>

            <Button
              variant="destructive"
              size="sm"
              class="flex-1"
              disabled={props.disabled}
              onClick={() => props.onDeny()}
            >
              <FiX class="w-4 h-4 mr-1" />
              Deny
              <kbd class="kbd kbd-xs ml-auto">N</kbd>
            </Button>
          </div>
        </Show>

        {/* Loading State */}
        <Show when={props.loading}>
          <div class="flex items-center justify-center py-4 gap-2">
            <span class="loading loading-spinner loading-sm text-primary" />
            <span class="text-sm text-base-content/60">Waiting for response...</span>
          </div>
        </Show>

        {/* Keyboard Hint */}
        <Show when={!props.loading && !props.disabled}>
          <div class="text-xs text-base-content/30 text-center">
            Press <kbd class="kbd kbd-xs">Y</kbd> or <kbd class="kbd kbd-xs">N</kbd>
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Permission List Component
// ============================================================================

interface PermissionListProps {
  permissions: PendingPermission[];
  disabled: boolean;
  permissionMode: PermissionMode;
  onApprove: (requestId: string, decision?: ApprovalDecision) => void;
  onDeny: (requestId: string, reason?: string) => void;
}

export function PermissionList(props: PermissionListProps) {
  if (props.permissions.length === 0) {
    return (
      <div class="flex flex-col items-center justify-center py-12 text-base-content/50">
        <div class="p-4 bg-base-200/50 rounded-full mb-4">
          <FiShield size={32} />
        </div>
        <p class="text-sm">No pending permissions</p>
      </div>
    );
  }

  return (
    <div class="space-y-3">
      {props.permissions.map((permission) => (
        <PermissionCard
          permission={permission}
          disabled={props.disabled}
          loading={false}
          permissionMode={props.permissionMode}
          onApprove={(decision) => props.onApprove(permission.request_id, decision)}
          onDeny={(reason) => props.onDeny(permission.request_id, reason)}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Permission Message (inline in message list)
// ============================================================================

export interface PermissionMessageProps {
  toolName: string;
  toolParams?: unknown;
  message?: string;
  requestId: string;
  permissionMode: PermissionMode;
  disabled?: boolean;
  onApprove: (decision?: ApprovalDecision) => void;
  onDeny: () => void;
}

export const PermissionMessage: Component<PermissionMessageProps> = (props) => {
  const formatToolInput = (input: unknown): string => {
    if (!input) return "";
    if (typeof input === "string") return input;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  const showAllowForSession = createMemo(() => {
    const hideForTools = ["Edit", "MultiEdit", "Write", "NotebookEdit", "exit_plan_mode", "ExitPlanMode"];
    return !hideForTools.includes(props.toolName) && props.permissionMode !== "AutoApprove";
  });

  const dangerInfo = createMemo(() => toolDangerLevels[props.toolName] || toolDangerLevels.default);
  const DangerIcon = dangerIcon[dangerInfo().level];

  return (
    <div class={cn(
      "chat-bubble bg-warning/10 border border-warning/20",
      "rounded-2xl px-4 py-3 max-w-[85%] sm:max-w-[80%]"
    )}>
      {/* Header */}
      <div class="flex items-center gap-2 mb-2">
        <div class="rounded-lg bg-warning/20 p-1.5 text-warning">
          <FiShield size={14} />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">Permission Required</div>
          <div class="text-xs text-base-content/50 truncate">{props.toolName}</div>
        </div>
        <span class={cn("badge badge-xs gap-1", dangerBadgeClass[dangerInfo().level])}>
          <DangerIcon size={8} />
          {dangerInfo().label}
        </span>
      </div>

      {/* Message */}
      <Show when={props.message}>
        <div class="mb-2 text-sm text-base-content/70">
          <SolidMarkdown children={props.message} />
        </div>
      </Show>

      {/* Tool Parameters */}
      <Show when={props.toolParams}>
        <div class="mb-2">
          <div class="text-[10px] font-medium text-base-content/40 mb-1 flex items-center gap-1">
            <FiLock size={8} />
            Parameters
          </div>
          <pre class="overflow-x-auto rounded bg-base-300/50 p-2 text-[11px] font-mono max-h-24">
            {formatToolInput(props.toolParams)}
          </pre>
        </div>
      </Show>

      {/* Action Buttons */}
      <Show when={!props.disabled}>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="success"
            size="sm"
            class="flex-1 min-w-[80px]"
            onClick={() => props.onApprove("Approved")}
          >
            <FiCheck class="w-3 h-3 mr-1" />
            Allow
            <kbd class="kbd kbd-xs ml-auto">Y</kbd>
          </Button>

          <Show when={showAllowForSession()}>
            <Button
              variant="outline"
              size="sm"
              class="flex-1 min-w-[80px]"
              onClick={() => props.onApprove("ApprovedForSession")}
            >
              Session
            </Button>
          </Show>

          <Button
            variant="destructive"
            size="sm"
            class="flex-1 min-w-[80px]"
            onClick={props.onDeny}
          >
            <FiX class="w-3 h-3 mr-1" />
            Deny
            <kbd class="kbd kbd-xs ml-auto">N</kbd>
          </Button>
        </div>
      </Show>

      <Show when={props.disabled}>
        <div class="flex items-center justify-center py-2 gap-2 text-base-content/50">
          <span class="loading loading-spinner loading-sm" />
          <span class="text-xs">Waiting...</span>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// User Question Message (inline selection)
// ============================================================================

export interface UserQuestionMessageProps {
  question: string;
  options: string[];
  questionId: string;
  disabled?: boolean;
  onSelect: (option: string) => void;
}

export const UserQuestionMessage: Component<UserQuestionMessageProps> = (props) => {
  return (
    <div class="chat-bubble bg-info/10 border border-info/20 rounded-2xl px-4 py-3 max-w-[85%] sm:max-w-[80%]">
      {/* Header */}
      <div class="flex items-center gap-2 mb-2">
        <div class="rounded-lg bg-info/20 p-1.5 text-info">
          <FiLoader size={14} />
        </div>
        <div class="font-medium text-sm">Question</div>
      </div>

      {/* Question */}
      <div class="mb-3 text-sm text-base-content/70">
        <SolidMarkdown children={props.question} />
      </div>

      {/* Options */}
      <Show when={!props.disabled}>
        <div class="flex flex-col gap-2">
          {props.options.map((option, index) => (
            <Button
              variant="outline"
              size="sm"
              class="w-full justify-start text-left"
              onClick={() => props.onSelect(option)}
            >
              <span class="mr-2 text-base-content/50 font-medium">
                {String.fromCharCode(65 + index)}.
              </span>
              <span class="truncate">{option}</span>
            </Button>
          ))}
        </div>
      </Show>

      <Show when={props.disabled}>
        <div class="flex items-center justify-center py-2 gap-2 text-base-content/50">
          <span class="loading loading-spinner loading-sm" />
          <span class="text-xs">Waiting for response...</span>
        </div>
      </Show>
    </div>
  );
};