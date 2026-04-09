# Irogen

[English](./README.md) | [中文](./README_cn.md)

一个多 Agent 本地/远程管理平台。

Irogen 提供统一会话管理体验，用于在本地与远程模式下运行和控制多个 AI Agent（Claude、Codex、Gemini、OpenCode、OpenClaw）。

## 核心能力

- 多 Agent 统一工作台
- 本地会话生命周期管理
- 远程会话控制与派生
- 权限策略：`AlwaysAsk`、`AcceptEdits`、`Plan`、`AutoApprove`
- 消息内容、工具调用、审批动作、系统事件的结构化展示
- 跨平台应用栈：Tauri 桌面端 + 移动端（Android/iOS）
- CLI Host 入口，支持本地与远程连接场景

## 仓库结构

- `cli/`：Rust CLI（`irogen`）Host 入口
- `app/`：Tauri 后端（Rust）
- `shared/`：共享网络/协议层（Rust）
- `src/`：SolidJS 前端（聊天、会话、权限、工具）
- `browser/`：WebAssembly 客户端

## 快速开始

### 环境要求

- Rust stable
- Node.js 20+
- pnpm 10+

### 安装依赖

```bash
pnpm install
```

### 本地开发

```bash
# 前端
pnpm dev

# 桌面端（Tauri）
pnpm tauri:dev

# CLI host
cargo run -p cli -- host
```

### 构建

```bash
# Rust workspace
cargo build --workspace

# 前端
pnpm build

# 桌面端
pnpm tauri:build

# CLI release 二进制
cargo build -p cli --release
```

## CLI

当前 CLI 入口：

```bash
cargo run -p cli -- host
```

`--daemon` 仅在 Unix-like 系统支持。

## 会话模式

- `local`：在本机运行并控制 Agent
- `remote`：通过连接会话控制远端 Agent 会话

## 发布

通过版本 tag 触发自动发布：

```bash
git tag v0.5.0
git push origin v0.5.0
```

工作流：`.github/workflows/publish-to-auto-release.yml`

- App 打包使用官方 `tauri-apps/tauri-action`
- CLI 产物按 `irogen_cli-*` 命名发布

## 文档

- 英文 README：`README.md`
- 开发指南：`DEVELOPMENT.md`
- 会话管理：`docs/SESSION_MANAGEMENT.md`
- 聊天/终端交互说明：`docs/TERMINAL_SESSIONS.md`
