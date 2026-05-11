import type {
  SystemEventMessage,
  FileOperationMessage,
  UsageUpdateMessage,
  SessionLifecycleMessage,
} from "@/types/api";
import {
  Info,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  FileText,
  Gauge,
  Play,
  Square,
} from "lucide-react";
import { getEventPresentation } from "@/lib/event-presentation";

interface SystemEventBlockProps {
  message:
    | SystemEventMessage
    | FileOperationMessage
    | UsageUpdateMessage
    | SessionLifecycleMessage;
}

const levelIcons = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle2,
};

const levelColors = {
  info: "text-[var(--app-hint)] bg-[var(--app-subtle-bg)]",
  warning: "text-amber-500 bg-amber-500/10",
  error: "text-red-500 bg-red-500/10",
  success: "text-green-500 bg-green-500/10",
};

export function SystemEventBlock({ message }: SystemEventBlockProps) {
  if (message.type === "fileOperation") {
    const m = message as FileOperationMessage;
    return (
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--app-subtle-bg)] px-3 py-1 text-xs text-[var(--app-hint)]">
          <FileText className="h-3 w-3" />
          <span className="capitalize">{m.operation}</span>
          <span className="font-mono text-[10px] opacity-70">{m.path}</span>
          {m.status && <span className="text-green-500">{m.status}</span>}
        </div>
      </div>
    );
  }

  if (message.type === "usage") {
    const m = message as UsageUpdateMessage;
    const parts: string[] = [];
    if (typeof m.inputTokens === "number")
      parts.push(`in ${m.inputTokens.toLocaleString()}`);
    if (typeof m.outputTokens === "number")
      parts.push(`out ${m.outputTokens.toLocaleString()}`);
    if (typeof m.cachedTokens === "number" && m.cachedTokens > 0)
      parts.push(`cached ${m.cachedTokens.toLocaleString()}`);
    if (typeof m.modelContextWindow === "number") {
      const pct =
        typeof m.inputTokens === "number"
          ? Math.round((m.inputTokens / m.modelContextWindow) * 100)
          : 0;
      parts.push(`context ${pct}%`);
    }

    return (
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--app-subtle-bg)] px-3 py-1 text-xs text-[var(--app-hint)]">
          <Gauge className="h-3 w-3" />
          {parts.join(" · ")}
        </div>
      </div>
    );
  }

  if (message.type === "lifecycle") {
    const m = message as SessionLifecycleMessage;
    const Icon = m.event === "started" ? Play : Square;
    return (
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--app-subtle-bg)] px-3 py-1 text-xs text-[var(--app-hint)]">
          <Icon className="h-3 w-3" />
          Session {m.event}
        </div>
      </div>
    );
  }

  const m = message as SystemEventMessage;
  const presentation = getEventPresentation(m);

  return (
    <div className="flex justify-center">
      <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
        <span className="inline-flex items-center gap-1">
          {presentation.icon ? (
            <span aria-hidden="true">{presentation.icon}</span>
          ) : null}
          <span className="text-left">{presentation.text}</span>
        </span>
      </div>
    </div>
  );
}
