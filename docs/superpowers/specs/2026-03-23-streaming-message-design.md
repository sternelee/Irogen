# Stream Separation Design for Reliable Message Delivery

**Date:** 2026-03-23  
**Status:** Draft  
**Author:** Claude

## Summary

Implement per-message QUIC uni-stream transmission for `AgentMessage` and `TcpData` message types to isolate message-level reliability, preventing packet loss from blocking unrelated messages.

## Problem Statement

When network instability occurs during remote mode communication between App and CLI via iroh QUIC, packet loss on a shared stream blocks all subsequent messages, including those unrelated to the lost data. This is particularly problematic for AI agent streaming output where latency and continuity are critical.

## Solution Overview

Each `AgentMessage` and `TcpData` message will be sent on its own independent QUIC uni-stream. QUIC provides built-in reliability per stream, ensuring that packet loss only affects the individual stream, not other concurrent streams.

## Architecture

### Transport Separation

```
┌─────────────────────────────────────────────────────────────┐
│ Current: Shared BiDi Stream                                  │
│ ┌──────────┬──────────┬──────────┬──────────┐            │
│ │ Message1 │ Message2 │ Message3 │ Message4 │  ...       │
│ └──────────┴──────────┴──────────┴──────────┘            │
│ Packet loss on Message2 blocks 3 and 4                      │
├─────────────────────────────────────────────────────────────┤
│ Proposed: Per-Message Uni Streams                           │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│ │ Stream 1 │  │ Stream 2 │  │ Stream 3 │  ...            │
│ │ Message1 │  │ Message2 │  │ Message3 │                  │
│ └──────────┘  └──────────┘  └──────────┘                │
│ Each stream has independent reliability                     │
└─────────────────────────────────────────────────────────────┘
```

### Component Changes

#### Modified Components

**shared/src/quic_server.rs:**

- Add `send_streaming_message()` and `accept_streaming_messages()` to `QuicMessageServer`
- Add `send_streaming_message()` to `QuicMessageClient`

**shared/src/message_protocol.rs:**

- No changes to protocol or Message structure

## Detailed Design

### Message Type Routing

```rust
fn is_streaming_message(msg_type: MessageType) -> bool {
    matches!(msg_type, MessageType::AgentMessage | MessageType::TcpData)
}
```

### Sending Flow (Server and Client)

Both `QuicMessageServer` and `QuicMessageClient` use the same sending pattern:

```rust
impl QuicMessageServer {
    /// Send a message on its own independent uni-stream
    /// Returns the stream ID for tracking
    pub async fn send_streaming_message(
        &self,
        message: &Message,
    ) -> Result<u64> {
        let mut send_stream = self.connection.open_uni().await?;
        let data = MessageSerializer::serialize_for_network(message)?;
        send_stream.write_all(&data).await?;
        send_stream.finish()?;
        Ok(send_stream.id())
    }
}

impl QuicMessageClient {
    /// Client-side streaming message sender
    pub async fn send_streaming_message(
        &self,
        message: &Message,
    ) -> Result<u64> {
        let mut send_stream = self.connection.open_uni().await?;
        let data = MessageSerializer::serialize_for_network(message)?;
        send_stream.write_all(&data).await?;
        send_stream.finish()?;
        Ok(send_stream.id())
    }
}
```

**Note on QUIC Flow Control:** If the receiver's window is exhausted, `write_all` will block. For streaming messages where blocking is undesirable, use `write_chunk` with proper error handling. The transport layer will buffer internally and apply backpressure.

### Receiving Flow

```rust
impl QuicMessageServer {
    /// Start accepting independent uni-streams for streaming messages
    /// Runs concurrently with the existing accept_bi loop
    pub async fn accept_streaming_messages(self: Arc<Self>) -> Result<()> {
        loop {
            match self.connection.accept_uni().await {
                Ok(Some(recv_stream)) => {
                    let server = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = server.handle_streaming_stream(recv_stream).await {
                            error!("Streaming stream handler error: {}", e);
                        }
                    });
                }
                Ok(None) => break,
                Err(e) => {
                    error!("accept_uni error: {}", e);
                }
            }
        }
        Ok(())
    }

    async fn handle_streaming_stream(
        &self,
        mut recv: RecvStream,
    ) -> Result<()> {
        const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;
        let data = recv.read_to_end(MAX_MESSAGE_SIZE).await?;
        let message = MessageSerializer::deserialize_from_network(&data)?;
        self.message_tx.send(message)?;
        Ok(())
    }
}
```

### Backward Compatibility

- Protocol (Message structure) unchanged
- Non-streaming messages (heartbeat, control, etc.) continue using shared stream
- New and old receivers can coexist; old versions ignore uni-streams

### Error Handling

**Send Errors:**

- `open_uni` failure → propagate error to caller, caller decides retry
- `write_all` failure (including flow control exhaustion) → propagate error to caller
- `finish` failure → log warning, data may still be received

**Receive Errors:**

- `message_tx.send()` failure (channel full/closed) → log error with message ID, drop stream
- Stream reset by sender → `read_to_end` returns error, log and continue
- Half-open stream (sender opens but never finishes) → `read_to_end` times out after MAX_MESSAGE_SIZE / bytes_per_second estimation; receiver should call `recv.stop(0)` to abort

**Channel Full Scenario:** If upper layer cannot keep up, messages are dropped. This is intentional for streaming data (tolerance for loss as per design decision). For `TcpData`, upper layer should implement reconnection logic.

**Upper Layer Recovery (by message type):**

- `AgentMessage`: AI output has inherent tolerance for gaps (models can continue from partial output). If a chunk is lost, the stream continues; upper layer may request regeneration or accept partial output.
- `TcpData`: If a data message is lost, the TCP session should be reopened. The existing TCP forwarding reconnection logic handles this.

### Sequence Diagram

```
Sender                          Receiver
   │                               │
   │──── open_uni() ──────────────►│ accept_uni() returns RecvStream
   │──── write_all(data) ─────────►│
   │──── finish() ─────────────────►│ (sends FIN marker)
   │                               │ read_to_end() completes
   │                               │ deserialize message
   │                               │ send to upper layer via channel
   │                               │
   │     (stream auto-cleanup)     │
```

### Concurrency Safety

**iroh QUIC supports simultaneous `accept_uni` and `accept_bi`** on the same connection. Each stream type is independent:

- `accept_bi()` handles the original shared stream (non-streaming messages)
- `accept_uni()` handles new independent streams (streaming messages)
- Both can run concurrently in separate tasks without synchronization

### Stream Lifecycle

1. Sender calls `open_uni()` → gets `SendStream`
2. Sender writes data via `write_all()` → data buffered by QUIC
3. Sender calls `finish()` → sends FIN marker
4. Receiver calls `accept_uni()` → gets `RecvStream`
5. Receiver reads via `read_to_end()` → blocks until FIN received
6. Stream automatically cleaned up after both sides finish

## File Structure

```
shared/src/
├── quic_server.rs         # MODIFIED: Add send_streaming_message(), accept_streaming_messages()
└── message_protocol.rs   # NO CHANGE: Protocol unchanged
```

**Note:** No new modules needed. Streaming functionality is added directly to existing `QuicMessageServer` and `QuicMessageClient` structs.

## Implementation Sequence

1. Add `send_streaming_message()` to `QuicMessageServer`
2. Add `send_streaming_message()` to `QuicMessageClient`
3. Add `accept_streaming_messages()` loop to `QuicMessageServer`
4. Add `accept_streaming_messages()` loop to `QuicMessageClient`
5. Add routing logic at call sites: use `send_streaming_message()` for `AgentMessage` and `TcpData`, existing `send_message()` for others
6. Add timeout for `read_to_end()` in stream handler
7. Add tests for streaming send/receive
8. Verify existing non-streaming messages still work

## Testing Considerations

- Unit tests for `is_streaming_message()` routing
- Integration tests for message send/receive on independent streams
- Test that stream failure does not affect other concurrent streams
- Verify backward compatibility with existing message types
