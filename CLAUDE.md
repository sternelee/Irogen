# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Irogen** is a multi-agent local/remote management platform built from:
- Rust workspace crates for transport, agent runtime, CLI host, and Tauri backend
- SolidJS + Vite frontend in `src/` for the desktop/mobile app UI
- Tauri 2 for desktop and mobile packaging
- A separate `web/` app built with TanStack Start + Cloudflare Workers

The product centers on managing AI agent sessions (Claude, Codex, Gemini, OpenCode, Cline, Pi, Qwen Code) in both **local** and **remote** modes, with permission workflows and structured chat/tool-call UI.

## Prerequisites

- Rust stable
- Node.js 20+
- pnpm 10+

## Common Commands

### Root app / desktop-mobile UI

```bash
pnpm install
pnpm dev                    # Vite dev server (frontend only)
pnpm build                  # Build frontend assets
pnpm tsc                    # TypeScript check for src/
pnpm tauri:dev              # Run Tauri desktop app with hot reload
pnpm tauri:build            # Build desktop app
pnpm tauri:android:dev      # Android dev build (macOS)
pnpm tauri:android:build    # Android release build (macOS)
pnpm tauri:ios:dev          # iOS dev build (macOS)
pnpm tauri:ios:build        # iOS release build (macOS)
pnpm preview                # Preview production frontend build locally
```

### Rust workspace

```bash
cargo build --workspace
cargo build -p cli --release
cargo run -p cli -- host
cargo run -p cli -- host --daemon    # Unix-like systems only
cargo run -p cli -- stop             # Stop a running daemon (Unix-like)
cargo test --workspace
cargo test -p <crate> <test_name>          # Example: cargo test -p shared message_protocol
cargo test -p <crate> --test <test_file>   # Example: cargo test -p shared --test integration
cargo test -p <crate> --lib                # Run only library unit tests
cargo test -- --nocapture
cargo fmt --all
cargo clippy --workspace -- -D warnings
```

`browser/` is a WASM crate; running its tests may require the `wasm32-unknown-unknown` target or `wasm-pack`.

### Repository-specific helpers

```bash
./test_ticket_output.sh      # Verifies CLI ticket output format
./scripts/ios-deploy.sh      # Full iOS build/install helper
```

iOS build/install docs live in:
- `docs/iOS_BUILD_AND_INSTALL.md`
- `docs/iOS_QUICK_START.md`

### Separate web workspace (`web/`)

```bash
cd web && pnpm install
cd web && pnpm dev
cd web && pnpm build
cd web && pnpm start             # Start production server from built output
cd web && pnpm test
cd web && pnpm lint
cd web && pnpm format            # Run Prettier check
cd web && pnpm check             # Auto-format and fix ESLint issues
cd web && pnpm deploy
```

### Useful validation pass before finishing changes

```bash
cargo fmt --all && cargo clippy --workspace -- -D warnings && pnpm tsc
```

### Common debug points

- Session switching / history: `src/components/SessionSidebar.tsx`
- Message rendering / scroll: `src/components/ChatView.tsx`
- Dropdown overlays: `src/components/ui/Dropdown.tsx`
- Permission flow: `src/components/ui/PermissionCard.tsx` + backend permission handlers

## Repository Structure

- `cli/`: Rust host binary that starts the remote-control server and prints the connection ticket / QR code
- `shared/`: Core transport, protocol, event routing, permission handling, and agent runtime abstractions
- `app/`: Tauri command layer that owns app-side connection/session state and bridges backend events to the frontend
- `src/`: SolidJS frontend for session list, chat, permissions, tool calls, and connection UX
- `browser/`: WASM client crate for browser-based connectivity
- `web/`: separate TanStack Start + Cloudflare Workers app with its own tooling and conventions
- `plugins/`: Vite build helpers (e.g. `fix-cjs-modules.ts`)

## Big-Picture Architecture

### 1. Transport and connection flow

- `cli/src/main.rs` starts the host server, sets up logging, and prints a connection ticket plus QR code.
- `cli/src/message_server.rs` is the CLI-side control plane for remote actions, agent session spawning, and message handling.
- `shared/src/quic_server.rs` contains both `QuicMessageServer` and `QuicMessageClientHandle`, which are the core Iroh QUIC transport primitives used by CLI and app.
- `app/src/lib.rs` parses tickets, creates the app-side QUIC client, and owns active connection sessions.
- `browser/src/lib.rs` is the WASM entry point for browser-based clients that connect via the same QUIC transport.

### 2. Unified wire protocol

- `shared/src/message_protocol.rs` is the canonical cross-node protocol definition.
- All major app/CLI interactions flow through `MessagePayload` families such as:
  - `AgentSession`
  - `AgentMessage`
  - `AgentPermission`
  - `AgentControl`
  - `AgentMetadata`
  - `RemoteSpawn`
  - `TcpForwarding` / `TcpData`
  - `FileBrowser`
  - `GitStatus`
  - `SystemControl`
  - `Notification`
  - `SlashCommand`
- Serialization is primarily bincode-based, with some nested JSON payloads for compatibility.
- `MESSAGE_PROTOCOL_VERSION` and `MESSAGE_SCHEMA_FINGERPRINT` are important when debugging cross-version mismatches.

### 3. Event routing model

- `shared/src/event_manager.rs` converts protocol messages into typed events and dispatches them to listeners.
- `app/src/lib.rs` implements the app-side listener that converts shared events into Tauri emissions for the frontend.
- On the frontend, `src/stores/sessionEventRouter.ts` centralizes event subscriptions and demultiplexes updates by `sessionId` so views do not each attach their own global listeners.

### 4. Agent runtime model

- `shared/src/agent/mod.rs` defines `AgentManager`, the central registry for agent sessions.
- `SessionKind` uses ACP subprocess-backed sessions.
- Permission handling is centralized in:
  - `shared/src/agent/permission_handler.rs`
  - `shared/src/agent/acp_permission.rs`
- If you add a new agent type, the integration path spans protocol, factory, runtime management, backend exposure, and frontend session/UI handling.

### 5. Frontend state and navigation model

- `src/stores/sessionStore.ts` owns session metadata, connected hosts, active session, connection lifecycle, and new-session modal state.
- `src/stores/chatStore.ts` owns per-session messages, tool-call state, pending permission requests, user questions, attachments, slash commands, and custom prompts.
- `src/stores/navigationStore.ts` drives view switching in the root app. The frontend does **not** use a URL router; views (`home`, `sessions`, `devices`, `settings`, `chat`, etc.) are rendered conditionally based on navigation store state.
- `src/components/ChatView.tsx` and `src/components/Dashboard.tsx` consume `sessionEventRouter` state rather than talking directly to backend events.
- `docs/SESSION_MANAGEMENT.md` explains the intended local-vs-remote session model and sidebar behavior.

### 6. Desktop vs mobile build split

- `app/Cargo.toml` uses cfg-gated dependencies:
  - desktop builds include the full local-agent stack
  - mobile builds use lighter dependencies and mobile plugins such as barcode scanning
- `shared/Cargo.toml` mirrors this with `std` vs `mobile` feature sets.
- Keep this split in mind before adding new dependencies to shared runtime code.

### 7. Separate web app

- `web/` is not part of the root frontend/Tauri flow.
- It is a distinct TanStack Start + Cloudflare Workers application with its own `package.json`, scripts, and conventions.
- `web/.cursorrules` highlights the important expectations there:
  - TanStack Router
  - TanStack Query
  - type-safe `createContext` usage
  - Tailwind `@layer` for custom styles

## Project-Specific Conventions and Notes

- Root frontend code uses SolidJS with TailwindCSS v4 and DaisyUI.
- Use the `~` alias for imports from `src/`.
- Permission modes exposed across the product are: `AlwaysAsk`, `AcceptEdits`, `Plan`, `AutoApprove`.
- The app supports both `local` and `remote` session modes; do not assume a session is always tied to a live remote control connection.
- `browser/` is a real workspace crate, not just generated output; changes there affect browser-based clients.
- i18n in the root frontend uses `@solid-primitives/i18n`. Dictionaries and locale state live in `src/stores/i18nStore.ts` (supported locales: `en`, `zh-CN`).

## Dependency notes

The workspace `Cargo.toml` patches `agent-client-protocol-schema` to handle nullable `used` fields in UsageUpdate.

## When adding a new agent integration

Follow this path:
1. Add the agent type to `shared/src/message_protocol.rs`
2. Configure process/binary detection and launch in `shared/src/agent/factory.rs`
3. Wire session startup in `shared/src/agent/mod.rs`
4. Add parser/runtime handling under `shared/src/agent/` for the agent's streaming format and permissions
5. Expose backend commands/events in `app/src/lib.rs`
6. Update frontend session/UI handling in `src/stores/` and relevant components

## Release Notes

Releases are tag-driven:

```bash
git tag v0.x.y
git push origin v0.x.y
```

The publishing workflow is `.github/workflows/publish-to-auto-release.yml`.
