# Streaming Message Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement per-message QUIC uni-stream transmission for `AgentMessage` and `TcpData` message types, isolating message-level reliability to prevent packet loss from blocking unrelated messages.

**Architecture:** Add `send_streaming_message()` and `accept_streaming_messages()` to `QuicMessageServer` and `QuicMessageClient`. Streaming messages (AgentMessage, TcpData) are sent on independent uni-streams via `open_uni()`, received via parallel `accept_uni()` loop. Non-streaming messages continue using existing shared BiDi stream via `open_bi()`/`accept_bi()`.

**Tech Stack:** Rust, iroh QUIC (noq), tokio

---

## Chunk 1: Add Streaming Sender to QuicMessageServer (Send Side Only)

**Scope:** This chunk covers only the **send/transmit side** for QuicMessageServer. The receive side is handled in Chunk 2. This separates send and receive changes for cleaner review.

**Files:**

- Modify: `shared/src/quic_server.rs:858-882` (add `send_streaming_message` method after `send_message_to_node`)

- [ ] **Step 1: Add helper function to determine streaming message type**

After line 838 (after `send_message`), add:

```rust
/// 判断消息类型是否应该使用独立 stream 发送
fn is_streaming_message(msg_type: MessageType) -> bool {
    matches!(msg_type, MessageType::AgentMessage | MessageType::TcpData)
}
```

- [ ] **Step 2: Add `send_streaming_message` method**

After `send_message_to_node` (after line 882), add:

```rust
/// 通过独立 uni-stream 发送流式消息（AgentMessage、TcpData）
/// 返回 stream ID 用于追踪
pub async fn send_streaming_message(
    &self,
    node_id: &EndpointId,
    message: &Message,
) -> Result<u64> {
    let connection = {
        let connections = self.connections.read().await;
        connections
            .values()
            .find(|c| c.node_id == *node_id)
            .map(|c| c.connection.clone())
            .ok_or_else(|| anyhow::anyhow!("Connection not found for node: {:?}", node_id))?
    };

    let mut send_stream = connection.open_uni().await?;
    let data = MessageSerializer::serialize_for_network(message)?;
    send_stream.write_all(&data).await?;
    send_stream.finish()?;

    Ok(send_stream.id())
}
```

- [ ] **Step 3: Add public routing method**

Add after `send_streaming_message`:

```rust
/// 发送消息到特定节点（自动选择传输方式）
/// - AgentMessage/TcpData: 使用独立 uni-stream
/// - 其他消息类型: 使用共享 BiDi stream
pub async fn send_message_to_node_auto(
    &self,
    node_id: &EndpointId,
    message: &Message,
) -> Result<()> {
    if Self::is_streaming_message(message.message_type) {
        self.send_streaming_message(node_id, message).await?;
    } else {
        self.send_message_to_node(node_id, message.clone()).await?;
    }
    Ok(())
}
```

- [ ] **Step 4: Run cargo build to verify compilation**

```bash
cargo build -p shared 2>&1 | head -50
```

Expected: Successful build, no errors

- [ ] **Step 5: Commit**

```bash
git add shared/src/quic_server.rs
git commit -m "feat(quic): add send_streaming_message for uni-stream transport"
```

---

## Chunk 2: Add Streaming Receiver to QuicMessageServer

**Files:**

- Modify: `shared/src/quic_server.rs:540-648` (add streaming accept loop alongside existing handle_message_streams)

- [ ] **Step 1: Add streaming stream handler method**

After `handle_message_stream_with_initial_data` (around line 756, before the next method), add:

```rust
/// 处理来自独立 uni-stream 的流式消息
async fn handle_streaming_stream(
    &self,
    mut recv: iroh::endpoint::RecvStream,
    connection_id: String,
) -> Result<()> {
    const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024; // 16 MiB
    let read_result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        recv.read_to_end(MAX_MESSAGE_SIZE),
    )
    .await;

    match read_result {
        Ok(Ok(data)) => {
            match MessageSerializer::deserialize_from_network(&data) {
                Ok(message) => {
                    info!(
                        "📨 Received streaming message: connection_id={}, type={:?}, id={}",
                        connection_id,
                        message.message_type,
                        message.id
                    );
                    self.communication_manager
                        .receive_incoming_message(message)
                        .await?;
                }
                Err(e) => {
                    error!("Failed to deserialize streaming message: {}", e);
                }
            }
        }
        Ok(Err(e)) => {
            debug!("Streaming stream closed: {}", e);
        }
        Err(_) => {
            warn!("Streaming stream read timeout");
            recv.stop(0)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Add accept_streaming_messages loop method**

Add after `handle_message_streams` (around line 648):

```rust
/// 启动接收独立 uni-stream 消息的任务
/// 与 handle_message_streams (accept_bi) 并行运行
async fn accept_streaming_messages(
    connection: iroh::endpoint::Connection,
    connection_id: String,
    communication_manager: Arc<CommunicationManager>,
) -> Result<()> {
    let remote_id = connection.remote_id();
    info!("📨 Starting streaming message receiver for connection: {}", connection_id);

    loop {
        match connection.accept_uni().await {
            Ok(Some(recv)) => {
                let cm = communication_manager.clone();
                let conn_id = connection_id.clone();
                let remote = remote_id;

                tokio::spawn(async move {
                    debug!("📨 Accepted streaming stream from {:?}", remote);
                    if let Err(e) = Self::handle_streaming_stream_static(
                        recv,
                        conn_id,
                        cm,
                    )
                    .await
                    {
                        error!("Error handling streaming stream: {}", e);
                    }
                });
            }
            Ok(None) => {
                info!("📨 Streaming receiver: connection {} closed", connection_id);
                break;
            }
            Err(e) => {
                debug!("accept_uni error for {}: {}", connection_id, e);
                break;
            }
        }
    }
    Ok(())
}

/// Static helper for streaming stream handling (needed for tokio::spawn)
async fn handle_streaming_stream_static(
    mut recv: iroh::endpoint::RecvStream,
    connection_id: String,
    communication_manager: Arc<CommunicationManager>,
) -> Result<()> {
    const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;
    let read_result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        recv.read_to_end(MAX_MESSAGE_SIZE),
    )
    .await;

    match read_result {
        Ok(Ok(data)) => {
            match MessageSerializer::deserialize_from_network(&data) {
                Ok(message) => {
                    info!(
                        "📨 [streaming] Received: type={:?}, id={}",
                        message.message_type,
                        message.id
                    );
                    communication_manager
                        .receive_incoming_message(message)
                        .await?;
                }
                Err(e) => {
                    error!("Failed to deserialize streaming message: {}", e);
                }
            }
        }
        Ok(Err(e)) => {
            debug!("Streaming stream closed: {}", e);
        }
        Err(_) => {
            warn!("Streaming stream read timeout");
            recv.stop(0)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Integrate accept_streaming_messages into connection handling**

Find where `handle_message_streams` is called (look for `spawn` calling `handle_message_streams`). Around line 470-500, add the streaming accept task alongside the existing message stream task.

Read lines 460-540 to find the exact integration point:

```bash
sed -n '460,540p' shared/src/quic_server.rs
```

After finding the spawn point, add a second spawn for `accept_streaming_messages`:

```rust
// Existing: tokio::spawn(async move { Self::handle_message_streams(...) })
// Add after it:
tokio::spawn(async move {
    if let Err(e) = Self::accept_streaming_messages(
        connection.clone(),
        connection_id.clone(),
        communication_manager.clone(),
    )
    .await
    {
        debug!("accept_streaming_messages ended: {}", e);
    }
});
```

- [ ] **Step 4: Run cargo check**

```bash
cargo check -p shared 2>&1 | head -80
```

Expected: No errors related to our new methods

- [ ] **Step 5: Commit**

```bash
git add shared/src/quic_server.rs
git commit -m "feat(quic): add accept_streaming_messages for parallel uni-stream reception"
```

---

## Chunk 3: Add Streaming Methods to QuicMessageClient

**Scope:** Covers both send and receive for QuicMessageClient.

**Files:**

- Modify: `shared/src/quic_server.rs` (client section, around line 1377-1450)

- [ ] **Step 1: Add `send_streaming_message` to QuicMessageClient**

Find `send_message_to_server` around line 1377 and add the streaming variant after it:

```rust
/// 通过独立 uni-stream 发送流式消息到服务器
pub async fn send_streaming_message_to_server(
    &self,
    connection_id: &str,
    message: &Message,
) -> Result<u64> {
    let connection = {
        let connections = self.server_connections.read().await;
        connections
            .get(connection_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Connection not found: {}", connection_id))?
    };

    let mut send_stream = connection.open_uni().await?;
    let data = MessageSerializer::serialize_for_network(message)?;
    send_stream.write_all(&data).await?;
    send_stream.finish()?;

    Ok(send_stream.id())
}
```

- [ ] **Step 2: Add auto-routing send for client**

Add after `send_streaming_message_to_server`:

```rust
/// 发送消息到服务器（自动选择传输方式）
pub async fn send_message_to_server_auto(
    &self,
    connection_id: &str,
    message: &Message,
) -> Result<()> {
    if Self::is_streaming_message(message.message_type) {
        self.send_streaming_message_to_server(connection_id, message).await?;
    } else {
        self.send_message_to_server(connection_id, message.clone()).await?;
    }
    Ok(())
}
```

- [ ] **Step 3: Add streaming stream handler for client**

Find `handle_incoming_stream` around line 1524 and add a streaming handler after it:

```rust
/// 处理来自独立 uni-stream 的流式消息（客户端用）
async fn handle_streaming_stream_client(
    mut recv: iroh::endpoint::RecvStream,
    message_tx: broadcast::Sender<Message>,
) -> Result<()> {
    const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;
    let read_result = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        recv.read_to_end(MAX_MESSAGE_SIZE),
    )
    .await;

    match read_result {
        Ok(Ok(data)) => {
            match MessageSerializer::deserialize_from_network(&data) {
                Ok(message) => {
                    info!("📨 [client streaming] Received: type={:?}, id={}",
                          message.message_type, message.id);
                    message_tx.send(message)?;
                }
                Err(e) => {
                    error!("Failed to deserialize streaming message: {}", e);
                }
            }
        }
        Ok(Err(e)) => {
            debug!("Client streaming stream closed: {}", e);
        }
        Err(_) => {
            warn!("Client streaming stream read timeout");
            recv.stop(0)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Add accept_streaming_messages for client**

Find where the client's `accept_bi` loop is spawned (around line 1321) and add a parallel `accept_uni` loop:

Look at the structure around line 1315-1372 where the client spawns the receiver task. After the `tokio::spawn` that handles `accept_bi`, add a second spawn:

```rust
// After the existing spawn for accept_bi (around line 1321), add:
let connection_for_streaming = connection.clone();
let message_tx_streaming = message_tx.clone();
let connection_id_streaming = connection_id_clone.clone();
let server_connections_streaming = server_connections_clone.clone();

tokio::spawn(async move {
    loop {
        match connection_for_streaming.accept_uni().await {
            Ok(Some(recv)) => {
                let tx = message_tx_streaming.clone();
                tokio::spawn(async move {
                    if let Err(e) = Self::handle_streaming_stream_client(recv, tx).await {
                        error!("Client streaming stream error: {}", e);
                    }
                });
            }
            Ok(None) => {
                debug!("Client streaming receiver: connection {} closed", connection_id_streaming);
                break;
            }
            Err(e) => {
                debug!("Client accept_uni error: {}", e);
                break;
            }
        }
    }
});
```

- [ ] **Step 5: Run cargo check**

```bash
cargo check -p shared 2>&1 | head -100
```

Expected: No errors. If there are borrows issues with `self` in the spawned tasks, use `Arc<Self>` pattern similar to server.

- [ ] **Step 6: Commit**

```bash
git add shared/src/quic_server.rs
git commit -m "feat(quic): add streaming message support to QuicMessageClient"
```

---

## Chunk 4: Verify and Test

**Files:**

- Modify: `shared/src/quic_server.rs` (if fixes needed)
- Create: `shared/tests/streaming_message_test.rs` (optional integration test)

- [ ] **Step 1: Run cargo build**

```bash
cargo build -p shared 2>&1
```

Expected: Successful build

- [ ] **Step 2: Run cargo clippy with warnings as errors**

```bash
cargo clippy -p shared -- -D warnings 2>&1 | head -50
```

Expected: No warnings

- [ ] **Step 3: Run cargo fmt check**

```bash
cargo fmt --all -- --check 2>&1
```

Expected: No formatting issues

- [ ] **Step 4: Verify existing tests still pass**

```bash
cargo test -p shared -- --nocapture 2>&1 | tail -50
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add shared/src/quic_server.rs
git commit -m "test(quic): verify streaming message implementation"
```

---

## Summary

After all chunks:

- `QuicMessageServer::send_streaming_message()` - sends via independent uni-stream
- `QuicMessageServer::send_message_to_node_auto()` - auto-routing based on message type
- `QuicMessageServer::accept_streaming_messages()` - parallel accept_uni loop
- `QuicMessageClient::send_streaming_message_to_server()` - sends via independent uni-stream
- `QuicMessageClient::send_message_to_server_auto()` - auto-routing based on message type
- `QuicMessageClient::accept_streaming_messages()` - parallel accept_uni loop on client side
- `is_streaming_message_type()` - helper to determine transport method
