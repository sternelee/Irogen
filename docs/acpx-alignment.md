# Irogen ACP 与 acpx 功能对齐报告

> 对比基准: acpx `main` 分支 (2025-05-03) vs Irogen 当前实现

## 概述

acpx 是一个功能完整的 ACP CLI 客户端，支持 16+ 个内置 agent、完整的 session 生命周期管理、认证、队列系统和多种输出格式。Irogen 的 ACP 实现目前处于**功能可用但不够完整**的状态，核心通信流程已打通，但大量边缘功能和体验优化缺失。

---

## 🔴 高优先级缺失（核心功能）

### 1. ACP 认证 (Authentication)

**acpx 实现:**
- `initialize` 后检查 `authMethods`，自动选择合适的认证方法
- 支持从环境变量 (`readEnvCredential`) 和配置文件 (`resolveConfiguredAuthCredential`) 读取凭证
- 自动调用 `connection.authenticate({ methodId })`
- `authPolicy`: `"skip"` | `"fail"`

**Irogen 状态:** ❌ 完全缺失
- 没有 `authenticate` 请求的发送
- 没有凭证管理和 auth 方法选择逻辑
- 遇到需要认证的 agent 会直接失败

**影响:** 无法使用需要认证的 ACP agent（如某些企业版 Claude、Copilot）

---

### 2. Session 控制命令

**acpx 实现:**
| 命令 | ACP 方法 | 说明 |
|------|---------|------|
| `setSessionMode` | `session/set_mode` | 切换 agent 工作模式 |
| `setSessionConfigOption` | `session/set_config_option` | 设置配置选项 |
| `setSessionModel` | `session/set_model` (unstable) | 切换模型 |
| `closeSession` | `session/close` (unstable_closeNes) | 关闭 session |

**Irogen 状态:** ❌ 完全缺失
- `AcpCommand` 枚举只有 `Prompt`, `Cancel`, `Shutdown`, `Query`, `PermissionRequest`
- 没有 `SetMode`, `SetConfig`, `SetModel`, `CloseSession` 命令
- `run_command_loop` 中没有处理这些命令的分支

**影响:** 无法动态调整 agent 模式、模型或配置；无法优雅关闭 session

---

### 3. 文件系统路径安全验证

**acpx 实现:**
```typescript
// 路径必须在 cwd 子树内
function isWithinRoot(rootDir: string, targetPath: string): boolean {
  const relative = path.relative(rootDir, targetPath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolvePathWithinRoot(rawPath: string): string {
  if (!path.isAbsolute(rawPath)) {
    throw new Error(`Path must be absolute: ${rawPath}`);
  }
  const resolved = path.resolve(rawPath);
  if (!isWithinRoot(this.rootDir, resolved)) {
    throw new Error(`Path is outside allowed cwd subtree: ${resolved}`);
  }
  return resolved;
}
```

**Irogen 状态:** ❌ 缺失
- `read_text_file` / `write_text_file` 直接使用传入的路径
- 没有 `isWithinRoot` 检查
- agent 可以读写工作目录之外的任意文件

**影响:** 安全风险，agent 可能访问敏感文件

---

### 4. 写操作权限确认与预览

**acpx 实现:**
- 写操作前显示内容预览（前 16 行，最多 1200 字符）
- 交互式确认：`Allow write? (y/N)`
- 非交互式模式：根据 `nonInteractivePermissions` 策略决定（deny/fail）
- `ClientOperation` 事件上报

**Irogen 状态:** ⚠️ 部分实现
- 有 `PermissionHandler` 系统，但主要用于 `request_permission`
- `write_text_file` 直接写入，没有交互式确认
- 没有写预览功能

**影响:** 意外写入风险高，用户体验差

---

### 5. Permission 模式体系不完整

**acpx 实现:**
```typescript
type PermissionMode = "approve-all" | "approve-reads" | "deny-all";
type NonInteractivePermissionPolicy = "deny" | "fail";
```
- 自动推断 tool kind（read/search/edit/delete/move/execute/fetch/think/other）
- `"approve-reads"` 模式自动批准 read/search 类工具
- 完整的 permission stats（requested/approved/denied/cancelled）

**Irogen 状态:** ⚠️ 不同设计
```rust
pub enum PermissionMode {
    AlwaysAsk,
    AutoApprove,
    PlanMode,
}
```
- 没有 `"approve-reads"` 模式
- 没有 tool kind 自动推断
- 没有 permission stats 统计
- 没有 `NonInteractivePermissionPolicy`

**影响:** 权限控制粒度不够，CLI/自动化场景支持不足

---

### 6. Agent 命令适配

**acpx 实现:**
- **Claude Code**: 特殊的 session create timeout (60s)、`_meta` 构建
- **Gemini**: ACP flag 版本检测 (`--acp` vs `--experimental-acp`)、startup timeout (15s)
- **Qoder**: allowed tools 参数编码、benign stdout 行过滤
- **Copilot**: `--acp` 支持检测、不支持时给出友好错误
- **通用**: stdin 关闭后的优雅退出时间、stderr 过滤

**Irogen 状态:** ❌ 缺失
- 所有 agent 用同样的方式启动
- 没有 agent-specific 的 timeout、参数构建、错误处理
- 不支持 `--acp` flag 自动适配

**影响:** 某些 agent（特别是 Gemini、Copilot、Qoder）可能无法正常启动

---

## 🟡 中优先级缺失（体验优化）

### 7. Agent 生命周期追踪

**acpx 实现:**
```typescript
type AgentExitInfo = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  exitedAt: string;
  reason: "process_exit" | "process_close" | "pipe_close" | "connection_close";
  unexpectedDuringPrompt: boolean;
};
```
- 监听 `exit`, `close`, `stdout close` 事件
- 区分不同的断开原因
- 记录 `startedAt`, `lastAgentExit`
- `getAgentLifecycleSnapshot()` API

**Irogen 状态:** ⚠️ 基础实现
- 有 stderr 监控线程
- 没有系统化的生命周期追踪
- 没有 `AgentExitInfo` 结构

---

### 8. Terminal 管理差异

| 功能 | acpx | Irogen |
|------|------|--------|
| 底层实现 | `spawn` (ChildProcess) | `portable-pty` (PTY) |
| `outputByteLimit` | ✅ 支持参数传入 | ❌ 固定 64KB |
| 环境变量合并 | ✅ 合并 `process.env` | ❌ 仅使用传入的 env |
| 命令行确认 | ✅ `confirmExecute` | ❌ 直接执行 |
| 优雅关闭 | ✅ SIGTERM → SIGKILL | ❌ `kill_process_force` (SIGKILL) |
| exit signal 记录 | ✅ | ❌ |
| `ClientOperation` 上报 | ✅ | ❌ |

**注意:** Irogen 使用 PTY 是正确的设计选择（agent 需要终端交互），但功能细节需要补齐。

---

### 9. Connection Request 管理

**acpx 实现:**
```typescript
private readonly pendingConnectionRequests = new Set<PendingConnectionRequest>();

private async runConnectionRequest<T>(run: () => Promise<T>): Promise<T> {
  // 所有 connection 请求通过此包装，连接断开时优雅拒绝
}
```

**Irogen 状态:** ❌ 缺失
- 连接意外断开时，正在进行的请求会卡住或产生不清晰的错误

---

### 10. Session Update Drain

**acpx 实现:**
```typescript
async waitForSessionUpdateDrain(idleMs: number, timeoutMs: number): Promise<void> {
  // 带 idle 检测的排空等待
  // 支持 suppressReplayUpdates 抑制重放消息
}
```

**Irogen 状态:** ⚠️ 简单实现
- 有 `wait_for_session_update_drain` 方法
- 但没有 idle timeout 检测机制

---

### 11. Prompt Content 多模态

**acpx 实现:**
```typescript
type PromptInput = TextPrompt | ImagePrompt | MentionPrompt | CompositePrompt;
```
- 支持图片输入
- 支持 `@mention` 引用
- 支持多模态组合

**Irogen 状态:** ❌ 缺失
- `send_message` 只接受 `String`
- `AcpCommand::Prompt` 只有 `text: String`

---

### 12. 会话持久化

**acpx 实现:**
- `SessionRecord` 完整结构（id、历史、token 用量、模型状态等）
- 文件系统持久化
- `session/persistence/` 模块

**Irogen 状态:** ❌ 缺失
- 没有 session 持久化
- 每次重启后 session 历史丢失

---

## 🟢 低优先级（架构差异）

### 13. Queue / IPC 系统

**acpx:** 完整的队列系统用于并发控制
**Irogen:** 不需要（桌面应用，单用户）

### 14. Output Formatter

**acpx:** text / json / quiet 三种输出格式
**Irogen:** 有自己的 `AgentEvent` 事件流系统，不需要 CLI formatter

### 15. ACP Flows

**acpx:** 工作流编排系统
**Irogen:** 不需要（当前架构不涉及 workflow）

### 16. Performance Metrics

**acpx:** `PerfMetricsSnapshot` 性能指标
**Irogen:** 没有

---

## ✅ Irogen 优势（acpx 没有的功能）

| 功能 | 说明 |
|------|------|
| **Tauri 桌面集成** | UI 事件系统、前端通信 |
| **QUIC Server** | iroh-based P2P 通信 |
| **Permission Handler** | Plan Mode、工具分类、批量审批 |
| **Subagent 支持** | Tool call 中嵌套子 agent session |
| **Slash Commands** | `/commit`, `/review` 等 |
| **Event Buffer** | 历史事件回放 |
| **Tool Name Map** | Tool ID → 名称映射 |

---

## 实施建议

### Phase 1: 核心安全与功能（必须）
1. **文件系统路径安全** - 添加 `isWithinRoot` 验证
2. **ACP 认证** - 实现 `authenticate` 流程
3. **写操作确认** - 添加写预览和交互式确认
4. **Session 控制命令** - 添加 `SetMode`, `SetConfig`, `SetModel`, `CloseSession`

### Phase 2: 体验优化（重要）
5. **Agent 命令适配** - Claude/Gemini/Copilot/Qoder 特殊处理
6. **Permission 模式完善** - 添加 `"approve-reads"`、tool kind 推断
7. **Terminal 改进** - `outputByteLimit`、SIGTERM 优雅关闭
8. **Agent 生命周期** - 系统化追踪退出原因

### Phase 3: 功能扩展（可选）
9. **Prompt 多模态** - 图片、mention 支持
10. **Session 持久化** - 历史记录、状态保存
11. **Performance Metrics** - 性能指标收集
