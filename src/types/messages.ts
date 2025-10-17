/**
 * Frontend message types to match the new StructuredPayload architecture
 * These types correspond to the Rust StructuredPayload enum in shared/src/p2p.rs
 */

// Base message types
export interface BaseNetworkMessage {
  from_node: string;
  to_node?: string;
  session_id?: string;
  message_id: string;
  timestamp: number;
  domain: MessageDomain;
}

export interface StructuredNetworkMessage extends BaseNetworkMessage {
  payload: StructuredPayload;
}

export interface LegacyNetworkMessage extends BaseNetworkMessage {
  message_type: string;
  data: any;
}

export type NetworkMessage = StructuredNetworkMessage | LegacyNetworkMessage;

// Message domains
export enum MessageDomain {
  Session = "session",
  Terminal = "terminal",
  FileTransfer = "file_transfer",
  PortForward = "port_forward",
  System = "system"
}

// Structured Payload types
export type StructuredPayload =
  | { Session: SessionMessage }
  | { TerminalIO: TerminalIOMessage }
  | { TerminalManagement: TerminalManagementMessage }
  | { FileTransfer: FileTransferMessage }
  | { PortForward: PortForwardMessage }
  | { System: SystemMessage };

// Session messages
export interface SessionMessage {
  Connect?: {
    node_id: string;
    capabilities?: string[];
    metadata?: Record<string, string>;
  };
  Connected?: {
    node_id: string;
    session_id: string;
    capabilities?: string[];
    metadata?: Record<string, string>;
  };
  Disconnect?: {
    node_id: string;
    reason?: string;
  };
  Heartbeat?: {
    node_id: string;
    timestamp: number;
  };
  StatusRequest?: {
    node_id?: string;
  };
  StatusResponse?: {
    node_id: string;
    status: SessionStatus;
    active_terminals: number;
    active_port_forwards: number;
    uptime_seconds: number;
    metadata?: Record<string, string>;
  };
}

export interface SessionStatus {
  node_id: string;
  status: "online" | "offline" | "busy" | "error";
  capabilities: string[];
  last_heartbeat: number;
  metadata?: Record<string, string>;
}

// Terminal IO messages
export interface TerminalIOMessage {
  Input?: {
    terminal_id: string;
    data: string;
  };
  Output?: {
    terminal_id: string;
    data: string;
    timestamp?: number;
  };
  Resize?: {
    terminal_id: string;
    rows: number;
    cols: number;
  };
  Signal?: {
    terminal_id: string;
    signal: number;
  };
}

// Terminal Management messages
export interface TerminalManagementMessage {
  Create?: {
    name?: string;
    shell_path?: string;
    working_dir?: string;
    size?: [number, number];
  };
  Created?: {
    terminal_id: string;
    terminal_info: TerminalInfo;
  };
  Stop?: {
    terminal_id: string;
  };
  Stopped?: {
    terminal_id: string;
    reason?: string;
  };
  StatusUpdate?: {
    terminal_id: string;
    status: TerminalStatus;
  };
  ListRequest?: {};
  ListResponse?: {
    terminals: TerminalInfo[];
  };
  DirectoryChanged?: {
    terminal_id: string;
    new_dir: string;
  };
  Output?: {
    terminal_id: string;
    data: string;
  };
  Input?: {
    terminal_id: string;
    data: string;
  };
  Resize?: {
    terminal_id: string;
    rows: number;
    cols: number;
  };
}

export interface TerminalInfo {
  id: string;
  name?: string;
  shell_type: string;
  current_dir: string;
  status: TerminalStatus;
  created_at: number;
  last_activity: number;
  size: [number, number];
  process_id?: number;
  associated_webshares: number[];
}

export type TerminalStatus = "Starting" | "Running" | "Paused" | "Stopped" | "Error";

// File Transfer messages
export interface FileTransferMessage {
  Start?: {
    terminal_id: string;
    file_name: string;
    file_size: number;
    chunk_count: number;
    mime_type?: string;
  };
  Chunk?: {
    terminal_id: string;
    file_name: string;
    chunk_index: number;
    data: string; // base64 encoded
    is_last: boolean;
  };
  Progress?: {
    terminal_id: string;
    file_name: string;
    bytes_transferred: number;
    total_bytes: number;
    percentage: number;
  };
  Complete?: {
    terminal_id: string;
    file_name: string;
    file_path: string;
    file_hash?: string;
  };
  Error?: {
    terminal_id: string;
    file_name: string;
    error_message: string;
    error_code?: string;
  };
  Request?: {
    direction: "upload" | "download";
    file_path?: string;
    terminal_id?: string;
  };
}

// Port Forward messages (unified TCP + WebShare)
export interface PortForwardMessage {
  Create?: {
    service_id: string;
    local_port: number;
    remote_port?: number;
    service_type: PortForwardType;
    service_name: string;
    terminal_id?: string;
    metadata?: Record<string, string>;
  };
  Connected?: {
    service_id: string;
    assigned_remote_port: number;
    access_url?: string;
  };
  Data?: {
    service_id: string;
    data: number[]; // Vec<u8>
  };
  StatusUpdate?: {
    service_id: string;
    status: PortForwardStatus;
  };
  Stopped?: {
    service_id: string;
    reason?: string;
  };
  ListRequest?: {};
  ListResponse?: {
    services: PortForwardInfo[];
  };
}

export enum PortForwardType {
  Tcp = "tcp",
  Http = "http",
  Https = "https"
}

export type PortForwardStatus = "Starting" | "Active" | "Error" | "Stopped";

export interface PortForwardInfo {
  service_id: string;
  local_port: number;
  remote_port: number;
  service_type: PortForwardType;
  service_name: string;
  status: PortForwardStatus;
  access_url?: string;
  terminal_id?: string;
  created_at: number;
  connections_count: number;
  bytes_transferred: number;
}

// System messages
export interface SystemMessage {
  StatsRequest?: {
    node_id?: string;
  };
  StatsResponse?: {
    terminal_stats: TerminalStats;
    port_forward_stats: PortForwardStats;
    node_id: string;
    timestamp: number;
  };
  Log?: {
    level: LogLevel;
    message: string;
    context?: Record<string, any>;
  };
  Notification?: {
    title: string;
    message: string;
    level: NotificationLevel;
    actions?: NotificationAction[];
  };
  Error?: {
    code: SystemErrorCode;
    message: string;
    context?: Record<string, any>;
    node_id?: string;
  };
  Shutdown?: {
    node_id: string;
    reason?: string;
    timeout_seconds?: number;
  };
}

export interface TerminalStats {
  active_terminals: number;
  total_terminals_created: number;
  total_commands_executed: number;
  average_session_duration: number;
}

export interface PortForwardStats {
  active_services: number;
  total_services_created: number;
  total_connections: number;
  total_bytes_transferred: number;
}

export enum LogLevel {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error"
}

export enum NotificationLevel {
  Info = "info",
  Success = "success",
  Warning = "warning",
  Error = "error"
}

export interface NotificationAction {
  id: string;
  label: string;
  action_type: string;
  data?: any;
}

export enum SystemErrorCode {
  InternalError = "internal_error",
  ConfigurationError = "configuration_error",
  NetworkError = "network_error",
  PermissionError = "permission_error",
  ResourceExhausted = "resource_exhausted",
  InvalidMessage = "invalid_message"
}

// Event types for frontend
export interface StructuredEvent {
  type: string;
  domain: MessageDomain;
  sessionId: string;
  data: any;
  timestamp: number;
  messageId: string;
}

// Terminal events
export interface TerminalEvent {
  terminal_id: string;
  type: "created" | "stopped" | "status_update" | "output" | "input" | "resize" | "directory_changed";
  data: any;
  timestamp: number;
}

// Port Forward events (unified for both TCP and WebShare)
export interface PortForwardEvent {
  service_id: string;
  type: "created" | "connected" | "status_update" | "stopped" | "data";
  data: any;
  timestamp: number;
}

// File Transfer events
export interface FileTransferEvent {
  terminal_id: string;
  file_name: string;
  type: "started" | "chunk_received" | "progress" | "completed" | "error";
  data: any;
  timestamp: number;
}

// System events
export interface SystemEvent {
  node_id: string;
  type: "stats_response" | "log" | "notification" | "error" | "shutdown";
  data: any;
  timestamp: number;
}

// API Request types for frontend components
export interface CreateTerminalRequest {
  session_id: string;
  name?: string;
  shell_path?: string;
  working_dir?: string;
  size?: [number, number];
}

export interface TerminalInputRequest {
  session_id: string;
  terminal_id: string;
  input: string;
}

export interface TerminalResizeRequest {
  session_id: string;
  terminal_id: string;
  rows: number;
  cols: number;
}

export interface TerminalStopRequest {
  session_id: string;
  terminal_id: string;
}

export interface CreateWebShareRequest {
  session_id: string;
  service_name: string;
  terminal_id?: string;
  local_port?: number;
  metadata?: Record<string, string>;
}

export interface WebShareStopRequest {
  session_id: string;
  service_id: string;
}

export interface StatsRequest {
  session_id: string;
  node_id?: string;
}