# PTY 输入实现修复

## 问题描述

调用 `send_terminal_input_to_terminal` 后，CLI 端没有响应，终端无法输入。

## 根本原因

在 `TerminalIOHandler::handle_terminal_input` 中，代码注释说 `TODO: 实现真正的 PTY 输入`，实际上**没有实现将输入写入 PTY**：

```rust
// 旧代码 - 只是记录日志
tokio::task::spawn_blocking(move || {
    // TODO: 实现真正的 PTY 输入
    debug!("PTY input not yet implemented for terminal {}", terminal_id);
    
    // 暂时只记录输入内容
    if let Ok(input_str) = String::from_utf8(data.clone()) {
        debug!("Input content: {:?}", input_str);
    }
});
```

## 解决方案

### 1. 分离 PTY Writer

`MasterPty` trait 提供 `take_writer()` 方法获取独占的 writer，但这个方法只能调用一次。

修改 `InternalTerminalSession` 结构，添加 `writer` 字段：

```rust
pub struct InternalTerminalSession {
    pub session: TerminalSession,
    pub master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>,
    pub writer: Option<Arc<Mutex<Box<dyn std::io::Write + Send>>>>, // ← 新增
    pub output_tx: Option<mpsc::UnboundedSender<String>>,
}
```

### 2. 在创建终端时取出 Writer

```rust
impl InternalTerminalSession {
    fn new(
        master: Option<Box<dyn MasterPty + Send>>,
        output_tx: Option<mpsc::UnboundedSender<String>>,
    ) -> Self {
        // 从 master 中分离 writer
        let (master_arc, writer_arc) = if let Some(m) = master {
            // 取出 writer（只能取一次）
            let writer = m.take_writer().ok();
            (
                Some(Arc::new(Mutex::new(m))),
                writer.map(|w| Arc::new(Mutex::new(w))),
            )
        } else {
            (None, None)
        };

        Self {
            session: TerminalSession::default(),
            master: master_arc,
            writer: writer_arc, // ← 保存 writer
            output_tx,
        }
    }
}
```

### 3. 实现真正的 PTY 写入

```rust
async fn handle_terminal_input(&self, terminal_id: &str, data: Vec<u8>) -> Result<()> {
    let terminal_id = terminal_id.to_string();
    debug!("Handling terminal input for {}: {} bytes", terminal_id, data.len());

    // 获取 writer
    let writer_clone = {
        let sessions = self.terminal_sessions.read().await;
        if let Some(terminal_session) = sessions.get(&terminal_id) {
            terminal_session.writer.clone()
        } else {
            return Err(anyhow::anyhow!("Terminal session not found: {}", terminal_id));
        }
    };

    if let Some(writer_arc) = writer_clone {
        let terminal_id_clone = terminal_id.clone();
        let result = tokio::task::spawn_blocking(move || -> Result<()> {
            use std::io::Write;
            let mut writer = writer_arc.lock().unwrap();
            
            // 写入数据到 PTY
            writer.write_all(&data).map_err(|e| {
                anyhow::anyhow!("Failed to write to PTY: {}", e)
            })?;
            
            // 刷新确保数据立即发送
            writer.flush().map_err(|e| {
                anyhow::anyhow!("Failed to flush PTY: {}", e)
            })?;
            
            debug!("Successfully wrote {} bytes to terminal {}", data.len(), terminal_id_clone);
            Ok(())
        })
        .await;

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(e),
            Err(e) => Err(anyhow::anyhow!("Task join error: {}", e)),
        }
    } else {
        Err(anyhow::anyhow!("Terminal writer not found"))
    }
}
```

## Portable PTY API

### MasterPty Trait

```rust
pub trait MasterPty: Downcast + Send {
    fn resize(&self, size: PtySize) -> Result<(), Error>;
    fn get_size(&self) -> Result<PtySize, Error>;
    
    // 获取可读句柄 - 用于读取终端输出
    fn try_clone_reader(&self) -> Result<Box<dyn std::io::Read + Send>, Error>;
    
    // 获取可写句柄 - 用于写入终端输入
    // ⚠️ 只能调用一次！
    fn take_writer(&self) -> Result<Box<dyn std::io::Write + Send>, Error>;
    
    // ... 其他方法
}
```

### 关键点

1. **`take_writer()` 只能调用一次**
   - 返回独占的 writer
   - 第二次调用会失败
   - 所以需要在创建时取出并保存

2. **Writer 实现了 `std::io::Write`**
   - `write_all(&[u8])` - 写入所有数据
   - `flush()` - 刷新缓冲区
   - 线程安全（需要 `Mutex`）

3. **阻塞操作**
   - I/O 操作是阻塞的
   - 需要使用 `tokio::task::spawn_blocking`

## 数据流

### 输入流（前端 → PTY）

```
用户按键
  ↓
xterm.onData()
  ↓
invoke("send_terminal_input_to_terminal")
  ↓
Tauri: send_terminal_input_to_terminal
  ↓
QuicClient: send_message_to_server (TerminalIO::Input)
  ↓
QuicServer: handle_message_stream
  ↓
TerminalIOHandler: handle_terminal_input
  ↓
writer.write_all(data) ✅
  ↓
PTY Master
  ↓
PTY Slave (Shell 进程)
  ↓
Shell 处理输入
```

### 输出流（PTY → 前端）

```
Shell 输出
  ↓
PTY Slave
  ↓
PTY Master
  ↓
reader.read() (TODO: 需要实现)
  ↓
QuicServer: 发送 TerminalIO::Output
  ↓
QuicClient: 接收消息
  ↓
Tauri: emit("terminal-output")
  ↓
前端: xterm.write(data) ✅
```

## 测试

重启 CLI 服务器后：

### 1. 检查 CLI 日志

输入字符时应该看到：

```
DEBUG cli::message_server: Handling terminal input for xxx: 1 bytes
DEBUG cli::message_server: Successfully wrote 1 bytes to terminal xxx
```

### 2. 检查终端回显

在终端中输入字符，shell 会回显：
- 输入 'l' → 看到 'l'
- 输入 's' → 看到 's'
- 输入 Enter → 执行命令

### 3. 执行命令

```bash
$ ls
# 应该看到文件列表
```

## 修改的文件

1. `cli/src/message_server.rs`:
   - `InternalTerminalSession` - 添加 `writer` 字段
   - `InternalTerminalSession::new()` - 分离 writer
   - `TerminalIOHandler::handle_terminal_input()` - 实现真正的写入

## 下一步：实现输出读取

当前输出读取也是 TODO：

```rust
// 第 371-378 行
thread::spawn(move || {
    // TODO: 实现真正的 PTY 输出读取
    info!("Terminal output reader thread started for: {}", terminal_id_clone);
});
```

需要实现：
1. 使用 `master.try_clone_reader()` 获取 reader
2. 循环读取输出
3. 通过 QUIC 发送给客户端

示例代码：

```rust
let reader = master.try_clone_reader()?;
let communication_manager_clone = self.communication_manager.clone();
let terminal_id_clone = terminal_id.clone();

thread::spawn(move || {
    use std::io::Read;
    let mut reader = reader;
    let mut buffer = [0u8; 8192];
    
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break, // EOF
            Ok(n) => {
                // 发送输出到客户端
                let output_msg = MessageBuilder::terminal_io(
                    "cli_server".to_string(),
                    terminal_id_clone.clone(),
                    IODataType::Output,
                    buffer[..n].to_vec(),
                );
                
                // TODO: 通过 communication_manager 广播
            }
            Err(e) => {
                error!("Failed to read from PTY: {}", e);
                break;
            }
        }
    }
});
```

## 学习要点

1. ✅ PTY 的 writer 只能取一次，需要妥善保存
2. ✅ 使用 `Arc<Mutex<>>` 实现跨线程共享
3. ✅ I/O 操作是阻塞的，需要 `spawn_blocking`
4. ✅ 及时 `flush()` 确保数据发送
5. ✅ 完整实现需要同时处理输入和输出
