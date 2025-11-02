import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart';
import 'package:qr_code_scanner/qr_code_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:io';
// 启用 Rust bridge
import 'bridge_generated.dart/frb_generated.dart';
import 'bridge_generated.dart/third_party/rust_lib_app/message_bridge.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 初始化 Rust bridge
  await RustLib.init();

  runApp(const RiTermApp());
}

class RiTermApp extends StatelessWidget {
  const RiTermApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RiTerm',
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        primaryColor: const Color(0xFF00D4FF),
        scaffoldBackgroundColor: const Color(0xFF1E1E2E),
        cardColor: const Color(0xFF2A2A3E),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF00D4FF),
          secondary: Color(0xFF7C3AED),
          surface: Color(0xFF2A2A3E),
        ),
      ),
      home: const MainScreen(),
    );
  }
}

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  bool _isInitialized = false;
  bool _isConnected = false;
  String _status = "Initializing...";
  FlutterMessageClient? _messageClient;
  String? _currentSessionId;
  List<FlutterSession> _sessions = [];
  List<FlutterRemoteTerminal> _terminals = [];
  final Map<String, Terminal> _terminalsMap = {};
  final _ticketController = TextEditingController();
  final _endpointController = TextEditingController();
  int _selectedTabIndex = 0;

  @override
  void initState() {
    super.initState();
    _checkInitialization();
  }

  Future<void> _checkInitialization() async {
    try {
      final client = createMessageClient();
      setState(() {
        _isInitialized = true;
        _messageClient = client;
        _status = "RiTerm Ready - Enter endpoint address";
      });
    } catch (e) {
      setState(() => _status = "Failed to initialize: $e");
    }
  }

  Future<void> _connectToEndpoint() async {
    final endpoint = _endpointController.text.trim();

    if (endpoint.isEmpty) {
      setState(() => _status = "Please enter an endpoint address");
      return;
    }

    if (_messageClient == null) {
      setState(() => _status = "Message client not initialized");
      return;
    }

    setState(() => _status = "Connecting to CLI server...");

    try {
      String sessionId;

      // 检查是否是 ticket 格式
      if (endpoint.startsWith('ticket:')) {
        sessionId = await connectByTicket(
          client: _messageClient!,
          ticket: endpoint,
        );
      } else {
        // 传统地址连接方式
        sessionId = await connectToCliServer(
          client: _messageClient!,
          endpointAddrStr: endpoint,
          relayUrl: null, // 使用默认中继
        );
      }

      setState(() {
        _status = "Connected successfully!";
        _isConnected = true;
        _currentSessionId = sessionId;
        _endpointController.clear();
      });

      _refreshSessions();
      _refreshTerminals();
    } catch (e) {
      setState(() => _status = "Failed to connect: $e");
    }
  }

  Future<void> _connectByTicket() async {
    final ticket = _ticketController.text.trim();

    if (ticket.isEmpty) {
      setState(() => _status = "Please enter a connection ticket");
      return;
    }

    if (!_validateTicket(ticket)) {
      setState(() => _status = "Invalid ticket format. Ticket should start with 'ticket:'");
      return;
    }

    if (_messageClient == null) {
      setState(() => _status = "Message client not initialized");
      return;
    }

    setState(() => _status = "Connecting using ticket...");

    try {
      final sessionId = await connectByTicket(
        client: _messageClient!,
        ticket: ticket,
      );

      setState(() {
        _status = "Connected successfully via ticket!";
        _isConnected = true;
        _currentSessionId = sessionId;
        _ticketController.clear();
      });

      _refreshSessions();
      _refreshTerminals();
    } catch (e) {
      setState(() => _status = "Failed to connect via ticket: $e");
    }
  }

  bool _validateTicket(String ticket) {
    if (ticket.isEmpty) return false;
    if (!ticket.startsWith('ticket:')) return false;
    return ticket.length > 20;
  }

  Future<void> _refreshSessions() async {
    if (_messageClient == null) return;

    try {
      final sessions = await getActiveSessions(client: _messageClient!);
      setState(() => _sessions = sessions);
    } catch (e) {
      debugPrint("Failed to refresh sessions: $e");
    }
  }

  Future<void> _refreshTerminals() async {
    if (_messageClient == null || _currentSessionId == null) return;

    try {
      final terminals = await listRemoteTerminals(
        client: _messageClient!,
        sessionId: _currentSessionId!,
      );
      setState(() => _terminals = terminals);
    } catch (e) {
      debugPrint("Failed to refresh terminals: $e");
    }
  }

  Future<void> _createTerminal() async {
    if (_messageClient == null || _currentSessionId == null) {
      setState(() => _status = "Not connected to CLI server");
      return;
    }

    try {
      final terminalId = await createRemoteTerminal(
        client: _messageClient!,
        sessionId: _currentSessionId!,
        name: "Flutter Terminal",
        shellPath: null, // 使用默认shell
        workingDir: null, // 使用默认目录
        rows: 24,
        cols: 80, // 终端大小
      );
      setState(() => _status = "Terminal created successfully");
      _createXTerminal(terminalId);
      _refreshTerminals(); // 刷新终端列表
    } catch (e) {
      setState(() => _status = "Failed to create terminal: $e");
    }
  }

  void _createXTerminal(String terminalId) {
    final terminal = Terminal();
    terminal.onOutput = (data) {
      _sendTerminalInput(terminalId, data);
    };
    setState(() => _terminalsMap[terminalId] = terminal);
  }

  Future<void> _sendTerminalInput(String terminalId, String input) async {
    if (_messageClient == null || _currentSessionId == null) return;

    try {
      await sendTerminalInput(
        client: _messageClient!,
        sessionId: _currentSessionId!,
        terminalId: terminalId,
        input: input,
      );
    } catch (e) {
      debugPrint("Failed to send terminal input: $e");
    }
  }

  void _openTerminal(String terminalId) {
    if (_terminalsMap.containsKey(terminalId)) return;
    _createXTerminal(terminalId);
  }

  Future<void> _closeTerminal(String terminalId) async {
    if (_messageClient == null || _currentSessionId == null) return;

    try {
      await stopRemoteTerminal(
        client: _messageClient!,
        sessionId: _currentSessionId!,
        terminalId: terminalId,
      );

      setState(() {
        _terminalsMap.remove(terminalId);
        _terminals.removeWhere((t) => t.id == terminalId);
      });
    } catch (e) {
      debugPrint("Failed to close terminal: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _isConnected ? _buildMainInterface() : _buildStartupScreen(),
    );
  }

  Widget _buildStartupScreen() {
    return SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 500),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Logo and Title
                Column(
                  children: [
                    Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFF00D4FF), Color(0xFF7C3AED)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF00D4FF).withValues(alpha: 0.3),
                            blurRadius: 20,
                            spreadRadius: 5,
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.terminal,
                        size: 50,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'RiTerm',
                      style: TextStyle(
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Secure Remote Terminal Access',
                      style: TextStyle(
                        fontSize: 16,
                        color: Colors.grey[400],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 48),

                // Status
                if (_status.isNotEmpty) ...[
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: _status.contains("Failed")
                          ? Colors.red.withValues(alpha: 0.1)
                          : _status.contains("Connected")
                              ? Colors.green.withValues(alpha: 0.1)
                              : Colors.blue.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: _status.contains("Failed")
                            ? Colors.red.withValues(alpha: 0.3)
                            : _status.contains("Connected")
                                ? Colors.green.withValues(alpha: 0.3)
                                : Colors.blue.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _status.contains("Failed")
                              ? Icons.error
                              : _status.contains("Connected")
                                  ? Icons.check_circle
                                  : Icons.info,
                          color: _status.contains("Failed")
                              ? Colors.red
                              : _status.contains("Connected")
                                  ? Colors.green
                                  : Colors.blue,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            _status,
                            style: TextStyle(
                              color: _status.contains("Failed")
                                  ? Colors.red
                                  : _status.contains("Connected")
                                      ? Colors.green
                                      : Colors.blue,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),
                ],

                // Connection Section
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Connect to CLI Server',
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 16),

                        // Tab buttons for connection type
                        Row(
                          children: [
                            Expanded(
                              child: Container(
                                height: 48,
                                decoration: BoxDecoration(
                                  color: const Color(0xFF00D4FF).withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: const Center(
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Icon(Icons.confirmation_number, size: 18, color: Color(0xFF00D4FF)),
                                      SizedBox(width: 8),
                                      Text('Ticket Connection', style: TextStyle(color: Color(0xFF00D4FF), fontWeight: FontWeight.bold)),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),

                        // Ticket input
                        Text(
                          'Enter the connection ticket from your CLI host:',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: Colors.grey[400],
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _ticketController,
                          decoration: InputDecoration(
                            hintText: 'ticket:...',
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide(color: Colors.grey[600]!),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide(color: Colors.grey[600]!),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: const BorderSide(color: Color(0xFF00D4FF)),
                            ),
                            prefixIcon: const Icon(Icons.confirmation_number),
                            suffixIcon: IconButton(
                              icon: const Icon(Icons.qr_code_scanner),
                              onPressed: _scanQRCode,
                              tooltip: 'Scan QR Code',
                            ),
                          ),
                          maxLines: 2,
                        ),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Expanded(
                              child: ElevatedButton.icon(
                                onPressed: _isInitialized ? _connectByTicket : null,
                                icon: const Icon(Icons.confirmation_number),
                                label: const Text('Connect with Ticket'),
                                style: ElevatedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(vertical: 16),
                                  backgroundColor: const Color(0xFF00D4FF),
                                  foregroundColor: Colors.black,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            IconButton(
                              onPressed: () {
                                setState(() {
                                  _ticketController.clear();
                                });
                              },
                              icon: const Icon(Icons.clear),
                              tooltip: 'Clear',
                              style: IconButton.styleFrom(
                                backgroundColor: Colors.grey[700],
                                foregroundColor: Colors.white,
                              ),
                            ),
                          ],
                        ),

                        const SizedBox(height: 24),

                        // Divider
                        Row(
                          children: [
                            Expanded(child: Divider(color: Colors.grey[600])),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16),
                              child: Text('OR', style: TextStyle(color: Colors.grey[400])),
                            ),
                            Expanded(child: Divider(color: Colors.grey[600])),
                          ],
                        ),

                        const SizedBox(height: 24),

                        // Traditional endpoint connection
                        Text(
                          'Or enter endpoint address (legacy):',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: Colors.grey[400],
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _endpointController,
                          decoration: InputDecoration(
                            hintText: '127.0.0.1:8080 or ticket:...',
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide(color: Colors.grey[600]!),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide(color: Colors.grey[600]!),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: const BorderSide(color: Color(0xFF7C3AED)),
                            ),
                            prefixIcon: const Icon(Icons.link),
                          ),
                          maxLines: 2,
                        ),
                        const SizedBox(height: 16),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: _isInitialized ? _connectToEndpoint : null,
                            icon: const Icon(Icons.connect_without_contact),
                            label: const Text('Connect with Address'),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              side: const BorderSide(color: Color(0xFF7C3AED)),
                              foregroundColor: const Color(0xFF7C3AED),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 32),

                // Instructions
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(Icons.info_outline, color: Colors.grey[400]),
                            const SizedBox(width: 8),
                            Text(
                              'How to connect using tickets',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _buildInstructionStep('1', 'Run CLI: riterm msg host'),
                        _buildInstructionStep('2', 'Copy the connection ticket from CLI output'),
                        _buildInstructionStep('3', 'Paste the ticket in the ticket field above'),
                        _buildInstructionStep('4', 'Click "Connect with Ticket" to connect'),
                        const SizedBox(height: 16),
                        Row(
                          children: [
                            Icon(Icons.lightbulb_outline, color: Colors.amber[400]),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Pro tip: Use QR code scanner for mobile devices',
                                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: Colors.amber[400],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildInstructionStep(String number, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$number. ',
            style: TextStyle(
              color: Color(0xFF00D4FF),
              fontWeight: FontWeight.bold,
            ),
          ),
          Expanded(
            child: Text(
              text,
              style: TextStyle(color: Colors.grey[300]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMainInterface() {
    return Scaffold(
      backgroundColor: const Color(0xFF1E1E2E),
      appBar: AppBar(
        title: const Text('RiTerm'),
        backgroundColor: const Color(0xFF2A2A3E),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: _createTerminal,
            tooltip: 'Create Terminal',
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              _refreshSessions();
              _refreshTerminals();
            },
            tooltip: 'Refresh',
          ),
          PopupMenuButton<String>(
            onSelected: (value) async {
              if (value == 'disconnect' && _currentSessionId != null && _messageClient != null) {
                try {
                  await disconnectFromCliServer(
                    client: _messageClient!,
                    sessionId: _currentSessionId!,
                  );

                  setState(() {
                    _isConnected = false;
                    _currentSessionId = null;
                    _sessions.clear();
                    _terminals.clear();
                    _terminalsMap.clear();
                    _status = "Disconnected";
                  });
                } catch (e) {
                  setState(() => _status = "Failed to disconnect: $e");
                }
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: 'disconnect',
                child: Row(
                  children: [
                    Icon(Icons.logout, size: 18),
                    SizedBox(width: 8),
                    Text('Disconnect'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // Terminal Tabs
          Container(
            height: 50,
            decoration: BoxDecoration(
              border: Border(
                bottom: BorderSide(color: Colors.grey[800]!),
              ),
            ),
            child: _terminals.isEmpty
                ? const Center(
                    child: Text(
                      'No terminals available',
                      style: TextStyle(color: Colors.grey),
                    ),
                  )
                : ListView.builder(
                    scrollDirection: Axis.horizontal,
                    itemCount: _terminals.length,
                    itemBuilder: (context, index) {
                      final terminal = _terminals[index];
                      final isSelected = _selectedTabIndex == index;
                      return GestureDetector(
                        onTap: () {
                          setState(() => _selectedTabIndex = index);
                          _openTerminal(terminal.id);
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          decoration: BoxDecoration(
                            border: Border(
                              bottom: BorderSide(
                                color: isSelected
                                    ? const Color(0xFF00D4FF)
                                    : Colors.transparent,
                                width: 2,
                              ),
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.terminal,
                                size: 16,
                                color: isSelected
                                    ? const Color(0xFF00D4FF)
                                    : Colors.grey[400],
                              ),
                              const SizedBox(width: 8),
                              Text(
                                terminal.name ?? 'Terminal ${index + 1}',
                                style: TextStyle(
                                  color: isSelected
                                      ? const Color(0xFF00D4FF)
                                      : Colors.grey[300],
                                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                                ),
                              ),
                                const SizedBox(width: 8),
                              GestureDetector(
                                onTap: () => _closeTerminal(terminal.id),
                                child: Icon(
                                  Icons.close,
                                  size: 16,
                                  color: Colors.grey[500],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),

          // Terminal Content
          Expanded(
            child: _terminals.isEmpty
                ? _buildEmptyState()
                : _selectedTabIndex < _terminals.length
                    ? _buildTerminalView(_terminals[_selectedTabIndex])
                    : _buildEmptyState(),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.terminal_outlined,
            size: 64,
            color: Colors.grey[600],
          ),
          const SizedBox(height: 16),
          Text(
            'No terminals available',
            style: TextStyle(
              fontSize: 18,
              color: Colors.grey[400],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Create a terminal to get started',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[500],
            ),
          ),
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _createTerminal,
            icon: const Icon(Icons.add),
            label: const Text('Create Terminal'),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF00D4FF),
              foregroundColor: Colors.black,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTerminalView(FlutterRemoteTerminal terminal) {
    final terminalId = terminal.id;
    if (!_terminalsMap.containsKey(terminalId)) {
      return Center(
        child: ElevatedButton(
          onPressed: () => _openTerminal(terminalId),
          child: const Text('Open Terminal'),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.black,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.grey[800]!),
      ),
      child: TerminalView(_terminalsMap[terminalId]!),
    );
  }

  Future<void> _scanQRCode() async {
    if (!Platform.isIOS && !Platform.isAndroid) {
      setState(() => _status = "QR scanning only available on mobile");
      return;
    }

    // Request camera permission
    var status = await Permission.camera.status;
    if (status.isDenied) {
      final result = await Permission.camera.request();
      if (!result.isGranted) {
        setState(() => _status = "Camera permission denied");
        return;
      }
    }

    // Navigate to QR scanner
    if (mounted) {
      final result = await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (context) => QRScannerScreen(
            onQRCodeScanned: (String code) {
              _ticketController.text = code;
              if (!_validateTicket(code)) {
                setState(() => _status = "Invalid QR code format");
              }
            },
          ),
        ),
      );

      if (result != null) {
        // User scanned a QR code, now try to connect
        _connectToEndpoint();
      }
    }
  }
}

class QRScannerScreen extends StatelessWidget {
  final Function(String) onQRCodeScanned;

  const QRScannerScreen({
    super.key,
    required this.onQRCodeScanned,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan QR Code'),
        backgroundColor: const Color(0xFF2A2A3E),
      ),
      body: QRView(
        key: GlobalKey(debugLabel: 'QR'),
        onQRViewCreated: (QRViewController controller) {
          controller.scannedDataStream.listen((scanData) {
            onQRCodeScanned(scanData.code!);
            Navigator.pop(context);
          });
        },
      ),
    );
  }
}