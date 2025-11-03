import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart' hide LucideIcons;
import 'package:lucide_icons/lucide_icons.dart';
import 'package:qr_code_scanner/qr_code_scanner.dart';
import 'dart:io';

import '../stores/app_store.dart';
import '../bridge_generated.dart/third_party/rust_lib_app/message_bridge.dart';
import '../widgets/qr_scanner_dialog.dart';

class ConnectScreen extends StatelessWidget {
  const ConnectScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ShadMaterialApp.shadcn(
        theme: ShadThemeData(
          brightness: Brightness.dark,
          colorScheme: const ColorScheme.dark(
            primary: Color(0xFF00D4FF),
            secondary: Color(0xFF7C3AED),
            surface: Color(0xFF2A2A3E),
          ),
        ),
        home: const ConnectScreenContent(),
      ),
    );
  }
}

class ConnectScreenContent extends StatelessWidget {
  const ConnectScreenContent({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.read<AppStore>();

    return const SafeArea(
      child: SingleChildScrollView(
        padding: EdgeInsets.all(32),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: 500),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _AppHeader(),
                SizedBox(height: 48),
                _ConnectionStatus(),
                SizedBox(height: 32),
                _ConnectionForm(),
                SizedBox(height: 32),
                _ConnectionInstructions(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AppHeader extends StatelessWidget {
  const _AppHeader();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Logo
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
            lucide.LucideIcons.terminal,
            size: 50,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 24),
        // Title
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
          style: TextStyle(fontSize: 16, color: Colors.grey[400]),
        ),
      ],
    );
  }
}

class _ConnectionStatus extends StatelessWidget {
  const _ConnectionStatus();

  @override
  Widget build(BuildContext context) {
    final store = context.read<AppStore>();

    return SignalBuilder(
      signal: store._statusMessage,
      builder: (_, message, __) {
        if (message.isEmpty) return const SizedBox.shrink();

        final isError = store.error != null;
        final isConnected =
            store.connectionStatus == ConnectionStatus.connected;

        return ShadCard(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Icon(
                  isError
                      ? lucide.LucideIcons.xCircle
                      : isConnected
                      ? lucide.LucideIcons.checkCircle
                      : lucide.LucideIcons.info,
                  color: isError
                      ? Colors.red
                      : isConnected
                      ? Colors.green
                      : Colors.blue,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    message,
                    style: TextStyle(
                      color: isError
                          ? Colors.red
                          : isConnected
                          ? Colors.green
                          : Colors.blue,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ConnectionForm extends StatelessWidget {
  const _ConnectionForm();

  @override
  Widget build(BuildContext context) {
    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Connect to CLI Server',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 24),
            const _TicketConnectionForm(),
            const SizedBox(height: 24),
            const _Divider(),
            const SizedBox(height: 24),
            const _LegacyConnectionForm(),
          ],
        ),
      ),
    );
  }
}

class _TicketConnectionForm extends StatelessWidget {
  const _TicketConnectionForm();

  @override
  Widget build(BuildContext context) {
    final store = context.read<AppStore>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFF00D4FF).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.ticket, size: 16, color: Color(0xFF00D4FF)),
                  SizedBox(width: 6),
                  Text(
                    'Ticket Connection',
                    style: TextStyle(
                      color: Color(0xFF00D4FF),
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        const Text(
          'Enter the connection ticket from your CLI host:',
          style: TextStyle(fontSize: 14, color: Color(0xFF6C7293)),
        ),
        const SizedBox(height: 12),
        ShadInput(
          placeholder: const Text('ticket:...'),
          initialValue: store.ticketInput,
          onChanged: store.setTicketInput,
          maxLines: 2,
          prefix: const Icon(LucideIcons.ticket),
          suffix: IconButton(
            icon: const Icon(LucideIcons.qrCode),
            onPressed: () => _showQRScanner(context),
            tooltip: 'Scan QR Code',
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: SignalBuilder(
                signal: store._isLoading,
                builder: (_, isLoading, __) {
                  return ShadButton.ghost(
                    onPressed: isLoading
                        ? null
                        : () => _connectWithTicket(context),
                    child: isLoading
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(LucideIcons.ticket),
                              SizedBox(width: 8),
                              Text('Connect with Ticket'),
                            ],
                          ),
                  );
                },
              ),
            ),
            const SizedBox(width: 12),
            ShadButton.outline(
              onPressed: () => store.setTicketInput(''),
              child: const Icon(LucideIcons.x),
            ),
          ],
        ),
      ],
    );
  }
}

class _LegacyConnectionForm extends StatelessWidget {
  const _LegacyConnectionForm();

  @override
  Widget build(BuildContext context) {
    final store = context.read<AppStore>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Or enter endpoint address (legacy):',
          style: TextStyle(fontSize: 14, color: Color(0xFF6C7293)),
        ),
        const SizedBox(height: 12),
        ShadInput(
          placeholder: const Text('127.0.0.1:8080'),
          initialValue: store.endpointInput,
          onChanged: store.setEndpointInput,
          maxLines: 2,
          prefix: const Icon(LucideIcons.link),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ShadButton.outline(
            onPressed: () => _connectWithEndpoint(context),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(LucideIcons.wifi),
                SizedBox(width: 8),
                Text('Connect with Address'),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Divider(color: Color(0xFF45475A))),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text('OR', style: TextStyle(color: Colors.grey[400])),
        ),
        const Expanded(child: Divider(color: Color(0xFF45475A))),
      ],
    );
  }
}

class _ConnectionInstructions extends StatelessWidget {
  const _ConnectionInstructions();

  @override
  Widget build(BuildContext context) {
    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(LucideIcons.info, color: Color(0xFF6C7293)),
                const SizedBox(width: 8),
                const Text(
                  'How to connect using tickets',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            _buildInstructionStep('1', 'Run CLI: riterm host'),
            _buildInstructionStep(
              '2',
              'Copy the connection ticket from CLI output',
            ),
            _buildInstructionStep(
              '3',
              'Paste the ticket in the ticket field above',
            ),
            _buildInstructionStep(
              '4',
              'Click "Connect with Ticket" to connect',
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Icon(LucideIcons.lightbulb, color: Colors.amber),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Pro tip: Use QR code scanner for mobile devices',
                    style: TextStyle(color: Colors.amber[400], fontSize: 14),
                  ),
                ),
              ],
            ),
          ],
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
            style: const TextStyle(
              color: Color(0xFF00D4FF),
              fontWeight: FontWeight.bold,
            ),
          ),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(color: Color(0xFFD1D5DB), fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

// Actions
void _connectWithTicket(BuildContext context) async {
  final store = context.read<AppStore>();
  final ticket = store.ticketInput.trim();

  if (ticket.isEmpty) {
    store.setStatusMessage('Please enter a connection ticket');
    return;
  }

  if (!_validateTicket(ticket)) {
    store.setError('Invalid ticket format. Ticket should start with "ticket:"');
    store.setStatusMessage('Invalid ticket format');
    return;
  }

  store.setLoading(true);
  store.clearError();
  store.setStatusMessage('Connecting using ticket...');

  try {
    final client = createMessageClient();
    final sessionId = await connectByTicket(client: client, ticket: ticket);

    store.setConnectionStatus(ConnectionStatus.connected);
    store.setCurrentSession(
      AppSession(
        id: sessionId,
        name: 'Session ${sessionId.substring(0, 8)}',
        nodeId: '', // Will be populated from response
        endpointAddr: ticket,
        connectionId: sessionId,
        createdAt: DateTime.now(),
        isActive: true,
      ),
    );

    store.setStatusMessage('Connected successfully via ticket!');
    store.setTicketInput('');

    // Navigate to main app
    if (context.mounted) {
      Navigator.of(context).pushReplacementNamed('/main');
    }
  } catch (e) {
    store.setError('Failed to connect via ticket: $e');
    store.setStatusMessage('Connection failed');
  } finally {
    store.setLoading(false);
  }
}

void _connectWithEndpoint(BuildContext context) async {
  final store = context.read<AppStore>();
  final endpoint = store.endpointInput.trim();

  if (endpoint.isEmpty) {
    store.setStatusMessage('Please enter an endpoint address');
    return;
  }

  store.setLoading(true);
  store.clearError();
  store.setStatusMessage('Connecting to CLI server...');

  try {
    final client = createMessageClient();
    String sessionId;

    if (endpoint.startsWith('ticket:')) {
      sessionId = await connectByTicket(client: client, ticket: endpoint);
    } else {
      sessionId = await connectToCliServer(
        client: client,
        endpointAddrStr: endpoint,
        relayUrl: null,
      );
    }

    store.setConnectionStatus(ConnectionStatus.connected);
    store.setCurrentSession(
      AppSession(
        id: sessionId,
        name: 'Session ${sessionId.substring(0, 8)}',
        nodeId: '',
        endpointAddr: endpoint,
        connectionId: sessionId,
        createdAt: DateTime.now(),
        isActive: true,
      ),
    );

    store.setStatusMessage('Connected successfully!');
    store.setEndpointInput('');

    // Navigate to main app
    if (context.mounted) {
      Navigator.of(context).pushReplacementNamed('/main');
    }
  } catch (e) {
    store.setError('Failed to connect: $e');
    store.setStatusMessage('Connection failed');
  } finally {
    store.setLoading(false);
  }
}

void _showQRScanner(BuildContext context) async {
  if (!Platform.isIOS && !Platform.isAndroid) {
    final store = context.read<AppStore>();
    store.setError('QR scanning only available on mobile');
    store.setStatusMessage('QR scanning only available on mobile');
    return;
  }

  // Request camera permission
  // Implementation would go here
  showDialog(context: context, builder: (context) => const QRScannerDialog());
}

bool _validateTicket(String ticket) {
  if (ticket.isEmpty) return false;
  if (!ticket.startsWith('ticket:')) return false;
  return ticket.length > 20;
}

