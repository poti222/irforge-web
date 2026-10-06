import 'package:flutter/material.dart';

import 'native.dart';

/// همه‌ی مقادیرِ خودکارسازی/پایداری؛ هر تغییر همان لحظه ذخیره می‌شود.
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  AgentSettings? _s;
  late final TextEditingController _url = TextEditingController();

  @override
  void initState() {
    super.initState();
    Native.getSettings().then((v) {
      if (mounted)
        setState(() {
          _s = v;
          _url.text = v.updateUrl;
        });
    });
  }

  void _set(AgentSettings v) {
    setState(() => _s = v);
    Native.saveSettings(v);
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    return Scaffold(
      appBar: AppBar(title: const Text('تنظیمات')),
      body: s == null
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 560),
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                    _head('پایداری ارسال'),
                    SwitchListTile(
                      title: const Text('امتحان همه‌ی شبکه‌ها'),
                      subtitle: const Text(
                          'Wi-Fi، موبایل، با VPN و بی‌VPN؛ اگر دامنه فقط از یک مسیر باز است همان را پیدا می‌کند.'),
                      value: s.tryAllNetworks,
                      onChanged: (v) => _set(s.copyWith(tryAllNetworks: v)),
                    ),
                    _slider(
                        'فاصله‌ی اولِ تلاش مجدد',
                        '${s.backoffSeconds} ثانیه',
                        s.backoffSeconds,
                        5,
                        120,
                        (v) => _set(s.copyWith(backoffSeconds: v))),
                    _slider(
                        'مهلت پاسخ سرور',
                        '${s.timeoutSeconds} ثانیه',
                        s.timeoutSeconds,
                        5,
                        60,
                        (v) => _set(s.copyWith(timeoutSeconds: v))),
                    _slider(
                        'نگهداری سابقه ارسال‌ها',
                        '${s.keepDays} روز',
                        s.keepDays,
                        1,
                        30,
                        (v) => _set(s.copyWith(keepDays: v))),
                    _head('اعلان‌ها'),
                    SwitchListTile(
                      title: const Text('اعلان وقتی کلید/کانال مشکل دارد'),
                      value: s.notifyOnFailure,
                      onChanged: (v) => _set(s.copyWith(notifyOnFailure: v)),
                    ),
                    SwitchListTile(
                      title: const Text('اعلان برای هر پیامک رسیده به سایت'),
                      subtitle: const Text('برای اطمینان، مخصوصاً روزهای اول.'),
                      value: s.notifyOnSend,
                      onChanged: (v) => _set(s.copyWith(notifyOnSend: v)),
                    ),
                    _head('به‌روزرسانی برنامه'),
                    SwitchListTile(
                      title: const Text('بررسی خودکار نسخه جدید'),
                      value: s.autoUpdateCheck,
                      onChanged: (v) => _set(s.copyWith(autoUpdateCheck: v)),
                    ),
                    _slider(
                        'هر چند ساعت بررسی شود',
                        '${s.updateCheckHours} ساعت',
                        s.updateCheckHours,
                        1,
                        48,
                        (v) => _set(s.copyWith(updateCheckHours: v))),
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: TextField(
                        controller: _url,
                        textDirection: TextDirection.ltr,
                        decoration: const InputDecoration(
                          labelText: 'آدرس مانیفست آپدیت (اختیاری)',
                          helperText:
                              'خالی = خودکار از دامنه‌ی وبهوک: /api/agent/latest',
                          border: OutlineInputBorder(),
                        ),
                        onChanged: (v) => _set(s.copyWith(updateUrl: v.trim())),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                        onPressed: () {
                          _url.clear();
                          _set(const AgentSettings());
                        },
                        child: const Text('بازگشت به مقادیر پیش‌فرض')),
                  ]),
                ),
              ),
            ),
    );
  }

  Widget _head(String t) => Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 4),
        child: Text(t,
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(color: Theme.of(context).colorScheme.primary)),
      );

  Widget _slider(String title, String value, int cur, int min, int max,
          void Function(int) onChanged) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [Text(title), Text(value)]),
          ),
          Slider(
              value: cur.toDouble().clamp(min.toDouble(), max.toDouble()),
              min: min.toDouble(),
              max: max.toDouble(),
              divisions: max - min,
              onChanged: (v) => onChanged(v.round())),
        ],
      );
}
