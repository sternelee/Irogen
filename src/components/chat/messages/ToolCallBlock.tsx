import { useState } from "react";
import type { ToolCallMessage } from "@/types/api";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Terminal,
} from "lucide-react";

interface ToolCallBlockProps {
  message: ToolCallMessage;
}

function formatJson(value: string | undefined): string {
  if (!value) return "{}";
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

export function ToolCallBlock({ message }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const { status, toolName, input, output, error } = message;

  const statusConfig = {
    pending: {
      icon: Clock,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
      label: "Pending",
    },
    inProgress: {
      icon: Loader2,
      color: "text-[var(--app-link)]",
      bg: "bg-[var(--app-link)]/10",
      border: "border-[var(--app-link)]/20",
      label: "Running…",
    },
    completed: {
      icon: CheckCircle,
      color: "text-green-500",
      bg: "bg-green-500/10",
      border: "border-green-500/20",
      label: "Completed",
    },
    failed: {
      icon: XCircle,
      color: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      label: "Failed",
    },
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;
  const isRunning = status === "inProgress";

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full">
        <div
          className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden`}
        >
          {/* Header */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <StatusIcon
              className={`h-4 w-4 ${config.color} ${isRunning ? "animate-spin" : ""}`}
            />
            <Wrench className="h-3.5 w-3.5 text-[var(--app-hint)]" />
            <span className="text-sm font-medium text-[var(--app-fg)]">
              {toolName}
            </span>
            <span className={`text-xs ${config.color}`}>{config.label}</span>
            <span className="ml-auto">
              {expanded ? (
                <ChevronDown className="h-4 w-4 text-[var(--app-hint)]" />
              ) : (
                <ChevronRight className="h-4 w-4 text-[var(--app-hint)]" />
              )}
            </span>
          </button>

          {/* Body */}
          {expanded && (
            <div className="px-3 pb-3 space-y-2">
              {/* Input */}
              {input && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-hint)] mb-1">
                    Input
                  </div>
                  <pre className="rounded-lg bg-[var(--app-bg)] px-3 py-2 text-xs font-mono text-[var(--app-fg)] overflow-x-auto">
                    <code className="whitespace-break">
                      {formatJson(input)}
                    </code>
                  </pre>
                </div>
              )}

              {/* Output */}
              {output && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-hint)] mb-1">
                    Output
                  </div>
                  <pre className="rounded-lg bg-[var(--app-bg)] px-3 py-2 text-xs font-mono text-[var(--app-fg)] overflow-x-auto">
                    <code className="whitespace-break">
                      {formatJson(output)}
                    </code>
                  </pre>
                </div>
              )}

              {/* Error */}
              {error && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-red-500 mb-1">
                    Error
                  </div>
                  <pre className="rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2 text-xs font-mono text-red-400 overflow-x-auto">
                    <code className="whitespace-break">{error}</code>
                  </pre>
                </div>
              )}

              {/* Terminal output embedded in tool */}
              {message.exitCode !== undefined && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--app-hint)] mb-1 flex items-center gap-1">
                    <Terminal className="h-3 w-3" />
                    Terminal
                  </div>
                  <pre className="rounded-lg bg-black/80 px-3 py-2 text-xs font-mono text-green-400 overflow-x-auto">
                    <code className="whitespace-break">
                      {formatJson(output)}
                    </code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
