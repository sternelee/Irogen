# CLI Iroh 消息传输优化实施计划

## 执行概要

本文档提供了 Riterm CLI 模块的具体优化步骤，专注于改进 Iroh 消息传输架构和终端管理逻辑。

## Phase 1: 消息系统重构（优先级：🔴 最高）

### 目标
统一消息类型，移除虚拟终端和真实终端的双轨制。

### 步骤

#### 1.1 定义新的消息类型 (2小时)

**文件**: `shared/src/p2p.rs`

```rust
// 新增：终端命令枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalCommand {
    /// 创建新终端
    Create {
        name: Option<String>,
        shell_path: Option<String>,
        working_dir: Option<String>,
        size: Option<(u16, u16)>,
    },
    /// 发送输入到终端
    Input {
        terminal_id: String,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    /// 调整终端大小
    Resize {
        terminal_id: String,
        rows: u16,
        cols: u16,
    },
    /// 停止终端
    Stop {
        terminal_id: String,
    },
    /// 请求终端列表
    List,
}

// 新增：终端响应枚举
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalResponse {
    /// 终端创建成功
    Created {
        terminal_id: String,
        info: TerminalInfo,
    },
    /// 终端输出
    Output {
        terminal_id: String,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    /// 终端列表
    List {
        terminals: Vec<TerminalInfo>,
    },
    /// 终端状态更新
    StatusUpdate {
        terminal_id: String,
        status: TerminalStatus,
    },
    /// 工作目录变更
    DirectoryChanged {
        terminal_id: String,
        new_dir: String,
    },
    /// 错误响应
    Error {
        terminal_id: Option<String>,
        message: String,
    },
}

// 简化后的 NetworkMessage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkMessage {
    // Session management
    SessionInfo {
        from: EndpointId,
        header: SessionHeader,
    },
    SessionEnd {
        from: EndpointId,
    },
    
    // Terminal operations
    Command {
        from: EndpointId,
        command: TerminalCommand,
        request_id: Option<String>,  // 用于请求-响应匹配
    },
    Response {
        from: EndpointId,
        response: TerminalResponse,
        request_id: Option<String>,
    },
}
```

**任务清单**:
- [ ] 添加新的枚举定义
- [ ] 添加序列化/反序列化支持
- [ ] 添加单元测试
- [ ] 更新文档注释

#### 1.2 更新事件类型 (1小时)

```rust
// 更新 EventType 以匹配新的消息系统
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventType {
    // Session events
    SessionStarted,
    SessionEnded,
    
    // Terminal events
    TerminalCreated { terminal_id: String, info: TerminalInfo },
    TerminalOutput { terminal_id: String },  // data 在 event.data 中
    TerminalStopped { terminal_id: String },
    TerminalError { terminal_id: String, error: String },
    
    // Terminal list
    TerminalList { terminals: Vec<TerminalInfo> },
}

// TerminalEvent 保持不变
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalEvent {
    pub timestamp: u64,
    pub event_type: EventType,
    pub data: Vec<u8>,  // 改为 Vec<u8> 避免 UTF-8 转换
}
```

**任务清单**:
- [ ] 更新 EventType 定义
- [ ] 修改 data 字段为 Vec<u8>
- [ ] 更新所有事件创建代码
- [ ] 测试事件序列化

#### 1.3 更新消息处理 (3小时)

**文件**: `shared/src/p2p.rs` - `handle_gossip_message`

```rust
async fn handle_gossip_message(
    &self,
    session_id: &str,
    body: NetworkMessage,
) -> Result<()> {
    let sessions_guard = self.sessions.read().await;
    let session = match sessions_guard.get(session_id) {
        Some(s) => s,
        None => {
            warn!("Session {} not found", session_id);
            return Ok(());
        }
    };
    
    match body {
        NetworkMessage::SessionInfo { from, header } => {
            info!("Session started by {}", from.fmt_short());
            self.handle_session_info(session, from, header).await?;
        }
        
        NetworkMessage::SessionEnd { from } => {
            info!("Session ended by {}", from.fmt_short());
            self.handle_session_end(session, from).await?;
        }
        
        NetworkMessage::Command { from, command, request_id } => {
            drop(sessions_guard);  // 释放锁
            self.handle_terminal_command(session_id, from, command, request_id).await?;
        }
        
        NetworkMessage::Response { from, response, request_id } => {
            drop(sessions_guard);  // 释放锁
            self.handle_terminal_response(session_id, from, response, request_id).await?;
        }
    }
    
    Ok(())
}

async fn handle_terminal_command(
    &self,
    session_id: &str,
    from: EndpointId,
    command: TerminalCommand,
    request_id: Option<String>,
) -> Result<()> {
    // 如果是主机，执行命令
    let sessions_guard = self.sessions.read().await;
    let session = sessions_guard.get(session_id).ok_or_else(|| {
        anyhow::anyhow!("Session not found")
    })?;
    
    if !session.is_host {
        return Ok(());  // 只有主机处理命令
    }
    
    // 调用终端输入回调
    let callback_guard = self.terminal_input_callback.read().await;
    if let Some(callback) = &*callback_guard {
        match command {
            TerminalCommand::Create { name, shell_path, working_dir, size } => {
                // 触发创建终端的回调
                info!("Received terminal create command from {}", from.fmt_short());
                // 回调将通过其他机制发送响应
            }
            
            TerminalCommand::Input { terminal_id, data } => {
                // 将数据转换为字符串（临时，后续应直接使用字节）
                let data_str = String::from_utf8_lossy(&data).to_string();
                let _ = callback(terminal_id.clone(), data_str);
            }
            
            TerminalCommand::List => {
                // 触发列表请求
                info!("Received terminal list request from {}", from.fmt_short());
            }
            
            _ => {
                warn!("Unhandled terminal command: {:?}", command);
            }
        }
    }
    
    Ok(())
}

async fn handle_terminal_response(
    &self,
    session_id: &str,
    _from: EndpointId,
    response: TerminalResponse,
    _request_id: Option<String>,
) -> Result<()> {
    let sessions_guard = self.sessions.read().await;
    let session = sessions_guard.get(session_id).ok_or_else(|| {
        anyhow::anyhow!("Session not found")
    })?;
    
    // 创建事件并发送给前端
    let (event_type, data) = match response {
        TerminalResponse::Created { terminal_id, info } => {
            (EventType::TerminalCreated { terminal_id, info }, Vec::new())
        }
        
        TerminalResponse::Output { terminal_id, data } => {
            (EventType::TerminalOutput { terminal_id }, data)
        }
        
        TerminalResponse::List { terminals } => {
            (EventType::TerminalList { terminals }, Vec::new())
        }
        
        TerminalResponse::StatusUpdate { terminal_id, status } => {
            // 可以添加专门的状态更新事件类型
            return Ok(());
        }
        
        TerminalResponse::Error { terminal_id, message } => {
            (EventType::TerminalError { 
                terminal_id: terminal_id.unwrap_or_default(), 
                error: message 
            }, Vec::new())
        }
        
        _ => return Ok(()),
    };
    
    let event = TerminalEvent {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs(),
        event_type,
        data,
    };
    
    let _ = session.event_sender.send(event);
    
    Ok(())
}
```

**任务清单**:
- [ ] 实现 `handle_terminal_command`
- [ ] 实现 `handle_terminal_response`
- [ ] 移除旧的消息处理代码
- [ ] 测试消息处理流程

#### 1.4 更新 CLI 集成 (2小时)

**文件**: `cli/src/cli.rs`

```rust
// 移除字符串匹配的事件处理
// ❌ 删除这部分
// if event.data.contains("[Terminal Create Request]") {
//     // ...
// }

// ✅ 使用新的命令回调
let terminal_manager_for_command = self.terminal_manager.clone();
let network_for_response = self.network.clone();
let session_id_for_command = header.session_id.clone();

let command_processor = move |command: TerminalCommand| {
    let terminal_manager = terminal_manager_for_command.clone();
    let network = network_for_response.clone();
    let session_id = session_id_for_command.clone();
    
    tokio::spawn(async move {
        match command {
            TerminalCommand::Create { name, shell_path, working_dir, size } => {
                info!("Creating terminal: name={:?}", name);
                
                match terminal_manager.create_terminal(name, shell_path, working_dir, size).await {
                    Ok(terminal_id) => {
                        let info = terminal_manager.get_terminal_info(&terminal_id).await?;
                        
                        // 发送创建成功响应
                        network.send_terminal_response(
                            &session_id,
                            TerminalResponse::Created { terminal_id, info }
                        ).await?;
                    }
                    Err(e) => {
                        error!("Failed to create terminal: {}", e);
                        network.send_terminal_response(
                            &session_id,
                            TerminalResponse::Error {
                                terminal_id: None,
                                message: e.to_string(),
                            }
                        ).await?;
                    }
                }
            }
            
            TerminalCommand::Input { terminal_id, data } => {
                if let Err(e) = terminal_manager.send_input(&terminal_id, data).await {
                    error!("Failed to send input: {}", e);
                }
            }
            
            TerminalCommand::List => {
                let terminals = terminal_manager.list_terminals().await;
                network.send_terminal_response(
                    &session_id,
                    TerminalResponse::List { terminals }
                ).await?;
            }
            
            _ => {}
        }
        
        Ok::<(), anyhow::Error>(())
    })
};

// 设置命令处理器
self.network.set_terminal_command_callback(command_processor).await;
```

**任务清单**:
- [ ] 创建命令处理器
- [ ] 移除旧的事件监听代码
- [ ] 更新回调设置
- [ ] 测试端到端流程

### 验收标准

- [ ] 所有测试通过
- [ ] 无编译警告
- [ ] 终端创建正常工作
- [ ] 终端输入输出正常
- [ ] 终端列表正常显示
- [ ] 代码覆盖率 > 80%

---

## Phase 2: 简化回调链（优先级：🟡 高）

### 目标
减少回调嵌套层次，从5层降到3层。

### 步骤

#### 2.1 TerminalManager 直接集成 P2PNetwork (2小时)

**文件**: `cli/src/terminal_manager.rs`

```rust
use riterm_shared::P2PNetwork;

#[derive(Clone)]
pub struct TerminalManager {
    terminals: Arc<RwLock<HashMap<String, TerminalSession>>>,
    network: Option<Arc<P2PNetwork>>,
    session_id: Option<String>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            network: None,
            session_id: None,
        }
    }
    
    /// 设置网络层（用于发送输出）
    pub fn with_network(mut self, network: Arc<P2PNetwork>, session_id: String) -> Self {
        self.network = Some(network);
        self.session_id = Some(session_id);
        self
    }
    
    /// 内部方法：发送终端输出到网络
    async fn send_output(&self, terminal_id: &str, data: Vec<u8>) -> Result<()> {
        if let (Some(network), Some(session_id)) = (&self.network, &self.session_id) {
            network.send_terminal_response(
                session_id,
                TerminalResponse::Output {
                    terminal_id: terminal_id.to_string(),
                    data,
                }
            ).await?;
        }
        Ok(())
    }
}
```

#### 2.2 更新 TerminalRunner (1小时)

```rust
// TerminalRunner 不再需要输出回调
// 直接通过 channel 发送事件

pub enum TerminalEvent {
    Output(Vec<u8>),
    StatusChange(TerminalStatus),
    DirectoryChange(String),
    Error(String),
}

impl TerminalRunner {
    pub async fn run(
        &mut self,
        mut cmd_receiver: mpsc::Receiver<TerminalCommand>,
        event_sender: mpsc::Sender<TerminalEvent>,
    ) -> Result<()> {
        // 读取 PTY 输出
        loop {
            tokio::select! {
                // 处理命令
                Some(cmd) = cmd_receiver.recv() => {
                    self.handle_command(cmd).await?;
                }
                
                // 读取输出
                result = self.read_output() => {
                    match result {
                        Ok(data) => {
                            event_sender.send(TerminalEvent::Output(data)).await?;
                        }
                        Err(e) => {
                            error!("Failed to read output: {}", e);
                            break;
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
}
```

#### 2.3 更新 CLI 集成 (1小时)

```rust
// cli/src/cli.rs

// 简化的设置
let terminal_manager = TerminalManager::new()
    .with_network(Arc::new(self.network.clone()), header.session_id.clone());

// 不再需要输出回调
// TerminalManager 会直接通过网络发送
```

**任务清单**:
- [ ] 更新 TerminalManager
- [ ] 更新 TerminalRunner
- [ ] 移除中间回调
- [ ] 测试数据流

### 验收标准

- [ ] 回调链从 5 层降到 3 层
- [ ] 代码更清晰易懂
- [ ] 性能无退化
- [ ] 所有功能正常

---

## Phase 3: 性能优化（优先级：🟢 中）

### 3.1 消息批处理 (4小时)

**新文件**: `shared/src/message_batch.rs`

```rust
use std::time::Duration;
use tokio::time::interval;
use crate::p2p::{NetworkMessage, TerminalResponse};

pub struct MessageBatcher {
    messages: Vec<NetworkMessage>,
    max_batch_size: usize,
    max_delay: Duration,
    sender: mpsc::Sender<Vec<NetworkMessage>>,
}

impl MessageBatcher {
    pub fn new(max_batch_size: usize, max_delay: Duration) -> (Self, mpsc::Receiver<Vec<NetworkMessage>>) {
        let (sender, receiver) = mpsc::channel(100);
        
        let batcher = Self {
            messages: Vec::with_capacity(max_batch_size),
            max_batch_size,
            max_delay,
            sender,
        };
        
        (batcher, receiver)
    }
    
    pub async fn add(&mut self, message: NetworkMessage) {
        self.messages.push(message);
        
        if self.messages.len() >= self.max_batch_size {
            self.flush().await;
        }
    }
    
    async fn flush(&mut self) {
        if self.messages.is_empty() {
            return;
        }
        
        let batch = std::mem::replace(&mut self.messages, Vec::with_capacity(self.max_batch_size));
        let _ = self.sender.send(batch).await;
    }
    
    pub async fn run(mut self) {
        let mut ticker = interval(self.max_delay);
        
        loop {
            ticker.tick().await;
            self.flush().await;
        }
    }
}
```

### 3.2 消息压缩 (3小时)

```rust
use flate2::Compression;
use flate2::write::{GzEncoder, GzDecoder};

const COMPRESSION_THRESHOLD: usize = 1024;  // 1KB

impl EncryptedTerminalMessage {
    pub fn new_maybe_compressed(body: NetworkMessage, key: &EncryptionKey) -> Result<Self> {
        let plaintext = bincode::serialize(&body)?;
        
        // 只压缩大消息
        let (data, compressed) = if plaintext.len() > COMPRESSION_THRESHOLD {
            let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
            encoder.write_all(&plaintext)?;
            let compressed_data = encoder.finish()?;
            
            // 如果压缩后更大，使用原始数据
            if compressed_data.len() < plaintext.len() {
                (compressed_data, true)
            } else {
                (plaintext, false)
            }
        } else {
            (plaintext, false)
        };
        
        // 加密（包含压缩标志）
        let mut payload = vec![if compressed { 1u8 } else { 0u8 }];
        payload.extend_from_slice(&data);
        
        let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
        let nonce_bytes: [u8; 12] = rand::random();
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, payload.as_ref())?;
        
        Ok(Self { nonce: nonce_bytes, ciphertext })
    }
    
    pub fn decrypt(&self, key: &EncryptionKey) -> Result<NetworkMessage> {
        let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
        let nonce = Nonce::from_slice(&self.nonce);
        
        let plaintext = cipher.decrypt(nonce, self.ciphertext.as_ref())?;
        
        // 检查压缩标志
        let compressed = plaintext[0] == 1;
        let data = &plaintext[1..];
        
        let decompressed = if compressed {
            let mut decoder = GzDecoder::new(Vec::new());
            decoder.write_all(data)?;
            decoder.finish()?
        } else {
            data.to_vec()
        };
        
        bincode::deserialize(&decompressed).map_err(Into::into)
    }
}
```

### 3.3 零拷贝优化 (2小时)

```rust
use bytes::Bytes;

// 使用 Bytes 替代 Vec<u8>
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalResponse {
    Output {
        terminal_id: String,
        #[serde(with = "serde_bytes")]
        data: Bytes,  // 零拷贝
    }
}

// 在 TerminalRunner 中
impl TerminalRunner {
    async fn read_output(&mut self) -> Result<Bytes> {
        let mut buf = vec![0u8; 4096];
        let n = self.pty.read(&mut buf).await?;
        buf.truncate(n);
        Ok(Bytes::from(buf))  // 转换为 Bytes
    }
}
```

**任务清单**:
- [ ] 实现消息批处理
- [ ] 实现消息压缩
- [ ] 使用 Bytes 替代 Vec
- [ ] 性能基准测试

### 验收标准

- [ ] 消息延迟 < 10ms
- [ ] CPU 使用 < 8%
- [ ] 内存使用 < 30MB
- [ ] 吞吐量 > 3000 msg/s

---

## 测试计划

### 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_terminal_command_serialization() {
        let cmd = TerminalCommand::Create {
            name: Some("test".to_string()),
            shell_path: None,
            working_dir: None,
            size: Some((24, 80)),
        };
        
        let serialized = bincode::serialize(&cmd).unwrap();
        let deserialized: TerminalCommand = bincode::deserialize(&serialized).unwrap();
        
        // 验证
        match deserialized {
            TerminalCommand::Create { name, size, .. } => {
                assert_eq!(name, Some("test".to_string()));
                assert_eq!(size, Some((24, 80)));
            }
            _ => panic!("Wrong command type"),
        }
    }
    
    #[tokio::test]
    async fn test_message_compression() {
        let large_data = vec![0u8; 10000];
        let response = TerminalResponse::Output {
            terminal_id: "test".to_string(),
            data: large_data.clone(),
        };
        
        let message = NetworkMessage::Response {
            from: EndpointId::random(),
            response,
            request_id: None,
        };
        
        let key = [0u8; 32];
        let encrypted = EncryptedTerminalMessage::new_maybe_compressed(message.clone(), &key).unwrap();
        
        // 验证压缩效果
        let original_size = bincode::serialize(&message).unwrap().len();
        let compressed_size = encrypted.ciphertext.len();
        
        assert!(compressed_size < original_size);
        
        // 验证解密
        let decrypted = encrypted.decrypt(&key).unwrap();
        // 验证数据一致
    }
}
```

### 集成测试

```rust
#[tokio::test]
async fn test_end_to_end_terminal_creation() {
    // 1. 创建网络
    let network = P2PNetwork::new(None).await.unwrap();
    
    // 2. 创建会话
    let header = SessionHeader {
        session_id: "test".to_string(),
        // ...
    };
    let (topic_id, sender, _) = network.create_shared_session(header).await.unwrap();
    
    // 3. 发送创建命令
    let command = TerminalCommand::Create {
        name: Some("test".to_string()),
        shell_path: None,
        working_dir: None,
        size: Some((24, 80)),
    };
    
    network.send_terminal_command("test", command).await.unwrap();
    
    // 4. 等待响应
    tokio::time::timeout(
        Duration::from_secs(5),
        async {
            // 接收响应
        }
    ).await.unwrap();
}
```

### 性能测试

```rust
#[tokio::test]
async fn benchmark_message_throughput() {
    let network = P2PNetwork::new(None).await.unwrap();
    
    let start = Instant::now();
    let num_messages = 10000;
    
    for i in 0..num_messages {
        let output = TerminalResponse::Output {
            terminal_id: "test".to_string(),
            data: vec![b'x'; 100],
        };
        
        network.send_terminal_response("test", output).await.unwrap();
    }
    
    let elapsed = start.elapsed();
    let throughput = num_messages as f64 / elapsed.as_secs_f64();
    
    println!("Throughput: {:.2} msg/s", throughput);
    assert!(throughput > 3000.0);
}
```

---

## 时间估算

| Phase | 任务 | 预计时间 |
|-------|------|---------|
| 1.1 | 定义消息类型 | 2h |
| 1.2 | 更新事件类型 | 1h |
| 1.3 | 更新消息处理 | 3h |
| 1.4 | CLI 集成 | 2h |
| 2.1 | 集成网络层 | 2h |
| 2.2 | 更新 Runner | 1h |
| 2.3 | 更新 CLI | 1h |
| 3.1 | 消息批处理 | 4h |
| 3.2 | 消息压缩 | 3h |
| 3.3 | 零拷贝 | 2h |
| 测试 | 单元+集成 | 4h |
| 文档 | 更新文档 | 2h |
| **总计** | | **27h** (~3.5工作日) |

---

## 风险和缓解

### 风险 1: 破坏现有功能
**概率**: 中  
**影响**: 高  
**缓解**: 
- 逐步重构，每个 Phase 独立测试
- 保留旧代码直到新代码验证通过
- 全面的测试覆盖

### 风险 2: 性能未达预期
**概率**: 低  
**影响**: 中  
**缓解**:
- 先进行性能基准测试
- 使用 profiler 识别瓶颈
- 可以回退优化

### 风险 3: 时间超期
**概率**: 中  
**影响**: 低  
**缓解**:
- 按优先级实施
- Phase 1 是必须，Phase 3 可选
- 预留缓冲时间

---

## 下一步行动

1. **审查计划** - 确认优化方向和技术方案
2. **设置环境** - 准备测试环境和工具
3. **开始 Phase 1** - 消息系统重构
4. **持续测试** - 每个改动都测试验证
5. **性能对比** - 记录前后性能数据

---

**文档版本**: 1.0  
**创建时间**: 2025-10-30  
**预计完成**: 2025-11-05  
**负责人**: 开发团队
