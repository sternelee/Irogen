# 移动端应用架构 - 关注点分离

本文档概述了 Tauri 移动应用的重构架构，实现了适当的关注点分离。

## 📱 **模块结构**

### 1. **命令处理器** (`src/commands/`)
- **`network.rs`**: 网络相关的 Tauri 命令
- **`session.rs`**: 会话管理命令
- **`terminal.rs`**: 终端相关命令

**职责:**
- 处理来自前端的 Tauri 命令调用
- 参数验证和错误处理
- 调用相应的业务逻辑服务

### 2. **状态管理** (`src/state/`)
- **`mod.rs`**: 应用状态管理和会话信息

**职责:**
- 管理应用全局状态
- 网络连接状态
- 活跃会话信息
- 资源清理

### 3. **错误处理** (`src/error/`)
- **`mod.rs`**: 统一的错误类型和处理

**职责:**
- 定义应用特定的错误类型
- 错误转换和序列化
- 为前端提供结构化的错误信息

### 4. **事件管理** (`src/events/`)
- **`mod.rs`**: 实时事件处理和转发

**职责:**
- 监听终端事件
- 向前端发送实时更新
- 会话状态变更通知
- 网络状态更新

### 5. **配置管理** (`src/config/`)
- **`mod.rs`**: 应用配置和设置

**职责:**
- 网络配置（超时、重试等）
- UI 配置（主题、字体等）
- 会话配置（自动重连、缓冲区大小等）

### 6. **核心模块** (现有)
- **`p2p.rs`**: P2P 网络层
- **`terminal_events.rs`**: 终端事件定义

## 🔄 **重构前后对比**

### **重构前 (`lib.rs`)**
```rust
// 所有命令处理器都在一个文件中
.invoke_handler(tauri::generate_handler![
    initialize_network,
    initialize_network_with_relay,
    connect_to_peer,
    send_terminal_input,
    send_directed_message,
    execute_remote_command,
    disconnect_session,
    get_active_sessions,
    get_node_info,
    parse_session_ticket
])
```

### **重构后 (`lib_refactored.rs`)**
```rust
// 按功能分组的命令处理器
.invoke_handler(tauri::generate_handler![
    // Network commands
    initialize_network,
    initialize_network_with_relay,
    connect_to_peer,
    get_node_info,
    
    // Session commands
    get_active_sessions,
    parse_session_ticket,
    join_session,
    disconnect_session,
    
    // Terminal commands
    send_terminal_input,
    send_directed_message,
    execute_remote_command,
])
```

## 🎯 **关键改进**

### 1. **单一职责原则**
每个模块都有明确的职责：
- 网络命令只处理网络相关操作
- 会话命令只处理会话管理
- 终端命令只处理终端交互

### 2. **统一错误处理**
```rust
// 统一的错误类型
pub enum AppError {
    NetworkNotInitialized,
    NetworkError(String),
    SessionNotFound(String),
    InvalidTicket(String),
    // ...
}

// 统一的结果类型
pub type AppResult<T> = Result<T, AppError>;
```

### 3. **状态管理**
```rust
pub struct AppState {
    pub network: Mutex<Option<P2PNetwork>>,
    pub sessions: Mutex<HashMap<String, SessionInfo>>,
}
```

### 4. **事件驱动架构**
```rust
// 实时事件转发到前端
pub async fn start_terminal_event_listener(
    &self,
    session_id: String,
    mut receiver: broadcast::Receiver<TerminalEvent>,
) {
    // 监听并转发事件到前端
}
```

## 📋 **使用示例**

### 添加新的网络命令
```rust
// 1. 在 src/commands/network.rs 中添加
#[tauri::command]
pub async fn get_network_stats(state: State<'_, AppState>) -> AppResult<NetworkStats> {
    // 实现逻辑
}

// 2. 在 lib_refactored.rs 中注册
.invoke_handler(tauri::generate_handler![
    // ... 现有命令
    get_network_stats,  // 新命令
])
```

### 添加新的错误类型
```rust
// 在 src/error/mod.rs 中添加
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
pub enum AppError {
    // ... 现有错误
    
    #[error("Custom error: {0}")]
    CustomError(String),
}
```

### 添加新的配置选项
```rust
// 在 src/config/mod.rs 中扩展
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    // ... 现有配置
    pub new_setting: bool,
}
```

## 🔧 **迁移步骤**

1. **备份现有 `lib.rs`**
2. **将 `lib_refactored.rs` 重命名为 `lib.rs`**
3. **更新 `Cargo.toml` 依赖项（如需要）**
4. **测试所有 Tauri 命令功能**
5. **更新前端代码以处理新的错误格式**

## 🚀 **未来改进**

1. **服务层**: 添加业务逻辑服务层
2. **中间件**: 实现命令中间件（日志、认证等）
3. **插件系统**: 支持功能插件扩展
4. **配置文件**: 支持外部配置文件
5. **测试**: 添加单元测试和集成测试

## 📊 **性能优化**

1. **连接池**: 实现 P2P 连接池
2. **缓存**: 添加会话和网络状态缓存
3. **批处理**: 批量处理终端事件
4. **内存管理**: 优化大型会话的内存使用

这个重构后的架构提供了更好的可维护性、可测试性和可扩展性，同时保持了所有现有功能。