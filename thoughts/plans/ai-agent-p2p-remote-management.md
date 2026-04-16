# Irogen 项目方向调整规划

## 项目愿景转变

**从**：P2P 终端会话共享工具 (PTY-based Terminal Sharing)
**到**：P2P 远程管理 AI 编码工具 (AI Agent Remote Management)

## 核心理念

参考 tiann/hapi 的设计理念，实现：

- **Seamless Handoff** - 本地工作，随时切换远程，无上下文丢失
- **Native First** - 包装而非替换 AI 代理，保持原生体验
- **AFK Without Stopping** - 离开工位？手机一键批准 AI 请求
- **Your AI, Your Choice** - Claude Code, OpenCode, Gemini CLI 等

## 与 hapi 的关键差异

| 特性     | hapi                               | Irogen               |
| -------- | ---------------------------------- | ----------------------- |
| 网络架构 | 中心化 (Client-Server + Socket.IO) | 去中心化 (P2P via iroh) |
| 通信协议 | Socket.IO + SSE                    | iroh QUIC + E2E 加密    |
| 隧道需求 | Cloudflare Tunnel / Tailscale      | 内建 NAT 穿透           |
| 服务器   | 需要 Node.js Server                | 无需中心服务器          |
| 部署     | 需要公网IP或隧道                   | 本地直连，零配置        |

## 新架构设计

### 三组件架构（保持类似 hapi）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          本地机器 (运行 AI Agent)                             │
│                                                                              │
│   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
│   │              │         │              │         │              │        │
│   │  Irogen CLI  │◄───────►│ iroh P2P     │◄───────►│   Tauri      │        │
│   │              │ iroh    │   Network    │ iroh    │   Desktop    │        │
│   │  + AI Agent  │ QUIC    │              │ QUIC    │   App        │        │
│   │              │         │  E2E Encrypted│         │              │        │
│   └──────────────┘         └──────────────┘         └──────────────┘        │
│        │                        ▲                        ▲                   │
│        │                        │                        │                   │
└────────┼────────────────────────┼────────────────────────┼───────────────────┘
         │                        │                        │
         │ iroh P2P Network       │                        │
         │ (NAT Traversal)        │                        │
         │                        │                        │
┌────────┼────────────────────────┼────────────────────────┼───────────────────┐
│        ▼                        │                        │                   │
│   ┌─────────────────────────────┼────────────────────────┼───────┐          │
│   │                             ▼                        ▼       │          │
│   │   ┌──────────────┐                   ┌──────────────┐        │          │
│   │   │              │                   │              │        │          │
│   │   │   Mobile     │                   │   Browser    │        │          │
│   │   │   App        │                   │   Client     │        │          │
│   │   │ (Tauri/PWA)  │                   │   (WASM)     │        │          │
│   │   │              │                   │              │        │          │
│   │   └──────────────┘                   └──────────────┘        │          │
│   │                                                              │          │
│   └──────────────────────────────────────────────────────────────┘          │
│                            你的手机 / 浏览器                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 组件职责

#### 1. Irogen CLI

包装和管理 AI 编码工具：

- 启动和管理 AI 会话 (Claude Code, OpenCode, Gemini CLI)
- 通过 iroh P2P 注册会话
- 转发消息和权限请求
- 提供 MCP (Model Context Protocol) 工具桥接

**命令设计**：

```bash
irogen              # 启动 Claude Code 会话
irogen opencode     # 启动 OpenCode 会话
irogen gemini       # 启动 Gemini CLI 会话
irogen runner       # 后台服务模式
```

#### 2. iroh P2P Network

利用现有的 iroh 基础设施：

- QUIC 协议的可靠消息传递
- NAT 穿透（无需中心服务器）
- 端到端加密（ChaCha20Poly1305）
- 连接复用和事件管理

**复用现有组件**：

- `shared/src/quic_server.rs`
- `shared/src/communication_manager.rs`
- `shared/src/message_protocol.rs` (需要扩展)

#### 3. Tauri Desktop / Mobile App

聊天式交互界面：

- 会话列表（活跃和历史）
- 聊天界面（发送消息、查看响应）
- 权限管理（批准/拒绝工具访问）
- 文件浏览（查看项目文件和 git diffs）
- 远程生成（在连接的机器上启动新会话）

## 消息协议设计

### 扩展现有 MessageProtocol

```rust
// shared/src/message_protocol.rs

pub enum MessageType {
    // 保留现有的终端相关消息（向后兼容）
    TerminalData,
    TcpForwarding,
    SessionManagement,

    // 新增：AI Agent 相关消息
    AgentSession,        // 会话注册、心跳
    AgentMessage,        // 用户消息 <-> AI 响应
    AgentPermission,     // 权限请求/响应
    AgentControl,        // 会话控制（暂停、恢复、终止）
    AgentMetadata,       // 元数据和状态更新
}

// AI 会话元数据
pub struct AgentSessionMetadata {
    pub session_id: String,
    pub agent_type: AgentType,
    pub project_path: String,
    pub started_at: u64,
    pub active: bool,
    pub controlled_by_remote: bool,
}

pub enum AgentType {
    ClaudeCode,
    OpenCode,
    Gemini,
}
```

### 消息流设计

#### 会话启动流程

```
1. 用户运行 `irogen`
         │
         ▼
2. CLI 启动 Claude Code 子进程
         │
         ▼
3. CLI 通过 iroh 广播会话可用性
         │
         ▼
4. Mobile/Web 通过 P2P 发现会话
         │
         ▼
5. 会话出现在移动应用中
```

#### 权限请求流程

```
1. AI 请求工具权限 (如文件编辑)
         │
         ▼
2. CLI 通过 iroh 发送权限请求
         │
         ▼
3. P2P 网络传输 (E2E 加密)
         │
         ▼
4. 用户在手机收到通知
         │
         ▼
5. 用户在 Web App 批准/拒绝
         │
         ▼
6. 决策通过 P2P 网络返回 CLI
         │
         ▼
7. CLI 通知 AI，继续执行
```

## 技术栈调整

### 后端 (Rust)

- **保留**：iroh P2P 网络基础设施
- **新增**：AI Agent 包装器
  - `cli/src/agent_wrapper/` - 通用 agent 包装层
  - `cli/src/claude/` - Claude Code 集成
  - `cli/src/opencode/` - OpenCode 集成
  - `cli/src/gemini/` - Gemini CLI 集成
  - `cli/src/mcp_bridge/` - MCP stdio 桥接

### 前端 (SolidJS + Tauri)

- **保留**：SolidJS, Tauri, TailwindCSS
- **移除**：ghostty-web (终端不再需要)
- **新增**：聊天界面组件
  - `src/components/chat/` - 聊天界面
  - `src/components/sessions/` - 会话管理
  - `src/components/permissions/` - 权限请求处理
  - `src/stores/chatStore.ts` - 聊天状态管理
  - `src/stores/sessionStore.ts` - 会话状态管理

### Web Client (WASM)

- **保留**：WASM P2P 实现
- **调整**：从终端界面改为聊天界面

## 开发阶段

### Phase 1: 核心基础设施 ✅ 完成

- [x] 扩展 `message_protocol.rs` 支持 AI Agent 消息类型
- [x] 实现 `AgentManager` in `cli/src/agent_wrapper/mod.rs`
- [x] 实现 Claude Code 包装器 (`cli/src/agent_wrapper/claude.rs`)
- [x] 更新 CLI 命令处理

### Phase 2: 前端聊天界面 ✅ 完成

- [x] 创建 `ChatView` 组件 (DaisyUI 风格)
- [x] 创建 `SessionListView` 组件
- [x] 实现 `chatStore` 和 `sessionStore`
- [x] 移除终端相关 UI (ghostty-web)
- [x] 清理 App.tsx，移除终端代码

### Phase 3: 权限管理系统 ✅ 完成

- [x] 实现权限请求 UI (DaisyUI alert 组件)
- [x] 实现权限状态同步
- [x] 添加推送通知支持 (NotificationDisplay 组件)

### Phase 4: 多 AI 支持 ✅ 完成

- [x] 实现 OpenCode 包装器 (`cli/src/agent_wrapper/opencode.rs`)
- [x] 实现 Gemini CLI 包装器 (`cli/src/agent_wrapper/gemini.rs`)
- [x] 统一消息格式转换 (AgentFactory trait)

### Phase 5: 高级功能 ✅ 完成

- [x] 文件浏览 (FileBrowserView + FileBrowserMessageHandler)
- [x] Git diffs (GitDiffView + GitStatusMessageHandler)
- [x] 远程会话生成 (RemoteSpawn UI + RemoteSpawnMessageHandler)
- [x] P2P 通知系统 (NotificationDisplay + NotificationMessageHandler)
- [ ] 语音输入（可选 - 待实现）

## 优势总结

1. **零配置部署**：利用 iroh 的 NAT 穿透，无需中心服务器或隧道
2. **端到端加密**：所有消息通过 iroh 加密传输
3. **去中心化**：没有单点故障
4. **跨平台**：桌面 + 移动 + 浏览器全平台支持
5. **原生体验**：保持 AI 代理的原生使用方式

## 待确认事项

- [x] 是否需要中心服务器用于某些功能 → **否，完全使用 iroh P2P**
- [x] 是否需要实现类似 hapi 的 Telegram Bot 集成 → **否，使用 P2P 通知**
- [ ] 如何处理离线消息存储
- [ ] 多机器场景下的会话管理策略
- [ ] 语音输入功能的实现方案
