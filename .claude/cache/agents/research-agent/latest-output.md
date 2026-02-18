# Research Report: AionUi WebSocket Connection for OpenCode

## Executive Summary

AionUi implements OpenCode connectivity through the **OpenClaw Gateway** - a WebSocket-based intermediary that manages connections to various AI agents including OpenCode. Rather than connecting directly to OpenCode via WebSocket, AionUi spawns the OpenClaw Gateway process which provides a unified WebSocket API for agent communication. The Gateway uses device authentication with Ed25519 key pairs and a JSON-based protocol over WebSocket.

## Research Question

How does AionUi implement WebSocket connection for OpenCode?

## Key Findings

### Finding 1: OpenClaw Gateway as the WebSocket Server

AionUi does not connect directly to OpenCode via WebSocket. Instead, they use the **OpenClaw Gateway** as a WebSocket server that acts as an intermediary.

- **Gateway Process**: The `OpenClawGatewayManager` spawns the `openclaw gateway` CLI process
- **Default Port**: 18789 (configurable)
- **Command**: `openclaw gateway --port <port>`

**Source**: `/src/agent/openclaw/OpenClawGatewayManager.ts`

```typescript
// Starting the gateway
const args = ['gateway', '--port', String(this.port)];
this.process = spawn(spawnCommand, spawnArgs, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env,
  shell: isWindows,
});

// Looking for ready signal
if (output.includes('Gateway listening') || output.includes('WebSocket server started')) {
  // Gateway is ready
}
```

### Finding 2: WebSocket Client Implementation

The `OpenClawGatewayConnection` class implements a WebSocket client that connects to the Gateway using the `ws` library.

**Source**: `/src/agent/openclaw/OpenClawGatewayConnection.ts`

```typescript
import WebSocket from 'ws';

this.ws = new WebSocket(url, {
  maxPayload: 25 * 1024 * 1024, // Allow large responses
});

this.ws.on('open', () => {
  console.log('[OpenClawGateway] WebSocket connected, waiting for challenge...');
  this.queueConnect();
});

this.ws.on('message', (data) => this.handleMessage(this.rawDataToString(data)));
```

### Finding 3: Gateway Protocol Frames

The Gateway uses three frame types for communication:

**REQUEST Frame** (client to server):
```typescript
interface RequestFrame {
  type: 'req';
  id: string;        // UUID
  method: string;    // e.g., 'connect', 'chat.send', 'sessions.resolve'
  params?: unknown;
}
```

**RESPONSE Frame** (server to client):
```typescript
interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
}
```

**EVENT Frame** (server to client):
```typescript
interface EventFrame {
  type: 'event';
  event: string;        // e.g., 'connect.challenge', 'tick', 'chat.event'
  payload?: unknown;
  seq?: number;        // For gap detection
  stateVersion?: StateVersion;
}
```

**Source**: `/src/agent/openclaw/types.ts`

### Finding 4: Connection Handshake Flow

The authentication handshake follows this sequence:

1. **Gateway sends challenge**: `EVENT connect.challenge { nonce, ts }`
2. **Client sends connect**: `REQ connect { nonce, token, device... }`
3. **Gateway responds**: `RES { ok: true, payload: HelloOk }`

```typescript
// Handle connect challenge
if (evt.event === 'connect.challenge') {
  const payload = evt.payload as { nonce?: string } | undefined;
  const nonce = payload?.nonce;
  if (nonce) {
    this.connectNonce = nonce;
    this.sendConnect();  // Send connect request with auth
  }
}
```

**Source**: `/src/agent/openclaw/OpenClawGatewayConnection.ts` lines 243-260

### Finding 5: Device Authentication with Ed25519

AionUi uses Ed25519 key pairs for device authentication, stored in `~/.openclaw/identity/device.json` for compatibility with OpenClaw CLI.

**Key Generation**:
- Uses Node.js `crypto.generateKeyPairSync('ed25519')`
- Device ID is derived from public key fingerprint (SHA256)

**Payload Signing**:
```typescript
export function buildDeviceAuthPayload(params: DeviceAuthPayloadParams): string {
  const version = params.version ?? (params.nonce ? 'v2' : 'v1');
  const scopes = params.scopes.join(',');
  const base = [version, params.deviceId, params.clientId, params.clientMode,
                params.role, scopes, String(params.signedAtMs), token];
  if (version === 'v2') {
    base.push(params.nonce ?? '');
  }
  return base.join('|');
}
```

**Source**: `/src/agent/openclaw/deviceIdentity.ts`

### Finding 6: ACP Protocol Over Gateway

Once connected to the Gateway, ACP communication happens through the `chat.send` and `chat.event` methods:

```typescript
// Send chat message
async chatSend(params: ChatSendParams): Promise<unknown> {
  const fullParams: ChatSendParams = {
    ...params,
    idempotencyKey: randomUUID(),
  };
  return this.request('chat.send', fullParams, { expectFinal: true });
}

// Receive chat events
// Events are received via onEvent callback with event: 'chat.event'
```

**Source**: `/src/agent/openclaw/OpenClawGatewayConnection.ts` lines 116-130

### Finding 7: Reconnection and Heartbeat

The Gateway client implements automatic reconnection with exponential backoff and tick-based heartbeat:

```typescript
// Reconnection with exponential backoff
private scheduleReconnect(): void {
  this.reconnectAttempts++;
  const delay = this.backoffMs;
  this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
  this.reconnectTimer = setTimeout(() => {
    this.start();
  }, delay);
}

// Tick heartbeat
private startTickWatch(): void {
  this.tickTimer = setInterval(() => {
    const gap = Date.now() - this.lastTick;
    if (gap > this.tickIntervalMs * 2) {
      this.ws?.close(4000, 'tick timeout');
    }
  }, interval);
}
```

**Source**: `/src/agent/openclaw/OpenClawGatewayConnection.ts`

### Finding 8: Alternative - Direct ACP Connection

AionUi also supports **direct ACP connection** to OpenCode (without Gateway) using the `AcpConnection` class in `/src/agent/acp/AcpConnection.ts`.

For OpenCode specifically:
```typescript
// From acpTypes.ts
opencode: {
  id: 'opencode',
  name: 'OpenCode',
  cliCommand: 'opencode',
  enabled: true,
  acpArgs: ['acp'],  // Uses 'opencode acp' subcommand
}
```

This spawns OpenCode as a subprocess with ACP protocol over stdio:
```typescript
// Connect via stdio
this.child = spawn(config.command, config.args, config.options);

// Messages sent via stdin as JSON lines
this.child.stdin.write(JSON.stringify(message) + '\n');
```

**Source**: `/src/agent/acp/AcpConnection.ts`

## Architecture Summary

AionUi supports **two modes** for OpenCode:

### Mode 1: OpenClaw Gateway (WebSocket)
```
AionUi App → WebSocket → OpenClaw Gateway (port 18789) → OpenCode CLI
```

### Mode 2: Direct ACP (Stdio)
```
AionUi App → Stdio → OpenCode CLI (spawned with 'opencode acp')
```

## Key Files

| File | Purpose |
|------|---------|
| `/src/agent/openclaw/OpenClawGatewayConnection.ts` | WebSocket client for Gateway |
| `/src/agent/openclaw/OpenClawGatewayManager.ts` | Gateway process manager |
| `/src/agent/openclaw/types.ts` | Protocol types and constants |
| `/src/agent/openclaw/deviceIdentity.ts` | Ed25519 device authentication |
| `/src/agent/openclaw/deviceAuthStore.ts` | Device token storage |
| `/src/agent/acp/AcpConnection.ts` | Direct ACP connection (stdio) |
| `/src/types/acpTypes.ts` | ACP protocol types |

## Recommendations for Implementation

1. **For WebSocket-based OpenCode**: Consider using the OpenClaw Gateway approach for a unified interface
2. **For direct connection**: Use the ACP protocol over stdio (simpler, no Gateway dependency)
3. **Authentication**: Implement device identity using Ed25519 if using Gateway mode
4. **Protocol**: Use JSON-RPC style messages over WebSocket with the three frame types (req/res/event)

## Open Questions

- The exact format of `chat.send` payload for sending prompts to OpenCode
- How file operations are handled through the Gateway vs direct ACP
- Whether OpenCode itself exposes a WebSocket server or only works through OpenClaw Gateway
