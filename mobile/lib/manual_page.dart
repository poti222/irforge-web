import 'package:flutter/material.dart';

import 'setup_link.dart';

/// ساخت/ویرایشِ یک اتصال. هر اتصال آدرس، کلید و فیلترِ جدا دارد.
class ManualPage extends StatefulWidget {
  const ManualPage({super.key, this.initial});
  final AgentConfig? initial;

  @override
  State<ManualPage> createState() => _ManualPageState();
}

class _ManualPageState extends State<ManualPage> {
  late final _name = TextEditingController(text: widget.initial?.name ?? '');
  late final _url =
      TextEditingController(text: widget.initial?.urls.join('\n') ?? '');
  late final _secret =
      TextEditingController(text: widget.initial?.secret ?? '');
  late final _senders =
      TextEditingController(text: widget.initial?.senders.join(', ') ?? '');
  late final _keywords =
      TextEditingController(text: widget.initial?.keywords.join(', ') ?? '');
  late String _kind = widget.initial?.kind ?? AgentConfig.kindPayment;
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
    final senders = splitList(_senders.text);
    final keywords = splitList(_keywords.text);
    if (_kind == AgentConfig.kindForward &&
        senders.isEmpty &&
        keywords.isEmpty) {
      setState(() => _err =
          'برای «ارسال به تلگرام» حداقل یک فرستنده یا یک کلمه‌ی فیلتر لازم است؛ وگرنه پیامک‌های شخصی هم ارسال می‌شد.');
      return;
    }
    final base = widget.initial;
    Navigator.of(context).pop(AgentConfig(
      id: base?.id ?? '',
      enabled: base?.enabled ?? true,
      name: _name.text.trim(),
      kind: _kind,
      urls: urls,
      secret: _secret.text.trim(),
      senders: senders,
      keywords: keywords,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final isForward = _kind == AgentConfig.kindForward;
    return Scaffold(
      appBar: AppBar(
          title: Text(widget.initial == null ? 'اتصال تازه' : 'ویرایش اتصال')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(
          controller: _name,
          decoration: const InputDecoration(
            labelText: 'نام اتصال (اختیاری)',
            helperText: 'مثلاً «بانک ملی» یا «ارسال به تلگرام»',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(
                value: AgentConfig.kindPayment,
                label: Text('تأیید پرداخت'),
                icon: Icon(Icons.account_balance)),
            ButtonSegment(
                value: AgentConfig.kindForward,
                label: Text('ارسال به تلگرام'),
                icon: Icon(Icons.send)),
          ],
          selected: {_kind},
          onSelectionChanged: (v) => setState(() => _kind = v.first),
        ),
        const SizedBox(height: 12),
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
                labelText: 'کلید امنیتی (irfsms_… یا irfsmf_…)',
                border: OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(
            controller: _senders,
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(
                labelText: isForward
                    ? 'فقط پیامک این فرستنده‌ها (با ویرگول جدا کنید)'
                    : 'فرستنده‌های مجاز بانک (با ویرگول جدا کنید)',
                helperText: isForward
                    ? 'مثل Blubank یا 30008080. خالی = بر اساس کلمه‌ی فیلتر.'
                    : 'فقط پیامک این فرستنده‌ها ارسال می‌شود؛ پیامک‌های شخصی هرگز نه.',
                border: const OutlineInputBorder())),
        const SizedBox(height: 12),
        TextField(
            controller: _keywords,
            decoration: InputDecoration(
                labelText: isForward
                    ? 'فقط اگر متن شامل این کلمه‌ها باشد (با ویرگول جدا کنید)'
                    : 'فیلتر کلمه (اختیاری)',
                helperText: 'مثلاً: واریز — خالی = بدون فیلترِ کلمه',
                border: const OutlineInputBorder())),
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
