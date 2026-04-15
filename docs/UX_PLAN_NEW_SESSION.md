# New Session Flow: UX Optimization Plan

## Current Friction

The existing `NewSessionModal.tsx` exposes too much technical complexity upfront. Users see Agent arguments, MCP Server JSON inputs, and complex remote/local toggles immediately, which causes cognitive overload for standard use cases.

## Design Goals

1. **Progressive Disclosure**: Hide advanced configuration behind an "Advanced Options" toggle.
2. **Context-Aware Defaults**: If the user is on mobile, default to Remote mode and suggest connecting to a host. If on desktop, default to Local mode.
3. **Simplified Path Selection**: Make directory selection more intuitive with better visual hierarchy.
4. **Clear Call-to-Actions**: Make the primary "Create" or "Connect" button stand out.

## UI/UX Changes

### 1. Basic Setup (Always Visible)

- **Agent Type**: Dropdown (Claude, Codex, Gemini, etc.)
- **Project Path**: Combobox with recent history and directory auto-complete.
- **Mode Toggle**: Local vs. Remote (styled as a segmented control or pill toggle).

### 2. Remote Connection (Conditional)

- **Host Selection**: Only shown if Remote mode is selected.
- **Session Ticket**: Clean input for the connection ticket with an inline QR scan button (mobile only).

### 3. Advanced Options (Hidden by Default)

- An expandable accordion or toggle button labeled "Advanced Configuration".
- Contains:
  - **Agent Args**: Textarea for custom CLI arguments.
  - **MCP Servers**: Textarea for JSON MCP configuration.
- Saves state so power users only have to open it once per app lifecycle.

## Implementation Details

- Component: `src/components/NewSessionModal.tsx`
- State: Add `isAdvancedExpanded` signal.
- Styling: Use `Accordion` or a simple animated `Show` block for the advanced section.
