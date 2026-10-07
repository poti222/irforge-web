import 'package:flutter/material.dart';

import 'native.dart';
import 'setup_link.dart';

/// هر پیامکی که به اپ رسیده + تصمیمِ اپ. اگر اینجا هیچ ردیفی نیست یعنی اندروید پیامک را به اپ نمی‌دهد.
class EventsPage extends StatefulWidget {
  const EventsPage({super.key});

  @override
  State<EventsPage> createState() => _EventsPageState();
}

class _EventsPageState extends State<EventsPage> {
  List<SmsEvent>? _ev;
  AgentConfig? _cfg;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final e = await Native.events();
    final c = await Native.loadConfig();
    if (mounted) {
      setState(() {
        _ev = e;
        _cfg = c;
      });
    }
  }

  static const _labels = {
    'queued': 'پذیرفته شد و به صف ارسال رفت',
    'not_allowed': 'رد شد: فرستنده در لیست مجاز نیست',
    'not_bank_like': 'رد شد: شبیه پیامک بانکی نبود (فرستنده‌ی مجاز تنظیم نشده)',
    'no_config': 'رد شد: اپ هنوز به کانال وصل نیست',
    'blank': 'رد شد: متن خالی',
  };

  Future<void> _allow(String sender) async {
    final c = _cfg;
    if (c == null) return;
    await Native.saveConfig(AgentConfig(
        urls: c.urls,
        secret: c.secret,
        senders: {...c.senders, sender}.toList()));
    await _load();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('«$sender» به فرستنده‌های مجاز اضافه شد')));
    }
  }

  String _fmt(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.hour)}:${two(d.minute)}:${two(d.second)}';
  }

  @override
  Widget build(BuildContext context) {
    final ev = _ev;
    return Scaffold(
      appBar: AppBar(title: const Text('پیامک‌های دریافتی'), actions: [
        IconButton(
          tooltip: 'پاک کردن',
          icon: const Icon(Icons.delete_outline),
          onPressed: () async {
            await Native.clearEvents();
            await _load();
          },
        ),
      ]),
      body: ev == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    ev.isEmpty
                        ? 'هنوز هیچ پیامکی به اپ نرسیده. اگر پیامک بانک آمده ولی اینجا نیست، اندروید آن را به اپ نمی‌دهد: '
                            'مجوز «SMS»، «Allow restricted settings»، «Autostart» و (شیائومی) مجوز «Notification SMS / پیامک‌های اعلان» را بررسی کنید.'
                        : 'فرستنده‌ی مجاز: ${(_cfg?.senders.isEmpty ?? true) ? 'تنظیم نشده (فقط پیامک‌های شبیه بانکی ارسال می‌شود)' : _cfg!.senders.join('، ')}',
                  ),
                ),
                for (final e in ev)
                  ListTile(
                    leading: Icon(
                        e.decision == 'queued'
                            ? Icons.check_circle
                            : Icons.block,
                        color: e.decision == 'queued'
                            ? Colors.green
                            : Colors.orange),
                    title: Text(e.sender.isEmpty ? '(بدون فرستنده)' : e.sender,
                        textDirection: TextDirection.ltr),
                    subtitle: Text(
                        '${_fmt(e.ts)} · ${_labels[e.decision] ?? e.decision}'),
                    trailing: (e.decision == 'not_allowed' ||
                                e.decision == 'not_bank_like') &&
                            e.sender.isNotEmpty
                        ? TextButton(
                            onPressed: () => _allow(e.sender),
                            child: const Text('افزودن به مجاز'))
                        : null,
                  ),
              ]),
            ),
    );
  }
}
