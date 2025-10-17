/**
 * Enhanced API utility for the new message architecture
 * Provides type-safe API calls and improved error handling
 */

import { invoke } from "@tauri-apps/api/core";
import {
  PortForwardType,
  TerminalInfo,
  PortForwardInfo
} from "../types/messages";

// API Request interfaces (these match the Tauri command interfaces)
export interface ApiCreateTerminalRequest {
  session_id: string;
  name?: string;
  shell_path?: string;
  working_dir?: string;
  size?: [number, number];
}

export interface ApiTerminalInputRequest {
  session_id: string;
  terminal_id: string;
  input: string;
}

export interface ApiTerminalResizeRequest {
  session_id: string;
  terminal_id: string;
  rows: number;
  cols: number;
}

export interface ApiTerminalStopRequest {
  session_id: string;
  terminal_id: string;
}

export interface ApiCreatePortForwardRequest {
  session_id: string;
  local_port: number;
  remote_port?: number;
  service_type: PortForwardType;
  service_name: string;
  terminal_id?: string;
  metadata?: Record<string, string>;
}

export interface ApiPortForwardStopRequest {
  session_id: string;
  service_id: string;
}

export interface ApiStatsRequest {
  session_id: string;
  node_id?: string;
}

// API Response interfaces
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
}

/**
 * Enhanced API client with better error handling and type safety
 */
export class RitermApiClient {
  constructor(private sessionId: string) {}

  /**
   * Create a new terminal
   */
  async createTerminal(request: ApiCreateTerminalRequest): Promise<ApiResponse<TerminalInfo>> {
    try {
      await invoke("create_terminal", { request });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("create_terminal", error);
    }
  }

  /**
   * List all terminals
   */
  async listTerminals(): Promise<ApiResponse<TerminalInfo[]>> {
    try {
      await invoke("list_terminals", { sessionId: this.sessionId });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("list_terminals", error);
    }
  }

  /**
   * Send input to a terminal
   */
  async sendTerminalInput(request: ApiTerminalInputRequest): Promise<ApiResponse<void>> {
    try {
      await invoke("send_terminal_input_to_terminal", { request });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("send_terminal_input_to_terminal", error);
    }
  }

  /**
   * Resize a terminal
   */
  async resizeTerminal(request: ApiTerminalResizeRequest): Promise<ApiResponse<void>> {
    try {
      await invoke("resize_terminal", { request });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("resize_terminal", error);
    }
  }

  /**
   * Stop a terminal
   */
  async stopTerminal(request: ApiTerminalStopRequest): Promise<ApiResponse<void>> {
    try {
      await invoke("stop_terminal", { request });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("stop_terminal", error);
    }
  }

  /**
   * Connect to a specific terminal
   */
  async connectToTerminal(terminalId: string): Promise<ApiResponse<void>> {
    try {
      await invoke("connect_to_terminal", {
        sessionId: this.sessionId,
        terminalId
      });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("connect_to_terminal", error);
    }
  }

  /**
   * Create a port forwarding service (unified for TCP and WebShare)
   */
  async createPortForward(request: ApiCreatePortForwardRequest): Promise<ApiResponse<PortForwardInfo>> {
    try {
      await invoke("create_port_forward", { request });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("create_port_forward", error);
    }
  }

  /**
   * List port forwarding services
   */
  async listPortForwards(): Promise<ApiResponse<PortForwardInfo[]>> {
    try {
      await invoke("list_port_forwards", { sessionId: this.sessionId });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("list_port_forwards", error);
    }
  }

  /**
   * Stop a port forwarding service
   */
  async stopPortForward(request: ApiPortForwardStopRequest): Promise<ApiResponse<void>> {
    try {
      await invoke("stop_port_forward", { request });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("stop_port_forward", error);
    }
  }

  /**
   * Get system statistics
   */
  async getSystemStats(nodeId?: string): Promise<ApiResponse<any>> {
    try {
      await invoke("get_system_stats", {
        sessionId: this.sessionId,
        nodeId
      });
      return {
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      return this.handleError("get_system_stats", error);
    }
  }

  /**
   * Handle API errors and create standardized error responses
   */
  private handleError(operation: string, error: any): ApiResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`API Error in ${operation}:`, error);

    return {
      success: false,
      error: errorMessage,
      timestamp: Date.now()
    };
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Utility function to create an API client
 */
export function createApiClient(sessionId: string): RitermApiClient {
  return new RitermApiClient(sessionId);
}

/**
 * Backward compatibility functions for the old WebShare API
 * These map to the new unified PortForward API
 */
export class WebShareLegacyAdapter {
  private apiClient: RitermApiClient;

  constructor(sessionId: string) {
    this.apiClient = new RitermApiClient(sessionId);
  }

  /**
   * Create a WebShare (maps to port forward with HTTP type)
   */
  async createWebShare(request: {
    session_id: string;
    local_port: number;
    public_port?: number;
    service_name: string;
    terminal_id?: string;
  }): Promise<ApiResponse<any>> {
    return this.apiClient.createPortForward({
      session_id: request.session_id,
      local_port: request.local_port,
      remote_port: request.public_port,
      service_type: PortForwardType.Http,
      service_name: request.service_name,
      terminal_id: request.terminal_id
    });
  }

  /**
   * List WebShares (maps to list port forwards with HTTP type)
   */
  async listWebShares(): Promise<ApiResponse<any>> {
    // This would need to be implemented on the backend to filter by service_type
    return this.apiClient.listPortForwards();
  }

  /**
   * Stop a WebShare (maps to stop port forward)
   */
  async stopWebShare(request: {
    session_id: string;
    public_port: number;
  }): Promise<ApiResponse<void>> {
    // For legacy, we need to find the service_id by public_port
    // This is a limitation of the old API
    return {
      success: false,
      error: "Legacy WebShare API requires service_id. Use new PortForward API instead.",
      timestamp: Date.now()
    };
  }
}

/**
 * Utility function to create a WebShare legacy adapter
 */
export function createWebShareAdapter(sessionId: string): WebShareLegacyAdapter {
  return new WebShareLegacyAdapter(sessionId);
}

/**
 * Enhanced connection API with better error handling
 */
export class ConnectionApi {
  /**
   * Connect to a peer using a session ticket
   */
  static async connectToPeer(sessionTicket: string): Promise<string> {
    try {
      return await invoke<string>("connect_to_peer", {
        sessionTicket
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to peer: ${errorMessage}`);
    }
  }

  /**
   * Disconnect from a session
   */
  static async disconnect(sessionId: string): Promise<void> {
    try {
      await invoke("disconnect_from_session", { sessionId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to disconnect: ${errorMessage}`);
    }
  }

  /**
   * Get connection status
   */
  static async getConnectionStatus(sessionId: string): Promise<any> {
    try {
      return await invoke("get_connection_status", { sessionId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get connection status: ${errorMessage}`);
    }
  }

  /**
   * Get session history
   */
  static async getSessionHistory(): Promise<any[]> {
    try {
      return await invoke<any[]>("get_session_history");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get session history: ${errorMessage}`);
    }
  }
}

/**
 * Validation utilities for API requests
 */
export class ApiValidators {
  static validateSessionId(sessionId: string): boolean {
    return typeof sessionId === "string" && sessionId.length > 0;
  }

  static validateTerminalId(terminalId: string): boolean {
    return typeof terminalId === "string" && terminalId.length > 0;
  }

  static validatePort(port: number): boolean {
    return Number.isInteger(port) && port > 0 && port <= 65535;
  }

  static validateTerminalSize(size: [number, number]): boolean {
    return Array.isArray(size) &&
           size.length === 2 &&
           Number.isInteger(size[0]) && size[0] > 0 &&
           Number.isInteger(size[1]) && size[1] > 0;
  }

  static validateServiceName(serviceName: string): boolean {
    return typeof serviceName === "string" && serviceName.length > 0 && serviceName.length <= 255;
  }

  static validateCreateTerminalRequest(request: ApiCreateTerminalRequest): string[] {
    const errors: string[] = [];

    if (!this.validateSessionId(request.session_id)) {
      errors.push("Invalid session_id");
    }

    if (request.size && !this.validateTerminalSize(request.size)) {
      errors.push("Invalid terminal size (must be [rows, cols] with positive integers)");
    }

    return errors;
  }

  static validateCreatePortForwardRequest(request: ApiCreatePortForwardRequest): string[] {
    const errors: string[] = [];

    if (!this.validateSessionId(request.session_id)) {
      errors.push("Invalid session_id");
    }

    if (!this.validatePort(request.local_port)) {
      errors.push("Invalid local_port (must be 1-65535)");
    }

    if (request.remote_port && !this.validatePort(request.remote_port)) {
      errors.push("Invalid remote_port (must be 1-65535)");
    }

    if (!this.validateServiceName(request.service_name)) {
      errors.push("Invalid service_name (must be 1-255 characters)");
    }

    if (!Object.values(PortForwardType).includes(request.service_type)) {
      errors.push("Invalid service_type");
    }

    return errors;
  }
}