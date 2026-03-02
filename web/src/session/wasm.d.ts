/**
 * WASM Module Type Declarations
 */

declare module '/wasm/browser.js' {
  export function init_panic_hook(): void
  export function start(): void

  type ReadableStreamType = 'bytes'

  export class AgentNode {
    private constructor()
    free(): void
    connect_to_session(session_ticket: string): Promise<AgentSession>
    static spawn(): Promise<AgentNode>
    node_id(): string
  }

  export class AgentSession {
    private constructor()
    free(): void
    send_message(content: string): Promise<void>
    respond_to_permission(
      request_id: string,
      approved: boolean,
      reason?: string | null
    ): Promise<void>
    close(): Promise<void>
    interrupt(): Promise<void>
    readonly session_id: string
    readonly node_id: string
    readonly receiver: ReadableStream
  }

  export default function init(): Promise<void>
}
