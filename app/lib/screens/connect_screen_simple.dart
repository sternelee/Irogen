import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:flutter_solidart/flutter_solidart.dart';
import 'package:qr_code_scanner/qr_code_scanner.dart';
import 'dart:io';

import '../stores/app_store.dart';
import '../bridge_generated.dart/third_party/rust_lib_app/message_bridge.dart';

class ConnectScreenSimple extends StatelessWidget {
  const ConnectScreenSimple({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1E1E2E),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 500),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const _AppHeader(),
                const SizedBox(height: 48),
                const _ConnectionStatus(),
                const SizedBox(height: 32),
                const _ConnectionForm(),
                const SizedBox(height: 32),
                const _ConnectionInstructions(),
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
            LucideIcons.terminal,
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
    return ValueListenableBuilder(
      valueListenable: appStore.statusMessageSignal,
      builder: (context, message, child) {
        if (message.isEmpty) return const SizedBox.shrink();

        final isError = appStore.error != null;
        final isConnected =
            appStore.connectionStatus == ConnectionStatus.connected;

        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: isError
                ? Colors.red.withValues(alpha: 0.1)
                : isConnected
                ? Colors.green.withValues(alpha: 0.1)
                : Colors.blue.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isError
                  ? Colors.red.withValues(alpha: 0.3)
                  : isConnected
                  ? Colors.green.withValues(alpha: 0.3)
                  : Colors.blue.withValues(alpha: 0.3),
            ),
          ),
          child: Row(
            children: [
              Icon(
                isError
                    ? LucideIcons.xCircle
                    : isConnected
                    ? LucideIcons.checkCircle
                    : LucideIcons.info,
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
        );
      },
    );
  }
}

class _ConnectionForm extends StatelessWidget {
  const _ConnectionForm();

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF2A2A3E),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
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
        ValueListenableBuilder(
          valueListenable: appStore.ticketInputSignal,
          builder: (_, ticketInput, __) {
            return TextField(
              controller: TextEditingController(text: ticketInput),
              onChanged: appStore.setTicketInput,
              decoration: InputDecoration(
                hintText: 'ticket:...',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF45475A)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF45475A)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF00D4FF)),
                ),
                prefixIcon: const Icon(LucideIcons.ticket),
                suffixIcon: IconButton(
                  icon: const Icon(LucideIcons.qrCode),
                  onPressed: () => _showQRScanner(context),
                  tooltip: 'Scan QR Code',
                ),
              ),
              maxLines: 2,
              style: const TextStyle(color: Colors.white),
            );
          },
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: ValueListenableBuilder(
                valueListenable: appStore.isLoadingSignal,
                builder: (_, isLoading, __) {
                  return ElevatedButton(
                    onPressed: isLoading
                        ? null
                        : () => _connectWithTicket(context),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      backgroundColor: const Color(0xFF00D4FF),
                      foregroundColor: Colors.black,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
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
            IconButton(
              onPressed: () => appStore.setTicketInput(''),
              icon: const Icon(LucideIcons.x),
              tooltip: 'Clear',
              style: IconButton.styleFrom(
                backgroundColor: Colors.grey[700],
                foregroundColor: Colors.white,
              ),
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Or enter endpoint address (legacy):',
          style: TextStyle(fontSize: 14, color: Color(0xFF6C7293)),
        ),
        const SizedBox(height: 12),
        ValueListenableBuilder(
          valueListenable: appStore.endpointInputSignal,
          builder: (_, endpointInput, __) {
            return TextField(
              controller: TextEditingController(text: endpointInput),
              onChanged: appStore.setEndpointInput,
              decoration: InputDecoration(
                hintText: '127.0.0.1:8080',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF45475A)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF45475A)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF7C3AED)),
                ),
                prefixIcon: const Icon(LucideIcons.link),
              ),
              maxLines: 2,
              style: const TextStyle(color: Colors.white),
            );
          },
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () => _connectWithEndpoint(context),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              side: const BorderSide(color: Color(0xFF7C3AED)),
              foregroundColor: const Color(0xFF7C3AED),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
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
    return Card(
      color: const Color(0xFF2A2A3E),
      child: Padding(
        padding: const EdgeInsets.all(20.0),
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
  final ticket = appStore.ticketInput.trim();

  if (ticket.isEmpty) {
    appStore.setStatusMessage('Please enter a connection ticket');
    return;
  }

  if (!_validateTicket(ticket)) {
    appStore.setError(
      'Invalid ticket format. Ticket should start with "ticket:"',
    );
    appStore.setStatusMessage('Invalid ticket format');
    return;
  }

  appStore.setLoading(true);
  appStore.clearError();
  appStore.setStatusMessage('Connecting using ticket...');

  try {
    final client = createMessageClient();
    final sessionId = await connectByTicket(client: client, ticket: ticket);

    // Check if context is still valid before proceeding
    if (!context.mounted) return;

    appStore.setConnectionStatus(ConnectionStatus.connected);
    appStore.setCurrentSession(
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

    if (context.mounted) {
      appStore.setStatusMessage('Connected successfully via ticket!');
      appStore.setTicketInput('');
    }

    // Navigate to main app
    if (context.mounted) {
      Navigator.of(context).pushReplacementNamed('/main');
    }
  } catch (e) {
    if (context.mounted) {
      appStore.setError('Failed to connect via ticket: $e');
      appStore.setStatusMessage('Connection failed');
    }
  } finally {
    if (context.mounted) {
      appStore.setLoading(false);
    }
  }
}

void _connectWithEndpoint(BuildContext context) async {
  final endpoint = appStore.endpointInput.trim();

  if (endpoint.isEmpty) {
    appStore.setStatusMessage('Please enter an endpoint address');
    return;
  }

  appStore.setLoading(true);
  appStore.clearError();
  appStore.setStatusMessage('Connecting to CLI server...');

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

    // Check if context is still valid before proceeding
    if (!context.mounted) return;

    appStore.setConnectionStatus(ConnectionStatus.connected);
    appStore.setCurrentSession(
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

    if (context.mounted) {
      appStore.setStatusMessage('Connected successfully!');
      appStore.setEndpointInput('');
    }

    // Navigate to main app
    if (context.mounted) {
      Navigator.of(context).pushReplacementNamed('/main');
    }
  } catch (e) {
    if (context.mounted) {
      appStore.setError('Failed to connect: $e');
      appStore.setStatusMessage('Connection failed');
    }
  } finally {
    if (context.mounted) {
      appStore.setLoading(false);
    }
  }
}

void _showQRScanner(BuildContext context) async {
  if (!Platform.isIOS && !Platform.isAndroid) {
    if (context.mounted) {
      appStore.setError('QR scanning only available on mobile');
      appStore.setStatusMessage('QR scanning only available on mobile');
    }
    return;
  }

  // Show QR scanner implementation would go here
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('QR scanner implementation needed'),
        backgroundColor: Colors.orange,
      ),
    );
  }
}

bool _validateTicket(String ticket) {
  if (ticket.isEmpty) return false;
  if (!ticket.startsWith('ticket:')) return false;
  return ticket.length > 20;
}
