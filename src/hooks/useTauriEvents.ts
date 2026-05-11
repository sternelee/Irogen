import { useEffect } from "react";
import { useAppContext } from "@/lib/app-context";
import { useSessionStore } from "@/lib/session-store";
import { useNavigate } from "@tanstack/react-router";
import type {
  AgentType,
  AcpEvent,
  PermissionRequest,
  PermissionOption,
} from "@/types/api";

function parseAgentType(agentTypeStr: string): AgentType {
  const lower = agentTypeStr.toLowerCase().replace(/-/g, "_");
  if (lower.includes("claude")) return "claude";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("cline")) return "cline";
  if (lower === "pi" || lower.startsWith("pi_")) return "pi";
  if (lower.includes("qwen")) return "qwen";
  if (lower.includes("open")) return "opencode";
  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("codex")) return "codex";
  if (lower.includes("copilot")) return "copilot";
  if (lower.includes("qoder")) return "qoder";
  return "claude";
}

const DEFAULT_PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", kind: "allow_once", label: "Allow once" },
  { optionId: "allow_always", kind: "allow_always", label: "Always allow" },
  { optionId: "reject_once", kind: "reject_once", label: "Reject" },
  { optionId: "reject_always", kind: "reject_always", label: "Always reject" },
];

/**
 * Convert legacy agent-message payload to ACP events.
 *
 * DEBUG: logs every incoming payload to help diagnose event format issues.
 */
function legacyPayloadToAcpEvents(
  payload: Record<string, unknown>
): { events: AcpEvent[]; permission: PermissionRequest | null } {
  console.log("[TauriEvent] legacyPayloadToAcpEvents raw:", JSON.stringify(payload));

  const sessionId = (payload.sessionId as string) ?? "";
  const type = payload.type as string;
  const events: AcpEvent[] = [];
  let permission: PermissionRequest | null = null;

  switch (type) {
    case "text_delta": {
      // Backend sends "text" but legacy code might send "content" — accept both
      const text =
        (payload.text as string) ??
        (payload.content as string) ??
        "";
      const turnId = payload.turnId as string | undefined;
      console.log("[TauriEvent] text_delta text=", text.substring(0, 80), "turnId=", turnId);
      if (payload.thinking) {
        events.push({ type: "reasoning:delta", session_id: sessionId, turn_id: turnId, text });
      } else {
        events.push({ type: "text:delta", session_id: sessionId, turn_id: turnId, text });
      }
      break;
    }

    case "reasoning_delta": {
      const text =
        (payload.text as string) ??
        (payload.content as string) ??
        "";
      const turnId = payload.turnId as string | undefined;
      console.log("[TauriEvent] reasoning_delta text=", text.substring(0, 80), "turnId=", turnId);
      events.push({ type: "reasoning:delta", session_id: sessionId, turn_id: turnId, text });
      break;
    }

    case "response": {
      const text = (payload.content as string) ?? "";
      const turnId = payload.turnId as string | undefined;
      console.log("[TauriEvent] response text=", text.substring(0, 80), "turnId=", turnId);
      if (text) {
        events.push({ type: "text:delta", session_id: sessionId, turn_id: turnId, text });
        events.push({ type: "turn:completed", session_id: sessionId, turn_id: turnId });
      }
      break;
    }

    case "turn_started": {
      console.log("[TauriEvent] turn_started");
      events.push({
        type: "turn:started",
        session_id: sessionId,
        turn_id: payload.turnId as string | undefined,
      });
      break;
    }

    case "turn_completed": {
      console.log("[TauriEvent] turn_completed");
      events.push({
        type: "turn:completed",
        session_id: sessionId,
        turn_id: payload.turnId as string | undefined,
      });
      break;
    }

    case "turn_error": {
      console.log("[TauriEvent] turn_error");
      events.push({
        type: "turn:error",
        session_id: sessionId,
        turn_id: payload.turnId as string | undefined,
        error: payload.error,
      });
      break;
    }

    case "tool_started": {
      const toolName = (payload.toolName as string) ?? "tool";
      const toolId = (payload.toolId as string) ?? `${toolName}-${Date.now()}`;
      console.log("[TauriEvent] tool_started", toolName);
      events.push({
        type: "tool:started",
        session_id: sessionId,
        tool_id: toolId,
        tool_name: toolName,
        input: payload.input ? JSON.stringify(payload.input) : undefined,
      });
      break;
    }

    case "tool_input_updated": {
      const toolName = (payload.toolName as string) ?? "tool";
      const toolId = (payload.toolId as string) ?? `${toolName}-${Date.now()}`;
      console.log("[TauriEvent] tool_input_updated", toolName);
      events.push({
        type: "tool:inputUpdated",
        session_id: sessionId,
        tool_id: toolId,
        tool_name: toolName,
        input: payload.input ? JSON.stringify(payload.input) : undefined,
      });
      break;
    }

    case "tool_completed": {
      const toolName = (payload.toolName as string) ?? "tool";
      const toolId = (payload.toolId as string) ?? `${toolName}-${Date.now()}`;
      const output = payload.output ? JSON.stringify(payload.output) : undefined;
      const error = payload.error as string | undefined;
      console.log("[TauriEvent] tool_completed", toolName, error ? "error" : "ok");
      events.push({
        type: "tool:completed",
        session_id: sessionId,
        tool_id: toolId,
        tool_name: toolName,
        output,
        error,
      });
      break;
    }

    case "tool_call": {
      // Old P2P format — fallback
      const toolName = (payload.toolName as string) ?? "tool";
      const status = (payload.status as string) ?? "";
      const output = payload.output ? String(payload.output) : undefined;
      const toolId = `${toolName}-${Date.now()}`;
      console.log("[TauriEvent] tool_call (legacy)", toolName, status);

      if (status === "Started" || status === "started") {
        events.push({
          type: "tool:started",
          session_id: sessionId,
          tool_id: toolId,
          tool_name: toolName,
        });
      } else if (status === "InProgress" || status === "inProgress") {
        events.push({
          type: "tool:inputUpdated",
          session_id: sessionId,
          tool_id: toolId,
          tool_name: toolName,
          input: payload.input,
        });
      } else if (status === "Completed" || status === "completed") {
        events.push({
          type: "tool:completed",
          session_id: sessionId,
          tool_id: toolId,
          tool_name: toolName,
          output,
        });
      } else if (status === "Failed" || status === "failed") {
        events.push({
          type: "tool:completed",
          session_id: sessionId,
          tool_id: toolId,
          tool_name: toolName,
          error: output ?? "Tool execution failed",
        });
      }
      break;
    }

    case "usage_update": {
      console.log("[TauriEvent] usage_update");
      events.push({
        type: "usage:update",
        session_id: sessionId,
        input_tokens: payload.inputTokens as number | undefined,
        output_tokens: payload.outputTokens as number | undefined,
        cached_tokens: payload.cachedTokens as number | undefined,
        model_context_window: payload.modelContextWindow as number | undefined,
      });
      break;
    }

    case "notification": {
      const level = (payload.level as string)?.toLowerCase() ?? "info";
      const message = (payload.message as string) ?? "";
      console.log("[TauriEvent] notification", level, message.substring(0, 60));
      events.push({
        type: "notification",
        session_id: sessionId,
        level: level as "info" | "warning" | "error" | "success",
        message,
      });
      break;
    }

    case "user_message": {
      // User messages are emitted by backend for sync; frontend can ignore
      // or treat as system event for debugging
      console.log("[TauriEvent] user_message (ignored)");
      break;
    }

    case "raw": {
      console.log("[TauriEvent] raw");
      events.push({
        type: "raw",
        session_id: sessionId,
        data: payload.data,
      });
      break;
    }

    case "approval_request":
    case "permission_request": {
      const requestId =
        (payload.requestId as string) ??
        (payload.request_id as string) ??
        `req-${Date.now()}`;
      const toolName =
        (payload.toolName as string) ??
        (payload.tool_name as string) ??
        "";
      const input = payload.input
        ? JSON.stringify(payload.input)
        : payload.toolParams
        ? JSON.stringify(payload.toolParams)
        : undefined;
      const message =
        (payload.message as string) ??
        (payload.description as string) ??
        undefined;

      console.log("[TauriEvent] permission_request", toolName);

      const rawOptions = (payload.options ??
        (payload as Record<string, unknown>)["permissionOptions"]) as
        | unknown[]
        | undefined;
      const options: PermissionOption[] =
        Array.isArray(rawOptions) && rawOptions.length > 0
          ? rawOptions
              .map((raw): PermissionOption | null => {
                const o = raw as Record<string, unknown>;
                const optionId =
                  (o.optionId as string) ??
                  (o.option_id as string) ??
                  (o.id as string);
                const kind = (o.kind as string) ?? (o.type as string);
                if (!optionId || !kind) return null;
                return {
                  optionId,
                  kind: kind as PermissionOption["kind"],
                  label: (o.label as string | undefined) ?? undefined,
                  description: (o.description as string | undefined) ?? undefined,
                };
              })
              .filter((o): o is PermissionOption => o !== null)
          : DEFAULT_PERMISSION_OPTIONS;

      permission = {
        requestId,
        sessionId,
        toolName,
        toolInput: input,
        toolParams: input,
        message,
        options: options.length > 0 ? options : DEFAULT_PERMISSION_OPTIONS,
        createdAt: Date.now(),
        status: "pending",
      };
      break;
    }

    case "session_started": {
      console.log("[TauriEvent] session_started");
      events.push({
        type: "session:started",
        session_id: sessionId,
      });
      break;
    }

    case "session_ended": {
      console.log("[TauriEvent] session_ended");
      events.push({
        type: "session:ended",
        session_id: sessionId,
      });
      break;
    }

    default:
      console.log("[TauriEvent] unknown type:", type);
      break;
  }

  console.log("[TauriEvent] converted events:", events.length, events.map((e) => e.type));
  return { events, permission };
}

export function useTauriEvents() {
  const { listen } = useAppContext();
  const navigate = useNavigate();

  const {
    addSession,
    removeConnectedHost,
    updateSession,
    updateConnectedHost,
    setConnectionState,
    applyAcpEvents,
    addPermission,
    setTyping,
  } = useSessionStore();

  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    // --- Session lifecycle ---
    listen<{
      session_id: string;
      agent_type: string;
      project_path: string;
      control_session_id?: string;
    }>("agent-session-created", (payload) => {
      console.log("[TauriEvent] agent-session-created:", payload);
      const agentType = parseAgentType(payload.agent_type);
      addSession({
        sessionId: payload.session_id,
        agentType,
        projectPath: payload.project_path,
        additionalProjectPaths: [],
        startedAt: Date.now(),
        active: true,
        controlledByRemote: true,
        hostname: "remote",
        os: "remote",
        currentDir: payload.project_path,
        machineId: payload.control_session_id ?? "remote",
        mode: "remote",
        controlSessionId: payload.control_session_id,
        lastReceivedSequence: 0,
      });
      navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: payload.session_id },
      });
    }).then((unsub) => {
      if (cancelled) unsub();
      else unsubs.push(unsub);
    });

    listen<{ sessionId: string }>("peer-disconnected", (payload) => {
      console.log("[TauriEvent] peer-disconnected:", payload);
      setConnectionState("disconnected");
      removeConnectedHost(payload.sessionId);
      updateSession(payload.sessionId, { active: false });
    }).then((unsub) => {
      if (cancelled) unsub();
      else unsubs.push(unsub);
    });

    listen<{ sessionId: string; state: string }>(
      "connection-state-changed",
      (payload) => {
        console.log("[TauriEvent] connection-state-changed:", payload);
        if (payload.state === "reconnecting") {
          setConnectionState("reconnecting");
          updateConnectedHost(payload.sessionId, { status: "reconnecting" });
        } else if (payload.state === "connected") {
          setConnectionState("connected");
          updateConnectedHost(payload.sessionId, { status: "online" });
        } else if (payload.state === "disconnected") {
          setConnectionState("disconnected");
          updateConnectedHost(payload.sessionId, { status: "offline" });
        }
      }
    ).then((unsub) => {
      if (cancelled) unsub();
      else unsubs.push(unsub);
    });

    // --- Agent message events (legacy format → ACP) ---
    listen<Record<string, unknown>>("agent-message", (payload) => {
      console.log("[TauriEvent] agent-message:", JSON.stringify(payload).slice(0, 200));
      const { events, permission } = legacyPayloadToAcpEvents(payload);
      const sessionId = (payload.sessionId as string) ?? "";

      if (events.length > 0) {
        applyAcpEvents(sessionId, events);
      }

      if (permission) {
        addPermission(sessionId, permission);
      }

      const type = payload.type as string;
      if (
        type === "text_delta" ||
        type === "turn_started" ||
        type === "tool_call"
      ) {
        setTyping(sessionId, true);
      }
      if (type === "turn_completed" || type === "turn_error") {
        setTyping(sessionId, false);
      }
    }).then((unsub) => {
      if (cancelled) unsub();
      else unsubs.push(unsub);
    });

    // --- Local agent events (desktop only) ---
    listen<Record<string, unknown>>("local-agent-event", (payload) => {
      console.log("[TauriEvent] local-agent-event:", JSON.stringify(payload).slice(0, 400));
      const sessionId = (payload.sessionId as string) ?? "";
      const innerEvent = payload.event as Record<string, unknown> | undefined;
      if (!innerEvent) {
        console.warn("[TauriEvent] local-agent-event missing inner 'event' field");
        return;
      }

      const mergedPayload: Record<string, unknown> = {
        ...innerEvent,
        sessionId,
        turnId: payload.turnId,
      };

      const { events, permission } = legacyPayloadToAcpEvents(mergedPayload);

      if (events.length > 0) {
        console.log("[TauriEvent] applying", events.length, "events to session", sessionId);
        applyAcpEvents(sessionId, events);
      }

      if (permission) {
        addPermission(sessionId, permission);
      }

      const type = innerEvent.type as string;
      if (
        type === "text_delta" ||
        type === "turn_started" ||
        type === "tool_call"
      ) {
        setTyping(sessionId, true);
      }
      if (type === "turn_completed" || type === "turn_error") {
        setTyping(sessionId, false);
      }
    }).then((unsub) => {
      if (cancelled) unsub();
      else unsubs.push(unsub);
    });

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => fn());
    };
  }, [listen]);
}
