# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ClawdChat** (directory: `riterm`) is a P2P terminal session sharing tool built with Rust (CLI/backend), SolidJS (frontend), and Tauri 2 (desktop/mobile). It enables real-time collaboration on terminal sessions with automatic history logging and secure P2P networking using iroh.

## Project Naming

- **Binary**: `clawdchat` (Rust CLI binary in `cli/`)
- **Directory**: `riterm` (repository root)
- **Frontend**: SolidJS (not React)

## Architecture

### Cargo Workspace Structure

| Crate | Purpose |
|-------|---------|
| **cli/** | CLI binary — `clawdchat run`, `clawdchat host`, `clawdchat connect`, `clawdchat runner` subcommands |
| **shared/** | P2P networking, message protocol, QUIC server, event manager |
| **app/** | Tauri 2 desktop+mobile backend — Tauri commands, P2P client, TCP forwarding |
| **browser/** | WebAssembly browser client |
| **zeroclaw/** | Runtime and tool system for AI agent orchestration |

### Session Storage

Persistent session storage uses SQLite:
- **Location**: `~/.riterm/sessions.db` (macOS/Linux)
- **Module**: `shared/src/session_store/sqlite.rs`
- **Schema**: Auto-migrated via `rusqlite_migration`

### Frontend Structure

| Directory | Purpose |
|-----------|---------|
| **src/** | SolidJS frontend (Vite + vite-plugin-solid + TailwindCSS v4 + DaisyUI) |
| **src/stores/** | State management (sessionStore, chatStore, settingsStore) |
| **src/components/** | UI components (ChatView, SessionSidebar, NewSessionModal, etc.) |
| **src/hooks/** | Custom SolidJS hooks |
| **src/utils/** | Utility functions |

### Message Flow

```
Frontend (ChatView.tsx) → Tauri invoke → P2P (QUIC/iroh) → CLI Host
  → AgentManager → SessionKind → AI agent subprocess
  → AgentTurnEvent broadcast → Tauri event ("agent-message") → Frontend
```

### Message Protocol (`shared/src/message_protocol.rs`)

Central `Message` struct with `MessageType` discriminator:
- `AgentSession` - AI agent session management
- `AgentMessage` - User <-> AI messages
- `AgentPermission` - Permission requests/responses
- `AgentControl` - Control messages (interrupt, shutdown)
- `AgentMetadata` - State updates
- `TerminalManagement`, `TerminalIO`, `TcpForwarding`, etc.

Serialized with bincode. `MessageHandler` trait for extensible dispatch.

### Agent Session Protocols

The `shared/src/agent/` module manages AI agent subprocesses via three session protocols:

- **`SessionKind::Sdk`** (`claude_sdk.rs`) — Claude Code uses SDK Control Protocol directly
- **`SessionKind::Acp`** (`acp.rs`) — OpenCode, Gemini, Copilot, Qwen use Agent Client Protocol (ACP)
- **`SessionKind::CodexAcp`** (`codex_acp.rs`) — Codex uses codex-core in-process via ACP
- **`SessionKind::ZeroClaw`** (`zeroclaw_session.rs`) — ZeroClaw agent using in-process runtime

`AgentManager` routes to the correct protocol based on `AgentType`. All three implement a common interface: `send_message`, `interrupt`, `subscribe`, `get_pending_permissions`, `respond_to_permission`, `shutdown`.

## Supported AI Agents

| Agent | AgentType enum | Protocol | Command |
|-------|---------------|----------|---------|
| Claude Code | `ClaudeCode` | SDK | `claude` |
| OpenCode | `OpenCode` | ACP | `opencode` |
| Gemini CLI | `Gemini` | ACP | `gemini` |
| GitHub Copilot | `Copilot` | ACP | `gh copilot` |
| Qwen Code | `Qwen` | ACP | `qwen` |
| OpenAI Codex | `Codex` | CodexACP | `codex` (in-process via codex-core) |

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
# Output: cli/target/release/clawdchat

# Run CLI subcommands
./cli/target/release/clawdchat run --agent claude --project .
./cli/target/release/clawdchat host
./cli/target/release/clawdchat connect --ticket <ticket>

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
- **agent-client-protocol** 0.9.4 — ACP for non-Claude agents
- **codex-core** (git, zed-industries/codex acp branch) — in-process Codex
- **tauri** 2 — cross-platform desktop/mobile
- **bincode** — network serialization
- **chacha20poly1305** — E2E encryption

## Crate Patch Note

`Cargo.toml` patches `tokio-tungstenite` and `tungstenite` with OpenAI forks (required by codex-core).

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

### Styling

- Tailwind CSS v4 is configured in `tailwind.config.js`
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

1. Add to `cli/src/command_router.rs` (builtin or passthrough)
2. If builtin: implement handler in `cli/src/message_server.rs`

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

### CLI-specific Test Helper

```bash
./test_ticket_output.sh  # Test CLI ticket generation
```

## Linting & Formatting

```bash
# Rust formatting and lint
cargo fmt --all -- --check  # Verify formatting
cargo clippy --workspace -- -D warnings  # Lint (strict)

# Frontend formatting
pnpm tsc  # TypeScript type check
```

## Debugging

### CLI Debugging

```bash
# Debug build
cargo build -p cli

# Run with logging
RUST_LOG=debug ./cli/target/debug/clawdchat host

# Check system info
./cli/target/debug/clawdchat system-info
```

### App Debugging

```bash
# Development mode with detailed logs
RUST_LOG=debug pnpm tauri:dev

# Check app logs
# Windows: %APPDATA%\ClawdChat\logs\
# macOS: ~/Library/Logs/ClawdChat/
# Linux: ~/.local/share/ClawdChat/logs/

# iOS debugging (macOS only)
idevicesyslog | grep ClawdChat
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
| `shared/src/agent/mod.rs` | AgentManager routing logic |
| `shared/src/agent/factory.rs` | Agent session factory |
| `cli/src/command_router.rs` | Slash command routing |
| `cli/src/message_server.rs` | Message handling |
| `app/src/lib.rs` | Tauri commands and P2P client |
| `src/components/ChatView.tsx` | Main chat interface |
| `src/stores/sessionStore.ts` | Session state management |
| `src/stores/chatStore.ts` | Messages and permissions |

## Package Manager

**pnpm@10.28.2** (specified in package.json)

## Notes

- No `.cursor/rules/` or `.cursorrules` present in this repo
- No `.github/copilot-instructions.md` present in this repo
- The project uses a comprehensive CI/CD pipeline for multi-platform builds
