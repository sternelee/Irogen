/**
 * WASM Client
 *
 * Wrapper for browser WASM agent client
 */

import type { AgentEvent } from './types'

// ============================================================================
// Types
// ============================================================================

interface WasmAgentNode {
  node_id(): string
  connect_to_session(sessionTicket: string): Promise<WasmAgentSession>
}

interface WasmAgentSession {
  readonly session_id: string
  readonly node_id: string
  readonly receiver: ReadableStream
  send_message(content: string): Promise<void>
  respond_to_permission(
    requestId: string,
    approved: boolean,
    reason?: string
  ): Promise<void>
  interrupt(): Promise<void>
  close(): Promise<void>
}

interface WasmModule {
  AgentNode: {
    spawn(): Promise<WasmAgentNode>
  }
}

type EventHandler = (event: AgentEvent) => void

// ============================================================================
// WASM Loader
// ============================================================================

let wasmModule: WasmModule | null = null
let wasmLoading: Promise<WasmModule> | null = null

async function loadWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule
  if (wasmLoading) return wasmLoading

  wasmLoading = (async () => {
    // Import WASM module from src/session/wasm (vite-plugin-wasm handles this)
    // @ts-ignore
    const module = await import('./wasm/browser.js')
    // The module is already initialized by vite-plugin-wasm
    wasmModule = module as WasmModule
    return wasmModule
  })()

  return wasmLoading
}

// ============================================================================
// Client Class
// ============================================================================

/**
 * Agent Client
 *
 * High-level wrapper for WASM agent client
 */
class AgentClient {
  private node: WasmAgentNode | null = null
  private session: WasmAgentSession | null = null
  private eventReader: ReadableStreamDefaultReader | null = null
  private eventHandlers: Map<string, Set<EventHandler>> = new Map()
  private initialized = false

  /**
   * Initialize the client
   */
  async initialize(): Promise<string> {
    if (this.initialized && this.node) {
      return this.node.node_id()
    }

    const wasm = await loadWasm()
    this.node = await wasm.AgentNode.spawn()
    this.initialized = true
    return this.node.node_id()
  }

  /**
   * Get node ID
   */
  getNodeId(): string | null {
    return this.node?.node_id() ?? null
  }

  /**
   * Connect to a remote session
   */
  async connect(sessionTicket: string): Promise<string> {
    if (!this.node) {
      throw new Error('Client not initialized. Call initialize() first.')
    }

    this.session = await this.node.connect_to_session(sessionTicket)
    this.startEventLoop()
    return this.session.session_id
  }

  /**
   * Get session ID
   */
  getSessionId(): string | null {
    return this.session?.session_id ?? null
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.session !== null
  }

  /**
   * Send a message to the agent
   */
  async sendMessage(content: string): Promise<void> {
    if (!this.session) {
      throw new Error('Not connected to a session')
    }
    await this.session.send_message(content)
  }

  /**
   * Respond to a permission request
   */
  async respondToPermission(
    requestId: string,
    approved: boolean,
    reason?: string
  ): Promise<void> {
    if (!this.session) {
      throw new Error('Not connected to a session')
    }
    await this.session.respond_to_permission(requestId, approved, reason)
  }

  /**
   * Interrupt the current turn
   */
  async interrupt(): Promise<void> {
    if (!this.session) {
      throw new Error('Not connected to a session')
    }
    await this.session.interrupt()
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    if (this.eventReader) {
      await this.eventReader.cancel()
      this.eventReader = null
    }
    if (this.session) {
      await this.session.close()
      this.session = null
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(sessionId: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(sessionId)) {
      this.eventHandlers.set(sessionId, new Set())
    }
    this.eventHandlers.get(sessionId)!.add(handler)

    return () => {
      this.eventHandlers.get(sessionId)?.delete(handler)
    }
  }

  /**
   * Start event loop
   */
  private startEventLoop(): void {
    if (!this.session) return

    this.eventReader = this.session.receiver.getReader()

    const readLoop = async () => {
      try {
        while (this.eventReader && this.session) {
          const { done, value } = await this.eventReader.read()
          if (done) break

          try {
            const event = this.parseEvent(value)
            if (event) {
              this.dispatchEvent(event)
            }
          } catch (e) {
            console.error('Failed to parse event:', e, value)
          }
        }
      } catch (e) {
        console.error('Event loop error:', e)
      }
    }

    readLoop()
  }

  /**
   * Parse event from WASM
   */
  private parseEvent(value: unknown): AgentEvent | null {
    if (typeof value === 'object' && value !== null) {
      return value as AgentEvent
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as AgentEvent
      } catch {
        return null
      }
    }
    return null
  }

  /**
   * Dispatch event to handlers
   */
  private dispatchEvent(event: AgentEvent): void {
    const sessionId = event.sessionId
    const handlers = this.eventHandlers.get(sessionId)
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event)
        } catch (e) {
          console.error('Event handler error:', e)
        }
      })
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const agentClient = new AgentClient()
export { AgentClient }
