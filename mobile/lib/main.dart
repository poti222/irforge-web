import 'package:flutter/material.dart';

import 'home_page.dart';

void main() => runApp(const PayAgentApp());

class PayAgentApp extends StatelessWidget {
  const PayAgentApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'IrForge Pay Agent',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.deepOrange, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: Colors.deepOrange, brightness: Brightness.dark, useMaterial3: true),
      // کلِ اپ فارسی/راست‌به‌چپ است.
      builder: (context, child) => Directionality(textDirection: TextDirection.rtl, child: child!),
      home: const HomePage(),
    );
  }
}
