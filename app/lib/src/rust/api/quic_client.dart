import 'package:flutter/foundation.dart';
import '../frb_generated.dart';

/// Flutter API for QUIC terminal client
class QuicClient {
  static FlutterQuicClient? _client;

  /// Initialize the QUIC client
  static FlutterQuicClient createClient() {
    _client ??= createQuicClient();
    return _client!;
  }

  /// Connect to a terminal using a ticket
  static Future<FlutterTerminalSession> connectToTerminal({
    required String ticket,
    String? name,
    String? shellPath,
    String? workingDir,
    required int rows,
    required int cols,
    String? relayUrl,
  }) async {
    final client = createClient();
    return await connectToTerminal(
      client,
      ticket,
      name,
      shellPath,
      workingDir,
      rows,
      cols,
      relayUrl,
    );
  }

  /// Send input to a terminal session
  static Future<void> sendTerminalInput({
    required String sessionId,
    required String input,
  }) async {
    final client = _client;
    if (client == null) {
      throw Exception('QUIC client not initialized');
    }
    await sendTerminalInput(client, sessionId, input);
  }

  /// Resize a terminal
  static Future<void> resizeTerminal({
    required String sessionId,
    required int rows,
    required int cols,
  }) async {
    final client = _client;
    if (client == null) {
      throw Exception('QUIC client not initialized');
    }
    await resizeTerminal(client, sessionId, rows, cols);
  }

  /// Disconnect from a session
  static Future<void> disconnectSession({
    required String sessionId,
  }) async {
    final client = _client;
    if (client == null) {
      throw Exception('QUIC client not initialized');
    }
    await disconnectSession(client, sessionId);
  }

  /// Get all active sessions
  static Future<List<FlutterTerminalSession>> getActiveSessions() async {
    final client = _client;
    if (client == null) {
      return [];
    }
    return await getActiveSessions(client);
  }

  /// Create a new terminal stream
  static Future<FlutterTerminalStream> createTerminalStream({
    String? name,
    String? shellPath,
    String? workingDir,
    required int rows,
    required int cols,
  }) async {
    final client = createClient();
    return await createTerminalStream(
      client,
      name,
      shellPath,
      workingDir,
      rows,
      cols,
    );
  }

  /// Get all active terminals
  static Future<List<FlutterTerminalStream>> getActiveTerminals() async {
    final client = _client;
    if (client == null) {
      return [];
    }
    return await getActiveTerminals(client);
  }

  /// Stop a terminal
  static Future<void> stopTerminal({
    required String streamId,
  }) async {
    final client = _client;
    if (client == null) {
      throw Exception('QUIC client not initialized');
    }
    await stopTerminal(client, streamId);
  }

  /// Validate a ticket
  static Future<bool> validateTicket(String ticket) async {
    try {
      return await validateTicket(ticket);
    } catch (e) {
      debugPrint('Error validating ticket: $e');
      return false;
    }
  }

  /// Generate a test ticket (for development)
  static Future<String> generateTestTicket() async {
    return await generateTestTicket();
  }

  /// Parse terminal size from string
  static (int, int)? parseTerminalSize(String sizeStr) {
    try {
      final result = parseTerminalSize(sizeStr);
      return (result.$1, result.$2);
    } catch (e) {
      debugPrint('Error parsing terminal size: $e');
      return null;
    }
  }

  /// Format terminal size to string
  static String formatTerminalSize(int rows, int cols) {
    return formatTerminalSize(rows, cols);
  }

  /// Get protocol version
  static int get protocolVersion {
    return getProtocolVersion();
  }

  /// Get supported shells
  static List<String> get supportedShells {
    return getSupportedShells();
  }

  /// Get default shell
  static String get defaultShell {
    return getDefaultShell();
  }

  /// Get default working directory
  static String get defaultWorkingDir {
    return getDefaultWorkingDir();
  }
}

/// Extension methods for FlutterTerminalSession
extension FlutterTerminalSessionX on FlutterTerminalSession {
  /// Get session display name
  String get displayName {
    return name ?? 'Terminal $terminalId';
  }

  /// Check if session is active
  bool get isActive {
    return running;
  }

  /// Get size as string
  String get sizeString {
    return QuicClient.formatTerminalSize(size.$1, size.$2);
  }

  /// Copy session with new size
  FlutterTerminalSession withSize(int rows, int cols) {
    return FlutterTerminalSession(
      id: id,
      terminalId: terminalId,
      name: name,
      shellType: shellType,
      currentDir: currentDir,
      size: (rows, cols),
      running: running,
    );
  }
}

/// Extension methods for FlutterTerminalStream
extension FlutterTerminalStreamX on FlutterTerminalStream {
  /// Get stream display name
  String get displayName {
    return name ?? 'Terminal $terminalId';
  }

  /// Check if stream is active
  bool get isActive {
    return running;
  }

  /// Get size as string
  String get sizeString {
    return QuicClient.formatTerminalSize(size.$1, size.$2);
  }

  /// Copy stream with new size
  FlutterTerminalStream withSize(int rows, int cols) {
    return FlutterTerminalStream(
      id: id,
      terminalId: terminalId,
      name: name,
      shellType: shellType,
      currentDir: currentDir,
      size: (rows, cols),
      running: running,
    );
  }
}

/// Utility functions for terminal management
class TerminalUtils {
  /// Get recommended terminal size based on screen size
  static (int, int) getRecommendedSize({
    int screenWidth = 800,
    int screenHeight = 600,
    double fontSize = 14.0,
  }) {
    // Calculate character dimensions (rough estimates)
    const charWidth = 8.0;
    const charHeight = 16.0;

    final cols = ((screenWidth - 40) / (charWidth * fontSize / 14.0)).floor().clamp(40, 200);
    final rows = ((screenHeight - 200) / (charHeight * fontSize / 14.0)).floor().clamp(10, 100);

    return (rows, cols);
  }

  /// Validate terminal size
  static bool isValidSize(int rows, int cols) {
    return rows >= 10 && rows <= 200 && cols >= 40 && cols <= 500;
  }

  /// Get shell display name
  static String getShellDisplayName(String shellPath) {
    final shellName = shellPath.split('/').last.toLowerCase();
    switch (shellName) {
      case 'bash':
        return 'Bash';
      case 'zsh':
        return 'Zsh';
      case 'fish':
        return 'Fish';
      case 'powershell':
      case 'pwsh':
        return 'PowerShell';
      case 'cmd':
      case 'cmd.exe':
        return 'Command Prompt';
      default:
        return shellName.isEmpty ? shellPath : shellName;
    }
  }

  /// Get shell icon
  static String getShellIcon(String shellPath) {
    final shellName = shellPath.split('/').last.toLowerCase();
    switch (shellName) {
      case 'bash':
        return '🐚';
      case 'zsh':
        return '⚡';
      case 'fish':
        return '🐠';
      case 'powershell':
      case 'pwsh':
        return '💙';
      case 'cmd':
      case 'cmd.exe':
        return '🪟';
      default:
        return '💻';
    }
  }

  /// Format working directory for display
  static String formatWorkingDir(String path) {
    // Replace home directory with ~
    final homeDir = getDefaultWorkingDir();
    if (path.startsWith(homeDir)) {
      return path.replaceFirst(homeDir, '~');
    }
    return path;
  }

  /// Check if ticket looks valid
  static bool looksLikeValidTicket(String ticket) {
    // Basic validation
    if (ticket.isEmpty || ticket.length < 20) return false;

    // Check if it starts with RT_ (our prefix)
    if (ticket.startsWith('RT_')) return true;

    // Legacy format check
    if (ticket.contains('ticket:') || ticket.contains('://')) return true;

    return false;
  }

  /// Extract session info from ticket (if possible)
  static Map<String, String>? extractTicketInfo(String ticket) {
    try {
      // This is a simplified version - in practice, we'd need to decode the ticket
      final parts = ticket.split('_');
      if (parts.length >= 2 && parts[0] == 'RT') {
        return {
          'type': 'QUIC',
          'format': 'RT',
        };
      }
      return null;
    } catch (e) {
      debugPrint('Error extracting ticket info: $e');
      return null;
    }
  }
}

/// Background task manager for Flutter
class FlutterTaskManager {
  static BackgroundTaskManager? _manager;

  static BackgroundTaskManager get manager {
    _manager ??= createTaskManager();
    return _manager!;
  }

  /// Note: Background task cancellation would need additional implementation
  /// This is a placeholder for the Rust-based task manager
}

/// Error handling utilities
class QuicErrorHandler {
  static String getErrorMessage(dynamic error) {
    if (error is Exception) {
      return error.toString();
    }
    return 'Unknown error occurred';
  }

  static String getErrorCode(dynamic error) {
    // Extract error code if available
    return 'UNKNOWN';
  }

  static bool isConnectionError(dynamic error) {
    final message = getErrorMessage(error).toLowerCase();
    return message.contains('connect') ||
           message.contains('network') ||
           message.contains('timeout');
  }

  static bool isTicketError(dynamic error) {
    final message = getErrorMessage(error).toLowerCase();
    return message.contains('ticket') ||
           message.contains('parse') ||
           message.contains('invalid');
  }

  static bool isTerminalError(dynamic error) {
    final message = getErrorMessage(error).toLowerCase();
    return message.contains('terminal') ||
           message.contains('shell') ||
           message.contains('process');
  }
}