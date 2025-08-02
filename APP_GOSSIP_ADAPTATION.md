# App 端 Iroh-Gossip 适配

## 概述

成功将 app 端适配为使用 iroh-gossip 协议，与 CLI 端保持一致的 P2P 通信架构。

## 主要变更

### 1. 依赖更新
```toml
# app/src-tauri/Cargo.toml
iroh-gossip = { workspace = true }
data-encoding = "2.6"
rand = { workspace = true }
```

### 2. P2P 网络重构

#### 消息系统
- 替换 `ShareMessage` 为 `TerminalMessage` 和 `TerminalMessageBody`
- 添加 `SessionTicket` 结构用于会话连接
- 使用与 CLI 端相同的消息格式和序列化

#### 网络架构
```rust
pub struct P2PNetwork {
    endpoint: Endpoint,
    gossip: Gossip,
    router: Router,
    sessions: RwLock<HashMap<String, SharedSession>>,
}
```

#### 核心方法
- `create_shared_session()`: 创建 gossip 主题和会话
- `join_session()`: 通过 SessionTicket 加入会话
- `send_terminal_output()`: 发送终端输出到 gossip 网络
- `send_input()`: 发送用户输入到 gossip 网络
- `start_topic_listener()`: 监听 gossip 消息

### 3. API 接口更新

#### Tauri 命令更新
- `initialize_network`: 返回单个 P2PNetwork 实例
- `connect_to_peer`: 接受 `sessionTicket` 参数而非 `nodeAddress` + `sessionId`
- `parse_session_ticket`: 替换 `parse_node_address`

#### 前端界面更新
- 简化连接表单，只需要 Session Ticket
- 更新占位符文本和标签
- 移除不必要的 Session ID 输入框

### 4. 消息处理流程

#### 发送流程
1. 用户输入 → `send_terminal_input` → `TerminalSession.event_sender`
2. 事件处理器 → `network.send_input(sender, data)`
3. Gossip 广播 → 其他节点接收

#### 接收流程
1. Gossip 接收消息 → `start_topic_listener`
2. 消息反序列化 → `TerminalMessage`
3. 事件转换 → `TerminalEvent`
4. 广播到前端 → Tauri 事件系统

### 5. 会话票据系统

#### 票据格式
```rust
pub struct SessionTicket {
    pub topic_id: TopicId,
    pub nodes: Vec<NodeAddr>,
}
```

#### 编码/解码
- Base32 编码用于用户友好的字符串格式
- JSON 序列化用于结构化数据存储
- 错误处理和验证

## 兼容性

### 与 CLI 端兼容
- ✅ 相同的消息格式 (`TerminalMessage`)
- ✅ 相同的 gossip 协议使用
- ✅ 相同的会话票据系统
- ✅ 相同的网络架构

### API 一致性
- ✅ 统一的错误处理
- ✅ 一致的日志记录
- ✅ 相同的配置选项

## 测试状态

### 编译状态
- ✅ CLI 端编译通过
- ✅ App 端编译通过
- ✅ 依赖解析正常

### 功能测试
- ⏳ 端到端连接测试
- ⏳ 消息传输测试
- ⏳ 会话管理测试

## 使用流程

### CLI 端（主机）
```bash
./target/debug/cli host --width 80 --height 24
# 输出会话票据
```

### App 端（客户端）
1. 启动 Tauri 应用
2. 粘贴 CLI 生成的会话票据
3. 点击连接
4. 开始终端会话

## 下一步

1. **端到端测试**: 验证 CLI 和 App 之间的实际通信
2. **错误处理**: 完善网络错误和重连机制
3. **性能优化**: 优化消息传输和内存使用
4. **用户体验**: 改进连接状态显示和错误提示
5. **文档完善**: 添加用户指南和故障排除

## 技术债务

- [ ] 实现真正的网络地址发现
- [ ] 添加连接状态管理
- [ ] 实现会话重连机制
- [ ] 优化消息序列化性能
- [ ] 添加网络诊断工具

这个适配确保了 app 端与 CLI 端使用相同的 iroh-gossip 协议，为完整的 P2P 终端共享功能奠定了基础。