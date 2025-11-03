import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart' hide LucideIcons;
import 'package:lucide_icons/lucide_icons.dart';

import '../stores/app_store.dart';
import '../bridge_generated.dart/third_party/rust_lib_app/message_bridge.dart';
import '../bridge_generated.dart/frb_generated.dart';

class TcpForwardingView extends StatefulWidget {
  const TcpForwardingView({super.key});

  @override
  State<TcpForwardingView> createState() => _TcpForwardingViewState();
}

class _TcpForwardingViewState extends State<TcpForwardingView> {
  final _localAddrController = TextEditingController();
  final _remoteHostController = TextEditingController();
  final _remotePortController = TextEditingController();
  final _forwardingTypeController = TextEditingController(text: 'ListenToRemote');

  @override
  void dispose() {
    _localAddrController.dispose();
    _remoteHostController.dispose();
    _remotePortController.dispose();
    _forwardingTypeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        _buildHeader(),
        const SizedBox(height: 24),

        // Create new forwarding session
        _buildCreateForwardingForm(),
        const SizedBox(height: 24),

        // Active sessions list
        _buildActiveSessionsList(),
      ],
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        const Icon(
          LucideIcons.share2,
          size: 24,
          color: Color(0xFF00D4FF),
        ),
        const SizedBox(width: 12),
        const Text(
          'TCP Forwarding',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w600,
            color: Colors.white,
          ),
        ),
        const Spacer(),
        ShadButton.outline(
          onPressed: () => _showHelpDialog(context),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(LucideIcons.helpCircle, size: 16),
              SizedBox(width: 6),
              Text('Help'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCreateForwardingForm() {
    final store = appStore;

    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Create Forwarding Session',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),

            // Forwarding type selection
            const Text(
              'Forwarding Type',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: Color(0xFFD1D5DB),
              ),
            ),
            const SizedBox(height: 8),
            _buildForwardingTypeSelector(),
            const SizedBox(height: 16),

            // Local address
            const Text(
              'Local Address',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: Color(0xFFD1D5DB),
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _localAddrController,
              decoration: const InputDecoration(
                labelText: 'Local Address',
                hintText: '127.0.0.1:3000',
                prefixIcon: Icon(LucideIcons.server),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),

            // Remote configuration (conditional)
            ValueListenableBuilder(
              valueListenable: _forwardingTypeController,
              builder: (_, forwardingType, __) {
                if (forwardingType == 'ListenToRemote') {
                  return _buildRemoteConfig();
                }
                return const SizedBox.shrink();
              },
            ),

            const SizedBox(height: 16),

            // Create button
            ValueListenableBuilder(
              valueListenable: store.isLoadingSignal,
              builder: (_, isLoading, __) {
                return ShadButton(
                  onPressed: isLoading ? null : () => _createForwardingSession(context),
                  child: isLoading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(LucideIcons.plus, size: 16),
                            SizedBox(width: 6),
                            Text('Create Session'),
                          ],
                        ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildForwardingTypeSelector() {
    return Row(
      children: [
        Expanded(
          child: ShadButton.ghost(
            onPressed: () {
              _forwardingTypeController.text = 'ListenToRemote';
              setState(() {});
            },
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  LucideIcons.download,
                  size: 16,
                  color: _forwardingTypeController.text == 'ListenToRemote'
                      ? const Color(0xFF00D4FF)
                      : const Color(0xFF6C7293),
                ),
                const SizedBox(width: 6),
                Text(
                  'Remote → Local',
                  style: TextStyle(
                    color: _forwardingTypeController.text == 'ListenToRemote'
                        ? const Color(0xFF00D4FF)
                        : const Color(0xFF6C7293),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: ShadButton.ghost(
            onPressed: () {
              _forwardingTypeController.text = 'ListenToLocal';
              setState(() {});
            },
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  LucideIcons.upload,
                  size: 16,
                  color: _forwardingTypeController.text == 'ListenToLocal'
                      ? const Color(0xFF00D4FF)
                      : const Color(0xFF6C7293),
                ),
                const SizedBox(width: 6),
                Text(
                  'Local → Remote',
                  style: TextStyle(
                    color: _forwardingTypeController.text == 'ListenToLocal'
                        ? const Color(0xFF00D4FF)
                        : const Color(0xFF6C7293),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildRemoteConfig() {
    return Column(
      children: [
        const Text(
          'Remote Host',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: Color(0xFFD1D5DB),
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _remoteHostController,
          decoration: const InputDecoration(
            labelText: 'Remote Host',
            hintText: 'example.com or 192.168.1.100',
            prefixIcon: Icon(LucideIcons.globe),
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Remote Port',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: Color(0xFFD1D5DB),
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _remotePortController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Remote Port',
            hintText: '80, 443, 3000, etc.',
            prefixIcon: Icon(LucideIcons.settings),
            border: OutlineInputBorder(),
          ),
        ),
      ],
    );
  }

  Widget _buildActiveSessionsList() {
    // This would show active TCP forwarding sessions
    // For now, show a placeholder
    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Active Sessions',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),
            _buildEmptySessionsList(),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptySessionsList() {
    return Center(
      child: Column(
        children: [
          const Icon(
            LucideIcons.share2,
            size: 48,
            color: Color(0xFF6C7293),
          ),
          const SizedBox(height: 16),
          const Text(
            'No active forwarding sessions',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: Color(0xFFD1D5DB),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Create a session above to start forwarding TCP traffic',
            style: TextStyle(
              fontSize: 14,
              color: Color(0xFF6C7293),
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Future<void> _createForwardingSession(BuildContext context) async {
    final store = appStore;
    final localAddr = _localAddrController.text.trim();
    final remoteHost = _remoteHostController.text.trim();
    final remotePort = _remotePortController.text.trim();
    final forwardingType = _forwardingTypeController.text;

    if (localAddr.isEmpty) {
      store.setError('Please enter a local address');
      return;
    }

    if (forwardingType == 'ListenToRemote' && (remoteHost.isEmpty || remotePort.isEmpty)) {
      store.setError('Please enter remote host and port for Remote → Local forwarding');
      return;
    }

    store.setLoading(true);
    store.clearError();

    try {
      final client = createMessageClient();
      final sessionId = await RustLib.instance.api.crateMessageBridgeCreateTcpForwardingSession(
        client: client,
        sessionId: store.currentSession!.id,
        localAddr: localAddr,
        remoteHost: remoteHost.isEmpty ? null : remoteHost,
        remotePort: remotePort.isEmpty ? null : int.tryParse(remotePort),
        forwardingType: forwardingType,
      );

      store.setStatusMessage('TCP forwarding session created successfully');

      // Clear form
      _localAddrController.clear();
      _remoteHostController.clear();
      _remotePortController.clear();

      // Show success dialog
      if (context.mounted) {
        _showSuccessDialog(context, sessionId);
      }
    } catch (e) {
      store.setError('Failed to create TCP forwarding session: $e');
      store.setStatusMessage('Failed to create session');
    } finally {
      store.setLoading(false);
    }
  }

  void _showSuccessDialog(BuildContext context, String sessionId) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Session Created'),
        content: Text(
          'TCP forwarding session has been created successfully.\n\n'
          'Session ID: $sessionId\n\n'
          'You can now use the local address to access the remote service.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('TCP Forwarding Help'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'TCP forwarding allows you to access remote services through local ports.\n\n'
              'Types:\n'
              '• Remote → Local: Access remote service locally\n'
              '• Local → Remote: Expose local service remotely\n\n'
              'Examples:\n'
              '• Access remote web server: 127.0.0.1:8080 → example.com:80\n'
              '• Share local database: 127.0.0.1:5432 → remote\n\n'
              'Enter the addresses in format: host:port',
              style: TextStyle(
                fontSize: 14,
                color: Color(0xFFD1D5DB),
                height: 1.5,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }
}