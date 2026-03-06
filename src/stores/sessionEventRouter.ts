/**
 * Session Event Router
 *
 * Centralized event management for multi-session support:
 * - Single global listener per event type (not per ChatView)
 * - Routes events to correct session handlers by sessionId
 * - Supports concurrent sessions with independent streaming states
 * - Tracks unread state for non-active sessions
 * - Persists messages for reconnection recovery
 */

import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { sessionStore } from "./sessionStore";
import {
  persistMessage,
  loadStoredMessages,
  type StoredMessageEntry,
} from "./messagePersistStore";

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

// Event types that should be persisted for reconnection
const PERSISTABLE_EVENT_TYPES = new Set([
  "text_delta",
  "response",
  "tool_started",
  "tool_result",
  "permission_request",
  "turn_started",
  "TurnStarted",
  "turn_complete",
  "TurnComplete",
]);

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

    // Listen for message sync responses
    const unlistenSync = await listen<SessionEvent>("message-sync", (event) =>
      this.handleMessageSync(event.payload),
    );
    this.unlistenFns.push(unlistenSync);

    this.initialized = true;
    console.log("[SessionEventRouter] Initialized with global listeners");
  }

  /**
   * Handle message sync response
   */
  private handleMessageSync(event: SessionEvent): void {
    const payload = event as unknown as {
      sessionId: string;
      messages: Array<{
        sequence: number;
        timestamp: number;
        messageData: string;
      }>;
    };

    const { sessionId, messages } = payload;

    console.log(
      `[SessionEventRouter] Received message sync for session ${sessionId}:`,
      messages.length,
      "messages",
    );

    // Process each synced message
    for (const syncedMessage of messages) {
      try {
        // Parse the message data
        const messageData = JSON.parse(syncedMessage.messageData);

        // Route the message as if it came from the agent
        const agentEvent: SessionEvent = {
          sessionId,
          ...messageData,
        };

        this.routeEvent(agentEvent);

        // Update last received sequence
        sessionStore.updateLastReceivedSequence(
          sessionId,
          syncedMessage.sequence,
        );
      } catch (err) {
        console.error(`Failed to process synced message:`, err);
      }
    }
  }

  /**
   * Load stored message history for a session
   * This should be called when a session becomes active
   */
  async loadSessionHistory(sessionId: string): Promise<StoredMessageEntry[]> {
    console.log(`[SessionEventRouter] Loading history for session ${sessionId}`);
    const messages = await loadStoredMessages(sessionId);

    // Update last sequence if we have messages
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      sessionStore.updateLastReceivedSequence(sessionId, lastMessage.sequence);
    }

    return messages;
  }

  /**
   * Route event to correct session handlers
   */
  private routeEvent(event: SessionEvent): void {
    const { sessionId, type } = event;

    // Update streaming state
    this.updateStreamingState(sessionId, type, event);

    // Persist message for reconnection recovery (async, non-blocking)
    if (PERSISTABLE_EVENT_TYPES.has(type)) {
      this.persistEvent(sessionId, event);
    }

    // Track unread for non-active sessions on message events
    if (
      this.activeSessionId &&
      sessionId !== this.activeSessionId &&
      MESSAGE_EVENT_TYPES.has(type)
    ) {
      this.markUnread(sessionId);
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

  /**
   * Persist event to local storage for reconnection recovery
   */
  private async persistEvent(sessionId: string, event: SessionEvent): Promise<void> {
    try {
      const messageData = JSON.stringify(event);
      await persistMessage(sessionId, messageData);
    } catch (err) {
      // Log but don't throw - persistence failure shouldn't affect event processing
      console.warn(
        `[SessionEventRouter] Failed to persist event for session ${sessionId}:`,
        err,
      );
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

      case "turn_complete":
      case "TurnComplete":
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
    // Ensure initialized
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
   * Request message sync for reconnection recovery
   */
  async requestMessageSync(sessionId: string): Promise<void> {
    console.log(
      `[SessionEventRouter] Requesting message sync for session ${sessionId}`,
    );
    await sessionStore.requestMessageSync(sessionId);
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
