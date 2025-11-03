import 'package:flutter/material.dart';
import 'package:qr_code_scanner/qr_code_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shadcn_ui/shadcn_ui.dart' hide LucideIcons;
import 'package:lucide_icons/lucide_icons.dart';
import 'dart:io';

import '../stores/app_store.dart';

class QRScannerDialog extends StatefulWidget {
  const QRScannerDialog({super.key});

  @override
  State<QRScannerDialog> createState() => _QRScannerDialogState();
}

class _QRScannerDialogState extends State<QRScannerDialog> {
  final GlobalKey qrKey = GlobalKey(debugLabel: 'QR');
  QRViewController? controller;
  bool isScanning = true;

  @override
  void reassemble() {
    super.reassemble();
    if (Platform.isAndroid) {
      controller?.pauseCamera();
    } else if (Platform.isIOS) {
      controller?.resumeCamera();
    }
  }

  @override
  void dispose() {
    controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.9,
          maxHeight: MediaQuery.of(context).size.height * 0.8,
        ),
        child: ShadCard(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Header
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Scan QR Code',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                    ShadButton.ghost(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Icon(LucideIcons.x),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // QR Scanner
                Container(
                  height: 300,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(8),
                    overflow: Overflow.hidden,
                  ),
                  child: isScanning
                      ? _buildQRScanner()
                      : _buildPermissionRequest(),
                ),

                const SizedBox(height: 16),

                // Instructions
                const Text(
                  'Position the QR code within the frame to scan',
                  style: TextStyle(
                    fontSize: 14,
                    color: Color(0xFF6C7293),
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildQRScanner() {
    return QRView(
      key: qrKey,
      onQRViewCreated: _onQRViewCreated,
      overlay: QrScannerOverlayShape(
        borderColor: const Color(0xFF00D4FF),
        borderRadius: 10,
        borderLength: 30,
        borderWidth: 10,
        cutOutSize: 250,
      ),
    );
  }

  Widget _buildPermissionRequest() {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(
          LucideIcons.camera,
          size: 64,
          color: Color(0xFF6C7293),
        ),
        const SizedBox(height: 16),
        const Text(
          'Camera Permission Required',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Please grant camera permission to scan QR codes',
          style: TextStyle(
            fontSize: 14,
            color: Color(0xFF6C7293),
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        ShadButton(
          onPressed: _requestCameraPermission,
          child: const Text('Grant Permission'),
        ),
      ],
    );
  }

  void _onQRViewCreated(QRViewController controller) {
    this.controller = controller;

    controller.scannedDataStream.listen((scanData) {
      if (scanData.code != null) {
        _handleQRCodeScanned(scanData.code!);
      }
    });
  }

  void _handleQRCodeScanned(String code) async {
    // Vibrate (optional)
    // HapticFeedback.lightImpact();

    // Play beep sound (optional)
    // AudioPlayer().play(AssetSource('sounds/beep.mp3'));

    final store = context.read<AppStore>();
    store.setTicketInput(code);

    if (!_validateTicket(code)) {
      store.setError('Invalid QR code format');
      if (mounted) {
        _showError('Invalid QR code format. Please scan a valid RiTerm ticket.');
      }
      return;
    }

    if (mounted) {
      Navigator.of(context).pop();
      _showSuccess('QR code scanned successfully!');
    }
  }

  Future<void> _requestCameraPermission() async {
    var status = await Permission.camera.status;

    if (status.isDenied) {
      final result = await Permission.camera.request();
      if (result.isGranted) {
        setState(() {
          isScanning = true;
        });
      } else {
        _showError('Camera permission denied. Please enable camera access in settings.');
      }
    } else if (status.isGranted) {
      setState(() {
        isScanning = true;
      });
    } else if (status.isPermanentlyDenied) {
      _showError('Camera permission permanently denied. Please enable it in app settings.');
    }
  }

  void _showSuccess(String message) {
    ShadToaster.of(context).show(
      ShadToast(
        title: const Text('Success'),
        description: Text(message),
        icon: const Icon(LucideIcons.checkCircle),
      ),
    );
  }

  void _showError(String message) {
    ShadToaster.of(context).show(
      ShadToast(
        title: const Text('Error'),
        description: Text(message),
        icon: const Icon(LucideIcons.xCircle),
        variant: ShadToastVariant.destructive,
      ),
    );
  }

  bool _validateTicket(String ticket) {
    if (ticket.isEmpty) return false;
    if (!ticket.startsWith('ticket:')) return false;
    return ticket.length > 20;
  }
}