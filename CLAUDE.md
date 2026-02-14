# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RiTerm** is a P2P terminal session sharing tool built with Rust, SolidJS, and Tauri. It enables real-time terminal collaboration across multiple platforms using iroh's P2P networking with end-to-end encryption. The project supports both Chinese and English users, with comprehensive documentation in both languages.

## Architecture

The project is organized as a Cargo workspace with four main components:

- **cli/** - Command-line interface tool for hosting terminal sessions
- **app/** - Tauri-based multi-platform application (desktop + mobile)
- **shared/** - Common networking and messaging protocols
- **browser/** - Web browser client implementation (WebAssembly)
- **src/** - SolidJS frontend application

### Core Components

1. **P2P Networking** (`shared/src/`)
   - `message_protocol.rs` - Core message types and protocols with unified messaging system
   - `quic_server.rs` - QUIC-based server implementation
   - `event_manager.rs` - Event handling and coordination
   - `browser.rs` - Browser-specific P2P implementation (WASM)

2. **CLI Tool** (`cli/src/`)
   - `message_server.rs` - Host server for Tauri/mobile connections with MessageHandler implementations
   - `main.rs` - CLI entry point with `host` subcommand
   - `shell.rs` - Shell detection and configuration
   - `terminal_logger.rs` - Terminal logging module with file-based I/O recording

3. **Tauri App** (`app/src/`)
   - `lib.rs` - Main Tauri backend with session management
   - `tcp_forwarding.rs` - TCP forwarding session management
   - `main.rs` - Tauri application entry point
   - Terminal creation, input handling, and P2P coordination

4. **Frontend** (`src/`)
   - **SolidJS Start** (`@solidjs/start`) with Vinxi build tool (modern SSR-ready framework)
   - File-based routing with `src/routes/` directory
   - Entry points: `src/app.tsx` (root), `src/entry-client.tsx`, `src/entry-server.tsx`
   - Mobile-first responsive design with adaptive layouts
   - Terminal UI using **ghostty-web** (modern WASM-based terminal emulator)
   - Components: `HomeView.tsx`, `RemoteSessionView.tsx`, `SettingsModal.tsx`
   - UI Components: `CyberComponents`, `CyberEffects`, `EnhancedComponents`, `GestureSettings`, `KeyboardAwareContainer`, `MobileNavigation`, `QuickAccessToolbar`, `ThemeSwitcher`

## Development Commands

### Build and Run

```bash
# Build CLI tool
cd cli && cargo build --release

# Run CLI host server
./cli/target/release/cli host

# Run CLI with custom options
./cli/target/release/cli host --relay https://relay.example.com --max-connections 100 --temp-key

# Build Tauri app
pnpm tauri:build

# Development mode (full app with hot reload)
pnpm tauri:dev

# Build frontend only (Vinxi build to .output/public)
pnpm build

# Development server (Vinxi dev server on localhost:1420)
pnpm dev

# Type checking
pnpm tsc
```

### Mobile Development

```bash
# Android development
pnpm tauri:android:dev

# Build Android APK
pnpm tauri:android:build

# iOS development (macOS only)
pnpm tauri:ios:dev

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

# Test CLI ticket generation
./test_ticket_output.sh

# GitHub Actions (CI/CD)
# - .github/workflows/build-and-test.yml - Automated builds and tests
# - .github/workflows/publish-to-auto-release.yml - Automated releases
```

### Code Quality and Development Tools

```bash
# TypeScript type checking
pnpm tsc

# Frontend development server (Vinxi on localhost:1420)
pnpm dev

# Build frontend (Vinxi to .output/public)
pnpm build

# Preview built frontend
pnpm serve  # Vinxi production server

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
# Install dependencies (use pnpm as specified in package.json)
pnpm install

# Start development with hot reload (full Tauri app)
pnpm tauri:dev

# For frontend-only development (localhost:1420 via Vinxi)
pnpm dev

# Type checking
pnpm tsc

# Build frontend (Vinxi build to .output/public)
pnpm build

# Build full app for production
pnpm build && pnpm tauri:build
```

**Package Manager**: The project specifies `pnpm@10.28.2` as the package manager in `package.json`. The project uses `@solidjs/start` with Vinxi build tool.

## Key Technical Details

### Architecture Overview

**RiTerm** is a P2P terminal session sharing tool built as a Cargo workspace with four main components:

1. **CLI Tool** (`cli/`) - Rust-based command-line interface for hosting terminal sessions
2. **Tauri App** (`app/`) - Cross-platform desktop/mobile application (Rust backend + SolidJS frontend)
3. **Shared Library** (`shared/`) - Common networking protocols, message types, and utilities
4. **Browser Client** (`browser/`) - WebAssembly-based browser client for terminal access only
5. **Frontend** (`src/`) - **SolidJS application** (not React) with mobile-first responsive design

The project uses **iroh** for P2P networking with NAT traversal and end-to-end encryption, enabling real-time terminal collaboration without requiring a central server.

### Message Protocol Architecture

The project implements a unified message system through `shared/src/message_protocol.rs`:

- **Message Struct**: Central message type with structured payload and routing
- **MessageType Enum**: Categories for terminal data, TCP forwarding, session management, etc.
- **MessageHandler Trait**: Extensible handler system for different message types
- **Serialization**: Uses bincode for efficient network serialization with length prefixes

**Important**: The frontend uses **SolidJS**, not React. SolidJS is a reactive framework with fine-grained reactivity, distinct from React's component model.

Key message flows:

1. Frontend → Tauri/WASM → Message struct → P2P Network → CLI Host
2. CLI processes terminal operations and sends responses back through the chain
3. Browser client can connect directly using WebAssembly P2P implementation

**Terminal Actions** include:

- `Create` - Create new terminal session
- `List` - List all terminals
- `Stop` - Stop a terminal
- `Resize` - Resize terminal dimensions
- `Input` - Send input to terminal
- `GetLogs` - Retrieve terminal logs (new)

### Session and Connection Management

- **Session Tickets**: Uses iroh-tickets standard format (base64-encoded NodeAddr) for secure P2P connection sharing
- **Concurrent Connections**: Supports up to 50 simultaneous participants per session
- **Event Buffering**: 5000 event limit per session with automatic cleanup
- **Memory Management**: 5-minute interval cleanup tasks for inactive sessions
- **Session Recovery**: Automatic reconnection and session state restoration after network interruptions
- **QR Code Support**: Fast QR code generation for easy mobile ticket sharing

### Core Components

#### P2P Networking (`shared/src/`)

- `quic_server.rs` - QUIC-based server with connection multiplexing and message routing
- `event_manager.rs` - Event coordination, buffering, and session lifecycle management
- `communication_manager.rs` - High-level P2P communication and connection handling
- `message_protocol.rs` - Unified message system with extensible handler architecture

#### CLI Tool (`cli/src/`)

- `message_server.rs` - Host server with MessageHandler implementations for different message types
- `main.rs` - CLI entry point with `host` subcommand using clap
- `shell.rs` - Cross-platform shell detection (Zsh, Bash, Fish, Nushell, PowerShell)

#### Tauri App (`app/src/`)

- `lib.rs` - Main Tauri backend with session management and P2P coordination
- Terminal creation, input handling, and real-time output forwarding
- Mobile/desktop capability management with conditional compilation
- TCP forwarding session management and statistics tracking

#### Frontend (`src/`)

- **SolidJS Start** (`@solidjs/start`) with file-based routing in `src/routes/`
- Vinxi build tool wraps Vite for enhanced SSR capabilities
- Root component: `src/app.tsx` with `FileRoutes` from `@solidjs/start/router`
- Mobile-first responsive design with ViewportManager and AdaptiveLayoutManager utilities
- Terminal UI using **ghostty-web** (modern WASM-based terminal emulator, migrated from xterm.js)
- Main components: `HomeView.tsx`, `RemoteSessionView.tsx`, `SettingsModal.tsx`
- UI components: `CyberComponents`, `CyberEffects`, `EnhancedComponents`, `GestureSettings`, `KeyboardAwareContainer`, `MobileNavigation`, `QuickAccessToolbar`, `ThemeSwitcher`

#### Browser Client (`browser/src/`)

- WebAssembly implementation using wasm-bindgen for browser P2P networking
- Terminal-only functionality (no TCP forwarding due to security constraints)
- Direct P2P connection capability without native app installation

### P2P Architecture and Terminal I/O

- **iroh Networking**: P2P communication with NAT traversal and no central server dependency
- **End-to-End Encryption**: ChaCha20Poly1305 encryption for all terminal data
- **QUIC Protocol**: Reliable message delivery with connection multiplexing
- **Session Tickets**: Uses iroh-tickets standard format (base64-encoded NodeAddr) for secure P2P connection sharing
- **QR Code Generation**: Fast QR code generation via `fast_qr` crate for easy ticket sharing on mobile
- **Real-time Terminal I/O**: sshx-style asynchronous I/O loop using tokio::select!
- **Cross-Platform Shell Support**: Automatic detection and configuration of Zsh, Bash, Fish, Nushell, PowerShell
- **Mobile Optimization**: Adaptive terminal interface with viewport-aware layouts
- **Session Recovery**: Automatic reconnection and session state restoration

### Terminal Logging

- **Automatic I/O Recording**: All terminal input and output is automatically logged to files
- **Log Location**: Logs are stored in `.riterm/logs/` directory with format `{terminal_id}.log`
- **Log Rotation**: Default maximum of 1000 lines per terminal (configurable)
- **Log Retrieval**: Use `get_terminal_logs` Tauri command to retrieve logs via P2P
- **Log Format**: Each log entry includes timestamp, level (INPUT/OUTPUT/ERROR), and data
- **Memory Cache**: Recent logs are cached in memory for fast access
- **File Persistence**: Logs are persisted to disk for session recovery and auditing

### Frontend Architecture

- **@solidjs/start Framework**: Modern SSR-ready architecture with file-based routing
- **Mobile-First Design**: Responsive layouts with dynamic viewport management
- **ViewportManager Utility**: Advanced viewport height management with keyboard awareness
- **AdaptiveLayoutManager**: Responsive layout class application based on device capabilities
- **Touch Optimization**: Gesture controls and appropriate tap targets for mobile devices
- **Keyboard Management**: Advanced mobile keyboard handling with automatic viewport adjustment
- **Real-time Updates**: Reactive UI using SolidJS fine-grained reactivity
- **Terminal Emulator**: ghostty-web (WASM-based, migrated from xterm.js)
- **Components**: HomeView (connection screen), RemoteSessionView (terminal interface), SettingsModal

## Configuration Files

- `Cargo.toml` - Workspace configuration with shared dependencies and build profiles
- `package.json` - Frontend dependencies and build scripts, specifies pnpm@10.28.2 as package manager
- `app/tauri.conf.json` - Tauri application configuration (uses pnpm dev/build commands, devUrl: localhost:1420)
- `app/capabilities/` - Platform-specific permission configurations
- `app.config.ts` - **@solidjs/start** configuration with Vinxi build tool (replaces vite.config.ts)
- `tailwind.config.js` - TailwindCSS configuration with DaisyUI themes

## Dependencies and Ecosystem

### Core Rust Dependencies

- **iroh** (0.95) - P2P networking with NAT traversal and QUIC protocol
- **tokio** (1.47) - Async runtime with full features (net, fs, rt-multi-thread)
- **portable-pty** (0.9) - Cross-platform pseudo-terminal
- **tauri** (2) - Cross-platform desktop/mobile framework (with macos-private-api feature)
- **crossterm** (0.29) - Cross-platform terminal manipulation
- **bincode** (1.3) - Efficient binary serialization for message protocol
- **chacha20poly1305** (0.10) - End-to-end encryption for P2P communication
- **Rust 2024 Edition**: The `app` crate uses Rust 2024 edition

### Frontend Dependencies

- **solid-js** (1.9.11) - Reactive UI framework (SolidJS, not React)
- **@solidjs/start** (1.2.1) - Modern SolidJS framework with SSR support
- **@solidjs/router** (0.15.4) - File-based routing
- **vinxi** (0.5.11) - Build tool wrapping Vite for enhanced features
- **ghostty-web** (0.3.0) - Modern WASM-based terminal emulator (migrated from xterm.js)
- **daisyui** (5.5.14) - TailwindCSS component library
- **lucide-solid** (0.540.0) - Icon library
- **vconsole** (3.15.1) - Mobile debugging console for development
- **solid-sonner** - Toast notifications for SolidJS

### Key Features

- **Package Manager**: pnpm@10.28.2 (specified in package.json)
- **Build Profiles**:
  - Release with LTO, strip, and single codegen-unit optimization
  - Production profile inherits release with panic=abort for smaller binaries
- **Workspace Dependencies**: Centralized dependency management in root Cargo.toml
- **Development Tools**: TypeScript strict mode, comprehensive linting with clippy and fmt
- **Tauri Plugins**:
  - `tauri-plugin-notification` - In-app notifications
  - `tauri-plugin-clipboard-manager` - Clipboard operations
  - `tauri-plugin-http` - HTTP requests
  - `tauri-plugin-os` - OS information
  - `tauri-plugin-barcode-scanner` - QR code scanning (mobile only)
  - `tauri-plugin-single-instance` - Single instance enforcement (desktop only)
  - `tauri-plugin-updater` - App updates (desktop only)

## Development Notes

### Code Organization

- The codebase uses conditional compilation for mobile vs desktop features
- Performance optimizations include event batching and memory limits
- Logging levels are adjusted based on build configuration (debug vs release)
- Mobile apps include gesture controls and adaptive layouts

### Recent Major Changes

- **Migrated to @solidjs/start** - Modern SSR-ready SolidJS framework with Vinxi build tool
- **Switched to ghostty-web** - Modern WASM-based terminal emulator (replaced xterm.js)
- Implemented unified message protocol replacing previous TerminalCommand/Response system
- Fixed terminal I/O synchronization issues for real-time interaction
- Enhanced mobile viewport management with ViewportManager and AdaptiveLayoutManager
- Improved connection management and reliability with session reconnection
- Implemented TCP service forwarding with full app-CLI coordination
- Added TCP forwarding session management in `app/src/tcp_forwarding.rs`
- Added browser client with WebAssembly support for direct web access
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
- `app/src/tcp_forwarding.rs` - TCP forwarding session management module
- `app/src/lib.rs` - Provides Tauri commands for TCP forwarding management
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

- **ViewportManager Utility** (`src/utils/mobile/ViewportManager.ts`): Centralized viewport height management with keyboard awareness
- **AdaptiveLayoutManager** (`src/utils/mobile/AdaptiveLayoutManager.ts`): Responsive layout class application
- **MobileKeyboard Utility** (`src/utils/mobile/index.ts`): Touch device keyboard state tracking
- **Device Store** (`src/stores/deviceStore.ts`): Device capability detection and caching
- Touch-optimized UI with appropriate tap targets (minimum 44x44px)
- Adaptive layouts for different screen sizes (breakpoint-based classes)
- Safe area insets for mobile devices (notch/sensor accommodation)
- Performance optimizations for mobile hardware (virtual scrolling, lazy loading)
- HMR (Hot Module Replacement) for mobile development with configurable WebSocket host

### Testing and Debugging

- Comprehensive logging system with configurable levels
- Development-time debug information in mobile builds
- Session management testing utilities
- Message protocol validation
- Terminal I/O synchronization testing
- CLI ticket generation testing with `test_ticket_output.sh`
- Mobile debugging with `vconsole` for in-app console during development (auto-initialized in src/app.tsx)
- Frontend development server runs on `http://localhost:1420` via Vinxi with HMR
- GitHub Actions CI/CD pipeline for automated testing and releases
  - `.github/workflows/build-and-test.yml` - Development builds and tests
  - `.github/workflows/publish-to-auto-release.yml` - Automated releases
- Browser client WebAssembly debugging with browser dev tools

## Build Targets and Workspace Structure

### Project Structure

```
riterm/
├── cli/                 # CLI tool (Rust) → builds to `cli/target/`
├── app/                 # Tauri app (Rust + SolidJS) → builds to `app/target/`
├── shared/              # Shared networking protocols (Rust library)
├── browser/             # Browser client (Rust + WebAssembly)
├── src/                 # SolidJS Start frontend application
│   ├── app.tsx          # Root component with Router
│   ├── entry-client.tsx # Client-side entry
│   ├── entry-server.tsx # Server-side entry (SSR)
│   ├── routes/          # File-based routing (index.tsx is main page)
│   └── components/      # UI components
└── .output/public/      # Vinxi build output (served by Tauri in production)
```

### Build Targets

- **CLI**: `cli/target/release/cli` or `cli/target/debug/cli`
- **Desktop App**: `app/target/release/bundle/` (macOS .app, Windows .exe, Linux AppImage)
- **Mobile Apps**: Generated in `app/gen/android/` (APK) and `app/gen/apple/` (iOS .ipa)
- **Browser Client**: `browser/dist/` (WASM + HTML/JS/CSS for web deployment)
- **Frontend**: `.output/public/` directory (Vinxi build output, served by Tauri in production)

### Build Process Notes

- The project uses a Cargo workspace with four crates: `cli`, `app`, `shared`, and `browser`
- Frontend uses **@solidjs/start** with **Vinxi** build tool (modern SSR-ready architecture)
- Frontend builds to `.output/public/` which Tauri packages in the final app
- The `app` directory contains the Tauri backend and mobile app code
- The `browser` directory contains a pure web client using WebAssembly
- Development server runs frontend on `http://localhost:1420` via `PORT=1420 vinxi dev`
- File-based routing via `@solidjs/start/router` with `FileRoutes`
- Mobile builds require platform-specific toolchains (Android SDK, Xcode)
- Browser client uses `wasm-pack` for WASM compilation and web bundling
- Tauri automatically runs `pnpm dev` before development and `pnpm build` before building
- Use scripts: `pnpm tauri:android:dev`, `pnpm tauri:android:build`, `pnpm tauri:ios:dev`, `pnpm tauri:ios:build`

## Common Development Patterns

### Adding New Terminal Features

1. Define message types in `shared/src/message_protocol.rs`
2. Implement CLI handlers in `cli/src/message_server.rs` (MessageHandler implementations)
3. Add Tauri commands in `app/src/lib.rs`
4. Create/update frontend components in `src/components/`
5. Update routes in `src/routes/` if adding new pages
6. Update mobile viewport management if needed (ViewportManager/AdaptiveLayoutManager)

### Adding New TCP Forwarding Features

1. Define new TCP message types in `shared/src/message_protocol.rs`
2. Implement TCP handlers in `cli/src/message_server.rs` (TcpForwardingMessageHandler or TcpDataMessageHandler)
3. Add Tauri commands in `app/src/lib.rs` or update `app/src/tcp_forwarding.rs`
4. Update the frontend components (e.g., RemoteSessionView.tsx)
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

- Test with both Android and iOS when possible
- Consider touch targets and gesture handling
- Use conditional compilation for platform-specific features
- Test with various screen sizes and orientations
- iOS device logs: `idevicesyslog | grep RiTerm`

### Session Management

- Always handle session cleanup in component unmount effects
- Monitor event count to stay within buffer limits
- Implement proper error handling for network interruptions

### Internationalization

- The project supports both Chinese and English users
- README.md contains comprehensive Chinese documentation
- User interface should consider bilingual support where appropriate
- Error messages and logs may include Chinese content for Chinese users
