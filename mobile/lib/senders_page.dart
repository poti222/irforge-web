import 'package:flutter/material.dart';

import 'native.dart';
import 'setup_link.dart';

/// محدود کردنِ پیامک‌هایی که خوانده و ارسال می‌شوند:
///  • فرستنده‌های مجاز (نام مثل Blubank یا شماره مثل 30008080 / +98…)؛ لیست خالی = فقط پیامک‌های شبیه بانکی.
///  • فیلترِ کلمه (اختیاری): فقط پیامکی که یکی از این کلمه‌ها را در متن دارد.
class SendersPage extends StatefulWidget {
  const SendersPage({super.key});

  @override
  State<SendersPage> createState() => _SendersPageState();
}

class _SendersPageState extends State<SendersPage> {
  AgentConfig? _cfg;
  AgentSettings _s = const AgentSettings();
  List<String> _recent = const [];
  final _add = TextEditingController();
  final _kw = TextEditingController();
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final c = await Native.loadConfig();
    final s = await Native.getSettings();
    final ev = await Native.events();
    if (!mounted) return;
    setState(() {
      _cfg = c;
      _s = s;
      _kw.text = s.keywords;
      _recent = {
        for (final e in ev)
          if (e.sender.isNotEmpty) e.sender
      }.toList();
      _loaded = true;
    });
  }

  Future<void> _saveSenders(List<String> senders) async {
    final c = _cfg;
    if (c == null) return;
    final next = AgentConfig(urls: c.urls, secret: c.secret, senders: senders);
    await Native.saveConfig(next);
    if (mounted) setState(() => _cfg = next);
  }

  Future<void> _addSender(String raw) async {
    final v = raw.trim();
    final c = _cfg;
    if (v.isEmpty || c == null) return;
    if (c.senders.any((e) => e.toLowerCase() == v.toLowerCase())) return;
    await _saveSenders([...c.senders, v]);
    _add.clear();
  }

  @override
  Widget build(BuildContext context) {
    final c = _cfg;
    final senders = c?.senders ?? const <String>[];
    final suggestions = _recent
        .where((r) => !senders.any((e) => e.toLowerCase() == r.toLowerCase()))
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('محدود کردن فرستنده‌ها')),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : c == null
              ? const Center(
                  child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                          'اول اپ را به کانال وصل کنید (QR یا ورود دستی).')))
              : SafeArea(
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 560),
                      child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            Card(
                              color: senders.isEmpty
                                  ? Colors.orange.withValues(alpha: 0.15)
                                  : Colors.green.withValues(alpha: 0.12),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Text(senders.isEmpty
                                    ? 'الان محدودیتی روی فرستنده نیست: فقط پیامک‌هایی که شبیه تراکنش بانکی‌اند (واریز، مانده، ریال + عدد) ارسال می‌شوند. برای امن‌تر شدن، فرستنده‌ی بانک را اضافه کنید.'
                                    : 'فقط پیامک این ${senders.length} فرستنده خوانده و ارسال می‌شود؛ بقیه‌ی پیامک‌ها هرگز از گوشی خارج نمی‌شوند.'),
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text('فرستنده‌های مجاز',
                                style: Theme.of(context).textTheme.titleSmall),
                            for (final s in senders)
                              ListTile(
                                dense: true,
                                leading:
                                    const Icon(Icons.verified_user_outlined),
                                title:
                                    Text(s, textDirection: TextDirection.ltr),
                                trailing: IconButton(
                                  tooltip: 'حذف',
                                  icon: const Icon(Icons.close),
                                  onPressed: () => _saveSenders(
                                      senders.where((e) => e != s).toList()),
                                ),
                              ),
                            const SizedBox(height: 8),
                            Row(children: [
                              Expanded(
                                child: TextField(
                                  controller: _add,
                                  textDirection: TextDirection.ltr,
                                  onSubmitted: _addSender,
                                  decoration: const InputDecoration(
                                    labelText: 'نام یا شماره‌ی فرستنده',
                                    helperText:
                                        'مثل Blubank یا 30008080 — دقیقاً همان که در پیامک نشان داده می‌شود',
                                    border: OutlineInputBorder(),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              FilledButton(
                                  onPressed: () => _addSender(_add.text),
                                  child: const Text('افزودن')),
                            ]),
                            if (suggestions.isNotEmpty) ...[
                              const SizedBox(height: 16),
                              Text('از پیامک‌های اخیر انتخاب کنید',
                                  style:
                                      Theme.of(context).textTheme.titleSmall),
                              const SizedBox(height: 4),
                              Wrap(spacing: 8, children: [
                                for (final r in suggestions)
                                  ActionChip(
                                      label: Text(r,
                                          textDirection: TextDirection.ltr),
                                      avatar: const Icon(Icons.add, size: 16),
                                      onPressed: () => _addSender(r)),
                              ]),
                            ],
                            const Divider(height: 40),
                            Text('فیلتر کلمه (اختیاری)',
                                style: Theme.of(context).textTheme.titleSmall),
                            const SizedBox(height: 8),
                            TextField(
                              controller: _kw,
                              decoration: const InputDecoration(
                                labelText:
                                    'فقط اگر متن شامل این کلمه‌ها باشد (با ویرگول جدا کنید)',
                                helperText: 'مثلاً: واریز — خالی = بدون فیلتر',
                                border: OutlineInputBorder(),
                              ),
                              onChanged: (v) {
                                _s = _s.copyWith(keywords: v.trim());
                                Native.saveSettings(_s);
                              },
                            ),
                          ]),
                    ),
                  ),
                ),
    );
  }
}
