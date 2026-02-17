# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RiTerm** is a P2P AI agent remote management tool with a chat-centric UI. It enables remote control of AI coding agents (Claude Code, OpenCode, Gemini CLI, GitHub Copilot, Qwen Code, Codex) through a Tauri-based multi-platform application. Uses iroh's P2P networking with end-to-end encryption (ChaCha20Poly1305). Supports Chinese and English users.

## Architecture

Cargo workspace with five crates plus a SolidJS frontend:

| Crate        | Purpose                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| **cli/**     | CLI binary — `riterm run`, `riterm host`, `riterm connect`, `riterm runner` subcommands                  |
| **lib/**     | Shared Rust library — agent session management (`AgentManager`, `SessionKind`), used by both CLI and App |
| **shared/**  | P2P networking, message protocol, QUIC server, event manager                                             |
| **app/**     | Tauri 2 desktop+mobile backend — Tauri commands, P2P client, TCP forwarding                              |
| **browser/** | WebAssembly browser client                                                                               |
| **src/**     | SolidJS frontend (Vite + vite-plugin-solid + TailwindCSS v4 + DaisyUI)                                   |

### Agent Session Protocols

The `lib/src/agent/` module manages AI agent subprocesses via three session protocols, unified under the `SessionKind` enum:

- **`SessionKind::Sdk`** (`claude_sdk.rs`) — Claude Code uses SDK Control Protocol directly
- **`SessionKind::Acp`** (`acp.rs`) — OpenCode, Gemini, Copilot, Qwen use Agent Client Protocol (ACP)
- **`SessionKind::CodexAcp`** (`codex_acp.rs`) — Codex uses codex-core in-process via ACP

`AgentManager` (in `lib/src/agent/mod.rs`) routes to the correct protocol based on `AgentType`. All three implement a common interface: `send_message`, `interrupt`, `subscribe`, `get_pending_permissions`, `respond_to_permission`, `shutdown`.

### Message Flow

```
Frontend (ChatView.tsx) → Tauri invoke → P2P (QUIC/iroh) → CLI Host
  → AgentManager → SessionKind → AI agent subprocess
  → AgentTurnEvent broadcast → Tauri event ("agent-message") → Frontend
```

### Message Protocol (`shared/src/message_protocol.rs`)

Central `Message` struct with `MessageType` discriminator (AgentSession, AgentMessage, AgentControl, AgentPermission, AgentMetadata, etc.). Serialized with bincode. `MessageHandler` trait for extensible dispatch.

### Slash Command Routing (`cli/src/command_router.rs`)

**RiTerm builtins:** `/list`, `/spawn`, `/stop`, `/quit`, `/approve`, `/deny`, `/help`
**Agent passthrough:** All other `/` commands forwarded to the AI agent.

### Frontend

- **SolidJS** (not React) — fine-grained reactivity, JSX with `jsxImportSource: "solid-js"`
- **Vite** dev server on `localhost:1420`, builds to `dist/`
- Path alias: `~` → `./src/` (configured in `vite.config.ts` and `tsconfig.json`)
- Stores: `sessionStore.ts` (sessions), `chatStore.ts` (messages/permissions), `settingsStore.ts`
- Main view: `ChatView.tsx` — chat-centric agent interaction

## Development Commands

```bash
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

# Build CLI (release)
cd cli && cargo build --release

# Run CLI subcommands
./cli/target/release/cli run --agent claude --project .
./cli/target/release/cli host
./cli/target/release/cli connect --ticket <ticket>

# Rust checks
cargo check
cargo test --workspace
cargo fmt
cargo clippy

# Test a single crate
cargo test -p cli
cargo test -p lib
cargo test -p riterm-shared

# Mobile
pnpm tauri:android:dev
pnpm tauri:ios:dev
```

**Package manager:** `pnpm@10.28.2` (specified in package.json)

## Supported AI Agents

| Agent          | AgentType enum | Protocol | Command                             |
| -------------- | -------------- | -------- | ----------------------------------- |
| Claude Code    | `ClaudeCode`   | SDK      | `claude`                            |
| OpenCode       | `OpenCode`     | ACP      | `opencode`                          |
| Gemini CLI     | `Gemini`       | ACP      | `gemini`                            |
| GitHub Copilot | `Copilot`      | ACP      | `gh copilot`                        |
| Qwen Code      | `Qwen`         | ACP      | `qwen`                              |
| OpenAI Codex   | `Codex`        | CodexACP | `codex` (in-process via codex-core) |

## Adding a New Agent

1. Add variant to `AgentType` in `shared/src/message_protocol.rs`
2. Add session creation logic in `lib/src/agent/mod.rs` (`AgentManager::start_session_with_id`)
3. Add factory entry in `lib/src/agent/factory.rs`
4. If ACP: implement output parser in `lib/src/agent/` (see `opencode.rs`, `gemini.rs` for patterns)
5. Add Tauri command handling in `app/src/lib.rs`
6. Update frontend stores (`sessionStore.ts`) and `ChatView.tsx`

## Adding a Slash Command

1. Add to `cli/src/command_router.rs` (builtin or passthrough)
2. If builtin: implement handler in `cli/src/message_server.rs`

## Key Crate Dependencies

- **iroh** 0.95 + **iroh-tickets** — P2P with QUIC and NAT traversal
- **agent-client-protocol** 0.9.4 — ACP for non-Claude agents
- **codex-core** (git, zed-industries/codex acp branch) — in-process Codex
- **tauri** 2 — cross-platform desktop/mobile
- **bincode** — network serialization; **chacha20poly1305** — E2E encryption

## Crate Patch Note

`Cargo.toml` patches `tokio-tungstenite` and `tungstenite` with OpenAI forks (required by codex-core).
