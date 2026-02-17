# Claude SDK 实现 vs ACP 方案审查

本文档对比当前 `claude_sdk.rs`（直接使用 Claude Agent SDK Control Protocol）与 [zed-industries/claude-agent-acp](https://github.com/zed-industries/claude-agent-acp) 的 ACP 适配方案，并列出可优化点。

---

## 1. 架构差异概览

| 维度 | 当前实现 (claude_sdk.rs) | Zed ACP 方案 (claude-agent-acp) |
|------|--------------------------|----------------------------------|
| **协议** | 直接使用 SDK ndJSON（stdin/stdout） | ACP (Agent Client Protocol) over stdio |
| **语言** | Rust，子进程 `claude` CLI | TypeScript/Node，内嵌 `@anthropic-ai/claude-agent-sdk` |
| **进程模型** | 每会话一个 `claude` 子进程 | 单进程内 `query()` 迭代器，SDK 内部管理子进程 |
| **权限** | 自定义 `permission_request` / `permission_response` + PermissionManager | ACP `requestPermission` + `canUseTool` 回调，支持 mode（default/acceptEdits/bypassPermissions/plan） |
| **会话能力** | 单会话生命周期，无 resume/fork/list | 支持 loadSession、forkSession、resumeSession、listSessions（基于 ~/.claude/projects 的 JSONL） |

当前实现是「ClawdChat 作为 SDK 的驱动端」；Zed 方案是「ACP 服务端 + Claude SDK 作为后端」，面向多客户端与标准化协议。

---

## 2. 已发现并修复的问题

### 2.1 Typo：thinking 块条件

- **位置**: `run_stdout_reader` 中处理 `assistant` 消息的 `thinking` 块。
- **问题**: `if !!thinking.is_empty()` 导致条件恒为 `false`（双重否定），thinking 内容从未被 emit。
- **修复**: 改为 `if !thinking.is_empty()`。

---

## 3. 协议与事件处理对比

### 3.1 当前实现已覆盖的 SDK 消息类型

- `system` (subtype `init`) — 会话初始化
- `assistant` — 完整消息中的 content 数组（text/thinking）
- `content_block_start` / `content_block_delta` / `content_block_stop` — 流式 text/thinking/tool_use
- `permission_request` — 权限请求，转发到 PermissionManager
- `result` (success / error 系) — 回合结束，驱动 `TurnCompleted` / `TurnError`
- `message_start` / `message_delta` / `message_stop` — 以 Raw 事件透传

与 SDK 文档一致，覆盖流式文本、思考、工具调用与权限请求。

### 3.2 ACP 方案中我们未实现或可增强的部分

1. **stream_event 优先**  
   ACP 侧用 `stream_event` 驱动 `streamEventToAcpNotifications`，把 content_block_* 等转为 ACP sessionUpdate。我们当前是直接解析 content_block_* 和 assistant，逻辑等价但若 SDK 以后更多通过 stream_event 暴露，可考虑增加对 `stream_event` 的解析以保持兼容。

2. **result 子类型**  
   ACP 显式处理：
   - `success`、`error_during_execution`、`error_max_budget_usd`、`error_max_turns`、`error_max_structured_output_retries`  
   我们当前对非 success 统一按 `is_error` + `error` 处理，可细化子类型（如 max_turns vs 其他）以便前端区分「结束原因」（例如达到回合上限 vs 一般错误）。

3. **Cancel 语义**  
   我们通过 SIGINT 中断子进程；ACP 侧是 `query.interrupt()`。行为应对齐；若 SDK 文档推荐 interrupt 而非仅 SIGINT，可评估是否在协议层增加「中断」命令（若 SDK 支持）。

4. **Permission 协议格式**  
   我们使用自定义的 `permission_response` + `permission_response.permission`（allow/deny）。需与 SDK 文档核对是否还有 `reason`、`suggestion` 等字段；若有，应在 `RespondToPermission` 和 stdin 写入中支持。

---

## 4. 可优化点（按优先级）

### 4.1 高优先级

- **Thinking 条件 bug**  
  已修复：`!!thinking.is_empty()` → `!thinking.is_empty()`。

- **Result 错误子类型**  
  在 `run_stdout_reader` 的 `result` 分支中，根据 `subtype` 设置更明确的 `code` 或扩展 `TurnError`/`TurnCompleted` 的 result 结构（如 `stopReason: "max_turn_requests"`），便于前端区分「正常结束 / 取消 / 达到上限 / 其他错误」。

- **stdin 写入与 flush**  
  当前在 `Prompt` 分支先 `write_all`，再在锁外单独 `lock + flush`。若锁竞争大，可考虑合并为一次 lock 内 write_all + flush，减少锁次数并保证可见性。

### 4.2 中优先级

- **Permission 的 reason/suggestions**  
  若 SDK 支持在 permission_response 中传 reason 或 suggestions，在 `RespondToPermission` 和写入 stdin 的 JSON 中支持并透传，与 ACP 的「allow_always / allow_once / reject_once」等选项对齐概念。

- **content_blocks 生命周期**  
  在 `result` 时已 `content_blocks.clear()`；若 SDK 在异常路径下不发送 `content_block_stop`，可能残留条目。可考虑在 `content_block_stop` 或新 turn 开始时做一次清理，或在收到新 `content_block_start` 时对旧 index 做清理，避免 map 无限增长。

- **日志级别**  
  当前每行 stdout 用 `info!`，在高频流式下可能刷屏。可改为 `debug!`，仅对关键事件（如 TurnStarted、TurnCompleted、PermissionRequest）使用 `info!`。

### 4.3 低优先级 / 长期

- **与 ACP 对齐的会话能力**  
  若产品需要「从历史恢复会话」或「会话列表」，可参考 ACP 的 loadSession/listSessions（基于 ~/.claude/projects 的 JSONL），在 Rust 侧实现类似逻辑或通过 CLI 包装暴露。

- **Query API**  
  当前 `SdkCommand::Query` 仅返回静态信息。若需要动态能力（如当前 model、permission mode），可扩展为从 SDK 的 system/init 或后续扩展协议中解析并缓存，在 Query 时返回。

- **Raw 事件**  
  已对未识别类型和 message_start/delta/stop 发 Raw。若上游需要审计或调试，可考虑为 Raw 增加配置开关（如仅 debug 开启）或采样。

---

## 5. 与 ACP 方案的功能差距（可选实现）

以下能力在 Zed ACP 中有，当前 claude_sdk 未做，可按产品需求决定是否实现：

- **Session 持久化与恢复**：loadSession、resumeSession、listSessions（基于文件系统 JSONL）。
- **Fork session**：从已有会话 fork 出新会话。
- **MCP 集成**：内置 MCP 服务器（如 acp 工具）、client MCP servers 配置。
- **Slash commands**：available_commands 更新、/compact 等与 UI 的联动。
- **Plan mode / ExitPlanMode**：permission mode 与「计划模式」切换，以及对应的 UI 选项（Always Allow / Allow / Reject 等）。
- **ReadTextFile / WriteTextFile**：由 ACP 客户端提供，我们若走纯 SDK 则无需实现；若将来做 ACP 服务端再对齐。
- **setSessionModel / setSessionMode**：动态改 model 或 permission mode，对应 SDK 的 `query.setModel` / `query.setPermissionMode`。

---

## 6. Claude ACP Agent（已实现）

项目已新增 **ClaudeAcp** agent 类型，直接使用 Zed 方案 [@zed-industries/claude-agent-acp](https://github.com/zed-industries/claude-agent-acp)：

- **协议**：通过现有 ACP 客户端 spawn `npx -y @zed-industries/claude-agent-acp`，走标准 ACP 流程（initialize → newSession → prompt/cancel）。
- **使用**：前端选择「Claude (ACP)」、CLI 使用 `claude_acp` 或 `claudeacp`、/spawn 支持 `claude_acp`。
- **依赖**：Node.js、`npm view @zed-industries/claude-agent-acp version` 可用；认证需 `ANTHROPIC_API_KEY` 或 `claude /login`。
- **能力**：与 Zed 一致（session list/resume、MCP、slash commands、plan mode 等），由 claude-agent-acp 内部实现。

与 **ClaudeCode**（SDK 直连）二选一即可：要 Zed 生态能力用 ClaudeAcp，要轻量直连用 ClaudeCode。

---

## 7. 小结

- **Bug**：thinking 块条件已修复（`!!` → `!`）。
- **协议**：当前对 SDK 的 ndJSON 解析与事件映射基本完整；可加强 result 子类型、permission 字段和 stdin 写入一致性。
- **可维护性**：建议将「SDK 消息类型 → AgentEvent」集中到少量函数或枚举，便于与官方文档或 ACP 行为对照。
- **与 ACP 的关系**：当前是「直接驱动 SDK」的轻量方案；若需要多端统一、会话管理、MCP、Plan mode 等，可参考 claude-agent-acp 的设计，在现有事件管道上逐步增加上述能力。
