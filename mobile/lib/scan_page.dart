import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'setup_link.dart';

class ScanPage extends StatefulWidget {
  const ScanPage({super.key});

  @override
  State<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<ScanPage> {
  bool _done = false;
  String? _err;

  void _onDetect(BarcodeCapture cap) {
    if (_done) return;
    for (final b in cap.barcodes) {
      final c = AgentConfig.parseLink(b.rawValue ?? '');
      if (c != null) {
        _done = true;
        Navigator.of(context).pop(c);
        return;
      }
    }
    setState(() => _err = 'این QR مربوط به IrForge نیست');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('اسکن QR پنل')),
      body: Stack(children: [
        MobileScanner(onDetect: _onDetect),
        if (_err != null)
          Positioned(
              bottom: 32,
              left: 16,
              right: 16,
              child: Card(
                  child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(_err!, textAlign: TextAlign.center)))),
      ]),
    );
  }
}
