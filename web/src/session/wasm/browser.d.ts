/* tslint:disable */
/* eslint-disable */
export function init_panic_hook(): void;
export function start(): void;
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */
type ReadableStreamType = "bytes";
/**
 * Web Agent Node for remote agent sessions
 */
export class AgentNode {
  private constructor();
  free(): void;
  /**
   * Connects to an agent session using a session ticket
   */
  connect_to_session(session_ticket: string): Promise<AgentSession>;
  /**
   * Spawns an agent node for web browser.
   */
  static spawn(): Promise<AgentNode>;
  /**
   * Returns the node id of this browser client.
   */
  node_id(): string;
}
export class AgentSession {
  private constructor();
  free(): void;
  /**
   * Send a message to the agent session
   */
  send_message(content: string): Promise<void>;
  /**
   * Respond to a permission request
   */
  respond_to_permission(request_id: string, approved: boolean, reason?: string | null): Promise<void>;
  /**
   * Close the session
   */
  close(): Promise<void>;
  /**
   * Interrupt the current turn
   */
  interrupt(): Promise<void>;
  readonly session_id: string;
  readonly node_id: string;
  readonly receiver: ReadableStream;
}
export class IntoUnderlyingByteSource {
  private constructor();
  free(): void;
  pull(controller: ReadableByteStreamController): Promise<any>;
  start(controller: ReadableByteStreamController): void;
  cancel(): void;
  readonly autoAllocateChunkSize: number;
  readonly type: ReadableStreamType;
}
export class IntoUnderlyingSink {
  private constructor();
  free(): void;
  abort(reason: any): Promise<any>;
  close(): Promise<any>;
  write(chunk: any): Promise<any>;
}
export class IntoUnderlyingSource {
  private constructor();
  free(): void;
  pull(controller: ReadableStreamDefaultController): Promise<any>;
  cancel(): void;
}
