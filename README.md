# Roterm - Modern Shell-Aware Terminal Session Sharing

A next-generation terminal session sharing tool powered by iroh P2P network with comprehensive shell support.

## 🌟 Features

### Multi-Shell Support
- **Bash** - Traditional Bourne Again Shell
- **Zsh** - Enhanced Z Shell with better completions
- **Fish** - Friendly Interactive Shell with smart autosuggestions
- **Nushell** - Modern shell with structured data support
- **PowerShell** - Cross-platform task automation framework
- **Custom Shells** - Support for any shell executable

### Session Modes
- **Passthrough Mode** (like asciinema) - Natural terminal interaction with real-time sharing
- **Standard Mode** - Traditional recording with playback support

### P2P Networking
- Real-time terminal sharing via iroh network
- Peer-to-peer connection without central servers
- End-to-end encrypted communication
- Multi-participant sessions

## 🚀 Quick Start

### Installation
```bash
git clone <repository>
cd roterm
cargo build --release
```

### List Available Shells
```bash
roterm host --list-shells
```

Example output:
```
🐚 Available Shells:

 1. Bash - bash
→2. Zsh - zsh (current)
 3. Fish - fish
 4. Nushell - nu

💡 Use --shell <name> to specify a shell, or let roterm detect automatically
```

### Start a Session

#### With Automatic Shell Detection
```bash
roterm host --passthrough
```

#### With Specific Shell
```bash
# Start a Fish shell session
roterm host --shell fish --passthrough

# Start a Nushell session
roterm host --shell nu --passthrough

# Start a Zsh session with recording
roterm host --shell zsh --passthrough --save session.json
```

### Join a Session
```bash
roterm join <session-id> --peer <node-addr>
```

### Playback Recorded Sessions
```bash
roterm play session.json
```

## 🔧 Shell-Specific Features

### Bash
- Custom PS1 prompt with colors
- Proper BASH_ENV setup
- Interactive mode with history

### Zsh
- Enhanced prompt with colors and git info
- ZDOTDIR configuration support
- Autoload colors and completion system

### Fish
- Custom greeting message
- Smart autosuggestions
- Fish-specific prompt function

### Nushell
- Structured data output support
- Modern command syntax
- Built-in data manipulation

### PowerShell
- Cross-platform support
- Colorized output
- Advanced scripting capabilities

## 🎯 Use Cases

### Remote Pair Programming
```bash
# Host starts a session
roterm host --shell fish --passthrough --title "Pair Programming Session"

# Others join to collaborate in real-time
roterm join <session-id> --peer <host-addr>
```

### Teaching and Demonstrations
```bash
# Teacher starts recorded session
roterm host --shell zsh --passthrough --save lesson.json

# Students can replay later
roterm play lesson.json
```

### Shell Comparisons
```bash
# Try different shells easily
roterm host --shell fish --passthrough
roterm host --shell nu --passthrough
roterm host --shell zsh --passthrough
```

## 🛠️ Advanced Configuration

### Environment Variables
Each shell gets properly configured environment variables:
- `TERM=xterm-256color` for proper terminal support
- `SHELL` set to the correct shell path
- Shell-specific variables (ZDOTDIR for zsh, etc.)
- `ROTERM_SESSION_ID` for session identification

### Initialization Commands
Each shell runs appropriate initialization:
- Bash: Custom PS1, environment setup
- Zsh: Color loading, enhanced prompt
- Fish: Custom greeting, prompt function
- Nushell: Session startup message

### Session Headers
```json
{
  "version": 2,
  "width": 80,
  "height": 24,
  "timestamp": 1699123456,
  "title": "My Session",
  "command": "fish -i",
  "session_id": "uuid-here"
}
```

## 📊 Session Format

Roterm uses a JSON-based session format compatible with asciinema:

```json
[
  {
    "timestamp": 0.0,
    "event_type": "Start",
    "data": "fish -i"
  },
  {
    "timestamp": 1.234,
    "event_type": "Output", 
    "data": "Welcome to Fish shell!"
  },
  {
    "timestamp": 2.456,
    "event_type": "Input",
    "data": "ls -la\n"
  }
]
```

## 🔐 Security Features

- P2P encryption via iroh
- No data stored on external servers
- Session IDs are cryptographically secure
- Environment isolation per shell

## 🎨 Shell Customization

### Adding Custom Shells
```rust
let custom_shell = ShellType::Custom("/path/to/my/shell".to_string());
let config = ShellConfig::new(custom_shell);
```

### Custom Initialization
Each shell can have custom init commands:
```rust
pub fn get_init_commands(&self) -> Vec<String> {
  match self {
    ShellType::Custom(cmd) => vec![
      "echo 'Custom shell initialized'".to_string(),
      "export CUSTOM_VAR=value".to_string(),
    ],
    // ... other shells
  }
}
```

## 🚦 Status

- ✅ Multi-shell support (Bash, Zsh, Fish, Nushell, PowerShell)
- ✅ Automatic shell detection
- ✅ Shell-specific environment setup
- ✅ Interactive and passthrough modes
- ✅ P2P session sharing
- ✅ Session recording and playback
- ✅ Cross-platform compatibility
- ⏳ Real-time collaboration features
- ⏳ Enhanced security features
- ⏳ Web-based session viewer

## 🤝 Contributing

Contributions welcome! Areas for improvement:
- Additional shell support
- Enhanced shell-specific features
- UI/UX improvements
- Performance optimizations
- Security enhancements

## 📄 License

[License information here]

---

*Roterm - Making terminal sharing modern, shell-aware, and peer-to-peer.*