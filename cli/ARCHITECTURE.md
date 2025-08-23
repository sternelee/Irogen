# CLI Architecture - Host-Only Terminal Sharing

This document outlines the refactored CLI architecture focused exclusively on hosting terminal sessions. The CLI is designed as a host-only tool, while joining and session management are handled by the mobile app.

## Module Structure

### 1. **Session Management** (`src/session/`)
- **`manager.rs`**: Central session lifecycle management
- **`host.rs`**: Handles hosting terminal sessions
- **`participant.rs`**: Handles joining and participating in sessions

**Responsibilities:**
- Session creation, registration, and cleanup
- P2P network coordination
- Terminal recorder integration
- History callback management

### 2. **Command Handlers** (`src/commands/`)
- **`host.rs`**: Host command implementation
- **`play.rs`**: Session playback command

**Responsibilities:**
- Host session creation and management
- Session recording and playback
- Terminal integration and shell management
- QR code generation for mobile clients

### 3. **User Interface** (`src/ui/`)
- **`display.rs`**: General display and messaging
- **`qr.rs`**: QR code generation and display
- **`shell_list.rs`**: Shell listing display

**Responsibilities:**
- All terminal output formatting
- Color coding and styling
- User interaction feedback

### 4. **Playback** (`src/playback/`)
- **`player.rs`**: Session playback functionality

**Responsibilities:**
- Loading and parsing session files
- Terminal event playback
- Playback controls

### 5. **Configuration** (`src/config/`)
- **`app_config.rs`**: Application-wide settings
- **`network_config.rs`**: Network-specific settings

**Responsibilities:**
- Centralized configuration management
- Default values and validation
- Environment-specific overrides

### 6. **Core Modules** (existing)
- **`p2p.rs`**: P2P networking layer
- **`terminal.rs`**: Terminal recording and playback
- **`shell.rs`**: Shell detection and management

## Benefits of This Architecture

### 1. **Single Responsibility Principle**
Each module has a clear, focused responsibility:
- Session management only handles session lifecycle
- UI modules only handle display logic
- Commands only handle command-specific orchestration

### 2. **Improved Testability**
- Each module can be tested independently
- Mock implementations can be easily created
- Business logic is separated from UI logic

### 3. **Better Error Handling**
- Errors are handled at the appropriate level
- Command-specific error messages
- Centralized error display through UI module

### 4. **Configuration Management**
- All magic numbers moved to configuration
- Environment-specific settings
- Easy to modify behavior without code changes

### 5. **Maintainability**
- Clear module boundaries
- Reduced coupling between components
- Easier to add new features or modify existing ones

## Usage Examples

### Creating a New Command
```rust
// 1. Add to Commands enum in cli_new.rs
NewCommand { param: String },

// 2. Create command handler in src/commands/new.rs
pub struct NewCommand;
impl NewCommand {
    pub async fn execute(session_manager: SessionManager, param: String) -> Result<()> {
        // Command logic here
    }
}

// 3. Add to match statement in cli_new.rs
Commands::NewCommand { param } => {
    NewCommand::execute(self.session_manager, param).await
}
```

### Adding New UI Elements
```rust
// Add to src/ui/display.rs
impl DisplayManager {
    pub fn print_new_message(message: &str) {
        execute!(
            io::stdout(),
            SetForegroundColor(Color::Blue),
            Print(format!("🔵 {}\n", message)),
            ResetColor
        ).ok();
    }
}
```

### Modifying Configuration
```rust
// Update src/config/app_config.rs
pub struct AppConfig {
    pub new_setting: Duration,
    // ... existing fields
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            new_setting: Duration::from_secs(5),
            // ... existing defaults
        }
    }
}
```

## Migration Notes

The old `cli.rs` file has been replaced with:
- `cli_new.rs`: Simplified CLI structure
- Multiple focused modules for each concern

Key changes:
- `CliApp` no longer handles all operations directly
- Session management is centralized in `SessionManager`
- UI operations are handled by dedicated UI modules
- Configuration is externalized and centralized

## Future Improvements

1. **Dependency Injection**: Use a DI container for better testability
2. **Event System**: Implement a pub/sub system for loose coupling
3. **Plugin Architecture**: Allow extending functionality through plugins
4. **Configuration Files**: Support for YAML/TOML configuration files
5. **Metrics Collection**: Add performance and usage metrics