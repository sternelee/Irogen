# RiTerm 项目架构与技术方案分析

## 📋 项目概述

**RiTerm** 是一个基于 P2P 网络的终端会话共享工具，支持实时协作和历史记录自动同步。项目采用现代化的技术栈，实现了跨平台的终端共享功能。

### 核心价值
- 🔄 多人实时共享同一终端会话
- 📜 智能历史记录和会话管理
- 🔐 去中心化 P2P 通信，无需中央服务器
- 📱 支持 Web、Desktop、Mobile（Android/iOS）多平台

---

## 🏗️ 整体架构

### 架构模式

项目采用 **多层架构 + 多平台** 设计模式：

```
┌─────────────────────────────────────────────────────────┐
│                    用户界面层                              │
│  ┌──────────┬──────────┬──────────┬──────────┐          │
│  │ Web UI   │ Desktop  │ Android  │   iOS    │          │
│  │ (Solid)  │  (Tauri) │  (Tauri) │ (Tauri)  │          │
│  └──────────┴──────────┴──────────┴──────────┘          │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│                   应用层 (Tauri)                          │
│  ┌──────────────────────────────────────┐               │
│  │  Rust Backend (app/src)              │               │
│  │  - P2P 网络集成                       │               │
│  │  - 终端事件处理                       │               │
│  │  - 状态管理                           │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│                   共享库层 (shared/)                      │
│  ┌──────────────────────────────────────┐               │
│  │  P2P Network (riterm-shared)         │               │
│  │  - iroh-gossip 协议                   │               │
│  │  - 消息加密/解密                       │               │
│  │  - 数据压缩                           │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│                    CLI 工具层 (cli/)                      │
│  ┌──────────────────────────────────────┐               │
│  │  Terminal Management                 │               │
│  │  - Shell 检测和配置                   │               │
│  │  - 终端录制和管理                     │               │
│  │  - PTY 驱动                           │               │
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│                   底层基础设施                            │
│  ┌──────────┬──────────┬──────────┬──────────┐          │
│  │ iroh P2P │ tokio    │ PTY      │ Crypto   │          │
│  │ 网络     │ 异步运行时 │ 终端接口  │ 加密库    │          │
│  └──────────┴──────────┴──────────┴──────────┘          │
└─────────────────────────────────────────────────────────┘
```

---

## 🔧 技术栈详解

### 1. 后端技术栈 (Rust)

#### 核心框架
- **Tokio** (`1.47`) - 异步运行时
  - 支持多线程异步 I/O
  - 网络、文件系统、定时器等异步操作
  
- **Tauri** (`2.x`) - 跨平台应用框架
  - 原生桌面应用支持
  - 移动端（Android/iOS）支持
  - 轻量级（相比 Electron）
  - 插件系统

#### P2P 网络层
- **iroh** (`0.94`) - P2P 网络库
  - 去中心化架构
  - NAT 穿透能力
  - 节点发现机制
  
- **iroh-gossip** (`0.94`) - Gossip 协议
  - 消息广播
  - 订阅/发布模式
  - 可靠的消息传递

#### 安全与加密
- **chacha20poly1305** (`0.10`) - 加密算法
  - AEAD (认证加密与关联数据)
  - 高性能对称加密
  - 防止篡改和重放攻击

#### 终端管理
- **portable-pty** (`0.9`) - PTY 抽象层
  - 跨平台 PTY 接口
  - 支持 Windows (ConPTY) 和 Unix (PTY)
  
- **crossterm** (`0.29`) - 终端操作
  - 跨平台终端控制
  - 事件处理
  - 样式和颜色

#### 平台特定依赖
- **Unix**: `nix`, `libc`, `rustix` - 系统调用和终端控制
- **Windows**: `conpty`, `windows` crate - Windows ConPTY 支持

#### 数据处理
- **brotli** (`6.0`) - 数据压缩
- **bincode** (`1.3`) - 二进制序列化
- **serde** (`1.0`) - 序列化框架

### 2. 前端技术栈

#### UI 框架
- **Solid.js** (`1.9.9`) - 响应式 UI 框架
  - 细粒度响应式系统
  - 高性能（无虚拟 DOM）
  - 类 React 语法
  
#### 终端模拟器
- **xterm.js** (`5.5.0`) - 终端模拟器
  - 功能齐全的终端实现
  - 支持 ANSI 转义序列
  - 插件系统

- **xterm 插件生态**:
  - `@xterm/addon-fit` - 自适应终端大小
  - `@xterm/addon-canvas` - Canvas 渲染器
  - `@xterm/addon-webgl` - WebGL 渲染器（高性能）
  - `@xterm/addon-search` - 搜索功能
  - `@xterm/addon-web-links` - 链接识别

#### UI 组件库
- **DaisyUI** (`5.0.50`) - Tailwind CSS 组件库
- **Tailwind CSS** (`4.1.12`) - 实用优先的 CSS 框架
- **lucide-solid** (`0.540.0`) - 图标库

#### 工具库
- **vconsole** (`3.15.1`) - 移动端调试工具
- **fast_qr** (`0.13.0`) - QR 码生成

#### 构建工具
- **Vite** (`7.1.3`) - 现代化构建工具
  - 快速 HMR
  - 优化的生产构建
  - ESM 支持

### 3. 开发工具链

#### 包管理
- npm/pnpm - JavaScript 包管理
- Cargo - Rust 包管理

#### CI/CD
- GitHub Actions - 自动化构建和发布
  - 多平台构建（Windows、macOS、Linux、Android）
  - 自动发布到 GitHub Releases

---

## 🔍 核心模块分析

### 1. P2P 网络模块 (`shared/src/p2p.rs`)

#### 主要组件

**P2PNetwork 结构**
```rust
pub struct P2PNetwork {
    endpoint: Endpoint,        // iroh P2P 端点
    gossip: Gossip,           // gossip 协议实例
    router: Router,           // 消息路由器
    sessions: RwLock<HashMap<String, SharedSession>>,  // 会话管理
}
```

#### 消息类型层次

**网络消息层 (NetworkMessage)**
- 加密传输的底层消息
- 包含会话管理、终端 I/O、终端管理等类型
- 支持虚拟终端和真实终端

**应用事件层 (TerminalEvent)**
- 高级应用事件
- 转换为 NetworkMessage 进行传输

#### 消息流程
1. **创建会话**
   - 生成随机 TopicId
   - 创建 gossip 主题
   - 生成会话票据 (SessionTicket)

2. **加入会话**
   - 解析 SessionTicket
   - 连接到指定 TopicId
   - 接收历史消息

3. **消息传输**
   - 序列化 → 压缩 → 加密 → gossip 广播
   - gossip 接收 → 解密 → 解压缩 → 反序列化

#### 加密机制
- **算法**: ChaCha20Poly1305
- **密钥**: 32字节对称密钥（从 TopicId 派生）
- **Nonce**: 每条消息使用随机 Nonce
- **完整性**: AEAD 确保消息完整性和认证

#### 压缩优化
- 使用 Brotli 压缩大型消息
- 阈值：1KB（可配置）
- 压缩率：通常 50-70%

### 2. CLI 工具模块 (`cli/src/`)

#### 目录结构
```
cli/src/
├── main.rs              - 程序入口
├── cli.rs               - 命令行参数解析
├── shell.rs             - Shell 检测和配置
├── terminal.rs          - 终端会话管理
├── terminal_driver/     - PTY 驱动实现
├── terminal_manager.rs  - 终端生命周期管理
└── terminal_runner.rs   - 终端运行器
```

#### Shell 支持
支持的 Shell 类型：
- **Unix/Linux**: Zsh, Bash, Fish, Nushell
- **Windows**: PowerShell, Cmd
- **跨平台**: 自动检测可用的 Shell

#### 终端驱动架构
- **Unix**: 使用 `nix` crate 的 PTY 支持
- **Windows**: 使用 ConPTY API
- **抽象层**: `portable-pty` 提供统一接口

#### 日志记录
- 所有终端输出保存到 `logs/{session_id}.log`
- 使用 `tracing` 框架统一日志
- 支持文件和控制台双输出

### 3. Tauri 应用模块 (`app/src/`)

#### 主要文件
```
app/src/
├── lib.rs     - 库入口，导出 Tauri 命令
└── main.rs    - 程序入口
```

#### Tauri 命令
提供给前端调用的 Rust 函数：
- `connect_session(ticket)` - 连接到会话
- `disconnect_session()` - 断开会话
- `send_input(data)` - 发送终端输入
- `send_resize(cols, rows)` - 调整终端大小
- `create_terminal()` - 创建本地终端
- `list_terminals()` - 列出终端
- `get_terminal_info(id)` - 获取终端信息

#### 事件系统
- **Rust → Frontend**: 使用 Tauri 的 `emit` 发送事件
- **事件类型**:
  - `terminal_output` - 终端输出
  - `terminal_created` - 终端创建
  - `connection_state` - 连接状态变化
  - `session_info` - 会话信息

#### 性能优化
- 使用 `tokio::spawn` 避免阻塞
- 内存限制和清理机制
- 事件缓冲和批处理

### 4. 前端 UI 模块 (`src/`)

#### 组件架构
```
src/
├── App.tsx                  - 主应用组件
├── components/
│   ├── HomeView.tsx         - 首页视图
│   ├── RemoteSessionView.tsx - 远程会话视图
│   ├── SettingsModal.tsx    - 设置面板
│   ├── P2PBackground.tsx    - 背景效果
│   └── ui/                  - UI 基础组件
├── hooks/                   - React Hooks
├── stores/                  - 状态管理
│   ├── settingsStore.ts     - 设置状态
│   └── terminalSessionStore.ts - 会话状态
└── utils/
    └── mobile/              - 移动端工具
```

#### 状态管理
- **Solid Signals**: 细粒度响应式状态
- **localStorage**: 会话持久化
- **Store 模式**: 全局状态管理

#### 终端会话管理
- **自动保存**: 每3秒保存会话状态
- **恢复机制**: 标签切换时自动恢复
- **数据结构**:
  ```typescript
  interface TerminalSession {
    id: string;
    sessionId: string;
    terminalId: string;
    shellType: string;
    currentDir: string;
    status: string;
    terminalContent?: string;
    scrollback?: string[];
    commandHistory?: string[];
  }
  ```

#### 移动端优化
- **响应式设计**: 支持各种屏幕尺寸
- **触摸手势**: 滑动、捏合等手势支持
- **虚拟键盘**: 适配移动端虚拟键盘
- **性能优化**: WebGL 渲染器（桌面）/ Canvas（移动）

---

## 🔐 安全架构

### 1. 加密通信
- **端到端加密**: ChaCha20Poly1305
- **密钥管理**: 从 TopicId 派生
- **Nonce**: 每条消息随机生成，防止重放攻击

### 2. 会话安全
- **访问控制**: 只有持有 SessionTicket 的用户可以加入
- **会话票据**: Base32 编码，包含所有必要信息
- **无中央服务器**: 去中心化架构减少攻击面

### 3. 数据隐私
- **本地存储**: 会话数据存储在用户本地
- **无云存储**: 不上传到任何云服务
- **可控删除**: 用户完全控制数据生命周期

---

## 📊 数据流分析

### 1. 创建会话流程
```
用户操作 → CLI/App 创建终端
    ↓
初始化 P2PNetwork
    ↓
生成 TopicId 和加密密钥
    ↓
创建 Gossip 主题
    ↓
生成 SessionTicket
    ↓
显示/分享票据 (QR码/文本)
```

### 2. 加入会话流程
```
扫描/输入 SessionTicket
    ↓
解析票据 (TopicId, PeerAddrs)
    ↓
连接到 P2P 网络
    ↓
订阅 Gossip 主题
    ↓
发送 ParticipantJoined 消息
    ↓
接收历史数据
    ↓
开始实时通信
```

### 3. 终端输入/输出流程
```
用户输入 → Frontend (xterm.js)
    ↓
Tauri Command (send_input)
    ↓
Rust Backend
    ↓
序列化 → 压缩 → 加密
    ↓
Gossip 广播
    ↓
其他节点接收
    ↓
解密 → 解压缩 → 反序列化
    ↓
Tauri Event (terminal_output)
    ↓
Frontend 渲染
```

---

## 🎯 关键设计决策

### 1. 为什么选择 iroh-gossip？
- **去中心化**: 无需中央协调服务器
- **NAT 穿透**: 自动处理复杂网络环境
- **可靠性**: Gossip 协议保证消息可靠传递
- **可扩展**: 支持多节点同时参与

### 2. 为什么使用 Tauri？
- **轻量级**: 相比 Electron 体积小很多
- **原生性能**: Rust 后端性能优异
- **跨平台**: 一套代码支持桌面和移动端
- **安全性**: Rust 的内存安全特性

### 3. 为什么选择 Solid.js？
- **性能**: 细粒度响应式，无虚拟 DOM 开销
- **熟悉性**: 类 React API，学习曲线平缓
- **体积**: 核心库非常小
- **适合实时**: 适合终端这种高频更新的场景

### 4. 为什么使用 ChaCha20Poly1305？
- **性能**: 软件实现性能优秀
- **安全性**: 现代加密标准，经过充分审查
- **认证**: AEAD 提供完整性和认证
- **跨平台**: 纯软件实现，无硬件依赖

---

## 📈 性能优化策略

### 1. 网络层优化
- **消息压缩**: Brotli 压缩大于 1KB 的消息
- **批处理**: 合并多个小消息
- **去重**: 使用 Nonce 避免重复处理

### 2. 终端渲染优化
- **WebGL 渲染**: 桌面端使用 GPU 加速
- **Canvas 降级**: 移动端使用 Canvas
- **虚拟滚动**: 只渲染可见区域
- **节流**: 限制刷新频率

### 3. 内存管理
- **会话限制**: 最大 50 个并发会话
- **事件缓冲**: 每个会话最大 5000 个事件
- **定期清理**: 5 分钟清理一次过期数据

### 4. 构建优化
- **LTO**: Link-Time Optimization
- **代码精简**: Strip symbols
- **单一编译单元**: codegen-units = 1

---

## 🔄 项目工作流

### 1. 开发流程
```bash
# 克隆项目
git clone https://github.com/sternelee/riterm.git
cd riterm

# 安装前端依赖
npm install

# 启动开发服务器
npm run dev

# 编译 CLI（可选）
cd cli
cargo build

# 运行 Tauri 开发模式
npm run tauri dev
```

### 2. 构建流程
```bash
# 构建前端
npm run build

# 构建 CLI
cd cli
cargo build --release

# 构建桌面应用
npm run tauri build

# 构建 Android 应用
npm run tauri android build

# 构建 iOS 应用
npm run tauri ios build
```

### 3. 测试流程
```bash
# Rust 测试
cargo test

# 会话管理测试（浏览器控制台）
testSessionManager()
```

---

## 📱 多平台支持

### 1. Web 平台
- **部署**: 静态 HTML/JS/CSS
- **运行**: 任何现代浏览器
- **限制**: 无法创建本地终端，只能加入会话

### 2. 桌面平台
- **Windows**: 原生 ConPTY 支持
- **macOS**: POSIX PTY + macOS 私有 API
- **Linux**: POSIX PTY
- **打包**: 单一可执行文件 + 资源

### 3. Android 平台
- **架构**: Tauri Android
- **最低版本**: Android 7.0 (API 24)
- **特性**: 条码扫描、通知、剪贴板

### 4. iOS 平台
- **架构**: Tauri iOS
- **最低版本**: iOS 13.0
- **特性**: 条码扫描、通知、剪贴板
- **状态**: 开发中

---

## 🚀 未来规划

### 短期目标
- [ ] 完善 iOS 应用支持
- [ ] 权限管理（只读/读写）
- [ ] 文件传输功能
- [ ] 会话录制和回放增强

### 中期目标
- [ ] 协作编辑功能
- [ ] 集成语音通话
- [ ] 插件系统
- [ ] 会话模板

### 长期目标
- [ ] 屏幕共享
- [ ] AI 辅助功能
- [ ] 企业级功能
- [ ] 云同步（可选）

---

## 📚 技术文档索引

### 核心文档
- `README.md` - 项目介绍和快速开始
- `docs/TERMINAL_SESSIONS.md` - 终端会话管理
- `docs/SESSION_MANAGEMENT.md` - 会话管理功能
- `IROH_GOSSIP_IMPLEMENTATION.md` - iroh-gossip 实现

### 开发指南
- `cli/REFACTOR_REPORT.md` - CLI 重构报告
- `CREATE_TERMINAL_FEATURE.md` - 终端创建功能
- `P2P_TERMINAL_FIX.md` - P2P 终端修复

### 移动端文档
- `MOBILE_OPTIMIZATIONS.md` - 移动端优化
- `MOBILE_KEYBOARD_TESTING.md` - 移动键盘测试
- `.kiro/specs/mobile-terminal-optimization/` - 移动端优化规范

### 其他文档
- `SHORTCUT_KEYS_GUIDE.md` - 快捷键指南
- `NERD_FONT_GUIDE.md` - Nerd Font 指南
- `TIMEOUT_BEST_PRACTICES.md` - 超时最佳实践
- `DATA_STRUCTURE_CLEANUP.md` - 数据结构清理

---

## 🤝 贡献指南

### 代码风格
- **Rust**: 遵循 Rust 标准风格，使用 `rustfmt`
- **TypeScript**: 使用 ESLint 和 Prettier
- **Commit**: 遵循 Conventional Commits

### 开发注意事项
1. **性能**: 注意内存和 CPU 使用
2. **安全**: 避免引入安全漏洞
3. **兼容性**: 确保跨平台兼容
4. **文档**: 更新相关文档

---

## 📞 联系方式

- **GitHub**: https://github.com/sternelee/riterm
- **Issues**: https://github.com/sternelee/riterm/issues
- **Discussions**: https://github.com/sternelee/riterm/discussions

---

## 📄 许可证

MIT License - 详见 LICENSE 文件

---

**最后更新**: 2025-10-30
**版本**: v0.1.0
