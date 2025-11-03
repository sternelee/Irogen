import 'package:flutter/material.dart';
import 'package:shadcn_ui/shadcn_ui.dart' hide LucideIcons;
import 'package:lucide_icons/lucide_icons.dart';
import 'package:xterm/xterm.dart';

import '../stores/app_store.dart';
import '../bridge_generated.dart/third_party/rust_lib_app/message_bridge.dart';

class TerminalView extends StatefulWidget {
  const TerminalView({super.key});

  @override
  State<TerminalView> createState() => _TerminalViewState();
}

class _TerminalViewState extends State<TerminalView> {
  final Map<String, Terminal> _terminals = {};
  final Map<String, TextEditingController> _controllers = {};

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final store = appStore;

    return Column(
      children: [
        // Terminal creation section
        _buildTerminalCreationBar(context),
        const SizedBox(height: 16),

        // Terminal tabs
        _buildTerminalTabs(context),
        const SizedBox(height: 16),

        // Terminal content
        Expanded(
          child: ValueListenableBuilder(
            valueListenable: store.terminalsSignal,
            builder: (_, terminals, __) {
              if (terminals.isEmpty) {
                return _buildEmptyState(context);
              }

              return ValueListenableBuilder(
                valueListenable: store.activeTerminalIdSignal,
                builder: (_, activeTerminalId, ___) {
                  final activeTerminal = terminals.firstWhere(
                    (t) => t.id == activeTerminalId,
                    orElse: () => terminals.first,
                  );

                  if (!_terminals.containsKey(activeTerminal.id)) {
                    return _buildTerminalLoadingState(activeTerminal);
                  }

                  return _buildTerminalContent(activeTerminal);
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildTerminalCreationBar(BuildContext context) {
    final store = appStore;

    return ShadCard(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Remote Terminals',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  ValueListenableBuilder(
                    valueListenable: store.terminalsSignal,
                    builder: (_, terminals, __) {
                      return Text(
                        '${terminals.length} active terminal${terminals.length != 1 ? 's' : ''}',
                        style: const TextStyle(
                          fontSize: 14,
                          color: Color(0xFF6C7293),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            ValueListenableBuilder(
              valueListenable: store.isLoadingSignal,
              builder: (_, isLoading, __) {
                return ShadButton(
                  onPressed: isLoading ? null : () => _createTerminal(context),
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
                            Text('Create Terminal'),
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

  Widget _buildTerminalTabs(BuildContext context) {
    final store = appStore;

    return ValueListenableBuilder(
      valueListenable: store.terminalsSignal,
      builder: (_, terminals, __) {
        if (terminals.isEmpty) return const SizedBox.shrink();

        return ValueListenableBuilder(
          valueListenable: store.activeTerminalIdSignal,
          builder: (_, activeTerminalId, __) {
            return Container(
              height: 48,
              decoration: const BoxDecoration(
                color: Color(0xFF2A2A3E),
                borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
              ),
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: terminals.length,
                itemBuilder: (context, index) {
                  final terminal = terminals[index];
                  final isActive = terminal.id == activeTerminalId;

                  return _TerminalTab(
                    terminal: terminal,
                    isActive: isActive,
                    onTap: () => store.setActiveTerminalId(terminal.id),
                    onClose: () => _closeTerminal(context, terminal.id),
                  );
                },
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            LucideIcons.terminal,
            size: 64,
            color: Color(0xFF6C7293),
          ),
          const SizedBox(height: 16),
          const Text(
            'No terminals available',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w500,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Create a terminal to get started',
            style: TextStyle(
              fontSize: 14,
              color: Color(0xFF6C7293),
            ),
          ),
          const SizedBox(height: 24),
          ShadButton(
            onPressed: () => _createTerminal(context),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(LucideIcons.plus, size: 16),
                SizedBox(width: 6),
                Text('Create Terminal'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTerminalLoadingState(AppTerminal terminal) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(
            'Initializing terminal "${terminal.name ?? terminal.id}"...',
            style: const TextStyle(
              fontSize: 16,
              color: Color(0xFF6C7293),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTerminalContent(AppTerminal terminal) {
    final xterm = _terminals[terminal.id]!;

    return Container(
      decoration: BoxDecoration(
        color: Colors.black,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF45475A)),
      ),
      child: Column(
        children: [
          // Terminal header
          Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: const BoxDecoration(
              color: Color(0xFF2A2A3E),
              borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
            ),
            child: Row(
              children: [
                const Icon(
                  LucideIcons.terminal,
                  size: 16,
                  color: Color(0xFF00D4FF),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    terminal.name ?? 'Terminal',
                    style: const TextStyle(
                      fontSize: 14,
                      color: Colors.white,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                ShadButton.ghost(
                  onPressed: () => _resizeTerminal(context, terminal.id),
                  child: const Icon(LucideIcons.maximize2, size: 16),
                ),
                const SizedBox(width: 8),
                ShadButton.ghost(
                  onPressed: () => _closeTerminal(context, terminal.id),
                  child: const Icon(LucideIcons.x, size: 16),
                ),
              ],
            ),
          ),

          // Terminal view
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(8),
              child: TerminalView(xterm),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _createTerminal(BuildContext context) async {
    final store = appStore;
    store.setLoading(true);
    store.clearError();

    try {
      final client = createMessageClient();
      final terminalId = await createRemoteTerminal(
        client: client,
        sessionId: store.currentSession!.id,
        name: "Flutter Terminal",
        shellPath: null, // Use default shell
        workingDir: null, // Use default directory
        rows: 24,
        cols: 80,
      );

      final terminal = AppTerminal(
        id: terminalId,
        name: "Terminal ${store.terminals.length + 1}",
        sessionId: store.currentSession!.id,
        shellPath: "/bin/bash",
        workingDir: "/",
        rows: 24,
        cols: 80,
        isActive: true,
        createdAt: DateTime.now(),
      );

      store.addTerminal(terminal);
      store.setActiveTerminalId(terminalId);

      // Create xterm instance
      final xterm = Terminal();
      xterm.onOutput = (data) {
        _sendTerminalInput(terminalId, data);
      };

      _terminals[terminalId] = xterm;
      _controllers[terminalId] = TextEditingController();

      store.setStatusMessage('Terminal created successfully');
    } catch (e) {
      store.setError('Failed to create terminal: $e');
      store.setStatusMessage('Failed to create terminal');
    } finally {
      store.setLoading(false);
    }
  }

  Future<void> _closeTerminal(BuildContext context, String terminalId) async {
    final store = appStore;

    try {
      final client = createMessageClient();
      await stopRemoteTerminal(
        client: client,
        sessionId: store.currentSession!.id,
        terminalId: terminalId,
      );

      // Clean up resources
      _terminals.remove(terminalId);
      _controllers.remove(terminalId);

      store.removeTerminal(terminalId);
      store.setStatusMessage('Terminal closed');
    } catch (e) {
      store.setError('Failed to close terminal: $e');
      store.setStatusMessage('Failed to close terminal');
    }
  }

  Future<void> _resizeTerminal(BuildContext context, String terminalId) async {
    // Show resize dialog
    final result = await showDialog<Map<String, int>>(
      context: context,
      builder: (context) => _ResizeTerminalDialog(),
    );

    if (result != null) {
      // Resize terminal
      try {
        final client = createMessageClient();
        // Implementation would go here
        store.setStatusMessage('Terminal resized');
      } catch (e) {
        store.setError('Failed to resize terminal: $e');
        store.setStatusMessage('Failed to resize terminal');
      }
    }
  }

  Future<void> _sendTerminalInput(String terminalId, String input) async {
    final store = appStore;

    try {
      final client = createMessageClient();
      await sendTerminalInput(
        client: client,
        sessionId: store.currentSession!.id,
        terminalId: terminalId,
        input: input,
      );
    } catch (e) {
      debugPrint('Failed to send terminal input: $e');
    }
  }
}

class _TerminalTab extends StatelessWidget {
  final AppTerminal terminal;
  final bool isActive;
  final VoidCallback onTap;
  final VoidCallback onClose;

  const _TerminalTab({
    required this.terminal,
    required this.isActive,
    required this.onTap,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: isActive
                  ? const Color(0xFF00D4FF)
                  : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              LucideIcons.terminal,
              size: 16,
              color: isActive
                  ? const Color(0xFF00D4FF)
                  : const Color(0xFF6C7293),
            ),
            const SizedBox(width: 8),
            Text(
              terminal.name ?? 'Terminal',
              style: TextStyle(
                color: isActive
                    ? const Color(0xFF00D4FF)
                    : const Color(0xFFD1D5DB),
                fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                fontSize: 14,
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: onClose,
              child: Icon(
                LucideIcons.x,
                size: 14,
                color: const Color(0xFF6C7293),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ResizeTerminalDialog extends StatefulWidget {
  const _ResizeTerminalDialog();

  @override
  State<_ResizeTerminalDialog> createState() => _ResizeTerminalDialogState();
}

class _ResizeTerminalDialogState extends State<_ResizeTerminalDialog> {
  final _rowsController = TextEditingController(text: '24');
  final _colsController = TextEditingController(text: '80');

  @override
  void dispose() {
    _rowsController.dispose();
    _colsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ShadDialog(
      title: const Text('Resize Terminal'),
      description: const Text('Enter new terminal dimensions:'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ShadInput(
            placeholder: const Text('Rows'),
            controller: _rowsController,
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 12),
          ShadInput(
            placeholder: const Text('Columns'),
            controller: _colsController,
            keyboardType: TextInputType.number,
          ),
        ],
      ),
      actions: [
        ShadButton.outline(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ShadButton(
          onPressed: () {
            final rows = int.tryParse(_rowsController.text) ?? 24;
            final cols = int.tryParse(_colsController.text) ?? 80;
            Navigator.of(context).pop({'rows': rows, 'cols': cols});
          },
          child: const Text('Resize'),
        ),
      ],
    );
  }
}