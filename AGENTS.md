# Repository Guidelines

## Project Structure & Module Organization

- `cli/` Rust CLI binary (`clawdpilot`), host command and terminal handling.
- `app/` Tauri backend (Rust) for desktop/mobile app with agent session management.
- `shared/` Rust networking and protocol library (iroh QUIC) shared by CLI/app.
- `src/` SolidJS frontend (Vite + TailwindCSS v4 + DaisyUI + Kobalte primitives).
- `browser/` WebAssembly browser client.
- `plugins/` Vite/Tauri build helpers (e.g., `fix-cjs-modules.ts`).
- `public/` static assets; `docs/` design/notes if present.

## Build, Test, and Development Commands

Prereqs: Rust stable, Node.js 20+, pnpm 10+.

- `pnpm install` install frontend deps.
- `pnpm dev` run SolidJS dev server (Vite, port 1420).
- `pnpm tauri:dev` run Tauri desktop app in dev mode.
- `cargo build --workspace` build all Rust crates.
- `cargo run -p cli -- host` run CLI host in workspace.
- `cargo run -p cli -- host --daemon` run CLI in background (Unix only).
- `pnpm build` build frontend only.
- `pnpm tauri:build` build desktop app.
- `cargo build -p cli --release` build CLI release binary.
- Mobile (macOS): `pnpm tauri:android:dev|build`, `pnpm tauri:ios:dev|build`.

## Testing Guidelines

- Rust: `cargo test --workspace` for all tests.
- Single test: `cargo test -p cli|shared|app test_name` (e.g., `cargo test -p shared message_protocol`).
- Show output: `cargo test -- --nocapture`.
- CLI helper: `./test_ticket_output.sh` for ticket output verification.
- Frontend tests: `pnpm test` (if present).

## Coding Style & Naming Conventions

### Rust (Edition 2024)

- Naming: `snake_case` variables/functions, `PascalCase` types/enums, `SCREAMING_SNAKE_CASE` constants.
- Error handling: prefer `anyhow::Result<T>`, add context via `.with_context(|| "...")`, avoid `unwrap()`/`expect()` outside tests.
- Logging: use `tracing` with structured logging (no `println!` in production paths).
- Async: use `tokio` runtime with `#[tokio::main]` for async functions.
- Clippy: resolve all warnings with `-D warnings`.

### TypeScript/SolidJS

- Use `.tsx` extension for JSX files.
- Functional components with `createSignal()` for reactive state.
- Strict TypeScript mode enabled (no implicit `any`, define prop interfaces explicitly).
- Imports: use `~` alias for src directory (`~/components/...`).
- Type assertions sparingly; prefer proper typing.

### Styling (TailwindCSS v4 + DaisyUI)

- Utility-first CSS approach; avoid `@apply` directive.
- Use TailwindCSS classes directly in components.
- Use `cn()` utility from `~/lib/utils` for conditional classes.
- Responsive design with mobile-first approach.
- Dark mode via `[data-kb-theme="dark"]` variant and `.dark &`.
- Global styles in `/src/styles.css` with `@layer` directives.

### Components & Patterns

- Use Kobalte primitives for accessible UI components (`@kobalte/core`).
- TanStack Router for routing when applicable.
- Type-safe context with `createContext` from SolidJS.
- Proper typing for event handlers (e.g., `KeyboardEvent`, `MouseEvent`).
- Implement proper cleanup with `onCleanup()`.

## Lint & Format Commands

- Rust: `cargo fmt --all -- --check`, `cargo clippy --workspace -- -D warnings`.
- TypeScript: `pnpm tsc` for type checking.
- Prettier (optional): `npx prettier --write "src/**/*.{ts,tsx}"`.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:` with optional scopes (e.g., `feat(ui): ...`).
- PRs should include: concise summary, testing performed (commands + results), and UI screenshots for visual changes.
- Link related issues when applicable.

## Security & Configuration Tips

- Do not commit secrets or local keys (e.g., `clawdchat_secret_key`, `.riterm_client_key`).
- For mobile builds, ensure platform tooling is installed (Android Studio/Xcode).
- Use `clawdchat_secret_key` for node authentication; regenerate if compromised.

## Architecture Notes

- CLI host uses iroh QUIC for P2P connections with relay support.
- Message protocol defined in `shared/src/message_protocol.rs` with agent message types.
- Agent management in `shared/src/agent.rs` with AgentFactory for agent creation.
- Frontend uses session store pattern (`sessionStore`) for multi-session management.
- Permission modes: AlwaysAsk, AcceptEdits, Plan, AutoApprove for agent action control.

## Skills

A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill.

### Available skills

- agent-browser: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages. (file: /Users/sternelee/.agents/skills/agent-browser/SKILL.md)
- find-skills: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill. (file: /Users/sternelee/.agents/skills/find-skills/SKILL.md)
- skill-creator: Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends Codex's capabilities with specialized knowledge, workflows, or tool integrations. (file: /Users/sternelee/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private repos). (file: /Users/sternelee/.codex/skills/.system/skill-installer/SKILL.md)

### How to use skills

- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.
- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.
- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.
- How to use a skill (progressive disclosure):
  1. After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.
  2. When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.
  3. If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.
  4. If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.
  5. If `assets/` or templates exist, reuse them instead of recreating from scratch.
- Coordination and sequencing:
  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.
  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.
- Context hygiene:
  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.
  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.
  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.
- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.
