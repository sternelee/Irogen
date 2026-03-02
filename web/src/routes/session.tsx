/**
 * Session Route
 *
 * Remote agent session interface
 */

import { onCleanup, onMount, Show } from 'solid-js'
import { createFileRoute } from '@tanstack/solid-router'
import { Terminal, Wifi, WifiOff, Loader2 } from 'lucide-solid'

import {
  agentClient,
  connectionStore,
  connectionActions,
  connectionSelectors,
  sessionStore,
  sessionActions,
  sessionSelectors,
  chatStore,
  chatActions,
  chatSelectors,
  type AgentEvent,
} from '../session'

import { SessionSidebar } from '../session/components/SessionSidebar'
import { ChatView } from '../session/components/ChatView'
import { ConnectionPanel } from '../session/components/ConnectionPanel'

export const Route = createFileRoute('/session')({
  component: SessionPage,
})

function SessionPage() {
  // Connection status - access state via .state property
  const isConnected = () =>
    connectionSelectors.isConnected(connectionStore.state)
  const isConnecting = () =>
    connectionSelectors.isConnecting(connectionStore.state)
  const connectionError = () =>
    connectionSelectors.getConnectionError(connectionStore.state)

  // Session status - access state via .state property
  const activeSessionId = () =>
    sessionSelectors.getActiveSessionId(sessionStore.state)
  const activeSession = () =>
    sessionSelectors.getActiveSession(sessionStore.state)
  const sessions = () =>
    sessionSelectors.getSessions(sessionStore.state)

  // Initialize client
  onMount(async () => {
    try {
      const nodeId = await agentClient.initialize()
      connectionActions.setNodeId(nodeId)
      console.log('Agent client initialized:', nodeId)
    } catch (e) {
      console.error('Failed to initialize agent client:', e)
      connectionActions.setConnectionError(
        'Failed to initialize: ' + String(e)
      )
    }
  })

  // Cleanup
  onCleanup(async () => {
    await agentClient.close()
  })

  // Handle connection
  const handleConnect = async (ticket: string) => {
    connectionActions.setConnecting(true)
    connectionActions.setConnectionError(null)

    try {
      const sessionId = await agentClient.connect(ticket)

      // Create session metadata
      sessionActions.addSession({
        sessionId,
        agentType: 'claude',
        projectPath: 'Remote',
        startedAt: Date.now(),
        active: true,
        hostname: 'remote',
        currentDir: 'remote',
      })

      sessionActions.setActiveSession(sessionId)
      connectionActions.setConnectionState('connected')

      // Subscribe to events
      agentClient.subscribe(sessionId, handleAgentEvent)
    } catch (e) {
      connectionActions.setConnectionError(
        'Connection failed: ' + String(e)
      )
    } finally {
      connectionActions.setConnecting(false)
    }
  }

  // Handle agent events
  const handleAgentEvent = (event: AgentEvent) => {
    const sid = event.sessionId

    switch (event.type) {
      case 'session:started':
        console.log('Session started:', event)
        break

      case 'turn:started':
        sessionActions.setSessionThinking(sid, true)
        chatActions.startStreaming(sid)
        break

      case 'text:delta': {
        const textEvent = event as any
        chatActions.appendStreamingContent(sid, textEvent.text)
        break
      }

      case 'tool:started': {
        const toolEvent = event as any
        chatActions.updateToolStatus(sid, {
          id: toolEvent.toolId,
          toolName: toolEvent.toolName,
          status: 'started',
          input: toolEvent.input,
          timestamp: Date.now(),
        })
        break
      }

      case 'tool:completed': {
        const toolEvent = event as any
        chatActions.updateToolStatus(sid, {
          id: toolEvent.toolId,
          toolName: toolEvent.toolName || 'unknown',
          status: toolEvent.error ? 'failed' : 'completed',
          output: toolEvent.output,
          timestamp: Date.now(),
        })
        break
      }

      case 'approval:request': {
        const approvalEvent = event as any
        chatActions.addPermissionRequest(sid, {
          sessionId: sid,
          toolName: approvalEvent.toolName,
          toolParams: approvalEvent.input,
          description: approvalEvent.message || 'Permission request',
        })
        break
      }

      case 'turn:completed': {
        sessionActions.setSessionThinking(sid, false)
        chatActions.stopStreaming(sid)

        // Add assistant message from streaming content
        const content = chatSelectors.getStreamingContent(sid)(chatStore.state)
        if (content) {
          chatActions.addMessage(sid, {
            role: 'assistant',
            content,
          })
        }
        break
      }

      case 'turn:error':
        sessionActions.setSessionThinking(sid, false)
        chatActions.stopStreaming(sid)
        chatActions.addMessage(sid, {
          role: 'assistant',
          content: `Error: ${(event as any).error}`,
        })
        break

      case 'session:ended':
        sessionActions.updateSession(sid, { active: false })
        break
    }
  }

  // Handle send message
  const handleSendMessage = async (content: string) => {
    const sid = activeSessionId()
    if (!sid) return

    // Add user message
    chatActions.addMessage(sid, {
      role: 'user',
      content,
    })

    // Send to agent
    await agentClient.sendMessage(content)
  }

  // Handle permission response
  const handlePermissionResponse = async (
    requestId: string,
    approved: boolean,
    reason?: string
  ) => {
    const sid = activeSessionId()
    if (!sid) return

    await agentClient.respondToPermission(requestId, approved, reason)
    chatActions.respondToPermission(
      sid,
      requestId,
      approved ? 'approved' : 'denied'
    )
  }

  // Handle interrupt
  const handleInterrupt = async () => {
    await agentClient.interrupt()
  }

  return (
    <div class="flex h-screen bg-slate-900 text-white">
      {/* Sidebar */}
      <div class="w-64 flex-shrink-0 border-r border-slate-700">
        <SessionSidebar
          sessions={sessions()}
          activeSessionId={activeSessionId()}
          onSelectSession={(id: string) => sessionActions.setActiveSession(id)}
          onNewSession={() => sessionActions.openNewSessionModal('remote')}
        />
      </div>

      {/* Main Content */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header class="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/50">
          <div class="flex items-center gap-3">
            <Terminal class="w-5 h-5 text-cyan-400" />
            <h1 class="text-lg font-semibold">ClawdPilot Session</h1>
          </div>

          <div class="flex items-center gap-2">
            <Show when={isConnected()} fallback={
              <div class="flex items-center gap-1 text-red-400">
                <WifiOff class="w-4 h-4" />
                <span class="text-sm">Disconnected</span>
              </div>
            }>
              <div class="flex items-center gap-1 text-green-400">
                <Wifi class="w-4 h-4" />
                <span class="text-sm">Connected</span>
              </div>
            </Show>

            <Show when={isConnecting()}>
              <Loader2 class="w-4 h-4 animate-spin text-cyan-400" />
            </Show>
          </div>
        </header>

        {/* Content */}
        <div class="flex-1 overflow-hidden">
          <Show when={!isConnected() && sessions().length === 0}>
            <ConnectionPanel
              onConnect={handleConnect}
              isConnecting={isConnecting()}
              error={connectionError()}
            />
          </Show>

          <Show when={activeSessionId()}>
            <ChatView
              sessionId={activeSessionId()!}
              messages={chatSelectors.getMessages(activeSessionId()!)(chatStore.state)}
              streamingContent={chatSelectors.getStreamingContent(activeSessionId()!)(chatStore.state)}
              isStreaming={chatSelectors.isStreaming(activeSessionId()!)(chatStore.state)}
              pendingPermissions={chatSelectors.getPendingPermissions(activeSessionId()!)(chatStore.state)}
              thinking={activeSession()?.thinking ?? false}
              onSendMessage={handleSendMessage}
              onPermissionResponse={handlePermissionResponse}
              onInterrupt={handleInterrupt}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}
