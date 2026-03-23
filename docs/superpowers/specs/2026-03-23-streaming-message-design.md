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

#### New Modules (shared/src/)

- `streaming_sender.rs` - `StreamingMessageSender` for sending messages on independent streams
- `streaming_receiver.rs` - `StreamingMessageReceiver` for receiving messages from independent streams

#### Modified Components

- `quic_server.rs` - Add `send_streaming_message()` and `accept_streaming_messages()` methods
- Message routing logic to distinguish streaming vs non-streaming message types

## Detailed Design

### Message Type Routing

```rust
fn is_streaming_message(msg_type: MessageType) -> bool {
    matches!(msg_type, MessageType::AgentMessage | MessageType::TcpData)
}
```

### Sending Flow

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
```

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

- Stream failure → log error → notify upper layer via channel/event
- Upper layer decides recovery strategy (AI output can skip; TCP data can reconnect)
- No automatic retry at transport layer (simplicity principle)

## File Structure

```
shared/src/
├── streaming_sender.rs     # NEW: StreamingMessageSender
├── streaming_receiver.rs   # NEW: StreamingMessageReceiver
├── quic_server.rs         # MODIFIED: Add streaming methods
└── message_protocol.rs    # NO CHANGE: Protocol unchanged
```

## Implementation Sequence

1. Create `streaming_sender.rs` with `StreamingMessageSender`
2. Create `streaming_receiver.rs` with `StreamingMessageReceiver`
3. Integrate into `QuicMessageServer` and `QuicMessageClient`
4. Add message type routing logic
5. Add tests for streaming send/receive
6. Verify existing non-streaming messages still work

## Testing Considerations

- Unit tests for `is_streaming_message()` routing
- Integration tests for message send/receive on independent streams
- Test that stream failure does not affect other concurrent streams
- Verify backward compatibility with existing message types
