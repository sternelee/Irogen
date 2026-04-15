# Home Dashboard: UX Optimization Plan

## Current Friction

The app opens to a highly technical "Topology" or raw "Dashboard" view showing network connections and host nodes. This is great for a developer debugging P2P routing, but poor for an end-user who just wants to chat with an AI agent or resume a coding task.

## Design Goals

1. **Task-Centric First Impression**: The user should immediately see what they were doing last or how to start a new task.
2. **Quick Actions**: Prominent buttons to start new AI sessions (Local/Remote) or connect to a host.
3. **Recent Activity**: A list of the 3-5 most recent chat sessions with timestamps and context (e.g., project path, agent type).

## UI/UX Changes

### 1. Welcome Section

- A friendly greeting or simple overview.
- Two primary action cards/buttons:
  - "Start New Session" (opens NewSessionModal)
  - "Connect to Host" (navigates to Devices view or opens QR scanner)

### 2. Recent Sessions

- A clean list or grid showing:
  - Agent Avatar/Icon (Claude, Codex, etc.)
  - Project Path (truncated if necessary)
  - "Last active: X mins ago"
  - "Resume" button (routes to WorkspaceShell and loads the session).

### 3. System Status (Minimal)

- A small indicator showing the status of the local daemon or primary remote connection.
- A link to "View all connections" (routes to Devices view).

## Implementation Details

- Component: `src/components/HomeView.tsx` (new) replacing the default `Dashboard` view for `"home"`.
- State: Pull from `sessionStore` to get recent history.
- Styling: Use `Card` components for quick actions and list items for recent sessions.
