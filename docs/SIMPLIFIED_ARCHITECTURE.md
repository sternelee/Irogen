# riterm 简化架构文档

## 📋 **架构重构概述**

riterm 已从复杂的 P2P 消息路由系统重构为基于 **dumbpipe 模式**的简化架构。

## 🎯 **核心理念**

### 原有架构问题
- **过度工程化**: 复杂的消息路由、多层抽象
- **状态管理混乱**: CLI 和 App 使用不同的会话概念
- **连接生命周期模糊**: 缺乏清晰的连接管理
- **协议复杂**: 结构化消息系统难以调试和扩展

### 新架构原则
- **简单直接**: 基于 dumbpipe 的连接模式
- **统一协议**: 文本格式的指令-响应协议
- **清晰角色**: CLI = 主机, App = 客户端
- **可维护性**: 最少抽象，易于理解和扩展

## 🏗️ **新架构组件**

### 1. **简化的应用层协议** (`shared/src/simple_protocol.rs`)

```
[COMMAND_TYPE]JSON_DATA
```

**协议特点**:
- **文本格式**: 易于调试和人工阅读
- **JSON数据**: 灵活的数据序列化
- **向后兼容**: 支持版本化扩展
- **类型安全**: Rust 的强类型系统

**支持的核心指令**:
- `[TERMINAL_CREATE]` - 创建终端
- `[TERMINAL_INPUT]` - 发送输入
- `[TERMINAL_RESIZE]` - 调整终端大小
- `[TERMINAL_STOP]` - 停止终端
- `[FILE_UPLOAD]` - 文件上传
- `[PORT_FORWARD_CREATE]` - 端口转发
- `[PING]` / `[PONG]` - 连接健康检查
- `[ERROR]` - 错误响应

### 2. **简化的 CLI 主机** (`cli/src/simple_host.rs`)

基于标准 dumbpipe 模式的主机实现：

```rust
pub struct SimpleHost {
    endpoint: Endpoint,
    terminal_manager: Arc<Mutex<TerminalManager>>,
    connections: Arc<RwLock<HashMap<String, ClientConnection>>>,
}

// 标准连接流程
1. endpoint.connect(node_addr, alpn)  // 连接到客户端
2. connection.open_bi()              // 建立双向流
3. 握手: "RITERM_HELLO"        // 简单握手验证
4. 协议消息处理                   // 指令-响应模式
```

**关键改进**:
- **直接连接**: 无复杂消息路由
- **简单握手**: 固定握手协议
- **连接管理**: 基于 ID 的清晰连接生命周期
- **指令处理**: 直接的指令解析和响应

### 3. **简化的 App 客户端** (`app/src/simple_client_minimal.rs`)

纯客户端实现，专注于指令发送和响应接收：

```rust
pub struct SimpleClientMinimal {
    endpoint: Option<Endpoint>,
    connection: Option<ConnectionInfo>,
}

// 核心方法
- connect_to_host(ticket)        // 连接到远程主机
- create_terminal(name)         // 创建终端
- send_input(id, data)        // 发送终端输入
- send_ping()                  // 发送心跳
- start_response_listener()     // 启动响应监听
```

**关键特性**:
- **轻量级**: 最小依赖和状态
- **易使用**: 简单的 API 设计
- **回调驱动**: 灵活的响应处理机制

## 🔄 **使用方式**

### CLI 端 (主机模式)
```bash
# 启动简化主机
./target/debug/cli --simple

# 输出票据给客户端使用
🎫 Session Ticket: abc123def456...
📡 Node ID: rg1x2h7y9k8m9p3q0l4n5r6x...
```

### App 端 (客户端模式)
```rust
use riterm_shared::simple_protocol::*;

let mut client = SimpleClientMinimal::new();
client.initialize(None).await?;

// 连接到主机
let ticket = NodeTicket::from_str("abc123def456...").unwrap();
let connection_id = client.connect_to_host(ticket).await?;

// 创建终端
client.create_terminal(Some("My Terminal")).await?;

// 发送输入
client.send_input("ls -la\n".to_string()).await?;

// 发送心跳
client.send_ping().await?;
```

## 🧪 **协议示例**

### 创建终端
**发送**:
```
[TERMINAL_CREATE]{"name":"terminal1","shell":"/bin/bash","rows":24,"cols":80}
```

**响应**:
```
[TERMINAL_STATUS]{"id":"terminal1","status":"created","timestamp":1703123456}
```

### 终端输入
**发送**:
```
[TERMINAL_INPUT]{"id":"terminal1","data":"echo 'Hello World!'\n"}
```

### 文件上传
**发送**:
```
[FILE_UPLOAD]{"path":"/tmp/hello.txt","data":"SGVsbG8gdGVzdCBv","size":13}
```

**响应**:
```
[FILE_STATUS]{"path":"/tmp/hello.txt","action":"upload","size":13,"transferred":13}
```

### 端口转发
**发送**:
```
[PORT_FORWARD_CREATE]{"local_port":3000,"remote_port":8080,"service_name":"web-service","service_type":"tcp"}
```

## 📊 **性能优势**

### 连接性能
- **更低延迟**: 移除消息路由中间层
- **更少内存**: 简化的连接管理
- **更好并发**: 直接的指令-响应模式

### 开发效率
- **易于调试**: 文本协议易于人工检查
- **快速测试**: 简单的测试和验证
- **错误定位**: 清晰的错误传播机制

### 运维友好
- **日志简化**: 清晰的连接和指令日志
- **状态透明**: 可预测的连接状态管理
- **配置简单**: 最少的配置选项

## 🔒 **安全考虑**

### 连接安全
- **握手验证**: 固定的握手协议防止未授权连接
- **消息验证**: JSON 数据格式验证防止注入攻击
- **权限控制**: 可扩展的指令权限系统

### 数据安全
- **敏感信息过滤**: 日志中过滤敏感的终端输出
- **传输加密**: 基于 iroh 的端到端加密
- **文件路径验证**: 上传文件的路径限制和验证

## 🧪 **迁移指南**

### 从旧架构迁移
1. **使用 `--simple` 模式** 体验新架构
2. **保持向后兼容** 旧模式仍可使用
3. **逐步迁移**: 新功能优先在简化架构中实现
4. **文档更新**: 更新相关文档和示例

### 新功能开发
1. **基于简化协议**: 使用新的指令-响应格式
2. **直接连接**: 避免复杂消息路由系统
3. **统一状态管理**: 使用一致的连接状态模型
4. **优先测试**: 集成测试是开发的一部分

## 📚 **组件对比**

| 组件 | 旧架构 | 新架构 | 改进 |
|--------|--------|--------|------|
| **连接建立** | 复杂的多步连接 | 标准dumbpipe连接 | 简化直接 |
| **消息格式** | 二进制结构化消息 | 文本+JSON | 易调试 |
| **状态管理** | 多层会话概念 | 统一连接ID | 清晰一致 |
| **错误处理** | 分散的错误传播 | 统一错误处理 | 可靠 |
| **扩展性** | 困难添加新指令 | 简单的协议扩展 | 容易 |

## 🚀 **总结**

新的简化架构成功将 riterm 从一个过度工程化的复杂系统转变为：

- **dumbpipe 模式**: 直接、简单、可靠的 P2P 连接
- **协议简化**: 易于理解、调试和扩展的文本协议
- **性能提升**: 更低延迟、更少内存占用
- **维护友好**: 代码清晰、文档完整、测试覆盖

这个重构使 riterm 真正实现了 "dumbpipe for terminals" 的设计理念，同时保持了完整的功能性。