# 断线重连消息恢复方案

## 概述

实现了基于 JSONL（JSON Lines）的轻量级消息持久化方案，用于在 App 端断线重连时恢复中断的流式消息。

## 架构设计

```
┌─────────────────┐       ┌──────────────────┐
│   CLI Host    │       │   JSONL Store   │
│               ├──────>│ (~/.riterm/messages/)│
│               │       │                  │
└─────┬─────────┘       └──────────────────┘
        │
        │ (persist before sending)
        ▼
┌─────────────────┐
│  Iroh P2P    │
│   Network      │
└─────┬─────────┘
        │
        ▼
┌─────────────────┐
│   App Client   │
│               │
│  1. Connect   │
│  2. Send sync │
│     request    │
│     (last_seq) │
│               │
└─────┬─────────┘
      ▼
  ┌─────────────────┐
  │  Sync Response │
  │  (missing msgs)│
  └─────────────────┘
```

## 核心组件

### 1. MessageStore (`shared/src/message_store.rs`)

轻量级的 JSONL 存储引擎，用于持久化消息流。

**特性**:

- 每行一个 JSON 对象（JSONL 格式）
- 为每个 session_id 维护独立的文件
- 自动分配严格递增的 sequence 号
- 支持增量读取（获取自指定 sequence 之后的消息）

**API**:

```rust
pub async fn append_message(
    &self,
    session_id: &str,
    message_data: &str,
) -> Result<u64>  // 返回分配的 sequence 号

pub async fn get_messages_since(
    &self,
    session_id: &str,
    after_sequence: u64,
) -> Result<Vec<MessageStoreEntry>>

pub async fn clear_session(&self, session_id: &str) -> Result<()>
```

**存储格式**:

```jsonl
{"sequence":0,"session_id":"xxx","timestamp":1234567890,"message_data":"{...}"}
{"sequence":1,"session_id":"xxx","timestamp":1234567891,"message_data":"{...}"}
{"sequence":2,"session_id":"xxx","timestamp":1234567892,"message_data":"{...}"}
```

### 2. MessageSyncService (`shared/src/message_sync.rs`)

CLI Host 端的消息同步服务，负责协调消息的持久化和同步。

**功能**:

- 在发送 Agent 消息前先保存到 MessageStore
- 维护每个 session 的最后发送 sequence 号
- 处理 App 端发来的同步请求，返回缺失的消息
- 提供清理接口（session 结束时）

**使用方式**:

```rust
// 创建服务
let message_store = Arc::new(MessageStore::new(base_dir)?);
let sync_service = MessageSyncService::new(message_store.clone());

// 发送 Agent 消息前持久化
sync_service.persist_agent_message(session_id, &agent_message).await?;

// 处理同步请求
let sync_response = sync_service
    .handle_sync_request(session_id, last_sequence)
    .await?;
```

### 3. 消息协议扩展 (`shared/src/message_protocol.rs`)

新增了 `MessageSync` 消息类型及相关数据结构：

**新增消息类型**:

```rust
MessageSync = 0x1A,  // 消息同步
```

**同步动作**:

```rust
pub enum MessageSyncAction {
    RequestSync {
        session_id: String,
        last_sequence: u64,
    },
    SyncResponse {
        session_id: String,
        messages: Vec<SynchedMessageEntry>,
    },
}
```

**消息构建器方法**:

```rust
MessageBuilder::sync_request(sender_id, session_id, last_sequence)
MessageBuilder::sync_response(sender_id, session_id, messages)
```

## 集成到 CLI Host

### 1. 初始化 MessageStore

在 `cli/src/main.rs` 或 `cli/src/message_server.rs` 中：

```rust
use shared::{MessageStore, MessageSyncService};

let base_dir = dirs::home_dir()?
    .join(".riterm/messages");
let message_store = Arc::new(MessageStore::new(base_dir)?);
let sync_service = Arc::new(MessageSyncService::new(message_store.clone()));
```

### 2. 持久化 Agent 消息

在发送 Agent 消息之前，先调用 `persist_agent_message`：

```rust
// 在发送给 App 端之前
if let AgentEvent::TextDelta { session_id, text } = event {
    let message = AgentMessageMessage {
        session_id: session_id.clone(),
        content: AgentMessageContent::TextDelta {
            text: text.clone(),
            thinking: false,
        },
        sequence: None,
    };

    // 先持久化
    sync_service.persist_agent_message(&session_id, &message).await?;

    // 然后发送到 App
    communication_manager.send_to_all(&serialized_message).await?;
}
```

### 3. 处理同步请求

在消息处理器中添加对 `MessageSync` 消息类型的处理：

```rust
impl MessageHandler for CliMessageServer {
    async fn handle_message(&self, message: &Message) -> Result<Option<Message>> {
        match message.message_type {
            MessageType::MessageSync => {
                if let MessagePayload::MessageSync(sync_msg) = &message.payload {
                    if let MessageSyncAction::RequestSync {
                        session_id,
                        last_sequence,
                    } = sync_msg.action {
                        // 返回缺失的消息
                        return sync_service.handle_sync_request(&session_id, last_sequence).await.map(Some);
                    }
                }
            }
            // ... 其他消息类型处理
        }
    }
}
```

## 集成到 App Client

### 1. 保存最后收到的 sequence

在 App 端维护每个 session 的最后收到的 sequence 号：

```typescript
// sessionStore.ts
interface SessionMessageState {
  sessionId: string;
  lastReceivedSequence: number;
}

export const sessionStore = createSessionStore();

// 在收到消息时更新
const handleAgentMessage = (message: AgentMessage) => {
  if (message.sequence !== undefined) {
    // 更新最后收到的 sequence 号
    sessionStore.updateLastSequence(sessionId, message.sequence);
  }

  // 处理消息内容...
};
```

### 2. 建立连接后发送同步请求

在连接建立后立即发送同步请求：

```typescript
const connectAndSync = async (sessionId: string) => {
  // 获取本地最后收到的 sequence 号
  const lastSeq = sessionStore.getLastSequence(sessionId) || 0;

  // 建立连接
  await connectToHost();

  // 发送同步请求
  const syncRequest = {
    type: "MessageSync",
    payload: {
      action: {
        RequestSync: {
          sessionId,
          lastSequence: lastSeq,
        },
      },
    },
  };

  await sendMessage(syncRequest);
};
```

### 3. 处理同步响应

接收并处理历史消息：

```typescript
const handleSyncResponse = (messages: SynchedMessageEntry[]) => {
  for (const entry of messages) {
    // 反序列化消息数据
    const agentMessage = JSON.parse(entry.message_data);

    // 处理历史消息（按顺序处理）
    processMessage(agentMessage);

    // 更新最后 sequence 号
    sessionStore.updateLastSequence(sessionId, entry.sequence);
  }

  // 切换到实时模式
  isSyncing = false;
};
```

## 工作流程

### 正常流程

```
1. App 连接到 CLI Host
2. Agent 开始输出
3. CLI Host:
   a. 持久化消息到 MessageStore（获得 seq N）
   b. 发送消息到 App
4. App 收到消息（seq N）
5. App 更新 last_received_seq = N
6. 重复步骤 3-5
```

### 断线重连流程

```
1. App 断开连接（最后收到 seq 100）
2. CLI Host 继续输出：
   - 持久化 msg seq 101, 102, 103...
   - 但无法发送到 App（连接断开）
3. App 重连：
   a. 发送同步请求（last_sequence = 100）
4. CLI Host 收到同步请求
5. CLI Host 从 MessageStore 读取：
   - 查找 seq > 100 的消息
   - 返回 [seq 101, 102, 103, ...]
6. App 收到同步响应
7. App 按顺序处理历史消息（seq 101, 102, 103...）
8. App 更新 last_received_seq = 最新 seq
9. 切换到实时模式，继续接收新消息
```

## 测试

### 运行测试

```bash
# 测试 MessageStore
cargo test -p shared message_store

# 测试 MessageSyncService
cargo test -p shared message_sync
```

### 手动测试

1. 启动 CLI Host
2. 启动 App 并连接
3. 让 Agent 输出一些内容
4. 断开 App 连接
5. 等待 Agent 继续输出
6. 重新连接 App
7. 验证消息是否完整恢复

## 优势

相比 SQLite 方案，JSONL 方案具有以下优势：

1. **轻量**: 无需数据库引擎，纯文件操作
2. **简单**: 每行一个 JSON，易于调试和手动查看
3. **高效**: 追加写入 O(1)，顺序读取 O(n)
4. **无迁移**: 不需要数据库迁移脚本
5. **易于调试**: 可以直接用 `cat ~/.riterm/messages/xxx.jsonl` 查看内容
6. **跨平台**: 纯 Rust 实现，无外部依赖

## 存储位置

消息存储在 `~/.riterm/messages/` 目录下，文件名格式为：

```
<sanitized_session_id>.jsonl
```

例如：

```
~/.riterm/messages/session-abc123.jsonl
~/.riterm/messages/session-def456.jsonl
```

## 性能考虑

1. **批量写入**: 对于高频输出，考虑使用 `BufWriter` 批量写入
2. **文件大小**: 对于长时间运行的 session，建议定期轮转或清理
3. **内存使用**: MessageStore 在内存中维护 sequence 计数器，占用很小
4. **I/O 优化**: 使用 `fs::create_dir_all` 和 `OpenOptions::append(true)` 优化文件操作

## 注意事项

1. **Sequence 号严格递增**: 每个 session 的 sequence 号必须严格递增，不能重复
2. **Session 清理**: 当 session 结束时调用 `clear_session` 清理相关数据
3. **错误处理**: 持久化失败不应阻止消息发送（记录警告即可）
4. **并发安全**: 所有操作都是 async 和线程安全的，支持多并发连接
5. **存储目录**: 确保存储目录存在且有写权限
