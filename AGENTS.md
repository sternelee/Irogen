# AGENTS.md - AI Coding Agent Guide for riterm

> **riterm** is a P2P Terminal Session Sharing app built with Rust (CLI/backend), SolidJS (frontend), and Tauri 2 (desktop/mobile).

## Build & Test Commands

### Core Build

| Task              | Command                                      |
| :---------------- | :------------------------------------------- |
| Install deps      | `pnpm install`                               |
| Frontend Dev      | `pnpm dev` (Vite)                            |
| Frontend Build    | `pnpm build`                                 |
| Type Check        | `pnpm tsc`                                   |
| **Desktop Dev**   | `pnpm tauri dev`                             |
| **Desktop Build** | `pnpm tauri build`                           |
| **Android Dev**   | `pnpm tauri:android:dev`                     |
| **iOS Dev**       | `pnpm tauri:ios:dev`                         |
| CLI Build         | `cargo build -p cli`                         |
| WASM Build        | `cd browser && wasm-pack build --target web` |

### Testing

```bash
# Rust Tests
cargo test --workspace                     # Run all tests
cargo test -p cli <test_name>              # Single test (CLI)
cargo test -p riterm-shared <test_name>    # Single test (Shared)
cargo test -p app <test_name>              # Single test (App)
cargo test -- --nocapture                  # Show stdout
./test_ticket_output.sh                    # Test CLI ticket generation

# Linting & Formatting
cargo fmt --all -- --check                 # Verify formatting
cargo clippy --workspace -- -D warnings    # Lint (Strict)
pnpm lint                                  # Frontend lint
```

## Rust Code Style (Edition 2024)

### Core Principles

- **Error Handling**: Use `anyhow::Result` with `?`. Contextualize errors: `.with_context(|| format!("..."))?`. Avoid `.unwrap()`.
- **Async**: Use `tokio`. Ensure types crossing await points are `Send`. Use `tokio::select!` for concurrency.
- **Logging**: Use `tracing`. `info!` for events, `debug!` for data. No `println!`.
- **Shared State**: Use `Arc<Mutex<T>>` or `Arc<RwLock<T>>`.

### Imports Order

1. `std` / `core`
2. External crates (`anyhow`, `tokio`, `tracing`)
3. Workspace crates (`riterm_shared`)
4. `crate::` (local modules)

### Naming

- **Variables/Functions**: `snake_case`
- **Types/Structs**: `PascalCase`
- **Constants**: `SCREAMING_SNAKE_CASE`

## TypeScript & SolidJS Code Style

### General

- **Strict Mode**: No `any`. Use explicit interfaces.
- **SolidJS**: Reactive primitives over React patterns.
- **Mobile First**: Use `ViewportManager` and `AdaptiveLayoutManager` for responsive logic.

### Component Pattern

```tsx
import { createSignal, onMount, Show } from "solid-js";
import { useViewport } from "~/hooks/useViewport";

interface Props {
  title: string;
}

export function MyComponent(props: Props) {
  const [active, setActive] = createSignal(false);

  // Use semantic styling (Tailwind + DaisyUI)
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

- **Stack**: Tailwind CSS v4 + DaisyUI v5.
- **Themes**: Support light/dark/system via `ThemeSwitcher`.
- **Classes**: Use utility classes. Avoid `@apply`.

## Project Architecture

| Directory  | Language | Description                                 |
| :--------- | :------- | :------------------------------------------ |
| `cli/`     | Rust     | Host server, PTY handling, shell detection. |
| `shared/`  | Rust     | QUIC server, message protocol, crypto.      |
| `app/`     | Rust     | Tauri 2 backend, session management.        |
| `browser/` | Rust     | WASM client (no TCP forwarding).            |
| `src/`     | TSX      | SolidJS frontend, ghostty-web terminal.     |

### Key Protocols

- **Networking**: `iroh` (P2P + NAT traversal).
- **Encryption**: `chacha20poly1305` (End-to-end).
- **Messages**: `MessagePayload` enum in `shared`. Use `bincode` for serialization.

### Session Lifecycle

1. **App**: Sends `CreateSession` -> **CLI**: Responds `{session_id}`.
2. **App**: Starts `start_session_listener`.
3. **P2P**: Local client connects -> App opens QUIC stream.
4. **Data**: Bidirectional forwarding (App <-> CLI <-> PTY).
