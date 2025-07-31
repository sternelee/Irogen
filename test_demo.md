# Iroh Code Remote - Terminal Session Sharing Demo

## Overview

This implementation now supports both standard terminal recording and asciinema-like passthrough mode for sharing terminal sessions over iroh's P2P network.

## Features

### 1. Standard Mode (Default)

Similar to traditional terminal recording, creates a new PTY session:

```bash
cargo run -- host -c "echo 'Hello World'"
```

### 2. Passthrough Mode (Like asciinema)

Direct terminal interaction with recording and sharing capabilities:

```bash
cargo run -- host --passthrough -c "bash"
```

### 3. Join Sessions

Connect to an existing shared session:

```bash
cargo run -- join <session-id>
```

### 4. Play Recordings

Replay saved terminal sessions:

```bash
cargo run -- play session.json
```

## Key Implementation Details

### Terminal Passthrough Architecture

- **Raw Mode**: Enables direct terminal input/output handling
- **PTY Integration**: Uses pseudo-terminals for command execution
- **Dual Stream Handling**:
  - stdin → PTY → iroh sharing
  - PTY output → stdout + iroh sharing
- **Real-time Sharing**: All I/O events are immediately broadcast via iroh

### asciinema-like Features

- Direct terminal interaction (like typing in your actual shell)
- Raw terminal mode for proper keyboard handling
- Timestamped event recording
- Session serialization to JSON format
- Support for terminal resize events

### Iroh P2P Integration

- Session sharing across nodes
- Real-time terminal event broadcasting
- Participant management
- Session discovery and joining

## Usage Examples

### Host a passthrough session:

```bash
# Start a bash session that others can join and see in real-time
cargo run -- host --passthrough --save session.json

# Others can join with:
cargo run -- join <session-id> --peer <node-addr>
```

### Standard recording mode:

```bash
# Traditional recording approach
cargo run -- host -c "ls -la" --save output.json
```

The implementation maintains the core iroh functionality while adding the natural terminal interaction experience that asciinema provides.

