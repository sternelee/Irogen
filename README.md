# ClawdChat

[English](./README.md) | [中文](./README_cn.md)

A multi-agent local/remote management platform.

ClawdChat provides a unified session management experience for running and controlling multiple AI agents (Claude, Codex, Gemini, OpenCode, OpenClaw) across local and remote modes.

## Core Capabilities

- Unified multi-agent workspace
- Local session lifecycle management
- Remote session control and spawning
- Permission workflows: `AlwaysAsk`, `AcceptEdits`, `Plan`, `AutoApprove`
- Structured UI for message content, tool calls, approvals, and system events
- Cross-platform app stack: Tauri desktop + mobile (Android/iOS)
- CLI host entry for local and remote connectivity

## Repository Layout

- `cli/`: Rust CLI (`clawdchat`) host entry
- `app/`: Tauri backend (Rust)
- `shared/`: Shared networking/protocol library (Rust)
- `src/`: SolidJS frontend (chat, sessions, permissions, tools)
- `browser/`: WebAssembly client

## Quick Start

### Prerequisites

- Rust stable
- Node.js 20+
- pnpm 10+

### Install

```bash
pnpm install
```

### Development

```bash
# Frontend
pnpm dev

# Desktop app (Tauri)
pnpm tauri:dev

# CLI host
cargo run -p cli -- host
```

### Build

```bash
# Rust workspace
cargo build --workspace

# Frontend
pnpm build

# Desktop app
pnpm tauri:build

# CLI release binary
cargo build -p cli --release
```

## CLI

Current CLI entry:

```bash
cargo run -p cli -- host
```

`--daemon` is supported on Unix-like systems only.

## Session Modes

- `local`: run and control agent on the local machine
- `remote`: control remote agent sessions via connection sessions

## Release

Releases are triggered by version tags:

```bash
git tag v0.5.0
git push origin v0.5.0
```

Workflow: `.github/workflows/publish-to-auto-release.yml`

- App packaging via official `tauri-apps/tauri-action`
- CLI artifacts published as `clawdchat_cli-*`

### Android Signing Secrets (GitHub Actions)

To enable Android release builds in CI, configure these repository secrets in:
`GitHub Repository -> Settings -> Secrets and variables -> Actions -> New repository secret`

- `ANDROID_KEY_ALIAS`: keystore key alias
- `ANDROID_KEY_PASSWORD`: key password (used as store password in current workflow)
- `ANDROID_KEY_BASE64`: base64-encoded `*.jks` keystore content

Generate `ANDROID_KEY_BASE64` locally:

```bash
keytool -list -v -keystore your.jks
base64 -i upload-keystore.jks | tr -d '\n'
```

## Documentation

- Chinese README: `README_cn.md`
- Development guide: `DEVELOPMENT.md`
- Session management: `docs/SESSION_MANAGEMENT.md`
- Chat/terminal interaction details: `docs/TERMINAL_SESSIONS.md`
