# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RiTerm** is a P2P terminal session sharing tool built with Rust, SolidJS, and Tauri. It enables real-time terminal collaboration across multiple platforms using iroh's P2P networking with end-to-end encryption. The project supports both Chinese and English users, with comprehensive documentation in both languages.

## Architecture

The project is organized as a Cargo workspace with four main components:

- **cli/** - Command-line interface tool for hosting terminal sessions
- **app/** - Tauri-based multi-platform application (desktop + mobile)
- **shared/** - Common networking and messaging protocols
- **browser/** - Web browser client implementation
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

# Type checking and build
npm run tsc    # TypeScript check followed by Vite build
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
cd app && cargo test
cd browser && cargo test

# Run specific test files
cargo test --bin test_ticket
cargo test --bin test_connection

# Build and run test utilities
rustc test_ticket.rs && ./test_ticket
rustc test_connection.rs && ./test_connection

# Browser integration tests
cd browser && cargo test --features integration-tests
```

### Code Quality and Development Tools
```bash
# TypeScript type checking (followed by build)
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

# Browser client development
cd browser && wasm-pack build --target web

# Browser client build for release
cd browser && wasm-pack build --target web --release
```

### Development Workflow
```bash
# Install dependencies
npm install
# or
pnpm install  # specified as packageManager in package.json

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

**Package Manager Note**: The project specifies `pnpm@10.0.0` as the package manager in `package.json`. While `npm` commands work, `pnpm` is recommended for consistency. The Tauri configuration (`app/tauri.conf.json`) references `pnpm` commands.

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

## Dependencies and Ecosystem

### Core Rust Dependencies
- **iroh** (0.93) - P2P networking with NAT traversal
- **tokio** (1.47) - Async runtime with full features
- **portable-pty** (0.9) - Cross-platform pseudo-terminal
- **tauri** (2) - Cross-platform desktop/mobile framework
- **crossterm** (0.29) - Cross-platform terminal manipulation

### Frontend Dependencies
- **solid-js** (1.9.9) - Reactive UI framework
- **@xterm/xterm** (5.5.0) - Terminal emulator with addons
- **daisyui** (5.0.50) - TailwindCSS component library
- **lucide-solid** (0.540.0) - Icon library

### Key Features
- **Package Manager**: pnpm@10.0.0 (specified in package.json)
- **Build Profiles**: Release with LTO, strip, and single codegen-unit optimization
- **Production Profile**: Inherits release with panic=abort for smaller binaries

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
- **NEW**: Implemented TCP service forwarding with full app-CLI coordination
- Added comprehensive TCP session management UI with real-time statistics
- Integrated TCP data message handling for bidirectional data forwarding
- **NEW**: Added browser client with WebAssembly support for direct web access
- Enhanced cross-platform compatibility with dedicated web interface
- Improved message serialization with bincode for performance optimization

### Message Flow Architecture
1. **Frontend** sends actions via Tauri invoke commands or browser WASM calls
2. **Tauri Backend/WASM** converts to structured Message objects
3. **Communication Manager** handles P2P message routing using iroh
4. **CLI Host** processes messages and manages terminal operations
5. **Response Messages** flow back through the same chain
6. **Browser Client** can directly connect using WebAssembly P2P implementation

### TCP Service Forwarding (Recent Addition)
The project now includes TCP service forwarding capabilities allowing users to:
- Create TCP forwarding sessions through the P2P network
- Forward local TCP services to remote clients (and vice versa)
- Manage forwarding sessions with real-time statistics
- Support for both "Listen to Remote" and "Connect to Remote" forwarding modes

**Key Components:**
- `shared/src/message_protocol.rs` - Defines `TcpForwardingAction`, `TcpForwardingType`, and `TcpDataType` enums
- `cli/src/message_server.rs` - Implements `TcpForwardingMessageHandler` and `TcpDataMessageHandler`
- `app/src/lib.rs` - Provides Tauri commands for TCP forwarding management
- `src/components/TcpForwardingManager.tsx` - Frontend UI for managing TCP sessions
- `browser/src/` - WebAssembly implementation for browser-based terminal access only

**Message Types:**
- `TcpForwardingAction::CreateSession` - Create new forwarding sessions
- `TcpForwardingAction::ListSessions` - List existing sessions
- `TcpForwardingAction::StopSession` - Stop specific sessions
- `TcpDataType::Data` - Forward actual TCP data between endpoints

**Browser Client Architecture:**
- Uses WebAssembly for P2P networking in the browser
- Leverages `wasm-bindgen` for JavaScript interop
- Implements terminal-only functionality (no TCP forwarding support)
- Provides a web-only interface accessible without installation
- Focuses purely on terminal data interaction capabilities

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
├── browser/             # Browser client (Rust + WebAssembly)
├── src/                 # SolidJS frontend application
└── dist/                # Built frontend assets
```

### Build Targets
- **CLI**: `cli/target/release/cli` or `cli/target/debug/cli`
- **Desktop App**: `app/target/release/bundle/` (macOS .app, Windows .exe, Linux AppImage)
- **Mobile Apps**: Generated in `app/gen/android/` (APK) and `app/gen/apple/` (iOS .ipa)
- **Browser Client**: `browser/dist/` (WASM + HTML/JS/CSS for web deployment)
- **Frontend**: `dist/` directory (served by Tauri in production)

### Build Process Notes
- The project uses a Cargo workspace with four crates: `cli`, `app`, `shared`, and `browser`
- Frontend (SolidJS) builds to `dist/` which Tauri packages in the final app
- The `app` directory contains the Tauri backend and mobile app code
- The `browser` directory contains a pure web client using WebAssembly
- Development server runs frontend on `http://localhost:1420` with hot reload
- Mobile builds require platform-specific toolchains (Android SDK, Xcode)
- Browser client uses `wasm-pack` for WASM compilation and web bundling

## Common Development Patterns

### Adding New Terminal Features
1. Define message types in `shared/src/message_protocol.rs`
2. Implement CLI handlers in `cli/src/message_server.rs` (MessageHandler implementations)
3. Add Tauri commands in `app/src/lib.rs`
4. Create frontend components in `src/components/`
5. Update mobile viewport management if needed

### Adding New TCP Forwarding Features
1. Define new TCP message types in `shared/src/message_protocol.rs`
2. Implement TCP handlers in the existing `TcpForwardingMessageHandler` or `TcpDataMessageHandler`
3. Add corresponding Tauri commands in `app/src/lib.rs`
4. Update the `TcpForwardingManager.tsx` frontend component
5. Test with both forwarding modes: "ListenToRemote" and "ConnectToRemote"

### Browser Client Development
1. Implement browser-specific features in `browser/src/lib.rs`
2. Use WebAssembly for P2P networking via `wasm-bindgen`
3. Focus on terminal data interaction only (no TCP forwarding)
4. Build with wasm-pack: `wasm-pack build --target web`
5. Test browser compatibility and WASM functionality
6. Deploy browser client to static hosting for web access

**Browser Client Limitations:**
- Only supports terminal creation and basic interaction
- No TCP forwarding capabilities (security and technical limitations)
- Simplified message handling compared to native clients
- Dependent on browser WebAssembly support and security constraints

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

### Internationalization
- The project supports both Chinese and English users
- README.md contains comprehensive Chinese documentation
- User interface should consider bilingual support where appropriate
- Error messages and logs may include Chinese content for Chinese users
