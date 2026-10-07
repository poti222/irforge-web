import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'ios_guide_page.dart';
import 'manual_page.dart';
import 'native.dart';
import 'events_page.dart';
import 'queue_page.dart';
import 'scan_page.dart';
import 'setup_link.dart';
import 'senders_page.dart';
import 'settings_page.dart';

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with WidgetsBindingObserver {
  AgentConfig? _cfg;
  AgentStatus _st = const AgentStatus();
  bool _busy = false;
  String? _msg;
  Timer? _poll;
  int? _dlPct; // null = دانلود در جریان نیست

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Native.listen();
    Native.onUpdateProgress = (p) {
      if (mounted) setState(() => _dlPct = p);
    };
    _refresh().then((_) async {
      await _askAllPermissions();
      await Native.checkUpdate(); // نتیجه کش می‌شود و در _st.update می‌آید
      await _refresh();
    });
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final c = await Native.loadConfig();
    final s = await Native.status();
    if (mounted)
      setState(() {
        _cfg = c;
        _st = s;
      });
  }

  /// همان اولِ کار، همه‌ی دسترسی‌های لازم را یک‌جا می‌خواهد: پیامک، اعلان، دوربین (اسکنِ QR) و معافیت از باتری.
  Future<void> _askAllPermissions() async {
    if (!Native.isAndroid ||
        !mounted ||
        (_st.smsPermission && _st.batteryExempt)) return;
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('دسترسی‌های لازم'),
        content: const Text(
          'برای اینکه پیامک بانک همیشه و خودکار به سایت برسد، این دسترسی‌ها لازم است:\n\n'
          '• دریافت پیامک — فقط پیامک بانک مجاز خوانده می‌شود\n'
          '• اعلان — هشدار وقتی کلید یا اتصال مشکل دارد\n'
          '• دوربین — فقط برای اسکن QR پنل\n'
          '• معافیت از بهینه‌سازی باتری — تا اندروید اپ را در پس‌زمینه نبندد',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('بعداً')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('اجازه می‌دهم')),
        ],
      ),
    );
    if (ok != true) return;
    if (!_st.smsPermission) await Native.requestSmsPermission();
    await _refresh();
    if (!_st.smsPermission && mounted) await _showRestrictedHelp();
    if (!_st.batteryExempt) await Native.requestBatteryExemption();
    await _refresh();
  }

  /// اندروید ۱۳+ برای APKِ نصب‌شده بیرون از فروشگاه، مجوزِ پیامک را «Restricted setting» می‌کند؛
  /// تا کاربر دستی «Allow restricted settings» را نزند، دیالوگِ مجوز کار نمی‌کند.
  Future<void> _showRestrictedHelp() async {
    final open = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('مجوز پیامک مسدود است'),
        content: const Text(
          'اندروید برای برنامه‌هایی که از بیرونِ فروشگاه نصب شده‌اند، دسترسی پیامک را قفل می‌کند. یک‌بار این‌ها را انجام دهید:\n\n'
          '۱) «باز کردن تنظیمات برنامه» را بزنید.\n'
          '۲) بالا سمت راست روی ⋮ (سه‌نقطه) بزنید ← «Allow restricted settings» (اجازه تنظیمات محدودشده).\n'
          '۳) به همین صفحه ← «Permissions» ← «SMS» ← «Allow».\n'
          '۴) برگردید به برنامه.\n\n'
          'شیائومی/ردمی: «Autostart» را هم روشن کنید و باتری را روی «No restrictions» بگذارید.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('بعداً')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('باز کردن تنظیمات برنامه')),
        ],
      ),
    );
    if (open == true) await Native.openAppSettings();
  }

  Future<void> _applyConfig(AgentConfig c) async {
    await Native.saveConfig(c);
    await _refresh();
    if (Native.isAndroid && !_st.smsPermission) {
      await Native.requestSmsPermission();
      await _refresh();
      if (!_st.smsPermission && mounted) await _showRestrictedHelp();
    }
    await _run(() => Native.testConnection(c));
  }

  Future<void> _run(Future<TestResult> Function() f) async {
    setState(() {
      _busy = true;
      _msg = null;
    });
    final r = await f();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _msg = r.message;
    });
    await _refresh();
  }

  Future<void> _scan() async {
    final c = await Navigator.of(context)
        .push<AgentConfig>(MaterialPageRoute(builder: (_) => const ScanPage()));
    if (c != null) await _applyConfig(c);
  }

  Future<void> _manual() async {
    final c = await Navigator.of(context).push<AgentConfig>(
        MaterialPageRoute(builder: (_) => ManualPage(initial: _cfg)));
    if (c != null) await _applyConfig(c);
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final c = AgentConfig.parseLink(data?.text ?? '');
    if (c == null) {
      setState(() => _msg =
          'لینک معتبر در کلیپ‌بورد نیست. لینک راه‌اندازی را از پنل کپی کنید.');
      return;
    }
    await _applyConfig(c);
  }

  @override
  Widget build(BuildContext context) {
    final cfg = _cfg;
    return Scaffold(
      appBar: AppBar(title: const Text('IrForge Pay Agent'), actions: [
        if (Native.isAndroid)
          IconButton(
            tooltip: 'محدود کردن فرستنده‌ها',
            icon: const Icon(Icons.filter_alt_outlined),
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const SendersPage()))
                .then((_) => _refresh()),
          ),
        if (Native.isAndroid)
          IconButton(
            tooltip: 'پیامک‌های دریافتی',
            icon: const Icon(Icons.sms_outlined),
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const EventsPage())),
          ),
        if (Native.isAndroid)
          IconButton(
            tooltip: 'صف پیامک‌ها',
            icon: const Icon(Icons.list_alt),
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const QueuePage()))
                .then((_) => _refresh()),
          ),
        IconButton(
          tooltip: 'تنظیمات',
          icon: const Icon(Icons.settings),
          onPressed: () => Navigator.of(context)
              .push(MaterialPageRoute(builder: (_) => const SettingsPage())),
        ),
      ]),
      body: SafeArea(
          child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                    maxWidth: 560), // گوشی/تبلت/وب: عرضِ محتوا ثابتِ خوانا
                child: ListView(padding: const EdgeInsets.all(16), children: [
                  if (_st.update != null) _updateCard(_st.update!),
                  _statusCard(cfg),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                      onPressed: _busy ? null : _scan,
                      icon: const Icon(Icons.qr_code_scanner),
                      label: const Text('اتصال با اسکن QR')),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                      onPressed: _busy ? null : _paste,
                      icon: const Icon(Icons.content_paste),
                      label: const Text('اتصال با لینک (از کلیپ‌بورد)')),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                      onPressed: _busy ? null : _manual,
                      icon: const Icon(Icons.edit),
                      label: const Text('ورود / ویرایش دستی')),
                  if (cfg != null) ...[
                    const Divider(height: 32),
                    FilledButton.tonalIcon(
                      onPressed: _busy
                          ? null
                          : () => _run(() => Native.testConnection(cfg)),
                      icon: const Icon(Icons.wifi_tethering),
                      label: const Text('تست اتصال'),
                    ),
                    if (Native.isAndroid) ...[
                      const SizedBox(height: 8),
                      FilledButton.tonalIcon(
                        onPressed: () => Navigator.of(context)
                            .push(MaterialPageRoute(
                                builder: (_) => const SendersPage()))
                            .then((_) => _refresh()),
                        icon: const Icon(Icons.filter_alt_outlined),
                        label: const Text('محدود کردن فرستنده‌ها'),
                      ),
                      const SizedBox(height: 8),
                      FilledButton.tonalIcon(
                        onPressed: _busy
                            ? null
                            : () async {
                                await Native.flushNow();
                                await _refresh();
                                setState(() => _msg = 'ارسال صف شروع شد');
                              },
                        icon: const Icon(Icons.send),
                        label: const Text('ارسال مجدد صف'),
                      ),
                    ],
                  ],
                  if (_msg != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(_msg!, textAlign: TextAlign.center)),
                  if (Native.isAndroid) ..._androidChecklist(),
                  if (!Native.isAndroid) ...[
                    const Divider(height: 32),
                    FilledButton.icon(
                      onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(
                              builder: (_) => IosGuidePage(config: cfg))),
                      icon: const Icon(Icons.phone_iphone),
                      label: const Text('راهنمای راه‌اندازی روی آیفون'),
                    ),
                  ],
                  const SizedBox(height: 24),
                  if (Native.isAndroid && _st.versionName.isNotEmpty)
                    Center(
                      child: TextButton(
                        onPressed: _manualCheckUpdate,
                        child: Text(
                            'نسخه ${_st.versionName} (${_st.versionCode}) · بررسی نسخه جدید'),
                      ),
                    ),
                  if (cfg != null)
                    TextButton(
                      onPressed: () async {
                        await Native.clearConfig();
                        await _refresh();
                      },
                      child: const Text('حذف تنظیمات این گوشی'),
                    ),
                ]),
              ))),
    );
  }

  Future<void> _manualCheckUpdate() async {
    setState(() => _msg = 'در حال بررسی…');
    final u = await Native.checkUpdate();
    await _refresh();
    if (mounted)
      setState(() => _msg =
          u == null ? 'شما آخرین نسخه را دارید ✅' : 'نسخه ${u.name} موجود است');
  }

  Future<void> _doUpdate() async {
    setState(() {
      _dlPct = 0;
      _msg = null;
    });
    final ok = await Native.downloadUpdate();
    if (!mounted) return;
    setState(() => _dlPct = null);
    if (!ok) {
      setState(() => _msg =
          'دانلود یا تأیید فایل ناموفق بود. اینترنت/VPN را بررسی کنید و دوباره تلاش کنید.');
      return;
    }
    final r = await Native.installUpdate();
    if (mounted && r == 'need_permission') {
      setState(() => _msg =
          'در صفحه‌ی باز‌شده «اجازه نصب از این منبع» را روشن کنید، برگردید و دوباره «دانلود و نصب» را بزنید.');
    }
  }

  Widget _updateCard(UpdateInfo u) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.primaryContainer,
      margin: const EdgeInsets.only(bottom: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Icon(Icons.system_update),
            const SizedBox(width: 8),
            Expanded(
                child: Text('نسخه جدید ${u.name} آماده است',
                    style: Theme.of(context).textTheme.titleMedium)),
          ]),
          if (u.notes.isNotEmpty)
            Padding(
                padding: const EdgeInsets.only(top: 6), child: Text(u.notes)),
          const SizedBox(height: 12),
          if (_dlPct != null)
            Column(children: [
              LinearProgressIndicator(
                  value: _dlPct == 0 ? null : _dlPct! / 100),
              const SizedBox(height: 4),
              Text('در حال دانلود… $_dlPct٪')
            ])
          else
            FilledButton.icon(
                onPressed: _doUpdate,
                icon: const Icon(Icons.download),
                label: const Text('دانلود و نصب')),
        ]),
      ),
    );
  }

  Widget _statusCard(AgentConfig? cfg) {
    final (Color color, String title, String sub) = _summary(cfg);
    return Card(
      color: color.withValues(alpha: 0.12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.circle, color: color, size: 14),
            const SizedBox(width: 8),
            Expanded(
                child: Text(title,
                    style: Theme.of(context).textTheme.titleMedium)),
          ]),
          const SizedBox(height: 6),
          Text(sub),
          if (Native.isAndroid && cfg != null) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 16, children: [
              Text('ارسال‌شده: ${_st.sent}'),
              Text('در صف: ${_st.pending}'),
              if (_st.blocked > 0) Text('متوقف (کلید): ${_st.blocked}'),
              if (_st.dead > 0) Text('ردشده: ${_st.dead}'),
            ]),
            if (_st.lastSentAt != null)
              Text('آخرین ارسال: ${_fmt(_st.lastSentAt!)}'),
            if (_st.lastError != null && _st.pending > 0)
              Text('آخرین خطا: ${_st.lastError}',
                  style: const TextStyle(color: Colors.redAccent)),
          ],
        ]),
      ),
    );
  }

  (Color, String, String) _summary(AgentConfig? cfg) {
    if (cfg == null)
      return (
        Colors.grey,
        'متصل نیست',
        'با دکمه‌های زیر یک‌بار تنظیمات کانال را وارد کنید.'
      );
    if (!Native.isAndroid)
      return (
        Colors.orange,
        'تنظیمات آماده است',
        'آیفون پیامک را نمی‌تواند خودکار بخواند؛ «راهنمای آیفون» را ببینید.'
      );
    if (!_st.smsPermission)
      return (
        Colors.red,
        'مجوز پیامک داده نشده',
        'بدون مجوز، پیامک بانک به سایت نمی‌رسد.'
      );
    if (cfg.senders.isEmpty) {
      return (
        Colors.orange,
        'فرستنده‌ی مجاز تنظیم نشده',
        'فعلاً فقط پیامک‌های شبیه بانکی ارسال می‌شود. در «پیامک‌های دریافتی» فرستنده‌ی بانک را به لیست مجاز اضافه کنید.'
      );
    }
    if (_st.blocked > 0)
      return (
        Colors.red,
        'کلید/کانال نامعتبر',
        'پیامک‌ها منتظرند. تنظیمات را اصلاح کنید؛ خودکار ارسال می‌شوند.'
      );
    if (_st.pending > 0)
      return (
        Colors.orange,
        'در حال تلاش برای ارسال',
        'اینترنت/VPN قطع یا ناپایدار است؛ برنامه خودش دوباره تلاش می‌کند و چیزی گم نمی‌شود.'
      );
    return (
      Colors.green,
      'فعال و آماده',
      'هر پیامک بانک به‌صورت خودکار به سایت می‌رسد.'
    );
  }

  List<Widget> _androidChecklist() => [
        const Divider(height: 32),
        Text('چک‌لیست پایداری', style: Theme.of(context).textTheme.titleSmall),
        ListTile(
          leading: Icon(_st.smsPermission ? Icons.check_circle : Icons.error,
              color: _st.smsPermission ? Colors.green : Colors.red),
          title: const Text('مجوز دریافت پیامک'),
          trailing: _st.smsPermission
              ? null
              : TextButton(
                  onPressed: () async {
                    await Native.requestSmsPermission();
                    await _refresh();
                    if (!_st.smsPermission && mounted) {
                      await _showRestrictedHelp();
                    }
                  },
                  child: const Text('اجازه')),
        ),
        ListTile(
          leading: Icon(
              _st.batteryExempt ? Icons.check_circle : Icons.error_outline,
              color: _st.batteryExempt ? Colors.green : Colors.orange),
          title: const Text('معافیت از بهینه‌سازی باتری'),
          subtitle: const Text(
              'برای شیائومی/سامسونگ/هوآوی در تنظیمات «Autostart» را هم روشن کنید.'),
          trailing: _st.batteryExempt
              ? null
              : const TextButton(
                  onPressed: Native.requestBatteryExemption,
                  child: Text('تنظیم')),
        ),
      ];

  String _fmt(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.hour)}:${two(d.minute)}:${two(d.second)}';
  }
}
