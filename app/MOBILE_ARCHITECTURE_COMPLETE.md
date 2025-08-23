# Mobile App Architecture - Complete Guide

## 🏗️ **Architecture Overview**

The mobile app follows a **service-oriented architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React/Vue)                 │
├─────────────────────────────────────────────────────────┤
│                    Tauri Commands                       │
├─────────────────────────────────────────────────────────┤
│                    Services Layer                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │
│  │   Network   │ │   Session   │ │     Terminal        │ │
│  │   Service   │ │   Service   │ │     Service         │ │
│  └─────────────┘ └─────────────┘ └─────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│                    State Management                     │
├─────────────────────────────────────────────────────────┤
│                    Core P2P Layer                       │
└─────────────────────────────────────────────────────────┘
```

## 📁 **Directory Structure**

```
app/src-tauri/src/
├── commands/           # Tauri command handlers
│   ├── network.rs     # Network-related commands
│   ├── session.rs     # Session management commands
│   └── terminal.rs    # Terminal I/O commands
├── services/          # Business logic services
│   ├── network_service.rs    # Network management
│   ├── session_service.rs    # Session lifecycle
│   └── terminal_service.rs   # Terminal operations
├── state/             # Application state
│   └── app_state.rs   # Main state container
├── config/            # Configuration management
│   └── mod.rs         # Mobile app configuration
├── events/            # Event system
│   └── mod.rs         # Real-time event handling
├── error/             # Error handling
│   └── mod.rs         # Custom error types
└── lib.rs             # Main entry point
```

## 🔧 **Core Components**

### **1. Services Layer**

#### **NetworkService**
- **Purpose**: Manages P2P network connections
- **Responsibilities**:
  - Initialize/shutdown network
  - Connect to peers
  - Monitor network status
  - Provide network statistics

#### **SessionService**
- **Purpose**: Handles terminal session lifecycle
- **Responsibilities**:
  - Create/join sessions
  - Track session state
  - Manage session metadata
  - Handle disconnections

#### **TerminalService**
- **Purpose**: Manages terminal I/O and history
- **Responsibilities**:
  - Send/receive terminal data
  - Maintain command history
  - Export session logs
  - Handle terminal events

### **2. State Management**

#### **AppState**
- **Centralized state container**
- **Service coordination**
- **Configuration management**
- **Lifecycle management**

### **3. Command Layer**

#### **Tauri Commands**
- **Thin wrappers** around service calls
- **Input validation**
- **Error handling**
- **Response formatting**

### **4. Event System**

#### **EventManager**
- **Real-time updates** to frontend
- **Session status changes**
- **Network events**
- **Terminal output streaming**

## 🚀 **Key Features**

### **1. Service-Oriented Design**
- **Single Responsibility**: Each service has one clear purpose
- **Dependency Injection**: Services are injected into commands
- **Testability**: Easy to mock and test individual services
- **Maintainability**: Clear boundaries between components

### **2. Configuration Management**
- **Centralized config**: All settings in one place
- **Environment-specific**: Different configs for dev/prod
- **Runtime updates**: Config can be updated without restart
- **Type safety**: Strongly typed configuration structs

### **3. Error Handling**
- **Custom error types**: Specific errors for different scenarios
- **Error propagation**: Errors bubble up through layers
- **User-friendly messages**: Clear error descriptions
- **Logging integration**: Errors are logged for debugging

### **4. Real-time Events**
- **WebSocket-like experience**: Real-time terminal updates
- **Event streaming**: Continuous data flow to frontend
- **Status updates**: Session and network status changes
- **History replay**: Can replay terminal history

## 📱 **Mobile-Specific Features**

### **1. QR Code Integration**
```json
// mobile.json capabilities
{
  "permissions": [
    "barcode-scanner:allow-scan",
    "barcode-scanner:allow-cancel",
    "barcode-scanner:default"
  ]
}
```

### **2. Platform Support**
- **iOS**: Native iOS app with Tauri
- **Android**: Native Android app with Tauri
- **Cross-platform**: Shared Rust backend

### **3. Mobile UI Considerations**
- **Touch-friendly**: Optimized for touch interfaces
- **Responsive**: Adapts to different screen sizes
- **Offline support**: Can work without network (limited)
- **Battery optimization**: Efficient resource usage

## 🔄 **Data Flow**

### **1. Session Creation Flow**
```
Frontend → create_session command → SessionService → NetworkService → P2P Layer
```

### **2. Terminal Input Flow**
```
Frontend → send_input command → TerminalService → NetworkService → P2P Network
```

### **3. Event Flow**
```
P2P Network → EventManager → Frontend (real-time updates)
```

## 🧪 **Testing Strategy**

### **1. Unit Tests**
- **Service testing**: Test each service independently
- **Mock dependencies**: Use mocks for external dependencies
- **Error scenarios**: Test error handling paths

### **2. Integration Tests**
- **Command testing**: Test Tauri commands end-to-end
- **Service integration**: Test service interactions
- **Network testing**: Test P2P functionality

### **3. Mobile Testing**
- **Device testing**: Test on real devices
- **Platform testing**: Test iOS and Android separately
- **Performance testing**: Monitor resource usage

## 🔧 **Configuration Examples**

### **Network Configuration**
```rust
NetworkConfig {
    default_relay: Some("https://relay.example.com".to_string()),
    connection_timeout_ms: 30000,
    retry_attempts: 3,
    heartbeat_interval_ms: 10000,
}
```

### **UI Configuration**
```rust
UiConfig {
    theme: "dark".to_string(),
    font_size: 14,
    auto_scroll: true,
    show_timestamps: false,
}
```

### **Session Configuration**
```rust
SessionConfig {
    auto_reconnect: true,
    max_history_lines: 1000,
    buffer_size: 1024,
}
```

## 🚀 **Deployment**

### **1. Build Process**
```bash
# Build for iOS
tauri ios build

# Build for Android
tauri android build
```

### **2. Distribution**
- **App Store**: iOS distribution through App Store
- **Google Play**: Android distribution through Play Store
- **Direct APK**: Direct Android APK distribution

## 🔮 **Future Enhancements**

### **1. Offline Support**
- **Local storage**: Cache sessions locally
- **Sync on reconnect**: Sync when network returns
- **Offline indicators**: Show offline status

### **2. Advanced Features**
- **File transfer**: Send files through sessions
- **Screen sharing**: Share mobile screen
- **Voice chat**: Add voice communication
- **Collaboration**: Multiple users in same session

### **3. Performance Optimizations**
- **Connection pooling**: Reuse network connections
- **Data compression**: Compress terminal data
- **Battery optimization**: Reduce power consumption
- **Memory management**: Efficient memory usage

This architecture provides a solid foundation for a scalable, maintainable mobile terminal sharing application with clear separation of concerns and excellent testability.