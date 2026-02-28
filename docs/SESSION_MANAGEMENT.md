# 会话管理（多 Agent）

本文档描述 ClawdChat 当前的会话模型：多 Agent + 本地/远程双模式。

## 会话模型

会话由 `sessionStore` 管理，核心维度如下：

- `sessionId`：会话唯一标识
- `agentType`：Agent 类型（如 `claude`、`codex`、`gemini`、`opencode`、`openclaw`）
- `mode`：`local` 或 `remote`
- `projectPath/currentDir`：会话关联目录
- `active`：是否活跃

## 两种会话模式

### Local

- 在本机直接启动和管理 Agent
- 适用于本地开发与调试
- 可加载本地 Agent 历史会话

### Remote

- 通过连接会话控制远端 Agent
- 适用于跨设备或远端运行环境
- 可由本地会话派生远程会话

## 侧边栏行为

`SessionSidebar` 提供统一入口：

- 显示所有活跃会话
- 切换当前活跃会话
- 关闭会话（会尝试停止对应本地 agent）
- 本地会话支持展开历史并加载历史 session

移动端适配：

- 历史/关闭操作使用下拉菜单触发
- 避免会话项内多按钮造成触控拥挤

## 新建会话

通过 New Session 流程创建会话：

- `local`：直接创建本地会话
- `remote`：基于控制会话创建远端会话

## 权限模式

每个会话可配置权限策略：

- `AlwaysAsk`
- `AcceptEdits`
- `Plan`
- `AutoApprove`

权限模式由前端设置并同步到后端命令通道。

## 相关代码

- `src/stores/sessionStore.ts`
- `src/components/SessionSidebar.tsx`
- `src/components/NewSessionModal.tsx`
- `src/components/ChatView.tsx`
