# Repository Guidelines

## Project Structure

- `cli/` - Rust CLI binary (`irogen`), host command and terminal handling
- `app/` - Tauri backend (Rust) for desktop/mobile app with agent session management
- `shared/` - Rust networking and protocol library (iroh QUIC) shared by CLI/app
- `src/` - SolidJS frontend (Vite + TailwindCSS v4 + DaisyUI + Kobalte primitives)
- `web/` - Cloudflare Workers SSR frontend (TanStack Start + SolidJS)
- `browser/` - WebAssembly browser client
- `plugins/` - Vite/Tauri build helpers

## Build Commands

### Prerequisites

Rust stable, Node.js 20+, pnpm 10+.

### Frontend (SolidJS/Tauri)

```bash
pnpm install          # Install dependencies
pnpm dev              # Run SolidJS dev server (Vite, port 1420)
pnpm tauri:dev        # Run Tauri desktop app in dev mode
pnpm build            # Build frontend only
pnpm tauri:build      # Build desktop app
pnpm tauri:android:dev|build   # Android (macOS)
pnpm tauri:ios:dev|build       # iOS (macOS)
```

### Web (Cloudflare Workers)

```bash
cd web && pnpm install
cd web && pnpm dev          # Dev server on port 3000
cd web && pnpm build         # Build for production
cd web && pnpm deploy        # Deploy to Cloudflare
```

### Rust

```bash
cargo build --workspace              # Build all crates
cargo build -p cli --release         # Build CLI release binary
cargo run -p cli -- host             # Run CLI host
cargo run -p cli -- host --daemon    # Run CLI in background (Unix)
```

## Test Commands

### Rust

```bash
cargo test --workspace                           # All tests
cargo test -p <crate> <test_name>                # Single crate test (e.g., cargo test -p shared message_protocol)
cargo test -- --nocapture                        # Show print output
./test_ticket_output.sh                          # CLI ticket output verification
```

### Frontend

```bash
cd web && pnpm test                              # Vitest tests
```

## Lint & Format

### Rust

```bash
cargo fmt --all                          # Format all code
cargo fmt --all -- --check               # Check formatting
cargo clippy --workspace -- -D warnings  # Lint with warnings as errors
```

### Frontend (web/)

```bash
cd web && pnpm lint                      # ESLint
cd web && pnpm format                     # Prettier check
cd web && pnpm check                      # Prettier write + ESLint fix
pnpm tsc                                  # TypeScript check
```

## Code Style Guidelines

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

- Prefer `anyhow::Result<T>` for application code
- Add context: `.with_context(|| "description")`
- Avoid `.unwrap()` / `.expect()` outside tests
- Use `thiserror` for library error types

**Logging:**

- Use `tracing` with structured logging
- No `println!` in production paths
- Use `tracing::info!`, `.warn!`, `.error!` etc.

**Async:**

- Use `tokio` runtime with `#[tokio::main]`
- Prefer async traits from `async_trait`

**Other:**

- Resolve clippy warnings with `-D warnings`
- Run `cargo fmt` before committing

### TypeScript/SolidJS

**Naming:**

- `camelCase` for variables and functions
- `PascalCase` for components and types
- Use descriptive names, avoid abbreviations

**Imports:**

- Use `~` alias for src directory: `~/components/...`
- Order: SolidJS imports → external libraries → local

**Types:**

- Strict TypeScript mode (no `implicit any`)
- Define prop interfaces explicitly
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

### Styling (TailwindCSS v4 + DaisyUI)

- Utility-first CSS; use Tailwind classes directly in components
- Use `@apply` in CSS files (`/src/index.css`) with `@layer` directives
- Use `cn()` utility from `~/lib/utils` for conditional class merging
- Responsive design with mobile-first approach
- Dark mode via DaisyUI themes with `[data-theme]` attribute
- Default themes: `sunset` (light), `dark` (prefers-color-scheme)

### Web-specific (web/.cursorrules)

- TanStack Router for routing
- TanStack Query for data fetching
- Cloudflare Workers SSR with `@tanstack/solid-start`
- Tailwind's `@layer` directive for custom styles

## Commit Guidelines

- Follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:` with optional scope
- Example: `feat(ui): add new button component`
- PRs: include summary, testing performed, and screenshots for UI changes

## Security

- Never commit secrets (e.g., `clawdchat_secret_key`, `.riterm_client_key`)
- Use environment variables for sensitive configuration
- Regenerate keys if compromised

## Architecture Notes

- CLI host uses iroh QUIC for P2P connections with relay support
- Message protocol: `shared/src/message_protocol.rs`
- Agent management: `shared/src/agent.rs` with `AgentFactory`
- Frontend uses `sessionStore` pattern for multi-session management
- Permission modes: AlwaysAsk, AcceptEdits, Plan, AutoApprove
