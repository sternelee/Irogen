/**
 * Message Persistence Store
 *
 * Manages persistent message storage for reconnection recovery.
 * Messages are stored locally and can be loaded when reconnecting.
 */

import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Types
// ============================================================================

export interface StoredMessageEntry {
  sequence: number;
  timestamp: number;
  messageData: string;
}

export interface MessageStoreStats {
  totalMessages: number;
  maxSequence: number;
  totalBytes: number;
}

// ============================================================================
// Message Persistence Functions
// ============================================================================

/**
 * Persist a received message to local storage
 * Returns the assigned sequence number
 */
export async function persistMessage(
  sessionId: string,
  messageData: string,
): Promise<number> {
  try {
    const sequence = await invoke<number>("persist_message", {
      sessionId,
      messageData,
    });
    return sequence;
  } catch (error) {
    console.error(
      `[MessagePersist] Failed to persist message for session ${sessionId}:`,
      error,
    );
    // Don't throw - persistence failure shouldn't block message processing
    return 0;
  }
}

/**
 * Load all stored messages for a session
 */
export async function loadStoredMessages(
  sessionId: string,
): Promise<StoredMessageEntry[]> {
  try {
    const messages = await invoke<StoredMessageEntry[]>("load_stored_messages", {
      sessionId,
    });
    console.log(
      `[MessagePersist] Loaded ${messages.length} stored messages for session ${sessionId}`,
    );
    return messages;
  } catch (error) {
    console.error(
      `[MessagePersist] Failed to load messages for session ${sessionId}:`,
      error,
    );
    return [];
  }
}

/**
 * Get message store statistics for a session
 */
export async function getMessageStoreStats(
  sessionId: string,
): Promise<MessageStoreStats | null> {
  try {
    const stats = await invoke<MessageStoreStats>("get_message_store_stats", {
      sessionId,
    });
    return stats;
  } catch (error) {
    console.error(
      `[MessagePersist] Failed to get stats for session ${sessionId}:`,
      error,
    );
    return null;
  }
}

/**
 * Clear stored messages for a session
 */
export async function clearStoredMessages(sessionId: string): Promise<void> {
  try {
    await invoke("clear_stored_messages", { sessionId });
    console.log(
      `[MessagePersist] Cleared stored messages for session ${sessionId}`,
    );
  } catch (error) {
    console.error(
      `[MessagePersist] Failed to clear messages for session ${sessionId}:`,
      error,
    );
  }
}

// ============================================================================
// Message Store Hook for Components
// ============================================================================

/**
 * Create a message persistence manager for a session
 */
export function createMessagePersistManager(sessionId: string) {
  let lastPersistedSequence = 0;

  return {
    /**
     * Persist a message and update the last sequence tracker
     */
    async persistMessage(messageData: string): Promise<number> {
      const sequence = await persistMessage(sessionId, messageData);
      if (sequence > lastPersistedSequence) {
        lastPersistedSequence = sequence;
      }
      return sequence;
    },

    /**
     * Load stored messages and return them sorted by sequence
     */
    async loadHistory(): Promise<StoredMessageEntry[]> {
      const messages = await loadStoredMessages(sessionId);
      // Sort by sequence to ensure correct order
      messages.sort((a, b) => a.sequence - b.sequence);
      // Update last sequence tracker
      if (messages.length > 0) {
        lastPersistedSequence = messages[messages.length - 1].sequence;
      }
      return messages;
    },

    /**
     * Get the last persisted sequence number
     */
    getLastSequence(): number {
      return lastPersistedSequence;
    },

    /**
     * Clear stored messages
     */
    async clear(): Promise<void> {
      await clearStoredMessages(sessionId);
      lastPersistedSequence = 0;
    },

    /**
     * Get storage stats
     */
    async getStats(): Promise<MessageStoreStats | null> {
      return getMessageStoreStats(sessionId);
    },
  };
}

export type MessagePersistManager = ReturnType<typeof createMessagePersistManager>;
