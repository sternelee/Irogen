# Irogen Development Guide

面向当前版本（多 Agent 本地/远程管理平台）的开发说明。

## 项目结构

- `cli/`：Rust CLI（Host 入口）
- `app/`：Tauri Rust 后端
- `shared/`：共享协议与网络层
- `src/`：SolidJS 前端
- `.github/workflows/publish-to-auto-release.yml`：发布工作流

## 环境要求

- Rust stable
- Node.js 20+
- pnpm 10+

## iOS 开发

详见 [iOS 构建与安装指南](docs/IOS_BUILD.md)。

## 本地开发

```bash
# 安装依赖
pnpm install

# 前端调试
pnpm dev

# Tauri 桌面调试
pnpm tauri:dev

# CLI Host
cargo run -p cli -- host
```

## 构建与检查

```bash
# Rust 全量构建
cargo build --workspace

# Rust 测试
cargo test --workspace

# 格式与 lint
cargo fmt --all
cargo clippy --workspace -- -D warnings

# 前端构建 + 类型检查
pnpm build
pnpm tsc
```

## 发布

通过 tag 触发自动发布：

```bash
git tag v0.5.0
git push origin v0.5.0
```

发布工作流会执行：

- 桌面应用打包：`tauri-apps/tauri-action@v0`
- CLI 多平台构建并产出归档：`irogen_cli-*`
- 发布到同一 GitHub Release

## CLI 说明

当前 CLI 主要命令：

```bash
cargo run -p cli -- host
```

`--daemon` 仅 Unix 支持；Windows 下会返回不支持提示。

## 常见调试点

- 会话切换/历史：`src/components/SessionSidebar.tsx`
- 消息渲染/滚动：`src/components/ChatView.tsx`
- 下拉菜单浮层：`src/components/ui/Dropdown.tsx`
- 权限流：`src/components/ui/PermissionCard.tsx` + 后端 permission handlers
