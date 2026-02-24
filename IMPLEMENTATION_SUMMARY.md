# 工具审批功能实现总结

## 已完成的功能

### P0 - 核心权限处理器

#### 1. PermissionHandler 抽象类

**文件**: `shared/src/agent/permission_handler.rs`

功能：

- ✅ `PermissionHandler` 核心权限管理类
- ✅ 自动审批逻辑 (`should_auto_approve()`)
- ✅ 会话级工具允许列表 (`allowed_tools`)
- ✅ 待处理/已完成请求管理
- ✅ 完整的单元测试覆盖

自动审批规则：

```rust
- AlwaysAsk: 手动批准所有工具
- AcceptEdits: 自动批准编辑工具，询问其他
- AutoApprove: 所有工具 ApprovedForSession
- Plan: 自动批准读取工具，询问写入工具
```

#### 2. ACP 集成

**文件**: `shared/src/agent/acp.rs`

修改：

- ✅ `PermissionManagerCommand` 扩展支持 `ApprovalDecision`
- ✅ `AcpRuntimeParams` 添加 `permission_mode` 参数
- ✅ `AcpClientHandler` 集成权限处理器
- ✅ `request_permission()` 实现自动审批
- ✅ `run_command_loop()` 更新权限状态
- ✅ `respond_to_permission()` 支持会话级批准

#### 3. 类型系统更新

**文件**: `shared/src/agent/mod.rs`, `shared/src/agent/events.rs`

修改：

- ✅ 移除重复的 `PermissionMode` 定义
- ✅ 导出新的权限相关类型
- ✅ 统一权限类型系统

### P1 - 前端 UI 组件

#### 4. PermissionCard 组件

**文件**: `src/components/ui/PermissionCard.tsx`

功能：

- ✅ `PermissionCard` - 单个权限请求卡片
- ✅ `PermissionList` - 权限列表容器
- ✅ 支持三种审批操作：
  - Allow (批准一次)
  - Allow for Session (会话内自动批准)
  - Allow All Edits (批准所有编辑)
- ✅ 动态显示操作按钮（基于工具类型和权限模式）
- ✅ 参数格式化和显示
- ✅ 时间戳格式化
- ✅ 加载状态支持

## 架构对比

### hapi vs riterm

| 功能                   | hapi                          | riterm                                            | 状态      |
| ---------------------- | ----------------------------- | ------------------------------------------------- | --------- |
| PermissionHandler 抽象 | BasePermissionHandler         | PermissionHandler                                 | ✅ 完成   |
| 自动审批规则           | resolveAutoApprovalDecision() | should_auto_approve()                             | ✅ 完成   |
| 权限状态               | ToolPermission + AgentState   | PendingPermissionEntry + CompletedPermissionEntry | ✅ 完成   |
| 前端 UI                | ToolCard + PermissionFooter   | PermissionCard + PermissionList                   | ✅ 完成   |
| 会话级批准             | ApprovedForSession            | ApprovedForSession + allowed_tools                | ✅ 完成   |
| API 路由               | /permissions/:id/approve      | Tauri commands (待实现)                           | ⚠️ 待完成 |
| 命名空间支持           | allowedTools                  | allowed_tools: HashSet                            | ✅ 完成   |

## 待完成功能

### P2 - 后端 API

#### 5. Tauri Commands

**需要实现**:

```rust
// app/src/commands/permission.rs
#[tauri::command]
async fn set_permission_mode(session_id: String, mode: PermissionMode) -> Result<()>

#[tauri::command]
async fn approve_permission(
    session_id: String,
    request_id: String,
    decision: Option<ApprovalDecision>,
    allowed_tools: Option<Vec<String>>
) -> Result<()>

#[tauri::command]
async fn deny_permission(
    session_id: String,
    request_id: String,
    reason: Option<String>
) -> Result<()>

#[tauri::command]
async fn get_permission_state(session_id: String) -> Result<PermissionHandlerState>
```

### P2 - 前端集成

#### 6. 会话管理集成

**需要添加**:

```typescript
// src/stores/sessionStore.ts
export interface SessionState {
  // 现有字段...
  permissionMode: PermissionMode;
  pendingPermissions: PendingPermission[];
  permissionHandlerState: PermissionHandlerState;
}

// 方法
async function setPermissionMode(mode: PermissionMode): Promise<void>;
async function approvePermission(
  requestId: string,
  decision?: ApprovalDecision,
): Promise<void>;
async function denyPermission(
  requestId: string,
  reason?: string,
): Promise<void>;
```

## 使用示例

### 启动带权限模式的会话

```rust
use riterm::agent::{AgentManager, PermissionMode};

let manager = AgentManager::new();
let session_id = manager.start_session(
    AgentType::OpenClaw,
    None,
    vec![],
    "/workspace".into(),
    None,
    "local".to_string(),
).await?;

// 设置权限模式 - Tauri command
await invoke("set_permission_mode", {
  sessionId: session_id,
  mode: "AcceptEdits"
}).await?;
```

### 处理权限请求

```typescript
import { PermissionList } from './components/ui/PermissionCard'

function PendingPermissions() {
  const session = sessionStore.current()
  const [loading, setLoading] = createSignal<string | null>(null)

  const handleApprove = async (requestId: string, decision?: "Approved" | "ApprovedForSession") => {
    setLoading(requestId)
    try {
      await invoke('approve_permission', {
        sessionId,
        requestId,
        decision,
        allowedTools: decision === "ApprovedForSession" ? ["tool_name"] : undefined
      })
    } catch (e) {
      console.error('Failed to approve permission', e)
    } finally {
      setLoading(null)
    }
  }

  const handleDeny = async (requestId: string) => {
    setLoading(requestId)
    try {
      await invoke('deny_permission', {
        sessionId,
        requestId,
        reason: "User denied"
      })
    } catch (e) {
      console.error('Failed to deny permission', e)
    } finally {
      setLoading(null)
    }
  }

  return (
    <PermissionList
      permissions={session.pendingPermissions}
      disabled={loading() !== null}
      permissionMode={session.permissionMode}
      onApprove={handleApprove}
      onDeny={handleDeny}
    />
  )
}
```

## 测试覆盖

### 单元测试

```bash
# 运行权限处理器测试
cargo test -p shared permission_handler

# 运行 ACP 集成测试
cargo test -p shared acp
```

### 测试场景

- ✅ 自动批准 - Always Approved
- ✅ 自动批准 - ApprovedForSession (AutoApprove 模式)
- ✅ 自动批准 - AcceptEdits 模式
- ✅ 自动批准 - Plan 模式
- ✅ 手动批准 - Allow/Allow for Session/Deny
- ✅ 会话级工具允许
- ✅ 权限取消

## 数据流

```
Agent 工具调用
  ↓
AcpClientHandler::request_permission()
  ↓
PermissionHandler::should_auto_approve()
  ├─→ 自动批准 ──→ 返回 Approved/ApprovedForSession
  └─→ 需要手动审批 ──→
        ↓
     发送 ApprovalRequest 事件
        ↓
     前端显示 PermissionCard
        ↓
     用户点击 Allow/Allow for Session/Deny
        ↓
     调用 respond_to_permission()
        ↓
     PermissionHandler::resolve()
        ↓
     更新 allowed_tools (如果是 ApprovedForSession)
        ↓
     返回 RequestPermissionOutcome 给 ACP
```

## 下一步

1. 实现 Tauri commands for permission management
2. 集成到前端 sessionStore
3. 添加权限模式切换 UI
4. 添加权限历史记录视图
5. 测试端到端工作流

## 参考

- hapi 实现: `/Users/sternelee/www/github/hapi`
  - `cli/src/gemini/utils/permissionHandler.ts`
  - `cli/src/modules/common/permission/BasePermissionHandler.ts`
  - `web/src/components/ToolCard/PermissionFooter.tsx`
