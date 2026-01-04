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
bun run tauri build
# or
npm run tauri build

# Development mode
bun run tauri dev
# or
npm run tauri dev

# Build frontend only
bun run build
# or
npm run build

# Development server
bun run dev
# or
npm run dev

# Type checking and build
bun run tsc    # TypeScript check followed by Vite build
# or
npm run tsc
```

### Mobile Development
```bash
# Android development
bun run tauri android dev
# or
npm run tauri android dev
# or
pnpm tauri android dev

# Build Android APK
bun run tauri android build
# or
npm run tauri android build
# or
pnpm tauri android build

# iOS development (macOS only)
bun run tauri ios dev
# or
npm run tauri ios dev
# or
pnpm tauri ios dev

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

# Test CLI ticket generation
./test_ticket_output.sh

# Browser integration tests
cd browser && cargo test --features integration-tests

# GitHub Actions (CI/CD)
# - .github/workflows/build-and-test.yml - Automated builds and tests
# - .github/workflows/publish-to-auto-release.yml - Automated releases
```

### Code Quality and Development Tools
```bash
# TypeScript type checking (followed by build)
bun run tsc
# or
npm run tsc
# or
pnpm tsc

# Frontend development server
bun run dev
# or
npm run dev
# or
pnpm dev

# Build frontend only
bun run build
# or
npm run build
# or
pnpm build

# Preview built frontend
bun run preview
# or
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

# Run test scripts
./test_ticket_output.sh  # Test CLI ticket generation
```

### Development Workflow
```bash
# Install dependencies
bun install
# or
npm install
# or
pnpm install  # specified as packageManager in package.json

# Start development with hot reload
bun run tauri dev
# or
npm run tauri dev
# or
pnpm tauri dev

# For frontend-only development
bun run dev
# or
npm run dev
# or
pnpm dev

# Type checking
bun run tsc
# or
npm run tsc
# or
pnpm tsc

# Build for production
bun run build && bun run tauri build
# or
npm run build && npm run tauri build
# or
pnpm build && pnpm tauri build
```

**Package Manager Note**: The project specifies `pnpm@10.0.0` as the package manager in `package.json`. The Tauri configuration (`app/tauri.conf.json`) references `pnpm` commands with `beforeDevCommand: "pnpm dev"` and `beforeBuildCommand: "pnpm build"`. While bun can be used for better performance, the project officially supports pnpm.

## Key Technical Details

### Architecture Overview

**RiTerm** is a P2P terminal session sharing tool built as a Cargo workspace with four main components:

1. **CLI Tool** (`cli/`) - Rust-based command-line interface for hosting terminal sessions
2. **Tauri App** (`app/`) - Cross-platform desktop/mobile application (Rust backend + SolidJS frontend)  
3. **Shared Library** (`shared/`) - Common networking protocols, message types, and utilities
4. **Browser Client** (`browser/`) - WebAssembly-based browser client for terminal access only
5. **Frontend** (`src/`) - SolidJS application with mobile-first responsive design

The project uses **iroh** for P2P networking with NAT traversal and end-to-end encryption, enabling real-time terminal collaboration without requiring a central server.

### Message Protocol Architecture

The project implements a unified message system through `shared/src/message_protocol.rs`:

- **Message Struct**: Central message type with structured payload and routing
- **MessageType Enum**: Categories for terminal data, TCP forwarding, session management, etc.
- **MessageHandler Trait**: Extensible handler system for different message types
- **Serialization**: Uses bincode for efficient network serialization with length prefixes

Key message flows:
1. Frontend → Tauri/WASM → Message struct → P2P Network → CLI Host
2. CLI processes terminal operations and sends responses back through the chain
3. Browser client can connect directly using WebAssembly P2P implementation

### Session and Connection Management

- **Session Tickets**: Base32-encoded NodeAddr for secure P2P connection sharing
- **Concurrent Connections**: Supports up to 50 simultaneous participants per session
- **Event Buffering**: 5000 event limit per session with automatic cleanup
- **Memory Management**: 5-minute interval cleanup tasks for inactive sessions
- **Recovery**: Session recovery utilities for connection resilience

### Core Components

#### P2P Networking (`shared/src/`)
- `quic_server.rs` - QUIC-based server with connection multiplexing and message routing
- `event_manager.rs` - Event coordination, buffering, and session lifecycle management
- `communication_manager.rs` - High-level P2P communication and connection handling
- `message_protocol.rs` - Unified message system with extensible handler architecture

#### CLI Tool (`cli/src/`)
- `message_server.rs` - Host server with MessageHandler implementations for different message types
- `terminal_runner.rs` - Terminal session management with real-time I/O synchronization
- `shell.rs` - Cross-platform shell detection (Zsh, Bash, Fish, Nushell, PowerShell)
- `message_handler.rs` - Message processing, routing, and response generation

#### Tauri App (`app/src/`)
- `lib.rs` - Main Tauri backend with session management and P2P coordination
- Terminal creation, input handling, and real-time output forwarding
- Mobile/desktop capability management with conditional compilation
- TCP forwarding session management and statistics tracking

#### Frontend (`src/`)
- SolidJS with TypeScript for reactive UI development
- Mobile-first responsive design with viewport management
- Terminal UI using xterm.js with mobile-optimized keyboard handling
- AI chat integration for natural language terminal command generation
- Tab-based multi-terminal support with gesture controls

#### Browser Client (`browser/src/`)
- WebAssembly implementation using wasm-bindgen for browser P2P networking
- Terminal-only functionality (no TCP forwarding due to security constraints)
- Direct P2P connection capability without native app installation

### P2P Architecture and Terminal I/O
- **iroh Networking**: P2P communication with NAT traversal and no central server dependency
- **End-to-End Encryption**: ChaCha20Poly1305 encryption for all terminal data
- **QUIC Protocol**: Reliable message delivery with connection multiplexing
- **Session Tickets**: Base32-encoded connection tokens for secure session sharing
- **Real-time Terminal I/O**: sshx-style asynchronous I/O loop using tokio::select!
- **Cross-Platform Shell Support**: Automatic detection and configuration of Zsh, Bash, Fish, Nushell, PowerShell
- **Mobile Optimization**: Adaptive terminal interface with viewport-aware layouts

### Frontend Architecture
- **Mobile-First Design**: Responsive layouts with dynamic viewport management
- **Touch Optimization**: Gesture controls and appropriate tap targets for mobile devices  
- **Keyboard Management**: Advanced mobile keyboard handling with automatic viewport adjustment
- **AI Integration**: Natural language terminal command generation through chat interface
- **Multi-Terminal Support**: Tab-based terminal management with session persistence
- **Real-time Updates**: Reactive UI using SolidJS with immediate terminal output synchronization

## Configuration Files

- `Cargo.toml` - Workspace configuration with shared dependencies and build profiles
- `package.json` - Frontend dependencies and build scripts, specifies pnpm@10.0.0 as package manager
- `app/tauri.conf.json` - Tauri application configuration with pnpm dev/build commands
- `app/capabilities/` - Platform-specific permission configurations:
  - `main.json` - Main application permissions
  - `desktop.json` - Desktop-specific capabilities
  - `mobile.json` - Mobile-specific capabilities
- `vite.config.ts` - Vite build configuration for SolidJS (server on localhost:1420)
- `tailwind.config.js` - TailwindCSS configuration with DaisyUI themes
- `postcss.config.js` - PostCSS configuration for TailwindCSS processing

## Dependencies and Ecosystem

### Core Rust Dependencies
- **iroh** (0.95) - P2P networking with NAT traversal and QUIC protocol
- **tokio** (1.47) - Async runtime with full features (net, fs, rt-multi-thread)
- **portable-pty** (0.9) - Cross-platform pseudo-terminal
- **tauri** (2) - Cross-platform desktop/mobile framework
- **crossterm** (0.29) - Cross-platform terminal manipulation
- **bincode** (1.3) - Efficient binary serialization for message protocol
- **chacha20poly1305** (0.10) - End-to-end encryption for P2P communication

### Frontend Dependencies
- **solid-js** (1.9.9) - Reactive UI framework
- **@xterm/xterm** (5.5.0) - Terminal emulator with addons (canvas, fit, search, web-links, webgl)
- **daisyui** (5.0.50) - TailwindCSS component library
- **lucide-solid** (0.540.0) - Icon library
- **@tanstack/ai-solid** (0.0.2) - AI integration for natural language terminal commands
- **vconsole** (3.15.1) - Mobile debugging console for development

### Key Features
- **Package Manager**: pnpm@10.0.0 (specified in package.json)
- **Build Profiles**: 
  - Release with LTO, strip, and single codegen-unit optimization
  - Production profile inherits release with panic=abort for smaller binaries
- **Workspace Dependencies**: Centralized dependency management in root Cargo.toml
- **Development Tools**: TypeScript strict mode, comprehensive linting with clippy and fmt

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
- CLI ticket generation testing with `test_ticket_output.sh`
- Mobile debugging with `vconsole` for in-app console during development
- Frontend development server runs on `http://localhost:1420` with hot reload
- GitHub Actions CI/CD pipeline for automated testing and releases
- Browser client WebAssembly debugging with browser dev tools

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
- Development server runs frontend on `http://localhost:1420` with hot reload and network access enabled
- Vite configuration ignores `**/src-tauri/**` for watching (legacy pattern)
- Mobile builds require platform-specific toolchains (Android SDK, Xcode)
- Browser client uses `wasm-pack` for WASM compilation and web bundling
- Tauri automatically runs `pnpm dev` before development and `pnpm build` before building

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
