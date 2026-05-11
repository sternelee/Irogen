import { useCallback } from "react";
import type { PermissionRequest } from "@/types/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Shield, Wrench, FileText, AlertTriangle } from "lucide-react";

interface PermissionRequestDialogProps {
  requests: PermissionRequest[];
  onResolve: (id: string, option: string) => void;
}

export function PermissionRequestDialog({
  requests,
  onResolve,
}: PermissionRequestDialogProps) {
  const handleResolve = useCallback(
    (id: string, option: string) => {
      onResolve(id, option);
    },
    [onResolve]
  );

  // Only show the first pending request (stack them)
  const pendingRequests = requests.filter((r) => r.status === "pending");
  if (pendingRequests.length === 0) return null;
  const request = pendingRequests[0];

  const toolIcon = (toolName: string) => {
    if (toolName.includes("write") || toolName.includes("file"))
      return <FileText className="h-4 w-4" />;
    if (toolName.includes("terminal") || toolName.includes("exec"))
      return <AlertTriangle className="h-4 w-4" />;
    return <Wrench className="h-4 w-4" />;
  };

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            Permission Required
          </DialogTitle>
          <DialogDescription>
            The agent wants to execute a tool. Review the request below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Tool info */}
          <div className="rounded-lg bg-[var(--app-subtle-bg)] p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--app-fg)]">
              {toolIcon(request.toolName)}
              {request.toolName}
            </div>
            {request.toolInput && (
              <pre className="mt-2 rounded bg-[var(--app-bg)] px-2 py-1.5 text-xs font-mono text-[var(--app-hint)] overflow-x-auto">
                <code>
                  {(() => {
                    try {
                      const parsed = JSON.parse(request.toolInput);
                      return JSON.stringify(parsed, null, 2);
                    } catch {
                      return request.toolInput;
                    }
                  })()}
                </code>
              </pre>
            )}
          </div>

          {/* Queue info */}
          {pendingRequests.length > 1 && (
            <div className="text-xs text-[var(--app-hint)] text-center">
              +{pendingRequests.length - 1} more pending
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {request.options.map((opt) => (
            <Button
              key={opt.optionId}
              variant={opt.optionId.startsWith("allow") ? "default" : "outline"}
              size="sm"
              onClick={() => handleResolve(request.requestId, opt.optionId)}
              className={opt.optionId.startsWith("allow") ? "bg-green-600 hover:bg-green-700" : ""}
            >
              {opt.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
