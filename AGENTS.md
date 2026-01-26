# AGENTS.md - AI Coding Agent Guide for riterm

> **riterm** is a P2P Terminal Session Sharing application built with Rust (CLI/backend), 
> SolidJS (frontend), and Tauri 2 (desktop/mobile). It uses iroh for decentralized P2P 
> networking with NAT traversal and end-to-end encryption via ChaCha20-Poly1305.

---

## Project Structure

```
riterm/
├── cli/           # Rust CLI binary (host server, PTY handling)
├── shared/        # Rust shared library (QUIC server, message protocol)
├── app/           # Tauri 2 desktop/mobile app backend (Rust)
├── browser/       # WebAssembly P2P client (Rust → WASM)
├── src/           # Frontend (SolidJS/TypeScript)
│   ├── components/    # UI components (.tsx)
│   ├── stores/        # State management (signals/stores)
│   ├── hooks/         # SolidJS hooks
│   └── utils/         # Utilities including mobile helpers
└── logs/          # Runtime log files
```

---

## Build Commands

### Package Manager
- **Use pnpm** (`packageManager=pnpm@10.0.0`); avoid npm/yarn lockfiles
- Install: `pnpm install`

### Frontend (Vite + SolidJS)
```bash
pnpm dev              # Start dev server (port 1420)
pnpm build            # Production build
pnpm tsc              # TypeScript check + Vite build
pnpm preview          # Preview production build
```

### Desktop/Mobile (Tauri 2)
```bash
pnpm tauri dev                # Desktop dev mode
pnpm tauri build              # Build desktop app
pnpm tauri android dev        # Android dev mode
pnpm tauri android build      # Build Android app
pnpm tauri ios dev            # iOS dev mode
pnpm tauri ios build          # Build iOS app
```

### Rust Workspace
```bash
cargo build --workspace                              # Build all crates
cargo build -p cli                                   # Build CLI only
cargo build -p riterm-shared                         # Build shared lib
cargo build -p app                                   # Build Tauri backend
```

### WebAssembly (browser crate)
```bash
cd browser && wasm-pack build --target web           # Dev build
cd browser && wasm-pack build --target web --release # Production build
```

---

## Test Commands

### Run All Tests
```bash
cargo test --workspace
```

### Run Single Test
```bash
cargo test -p cli some_test_name              # Test in CLI crate
cargo test -p riterm-shared path::mod::test   # Test in shared crate
cargo test -p app test_name                   # Test in app crate
cargo test -p cli some_test -- --nocapture    # With output
```

---

## Lint & Format

### Rust
```bash
cargo fmt                                            # Format code
cargo clippy --workspace --all-targets --all-features  # Lint all
cargo clippy -p cli                                  # Lint specific crate
```

### TypeScript
```bash
pnpm tsc                 # Type check via tsconfig.json (strict mode)
```

---

## Rust Code Style

### Error Handling
- Use `anyhow` for error propagation with `?` operator
- Add meaningful context: `.with_context(|| "description")`
- Avoid `.unwrap()`/`.expect()` except in tests
- Handle `Option`/`Result` explicitly

```rust
// Good
let file = fs::read_to_string(path)
    .with_context(|| format!("Failed to read {}", path))?;

// Bad
let file = fs::read_to_string(path).unwrap();
```

### Imports
Group imports in order: std → third-party → workspace crates → local mods

```rust
use std::collections::HashMap;

use anyhow::Result;
use tokio::sync::mpsc;
use tracing::info;

use riterm_shared::QuicMessageServerConfig;

use crate::message_server::CliMessageServer;
```

### Types & Data
- Favor explicit struct/enum fields over tuples
- Use `#[derive(Debug, Clone, Serialize, Deserialize)]` where appropriate
- Prefer descriptive field names

### Logging
- Use `tracing` macros with structured fields
- Avoid `println!` for production paths
- Use appropriate log levels: `error!`, `warn!`, `info!`, `debug!`, `trace!`

```rust
tracing::info!(session_id = %id, "Connection established");
tracing::debug!(?config, "Server configuration loaded");
```

### Concurrency
- Prefer `tokio::spawn` with joined error handling
- Ensure Send/Sync types across async tasks
- Use `tokio::select!` for concurrent operations

### Naming Conventions
- `snake_case` for functions, variables, modules
- `PascalCase` for types, structs, enums
- `SCREAMING_SNAKE_CASE` for constants

---

## TypeScript/SolidJS Code Style

### General
- Favor `const`/`let`, never `var`
- Avoid `any` type; use explicit types
- Use TypeScript strict mode (enforced by tsconfig.json)

### SolidJS Components
- Keep hooks (`createSignal`, `createEffect`, etc.) at component top level
- Derive state from signals/stores; avoid redundant state
- Avoid side effects in render path
- Use `onMount`/`onCleanup` for lifecycle management

```tsx
function MyComponent() {
  const [value, setValue] = createSignal("");

  onMount(() => {
    // Setup
  });

  onCleanup(() => {
    // Cleanup
  });

  return <div>{value()}</div>;
}
```

### State Management
- Use stores in `src/stores/` for shared state
- Export typed interfaces for store state
- Use `createSignal` for local component state

### Naming
- `camelCase` for variables, functions, props
- `PascalCase` for components and types
- Prefix hooks with `use`: `useConnection`, `useToolbarPreferences`

---

## Styling

- Use **Tailwind CSS v4** with **DaisyUI** components
- Co-locate styles with components using Tailwind classes
- Custom CSS goes in `src/styles/`
- Available themes: dark, light, corporate, business, night, forest, dracula, luxury, synthwave

---

## Mobile Development

- Use `ViewportManager` and `KeyboardAwareContainer` for keyboard-safe layouts
- Respect safe-area insets on iOS/Android
- Test on both portrait and landscape orientations
- Mobile utilities in `src/utils/mobile/`

---

## Workspace Crates

| Crate | Edition | Description |
|-------|---------|-------------|
| `cli` | 2024 | CLI host server with PTY support |
| `riterm-shared` | 2024 | Shared QUIC server, message protocol |
| `app` | 2024 | Tauri 2 backend for desktop/mobile |
| `riterm-browser` | 2021 | WebAssembly client for browser |

---

## Key Dependencies

- **tokio 1.47**: Async runtime
- **iroh 0.95**: P2P networking with NAT traversal
- **chacha20poly1305**: End-to-end encryption
- **portable-pty**: Cross-platform PTY
- **tauri 2**: Desktop/mobile framework
- **solid-js**: Reactive UI framework
- **xterm.js**: Terminal emulator

---

## Best Practices

1. Keep changes minimal and aligned with existing patterns
2. Prefer incremental, documented adjustments
3. Run `cargo fmt && cargo clippy` before committing Rust changes
4. Run `pnpm tsc` to verify TypeScript before committing
5. Create nested AGENTS.md for subdirectories with stricter rules if needed
6. No Cursor or Copilot rules present; this file is the canonical guide
