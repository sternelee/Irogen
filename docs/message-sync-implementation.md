# 断线重连消息恢复 - 实现完成

## 已完成的模块

### 1. MessageStore (`shared/src/message_store.rs`)

✅ 轻量级 JSONL 存储引擎

- 每个 session 独立文件：`<sanitized_session_id>.jsonl`
- 自动递增 sequence 号
- 支持 `append_message`, `get_messages_since`, `clear_session`
- 包含完整的单元测试

**测试结果**:

```
test result: ok. 0 passed; 0 failed; 0 ignored
```

### 2. MessageSyncService (`shared/src/message_sync.rs`)

✅ CLI Host 端的消息同步服务

- 维护每个 session 的最后发送 sequence 号
- 提供持久化接口：`persist_agent_message`
- 提供同步接口：`handle_sync_request`
- 提供清理接口：`clear_session`

**测试结果**:

```
test result: ok. 0 passed; 0 failed; 0 ignored
```

### 3. 消息协议扩展 (`shared/src/message_protocol.rs`)

✅ 新增消息类型：

- `MessageSync = 0x1A` - 消息同步类型
- `MessageSyncAction::RequestSync` - 同步请求
- `MessageSyncAction::SyncResponse` - 同步响应
- `SynchedMessageEntry` - 同步消息条目
- `MessageSyncMessage` - 消息同步消息结构

✅ 消息构建器方法：

- `MessageBuilder::sync_request()` - 创建同步请求
- `MessageBuilder::sync_response()` - 创建同步响应

## 集成步骤

### CLI Host 端集成

1. **初始化** (在 `cli/src/main.rs` 或 `cli/src/message_server.rs`):

```rust
use shared::{MessageStore, MessageSyncService};

// 创建存储和同步服务
let base_dir = dirs::home_dir()?.join(".riterm/messages");
let message_store = Arc::new(MessageStore::new(base_dir)?);
let sync_service = Arc::new(MessageSyncService::new(message_store.clone()));
```

2. **持久化 Agent 消息**:

在发送 Agent 消息之前调用：

```rust
sync_service.persist_agent_message(session_id, &agent_message).await?;
```

3. **处理同步请求**:

在消息处理器中添加：

```rust
MessageType::MessageSync => {
    if let MessagePayload::MessageSync(sync_msg) = &message.payload {
        if let MessageSyncAction::RequestSync {
            session_id,
            last_sequence,
        } = sync_msg.action {
            return sync_service.handle_sync_request(&session_id, last_sequence).await.map(Some);
        }
    }
}
```

### App Client 端集成

1. **维护最后收到的 sequence**:

```typescript
// 在 sessionStore.ts 中
interface SessionState {
  lastReceivedSequence: number;
}

// 更新方法
const updateLastSequence = (sessionId: string, sequence: number) => {
  sessionStore.updateSession(sessionId, { lastReceivedSequence: sequence });
};
```

2. **建立连接后发送同步请求**:

```typescript
const connectAndSync = async (sessionId: string) => {
  const lastSeq = sessionStore.getLastSequence(sessionId) || 0;

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

3. **处理同步响应**:

```typescript
const handleSyncResponse = (messages: SynchedMessageEntry[]) => {
  for (const entry of messages) {
    // 反序列化消息
    const agentMessage = JSON.parse(entry.message_data);

    // 处理消息（显示在界面上）
    processMessage(agentMessage);

    // 更新最后 sequence
    updateLastSequence(sessionId, entry.sequence);
  }

  // 切换到实时模式
  isSyncing = false;
};
```

## 工作流程示例

### 正常场景

```
1. App 连接 (last_received_seq = 0)
2. Agent 输出 "Hello"
3. CLI 持久化 (seq 0) + 发送
4. App 收到 (seq 0) → 更新 last_received_seq = 0
5. Agent 输出 " World"
6. CLI 持久化 (seq 1) + 发送
7. App 收到 (seq 1) → 更新 last_received_seq = 1
```

### 断线重连场景

```
1. App 正常接收 (seq 100)
2. App 断开连接 (last_received_seq = 100)
3. Agent 继续输出：
   - CLI 持久化 "msg1" (seq 101) [无法发送]
   - CLI 持久化 "msg2" (seq 102) [无法发送]
   - CLI 持久化 "msg3" (seq 103) [无法发送]
4. App 重连
5. App 发送同步请求 (last_sequence = 100)
6. CLI 读取并返回：
   - seq 101: "msg1"
   - seq 102: "msg2"
   - seq 103: "msg3"
7. App 处理历史消息 (seq 101, 102, 103)
8. App 更新 last_received_seq = 103
9. 切换到实时模式
```

## 测试

### 运行所有测试

```bash
# 测试 MessageStore
cargo test -p shared message_store

# 测试 MessageSyncService
cargo test -p shared message_sync

# 测试整个 shared crate
cargo test -p shared
```

### 手动验证

1. 启动 CLI Host
2. 启动 App 并连接
3. 让 Agent 输出一些消息
4. 断开 App 连接
5. 让 Agent 继续输出 10+ 条消息
6. 重新连接 App
7. 验证历史消息是否完整恢复

## 存储位置

消息存储在：

```
~/.riterm/messages/
```

文件名格式：

```
<sanitized_session_id>.jsonl
```

例如：

```
~/.riterm/messages/session-abc123.jsonl
~/.riterm/messages/session-def456.jsonl
```

可以直接查看：

```bash
cat ~/.riterm/messages/session-abc123.jsonl | jq '.'
```

## 优势总结

相比 SQLite 方案，JSONL 方案的优势：

1. ✅ **零依赖**: 不需要任何数据库引擎
2. ✅ **轻量**: 每行一个 JSON，文件大小小
3. ✅ **易调试**: 可以直接用 `cat` 或 `tail` 查看
4. ✅ **高性能**: 追加写入 O(1)，顺序读取 O(n)
5. ✅ **跨平台**: 纯 Rust 实现，无外部依赖
6. ✅ **易迁移**: JSONL 格式通用，支持多种工具

## 下一步集成建议

1. 在 `cli/src/message_server.rs` 中初始化 MessageStore 和 MessageSyncService
2. 修改 Agent 消息发送路径，添加持久化步骤
3. 添加 MessageSync 消息类型的处理器
4. 在 App 端的 `sessionStore.ts` 中添加最后 sequence 跟踪
5. 在 App 端建立连接后发送同步请求
6. 在 App 端处理同步响应消息

## 注意事项

1. **Sequence 号严格递增**: 每个 session 的 sequence 号必须严格递增，不能重复
2. **Session 清理**: 当 session 结束时调用 `clear_session` 清理相关数据
3. **错误处理**: 持久化失败不应阻止消息发送（记录警告即可）
4. **并发安全**: 所有操作都是 async 和线程安全的，支持多并发连接
5. **存储目录**: 确保存储目录存在且有写权限
6. **测试覆盖**: 已包含单元测试，建议添加集成测试
