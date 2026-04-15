# Devices Management: UX Optimization Plan

## Current Friction

The app separates "Hosts" and "Proxies" into different, highly technical views. A user simply wants to know: "What computers can I connect to right now?"

## Design Goals

1. **Consolidated View**: Combine the concept of local daemons, remote hosts, and P2P proxies into a single "Devices" tab.
2. **Clear Status**: Easily distinguish between "This Computer (Local)", "Known Remote Hosts", and "New Connection".
3. **Simplified Connection Flow**: Make adding a new device as easy as scanning a QR code or pasting a short ticket.

## UI/UX Changes

### 1. Header

- Title: "Devices & Hosts"

### 2. Local Device Section

- "This Device (Local Daemon)"
- Status: "Running" (green dot) or "Offline"
- Actions: "Stop Daemon", "View Logs" (advanced)

### 3. Remote Hosts List

- List of known/saved remote hosts.
- Each item:
  - Hostname / Identifier
  - Status: "Connected", "Offline", "Connecting..."
  - Actions: "Connect", "Disconnect", "Remove"

### 4. Add New Device

- "Connect to New Host" section or prominent button.
- Replaces the standalone `ConnectView.tsx` with an inline panel or a clean modal.
- Input for "Session Ticket"
- "Scan QR Code" button (mobile only).
- Link to "Setup Guide".

## Implementation Details

- Component: `src/components/DevicesView.tsx` (new) replacing the old `ConnectView` and `Dashboard` proxy view.
- State: Manage known hosts and proxies from `sessionStore`.
- Styling: Use clean list items, clear connection status indicators, and prominent "Add" buttons.
