# ACP Feature Integration Progress

Last updated: 2026-03-18

## Scope

Target: align ClawdPilot with `@zed-industries/claude-agent-acp` style capabilities across:

- local app mode (Tauri + local AgentManager)
- remote CLI mode (P2P message protocol + host CLI)

## Completed

### 1) Context `@` mentions

- Implemented mention candidate search utility in shared layer:
  - `shared/src/util.rs` (`list_mention_candidates`)
  - Uses `rg --files` primarily
  - Fallback uses `ignore` crate and respects `.gitignore`
- Added dual-mode invocation:
  - Local Tauri command: `list_mention_candidates`
  - Remote Tauri command: `list_remote_mention_candidates`
  - Protocol action: `FileBrowserAction::ListMentionCandidates`
  - CLI host handler implemented in `cli/src/message_server.rs`
- Frontend mention UX:
  - `@path` suggestions in chat input
  - keyboard navigation (`↑/↓`, `Tab/Enter`, `Esc`)
  - absolute-position popup above input (does not resize input)
  - popup height constrained (desktop ~5 rows, mobile ~3 rows)

### 2) Images

- ACP prompt content now supports image content blocks and mention-linked resources.
- Raw tool/image content is surfaced and rendered in chat.

### 3) Tool calls + permission requests

- Permission request/response flow is wired for local and remote sessions.
- Tool call updates are surfaced as raw events and mapped in frontend.

### 4) Following / Edit review / TODO / Terminal cards

- Structured system cards implemented for:
  - Following
  - Edit review
  - TODO list
  - Terminal
- Card actions implemented:
  - Following: open file panel, open target file path (with optional line jump), copy path
  - Edit review: show/hide diff, copy diff, accept/reject action buttons
  - TODO list: local checkbox state + "Sync to Agent"
  - Terminal: copy terminal id, insert to input, attach/status/stop action buttons

### 5) Custom Slash commands

- `available_commands_update` no longer floods chat as system text.
- Commands are stored per session in chat store.
- Slash popup shown on `/` input:
  - supports filter, keyboard navigation, select to fill input
  - does **not** auto-send (fills `/{command} ` and waits user submit)
- Fallback default slash commands shown before session-provided list arrives.
- Codex ACP slash baseline aligned:
  - `/review` (optional instructions)
  - `/review-branch`
  - `/review-commit`
  - `/init`
  - `/compact`
  - `/logout`
- Parser compatibility added for both:
  - inline update payload (`available_commands_update`)
  - externally-tagged payload (`AvailableCommandsUpdate`)

### 5.1) Custom Prompts

- Added per-session custom prompt storage in frontend store.
- Added ACP update parsing for custom prompts:
  - inline update payload (`available_prompts_update`)
  - externally-tagged payload (`AvailablePromptsUpdate`)
- Slash chooser now merges:
  - slash commands
  - custom prompts (as slash-invokable entries)
  with normalization/deduplication.

### 6) Client MCP servers

- MCP server JSON is supported in both start flows:
  - local start (`local_start_agent`)
  - remote spawn (`remote_spawn_session`)
- Protocol payload and runtime parsing are implemented end-to-end.

### 7) Remote/local compatibility fixes

- Added missing command registrations:
  - `install_acp_package_local`
  - `local_stop_agent` (backward-compatible command expected by frontend)

## Partially Completed / Known Gaps

### Interactive terminal depth

- Current terminal card actions are intent-driven via agent messages.
- Not yet implemented: dedicated realtime terminal attach panel with:
  - continuous output streaming
  - direct stdin input channel
  - terminal lifecycle dashboard

## Files Touched (high level)

- Backend/protocol/shared:
  - `shared/src/util.rs`
  - `shared/src/message_protocol.rs`
  - `shared/src/agent/acp.rs`
  - `shared/src/agent/message_adapter.rs`
  - `shared/src/agent/mod.rs`
  - `cli/src/message_server.rs`
  - `app/src/lib.rs`
- Frontend:
  - `src/components/ChatView.tsx`
  - `src/components/ui/ChatInput.tsx`
  - `src/components/ui/MessageBubble.tsx`
  - `src/components/FileBrowserView.tsx`
  - `src/stores/chatStore.ts`
  - `src/stores/fileBrowserStore.ts`
  - `src/stores/sessionStore.ts`
  - `src/stores/chatStore.ts`

## Verification Snapshot

- `cargo check --workspace` passed in this integration cycle.
- `pnpm tsc` passed in this integration cycle.
- `cargo clippy --workspace -- -D warnings` still has pre-existing repo-wide issues unrelated to this feature set.
