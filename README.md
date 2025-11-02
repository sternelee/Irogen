# RiTerm - P2P Terminal Session Sharing with TCP Forwarding

一个基于 iroh QUIC 协议的现代化 P2P 终端会话共享工具，支持实时协作、TCP 转发和统一消息架构。

## ✨ 核心功能

### 🔄 实时终端共享
- **多会话管理**：支持同时创建和管理多个终端会话
- **PTY 集成**：真实的伪终端支持，完整的功能兼容性
- **跨平台 Shell**：支持所有主流 Shell（zsh, bash, fish, powershell, cmd）
- **实时 I/O**：低延迟的终端输入输出双向传输
- **终端调整**：动态调整终端大小和配置

### 🌐 TCP 转发服务
- **端口代理**：本地服务远程访问，支持 HTTP、数据库、SSH 等
- **双向数据流**：高性能的并发连接处理和数据转发
- **连接监控**：实时统计活跃连接数、字节数传输
- **优雅关闭**：会话级别的资源管理和清理
- **多种模式**：支持 local-to-remote 和 remote-to-local 转发

### 🔐 统一消息架构
- **QUIC 协议**：基于 iroh QUIC 的高性能 P2P 通信
- **消息协议**：统一的消息格式，支持终端、TCP、系统控制
- **端到端加密**：ChaCha20Poly1305 加密保证安全性
- **事件驱动**：基于事件的消息处理和路由机制
- **类型安全**：强类型的消息定义和序列化

### 📱 多平台客户端
- **Flutter 应用**：现代化的移动端界面，Material 3 设计
- **响应式布局**：支持手机、平板等不同屏幕尺寸
- **异步 UI**：流畅的用户体验和状态管理
- **QR 码支持**：便捷的端点地址扫描和连接
- **多标签终端**：支持多个并发终端会话

### 🚀 企业级特性
- **高并发**：支持数千并发连接和高吞吐量
- **故障恢复**：完善的错误处理和自动重连机制
- **资源管理**：智能的内存和连接资源管理
- **监控统计**：详细的连接、流量和性能指标
- **配置灵活**：支持自定义配置和运行时参数

## 🚀 快速开始

### 环境要求

- **Rust** 1.70+ （CLI 后端）
- **Flutter** 3.13+ （移动端客户端）
- **Node.js** 18+ （可选，用于开发工具）

### 安装构建

#### 1. CLI 服务器

```bash
# 克隆项目
git clone https://github.com/your-username/riterm.git
cd riterm

# 编译 CLI 消息服务器
cd cli
cargo build --release

# 编译共享库
cd ../shared
cargo build --release
```

#### 2. Flutter 客户端

```bash
# 进入 Flutter 应用目录
cd app

# 安装依赖
flutter pub get

# 生成 Rust Bridge 代码
flutter_rust_bridge_codegen generate \
  --rust-input rust_lib_app \
  --dart-output lib/bridge_generated.dart

# 构建应用
flutter build apk --debug  # Android
flutter build ios --debug   # iOS
flutter build web            # Web
```

### 基本使用

#### 1. 启动 CLI 消息服务器

```bash
# 启动消息服务器（默认配置）
./cli/target/release/cli host

# 自定义绑定地址和连接数限制
./cli/target/release/cli host --bind-addr 0.0.0.0:8080 --max-connections 10

# 指定中继服务器
./cli/target/release/cli host --relay https://relay.iroh.network

# 查看帮助信息
./cli/target/release/cli
./cli/target/release/cli host --help
```

输出示例：
```
🚀 RiTerm Host Server Started
🔑 Node ID: 9b3354652aa1f52eb0c...
🎫 Connection Ticket:
┌─────────────────────────────────────────────────────────────┐
│ b6v2k4y5z7x8a9c1d3e5f7g9h2j4k6l8m0n2p4q6r8s0t2v4x6z8b0d2f4h6j8l │
└─────────────────────────────────────────────────────────────┘

📱 Flutter App Connection Instructions:
   1. Start the Flutter app
   2. Copy the connection ticket above
   3. Paste the ticket in the app and connect

✨ Your Flutter app is now ready to connect!
💡 The ticket contains all connection information needed
Press Ctrl+C to stop the server
```

#### 2. Flutter App 连接

1. **启动 Flutter App**
   ```bash
   cd app
   flutter run
   ```

2. **输入连接票据**
   - 在连接界面输入 CLI 输出的连接票据
   - 票据格式：base32编码的长字符串，包含所有连接信息
   - 票据已包含节点ID、中继URL等完整连接参数

3. **创建和管理终端**
   - 连接成功后点击 "Create Terminal" 创建新的终端会话
   - 在终端标签页中进行操作
   - 支持创建多个并发终端

#### 3. TCP 转发使用

```bash
# 在 Flutter App 中创建 TCP 转发会话
# 或通过 CLI 命令（未来版本）

# 示例：转发本地数据库服务
# Local: 127.0.0.1:5432 → Remote: 可通过客户端访问
```

#### 4. 系统控制

- **会话管理**：查看活跃会话、连接状态
- **终端管理**：创建、停止、调整终端
- **TCP 管理**：创建、监控转发会话
- **状态监控**：实时查看系统状态和统计

## 🏗️ 项目架构

### 系统架构概览

```
┌─────────────────┐    QUIC     ┌─────────────────┐    P2P     ┌─────────────────┐
│   Flutter App   │ ◄──────────► │   CLI Host      │ ◄─────────► │   Other Clients │
│   (Client)       │             │   (Server)      │             │   (Client)       │
└─────────────────┘             └─────────────────┘             └─────────────────┘
        │                               │                               │
        │                               ▼                               ▼
        │                    ┌─────────────────┐              ┌─────────────────┐
        │                    │ Message Server  │              │ Message Server  │
        │                    │ + Terminal Mgmt  │              │ + Terminal Mgmt  │
        │                    │ + TCP Forwarding │              │ + TCP Forwarding │
        │                    │ + System Control │              │ + System Control │
        │                    └─────────────────┘              └─────────────────┘
        │                               │                               │
        ▼                               ▼                               ▼
┌─────────────────┐             ┌─────────────────┐              ┌─────────────────┐
│   UI Layer      │             │  Business Logic │              │  Business Logic │
│ + Terminal UI   │             │ + PTY Management │              │ + PTY Management │
│ + TCP UI        │             │ + TCP Proxy      │              │ + TCP Proxy      │
│ + Connection UI │             │ + Message Router │              │ + Message Router │
└─────────────────┘             └─────────────────┘              └─────────────────┘
```

### 项目结构

```
riterm/
├── cli/                         # CLI 消息服务器（Rust）
│   ├── src/
│   │   ├── main.rs             # 程序入口和 CLI 参数解析
│   │   ├── message_server.rs   # 核心消息服务器实现
│   │   ├── terminal_runner.rs  # 终端会话管理
│   │   ├── shell.rs            # Shell 检测和配置
│   │   └── terminal_driver/    # 跨平台 PTY 驱动
│   └── Cargo.toml
├── shared/                      # 共享库（消息协议）
│   ├── src/
│   │   ├── lib.rs              # 库入口
│   │   ├── message_protocol.rs # 统一消息协议定义
│   │   ├── event_manager.rs    # 事件管理系统
│   │   ├── quic_server.rs      # QUIC 服务器实现
│   │   ├── quic_client.rs      # QUIC 客户端实现
│   │   ├── tcp_forwarding.rs   # TCP 转发协议
│   │   └── terminal_protocol.rs # 终端协议
│   └── Cargo.toml
├── app/                         # Flutter 跨平台应用
│   ├── lib/
│   │   ├── main.dart           # Flutter 应用入口
│   │   ├── src/
│   │   │   ├── rust/           # Rust Bridge 接口
│   │   │   │   ├── bridge_api.dart
│   │   │   │   └── frb_generated.dart
│   │   │   └── generated/     # 生成的代码
│   │   └── components/         # UI 组件
│   ├── rust/
│   │   ├── src/
│   │   │   ├── lib.rs          # Rust 桥接入口
│   │   │   └── api/
│   │   │       ├── message_bridge.rs  # 消息桥接实现
│   │   │       └── iroh_client.rs     # iroh 客户端（弃用）
│   │   └── Cargo.toml
│   ├── pubspec.yaml
│   └── flutter_rust_bridge.yaml
├── examples/                    # 使用示例和文档
├── docs/                       # 技术文档
│   ├── QUIC_ARCHITECTURE.md     # QUIC 架构设计
│   ├── TCP_FORWARDING_EXAMPLES.md # TCP 转发示例
│   └── API_REFERENCE.md        # API 参考文档
└── README.md
```

### 核心模块

#### 1. 消息协议层 (`shared/src/message_protocol.rs`)
- **统一消息格式**：支持终端、TCP、系统控制等所有消息类型
- **序列化机制**：高效的二进制序列化和反序列化
- **类型安全**：强类型的消息定义和处理
- **扩展性**：易于添加新的消息类型和功能

#### 2. QUIC 网络层 (`shared/src/quic_*.rs`)
- **QUIC 服务器**：高性能的 P2P 服务器实现
- **QUIC 客户端**：支持多种连接模式的客户端
- **连接管理**：自动重连、NAT 穿透、负载均衡
- **安全通信**：端到端加密和身份验证

#### 3. 终端管理 (`cli/src/message_server.rs`)
- **PTY 集成**：跨平台的伪终端管理
- **会话生命周期**：创建、运行、停止、清理
- **实时 I/O**：双向数据流的高效处理
- **多会话支持**：同时管理多个终端会话

#### 4. TCP 转发 (`cli/src/message_server.rs`)
- **端口代理**：高性能的 TCP 连接代理
- **并发处理**：支持数千并发连接
- **流量统计**：实时的连接和字节数统计
- **优雅关闭**：资源的正确清理和释放

## 🔄 消息协议架构

### 消息流程图

```mermaid
sequenceDiagram
    participant App as Flutter App
    participant CLI as CLI Host
    participant Terminal as Terminal Session
    participant TCP as TCP Forwarding

    App->>CLI: ConnectToCliServer(endpoint)
    CLI->>App: Session Created

    Note over App,Terminal: Terminal Operations
    App->>CLI: CreateTerminal(name, shell, cwd)
    CLI->>Terminal: Create PTY session
    Terminal->>CLI: Terminal ready
    CLI->>App: Terminal session info

    App->>CLI: SendTerminalInput(terminalId, data)
    CLI->>Terminal: Write to PTY
    Terminal->>CLI: PTY output data
    CLI->>App: TerminalOutput(terminalId, data)

    Note over App,TCP: TCP Forwarding
    App->>CLI: CreateTcpSession(localAddr, remoteTarget)
    CLI->>TCP: Start TCP listener
    TCP->>CLI: Session ready
    CLI->>App: TCP session info

    Client->>TCP: Connect to local port
    TCP->>Remote: Connect to target service
    Client<->>TCP: Data transfer
    TCP<->>Remote: Data relay
```

### 消息类型定义

```rust
// 统一消息类型
pub enum MessageType {
    Heartbeat = 0x01,
    TerminalManagement = 0x02,
    TerminalIO = 0x03,
    TcpForwarding = 0x04,
    TcpData = 0x05,
    SystemControl = 0x06,
    Response = 0x07,
    Error = 0x08,
}

// 终端管理操作
pub enum TerminalAction {
    Create { name, shell_path, working_dir, rows, cols },
    Stop { terminal_id },
    Resize { terminal_id, rows, cols },
    List,
    GetInfo { terminal_id },
}

// TCP 转发操作
pub enum TcpForwardingAction {
    CreateSession { local_addr, remote_host, remote_port, forwarding_type },
    StopSession { session_id },
    ListSessions,
    GetSessionInfo { session_id },
}
```

## 📊 功能特性

### ✅ 已实现功能

#### 核心架构
- [x] **统一消息协议**：基于 QUIC 的高效消息通信架构
- [x] **PTY 集成**：真实的伪终端支持，完整功能兼容
- [x] **线程安全设计**：Arc<Mutex<>> 包装确保并发安全
- [x] **事件驱动架构**：异步消息处理和事件分发机制

#### 终端管理
- [x] **多会话支持**：同时创建和管理多个终端会话
- [x] **跨平台 Shell**：支持 zsh, bash, fish, powershell, cmd
- [x] **实时 I/O**：低延迟的双向数据流处理
- [x] **动态调整**：运行时调整终端大小和配置
- [x] **资源管理**：正确的会话生命周期管理和清理

#### TCP 转发
- [x] **高性能代理**：支持数千并发连接的数据转发
- [x] **双向数据流**：客户端到远程服务器的实时数据传输
- [x] **连接监控**：实时统计活跃连接数和传输字节数
- [x] **优雅关闭**：会话级别的资源管理和清理
- [x] **多种模式**：支持 local-to-remote 转发

#### Flutter 客户端
- [x] **现代化 UI**：Material 3 设计风格，响应式布局
- [x] **异步状态管理**：流畅的用户体验和状态同步
- [x] **多标签终端**：支持多个并发终端会话
- [x] **QR 码连接**：便捷的端点地址扫描和连接
- [x] **Rust Bridge 集成**：类型安全的原生 API 调用

#### 企业级特性
- [x] **高并发支持**：异步运行时，支持数千连接
- [x] **错误处理**：完善的错误恢复和自动重连机制
- [x] **安全通信**：端到端加密和身份验证
- [x] **监控统计**：详细的性能指标和使用统计
- [x] **配置灵活**：支持自定义参数和运行时配置

### 🔄 架构优势

#### 相比传统方案
- **低延迟**：QUIC 协议相比 TCP 有更低的连接建立延迟
- **高性能**：基于 Rust 的零拷贝和异步 I/O 设计
- **类型安全**：编译时类型检查，减少运行时错误
- **内存安全**：Rust 的所有权系统避免内存安全问题

#### 相比旧架构（Gossip 协议）
- **更简单**：统一的消息协议，避免复杂的协议转换
- **更高效**：直接的数据传输，减少中间层开销
- **更可靠**：基于连接的通信，比 gossip 更可靠
- **更灵活**：易于扩展新功能，模块化设计

### 🎯 下一步计划

#### 短期目标
- [x] **Flutter 桥接修复**：修复 Rust 编译错误，更新桥接代码生成
- [x] **CLI 简化**：简化 CLI 命令结构，只保留 host 和 help 命令
- [x] **Ticket 连接**：实现基于 ticket 的连接机制，替换复杂地址格式
- [ ] **TCP 转发 UI**：在 Flutter App 中添加 TCP 转发界面
- [ ] **配置文件**：支持 TOML/YAML 配置文件
- [ ] **日志系统**：完善的日志记录和监控

#### 中期目标
- [ ] **Web 客户端**：基于 React 的 Web 版客户端
- [ ] **桌面客户端**：Tauri 原生桌面应用
- [ ] **性能优化**：进一步优化内存使用和性能
- [ ] **权限管理**：用户权限和访问控制

#### 长期目标
- [ ] **插件系统**：支持第三方插件扩展
- [ ] **集群部署**：支持多节点集群部署
- [ ] **企业集成**：LDAP/AD 集成，企业级功能
- [ ] **AI 助手**：集成 AI 辅助功能

## 🧪 测试

### 运行测试

```bash
# 编译和运行单元测试
cd shared && cargo test
cd ../cli && cargo test

# 集成测试
./test_integration.sh

# 性能基准测试
./benchmark_message_protocol.sh
./benchmark_tcp_forwarding.sh
```

### 测试覆盖

- ✅ **消息协议测试**：序列化/反序列化，消息路由
- ✅ **QUIC 连接测试**：P2P 连接建立，NAT 穿透
- ✅ **终端管理测试**：PTY 创建，I/O 处理，会话管理
- ✅ **TCP 转发测试**：端口代理，并发连接，数据传输
- ✅ **错误处理测试**：网络异常，资源清理，恢复机制
- ✅ **并发安全测试**：多线程访问，资源竞争，死锁检测

### 测试架构

```bash
# 端到端测试流程
1. 启动 CLI 消息服务器
2. 连接 Flutter 客户端
3. 创建终端会话
4. 测试终端 I/O 操作
5. 创建 TCP 转发会话
6. 验证数据转发功能
7. 测试连接断开和重连
8. 验证资源清理
```

## 📖 使用示例

### 1. 基础终端操作

```dart
// Flutter App 中使用消息客户端
final client = createMessageClient();

// 连接到 CLI 服务器
final sessionId = await connectToCliServer(
  client,
  "127.0.0.1:8080",
  null // 使用默认中继
);

// 创建终端会话
final terminalId = await createRemoteTerminal(
  client,
  sessionId,
  "Development Terminal",
  "/bin/bash",
  "/home/user/project",
  24, // rows
  80, // cols
);

// 发送终端输入
await sendTerminalInput(
  client,
  sessionId,
  terminalId,
  "ls -la\n",
);

// 调整终端大小
await resizeRemoteTerminal(
  client,
  sessionId,
  terminalId,
  30, // new rows
  100, // new cols
);
```

### 2. TCP 转发示例

```dart
// 创建 TCP 转发会话（转发本地数据库）
final tcpSessionId = await createTcpForwardingSession(
  client,
  "127.0.0.1:5432",     // 本地监听地址
  "database.example.com", // 远程目标主机
  5432,                   // 远程目标端口
  TcpForwardingType.LocalToRemote,
);

// 获取转发会话信息
final sessionInfo = await getTcpForwardingSessionInfo(
  client,
  tcpSessionId,
);

print("TCP 转发会话:");
print("- 本地地址: ${sessionInfo.localAddr}");
print("- 远程目标: ${sessionInfo.remoteTarget}");
print("- 活跃连接: ${sessionInfo.activeConnections}");
print("- 发送字节: ${sessionInfo.bytesSent}");
print("- 接收字节: ${sessionInfo.bytesReceived}");
```

### 3. 系统监控

```dart
// 获取系统状态
final systemStatus = await getSystemStatus(client);

print("系统状态:");
print("- 运行时间: ${systemStatus.uptime}ms");
print("- 终端会话数: ${systemStatus.activeTerminalSessions}");
print("- TCP 转发会话数: ${systemStatus.activeTcpSessions}");
print("- 内存使用: ${systemStatus.memoryUsage} bytes");
```

### 4. 错误处理

```dart
try {
  final terminalId = await createRemoteTerminal(
    client,
    sessionId,
    "Test Terminal",
    "/bin/bash",
    "/tmp",
    24,
    80,
  );
  print("终端创建成功: $terminalId");
} on FlutterMessageError catch (e) {
  print("创建终端失败: ${e.message}");
  print("错误代码: ${e.code}");
  if (e.details != null) {
    print("详细信息: ${e.details}");
  }
}
```

### 5. 完整的工作流程

```dart
// 完整的 RiTerm 使用流程
class RitermClient {
  late FlutterMessageClient _client;
  String? _sessionId;

  Future<void> initialize() async {
    _client = createMessageClient();
  }

  Future<void> connect(String endpoint) async {
    _sessionId = await connectToCliServer(_client, endpoint, null);
    print("连接成功，会话 ID: $_sessionId");
  }

  Future<String> createTerminal() async {
    if (_sessionId == null) throw StateError("未连接到服务器");

    final terminalId = await createRemoteTerminal(
      _client!,
      _sessionId!,
      "Workspace Terminal",
      Platform.isWindows ? "cmd.exe" : "/bin/bash",
      Platform.environment['HOME'] ?? "/tmp",
      24,
      80,
    );

    print("终端创建成功: $terminalId");
    return terminalId;
  }

  Future<void> sendCommand(String terminalId, String command) async {
    await sendTerminalInput(_client!, _sessionId!, terminalId, "$command\n");
  }

  Future<void> disconnect() async {
    if (_sessionId != null) {
      await disconnectFromCliServer(_client!, _sessionId!);
      _sessionId = null;
    }
  }
}
```

详细的技术文档请参考：
- [QUIC 架构设计](docs/QUIC_ARCHITECTURE.md)
- [TCP 转发示例](docs/TCP_FORWARDING_EXAMPLES.md)
- [API 参考文档](docs/API_REFERENCE.md)

## 🤝 贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 确保所有测试通过 (`cargo test && flutter test`)
5. 推送到分支 (`git push origin feature/amazing-feature`)
6. 创建 Pull Request

### 开发指南

- 遵循 Rust 代码规范和 Flutter/Dart 代码规范
- 为新功能添加相应的测试用例
- 更新相关文档
- 确保向后兼容性

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

### 核心技术栈
- [iroh](https://github.com/n0-computer/iroh) - 强大的 P2P 网络库和 QUIC 实现
- [tokio](https://tokio.rs/) - 异步运行时和生态系统
- [flutter_rust_bridge](https://github.com/fzyzcjy/flutter_rust_bridge) - Flutter Rust 桥接
- [portable-pty](https://github.com/wez/wezterm/tree/master/crates/portable-pty) - 跨平台 PTY 支持

### 开发工具
- [Flutter](https://flutter.dev/) - 跨平台 UI 框架
- [serde](https://serde.rs/) - 序列化和反序列化框架
- [tracing](https://github.com/tokio-rs/tracing) - 结构化日志记录
- [anyhow](https://github.com/dtolnay/anyhow) - 错误处理

### 灵感来源
- [tmux](https://github.com/tmux/tmux) - 终端复用器的设计理念
- [ngrok](https://ngrok.com/) - 隧道和内网穿透的概念
- [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) - 实时通信协议

## 📞 联系

- **项目主页**：https://github.com/your-username/riterm
- **问题反馈**：https://github.com/your-username/riterm/issues
- **讨论区**：https://github.com/your-username/riterm/discussions
- **技术文档**：https://docs.riterm.dev

## 🌟 Star History

如果这个项目对你有帮助，请给它一个 ⭐️！

[![Star History Chart](https://api.star-history.com/svg?repos=your-username/riterm&type=Date)](https://star-history.com/#your-username/riterm&Date)

---

**RiTerm** - 现代化的 P2P 终端会话共享和 TCP 转发平台 🚀

让远程开发变得简单、高效、安全！
