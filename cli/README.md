# CLI - Terminal Session Host

The CLI component is designed exclusively for **hosting** terminal sessions. It provides a simple, focused interface for sharing terminal access with remote clients.

## 🎯 **Purpose**

- **Host terminal sessions** for remote access
- **Generate session tickets** for mobile clients to join
- **Record sessions** for later playback
- **Manage shell environments** and configurations

## 🚀 **Usage**

### Start a Terminal Session
```bash
# Basic session
iroh-code-remote host

# Custom shell and dimensions
iroh-code-remote host --shell zsh --width 120 --height 40

# With session title and recording
iroh-code-remote host --title "Development Session" --save session.json

# Passthrough mode (like asciinema)
iroh-code-remote host --passthrough

# List available shells
iroh-code-remote host --list-shells
```

### Playback Recorded Sessions
```bash
iroh-code-remote play session.json
```

## 📱 **Client Access**

Once a session is hosted, clients can join using:

1. **QR Code**: Scan the displayed QR code with the mobile app
2. **Session Ticket**: Copy the session ticket to the mobile app
3. **Direct Connection**: Use the node address for direct connection

## 🏗️ **Architecture**

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Host Tool                        │
├─────────────────────────────────────────────────────────┤
│  Host Command  │  Play Command  │  Shell Management     │
├─────────────────────────────────────────────────────────┤
│           Session Management (Host Only)                │
├─────────────────────────────────────────────────────────┤
│              Terminal Integration                       │
├─────────────────────────────────────────────────────────┤
│                P2P Network Layer                        │
└─────────────────────────────────────────────────────────┘
```

## 🔧 **Features**

### **Session Hosting**
- ✅ Multiple shell support (bash, zsh, fish, nushell, powershell)
- ✅ Custom terminal dimensions
- ✅ Session recording and playback
- ✅ QR code generation for easy mobile access
- ✅ Passthrough mode for seamless terminal experience

### **Network**
- ✅ P2P networking with iroh
- ✅ Custom relay server support
- ✅ Automatic peer discovery
- ✅ Encrypted communication

### **Mobile Integration**
- ✅ QR code scanning support
- ✅ Session ticket generation
- ✅ Real-time terminal streaming
- ✅ Cross-platform compatibility

## 🔄 **Workflow**

1. **Start CLI Host**: `iroh-code-remote host`
2. **Share Access**: Show QR code or session ticket to mobile users
3. **Mobile Join**: Users scan QR code or enter ticket in mobile app
4. **Terminal Sharing**: Real-time terminal access for all participants
5. **Session End**: Host terminates session, optionally saves recording

## 🎛️ **Configuration**

### **Shell Selection**
```bash
# Automatic detection
iroh-code-remote host

# Specific shell
iroh-code-remote host --shell bash
iroh-code-remote host --shell zsh
iroh-code-remote host --shell fish
```

### **Terminal Dimensions**
```bash
# Custom size
iroh-code-remote host --width 120 --height 40

# Default: 80x24
iroh-code-remote host
```

### **Recording**
```bash
# Save session
iroh-code-remote host --save my-session.json

# Playback later
iroh-code-remote play my-session.json
```

## 🔗 **Integration with Mobile App**

The CLI generates session tickets that mobile clients can use to join:

```
Session Ticket: MFRGG43FMZXW6YTBMJQXIZLTOQQHEZLTMVZXG5DJNZ2HE2LTMVZXG5DJNZ2HE2LT
```

Mobile users can:
- **Scan QR Code**: Instant session joining
- **Enter Ticket**: Manual ticket entry
- **Browse Sessions**: See available sessions (mobile app feature)

## 🛠️ **Development**

### **Build**
```bash
cargo build --release
```

### **Test**
```bash
cargo test
```

### **Run**
```bash
cargo run -- host --shell bash
```

## 📋 **Comparison: CLI vs Mobile App**

| Feature | CLI (Host) | Mobile App (Client) |
|---------|------------|-------------------|
| Host Sessions | ✅ Primary | ❌ Not supported |
| Join Sessions | ❌ Removed | ✅ Primary |
| List Sessions | ❌ Removed | ✅ Primary |
| QR Code Scan | ❌ N/A | ✅ Primary |
| Terminal I/O | ✅ Host side | ✅ Client side |
| Session Recording | ✅ Host side | ✅ View only |
| Shell Management | ✅ Host side | ❌ N/A |

This separation ensures each tool has a clear, focused purpose and provides the best user experience for its intended use case.