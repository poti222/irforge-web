import 'package:flutter/material.dart';

import 'setup_link.dart';

class ManualPage extends StatefulWidget {
  const ManualPage({super.key, this.initial});
  final AgentConfig? initial;

  @override
  State<ManualPage> createState() => _ManualPageState();
}

class _ManualPageState extends State<ManualPage> {
  late final _url =
      TextEditingController(text: widget.initial?.urls.join('\n') ?? '');
  late final _secret =
      TextEditingController(text: widget.initial?.secret ?? '');
  late final _senders =
      TextEditingController(text: widget.initial?.senders.join(', ') ?? '');
  String? _err;

  void _save() {
    final urls =
        _url.text.split(RegExp(r'\s+')).where((e) => e.isNotEmpty).toList();
    if (urls.isEmpty || !urls.every(isValidWebhookUrl)) {
      setState(
          () => _err = 'آدرس وبهوک معتبر نیست (باید با https:// شروع شود)');
      return;
    }
    if (_secret.text.trim().isEmpty) {
      setState(() => _err = 'کلید امنیتی خالی است');
      return;
    }
    final senders = _senders.text
        .split(RegExp(r'[,،\n]'))
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    Navigator.of(context).pop(
        AgentConfig(urls: urls, secret: _secret.text.trim(), senders: senders));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ورود دستی')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(
          controller: _url,
          textDirection: TextDirection.ltr,
          minLines: 1,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'آدرس وبهوک (هر خط یک آدرس؛ آدرس‌های پشتیبان اختیاری)',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
            controller: _secret,
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
                labelText: 'کلید امنیتی (irfsms_…)',
                border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(
            controller: _senders,
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
                labelText: 'فرستنده‌های مجاز بانک (با ویرگول جدا کنید)',
                helperText:
                    'فقط پیامک این فرستنده‌ها ارسال می‌شود؛ پیامک‌های شخصی هرگز نه.',
                border: OutlineInputBorder())),
        if (_err != null)
          Padding(
              padding: const EdgeInsets.only(top: 12),
              child:
                  Text(_err!, style: const TextStyle(color: Colors.redAccent))),
        const SizedBox(height: 16),
        FilledButton(onPressed: _save, child: const Text('ذخیره و تست')),
      ]),
    );
  }
}
