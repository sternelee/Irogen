/**
 * Session Event Router
 *
 * Centralized event management for multi-session support:
 * - Single global listener per event type (not per ChatView)
 * - Routes events to correct session handlers by sessionId
 * - Supports concurrent sessions with independent streaming states
 */

import { listen, UnlistenFn } from "@tauri-apps/api/event";

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

// ============================================================================
// Session Event Router
// ============================================================================

class SessionEventRouter {
  // sessionId -> Set of handlers
  private handlers = new Map<string, Set<SessionEventHandler>>();

  // sessionId -> streaming state
  private streamingStates = new Map<string, StreamingState>();

  // Global unlisten functions
  private unlistenFns: UnlistenFn[] = [];

  // Initialization state
  private initialized = false;
  private initPromise: Promise<void> | null = null;

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
      (event) => this.routeEvent(event.payload)
    );
    this.unlistenFns.push(unlistenLocal);

    // Listen for remote agent events
    const unlistenRemote = await listen<SessionEvent>(
      "agent-message",
      (event) => this.routeEvent(event.payload)
    );
    this.unlistenFns.push(unlistenRemote);

    this.initialized = true;
    console.log("[SessionEventRouter] Initialized with global listeners");
  }

  /**
   * Route event to correct session handlers
   */
  private routeEvent(event: SessionEvent): void {
    const { sessionId, type } = event;

    // Update streaming state
    this.updateStreamingState(sessionId, type, event);

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
          err
        );
      }
    });
  }

  /**
   * Update streaming state based on event type
   */
  private updateStreamingState(
    sessionId: string,
    type: string,
    event: SessionEvent
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
      `[SessionEventRouter] Subscribed to session ${sessionId} (${this.handlers.get(sessionId)!.size} handlers)`
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
      console.log(`[SessionEventRouter] Unsubscribed from session ${sessionId}`);
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
