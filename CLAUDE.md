# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ClawdPilot** is a multi-agent local/remote management platform built with Rust (CLI/backend), SolidJS (frontend), and Tauri 2 (desktop/mobile). It provides unified session management for running and controlling multiple AI agents (Claude, Codex, Gemini, OpenCode, OpenClaw) across local and remote modes.

## Repository Structure

- `cli/`: `clawdpilot` host CLI, ticket/QR output, daemon mode
- `shared/`: core QUIC transport, protocol, event bus, and agent runtime abstraction
- `app/`: Tauri command layer and session orchestration between frontend and `shared`
- `src/`: SolidJS desktop/mobile UI stores and chat/session components
- `web/`: separate TanStack Start + Cloudflare Workers app (own pnpm workspace)
- `browser/`: wasm client crate

## Architecture

### Transport and control plane

- CLI host runs `QuicMessageServer` (`shared/src/quic_server.rs`) and prints connection ticket/QR (`cli/src/main.rs`).
- App initializes `QuicMessageClientHandle` via Tauri commands (`app/src/lib.rs`) and connects using ticket-derived `EndpointAddr` (relay + direct addresses).
- `QuicMessageClientHandle` includes health monitoring and reconnect signaling; app emits `connection-state-changed` and `peer-disconnected` events.

### Unified wire protocol

- All cross-node messages are in `shared/src/message_protocol.rs` (`MessagePayload`).
- Main payload families: `AgentSession`, `AgentMessage`, `AgentPermission`, `AgentControl`, `RemoteSpawn`, `TcpForwarding`/`TcpData`, `FileBrowser`, `GitStatus`, `SystemControl`, `Notification`, `SlashCommand`.
- Serialization is bincode-based; several nested payload fields use JSON strings for compatibility.

### Event routing

- `EventManager` (`shared/src/event_manager.rs`) converts incoming protocol messages into typed events and dispatches to listeners.
- In app layer, `AppEventListener` bridges backend events to frontend Tauri events.
- In frontend, `sessionEventRouter` (`src/stores/sessionEventRouter.ts`) keeps one global listener per event type and routes by `sessionId`.

### Agent runtime model

- `AgentManager` (`shared/src/agent/mod.rs`) manages sessions keyed by session ID.
- `SessionKind` has two backends: ACP subprocesses (`AcpStreamingSession`) and OpenClaw WebSocket gateway (`OpenClawWsSession`).
- Permission handling is centralized in shared agent modules and exposed to UI through protocol events + approve/deny commands.

### Frontend state model

- `sessionStore` (`src/stores/sessionStore.ts`): session metadata, active session, connection lifecycle, new-session modal state.
- `chatStore` (`src/stores/chatStore.ts`): per-session messages, tool-call state, pending permissions/questions, attachments.
- `App.tsx` wires Tauri events (session created, connection state, disconnect) into stores.

### Desktop/mobile split

- `app/Cargo.toml` uses cfg-gated dependencies: desktop builds include full local-agent stack; mobile builds keep a lighter dependency set and mobile plugins.
- `shared/src/lib.rs` gates agent module exports behind `std` feature.

## Development Commands

**Prerequisites:** Rust stable, Node.js 20+, pnpm 10+.

```bash
# Frontend
pnpm install               # Install dependencies
pnpm dev                   # Vite dev server (localhost:1420)
pnpm build                 # Production build
pnpm tsc                   # TypeScript check

# Tauri Desktop/Mobile
pnpm tauri:dev             # Desktop app with hot reload
pnpm tauri:build           # Build desktop app
pnpm tauri:android:dev     # Android dev build (macOS)
pnpm tauri:ios:dev         # iOS dev build (macOS only)

# CLI
cargo run -p cli -- host   # Run CLI host (prints QR code/ticket)
cargo run -p cli -- host --daemon  # Background mode (Unix only)
cargo build -p cli --release

# Testing
cargo test --workspace                           # All Rust tests
cargo test -p shared message_protocol            # Run tests matching a module/name
cargo test -p shared test_agent_manager_creation # Run a single Rust test by name
cargo test -- --nocapture                        # Show stdout/stderr
./test_ticket_output.sh                          # CLI ticket verification

# Linting & Formatting
cargo fmt --all
cargo clippy --workspace -- -D warnings
pnpm exec prettier --write "src/**/*.{ts,tsx}"
```

**Pre-commit check:** `cargo fmt --all && cargo clippy --workspace -- -D warnings && pnpm tsc`

### Web App (Cloudflare Workers)

```bash
cd web && pnpm install
cd web && pnpm dev         # Dev server on port 3000
cd web && pnpm test        # Run web Vitest suite
cd web && pnpm lint        # Run web ESLint
cd web && pnpm build       # Production build
cd web && pnpm deploy      # Deploy to Cloudflare
```

## Coding Conventions

Detailed frontend conventions are in `AGENTS.md`.

### Rust (Edition 2024)
- Use `anyhow::Result<T>` with `.with_context(|| "...")?` for error context
- Avoid `.unwrap()`/`.expect()` in non-test code
- Use `tokio` with `Arc<RwLock<T>>` or `Arc<Mutex<T>>`; prefer `std::sync::Mutex` for hot-path fields
- Use `tracing` macros (`info!`, `debug!`, `error!`, `warn!`) - no `println!` in production

### TypeScript / SolidJS
- Strict mode; no implicit/explicit `any`
- Define explicit interfaces for component props
- Use `~` alias for src imports (e.g., `~/components/ui/Button`)
- Three-section component structure: `// Types`, `// Variant Classes`, `// Component`

### Web workspace notes (`web/.cursorrules`)
- Prefer functional components
- Use TanStack Router for routing and type-safe `createContext` patterns
- Keep strict TypeScript checks and proper event handler typing
- Use Tailwind utility classes with `@apply`/`@layer` only for shared styles

### Mobile vs Desktop (Tauri)

The `app/Cargo.toml` configures different dependencies:
- **Desktop** (`cfg(not(any(target_os = "android", target_os = "ios")))`): Full agent support with ACP, portable-pty, shell plugin
- **Mobile** (`cfg(any(target_os = "android", target_os = "ios"))`): Lightweight build excludes heavy agent dependencies, uses barcode-scanner plugin

## Agent Permissions

`PermissionHandler` (`shared/src/agent/permission_handler.rs`) manages automatic approval based on `PermissionMode`:
- `AlwaysAsk`, `AcceptEdits`, `Plan`, `AutoApprove`

Frontend uses Tauri commands `approve_permission`/`deny_permission`, updates via `chatStore` and `PermissionCard`.

## Adding a New Agent

1. Add to `AgentType` enum in `shared/src/message_protocol.rs`
2. Configure launch in `shared/src/agent/factory.rs`
3. Add session handling in `shared/src/agent/mod.rs` (`start_session_with_id`)
4. For ACP agents: create parser in `shared/src/agent/` (e.g., `gemini.rs`)
5. Expose commands in `app/src/lib.rs`
6. Update `sessionStore.ts` and UI

## Release Process

Releases are triggered by version tags:

```bash
git tag v0.3.7
git push origin v0.3.7
```

Workflow (`.github/workflows/publish-to-auto-release.yml`):
- Tauri app packaging via `tauri-apps/tauri-action`
- CLI artifacts published as `clawdpilot_cli-*`

Android release builds require GitHub secrets: `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_BASE64`.
