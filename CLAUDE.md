# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RiTerm** is a P2P terminal session sharing tool built with Rust, SolidJS, and Tauri. It enables real-time terminal collaboration across multiple platforms using iroh's P2P networking with end-to-end encryption.

## Architecture

The project is organized as a Cargo workspace with three main components:

- **cli/** - Command-line interface tool for hosting terminal sessions
- **app/** - Tauri-based multi-platform application (desktop + mobile)
- **shared/** - Common networking and messaging protocols
- **src/** - SolidJS frontend application

### Core Components

1. **P2P Networking** (`shared/src/`)
   - `message_protocol.rs` - Core message types and protocols with unified messaging system
   - `quic_server.rs` - QUIC-based server implementation
   - `event_manager.rs` - Event handling and coordination
   - `communication_manager.rs` - Communication and connection management

2. **CLI Tool** (`cli/src/`)
   - `message_server.rs` - Host server for Tauri/mobile connections
   - `terminal_runner.rs` - Terminal session management
   - `shell.rs` - Shell detection and configuration
   - `message_handler.rs` - Message processing and routing

3. **Tauri App** (`app/src/`)
   - `lib.rs` - Main Tauri backend with session management
   - Terminal creation, input handling, and P2P coordination
   - Mobile and desktop capability management

4. **Frontend** (`src/`)
   - SolidJS with TypeScript
   - Mobile-first responsive design with adaptive layouts
   - Terminal UI components using xterm.js
   - AI chat integration for natural language terminal commands

## Development Commands

### Build and Run
```bash
# Build CLI tool
cd cli && cargo build --release

# Run CLI host server
./cli/target/release/cli host

# Run CLI with custom shell
./cli/target/release/cli host --shell zsh --width 120 --height 30

# Build Tauri app
npm run tauri build

# Development mode
npm run tauri dev

# Build frontend only
npm run build

# Development server
npm run dev
```

### Mobile Development
```bash
# Android development
npm run tauri android dev

# Build Android APK
npm run tauri android build

# iOS development (macOS only)
npm run tauri ios dev

# View iOS device logs (macOS)
idevicesyslog | grep RiTerm
```

### Testing
```bash
# Rust tests
cargo test

# Run from workspace root
cargo test --workspace

# Test specific components
cd cli && cargo test
cd shared && cargo test

# Run specific test files
cargo test --bin test_ticket
cargo test --bin test_connection

# Build and run test utilities
rustc test_ticket.rs && ./test_ticket
rustc test_connection.rs && ./test_connection
```

### Code Quality and Development Tools
```bash
# TypeScript type checking
npm run tsc
# or
pnpm tsc

# Frontend development server
npm run dev
# or
pnpm dev

# Build frontend only
npm run build
# or
pnpm build

# Preview built frontend
npm run preview
# or
pnpm preview

# Rust compilation check
cargo check

# Rust formatting
cargo fmt

# Rust linting
cargo clippy

# Build with debug information
cargo build

# Build optimized release
cargo build --release
```

### Development Workflow
```bash
# Install dependencies
npm install
# or
pnpm install

# Start development with hot reload
npm run tauri dev
# or
pnpm tauri dev

# For frontend-only development
npm run dev
# or
pnpm dev

# Type checking
npm run tsc
# or
pnpm tsc

# Build for production
npm run build && npm run tauri build
# or
pnpm build && pnpm tauri build
```

**Note**: The Tauri configuration (`app/tauri.conf.json`) references `pnpm` commands while the project root uses `npm`. Both package managers work, but be consistent within your development environment.

## Key Technical Details

### Unified Message Protocol (Recent Update)
The project has implemented a comprehensive message system replacing the previous TerminalCommand/Response approach:
- `Message` struct with structured payload types
- `MessageType` enum for different message categories
- Message routing and priority handling
- Response correlation and error handling
- Network serialization with length prefixes

### Session Management
- Sessions support up to 50 concurrent connections
- Event buffering limits (5000 events per session)
- Automatic cleanup of inactive sessions
- Memory management with periodic cleanup tasks (5-minute intervals)
- Session tickets with NodeAddr for P2P connections

### P2P Architecture
- Uses iroh for P2P networking with NAT traversal
- ChaCha20Poly1305 end-to-end encryption
- Session tickets for connection sharing (Base32 encoded)
- QUIC-based communication with connection management
- No central server required

### Terminal I/O System
- Real-time terminal input/output synchronization
- Based on sshx-style I/O loop with tokio::select!
- Cross-platform shell detection (Zsh, Bash, Fish, Nushell, PowerShell)
- Terminal creation, resizing, and management
- Mobile-optimized terminal interface with adaptive layouts

### Frontend Features
- **Mobile-First Design**: Responsive layouts with mobile viewport management
- **Keyboard Management**: Advanced mobile keyboard handling with viewport adjustment
- **AI Assistant**: Natural language terminal command generation
- **Multi-Terminal Support**: Tab-based terminal management
- **Gesture Controls**: Touch-optimized interface for mobile devices

## Configuration Files

- `Cargo.toml` - Workspace configuration with shared dependencies
- `package.json` - Frontend dependencies and build scripts (SolidJS, xterm.js, DaisyUI)
- `app/tauri.conf.json` - Tauri application configuration
- `app/capabilities/` - Platform-specific permission configurations:
  - `main.json` - Main application permissions
  - `desktop.json` - Desktop-specific capabilities
  - `mobile.json` - Mobile-specific capabilities
- `vite.config.ts` - Vite build configuration for SolidJS

## Development Notes

### Code Organization
- The codebase uses conditional compilation for mobile vs desktop features
- Performance optimizations include event batching and memory limits
- Logging levels are adjusted based on build configuration (debug vs release)
- Mobile apps include gesture controls and adaptive layouts

### Recent Major Changes
- Implemented unified message protocol replacing previous TerminalCommand/Response system
- Fixed terminal I/O synchronization issues for real-time interaction
- Enhanced mobile viewport management and keyboard handling
- Added AI chat integration for natural language commands
- Improved session recovery and connection management

### Message Flow Architecture
1. **Frontend** sends actions via Tauri invoke commands
2. **Tauri Backend** converts to structured Message objects
3. **Communication Manager** handles P2P message routing
4. **CLI Host** processes messages and manages terminal operations
5. **Response Messages** flow back through the same chain

### Mobile Considerations
- Viewport height management with keyboard awareness
- Touch-optimized UI with appropriate tap targets
- Adaptive layouts for different screen sizes
- Safe area insets for mobile devices
- Performance optimizations for mobile hardware

### Testing and Debugging
- Comprehensive logging system with configurable levels
- Development-time debug information in mobile builds
- Session management testing utilities
- Message protocol validation
- Terminal I/O synchronization testing

## Build Targets and Workspace Structure

### Project Structure
```
riterm/
├── cli/                 # CLI tool (Rust) → builds to `cli/target/`
├── app/                 # Tauri app (Rust + SolidJS) → builds to `app/target/`
├── shared/              # Shared networking protocols (Rust library)
├── src/                 # SolidJS frontend application
└── dist/                # Built frontend assets
```

### Build Targets
- **CLI**: `cli/target/release/cli` or `cli/target/debug/cli`
- **Desktop App**: `app/target/release/bundle/` (macOS .app, Windows .exe, Linux AppImage)
- **Mobile Apps**: Generated in `app/gen/android/` (APK) and `app/gen/apple/` (iOS .ipa)
- **Frontend**: `dist/` directory (served by Tauri in production)

### Build Process Notes
- The project uses a Cargo workspace with three crates: `cli`, `app`, and `shared`
- Frontend (SolidJS) builds to `dist/` which Tauri packages in the final app
- The `app` directory contains the Tauri backend and mobile app code
- Development server runs frontend on `http://localhost:1420` with hot reload
- Mobile builds require platform-specific toolchains (Android SDK, Xcode)

## Common Development Patterns

### Adding New Terminal Features
1. Define message types in `shared/src/message_protocol.rs`
2. Implement CLI handlers in `cli/src/message_handler.rs`
3. Add Tauri commands in `app/src/lib.rs`
4. Create frontend components in `src/components/`
5. Update mobile viewport management if needed

### Mobile Development Tips
- Use the `ViewportManager` for keyboard-aware layouts
- Test with both Android and iOS when possible
- Consider touch targets and gesture handling
- Use conditional compilation for platform-specific features
- Test with various screen sizes and orientations

### Session Management
- Always handle session cleanup in component unmount effects
- Use the session recovery utilities for connection resilience
- Monitor event count to stay within buffer limits
- Implement proper error handling for network interruptions
