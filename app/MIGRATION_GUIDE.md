# 移动端重构迁移指南

本指南帮助你从现有的单体 `lib.rs` 迁移到重构后的模块化架构。

## 🔄 **迁移步骤**

### 1. **备份现有文件**
```bash
cp src/lib.rs src/lib_backup.rs
```

### 2. **应用重构后的结构**
```bash
# 将重构后的文件重命名为主文件
mv src/lib_refactored.rs src/lib.rs
```

### 3. **更新 Cargo.toml 依赖**
确保以下依赖项存在：
```toml
[dependencies]
thiserror = "1.0"
serde_json = "1.0"
chrono = { version = "0.4", features = ["serde"] }
```

### 4. **验证功能**
测试所有 Tauri 命令是否正常工作：

#### 网络命令
- `initialize_network()`
- `initialize_network_with_relay()`
- `connect_to_peer()`
- `get_node_info()`

#### 会话命令
- `get_active_sessions()`
- `parse_session_ticket()`
- `join_session()`
- `disconnect_session()`

#### 终端命令
- `send_terminal_input()`
- `send_directed_message()`
- `execute_remote_command()`

## 📋 **主要变更**

### **错误处理**
**之前:**
```rust
-> Result<String, String>
```

**之后:**
```rust
use crate::error::AppResult;
-> AppResult<String>
```

### **状态管理**
**之前:**
```rust
#[derive(Default)]
pub struct AppState {
    sessions: RwLock<HashMap<String, TerminalSession>>,
    network: RwLock<Option<P2PNetwork>>,
}
```

**之后:**
```rust
pub struct AppState {
    pub network: Mutex<Option<P2PNetwork>>,
    pub sessions: Mutex<HashMap<String, SessionInfo>>,
}
```

### **命令组织**
**之前:** 所有命令在 `lib.rs` 中
**之后:** 按功能分组到不同模块

## 🔧 **故障排除**

### 编译错误
1. **缺少依赖**: 检查 `Cargo.toml` 中的依赖项
2. **模块路径**: 确保所有 `mod` 声明正确
3. **类型不匹配**: 检查错误类型转换

### 运行时错误
1. **命令未找到**: 确保在 `generate_handler!` 中注册了所有命令
2. **状态访问**: 检查状态管理器的初始化

### 前端集成
1. **错误格式**: 更新前端代码以处理新的错误格式
2. **事件监听**: 确保事件名称匹配

## 🧪 **测试清单**

- [ ] 网络初始化
- [ ] 会话创建和加入
- [ ] 终端输入/输出
- [ ] 错误处理
- [ ] 事件发送
- [ ] 资源清理

## 🔄 **回滚计划**

如果遇到问题，可以快速回滚：
```bash
# 恢复原始文件
cp src/lib_backup.rs src/lib.rs

# 删除新模块（如果需要）
rm -rf src/commands src/state src/error src/events src/config
```

## 📈 **性能对比**

重构后的架构应该提供：
- ✅ 更好的代码组织
- ✅ 更容易的错误调试
- ✅ 更简单的功能扩展
- ✅ 更好的测试覆盖

## 🚀 **下一步**

重构完成后，考虑以下改进：
1. 添加单元测试
2. 实现配置文件支持
3. 添加日志记录
4. 优化错误消息
5. 添加性能监控