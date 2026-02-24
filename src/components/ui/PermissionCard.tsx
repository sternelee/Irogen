import { createMemo, Show } from "solid-js";
import { Card, CardContent, CardHeader } from "./Card";
import { Button } from "./primitives";

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

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    return date.toLocaleTimeString();
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
      <CardHeader
        title={permission.tool_name}
        description={`Requested ${formatTimestamp(permission.created_at)}`}
        action={
          <Show when={permission.message}>
            <span class="text-xs text-muted-foreground">
              {permission.message}
            </span>
          </Show>
        }
      />
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
