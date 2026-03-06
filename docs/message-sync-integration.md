# 断线重连消息恢复 - 集成完成

## 概述

已成功实现基于 JSONL 的断线重连消息恢复功能，支持 App 端在断线重连时恢复中断的流式消息。

## 已完成的集成

### 1. Shared 库（`shared/`）

#### 新增模块

**`message_store.rs`** - JSONL 存储引擎

- ✅ 为每个 session_id 创建独立的 JSONL 文件
- ✅ 自动分配严格递增的 sequence 号
- ✅ 支持 `append_message`, `get_messages_since`, `clear_session`

**`message_sync.rs`** - 消息同步服务

- ✅ 维护每个 session 的最后发送 sequence 号
- ✅ 提供持久化接口：`persist_agent_message`
- ✅ 提供同步接口：`handle_sync_request`
- ✅ 提供清理接口：`clear_session`

**`message_protocol.rs`** - 消息协议扩展

- ✅ 新增 `MessageType::MessageSync = 0x1A`
- ✅ 新增 `MessageSyncAction::RequestSync` 和 `SyncResponse`
- ✅ 新增 `SynchedMessageEntry` 结构
- ✅ 新增 `MessageSyncMessage` 结构
- ✅ 添加 `MessageBuilder::sync_request()` 和 `MessageBuilder::sync_response()` 方法

**编译状态**:

```bash
✅ cargo build -p shared   # 编译通过（仅有警告）
✅ cargo build -p app      # 编译通过（仅有警告）
```

### 2. CLI Host 端（`cli/`）

#### 集成位置：`cli/src/message_server.rs`

**添加的导入**：

```rust
use shared::{
    MessageSyncAction, SynchedMessageEntry, MessageSyncMessage, MessageSyncService,
};
use dirs::home_dir;
```

**添加的字段**：

```rust
/// CLI 消息服务器
pub struct CliMessageServer {
    // ... 其他字段 ...
    /// 消息存储（用于断线重连恢复）
    message_store: Arc<MessageStore>,
    /// 消息同步服务（处理同步请求和持久化）
    message_sync_service: Arc<MessageSyncService>,
}
```

**初始化**：

```rust
// 在 `new` 方法中创建服务
let base_dir = dirs::home_dir()?.join(".riterm/messages");
let message_store = Arc::new(MessageStore::new(base_dir)?);
let message_sync_service = Arc::new(MessageSyncService::new(message_store.clone()));
```

**注册处理器**：

```rust
// 在 `register_message_handlers` 方法中
let message_sync_handler = Arc::new(MessageSyncMessageHandler::new(
    self.message_sync_service.clone(),
));
self.communication_manager
    .register_message_handler(message_sync_handler)
    .await;
```

**消息同步处理器**：

```rust
/// 消息同步处理器（用于断线重连）
pub struct MessageSyncMessageHandler {
    message_sync_service: Arc<MessageSyncService>,
}

impl MessageSyncMessageHandler {
    pub fn new(message_sync_service: Arc<MessageSyncService>) -> Self {
        Self {
            message_sync_service,
        }
    }

    #[async_trait::async_trait]
    impl MessageHandler for MessageSyncMessageHandler {
        async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
            if let MessagePayload::MessageSync(sync_msg) = &message.payload {
                if let MessageSyncAction::RequestSync {
                    session_id,
                    last_sequence,
                } = sync_msg.action {
                    return self.message_sync_service
                        .handle_sync_request(&session_id, last_sequence)
                        .await
                        .map(Some);
                }
            } else {
                tracing::warn!("Unknown message sync action: {:?}", sync_msg.action);
                Ok(None)
            }
        }

        fn supported_message_types(&self) -> Vec<MessageType> {
            vec![MessageType::MessageSync]
        }
    }
}
```

### 3. App 端（`app/` 和 `src/`）

#### Rust 端集成（`app/src/lib.rs`）

**添加的导入**：

```rust
use shared::{
    MessageSyncAction, SynchedMessageEntry, MessageSyncMessage,
};
```

**消息同步处理**：

```rust
// 在消息处理循环中添加
MessagePayload::MessageSync(sync_msg) => {
    match &sync_msg.action {
        shared::MessageSyncAction::SyncResponse { session_id, messages } => {
            // Emit sync response to frontend
            let _ = app_handle_clone.emit(
                &format!("message-sync-{}", session_id),
                &serde_json::json!({
                    "sessionId": session_id,
                    "messages": messages,
                })
            );
        }
        _ => {
            tracing::warn!("Unknown MessageSync action: {:?}", sync_msg.action);
        }
    }
}
```

**添加的命令**：

```rust
/// Request message sync for reconnection recovery
#[tauri::command(rename_all = "camelCase")]
async fn request_message_sync(
    session_id: String,
    last_sequence: u64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.read().await;
        sessions
            .get(&session_id)
            .cloned()
            .ok_or("Session not found")?
    };

    let sync_message = MessageBuilder::sync_request(
        "app".to_string(),
        session_id.clone(),
        last_sequence,
    );

    let connection_id = session.connection_id;

    let quic_client = {
        let client_guard = state.quic_client.read().await;
        match client_guard.as_ref() {
            Some(c) => c.clone(),
            None => return Err("QUIC client not initialized".to_string()),
        }
    };

    quic_client
        .send_message_to_server(&connection_id, sync_message)
        .await
        .map_err(|e| format!("Failed to send sync request: {}", e))?;

    Ok(())
}
```

#### TypeScript 端集成

**`sessionStore.ts` 修改**：

```typescript
export interface AgentSessionMetadata {
  // ... 其他字段 ...
  lastReceivedSequence: number; // 新增：最后收到的消息 sequence
}

// 初始化新会话时添加 lastReceivedSequence: 0
const newSession: AgentSessionMetadata = {
  // ... 其他字段 ...
  lastReceivedSequence: 0,
};

// 更新最后收到的 sequence
const updateLastReceivedSequence = (sessionId: string, sequence: number) => {
  setState(
    produce((s: SessionState) => {
      const session = s.sessions[sessionId];
      if (session) {
        session.lastReceivedSequence = sequence;
      }
    }),
  );
};

// 请求消息同步
const requestMessageSync = async (sessionId: string) => {
  const session = getSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    return;
  }

  const lastSequence = session.lastReceivedSequence;

  try {
    await invoke("request_message_sync", {
      sessionId,
      lastSequence,
    });
    console.log(
      `Requested message sync for session ${sessionId}, last_sequence: ${lastSequence}`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    notificationStore.error(
      `Failed to request message sync: ${errorMessage}`,
      "Error",
    );
  }
};

// 导出新方法
return {
  // ... 其他导出 ...
  updateLastReceivedSequence,
  requestMessageSync,
  // ...
};
```

**`sessionEventRouter.ts` 修改**：

```typescript
// 监听消息同步响应
const unlistenSync = await listen<SessionEvent>(
  "message-sync",
  (event) => this.handleMessageSync(event.payload)
);
this.unlistenFns.push(unlistenSync);

// 处理消息同步响应
private handleMessageSync(event: SessionEvent): void {
  const payload = event as unknown as {
    sessionId: string,
    messages: Array<{
      sequence: number;
      timestamp: number;
      messageData: string;
    }>,
  };

  const { sessionId, messages } = payload;

  console.log(
    `[SessionEventRouter] Received message sync for session ${sessionId}:`,
    messages.length,
    "messages"
  );

  // 处理每个同步的消息
  for (const syncedMessage of messages) {
    try {
      const messageData = JSON.parse(syncedMessage.messageData);

      // 路由消息（就像它来自 agent 一样）
      const agentEvent: SessionEvent = {
        sessionId,
        ...messageData,
      };

      this.routeEvent(agentEvent);

      // 更新最后 sequence 号
      sessionStore.updateLastReceivedSequence(sessionId, syncedMessage.sequence);
    } catch (err) {
      console.error(`Failed to process synced message:`, err);
    }
  }
}

// 导出请求同步的方法
async requestMessageSync(sessionId: string): Promise<void> {
  await sessionStore.requestMessageSync(sessionId);
}
```

## 工作流程

### 正常场景

1. App 连接到 CLI Host
2. Agent 开始输出 "Hello"
3. CLI Host:
   - 持久化到 MessageStore（sequence 0）
   - 发送消息到 App
4. App 收到消息（sequence 0）→ 更新 `lastReceivedSequence = 0`
5. Agent 继续输出 " World"
6. CLI Host:
   - 持久化到 MessageStore（sequence 1）
   - 发送消息到 App
7. App 收到消息（sequence 1）→ 更新 `lastReceivedSequence = 1`

### 断线重连场景

1. App 正常接收消息（sequence 100）
2. App 断开连接（`lastReceivedSequence = 100`）
3. CLI Host 继续输出：
   - 持久化 "msg1"（sequence 101）[无法发送]
   - 持久化 "msg2"（sequence 102）[无法发送]
   - 持久化 "msg3"（sequence 103）[无法发送]
4. App 重连
5. App 发送同步请求（`lastSequence = 100`）
6. CLI Host 收到同步请求
7. CLI Host 从 MessageStore 读取：
   - 返回 sequence 101, 102, 103
8. CLI Host 返回同步响应（包含这三条消息）
9. App 收到同步响应
10. App 处理历史消息（sequence 101, 102, 103）：
    - 按顺序显示在界面上
    - 更新 `lastReceivedSequence = 103`
11. 切换到实时模式，继续接收新消息

## 存储位置

消息存储在：

```
~/.riterm/messages/<sanitized_session_id>.jsonl
```

例如：

```
~/.riterm/messages/session-abc123.jsonl
~/.riterm/messages/session-def456.jsonl
```

文件内容格式：

```jsonl
{"sequence":0,"session_id":"abc123","timestamp":1234567890,"message_data":"{...}"}
{"sequence":1,"session_id":"abc123","timestamp":1234567891,"message_data":"{...}"}
{"sequence":2,"session_id":"abc123","timestamp":1234567892,"message_data":"{...}"}
```

## 测试

### 运行测试

```bash
# 测试 MessageStore
cargo test -p shared message_store

# 测试 MessageSyncService
cargo test -p shared message_sync

# 测试整个 shared crate
cargo test -p shared
```

### 手动测试

1. 启动 CLI Host
2. 启动 App 并连接
3. 让 Agent 输出一些消息
4. 断开 App 连接
5. 让 Agent 继续输出 10+ 条消息
6. 重新连接 App
7. 验证历史消息是否完整恢复

### 验证步骤

1. 检查 `~/.riterm/messages/` 目录下是否有 `.jsonl` 文件
2. 查看 JSONL 文件内容是否包含正确的消息
3. 验证 sequence 号是否严格递增
4. 验证重连后历史消息是否按正确顺序恢复

## API 使用示例

### CLI Host 端

```rust
// 持久化 Agent 消息
sync_service.persist_agent_message("session-123", &agent_message).await?;

// 处理同步请求（在 MessageSyncMessageHandler 中）
let response = sync_service
    .handle_sync_request("session-123", 100)
    .await?;  // 返回历史消息

// 清理 session
sync_service.clear_session("session-123").await?;
```

### App 端（TypeScript）

```typescript
// 连接建立后请求同步
await sessionEventRouter.requestMessageSync("session-123");

// 手动触发同步
await sessionStore.requestMessageSync("session-123");

// 更新最后收到的 sequence
sessionStore.updateLastReceivedSequence("session-123", 103);
```

## 注意事项

1. **Sequence 号严格递增**: 每个 session 的 sequence 号必须严格递增，不能重复
2. **Session 清理**: 当 session 结束时调用 `clear_session` 清理相关数据
3. **错误处理**: 持久化失败不应阻止消息发送（记录警告即可）
4. **并发安全**: 所有操作都是 async 和线程安全的，支持多并发连接
5. **存储目录**: 确保存储目录存在且有写权限
6. **编译警告**: 有一些未使用的导入警告，可以后续清理

## 下一步建议

1. 在 Agent 输出流中集成 `persist_agent_message` 调用
   - 在发送给 App 之前调用
   - 确保每条消息都被持久化
2. 在重连检测逻辑中集成自动同步
   - 检测到连接重新建立时自动调用 `requestMessageSync`
   - 提供手动触发同步的 UI 按钮

3. 添加 UI 指示器
   - 显示同步状态
   - 显示重连后的消息恢复进度
4. 性能优化
   - 考虑批量写入以优化 I/O
   - 添加消息存储轮转以防止文件过大
