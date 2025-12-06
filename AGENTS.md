# AGENTS
1. Primary build: `pnpm build` (frontend), `pnpm tauri build` (app), `cargo build --workspace` (Rust crates).
2. Dev servers: `pnpm dev` (frontend), `pnpm tauri dev` (desktop), `pnpm tauri android dev` / `pnpm tauri ios dev` (mobile).
3. Tests: `cargo test --workspace`; single test example `cargo test -p cli some_test_name` (or `cargo test -p shared path::mod::test`).
4. Lint/format Rust: `cargo fmt` then `cargo clippy --workspace --all-targets --all-features`.
5. TS build/typecheck: `pnpm tsc` (runs tsc then Vite build); `pnpm preview` to serve built assets.
6. Browser crate: `cd browser && wasm-pack build --target web` (add `--release` for prod).
7. Prefer pnpm (packageManager=pnpm@10.0.0); avoid npm/yarn lockfiles.
8. Rust style: use `anyhow` for errors, `?` propagation, meaningful error context with `with_context`.
9. Imports: group std → third-party → workspace crates → local mods; keep unused imports out.
10. Types: favor explicit struct/enum fields over tuples; avoid `.unwrap()`/`.expect()` except in tests; handle `Option/Result` explicitly.
11. Logging: use `tracing` macros with structured fields; avoid println for prod paths.
12. Concurrency: prefer `tokio::spawn` with joined error handling; ensure send/sync types across tasks.
13. Naming: snake_case for Rust items; PascalCase for types/structs/enums; camelCase for TS variables/functions.
14. TS/JS style: favor `const`/`let`, avoid `any`, use explicit types for props/store state.
15. React/Solid components: keep hooks at top level; derive state from signals/stores; avoid side effects in render.
16. CSS: tailwind/daisy styles co-locate with components; keep custom CSS in `src/styles`.
17. Mobile UI: ensure keyboard-safe layouts use `ViewportManager`/`KeyboardAwareContainer`; respect safe-area insets.
18. File scope: apply these rules repo-wide; create nested AGENTS.md for stricter areas if needed.
19. No Cursor or Copilot rules present; follow this file as the canonical agent guide.
20. Keep changes minimal and aligned with existing patterns; prefer incremental, documented adjustments.
