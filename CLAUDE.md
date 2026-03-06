# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ClawdPilot** (directory: `riterm`) is a multi-agent local/remote management platform built with Rust (CLI/backend), SolidJS (frontend), and Tauri 2 (desktop/mobile). It provides unified session management for running and controlling multiple AI agents (Claude, Codex, Gemini, OpenCode, OpenClaw) across local and remote modes.

## Project Naming

- **Product**: ClawdPilot
- **CLI crate**: `cli` (binary name: `cli`, command: `clawdpilot`)
- **Tauri app crate**: `app` (lib name: `clawdpilot`)
- **Directory**: `riterm` (repository root)
- **Frontend**: SolidJS (not React)

## Architecture

### Cargo Workspace Structure

| Crate | Purpose |
|-------|---------|
| **cli/** | CLI binary — `clawdpilot host` subcommand only |
| **shared/** | P2P networking, message protocol, QUIC server, event manager, agent protocols |
| **app/** | Tauri 2 desktop+mobile backend — Tauri commands, P2P client, TCP forwarding |
| **browser/** | WebAssembly browser client |

### Session Storage

Persistent session storage uses SQLite:
- **Location**: `~/.riterm/sessions.db` (macOS/Linux)
- **Module**: `shared/src/session_store/sqlite.rs`
- **Schema**: Auto-migrated via `rusqlite_migration`

### Data Directories

| Path | Purpose |
|------|---------|
| `~/.riterm/sessions.db` | Session persistence (SQLite) |
| `~/.riterm/messages/` | Message sync storage (JSONL files for reconnection) |
| `~/.config/clawdpilot/agents.json` | Agent command overrides |
| `./clawdchat_secret_key` | CLI P2P secret key (in working directory) |
| `./logs/clawdpilot-cli.log` | CLI logs (in working directory) |

### Agent Configuration

Override agent commands/args/env in `~/.config/clawdpilot/agents.json` (or `~/.clawdpilot/agents.json`):

```json
{
  "agents": {
    "claude": { "command": "claude-agent-acp", "args": [], "env": {} },
    "codex": { "command": "codex-acp", "args": [], "env": {} },
    "gemini": { "command": "gemini", "args": ["--stdio"], "env": { "GEMINI_API_KEY": "..." } }
  }
}
```

### Frontend Structure

| Directory | Purpose |
|-----------|---------|
| **src/** | SolidJS frontend (Vite + vite-plugin-solid + TailwindCSS v4 + DaisyUI) |
| **src/stores/** | State management (sessionStore, chatStore, settingsStore, deviceStore, fileBrowserStore, gitStore, notificationStore, sessionEventRouter) |
| **src/components/ui/** | Reusable UI primitives (Accordion, Avatar, Card, Dropdown, Tabs, Toast, Tooltip, MessageList, ChatInput, PermissionCard, etc.) |
| **src/components/** | UI components (ChatView, SessionSidebar, NewSessionModal, FileBrowserView, GitDiffView, SettingsModal, etc.) |
| **src/hooks/** | Custom SolidJS hooks |
| **src/utils/** | Utility functions |
| **plugins/** | Custom Vite plugins (e.g., `fix-cjs-modules.ts` for solid-markdown) |

### Message Flow

```
Frontend (ChatView.tsx) → Tauri invoke → P2P (QUIC/iroh) → CLI Host
  → AgentManager → SessionKind → AI agent subprocess
  → AgentTurnEvent broadcast → Tauri event ("agent-message") → Frontend
```

### Multi-Session Event Routing

The `sessionEventRouter.ts` provides centralized event management for concurrent sessions:
- Single global listener per event type (not per ChatView instance)
- Routes events to correct session handlers by sessionId
- Tracks streaming state and unread indicators per session
- Active session is exempt from unread notifications

### Message Protocol (`shared/src/message_protocol.rs`)

Central `Message` struct with `MessageType` discriminator:
- `AgentSession` - AI agent session management
- `AgentMessage` - User <-> AI messages
- `AgentPermission` - Permission requests/responses
- `AgentControl` - Control messages (interrupt, shutdown)
- `AgentMetadata` - State updates
- `MessageSync` - Reconnection message sync (stores/replays missed messages)
- `FileBrowser`, `GitStatus`, `RemoteSpawn`, `Notification`, `SlashCommand`, etc.

Serialized with bincode. `MessageHandler` trait for extensible dispatch.

### Agent Session Protocols

The `shared/src/agent/` module manages AI agent subprocesses via two session protocols:

- **`SessionKind::Acp`** (`acp.rs`) — External agents via Agent Client Protocol (ACP)
- **`SessionKind::OpenClawWs`** (`openclaw_ws.rs`) — OpenClaw agent using WebSocket Gateway

`AgentManager` routes to the correct protocol based on `AgentType`. Both implement a common interface: `send_message`, `interrupt`, `subscribe`, `get_pending_permissions`, `respond_to_permission`, `shutdown`.

### Message Sync (Reconnection Support)

The `shared/src/message_sync.rs` and `shared/src/message_store.rs` modules handle message persistence for reconnection:

- **MessageStore**: JSONL-based storage at `~/.riterm/messages/<session_id>.jsonl`
- **MessageSyncService**: Persists outgoing messages with sequence numbers, replays missed messages on reconnect

Flow: CLI Host persists messages before sending → App tracks last received sequence → On reconnect, App sends sync request with last sequence → CLI returns missed messages.

## Supported AI Agents

| Agent | AgentType enum | Protocol | Default Command |
|-------|---------------|----------|-----------------|
| Claude Agent | `ClaudeCode` | ACP | `claude-agent-acp` |
| OpenCode | `OpenCode` | ACP | `opencode` |
| OpenAI Codex | `Codex` | ACP | `codex-acp` |
| Gemini CLI | `Gemini` | ACP | `gemini` |
| OpenClaw | `OpenClaw` | WebSocket Gateway | `openclaw gateway` |

## Development Commands

### Frontend Development

```bash
# Install dependencies
pnpm install

# Frontend dev server (Vite, localhost:1420)
pnpm dev

# Full Tauri app with hot reload
pnpm tauri:dev

# Build frontend → dist/
pnpm build

# Build Tauri app bundle
pnpm tauri:build

# TypeScript type checking
pnpm tsc
```

### Rust Development

```bash
# Build CLI binary (release)
cargo build -p cli --release
# Output: target/release/cli

# Run CLI
./target/release/cli host

# The host server prints a QR code and connection ticket for mobile app to scan
# Logs to: ./logs/clawdpilot-cli.log
# Secret key stored at: ./clawdchat_secret_key (in CLI directory)
# Default bind address: 0.0.0.0:61103

# Rust checks
cargo check
cargo test --workspace
cargo fmt --all
cargo clippy --workspace -- -D warnings

# Test a single crate
cargo test -p cli
cargo test -p shared
cargo test -p app

# Run tests with output
cargo test --workspace -- --nocapture
```

### Mobile Development

Mobile builds use the `mobile` feature on the `shared` crate to exclude desktop-only agent dependencies (agent-client-protocol, portable-pty, etc.).

```bash
# Android development
pnpm tauri:android:dev

# Android build
pnpm tauri:android:build

# iOS development (macOS only)
pnpm tauri:ios:dev

# iOS build (macOS only)
pnpm tauri:ios:build
```

### WASM Development

```bash
# Build browser WASM client
cd browser && wasm-pack build --target web
```

## Key Crate Dependencies

- **iroh** 0.95 + **iroh-tickets** — P2P with QUIC and NAT traversal
- **agent-client-protocol** 0.9.4 — ACP for external agents
- **tauri** 2 — cross-platform desktop/mobile
- **bincode** — network serialization
- **chacha20poly1305** — E2E encryption

## Crate Patch Note

`Cargo.toml` patches `tokio-tungstenite` and `tungstenite` with OpenAI forks (used by WebSocket gateway support).

## Frontend Development Patterns

### SolidJS Patterns

- Use Solid reactive primitives (`createSignal`, `createMemo`, `createResource`)
- Avoid React patterns like `useEffect` or prop drilling where stores are better
- Path alias: `~` → `./src/` (configured in `vite.config.ts` and `tsconfig.json`)

### Example Component Pattern

```tsx
import { createSignal, Show } from "solid-js";

interface Props {
  title: string;
}

export function MyComponent(props: Props) {
  const [active, setActive] = createSignal(false);

  return (
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <h2 class="card-title">{props.title}</h2>
        <Show when={active()}>
          <div class="badge badge-primary">Active</div>
        </Show>
      </div>
    </div>
  );
}
```

### Vite Custom Plugin

The project uses a custom `fix-cjs-modules` plugin in `plugins/fix-cjs-modules.ts` to handle CJS dependencies from `solid-markdown`. This plugin ensures proper module resolution during the build process.

### Styling

- Tailwind CSS v4 via `@tailwindcss/vite` plugin (see `vite.config.ts`)
- Base configuration in `tailwind.config.js` for DaisyUI integration
- Prefer utility classes; avoid `@apply`
- Use the existing font stacks

## Rust Code Style (Edition 2024)

### Error Handling

- Use `anyhow::Result<T>` for fallible APIs and `?` for propagation
- Add context with `.with_context(|| format!("..."))?` when errors need explanation
- Avoid `.unwrap()` and `.expect()` in non-test code

### Async and Concurrency

- Use `tokio` for async and `tokio::select!` for multi-branch concurrency
- Ensure types crossing await points are `Send`

### Logging

- Use `tracing` (`info!` for events, `debug!` for structured data)
- Do not use `println!` in production paths

### Shared State

- Use `Arc<Mutex<T>>` or `Arc<RwLock<T>>` for shared mutable state
- Prefer coarse-grained locking with clear ownership boundaries

### Imports Order

1. `std` / `core`
2. External crates (`anyhow`, `tokio`, `tracing`)
3. Workspace crates (`shared`, `clawdchat_*`)
4. `crate::` (local modules)

### Naming

- Variables/Functions: `snake_case`
- Types/Structs/Enums: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE`

## TypeScript Style

- Strict mode is enabled in `tsconfig.json` (no `any`)
- Prefer explicit interfaces/types for public component props
- Avoid unused locals/parameters (compiler enforces this)

## Adding a New Agent

1. Add variant to `AgentType` in `shared/src/message_protocol.rs`
2. Add session creation logic in `shared/src/agent/mod.rs` (`AgentManager::start_session_with_id`)
3. Add factory entry in `shared/src/agent/factory.rs`
4. If ACP: implement output parser in `shared/src/agent/` (see `opencode.rs`, `gemini.rs` for patterns)
5. Add Tauri command handling in `app/src/lib.rs`
6. Update frontend stores (`sessionStore.ts`) and `ChatView.tsx`

## Adding a Slash Command

Slash commands in the CLI are routed via `cli/src/command_router.rs`. Built-in commands are defined in `CLAWDCHAT_BUILTIN_COMMANDS` and agent-specific commands in agent-specific constants.

1. Add to appropriate command list in `cli/src/command_router.rs`
2. If builtin: implement handler in `cli/src/message_server.rs`
3. Otherwise: passthrough to the agent

## Testing

### Rust Tests

```bash
# Run all tests
cargo test --workspace

# Single test (CLI)
cargo test -p cli <test_name>

# Single test (Shared)
cargo test -p shared <test_name>

# Single test (App)
cargo test -p app <test_name>

# Show stdout
cargo test -- --nocapture
```

### CLI-specific Testing

```bash
# Test CLI ticket generation and P2P connection flow
cargo test -p cli -- --nocapture
```

### Message Sync Testing

```bash
# Test MessageStore (JSONL persistence)
cargo test -p shared message_store

# Test MessageSyncService (reconnection sync)
cargo test -p shared message_sync
```

## Linting & Formatting

```bash
# Rust formatting and lint
cargo fmt --all -- --check  # Verify formatting
cargo clippy --workspace -- -D warnings  # Lint (strict)

# Frontend type check
pnpm tsc

# Frontend formatting (optional)
pnpm exec prettier --write "src/**/*.{ts,tsx}"
```

## Debugging

### CLI Debugging

```bash
# Debug build
cargo build -p cli

# Run with logging
RUST_LOG=debug ./target/debug/cli host

# Use temporary key (no persistence)
./target/release/cli host --temp-key

# Daemon mode (run in background after printing QR)
./target/release/cli host --daemon
```

### App Debugging

```bash
# Development mode with detailed logs
RUST_LOG=debug pnpm tauri:dev

# Check app logs
# Windows: %APPDATA%\ClawdPilot\logs\
# macOS: ~/Library/Logs/ClawdPilot/
# Linux: ~/.local/share/ClawdPilot/logs/

# iOS debugging (macOS only)
idevicesyslog | grep ClawdPilot
```

## Session Lifecycle

1. App sends `CreateSession` -> CLI responds `{session_id}`
2. App starts `start_session_listener`
3. P2P client connects -> App opens QUIC stream
4. Data is forwarded bidirectionally (App <-> CLI <-> PTY)

## Key Files

| File | Purpose |
|------|---------|
| `shared/src/message_protocol.rs` | Central message protocol definition |
| `shared/src/message_sync.rs` | Reconnection message sync service |
| `shared/src/message_store.rs` | JSONL message persistence for reconnection |
| `shared/src/agent/mod.rs` | AgentManager routing logic and SessionKind enum |
| `shared/src/agent/factory.rs` | Agent session factory |
| `shared/src/agent/acp.rs` | ACP session implementation |
| `shared/src/agent/openclaw_ws.rs` | OpenClaw WebSocket session |
| `cli/src/command_router.rs` | Slash command routing |
| `cli/src/message_server.rs` | Message handling |
| `cli/src/main.rs` | CLI entry point (host subcommand) |
| `app/src/lib.rs` | Tauri commands and P2P client |
| `src/components/ChatView.tsx` | Main chat interface |
| `src/components/ui/ChatInput.tsx` | Chat input with tool buttons and file attachment |
| `src/stores/sessionStore.ts` | Session state management |
| `src/stores/chatStore.ts` | Messages and permissions |
| `src/stores/fileBrowserStore.ts` | File browser state |
| `src/stores/gitStore.ts` | Git status and diff state |
| `src/stores/sessionEventRouter.ts` | Multi-session event routing and unread tracking |

## Package Manager

**pnpm v10+** (lockfileVersion 9.0 in `pnpm-lock.yaml`)

## Notes

- Cursor rules exist at `web/.cursorrules` for SolidJS + Tailwind CSS patterns
- No `.github/copilot-instructions.md` present in this repo
- The project uses a comprehensive CI/CD pipeline for multi-platform builds
