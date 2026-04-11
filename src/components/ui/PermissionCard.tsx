import { createMemo, Show, type Component } from "solid-js";
import { Card, CardContent, CardHeader } from "./Card";
import { Button } from "./primitives";
import { FiShield, FiCheck, FiX, FiLoader } from "solid-icons/fi";
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

function PermissionCard(props: PermissionCardProps) {
  const { permission, disabled, loading, permissionMode, onApprove, onDeny } =
    props;

  const shouldShowAllowForSession = createMemo(() => {
    // Hide "Allow for Session" for certain tools
    const hideForTools = [
      "Edit",
      "MultiEdit",
      "Write",
      "NotebookEdit",
      "exit_plan_mode",
      "ExitPlanMode",
    ];
    return (
      !hideForTools.includes(permission.tool_name) &&
      permissionMode !== "AutoApprove"
    );
  });

  const shouldShowAllowAllEdits = createMemo(() => {
    const isEditTool = ["Edit", "MultiEdit", "Write"].includes(
      permission.tool_name,
    );
    return isEditTool && permissionMode === "AcceptEdits";
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

  const handleApprove = () => {
    onApprove("Approved");
  };

  const handleApproveForSession = () => {
    onApprove("ApprovedForSession");
  };

  const handleAllowAllEdits = () => {
    // This would change permission mode to AcceptEdits
    onApprove("Approved");
  };

  const handleDeny = () => {
    onDeny();
  };

  return (
    <Card class="border-l-4 border-l-amber-500">
      <CardHeader title={permission.tool_name} />
      <CardContent class="space-y-3">
        <Show when={permission.tool_params}>
          <div>
            <div class="mb-1 text-xs font-medium text-muted-foreground">
              Parameters
            </div>
            <pre class="overflow-x-auto rounded bg-muted p-2 text-xs font-mono">
              {formatToolInput(permission.tool_params)}
            </pre>
          </div>
        </Show>

        <Show when={!loading}>
          <div class="flex flex-col gap-1.5">
            <Button
              variant="default"
              size="sm"
              class="w-full"
              disabled={disabled}
              onClick={handleApprove}
            >
              Allow
            </Button>

            <Show when={shouldShowAllowForSession()}>
              <Button
                variant="outline"
                size="sm"
                class="w-full"
                disabled={disabled}
                onClick={handleApproveForSession}
              >
                Allow for Session
              </Button>
            </Show>

            <Show when={shouldShowAllowAllEdits()}>
              <Button
                variant="outline"
                size="sm"
                class="w-full"
                disabled={disabled}
                onClick={handleAllowAllEdits}
              >
                Allow All Edits
              </Button>
            </Show>

            <Button
              variant="destructive"
              size="sm"
              class="w-full"
              disabled={disabled}
              onClick={handleDeny}
            >
              Deny
            </Button>
          </div>
        </Show>

        <Show when={loading}>
          <div class="flex items-center justify-center py-4">
            <div class="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </Show>
      </CardContent>
    </Card>
  );
}

interface PermissionListProps {
  permissions: PendingPermission[];
  disabled: boolean;
  permissionMode: PermissionMode;
  onApprove: (requestId: string, decision?: ApprovalDecision) => void;
  onDeny: (requestId: string, reason?: string) => void;
}

export function PermissionList(props: PermissionListProps) {
  const { permissions, disabled, permissionMode, onApprove, onDeny } = props;

  if (permissions.length === 0) {
    return (
      <div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <svg
          class="mb-4 h-12 w-12 text-muted-foreground"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2h2a1 1 0 100 2v2a1 1 0 011 1.575 5 5 0 10 0-1 1.575V7a1 1 0 00-1-1h-1.5a1 1 0 00-1 1zm2.5 6a1 1 0 100 2h-2a1 1 0 100-2h2zM7 2a1 1 0 00-1 1v2h5V3a1 1 0 00-1-1H7z"
            clip-rule="evenodd"
          />
        </svg>
        <p class="text-sm">No pending permissions</p>
      </div>
    );
  }

  return (
    <div class="space-y-3">
      {permissions.map((permission) => (
        <PermissionCard
          permission={permission}
          disabled={disabled}
          permissionMode={permissionMode}
          onApprove={(decision) => onApprove(permission.request_id, decision)}
          onDeny={(reason) => onDeny(permission.request_id, reason)}
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
    const hideForTools = [
      "Edit",
      "MultiEdit",
      "Write",
      "NotebookEdit",
      "exit_plan_mode",
      "ExitPlanMode",
    ];
    return (
      !hideForTools.includes(props.toolName) &&
      props.permissionMode !== "AutoApprove"
    );
  });

  return (
    <div class="chat-bubble bg-warning/10 border border-warning/20 rounded-2xl px-4 py-3 max-w-[85%] sm:max-w-[80%]">
      {/* Header */}
      <div class="flex items-center gap-2 mb-2">
        <div class="rounded-lg bg-warning/20 p-1.5 text-warning">
          <FiShield size={14} />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-medium text-sm">Permission Required</div>
          <div class="text-xs text-base-content/50 truncate">{props.toolName}</div>
        </div>
      </div>

      {/* Message/Description */}
      <Show when={props.message}>
        <div class="mb-2 text-sm text-base-content/70">
          <SolidMarkdown children={props.message} />
        </div>
      </Show>

      {/* Tool Parameters */}
      <Show when={props.toolParams}>
        <div class="mb-2">
          <div class="text-[10px] font-medium text-base-content/40 mb-1">
            Parameters
          </div>
          <pre class="overflow-x-auto rounded bg-base-300/50 p-2 text-[11px] font-mono max-h-24">
            {formatToolInput(props.toolParams)}
          </pre>
        </div>
      </Show>

      {/* Action Buttons */}
      <Show when={!props.disabled}>
        <div class="flex flex-wrap gap-1.5 sm:gap-2">
          <Button
            variant="default"
            size="sm"
            class="flex-1 min-w-0 px-2 sm:px-3 h-8"
            onClick={() => props.onApprove("Approved")}
          >
            <FiCheck size={12} class="mr-0.5 shrink-0" />
            <span class="text-[11px] sm:text-xs truncate">Allow</span>
          </Button>

          <Show when={showAllowForSession()}>
            <Button
              variant="outline"
              size="sm"
              class="flex-1 min-w-0 px-2 sm:px-3 h-8"
              onClick={() => props.onApprove("ApprovedForSession")}
            >
              <span class="text-[11px] sm:text-xs truncate">Allow for Session</span>
            </Button>
          </Show>

          <Button
            variant="destructive"
            size="sm"
            class="flex-1 min-w-0 px-2 sm:px-3 h-8"
            onClick={props.onDeny}
          >
            <FiX size={12} class="mr-0.5 shrink-0" />
            <span class="text-[11px] sm:text-xs truncate">Deny</span>
          </Button>
        </div>
      </Show>

      <Show when={props.disabled}>
        <div class="flex items-center justify-center py-2 text-base-content/50">
          <FiLoader size={14} class="animate-spin mr-2" />
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

export const UserQuestionMessage: Component<UserQuestionMessageProps> = (
  props,
) => {
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
              class="w-full justify-start text-left h-9 px-3"
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
        <div class="flex items-center justify-center py-2 text-base-content/50">
          <FiLoader size={14} class="animate-spin mr-2" />
          <span class="text-xs">Waiting for response...</span>
        </div>
      </Show>
    </div>
  );
};
