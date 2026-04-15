# Irogen Phase 1: Mobile-First UX Refactor (Product Requirements Document)

## 1. Goal & Vision

Evolve the current "developer console" UI into a seamless "task-oriented workspace." The redesign takes a mobile-first product manager/designer perspective to provide a better first-run experience, session management, and integrated chat/tools, without breaking the existing Rust/SolidJS technical core.

## 2. Information Architecture (IA) Redesign

Moving from System-Centric (`Topology`, `Hosts`, `Chat`, `Proxies`) to Task-Centric:

- **Home** (`home`):
  - Replaces the dashboard/topology.
  - _Purpose_: Quick actions (New Session, Connect Host) and Recent Sessions.
- **Sessions** (`sessions`):
  - _Purpose_: Dedicated center for active and past AI agent sessions. Session-first management.
- **Devices** (`devices`):
  - _Purpose_: Connect and manage local/remote hosts (merges old `hosts` and `proxies`).
- **Settings** (`settings`):
  - _Purpose_: App configuration.
- **Workspace** (`workspace`):
  - _Purpose_: The actual active environment (Chat, File Browser, Git Diff) wrapped in `WorkspaceShell`.

## 3. Core UX Friction Points Addressed

1.  **First-Run Experience**: Added guided onboarding flows and clear empty states for Chat.
2.  **Navigation**: The bottom bar and sidebar now use a simplified 4-tab structure.
3.  **"New Session" Modal**: Overly technical modal is being refactored to use progressive disclosure. Advanced configurations (Agent Args, MCP servers) are hidden behind an "Advanced Options" toggle.
4.  **Disjointed Tools**: Chat, File Browser, and Git Diff are unified inside a `WorkspaceShell` with a responsive drawer/panel system instead of overlapping modals.

## 4. Technical Strategy (Safe Refactor)

- **Wrapper-First Approach**: `WorkspaceShell.tsx` wraps the existing `ChatView.tsx`, `FileBrowserView.tsx`, and `GitDiffView.tsx`.
- **Navigation Aliases**: `navigationStore.ts` maps legacy views (`dashboard`, `hosts`, `chat`, `proxies`) to the new IA (`home`, `devices`, `workspace`) to ensure existing event listeners and rust callbacks don't break.
- **Preserve Core Logic**: No modifications to the backend Rust files or the core session/chat state management (`sessionStore.ts`, `chatStore.ts`).

## 5. Phase 1 Implementation Steps

1.  [x] Define Information Architecture and UX goals.
2.  [x] Update `navigationStore.ts` with new routes and legacy aliases.
3.  [x] Create `WorkspaceShell.tsx` to handle right-panel state and empty chat states.
4.  [ ] Update `AppLayout.tsx`, `SessionSidebar.tsx`, and `MobileNavigation.tsx` to reflect the new 4-tab structure.
5.  [ ] Refactor `NewSessionModal.tsx` for progressive disclosure.
6.  [ ] Refactor Home/Dashboard view to highlight recent sessions and quick actions.
