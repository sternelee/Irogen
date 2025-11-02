# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RiTerm is a P2P terminal session sharing tool built with Rust backend and Flutter frontend. It enables real-time collaborative terminal sessions with end-to-end encryption using iroh P2P network.

## Architecture

This is a multi-platform application with the following components:

### Backend Components (Rust)
- **CLI Tool** (`cli/`) - Command-line interface for hosting terminal sessions
- **Shared Library** (`shared/`) - Core P2P networking and message types
- **Flutter Bridge** (`app/rust/`) - Rust backend that bridges to Flutter via FFI

### Frontend Components
- **Flutter Mobile App** (`app/`) - Cross-platform mobile application
- **Web Interface** (referenced in README) - React-based web interface

## Common Development Commands

### Building the CLI Tool
```bash
cd cli
cargo build --release
```

### Running the CLI Host
```bash
./cli/target/release/cli host
```

### Flutter Development
```bash
cd app
flutter pub get
flutter run
```

### Building Flutter App
```bash
cd app
flutter build apk          # Android
flutter build ios          # iOS
flutter build windows      # Windows
flutter build macos        # macOS
flutter build linux        # Linux
```

### Running Tests
```bash
# Rust tests
cd cli && cargo test
cd shared && cargo test

# Flutter tests
cd app && flutter test
```

### Code Generation
```bash
# Flutter Rust Bridge code generation
cd app/rust && flutter_rust_bridge_codegen --rust-input ./src/lib.rs --dart-output ../lib/src/rust/frb_generated.dart
```

## Key Technical Details

### P2P Network Architecture
- Uses iroh P2P library with gossip protocol for message passing
- End-to-end encryption with ChaCha20Poly1305
- Session tickets contain connection info and encryption keys
- Supports NAT traversal and relay servers

### Message Types
The system uses two main message categories:
1. **Virtual Terminal Messages** - For shared terminal sessions (Output, Input, SessionInfo)
2. **Real Terminal Management** - For actual terminal instances (TerminalCreate, TerminalOutput, TerminalInput, etc.)

### Flutter-Rust Integration
- Uses flutter_rust_bridge for FFI communication
- Rust backend in `app/rust/` exposes APIs to Flutter
- Key APIs: IrohClient, terminal management functions

### Terminal Management
- `TerminalManager` handles multiple terminal instances
- Supports real terminals with PTY (pseudo-terminal) management
- Cross-platform shell support (bash, zsh, fish, PowerShell, etc.)

## Development Workflow

### Adding New Features
1. **Backend changes**: Add message types to `shared/src/p2p.rs`
2. **CLI changes**: Implement handlers in `cli/src/`
3. **Flutter changes**: Add bridge methods in `app/rust/src/lib.rs`
4. **Code generation**: Run flutter_rust_bridge_codegen after bridge changes

### Testing P2P Features
1. Start CLI host: `./cli/target/release/cli host`
2. Copy session ticket from host output
3. Use Flutter app to connect via ticket
4. Test terminal creation and management

### Message Flow
1. Host creates P2P session and generates ticket
2. Client joins session using ticket
3. Messages are encrypted and broadcast via gossip protocol
4. Terminal I/O is routed through P2P network

## File Structure Notes

### Key Files
- `shared/src/p2p.rs` - Core P2P networking and message definitions
- `cli/src/terminal_manager.rs` - Terminal instance management
- `cli/src/cli.rs` - CLI command handlers and host logic
- `app/rust/src/lib.rs` - Flutter bridge API definitions
- `app/lib/main.dart` - Flutter app entry point

### Configuration Files
- `Cargo.toml` (root) - Workspace configuration with shared dependencies
- `cli/Cargo.toml` - CLI-specific dependencies
- `app/pubspec.yaml` - Flutter dependencies
- `app/rust/Cargo.toml` - Rust bridge dependencies

## Debugging and Troubleshooting

### Logs
- CLI logs are written to `logs/` directory
- Use `RUST_LOG=debug` environment variable for verbose logging
- Flutter logs are available through flutter logs

### Common Issues
- P2P connection failures: Check network connectivity and relay settings
- Terminal creation issues: Verify shell paths and permissions
- Flutter bridge errors: Regenerate bridge code after API changes

### Testing Terminal Features
Use the CLI host to create terminals and test the Flutter app's ability to:
- List available terminals
- Create new terminals
- Send input to terminals
- Receive terminal output
- Resize and stop terminals

## Security Considerations

- All P2P communications are end-to-end encrypted
- Session tickets contain sensitive information and should be treated as secrets
- Terminal input/output is transmitted securely through the P2P network