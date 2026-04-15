# Sessions Center: UX Optimization Plan

## Current Friction

Sessions are currently scattered between a sidebar, a modal, and a basic list view. There is no central, dedicated "Hub" for managing all past and present AI sessions.

## Design Goals

1. **Centralized Management**: A dedicated view to see all sessions (active, paused, archived).
2. **Filtering and Search**: Ability to find a session by project name, agent type, or date.
3. **Bulk Actions**: Stop/Archive multiple sessions at once.
4. **Detailed Status**: Show whether a session is currently running locally, connected remotely, or offline.

## UI/UX Changes

### 1. Header and Filters

- Title: "Sessions"
- Search bar: "Search by project or agent..."
- Status Filter: "All", "Active", "Remote", "Archived".

### 2. Session List/Grid

- Each item should display:
  - Agent Type (Icon + Name)
  - Project Path (Full path)
  - Mode: "Local" or "Remote" (with host ID if remote)
  - Status indicator (Green dot for active, gray for offline)
  - "Resume" button (opens the session in the WorkspaceShell)
  - Options menu (Stop, Delete, View Logs)

### 3. Empty State

- Clear message: "No active sessions."
- Primary action: "Start New Session".

## Implementation Details

- Component: `src/components/SessionsView.tsx` (new) or adapting `SessionListView.tsx`.
- State: Read all sessions from `sessionStore`.
- Styling: Use a responsive grid or list layout. Provide a consistent card design for each session.
