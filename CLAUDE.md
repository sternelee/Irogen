# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ClawdPilot** (directory: `riterm`) is a multi-agent local/remote management platform built with Rust (CLI/backend), SolidJS (frontend), and Tauri 2 (desktop/mobile). It provides unified session management for running and controlling multiple AI agents (Claude, Codex, Gemini, OpenCode, OpenClaw) across local and remote modes.

## Project Architecture & Structure

The repository is structured as a Cargo workspace containing the backend services and a pnpm workspace for the frontend applications.

### Cargo Workspace (Backend)

- **`cli/`** (Edition 2024): The `clawdpilot` CLI binary. Provides the `host` subcommand to start a P2P server that accepts remote connections from the Tauri app to manage agents.
- **`app/`** (Edition 2024): The Tauri 2 backend crate. Exposes commands to the frontend, manages the P2P QUIC client, handles TCP port forwarding, and runs local agents.
- **`shared/`** (Edition 2024): The core library. Contains the P2P networking layer (iroh/QUIC), unified message protocol (`message_protocol.rs`), event management system (`event_manager.rs`), and agent process management (ACP/OpenClaw).
- **`browser/`** (Edition 2021): WebAssembly client for browser integration.

### Frontend Apps

- **`src/`**: The main SolidJS frontend application, built with Vite and Tailwind CSS v4. Used by the Tauri desktop/mobile app.
- **`web/`**: A separate Cloudflare Workers web application with its own pnpm workspace (not part of the Cargo workspace).

## Communication & Event Flow

### P2P Networking (iroh QUIC)

Remote agent management relies on the `iroh` crate for P2P QUIC connections with NAT traversal.
- The `cli host` acts as the server (`shared/src/quic_server.rs`).
- The `app` acts as the client (`shared/src/quic_client.rs`).
- Connections use tickets (base64 encoded node ID, relay URL, and ALPN).
- Auto-reconnect with exponential backoff is implemented for mobile stability (`QuicMessageClientHandle`).

### Message Protocol

The system uses a unified, bincode-serialized message protocol (`shared/src/message_protocol.rs`). Key message types:
- `AgentSession`: Start/stop sessions.
- `AgentMessage`: Text and tool messages between user and AI.
- `AgentPermission`: Requests and responses for tool executions.
- `AgentControl`: Interrupting or modifying agent behavior.
- `TcpForwarding` / `TcpData`: Port forwarding between host and client.

### Event Manager

The `EventManager` (`shared/src/event_manager.rs`) provides a unified event bus for system and connection events.
- `MessageToEventConverter` translates specific network messages (like TCP forwarding events) into internal events.
- Components implement `EventListener` to handle specific event types asynchronously.

### Agent Session Management

`AgentManager` (`shared/src/agent/mod.rs`) wraps AI subprocesses and exposes a unified interface (`SessionKind`):
- **ACP (`acp.rs`)**: External agent execution via the Agent Client Protocol (Claude, Codex, Gemini, OpenCode).
- **OpenClaw (`openclaw_ws.rs`)**: Connects to the OpenClaw WebSocket Gateway.

## Frontend Architecture (SolidJS)

The frontend uses SolidJS reactivity (`createSignal`, `createStore`) and avoids React patterns (`useEffect`).

### Key Stores
- `sessionStore.ts`: Manages available agent sessions, connection state, and connection tickets.
- `chatStore.ts`: Manages message history, tool calls, and pending permission requests per session.
- `sessionEventRouter.ts`: Centralizes Tauri event listeners (`"agent-message"`, `"local-agent-event"`) and routes them to specific session components to prevent memory leaks in a multi-session environment. Tracks streaming state and unread messages.

### Styling
- Tailwind CSS v4 is configured via `@tailwindcss/vite`.
- Uses `@kobalte/core` for headless, accessible UI components.
- HSL CSS variables define the design system tokens (`--primary`, `--background`, etc.) in `tailwind.config.js`.

## Development Commands

**Prerequisites:** Rust stable, Node.js 20+, pnpm 10+.

### Frontend Development
```bash
pnpm install              # Install dependencies
pnpm dev                  # Start frontend dev server (Vite, localhost:1420)
pnpm build                # Build frontend for production
pnpm tsc                  # Run TypeScript type checking
```

### Desktop/Mobile Development (Tauri)
```bash
pnpm tauri:dev            # Run Tauri desktop app with hot reload
pnpm tauri:build          # Build Tauri desktop app bundle
pnpm tauri:android:dev    # Run Android development build
pnpm tauri:ios:dev        # Run iOS development build (macOS only)
```

### CLI Development
```bash
cargo run -p cli -- host  # Run the CLI host (prints a QR code/ticket for connection)
cargo build -p cli --release # Build CLI for release
```

### Testing & Linting
```bash
cargo test --workspace    # Run all Rust tests
cargo test -p shared acp  # Run specific tests (e.g., the acp module in shared)
cargo clippy --workspace -- -D warnings # Strict Rust linting
cargo fmt --all           # Format Rust code
pnpm exec prettier --write "src/**/*.{ts,tsx}" # Format frontend code
```

## Coding Conventions

### Rust (Edition 2024)
- Use `anyhow::Result<T>` for fallible operations. Propagate errors with `?` and add context using `.with_context(|| format!("..."))?`.
- Avoid `.unwrap()` and `.expect()` in non-test code.
- Concurrency: Use `tokio` and prefer `Arc<RwLock<T>>` or `Arc<Mutex<T>>`. For frequently accessed hot-path fields, use `std::sync::Mutex` over `tokio::sync::Mutex` to minimize async overhead.
- Logging: Use `tracing` (`info!`, `debug!`, `error!`, `warn!`). Do not use `println!` in production code.

### TypeScript / SolidJS
- Enable strict mode; avoid implicit or explicit `any`.
- Define explicit interfaces for component props.
- Use the `~` alias for imports from the `src` directory (e.g., `~/components/ui/Button`).

## Agent Permissions

Permissions are handled through the `PermissionHandler` (`shared/src/agent/permission_handler.rs`).
- Automatic approval rules apply based on the session's `PermissionMode` (`AlwaysAsk`, `AcceptEdits`, `Plan`, `AutoApprove`).
- Frontend interacts via Tauri commands (`approve_permission`, `deny_permission`) and updates the UI through the `chatStore` and `PermissionCard` components.

## Adding a New Agent

1. Add the agent to the `AgentType` enum in `shared/src/message_protocol.rs`.
2. Configure launch details in `shared/src/agent/factory.rs`.
3. Add session creation handling in `shared/src/agent/mod.rs` (`start_session_with_id`).
4. If it's an ACP agent, create a parser in `shared/src/agent/` (e.g., `gemini.rs` or `opencode.rs`).
5. Expose necessary commands in `app/src/lib.rs`.
6. Update the frontend `sessionStore.ts` and UI to allow starting the new agent.
