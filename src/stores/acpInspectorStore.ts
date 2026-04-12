/**
 * ACP Inspector Store
 *
 * Manages ACP inspector state for observing ACP message flow:
 * - Subscribes to AgentTurnEvent stream via Tauri command
 * - Stores events in a timeline for display
 * - Handles permission requests
 */

import { createStore, produce } from "solid-js/store";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Types
// ============================================================================

export interface InspectorEvent {
  id: string;
  timestamp: number;
  turnId: string;
  type: string;
  data: Record<string, unknown>;
}

export interface PendingPermissionRequest {
  request_id: string;
  tool_name: string;
  tool_params: Record<string, unknown>;
  message?: string;
  created_at: number;
}

interface InspectorState {
  isSubscribed: boolean;
  sessionId: string | null;
  eventName: string | null;
  events: InspectorEvent[];
  pendingPermissions: PendingPermissionRequest[];
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// Store
// ============================================================================

const initialState: InspectorState = {
  isSubscribed: false,
  sessionId: null,
  eventName: null,
  events: [],
  pendingPermissions: [],
  isLoading: false,
  error: null,
};

let unlistenFn: UnlistenFn | null = null;

export const createInspectorStore = () => {
  const [state, setState] = createStore<InspectorState>(initialState);

  const subscribe = async (sessionId: string): Promise<boolean> => {
    if (state.isSubscribed) {
      console.warn("[ACP Inspector] Already subscribed to", state.sessionId);
      return false;
    }

    setState("isLoading", true);
    setState("error", null);

    try {
      const eventName = await invoke<string>("subscribe_acp_inspector", {
        sessionId,
      });

      setState(
        produce((s: InspectorState) => {
          s.isSubscribed = true;
          s.sessionId = sessionId;
          s.eventName = eventName;
          s.isLoading = false;
        })
      );

      unlistenFn = await listen(eventName, (tauriEvent) => {
        const payload = tauriEvent.payload as {
          turn_id: string;
          event: {
            type: string;
            [key: string]: unknown;
          };
        };

        const inspectorEvent: InspectorEvent = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
          turnId: payload.turn_id,
          type: payload.event.type,
          data: payload.event as Record<string, unknown>,
        };

        setState(
          produce((s: InspectorState) => {
            s.events.push(inspectorEvent);
            if (s.events.length > 1000) {
              s.events = s.events.slice(-500);
            }
          })
        );

        if (payload.event.type === "approval:request") {
          loadPendingPermissions(sessionId);
        }
      });

      await loadPendingPermissions(sessionId);

      console.log("[ACP Inspector] Subscribed to session", sessionId);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setState(
        produce((s: InspectorState) => {
          s.isLoading = false;
          s.error = errorMessage;
        })
      );
      console.error("[ACP Inspector] Failed to subscribe:", errorMessage);
      return false;
    }
  };

  const unsubscribe = async () => {
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }

    setState(
      produce((s: InspectorState) => {
        s.isSubscribed = false;
        s.sessionId = null;
        s.eventName = null;
        s.events = [];
        s.pendingPermissions = [];
      })
    );

    console.log("[ACP Inspector] Unsubscribed");
  };

  const loadPendingPermissions = async (sessionId: string) => {
    try {
      const permissions = await invoke<PendingPermissionRequest[]>(
        "local_get_pending_permissions",
        { sessionId }
      );
      setState("pendingPermissions", permissions);
    } catch (error) {
      console.error("[ACP Inspector] Failed to load pending permissions:", error);
    }
  };

  const respondToPermission = async (
    requestId: string,
    approved: boolean,
    approveForSession: boolean = false,
    reason?: string
  ): Promise<boolean> => {
    if (!state.sessionId) {
      console.error("[ACP Inspector] No session ID for permission response");
      return false;
    }

    try {
      await invoke("respond_permission", {
        sessionId: state.sessionId,
        requestId,
        approved,
        approveForSession,
        reason: reason || null,
      });

      setState(
        produce((s: InspectorState) => {
          s.pendingPermissions = s.pendingPermissions.filter(
            (p) => p.request_id !== requestId
          );
        })
      );

      console.log("[ACP Inspector] Permission response sent:", requestId, approved);
      return true;
    } catch (error) {
      console.error("[ACP Inspector] Failed to respond to permission:", error);
      return false;
    }
  };

  const clearEvents = () => {
    setState("events", []);
  };

  return {
    state,
    subscribe,
    unsubscribe,
    respondToPermission,
    loadPendingPermissions,
    clearEvents,
  };
};

export const inspectorStore = createInspectorStore();
