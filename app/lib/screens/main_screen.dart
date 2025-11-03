import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../stores/app_store.dart';
import '../widgets/tcp_forwarding_view.dart';
import '../widgets/settings_view.dart';

class MainScreen extends StatelessWidget {
  const MainScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RiTerm Main Screen',
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF00D4FF),
          secondary: Color(0xFF7C3AED),
          surface: Color(0xFF2A2A3E),
        ),
      ),
      home: const MainScreenContent(),
    );
  }
}

class MainScreenContent extends StatelessWidget {
  const MainScreenContent({super.key});

  @override
  Widget build(BuildContext context) {
    final store = appStore;

    return Scaffold(
      backgroundColor: const Color(0xFF1E1E2E),
      body: Column(
        children: [
          // Header
          _buildHeader(context),
          // Navigation Tabs
          _buildNavigationTabs(context),
          // Content
          Expanded(
            child: ValueListenableBuilder(
              valueListenable: appStore.selectedTabSignal,
              builder: (_, selectedTab, __) {
                return IndexedStack(
                  index: selectedTab.index,
                  children: const [
                    _HomeTab(),
                    _TerminalsTab(),
                    _TcpForwardingTab(),
                    _SettingsTab(),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    final store = appStore;

    return Container(
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
        color: Color(0xFF2A2A3E),
        border: Border(bottom: BorderSide(color: Color(0xFF45475A))),
      ),
      child: Row(
        children: [
          // Logo and Title
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF00D4FF), Color(0xFF7C3AED)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  LucideIcons.terminal,
                  size: 18,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 12),
              const Text(
                'RiTerm',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ],
          ),

          const Spacer(),

          // Connection Status
          ValueListenableBuilder(
            valueListenable: appStore.connectionStatusSignal,
            builder: (context, status, __) {
              return ValueListenableBuilder(
                valueListenable: appStore.currentSessionSignal,
                builder: (context, session, ___) {
                  return _ConnectionStatusIndicator(
                    status: status,
                    session: session,
                  );
                },
              );
            },
          ),

          const SizedBox(width: 16),

          // Actions
          PopupMenuButton<String>(
            icon: const Icon(LucideIcons.moreVertical, color: Colors.white),
            color: const Color(0xFF2A2A3E),
            onSelected: (value) => _handleMenuAction(context, value),
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'refresh',
                child: Row(
                  children: [
                    const Icon(LucideIcons.refreshCw, size: 16),
                    const SizedBox(width: 8),
                    const Text('Refresh'),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'disconnect',
                child: Row(
                  children: [
                    const Icon(LucideIcons.logOut, size: 16),
                    const SizedBox(width: 8),
                    const Text('Disconnect'),
                  ],
                ),
              ),
              const PopupMenuDivider(),
              PopupMenuItem(
                value: 'about',
                child: Row(
                  children: [
                    const Icon(LucideIcons.info, size: 16),
                    const SizedBox(width: 8),
                    const Text('About'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNavigationTabs(BuildContext context) {
    final store = appStore;

    return Container(
      height: 48,
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Color(0xFF45475A))),
      ),
      child: ValueListenableBuilder(
        valueListenable: appStore.selectedTabSignal,
        builder: (_, selectedTab, __) {
          return Row(
            children: [
              Expanded(
                child: _NavigationTab(
                  icon: LucideIcons.home,
                  label: 'Home',
                  isSelected: selectedTab == AppTab.home,
                  onTap: () => store.setSelectedTab(AppTab.home),
                ),
              ),
              Expanded(
                child: _NavigationTab(
                  icon: LucideIcons.terminal,
                  label: 'Terminals',
                  isSelected: selectedTab == AppTab.terminals,
                  onTap: () => store.setSelectedTab(AppTab.terminals),
                ),
              ),
              Expanded(
                child: _NavigationTab(
                  icon: LucideIcons.share2,
                  label: 'TCP Forward',
                  isSelected: selectedTab == AppTab.tcpForwarding,
                  onTap: () => store.setSelectedTab(AppTab.tcpForwarding),
                ),
              ),
              Expanded(
                child: _NavigationTab(
                  icon: LucideIcons.settings,
                  label: 'Settings',
                  isSelected: selectedTab == AppTab.settings,
                  onTap: () => store.setSelectedTab(AppTab.settings),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  void _handleMenuAction(BuildContext context, String action) async {
    final store = appStore;

    switch (action) {
      case 'refresh':
        await _refreshData(context);
        break;
      case 'disconnect':
        await _disconnect(context);
        break;
      case 'about':
        _showAboutDialog(context);
        break;
    }
  }

  Future<void> _refreshData(BuildContext context) async {
    final store = appStore;
    store.setLoading(true);

    try {
      // Refresh sessions and terminals
      // Implementation would go here
      store.setStatusMessage('Data refreshed successfully');
    } catch (e) {
      store.setError('Failed to refresh data: $e');
      store.setStatusMessage('Refresh failed');
    } finally {
      store.setLoading(false);
    }
  }

  Future<void> _disconnect(BuildContext context) async {
    final store = appStore;

    try {
      // Disconnect from server
      // Implementation would go here

      store.reset();
      store.setStatusMessage('Disconnected successfully');

      if (context.mounted) {
        Navigator.of(context).pushReplacementNamed('/connect');
      }
    } catch (e) {
      store.setError('Failed to disconnect: $e');
      store.setStatusMessage('Disconnect failed');
    }
  }

  void _showAboutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('About RiTerm'),
        content: const Text(
          'RiTerm - Secure Remote Terminal Access\n\n'
          'Version: 1.0.0\n'
          'Built with Flutter, Rust, and iroh P2P\n\n'
          '© 2024 RiTerm Project',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}

class _ConnectionStatusIndicator extends StatelessWidget {
  final ConnectionStatus status;
  final AppSession? session;

  const _ConnectionStatusIndicator({
    required this.status,
    required this.session,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _getStatusColor().withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _getStatusColor().withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_getStatusIcon(), size: 14, color: _getStatusColor()),
          const SizedBox(width: 6),
          Text(
            _getStatusText(),
            style: TextStyle(
              color: _getStatusColor(),
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Color _getStatusColor() {
    switch (status) {
      case ConnectionStatus.connected:
        return Colors.green;
      case ConnectionStatus.connecting:
        return Colors.orange;
      case ConnectionStatus.error:
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  IconData _getStatusIcon() {
    switch (status) {
      case ConnectionStatus.connected:
        return LucideIcons.checkCircle;
      case ConnectionStatus.connecting:
        return LucideIcons.loader;
      case ConnectionStatus.error:
        return LucideIcons.xCircle;
      default:
        return LucideIcons.circle;
    }
  }

  String _getStatusText() {
    switch (status) {
      case ConnectionStatus.connected:
        return 'Connected';
      case ConnectionStatus.connecting:
        return 'Connecting...';
      case ConnectionStatus.error:
        return 'Error';
      default:
        return 'Disconnected';
    }
  }
}

class _NavigationTab extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _NavigationTab({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 48,
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: isSelected ? const Color(0xFF00D4FF) : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 18,
              color: isSelected
                  ? const Color(0xFF00D4FF)
                  : const Color(0xFF6C7293),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                color: isSelected
                    ? const Color(0xFF00D4FF)
                    : const Color(0xFF6C7293),
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Tab content widgets
class _HomeTab extends StatelessWidget {
  const _HomeTab();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Welcome to RiTerm',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
          SizedBox(height: 16),
          Text(
            'Get started by creating a terminal or setting up TCP forwarding.',
            style: TextStyle(fontSize: 16, color: Color(0xFF6C7293)),
          ),
          // Add more home content here
        ],
      ),
    );
  }
}

class _TerminalsTab extends StatelessWidget {
  const _TerminalsTab();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(16),
      child: Column(
        children: [
          // Terminal management UI will go here
          Text(
            'Terminals',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
          // Terminal list and actions
        ],
      ),
    );
  }
}

class _TcpForwardingTab extends StatelessWidget {
  const _TcpForwardingTab();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(16),
      child: TcpForwardingView(),
    );
  }
}

class _SettingsTab extends StatelessWidget {
  const _SettingsTab();

  @override
  Widget build(BuildContext context) {
    return const Padding(padding: EdgeInsets.all(16), child: SettingsView());
  }
}

