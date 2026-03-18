/**
 * Session Event Router
 *
 * Centralized event management for multi-session support:
 * - Single global listener per event type (not per ChatView)
 * - Routes events to correct session handlers by sessionId
 * - Supports concurrent sessions with independent streaming states
 * - Tracks unread state for non-active sessions
 */

import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// ============================================================================
// Types
// ============================================================================

export interface SessionEvent {
  sessionId: string;
  type: string;
  [key: string]: unknown;
}

export type SessionEventHandler = (event: SessionEvent) => void;

export interface StreamingState {
  isStreaming: boolean;
  turnId: string | null;
  startedAt: number | null;
}

// Event types that should trigger unread notification
const MESSAGE_EVENT_TYPES = new Set([
  "text_delta",
  "response",
  "turn_started",
  "TurnStarted",
]);

// ============================================================================
// Session Event Router
// ============================================================================

class SessionEventRouter {
  // sessionId -> Set of handlers
  private handlers = new Map<string, Set<SessionEventHandler>>();

  // sessionId -> streaming state
  private streamingStates = new Map<string, StreamingState>();

  // sessionId -> has unread messages
  private unreadSessions = new Set<string>();

  // Callback when session has unread change
  private onUnreadChange:
    | ((sessionId: string, hasUnread: boolean) => void)
    | null = null;

  // Global unlisten functions
  private unlistenFns: UnlistenFn[] = [];

  // Initialization state
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  // Current active session ID (set externally)
  private activeSessionId: string | null = null;

  // Notification state
  private notificationPermission: "unknown" | "granted" | "denied" = "unknown";
  private lastNotificationAt = new Map<string, number>();
  private static readonly NOTIFICATION_COOLDOWN_MS = 4000;

  /**
   * Initialize global event listeners (called once)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    // Listen for local agent events
    const unlistenLocal = await listen<SessionEvent>(
      "local-agent-event",
      (event) => this.routeEvent(event.payload),
    );
    this.unlistenFns.push(unlistenLocal);

    // Listen for remote agent events
    const unlistenRemote = await listen<SessionEvent>(
      "agent-message",
      (event) => this.routeEvent(event.payload),
    );
    this.unlistenFns.push(unlistenRemote);

    this.initialized = true;
    console.log("[SessionEventRouter] Initialized with global listeners");
  }

  /**
   * Route event to correct session handlers
   */
  private routeEvent(event: SessionEvent): void {
    // Handle both nested event format (from Rust) and flat format
    // Rust sends: {sessionId, turnId, event: {type, ...}}
    // Some events may also have type at top level
    const nestedEvent = event.event as Record<string, unknown> | undefined;
    const type = (event.type as string) || (nestedEvent?.type as string) || "";
    const sessionId = (event.sessionId as string) || "";
    const normalizedType = this.normalizeEventType(type);

    // Update streaming state
    this.updateStreamingState(sessionId, type, event);

    // Track unread for non-active sessions on message events
    if (this.activeSessionId && sessionId !== this.activeSessionId) {
      if (MESSAGE_EVENT_TYPES.has(type)) {
        this.markUnread(sessionId);
      }
      void this.notifyForInactiveSession(sessionId, normalizedType, event);
    }

    // Get handlers for this session
    const sessionHandlers = this.handlers.get(sessionId);
    if (!sessionHandlers || sessionHandlers.size === 0) {
      // No handlers registered - event is dropped
      // This is normal if session is not active in any view
      return;
    }

    // Call all handlers for this session
    sessionHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        console.error(
          `[SessionEventRouter] Handler error for session ${sessionId}:`,
          err,
        );
      }
    });
  }

  private normalizeEventType(type: string): string {
    switch (type) {
      case "TurnCompleted":
        return "turn_completed";
      case "TurnError":
        return "turn_error";
      case "ApprovalRequest":
        return "approval_request";
      case "UserQuestion":
        return "user_question";
      default:
        return type.replace(":", "_").toLowerCase();
    }
  }

  private async ensureNotificationPermission(): Promise<boolean> {
    if (this.notificationPermission === "granted") return true;
    if (this.notificationPermission === "denied") return false;

    try {
      const granted = await isPermissionGranted();
      if (granted) {
        this.notificationPermission = "granted";
        return true;
      }

      const permission = await requestPermission();
      const accepted = permission === "granted";
      this.notificationPermission = accepted ? "granted" : "denied";
      return accepted;
    } catch (error) {
      console.error(
        "[SessionEventRouter] Failed to request notification permission:",
        error,
      );
      this.notificationPermission = "denied";
      return false;
    }
  }

  private buildNotificationPayload(
    sessionId: string,
    eventType: string,
    event: SessionEvent,
  ): { title: string; body: string } | null {
    const titlePrefix = `Session ${sessionId.slice(0, 8)}`;
    const maybeToolName =
      typeof event.toolName === "string" && event.toolName.trim()
        ? event.toolName.trim()
        : "tool";

    switch (eventType) {
      case "approval_request":
      case "permission_request":
        return {
          title: `${titlePrefix}: Permission Required`,
          body: `${maybeToolName} needs your approval`,
        };
      case "user_question":
        return {
          title: `${titlePrefix}: Input Required`,
          body:
            typeof event.question === "string" && event.question.trim()
              ? event.question.trim()
              : "Agent is waiting for your selection",
        };
      case "turn_completed":
        return {
          title: `${titlePrefix}: Reply Ready`,
          body: "Background agent finished a response",
        };
      case "turn_error":
        return {
          title: `${titlePrefix}: Error`,
          body:
            typeof event.error === "string" && event.error.trim()
              ? event.error.trim()
              : "Background agent reported an error",
        };
      default:
        return null;
    }
  }

  private async notifyForInactiveSession(
    sessionId: string,
    eventType: string,
    event: SessionEvent,
  ): Promise<void> {
    if (!sessionId || sessionId === this.activeSessionId) return;

    const payload = this.buildNotificationPayload(sessionId, eventType, event);
    if (!payload) return;

    const now = Date.now();
    const throttleKey = `${sessionId}:${eventType}`;
    const lastAt = this.lastNotificationAt.get(throttleKey) || 0;
    if (now - lastAt < SessionEventRouter.NOTIFICATION_COOLDOWN_MS) {
      return;
    }

    const canNotify = await this.ensureNotificationPermission();
    if (!canNotify) return;

    try {
      await sendNotification({
        title: payload.title,
        body: payload.body,
      });
      this.lastNotificationAt.set(throttleKey, now);
    } catch (error) {
      console.error("[SessionEventRouter] Failed to send notification:", error);
    }
  }

  /**
   * Mark session as having unread messages
   */
  private markUnread(sessionId: string): void {
    if (!this.unreadSessions.has(sessionId)) {
      this.unreadSessions.add(sessionId);
      this.onUnreadChange?.(sessionId, true);
    }
  }

  /**
   * Update streaming state based on event type
   */
  private updateStreamingState(
    sessionId: string,
    type: string,
    event: SessionEvent,
  ): void {
    const state = this.streamingStates.get(sessionId) || {
      isStreaming: false,
      turnId: null,
      startedAt: null,
    };

    switch (type) {
      case "turn_started":
      case "TurnStarted":
        state.isStreaming = true;
        state.turnId = (event.turnId as string) || null;
        state.startedAt = Date.now();
        break;

      case "text_delta":
      case "TextDelta":
      case "reasoning_delta":
      case "ReasoningDelta":
      case "response":
      case "AgentResponse":
        // Some providers may not emit explicit turn_started; treat response chunks as streaming.
        state.isStreaming = true;
        if (!state.startedAt) {
          state.startedAt = Date.now();
        }
        break;

      case "turn_complete":
      case "turn_completed":
      case "TurnComplete":
      case "TurnCompleted":
      case "turn_error":
      case "TurnError":
        state.isStreaming = false;
        break;
    }

    this.streamingStates.set(sessionId, state);
  }

  /**
   * Subscribe to events for a specific session
   * Returns unsubscribe function
   */
  subscribe(sessionId: string, handler: SessionEventHandler): () => void {
    // Ensure initialized (fire-and-forget is safe: initPromise deduplicates,
    // and late listeners will catch subsequent events)
    this.initialize().catch((err) => {
      console.error("[SessionEventRouter] Failed to initialize:", err);
    });

    // Add handler
    if (!this.handlers.has(sessionId)) {
      this.handlers.set(sessionId, new Set());
    }
    this.handlers.get(sessionId)!.add(handler);

    console.log(
      `[SessionEventRouter] Subscribed to session ${sessionId} (${this.handlers.get(sessionId)!.size} handlers)`,
    );

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(sessionId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(sessionId);
          this.streamingStates.delete(sessionId);
        }
      }
      console.log(
        `[SessionEventRouter] Unsubscribed from session ${sessionId}`,
      );
    };
  }

  /**
   * Remove all state for a session (call when session is destroyed)
   * Prevents memory leaks from orphaned handler sets and streaming state
   */
  removeSession(sessionId: string): void {
    this.handlers.delete(sessionId);
    this.streamingStates.delete(sessionId);
    this.unreadSessions.delete(sessionId);
  }

  /**
   * Get streaming state for a session
   */
  getStreamingState(sessionId: string): StreamingState {
    return (
      this.streamingStates.get(sessionId) || {
        isStreaming: false,
        turnId: null,
        startedAt: null,
      }
    );
  }

  /**
   * Check if any session is streaming
   */
  hasActiveStreaming(): boolean {
    for (const state of this.streamingStates.values()) {
      if (state.isStreaming) return true;
    }
    return false;
  }

  /**
   * Get all sessions currently streaming
   */
  getStreamingSessions(): string[] {
    const streaming: string[] = [];
    for (const [sessionId, state] of this.streamingStates) {
      if (state.isStreaming) {
        streaming.push(sessionId);
      }
    }
    return streaming;
  }

  // ========================================================================
  // Unread Management
  // ========================================================================

  /**
   * Set the currently active session
   * This session will not receive unread notifications
   */
  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId;
    // Clear unread for the newly active session
    if (sessionId && this.unreadSessions.has(sessionId)) {
      this.unreadSessions.delete(sessionId);
      this.onUnreadChange?.(sessionId, false);
    }
  }

  /**
   * Check if a session has unread messages
   */
  hasUnread(sessionId: string): boolean {
    return this.unreadSessions.has(sessionId);
  }

  /**
   * Get all sessions with unread messages
   */
  getUnreadSessions(): string[] {
    return Array.from(this.unreadSessions);
  }

  /**
   * Clear unread state for a session
   */
  clearUnread(sessionId: string): void {
    if (this.unreadSessions.has(sessionId)) {
      this.unreadSessions.delete(sessionId);
      this.onUnreadChange?.(sessionId, false);
    }
  }

  /**
   * Set callback for unread state changes
   */
  setOnUnreadChange(
    callback: (sessionId: string, hasUnread: boolean) => void,
  ): void {
    this.onUnreadChange = callback;
  }

  /**
   * Cleanup all listeners (for app shutdown)
   */
  async cleanup(): Promise<void> {
    for (const unlisten of this.unlistenFns) {
      unlisten();
    }
    this.unlistenFns = [];
    this.handlers.clear();
    this.streamingStates.clear();
    this.initialized = false;
    this.initPromise = null;
    console.log("[SessionEventRouter] Cleaned up");
  }
}

// Singleton instance
export const sessionEventRouter = new SessionEventRouter();
