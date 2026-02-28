# 聊天与终端会话交互说明

本文档描述当前 ChatView 中与会话交互相关的行为：消息流、工具调用展示、审批动作、自动滚动。

## 消息类型

`ChatMessage` 主要角色：

- `user`：用户输入
- `assistant`：Agent 输出
- `system`：系统事件（工具、命令、审批、进度、错误等）

系统消息会被结构化渲染为状态卡片，便于快速识别：

- Tool Started / Completed / Failed
- Command Output / Failed
- Permission Request
- Progress Update
- Usage Update
- Session Started

## 工具调用与审批

- 工具调用事件会汇总并更新同一条系统消息（按 toolId upsert）
- 审批请求进入 pending permission 列表
- 用户审批后，前端调用后端响应接口并更新状态

## 自动滚动策略

当前滚动策略为“仅在粘底状态自动滚动”：

- 当用户位于底部附近（阈值约 80px）时，新消息会自动滚到底
- 当用户主动上滑查看历史时，自动滚动会关闭
- 只有用户回到底部或点击“回到底部”按钮后，才重新启用自动滚动

这可避免新消息打断用户阅读历史内容。

## 移动端交互

- 顶部会话动作（权限模式/新建会话）使用小号菜单按钮下拉触发
- 侧边栏会话动作（历史/关闭）同样使用小号菜单按钮
- 下拉菜单通过 Portal/fixed 浮层显示，避免撑开滚动容器高度

## 相关代码

- `src/components/ChatView.tsx`
- `src/components/SessionSidebar.tsx`
- `src/components/ui/Dropdown.tsx`
- `src/stores/chatStore.ts`
