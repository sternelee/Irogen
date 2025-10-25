/**
 * Enhanced message handler for the new StructuredPayload architecture
 * Provides type-safe handling of all message types and proper routing
 */

import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  NetworkMessage,
  MessageDomain,
  StructuredEvent,
  TerminalEvent,
  PortForwardEvent,
  FileTransferEvent,
  SystemEvent,
  SessionMessage
} from "../types/messages";

// Event handler types
export type TerminalEventHandler = (event: TerminalEvent) => void;
export type PortForwardEventHandler = (event: PortForwardEvent) => void;
export type FileTransferEventHandler = (event: FileTransferEvent) => void;
export type SystemEventHandler = (event: SystemEvent) => void;
export type SessionEventHandler = (event: { type: string; data: SessionMessage }) => void;

export interface MessageHandlerConfig {
  sessionId: string;
  onTerminalEvent?: TerminalEventHandler;
  onPortForwardEvent?: PortForwardEventHandler;
  onFileTransferEvent?: FileTransferEventHandler;
  onSystemEvent?: SystemEventHandler;
  onSessionEvent?: SessionEventHandler;
  onRawMessage?: (message: NetworkMessage) => void;
  onError?: (error: Error) => void;
}

export class StructuredMessageHandler {
  private unlistenFunctions: UnlistenFn[] = [];
  private config: MessageHandlerConfig;
  private isListening = false;

  constructor(config: MessageHandlerConfig) {
    this.config = config;
  }

  /**
   * Start listening for structured events
   */
  async startListening(): Promise<void> {
    if (this.isListening) {
      console.warn("Message handler is already listening");
      return;
    }

    try {
      // Listen for terminal-specific events
      const unlistenTerminal = await listen(
        `terminal-output`,
        (event) => {
          this.handleLegacyTerminalEvent(event.payload);
        }
      );

      // Listen for terminal status updates
      const unlistenTerminalStatus = await listen(
        `terminal-status-update`,
        (event) => {
          this.handleLegacyTerminalEvent(event.payload);
        }
      );

      // Listen for terminal list responses
      const unlistenTerminalList = await listen(
        `terminal-list-response`,
        (event) => {
          this.handleLegacyTerminalEvent(event.payload);
        }
      );

      // Listen for port forward events
      const unlistenPortForward = await listen(
        `port-forward-event`,
        (event) => {
          this.handleLegacyPortForwardEvent(event.payload);
        }
      );

      // Listen for file transfer events
      const unlistenFileTransfer = await listen(
        `file-transfer-event`,
        (event) => {
          this.handleLegacyFileTransferEvent(event.payload);
        }
      );

      // Listen for system events
      const unlistenSystem = await listen(
        `system-stats-response`,
        (event) => {
          this.handleLegacySystemEvent(event.payload);
        }
      );

      this.unlistenFunctions = [
        unlistenTerminal,
        unlistenTerminalStatus,
        unlistenTerminalList,
        unlistenPortForward,
        unlistenFileTransfer,
        unlistenSystem
      ];

      this.isListening = true;
      console.log(`Message handler started listening for session: ${this.config.sessionId}`);
    } catch (error) {
      this.config.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Stop listening for events
   */
  async stopListening(): Promise<void> {
    if (!this.isListening) {
      return;
    }

    try {
      for (const unlisten of this.unlistenFunctions) {
        await unlisten();
      }
      this.unlistenFunctions = [];
      this.isListening = false;
      console.log(`Message handler stopped listening for session: ${this.config.sessionId}`);
    } catch (error) {
      this.config.onError?.(error as Error);
    }
  }

  /**
   * Handle structured events from the new message architecture
   */
  private handleStructuredEvent(event: StructuredEvent): void {
    const { domain, type, data } = event;

    switch (domain) {
      case MessageDomain.Terminal:
        this.handleTerminalEvent({
          terminal_id: data.terminal_id || "unknown",
          type: type as any,
          data: data,
          timestamp: event.timestamp
        });
        break;

      case MessageDomain.PortForward:
        this.handlePortForwardEvent({
          service_id: data.service_id || "unknown",
          type: type as any,
          data: data,
          timestamp: event.timestamp
        });
        break;

      case MessageDomain.FileTransfer:
        this.handleFileTransferEvent({
          terminal_id: data.terminal_id || "unknown",
          file_name: data.file_name || "unknown",
          type: type as any,
          data: data,
          timestamp: event.timestamp
        });
        break;

      case MessageDomain.System:
        this.handleSystemEvent({
          node_id: data.node_id || "unknown",
          type: type as any,
          data: data,
          timestamp: event.timestamp
        });
        break;

      case MessageDomain.Session:
        this.config.onSessionEvent?.({
          type: type,
          data: data as SessionMessage
        });
        break;

      default:
        console.warn(`Unknown message domain: ${domain}`);
    }
  }

  /**
   * Handle terminal events
   */
  private handleTerminalEvent(event: TerminalEvent): void {
    if (this.config.onTerminalEvent) {
      this.config.onTerminalEvent(event);
    }

    // Additional specific handling based on event type
    switch (event.type) {
      case "output":
        // Handle terminal output
        break;
      case "status_update":
        // Handle terminal status updates
        break;
      case "directory_changed":
        // Handle directory changes
        break;
      case "resize":
        // Handle terminal resize
        break;
    }
  }

  /**
   * Handle port forward events
   */
  private handlePortForwardEvent(event: PortForwardEvent): void {
    if (this.config.onPortForwardEvent) {
      this.config.onPortForwardEvent(event);
    }

    // Additional specific handling based on event type
    switch (event.type) {
      case "created":
        // Handle port forward creation
        break;
      case "connected":
        // Handle port forward connection
        break;
      case "status_update":
        // Handle status updates
        break;
      case "stopped":
        // Handle port forward stopping
        break;
    }
  }

  /**
   * Handle file transfer events
   */
  private handleFileTransferEvent(event: FileTransferEvent): void {
    if (this.config.onFileTransferEvent) {
      this.config.onFileTransferEvent(event);
    }

    // Additional specific handling based on event type
    switch (event.type) {
      case "started":
        // Handle file transfer start
        break;
      case "progress":
        // Handle progress updates
        break;
      case "completed":
        // Handle completion
        break;
      case "error":
        // Handle errors
        break;
    }
  }

  /**
   * Handle system events
   */
  private handleSystemEvent(event: SystemEvent): void {
    if (this.config.onSystemEvent) {
      this.config.onSystemEvent(event);
    }

    // Additional specific handling based on event type
    switch (event.type) {
      case "stats_response":
        // Handle stats response
        break;
      case "notification":
        // Handle notifications
        break;
      case "error":
        // Handle system errors
        break;
      case "shutdown":
        // Handle shutdown events
        break;
    }
  }

  /**
   * Handle legacy terminal events (for backward compatibility)
   */
  private handleLegacyTerminalEvent(data: any): void {
    if (data.terminal_id) {
      this.handleTerminalEvent({
        terminal_id: data.terminal_id,
        type: data.type || "output",
        data: data,
        timestamp: data.timestamp || Date.now()
      });
    }
  }

  /**
   * Handle legacy port forward events
   */
  private handleLegacyPortForwardEvent(data: any): void {
    if (data.service_id || data.public_port) {
      this.handlePortForwardEvent({
        service_id: data.service_id || `port-${data.public_port}`,
        type: data.type || "status_update",
        data: data,
        timestamp: data.timestamp || Date.now()
      });
    }
  }

  /**
   * Handle legacy file transfer events
   */
  private handleLegacyFileTransferEvent(data: any): void {
    if (data.terminal_id && data.file_name) {
      this.handleFileTransferEvent({
        terminal_id: data.terminal_id,
        file_name: data.file_name,
        type: data.type || "progress",
        data: data,
        timestamp: data.timestamp || Date.now()
      });
    }
  }

  /**
   * Handle legacy system events
   */
  private handleLegacySystemEvent(data: any): void {
    this.handleSystemEvent({
      node_id: data.node_id || "unknown",
      type: data.type || "stats_response",
      data: data,
      timestamp: data.timestamp || Date.now()
    });
  }

  /**
   * Check if the handler is currently listening
   */
  isActive(): boolean {
    return this.isListening;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.config.sessionId;
  }
}

/**
 * Utility function to create a message handler with sensible defaults
 */
export function createMessageHandler(
  sessionId: string,
  eventHandlers: Partial<MessageHandlerConfig> = {}
): StructuredMessageHandler {
  const defaultConfig: MessageHandlerConfig = {
    sessionId,
    onError: (error) => console.error("Message handler error:", error),
    ...eventHandlers
  };

  return new StructuredMessageHandler(defaultConfig);
}

/**
 * Utility function to extract terminal information from events
 */
export function extractTerminalInfo(event: TerminalEvent): any {
  switch (event.type) {
    case "created":
      return event.data.terminal_info;
    case "status_update":
      return {
        id: event.terminal_id,
        status: event.data.status
      };
    case "output":
      return {
        id: event.terminal_id,
        output: event.data.data
      };
    case "directory_changed":
      return {
        id: event.terminal_id,
        current_dir: event.data.new_dir
      };
    case "resize":
      return {
        id: event.terminal_id,
        size: [event.data.rows, event.data.cols]
      };
    default:
      return {
        id: event.terminal_id,
        data: event.data
      };
  }
}

/**
 * Utility function to extract port forward information from events
 */
export function extractPortForwardInfo(event: PortForwardEvent): any {
  switch (event.type) {
    case "created":
      return event.data.service_info;
    case "connected":
      return {
        service_id: event.service_id,
        assigned_remote_port: event.data.assigned_remote_port,
        access_url: event.data.access_url
      };
    case "status_update":
      return {
        service_id: event.service_id,
        status: event.data.status
      };
    case "stopped":
      return {
        service_id: event.service_id,
        reason: event.data.reason
      };
    default:
      return {
        service_id: event.service_id,
        data: event.data
      };
  }
}
