# 终端输入输出同步实现（基于 sshx 方案）

## 当前进展

### ✅ 已完成

1. **终端输入处理** - 完全工作
   - 前端通过 `invoke("send_terminal_input_to_terminal")` 发送输入
   - Tauri 后端接收并通过 QUIC 发送到 CLI
   - CLI 通过输入通道（channel）传递到 I/O 循环
   - I/O 循环写入 PTY writer
   - Shell 接收并处理输入

2. **终端输出读取** - 部分工作
   - I/O 循环从 PTY reader 读取输出
   - 输出被记录到日志
   - ⚠️ 输出尚未广播到客户端

3. **统一 I/O 循环** - 基于 sshx 方案
   - 单个线程同时处理输入和输出
   - 使用 channel 解耦输入处理
   - 非阻塞轮询机制

## 实现方案（参考 sshx）

### sshx 的关键设计

```rust
// sshx 使用 tokio::select! 同时处理输入输出
loop {
    tokio::select! {
        Some(bytes) = rx.recv() => {
            // 处理输入
            terminal.write_all(&bytes).await?;
        }
        result = terminal.read(&mut buf) => {
            // 处理输出
            io::stdout().write_all(&buf[..n]).await?;
        }
    }
}
```

### 我们的实现

```rust
// cli/src/message_server.rs: create_terminal()
thread::spawn(move || {
    let mut reader = reader;
    let mut writer = writer;
    let mut read_buffer = [0u8; 8192];
    
    loop {
        // 1. 处理输入（非阻塞）
        if let Ok(input_data) = input_rx.try_recv() {
            writer.write_all(&input_data)?;
            writer.flush()?;
        }
        
        // 2. 处理输出
        match reader.read(&mut read_buffer) {
            Ok(n) => {
                let data = read_buffer[..n].to_vec();
                // 记录输出
                info!("Terminal output: {} bytes", n);
                
                // TODO: 广播到客户端
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            ...
        }
    }
});
```

## 数据流图

### 输入流（✅ 工作中）

```
用户按键
  ↓
xterm.onData()
  ↓
invoke("send_terminal_input_to_terminal")
  ↓
Tauri: TerminalInputRequest
  ↓
QuicClient.send_message_to_server()
  ↓
QUIC Stream (iroh)
  ↓
QuicServer.handle_message_stream()
  ↓
TerminalIOHandler.handle_message()
  ↓
TerminalIOHandler.handle_terminal_input()
  ↓
input_tx.send(data) ✅
  ↓
I/O Loop: input_rx.try_recv() ✅
  ↓
writer.write_all() ✅
  ↓
PTY Master → PTY Slave
  ↓
Shell 接收输入 ✅
```

### 输出流（⚠️ 部分工作）

```
Shell 输出
  ↓
PTY Slave → PTY Master
  ↓
I/O Loop: reader.read() ✅
  ↓
记录日志 ✅
  ↓
❌ 广播到客户端（TODO）
  ↓
QUIC Stream (iroh)
  ↓
QuicClient 接收
  ↓
Tauri emit("terminal-output")
  ↓
前端: listen("terminal-output")
  ↓
xterm.write(data)
```

## 🚧 下一步：实现输出广播

### 问题

当前输出只被读取和记录，但没有发送给客户端。

### 可能的解决方案

#### 方案 1：维护连接列表（推荐）

在 `MessageServer` 中维护活动连接：

```rust
pub struct MessageServer {
    // ... 现有字段
    connections: Arc<RwLock<HashMap<String, ConnectionHandle>>>,
}

struct ConnectionHandle {
    connection_id: String,
    sender: mpsc::Sender<Message>,
}

// 在 I/O 循环中
let connections = message_server.connections.clone();
// 广播输出消息
for conn in connections.read().await.values() {
    conn.sender.send(output_msg).await?;
}
```

#### 方案 2：使用 tokio broadcast channel

```rust
// 在 MessageServer 中
let (broadcast_tx, _) = tokio::sync::broadcast::channel(100);

// 每个连接订阅
let mut rx = broadcast_tx.subscribe();

// I/O 循环中
broadcast_tx.send(output_msg)?;
```

#### 方案 3：通过 QUIC Server 直接发送

```rust
// 需要 QUIC Server 提供广播接口
quic_server.broadcast_to_all_connections(output_msg).await?;
```

### 推荐实现步骤

1. **在 `MessageServer` 添加连接管理**
   ```rust
   connections: Arc<RwLock<HashMap<String, Arc<Mutex<SendStream>>>>>,
   ```

2. **在连接建立时注册**
   ```rust
   pub async fn register_connection(&self, conn_id: String, send_stream: SendStream) {
       let mut conns = self.connections.write().await;
       conns.insert(conn_id, Arc::new(Mutex::new(send_stream)));
   }
   ```

3. **在 I/O 循环中广播**
   ```rust
   // 获取连接列表的 Arc clone
   let connections = message_server.connections.clone();
   
   // 在输出处理部分
   let output_msg = MessageBuilder::terminal_io(...);
   let serialized = MessageSerializer::serialize_for_network(&output_msg)?;
   
   for (conn_id, stream) in connections.read().await.iter() {
       if let Err(e) = stream.lock().await.write_all(&serialized).await {
           error!("Failed to send output to {}: {}", conn_id, e);
       }
   }
   ```

## 测试验证

### 当前可以测试

1. **终端输入**
   ```bash
   # CLI 日志应该显示：
   INFO Handling terminal input for xxx: 1 bytes
   INFO ✅ Terminal input queued successfully
   INFO Terminal input processed successfully
   ```

2. **终端输出读取**
   ```bash
   # 在终端中输入命令后，CLI 日志应该显示：
   INFO 📤 Terminal xxx output: N bytes
   DEBUG Output content: "..."
   ```

### 完成输出广播后可以测试

1. **完整的终端交互**
   ```bash
   # 在 Tauri 应用的终端中输入：
   $ ls
   # 应该看到文件列表显示在终端中
   
   $ echo "hello world"
   hello world
   
   $ pwd
   /Users/xxx/...
   ```

2. **实时输出**
   ```bash
   # 运行长时间命令
   $ ping google.com
   # 应该看到实时的 ping 输出
   ```

## 性能优化建议

基于 sshx 的经验：

1. **批处理输出**
   - 不要每次read都发送，可以积累到一定大小或时间后再发送
   - 减少网络往返次数

2. **使用异步 I/O**
   - 当前使用同步 + 轮询，性能不是最优
   - 可以考虑使用 tokio 的异步文件 I/O

3. **输出压缩**
   - 对于大量输出，可以使用 gzip 压缩
   - 特别是重复内容多的场景

## 修改的文件

1. `cli/src/message_server.rs`:
   - `InternalTerminalSession` - 添加 `input_tx` 字段
   - `InternalTerminalSession::new()` - 接受 input_tx 参数
   - `TerminalMessageHandler::new()` - 添加 communication_manager 参数
   - `create_terminal()` - 实现统一 I/O 循环
   - `handle_terminal_input()` - 使用 channel 发送输入

2. `src/components/RemoteSessionView.tsx`:
   - 修复 `invoke` 调用的参数格式一致性

## 学习要点

1. ✅ **Channel 解耦** - 使用 mpsc channel 解耦输入处理和 I/O 操作
2. ✅ **统一 I/O 循环** - 单个线程处理输入输出，避免竞争
3. ✅ **非阻塞轮询** - 使用 try_recv 和 read with timeout
4. ⚠️ **消息广播** - 需要实现连接管理和广播机制
5. 📝 **参考优秀项目** - sshx 的设计简洁高效，值得学习

## 相关文档

- `PTY_INPUT_IMPLEMENTATION.md` - PTY 输入实现细节
- `TERMINAL_INPUT_RESPONSE_FIX.md` - 终端输入响应修复
- `sshx.xml` - sshx 项目源码参考
