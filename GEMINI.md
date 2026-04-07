# ClawdPilot Project Context

ClawdPilot is a multi-agent local/remote management platform that provides a unified session management experience for controlling multiple AI agents (Claude, Codex, Gemini, OpenCode, OpenClaw) across local and remote environments.

## Project Overview

- **Architecture:** Tauri (Rust backend) + SolidJS (frontend).
- **ACP Alignment:** All external agents are treated as ACP-compatible processes (Zed-style external agents).
- **Core Components:**
    - `app/`: Tauri desktop and mobile application backend.
    - `cli/`: Rust CLI entry point, used for hosting remote agent sessions.
    - `shared/`: Shared networking, session store, and agent management library. Uses `iroh` for P2P/networking and a custom unified message protocol.
    - `src/`: Main frontend UI implemented with SolidJS, Vite, and Tailwind CSS.
    - `web/`: Web-based interface implemented with SolidStart, TanStack Router/Query, and Better-Auth, deployable to Cloudflare Workers.
    - `browser/`: WebAssembly client for browser-based interactions.
- **Tech Stack:**
    - **Backend:** Rust, Tauri v2, Tokio, Iroh, Serde, Clap.
    - **Frontend:** SolidJS, Vite, Tailwind CSS v4, DaisyUI v5, Kobalte UI primitives.
    - **Web:** SolidStart, TanStack Router, TanStack Query, Better-Auth, Wrangler.
    - **Protocol:** Custom binary protocol (bincode-serialized) supporting agent sessions, TCP forwarding, file browsing, and Git operations.

## Key Features

- **Unified Multi-Agent Workspace:** Run and control multiple AI agents in one place.
- **ACP Feature Integration:**
    - **Context Mentions:** Search and link files using `@path` suggestions.
    - **Structured System Cards:** Dedicated UI for Following, Edit reviews, TODO lists, and Terminal sessions.
    - **Slash Commands & Prompts:** Customizable slash commands (`/review`, `/init`, etc.) and session-specific prompts.
    - **MCP Support:** Integration with Client MCP servers for extended agent capabilities.
- **Local & Remote Sessions:** Manage lifecycle for local agents or control remote sessions via a secure connection.
- **Permission Workflows:** Granular control with modes like `AlwaysAsk`, `AcceptEdits`, `Plan`, and `AutoApprove`.
- **Structured UI:** Dedicated views for chat, tool calls, approvals, file browsing, and system events.

## Development Guide

### Prerequisites
- **Rust stable**
- **Node.js 20+**
- **pnpm 10+**

### Building and Running

| Command | Description |
|---------|-------------|
| `pnpm install` | Install frontend and project dependencies |
| `pnpm dev` | Start the main frontend development server |
| `pnpm tauri:dev` | Launch the Tauri desktop application in development mode |
| `cargo run -p cli -- host` | Run the CLI host for remote sessions |
| `cd web && pnpm dev` | Start the web-based SolidStart development server |
| `pnpm build` | Build the production frontend |
| `cargo build --workspace` | Build all Rust crates in the workspace |
| `pnpm tauri:build` | Build the production Tauri application |
| `cargo test --workspace` | Run all Rust tests |
| `pnpm tsc` | Run TypeScript/SolidJS type checking |

### Code Style and Linting
- **Rust:** Follow standard Rust conventions. Use `cargo fmt --all` and `cargo clippy --workspace -- -D warnings`.
- **Frontend:** Use Prettier for formatting. The project uses Tailwind CSS v4 and DaisyUI v5 for styling.

## Repository Structure

```text
.
├── app/          # Tauri backend (Rust)
├── cli/          # CLI host entry (Rust)
├── shared/       # Shared protocol, session store, and agent management (Rust)
├── src/          # Main SolidJS frontend source code
│   ├── components/ # UI components (Chat, Sidebar, etc.)
│   ├── stores/     # State management (Solid stores)
│   └── utils/      # Frontend utilities
├── web/          # SolidStart web application (Cloudflare Workers)
├── browser/      # WASM client
├── docs/         # Project documentation (ACP, Session Management, etc.)
└── Cargo.toml    # Workspace configuration
```

## Important Files
- `shared/src/message_protocol.rs`: Defines the unified communication protocol between components.
- `shared/src/agent/mod.rs`: Unified agent management (ACP-compatible processes).
- `app/src/lib.rs`: Tauri application logic and command handlers.
- `app/tauri.conf.json`: Tauri application configuration.
- `package.json`: Main frontend dependencies and scripts.
- `DEVELOPMENT.md`: Detailed developer instructions.
- `docs/ACP_FEATURE_PROGRESS.md`: Status of ACP feature integration.
- `docs/SESSION_MANAGEMENT.md`: Detailed session model documentation.
