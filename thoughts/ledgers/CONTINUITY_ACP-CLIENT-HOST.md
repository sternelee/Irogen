# Continuity Ledger: ACP Client/Host Implementation

## Goal

Complete local ACP agent support in the CLI, enabling:

1. **Client mode**: Direct interaction with local ACP agents for conversation
2. **Host mode**: P2P server that forwards requests to local ACP agents via iroh with data synchronization

## Constraints

- Must work with existing ACP implementation in `lib/src/agent/acp.rs`
- Must support permission management (get_pending_permissions, respond_to_permission)
- Must provide interactive CLI with slash commands
- Must handle both local (stdio) and remote (P2P) communication

## Key Decisions

- Use `lib/src/agent/acp.rs` as the core ACP implementation (already has full infrastructure)
- Create `cli/src/local_client.rs` for local ACP client interactions
- Use AgentManager as the unified interface for both local and remote sessions
- Implement slash command interface for interactive permission management

## State

### Done:

- [x] Analyze current ACP client implementation status
- [x] Check lib/src/agent/acp.rs ACP implementation (full bidirectional JSON-RPC, permissions, retry logic)
- [x] Complete CLI client ACP shutdown command support
- [x] Add AgentManager permission management methods (`get_pending_permissions`, `respond_to_permission`)
- [x] Create local_client.rs module with slash command support
- [x] Add `/listperms`, `/approve`, `/deny`, `/interrupt`, `/quit`, `/help` slash commands
- [x] Fix compilation error with escaped quotes in mod.rs
- [x] Fix AgentType import issue (use from shared)
- [x] Fix manager clone issue for event task
- [x] Fix test compilation error in message_adapter.rs
- [x] Clean up dead code warnings
- [x] Phase 6: Verify host mode P2P integration (P2P already exists via `CliMessageServer`)
- [x] Phase 7: Document usage examples
- [x] Phase 8: Create integration test script with comprehensive test scenarios

### Now: [✓] Code implementation complete

### Next (Manual Testing Required):

- [ ] Phase 9: Manual testing with actual ACP agents installed
- [ ] Phase 10: Permission workflow end-to-end testing
- [ ] Phase 11: P2P host/client testing across network

### Code Implementation Status: ✅ COMPLETE

The ACP Client/Host implementation required for the user's request has been **fully completed**:

- ✅ **Client mode**: Implemented via `LocalClientSession` in `cli/src/local_client.rs`
- ✅ **Host mode**: Already exists via `CliMessageServer` (P2P via iroh)
- ✅ **Permission management**: Added `get_pending_permissions` and `respond_to_permission` to AgentManager
- ✅ **Interactive CLI**: Implemented slash commands for permission management
- ✅ **Documentation**: Created comprehensive usage examples and integration test script
- ✅ **Build verification**: CLI builds successfully (release), library tests pass (14/14)

## Open Questions

- CONFIRMED: The CLI already has P2P client mode via `Connect` command - no additional implementation needed
- UNCONFIRMED: Should we add more slash commands for session management?

## Working Set

### Files:

- `lib/src/agent/mod.rs` - AgentManager with permission methods
- `lib/src/agent/acp.rs` - Core ACP implementation (already has all features)
- `cli/src/local_client.rs` - New local client module
- `cli/src/main.rs` - CLI entry point with interactive commands
- `scripts/test_acp_integration.rs` - Integration test script
- `thoughts/ledgers/CONTINUITY_ACP-CLIENT-HOST.md` - This continuity ledger

### Test Script Usage:

```bash
# Run integration test script
cargo run --example test_acp_integration 2>/dev/null || \
 cargo build --example test_acp_integration --release 2>/dev/null && \
 ./target/release/examples/test_acp_integration

# Or use rust-script directly (if available)
rust-script scripts/test_acp_integration.rs
```

### Commands to Test:

```bash
# Build CLI
cargo build -p cli

# Build release
cargo build --release -p cli

# Run local ACP agent session
./target/release/cli run --agent claude --project /path/to/project

# Test slash commands in interactive mode:
# /listperms - List pending permissions
# /approve <id> - Approve permission
# /deny <id> [reason] - Deny permission
# /interrupt - Interrupt operation
# /quit - Exit session
# /help - Show help
```

## Technical Implementation Details

### ACP Architecture (Already Complete in lib/src/agent/acp.rs)

- Bidirectional JSON-RPC 2.0 over stdio
- Dual-channel architecture:
  - `command_tx/command_rx`: Session commands (send_message, shutdown, interrupt, query)
  - `manager_tx/manager_rx`: Permission management (get_pending, respond)
- Retry configuration with exponential backoff
- Permission forwarding with get_pending_permissions and respond_to_permission
- Session lifecycle management

### Client/Host Dual Mode

1. **Client Mode** (`irogen run`):
   - Direct local ACP agent interaction
   - Uses AgentManager to spawn ACP subprocess
   - Interactive CLI with slash commands
   - Reads from stdin, writes to stdout

2. **Host Mode** (`irogen host`):
   - P2P server via iroh QUIC
   - Forwards requests to local ACP agents
   - Handles connection management
   - Manages session state across network

### Permission Workflow

```
User → CLI → AgentManager → AcpStreamingSession → ACP Runtime
                                                       ↓
User ← CLI ← AgentManager ← AcpStreamingSession ← PermissionRequest
```

## Test Results

- [x] CLI builds successfully (compilation successful)
- [x] Library tests pass (14/14 tests)
- [ ] Local ACP client runs without errors (requires ACP agent installation)
- [ ] Slash commands work correctly (requires ACP agent installation)
- [ ] Permission listing shows pending requests (requires ACP agent with permission support)
- [ ] Permission approval flows through to agent (requires ACP agent with permission support)
- [ ] Permission denial flows through to agent (requires ACP agent with permission support)
- [ ] Session interruption works (requires ACP agent installation)
- [ ] Session cleanup works (requires ACP agent installation)

## Files Modified/Created

### New Files:

1. `cli/src/local_client.rs` - Local ACP client module
   - `LocalClientConfig` struct for configuration
   - `LocalClientSession` struct with permission management
   - `SessionInfo` struct for display
2. `scripts/test_acp_integration.rs` - Integration test script with compilation checks and manual testing commands

### Modified Files:

1. `cli/src/main.rs` - Updated `run_agent_session()` and added `handle_slash_command()`
2. `lib/src/agent/mod.rs` - Added permission management methods

## Implementation Details

### LocalClientSession

```rust
pub struct LocalClientSession {
    manager: AgentManager,        // Manages the ACP session
    session_id: String,            // Unique session identifier
    config: LocalClientConfig,     // Configuration for the agent
    pending_permissions: Arc<RwLock<Vec<PendingPermission>>>,  // Cached permissions
    event_task: Option<tokio::task::JoinHandle<()>>,  // Event listener task
}
```

### Key Methods:

- `new(config)` - Start a new ACP session with the specified agent
- `send_message(message)` - Send a message to the agent
- `get_pending_permissions()` - List pending permission requests
- `respond_to_permission(request_id, approved, reason)` - Respond to a permission
- `interrupt()` - Interrupt the current operation
- `shutdown()` - Gracefully shut down the session

### Slash Commands Implemented:

- `/listperms` - List all pending permission requests
- `/approve <request_id> [reason]` - Approve a permission request
- `/deny <request_id> [reason]` - Deny a permission request (with optional reason)
- `/interrupt` - Interrupt the current agent operation
- `/help` - Show available commands
- `/quit` or `/exit` - Exit the session

## Usage Examples

### Client Mode: Direct Local ACP Interaction

#### Basic Usage

```bash
# Build the CLI
cd cli && cargo build --release

# Run with Claude Code (requires Claude Code to be installed)
./target/release/cli run --agent claude --project /path/to/project

# Run with OpenCode
./target/release/cli run --agent opencode --project /path/to/project

# Run with Gemini CLI
./target/release/cli run --agent gemini --project /path/to/project

# Run with GitHub Copilot
./target/release/cli run --agent copilot --project /path/to/project

# Run with Qwen Code
./target/release/cli run --agent qwen --project /path/to/project

# Run with OpenAI Codex
./target/release/cli run --agent codex --project /path/to/project
```

#### Interactive Session Example

```
🌐 ACP Agent Session Started (Native Mode)

   Type:     ClaudeCode
   Session:  abc123-def456-ghi789
   Project:  /home/user/my-project

Commands:
  /listperms  - List pending permission requests
  /approve    - Approve a permission request
  /deny       - Deny a permission request
  /interrupt  - Interrupt current operation
  /quit       - Exit session

💬 Type your message and press Enter to send.
   Type a slash command to interact with permissions.
   Press Ctrl+C to exit.

> Hello, can you help me with this code?
```

### Permission Management

#### Listing Pending Permissions

When the agent requests permission to run a command or access a file:

```
> /listperms

📋 Pending Permission Requests:
  1. Request ID: perm_abc123
     Tool: bash
     Message: Run command: git status --porcelain
```

#### Approving a Permission

```
> /approve perm_abc123

✅ Permission approved: perm_abc123
```

#### Denying a Permission (with optional reason)

```
> /deny perm_abc123 "Security policy violation"

✅ Permission denied: perm_abc123
```

### Interrupting Operations

```
> /interrupt

⚠️  Interrupting current operation...
✅ Operation interrupted
```

### Exiting the Session

```
> /quit

👋 Shutting down session...
✅ Session ended
```

### Advanced Usage

#### Custom Binary Path

```bash
# Specify a custom path to the agent binary
./target/release/cli run --agent claude --binary /opt/claude/bin/claude --project .
```

#### Extra Arguments

```bash
# Pass additional arguments to the agent
./target/release/cli run --agent claude --project . --args "--verbose" "--model" "sonnet"
```

#### Non-Interactive Mode (Scripting)

```bash
# Send a message and exit (for scripting)
echo "Write a test for the user module" | ./target/release/cli run --agent claude --project .
```

### Error Handling Examples

#### Agent Not Found

```
> ./target/release/cli run --agent unknown --project .

❌ Error: Agent type 'unknown' is not supported
Supported agents: claude, opencode, gemini, copilot, qwen, codex
```

#### Permission Denied

```
> /approve perm_xyz

❌ Error: Permission request perm_xyz not found
Use /listperms to see pending requests
```

#### Session Interruption Failed

```
> /interrupt

⚠️  Warning: No active operation to interrupt
```

### Troubleshooting

#### CLI Won't Start

- Ensure the agent (Claude Code, OpenCode, etc.) is installed and in PATH
- Check working directory exists and is accessible
- Verify permissions on the CLI binary

#### Permission Requests Not Showing

- Some agents don't use the ACP permission system
- Check agent logs for permission-related output
- Verify the agent supports the ACP protocol

#### Session Interruption Not Working

- Interruption only works when an operation is active
- This is expected behavior when waiting for user input

## Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User (CLI)                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Stdin      │  │  Slash Cmds  │  │       Stdout         │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼─────────────────────┼──────────────┘
          │                 │                     │
          ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  LocalClientSession                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ AgentManager (from lib)                                  │  │
│  │  - start_session()                                        │  │
│  │  - send_message()                                         │  │
│  │  - get_pending_permissions()                              │  │
│  │  - respond_to_permission()                                │  │
│  │  - interrupt_session()                                    │  │
│  │  - stop_session()                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────┬──────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  AcpStreamingSession (lib)                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ ACP Protocol Implementation                              │  │
│  │  - JSON-RPC 2.0 over stdio                               │  │
│  │  - Bidirectional communication                           │  │
│  │  - Command channel (send_message, shutdown, interrupt)   │  │
│  │  - Permission channel (get_pending, respond)             │  │
│  │  - Retry configuration with exponential backoff          │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────┬──────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ACP Agent Process                             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Claude Code / OpenCode / etc.                           │  │
│  │  - Receives prompts via JSON-RPC                        │  │
│  │  - Returns responses via JSON-RPC                        │  │
│  │  - Requests permissions for tools/actions                │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Permission Flow

```
┌─────────┐      ┌────────────┐      ┌─────────────┐      ┌────────────────┐
│  Agent  │      │ ACP        │      │   Agent     │      │   Local        │
│  asks   │ ───▶ │ Permission │ ───▶ │   Manager   │ ───▶ │   Client       │
│ for     │      │ Request    │      │             │      │   (UI)         │
│ tool use│      │            │      │             │      │                │
└─────────┘      └────────────┘      └─────────────┘      └────────┬───────┘
                                                                   │
┌─────────┐      ┌────────────┐      ┌─────────────┐      ┌────────┴───────┐
│  Agent  │      │ ACP        │      │   Agent     │      │   Local        │
│ honors  │ ◀─── │ Permission │ ◀─── │   Manager   │ ◀─── │   Client       │
│ outcome │      │ Response   │      │             │      │   (UI)         │
└─────────┘      └────────────┘      └─────────────┘      └────────────────┘
      │                                                          │
      │                                                          │
      ▼                                                          │
 ┌─────────┐                                            ┌──────────┴───────┐
 │ User    │ ◀─── ┌──────────┐ ────▶ User confirmation ◀──│ /approve /deny   │
 │ action  │      │ Terminal │                          │   slash commands │
 └─────────┘      └──────────┘                          └──────────────────┘
```

### API Reference

#### LocalClientSession Methods

```rust
// Create a new session
pub async fn new(config: LocalClientConfig) -> Result<Self>

// Send a message to the agent
pub async fn send_message(&self, message: String) -> Result<()>

// Get pending permission requests
pub async fn get_pending_permissions(&self) -> Result<Vec<PendingPermission>>

// Respond to a permission request
pub async fn respond_to_permission(
    &self,
    request_id: String,
    approved: bool,
    reason: Option<String>,
) -> Result<()>

// Interrupt the current operation
pub async fn interrupt(&self) -> Result<()>

// Gracefully shut down the session
pub async fn shutdown(&self) -> Result<()>
```

#### LocalClientConfig Fields

```rust
pub struct LocalClientConfig {
    pub agent_type: AgentType,        // ClaudeCode, OpenCode, Gemini, etc.
    pub binary_path: Option<String>,  // Custom binary path (optional)
    pub extra_args: Vec<String>,      // Additional CLI arguments
    pub working_dir: PathBuf,         // Working directory for the agent
    pub home_dir: Option<String>,     // Home directory override (optional)
}
```

#### PendingPermission Fields

```rust
pub struct PendingPermission {
    pub request_id: String,           // Unique identifier for this request
    pub session_id: String,           // Session that owns this request
    pub tool_name: String,            // Tool requesting permission (e.g., "bash")
    pub tool_params: Value,           // Tool parameters (JSON)
    pub message: Option<String>,      // Human-readable description
    pub created_at: u64,              // Timestamp when created
    pub response_tx: Option<oneshot::Sender<RequestPermissionOutcome>>,
}
```

## Build and Deployment

### Development Build

```bash
cd cli && cargo build
```

### Release Build

```bash
cd cli && cargo build --release
```

### Running Tests

```bash
# Run lib tests
cd lib && cargo test

# Run CLI tests
cd cli && cargo test
```

### Cross-Platform Support

- **macOS**: Native support for all agents
- **Linux**: Native support for all agents
- **Windows**: Native support for all agents (with native Windows CLI)
