import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart' hide LucideIcons;
import 'package:lucide_icons/lucide_icons.dart';

import '../stores/app_store.dart';

class SettingsView extends StatelessWidget {
  const SettingsView({super.key});

  @override
  Widget build(BuildContext context) {
    return const SingleChildScrollView(
      padding: EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _HeaderSection(),
          SizedBox(height: 24),
          _ConnectionSettings(),
          SizedBox(height: 24),
          _TerminalSettings(),
          SizedBox(height: 24),
          _AppearanceSettings(),
          SizedBox(height: 24),
          _AboutSection(),
        ],
      ),
    );
  }
}

class _HeaderSection extends StatelessWidget {
  const _HeaderSection();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(
          LucideIcons.settings,
          size: 24,
          color: Color(0xFF00D4FF),
        ),
        const SizedBox(width: 12),
        const Text(
          'Settings',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w600,
            color: Colors.white,
          ),
        ),
        const Spacer(),
        ShadButton.outline(
          onPressed: () => _resetSettings(context),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(LucideIcons.rotateCcw, size: 16),
              SizedBox(width: 6),
              Text('Reset'),
            ],
          ),
        ),
      ],
    );
  }

  void _resetSettings(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => ShadDialog(
        title: const Text('Reset Settings'),
        description: const Text(
          'Are you sure you want to reset all settings to their default values?',
        ),
        actions: [
          ShadButton.outline(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ShadButton.destructive(
            onPressed: () {
              Navigator.of(context).pop();
              final store = appStore;
              store.reset();
            },
            child: const Text('Reset'),
          ),
        ],
      ),
    );
  }
}

class _ConnectionSettings extends StatelessWidget {
  const _ConnectionSettings();

  @override
  Widget build(BuildContext context) {
    final store = appStore;

    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Connection Settings',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),

            // Current session info
            ValueListenableBuilder(
              valueListenable: store.currentSessionSignal,
              builder: (_, session, __) {
                if (session == null) {
                  return const Text(
                    'No active connection',
                    style: TextStyle(
                      fontSize: 14,
                      color: Color(0xFF6C7293),
                    ),
                  );
                }

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Current Session',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: Color(0xFFD1D5DB),
                      ),
                    ),
                    const SizedBox(height: 8),
                    _buildInfoRow('Session ID', session.id.substring(0, 8) + '...'),
                    _buildInfoRow('Name', session.name),
                    _buildInfoRow('Created', _formatDateTime(session.createdAt)),
                    _buildInfoRow('Status', session.isActive ? 'Active' : 'Inactive'),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),

            // Connection actions
            const Text(
              'Actions',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: Color(0xFFD1D5DB),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ShadButton.outline(
                    onPressed: () => _refreshConnection(context),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(LucideIcons.refreshCw, size: 16),
                        SizedBox(width: 6),
                        Text('Refresh'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ShadButton.outline(
                    onPressed: () => _disconnect(context),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(LucideIcons.logOut, size: 16),
                        SizedBox(width: 6),
                        Text('Disconnect'),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFF6C7293),
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFFD1D5DB),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatDateTime(DateTime dateTime) {
    return '${dateTime.hour.toString().padLeft(2, '0')}:'
           '${dateTime.minute.toString().padLeft(2, '0')}, '
           '${dateTime.day}/${dateTime.month}/${dateTime.year}';
  }

  void _refreshConnection(BuildContext context) {
    final store = appStore;
    store.setStatusMessage('Refreshing connection...');
    // Implementation would go here
  }

  void _disconnect(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => ShadDialog(
        title: const Text('Disconnect'),
        description: const Text(
          'Are you sure you want to disconnect from the current session?',
        ),
        actions: [
          ShadButton.outline(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ShadButton.destructive(
            onPressed: () {
              Navigator.of(context).pop();
              final store = appStore;
              store.reset();
              Navigator.of(context).pushReplacementNamed('/connect');
            },
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
  }
}

class _TerminalSettings extends StatelessWidget {
  const _TerminalSettings();

  @override
  Widget build(BuildContext context) {
    final store = appStore;

    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Terminal Settings',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),

            // Terminal statistics
            ValueListenableBuilder(
              valueListenable: store.terminalsSignal,
              builder: (_, terminals, __) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildInfoRow('Active Terminals', '${terminals.length}'),
                    _buildInfoRow('Active Terminal', store.activeTerminalId?.substring(0, 8) ?? 'None'),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),

            // Terminal preferences
            const Text(
              'Preferences',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: Color(0xFFD1D5DB),
              ),
            ),
            const SizedBox(height: 8),
            ShadButton.outline(
              onPressed: () => _showTerminalPreferences(context),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(LucideIcons.sliders, size: 16),
                  SizedBox(width: 6),
                  Text('Configure'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFF6C7293),
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFFD1D5DB),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showTerminalPreferences(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => ShadDialog(
        title: const Text('Terminal Preferences'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Terminal preferences configuration will be available in a future update.\n\n'
              'Options will include:\n'
              '• Default shell\n'
              '• Terminal size\n'
              '• Font settings\n'
              '• Color themes',
              style: TextStyle(
                fontSize: 14,
                color: Color(0xFFD1D5DB),
                height: 1.5,
              ),
            ),
          ],
        ),
        actions: [
          ShadButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }
}

class _AppearanceSettings extends StatelessWidget {
  const _AppearanceSettings();

  @override
  Widget build(BuildContext context) {
    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Appearance Settings',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),

            const Text(
              'Theme',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: Color(0xFFD1D5DB),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: ShadButton.ghost(
                    onPressed: () {
                      // Dark theme is currently active
                    },
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(LucideIcons.moon, size: 16),
                        SizedBox(width: 6),
                        Text('Dark'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ShadButton.outline(
                    onPressed: () {
                      // Light theme toggle
                      _showThemeNotAvailable(context);
                    },
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(LucideIcons.sun, size: 16),
                        SizedBox(width: 6),
                        Text('Light'),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            const Text(
              'More appearance options will be available in future updates.',
              style: TextStyle(
                fontSize: 14,
                color: Color(0xFF6C7293),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showThemeNotAvailable(BuildContext context) {
    ShadToaster.of(context).show(
      ShadToast(
        title: const Text('Coming Soon'),
        description: const Text('Light theme will be available in a future update'),
        icon: const Icon(LucideIcons.info),
      ),
    );
  }
}

class _AboutSection extends StatelessWidget {
  const _AboutSection();

  @override
  Widget build(BuildContext context) {
    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'About RiTerm',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 16),

            _buildInfoRow('Version', '1.0.0'),
            _buildInfoRow('Build', '2024.11.03'),
            _buildInfoRow('Platform', 'Flutter + Rust'),
            _buildInfoRow('Network', 'iroh P2P'),
            const SizedBox(height: 16),

            const Text(
              'RiTerm is a secure P2P terminal session sharing tool built with '
              'Flutter for the frontend and Rust for the backend. It uses iroh '
              'for peer-to-peer networking with end-to-end encryption.',
              style: TextStyle(
                fontSize: 14,
                color: Color(0xFFD1D5DB),
                height: 1.5,
              ),
            ),
            const SizedBox(height: 16),

            Row(
              children: [
                ShadButton.outline(
                  onPressed: () => _showLicenses(context),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.fileText, size: 16),
                      SizedBox(width: 6),
                      Text('Licenses'),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                ShadButton.outline(
                  onPressed: () => _showChangelog(context),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(LucideIcons.gitBranch, size: 16),
                      SizedBox(width: 6),
                      Text('Changelog'),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFF6C7293),
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                color: Color(0xFFD1D5DB),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showLicenses(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => ShadDialog(
        title: const Text('Open Source Licenses'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'RiTerm uses the following open source libraries:\n\n'
                '• Flutter - UI framework\n'
                '• Rust - Backend language\n'
                '• iroh - P2P networking\n'
                '• shadcn/ui - UI components\n'
                '• flutter_solidart - State management\n'
                '• xterm - Terminal emulation\n'
                '• lucide_icons - Icon library\n'
                '• google_fonts - Font library\n\n'
                'All licenses are compatible with the MIT license.',
                style: TextStyle(
                  fontSize: 14,
                  color: Color(0xFFD1D5DB),
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
        actions: [
          ShadButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  void _showChangelog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => ShadDialog(
        title: const Text('Changelog'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Version 1.0.0 - Initial Release\n\n'
                'Features:\n'
                '• P2P terminal session sharing\n'
                '• TCP port forwarding\n'
                '• QR code ticket scanning\n'
                '• Modern UI with shadcn/ui\n'
                '• State management with flutter_solidart\n'
                '• Cross-platform support\n\n'
                'Technical:\n'
                '• Flutter frontend with Material 3 design\n'
                '• Rust backend with tokio async runtime\n'
                '• iroh P2P networking with gossip protocol\n'
                '• End-to-end encryption with ChaCha20Poly1305\n'
                '• Flutter Rust Bridge for FFI communication\n\n'
                'Performance:\n'
                '• Low-latency P2P connections (10-50ms)\n'
                '• Efficient message batching\n'
                '• Connection pooling and reuse\n'
                '• Memory-efficient terminal emulation',
                style: TextStyle(
                  fontSize: 14,
                  color: Color(0xFFD1D5DB),
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
        actions: [
          ShadButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}