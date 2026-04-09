# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Irogen** is a multi-agent local/remote management platform built with Rust (CLI/backend), SolidJS (frontend), and Tauri 2 (desktop/mobile). It provides unified session management for running and controlling multiple AI agents (Claude, Codex, Gemini, OpenCode, OpenClaw) across local and remote modes.

## Quick Reference

```bash
# Dev workflow
pnpm tauri:dev              # Desktop app with hot reload
cargo run -p cli -- host    # CLI host (prints QR code/ticket)

# Build
pnpm tauri:build            # Desktop app
cargo build -p cli --release # CLI binary

# Test
cargo test --workspace
pnpm tsc                    # Frontend TypeScript check
```

## Repository Structure

- `cli/`: `irogen` host CLI, ticket/QR output, daemon mode
- `shared/`: core QUIC transport (iroh), protocol, event bus, and agent runtime abstraction
- `app/`: Tauri command layer and session orchestration between frontend and `shared`
- `src/`: SolidJS desktop/mobile UI stores and chat/session components
- `web/`: separate TanStack Start + Cloudflare Workers app (own pnpm workspace)
- `browser/`: WebAssembly client crate for browser-based connections
- `plugins/`: Vite/Tauri build helpers

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
# Frontend (SolidJS/Tauri)
pnpm install               # Install dependencies
pnpm dev                   # Vite dev server (localhost:1420)
pnpm build                 # Production build
pnpm tsc                   # TypeScript check

# Tauri Desktop/Mobile
pnpm tauri:dev             # Desktop app with hot reload
pnpm tauri:build           # Build desktop app
pnpm tauri:android:dev     # Android dev build (macOS)
pnpm tauri:android:build   # Android release build
pnpm tauri:ios:dev         # iOS dev build (macOS only)
pnpm tauri:ios:build       # iOS release build (macOS only)

# CLI
cargo run -p cli -- host   # Run CLI host (prints QR code/ticket)
cargo run -p cli -- host --daemon  # Background mode (Unix only)
cargo build -p cli --release

# Testing
cargo test --workspace                           # All Rust tests
cargo test -p <crate> <test_name>                # Run specific test (e.g., cargo test -p shared message_protocol)
cargo test -p <crate> --test <test_file>         # Run specific test file (e.g., cargo test -p shared --test integration)
cargo test -- --nocapture                        # Show stdout/stderr
./test_ticket_output.sh                          # CLI ticket verification

# Frontend tests (web workspace)
cd web && pnpm test                              # Vitest tests

# Linting & Formatting
cargo fmt --all
cargo clippy --workspace -- -D warnings
pnpm exec prettier --write "src/**/*.{ts,tsx}"
```

**Pre-commit check:** `cargo fmt --all && cargo clippy --workspace -- -D warnings && pnpm tsc`

## Web Workspace (Separate App)

The `web/` directory is a **separate TanStack Start + Cloudflare Workers application** with its own pnpm workspace. It has different conventions:

```bash
cd web && pnpm install
cd web && pnpm dev         # Dev server on port 3000
cd web && pnpm test        # Run Vitest suite
cd web && pnpm lint        # Run ESLint
cd web && pnpm build       # Production build
cd web && pnpm deploy      # Deploy to Cloudflare
```

**Web-specific conventions** (`web/.cursorrules`):
- TanStack Router for routing
- TanStack Query for data fetching
- Type-safe `createContext` patterns
- Tailwind's `@layer` directive for custom styles

## Coding Conventions

Detailed frontend conventions are in `AGENTS.md`.

### Rust (Edition 2024)

**Naming:**
- `snake_case` for variables and functions
- `PascalCase` for types and enums
- `SCREAMING_SNAKE_CASE` for constants

**Imports (in order):**
1. External crates (`use anyhow::Result;`)
2. Standard library (`use std::collections::HashMap;`)
3. Local modules (`use crate::shared::foo;`)

**Error Handling:**
- Use `anyhow::Result<T>` with `.with_context(|| "...")?` for error context
- Avoid `.unwrap()`/`.expect()` in non-test code
- Use `thiserror` for library error types

**Logging:**
- Use `tracing` macros (`info!`, `debug!`, `error!`, `warn!`) - no `println!` in production
- Use structured logging with fields: `info!(session_id = %id, "message")`

**Async:**
- Use `tokio` with `Arc<RwLock<T>>` or `Arc<Mutex<T>>`; prefer `std::sync::Mutex` for hot-path fields
- Prefer async traits from `async_trait`

**Other:**
- Resolve clippy warnings with `-D warnings`
- Run `cargo fmt` before committing

### TypeScript / SolidJS

**Naming:**
- `camelCase` for variables and functions
- `PascalCase` for components and types
- Use descriptive names, avoid abbreviations

**Imports:**
- Use `~` alias for src imports (e.g., `~/components/ui/Button`)
- Order: SolidJS imports → external libraries → local

**Types:**
- Strict mode; no implicit/explicit `any`
- Define explicit interfaces for component props
- Use `Component<T>` type for functional components
- Avoid type assertions; prefer proper typing

**Components:**
- Functional components with `createSignal()` for reactive state
- Use `.tsx` extension for JSX files
- Proper typing for event handlers (`KeyboardEvent`, `MouseEvent`, etc.)
- Use `onCleanup()` for cleanup
- Use `createContext` for type-safe context

**File Structure:**
```tsx
// ============================================================================
// Types
// ============================================================================
export interface CardProps {
  /* ... */
}

// ============================================================================
// Variant Classes
// ============================================================================
const variantClasses = {
  /* ... */
};

// ============================================================================
// Component
// ============================================================================
export const Card: Component<CardProps> = (props) => {
  /* ... */
};
```

**Styling (TailwindCSS v4 + DaisyUI):**
- Utility-first CSS; use Tailwind classes directly in components
- Use `@apply` in CSS files (`/src/index.css`) with `@layer` directives
- Use `cn()` utility from `~/lib/utils` for conditional class merging
- Responsive design with mobile-first approach
- Dark mode via DaisyUI themes with `[data-theme]` attribute
- Default themes: `sunset` (light), `dark` (prefers-color-scheme)

### Mobile vs Desktop (Tauri)

The `app/Cargo.toml` configures different dependencies:
- **Desktop** (`cfg(not(any(target_os = "android", target_os = "ios")))`): Full agent support with ACP, portable-pty, shell plugin
- **Mobile** (`cfg(any(target_os = "android", target_os = "ios"))`): Lightweight build excludes heavy agent dependencies, uses barcode-scanner plugin

## Agent Permissions

`PermissionHandler` (`shared/src/agent/permission_handler.rs`) manages automatic approval based on `PermissionMode`:
- `AlwaysAsk`, `AcceptEdits`, `Plan`, `AutoApprove`

Frontend uses Tauri commands `approve_permission`/`deny_permission`, updates via `chatStore` and `PermissionCard`.

## Commit Guidelines

- Follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:` with optional scope
- Examples: `feat(ui): add new button component`, `fix(agent): handle codex exit code`
- Include scope for cross-platform changes: `(ios)`, `(android)`, `(desktop)`, `(cli)`, `(shared)`

## Adding a New Agent

1. Add to `AgentType` enum in `shared/src/message_protocol.rs`
2. Configure launch in `shared/src/agent/factory.rs` (add binary detection and command building)
3. Add session handling in `shared/src/agent/mod.rs` (`start_session_with_id`)
4. For ACP agents: create parser in `shared/src/agent/` (e.g., `claude.rs`, `codex.rs`, `gemini.rs`)
   - Implement output parsing for agent-specific streaming formats
   - Handle tool calls, permissions, and thinking blocks
5. Expose commands in `app/src/lib.rs`
6. Update `sessionStore.ts` and UI components

## Release Process

Releases are triggered by version tags:

```bash
git tag v0.3.7
git push origin v0.3.7
```

Workflow (`.github/workflows/publish-to-auto-release.yml`):
- Tauri app packaging via `tauri-apps/tauri-action`
- CLI artifacts published as `irogen_cli-*`

### Android Release

Requires GitHub secrets: `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_BASE64`.

Generate `ANDROID_KEY_BASE64` locally:
```bash
keytool -list -v -keystore your.jks
base64 -i upload-keystore.jks | tr -d '\n'
```

### iOS Release (macOS only)

iOS builds require Xcode and valid Apple Developer credentials. Configure signing in Xcode after running:
```bash
pnpm tauri:ios:build
```
