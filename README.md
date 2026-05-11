# Irogen

[English](./README.md) | [中文](./README_cn.md)

A multi-agent local/remote management platform.

Irogen provides a unified session management experience for running and controlling multiple AI agents (Claude, Codex, Gemini, OpenCode, Cline, Pi, Qwen Code) across local and remote modes via P2P connections (iroh QUIC).

## Core Capabilities

- **Parallel Agents Workspace**: Multiple agent sessions in one workspace
- **Cross-Project Threads**: One agent can work across multiple project paths simultaneously
- **P2P Remote Control**: Connect and control remote agent sessions securely
- **Multi-Platform**: Desktop (macOS/Windows/Linux via Tauri), Mobile (Android/iOS)
- **Permission Workflows**: `AlwaysAsk`, `AcceptEdits`, `Plan`, `AutoApprove`
- **CLI Host**: Lightweight binary for hosting agent sessions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript |
| UI Framework | TailwindCSS v4, Radix UI |
| Routing | @tanstack/react-router |
| State / Data | React Context, @tanstack/react-query |
| Icons | Lucide React |
| Code Highlighting | Shiki |
| Desktop Shell | Tauri v2 (Rust) |
| Protocol | iroh QUIC (P2P with relay) |
| Encryption | ChaCha20Poly1305 |

Frontend architecture follows patterns from [HAPI](https://github.com/nicepkg/hapi) (`hapi-main/web`), adapted for Irogen's P2P session management use case.

## Repository Layout

- `cli/` — Rust CLI binary (`irogen`), host command and terminal handling
- `app/` — Tauri backend (Rust) for desktop/mobile app with agent session management
- `shared/` — Rust networking and protocol library (iroh QUIC) shared by CLI and app
- `src/` — React 19 frontend (Vite + TailwindCSS + @tanstack/react-router)
- `plugins/` — Vite/Tauri build helpers
- `browser/` — WebAssembly browser client
- `web/` — **Separate** Cloudflare Workers SSR app (TanStack Start)

### Frontend Structure (`src/`)

```
src/
├── App.tsx                  # App shell with providers and Tauri event wiring
├── main.tsx                 # React entry point
├── index.css                # CSS variable theming (light + dark)
├── router.tsx               # @tanstack/react-router route definitions
├── types/api.ts             # Shared TypeScript types
├── lib/                     # Core utilities and contexts
│   ├── app-context.tsx      # Tauri invoke/listen context
│   ├── session-store.tsx    # Session state management (React Context)
│   ├── toast-context.tsx    # Toast notification system
│   ├── query-client.ts      # React Query client
│   ├── query-keys.ts        # Query key factory
│   └── utils.ts             # cn() utility (clsx + tailwind-merge)
├── hooks/                   # React hooks
│   ├── useTauriEvents.ts    # Tauri event listeners
│   └── useTranslation.ts    # i18n hook
├── components/              # Reusable UI components
│   ├── SessionList.tsx      # Grouped session list with agent icons
│   ├── ToastContainer.tsx   # Toast overlay
│   └── ui/                  # Design primitives
│       ├── button.tsx       # Button with cva variants
│       ├── dialog.tsx       # Radix UI dialog
│       ├── card.tsx         # Card layout
│       ├── badge.tsx        # Status badges
│       └── Spinner.tsx      # Loading spinner
└── routes/                  # Page components
    ├── sessions/            # Session views
    │   ├── index.tsx        # Session list sidebar + outlet
    │   ├── session.tsx      # Session detail/chat
    │   └── new.tsx          # New session creation
    └── settings/            # Settings page
        └── index.tsx
```

## Quick Start

### Prerequisites

- Rust stable
- Node.js 20+
- pnpm 10+

### Install

```bash
pnpm install
```

### Install CLI

The CLI runs on your computer to host remote sessions. Install via:

```bash
# Quick install (macOS/Linux)
curl -fsSL https://raw.githubusercontent.com/sternelee/Irogen/main/install.sh | sh

# Or manually download from GitHub Releases
```

### Development

```bash
# Frontend (Vite dev server, port 1420)
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

# iOS app (完整流程)
./scripts/ios-deploy.sh

# iOS app (分步构建)
# - 查看详细指南: docs/iOS_BUILD_AND_INSTALL.md
# - 快速参考: docs/iOS_QUICK_START.md

# CLI release binary
cargo build -p cli --release
```

### Verification

```bash
cargo fmt --all
cargo clippy --workspace -- -D warnings
pnpm tsc           # TypeScript check
```

## CLI

Current CLI entry:

```bash
cargo run -p cli -- host
```

`--daemon` is supported on Unix-like systems only.

## Session Modes

- `local`: run and control agent on the local machine
- `remote`: control remote agent sessions via P2P connection sessions

## Routes

| Path | Component |
|------|-----------|
| `/` | Redirect to `/sessions` |
| `/sessions` | Session list sidebar + content outlet |
| `/sessions/$sessionId` | Session detail / chat interface |
| `/sessions/new` | Create new session |
| `/settings` | Application settings |

## Release

Releases are triggered by version tags:

```bash
git tag v0.5.0
git push origin v0.5.0
```

Workflow: `.github/workflows/publish-to-auto-release.yml`

- App packaging via official `tauri-apps/tauri-action`
- CLI artifacts published as `irogen_cli-*`

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
- iOS build/install guide: `docs/iOS_BUILD_AND_INSTALL.md`
- iOS quick start: `docs/iOS_QUICK_START.md`
