import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import 'setup_link.dart';

class AgentStatus {
  const AgentStatus({
    this.smsPermission = false,
    this.batteryExempt = false,
    this.pending = 0,
    this.sent = 0,
    this.blocked = 0,
    this.dead = 0,
    this.lastSentAt,
    this.lastError,
    this.versionCode = 0,
    this.versionName = '',
    this.update,
  });

  final bool smsPermission;
  final bool batteryExempt;
  final int pending;
  final int sent;
  final int blocked;
  final int dead;
  final DateTime? lastSentAt;
  final String? lastError;
  final int versionCode;
  final String versionName;
  final UpdateInfo? update;

  static AgentStatus fromMap(Map<dynamic, dynamic> m) => AgentStatus(
        smsPermission: m['smsPermission'] == true,
        batteryExempt: m['batteryExempt'] == true,
        pending: (m['pending'] as num?)?.toInt() ?? 0,
        sent: (m['sent'] as num?)?.toInt() ?? 0,
        blocked: (m['blocked'] as num?)?.toInt() ?? 0,
        dead: (m['dead'] as num?)?.toInt() ?? 0,
        lastSentAt:
            (m['lastSentAt'] as num?) == null || (m['lastSentAt'] as num) <= 0
                ? null
                : DateTime.fromMillisecondsSinceEpoch(
                    (m['lastSentAt'] as num).toInt()),
        lastError: m['lastError'] as String?,
        versionCode: (m['versionCode'] as num?)?.toInt() ?? 0,
        versionName: (m['versionName'] as String?) ?? '',
        update: UpdateInfo.fromMap(m['update'] as Map?),
      );
}

class UpdateInfo {
  const UpdateInfo(this.code, this.name, this.notes, this.mandatory);
  final int code;
  final String name;
  final String notes;
  final bool mandatory;
  static UpdateInfo? fromMap(Map? m) => m == null
      ? null
      : UpdateInfo(
          (m['versionCode'] as num).toInt(),
          m['versionName'] as String,
          (m['notes'] as String?) ?? '',
          m['mandatory'] == true);
}

/// همه‌ی مقادیرِ قابل‌تنظیمِ خودکارسازی/پایداری (معادلِ `Settings` در Kotlin).
class AgentSettings {
  const AgentSettings({
    this.backoffSeconds = 10,
    this.timeoutSeconds = 15,
    this.tryAllNetworks = true,
    this.keepDays = 7,
    this.notifyOnSend = false,
    this.notifyOnFailure = true,
    this.autoUpdateCheck = true,
    this.updateCheckHours = 6,
    this.updateUrl = '',
  });

  final int backoffSeconds, timeoutSeconds, keepDays, updateCheckHours;
  final bool tryAllNetworks, notifyOnSend, notifyOnFailure, autoUpdateCheck;
  final String updateUrl;

  AgentSettings copyWith({
    int? backoffSeconds,
    int? timeoutSeconds,
    int? keepDays,
    int? updateCheckHours,
    bool? tryAllNetworks,
    bool? notifyOnSend,
    bool? notifyOnFailure,
    bool? autoUpdateCheck,
    String? updateUrl,
  }) =>
      AgentSettings(
        backoffSeconds: backoffSeconds ?? this.backoffSeconds,
        timeoutSeconds: timeoutSeconds ?? this.timeoutSeconds,
        keepDays: keepDays ?? this.keepDays,
        updateCheckHours: updateCheckHours ?? this.updateCheckHours,
        tryAllNetworks: tryAllNetworks ?? this.tryAllNetworks,
        notifyOnSend: notifyOnSend ?? this.notifyOnSend,
        notifyOnFailure: notifyOnFailure ?? this.notifyOnFailure,
        autoUpdateCheck: autoUpdateCheck ?? this.autoUpdateCheck,
        updateUrl: updateUrl ?? this.updateUrl,
      );

  Map<String, dynamic> toMap() => {
        'backoffSeconds': backoffSeconds,
        'timeoutSeconds': timeoutSeconds,
        'tryAllNetworks': tryAllNetworks,
        'keepDays': keepDays,
        'notifyOnSend': notifyOnSend,
        'notifyOnFailure': notifyOnFailure,
        'autoUpdateCheck': autoUpdateCheck,
        'updateCheckHours': updateCheckHours,
        'updateUrl': updateUrl,
      };

  static AgentSettings fromMap(Map? m) {
    if (m == null) return const AgentSettings();
    const d = AgentSettings();
    return AgentSettings(
      backoffSeconds:
          (m['backoffSeconds'] as num?)?.toInt() ?? d.backoffSeconds,
      timeoutSeconds:
          (m['timeoutSeconds'] as num?)?.toInt() ?? d.timeoutSeconds,
      tryAllNetworks: m['tryAllNetworks'] as bool? ?? d.tryAllNetworks,
      keepDays: (m['keepDays'] as num?)?.toInt() ?? d.keepDays,
      notifyOnSend: m['notifyOnSend'] as bool? ?? d.notifyOnSend,
      notifyOnFailure: m['notifyOnFailure'] as bool? ?? d.notifyOnFailure,
      autoUpdateCheck: m['autoUpdateCheck'] as bool? ?? d.autoUpdateCheck,
      updateCheckHours:
          (m['updateCheckHours'] as num?)?.toInt() ?? d.updateCheckHours,
      updateUrl: m['updateUrl'] as String? ?? d.updateUrl,
    );
  }
}

/// یک ردیف از صفِ پیامک‌ها. status: pending | sent | blocked | dead
class QueueItem {
  const QueueItem(
      this.id, this.sender, this.body, this.ts, this.attempts, this.status);
  final String id, sender, body, status;
  final DateTime ts;
  final int attempts;
  static QueueItem fromMap(Map m) => QueueItem(
      m['id'] as String,
      (m['sender'] as String?) ?? '',
      (m['body'] as String?) ?? '',
      DateTime.fromMillisecondsSinceEpoch((m['ts'] as num).toInt()),
      (m['attempts'] as num?)?.toInt() ?? 0,
      m['status'] as String);
}

class TestResult {
  const TestResult(this.ok, this.message);
  final bool ok;
  final String message;
}

/// پلی بینِ Flutter و کدِ native اندروید. روی iOS (که دریافتِ پیامک ندارد) فقط تست و ذخیره‌ی تنظیمات کار می‌کند.
class Native {
  static const _ch = MethodChannel('ir.irforge.payagent/native');

  /// برای پیش‌نمایشِ رابطِ اندروید روی وب/دسکتاپ: --dart-define=PREVIEW=android
  static const _preview = String.fromEnvironment('PREVIEW');
  static bool get isPreview => _preview == 'android';
  static bool get isAndroid =>
      isPreview || (!kIsWeb && defaultTargetPlatform == TargetPlatform.android);
  static bool get _real => !isPreview;
  static AgentConfig? _fakeCfg;

  static Future<AgentConfig?> loadConfig() async {
    if (!isAndroid) return null;
    if (!_real) return _fakeCfg;
    return AgentConfig.fromMap(await _ch.invokeMethod<Map>('getConfig'));
  }

  static Future<void> saveConfig(AgentConfig c) async {
    if (!_real) _fakeCfg = c;
    if (isAndroid && _real) await _ch.invokeMethod('saveConfig', c.toMap());
  }

  static Future<void> clearConfig() async {
    if (!_real) _fakeCfg = null;
    if (isAndroid && _real) await _ch.invokeMethod('clearConfig');
  }

  static Future<AgentStatus> status() async {
    if (!isAndroid) return const AgentStatus();
    if (!_real)
      return const AgentStatus(
          smsPermission: true,
          pending: 2,
          sent: 14,
          lastError: 'خطای شبکه: UnknownHostException',
          versionCode: 1,
          versionName: '1.0.0',
          update: UpdateInfo(2, '1.1.0', 'رفعِ باگ‌ها و افزودنِ تنظیمات', false));
    return AgentStatus.fromMap(
        await _ch.invokeMethod<Map>('status') ?? const {});
  }

  static Future<bool> requestSmsPermission() async =>
      isAndroid &&
      _real &&
      (await _ch.invokeMethod<bool>('requestSmsPermission') ?? false);

  static Future<void> requestBatteryExemption() async {
    if (isAndroid && _real) await _ch.invokeMethod('requestBatteryExemption');
  }

  static Future<void> flushNow() async {
    if (isAndroid && _real) await _ch.invokeMethod('flushNow');
  }

  // ── تنظیمات ─────────────────────────────────────────────────────────────────────
  static AgentSettings _fakeSettings = const AgentSettings();

  static Future<AgentSettings> getSettings() async {
    if (!isAndroid) return _fakeSettings;
    if (!_real) return _fakeSettings;
    return AgentSettings.fromMap(await _ch.invokeMethod<Map>('getSettings'));
  }

  static Future<void> saveSettings(AgentSettings s) async {
    _fakeSettings = s;
    if (isAndroid && _real) await _ch.invokeMethod('saveSettings', s.toMap());
  }

  // ── مدیریتِ صف ──────────────────────────────────────────────────────────────────
  static Future<List<QueueItem>> queue() async {
    if (!isAndroid) return const [];
    if (!_real) {
      final now = DateTime.now();
      return [
        QueueItem('a', 'Blubank', 'واریز ۱٬۰۰۰٬۰۰۰ ریال',
            now.subtract(const Duration(minutes: 2)), 3, 'pending'),
        QueueItem('b', 'Blubank', 'واریز ۱٬۲۳۰٬۰۰۰ ریال',
            now.subtract(const Duration(minutes: 40)), 0, 'blocked'),
        QueueItem('c', 'Blubank', '', now.subtract(const Duration(hours: 3)), 1,
            'sent'),
      ];
    }
    final l = await _ch.invokeMethod<List>('queue') ?? const [];
    return l.map((e) => QueueItem.fromMap(e as Map)).toList();
  }

  static Future<void> queueRetry(String id) async {
    if (isAndroid && _real) await _ch.invokeMethod('queueRetry', id);
  }

  static Future<void> queueRetryAll() async {
    if (isAndroid && _real) await _ch.invokeMethod('queueRetryAll');
  }

  static Future<void> queueDelete(String id) async {
    if (isAndroid && _real) await _ch.invokeMethod('queueDelete', id);
  }

  // ── آپدیتِ داخلِ اپ ─────────────────────────────────────────────────────────────
  static void Function(int pct)? onUpdateProgress;

  /// ثبتِ شنونده‌ی درصدِ دانلود (native → Dart).
  static void listen() {
    if (isAndroid && _real) {
      _ch.setMethodCallHandler((call) async {
        if (call.method == 'updateProgress')
          onUpdateProgress?.call(call.arguments as int);
      });
    }
  }

  /// null = نسخه‌ی جدیدی نیست یا سرور در دسترس نیست.
  static Future<UpdateInfo?> checkUpdate() async {
    if (!isAndroid) return null;
    if (!_real)
      return const UpdateInfo(
          2, '1.1.0', 'رفعِ باگ‌ها و افزودنِ تنظیمات', false);
    return UpdateInfo.fromMap(await _ch.invokeMethod<Map>('checkUpdate'));
  }

  static Future<bool> downloadUpdate() async {
    if (!isAndroid) return false;
    if (!_real) {
      for (var i = 0; i <= 100; i += 20) {
        onUpdateProgress?.call(i);
        await Future<void>.delayed(const Duration(milliseconds: 200));
      }
      return true;
    }
    return await _ch.invokeMethod<bool>('downloadUpdate') ?? false;
  }

  /// "installing" | "need_permission" | "no_file"
  static Future<String> installUpdate() async {
    if (!isAndroid || !_real) return 'installing';
    return await _ch.invokeMethod<String>('installUpdate') ?? 'no_file';
  }

  /// تستِ اتصال. اندروید: از همان مسیرِ چندشبکه‌ایِ ارسالِ واقعی؛ iOS: یک POST ساده.
  static Future<TestResult> testConnection(AgentConfig c) async {
    if (isAndroid && _real) {
      final m = await _ch.invokeMethod<Map>('test', c.toMap()) ?? const {};
      return TestResult(m['ok'] == true, (m['message'] as String?) ?? '');
    }
    String last = 'ارتباط برقرار نشد';
    for (final u in c.urls) {
      try {
        final r = await http
            .post(Uri.parse(u),
                headers: {
                  'Content-Type': 'text/plain; charset=utf-8',
                  'X-Sms-Secret': c.secret,
                  'X-Sms-Sender': 'IrForgeTest',
                },
                body: 'IrForge Pay Agent connectivity test')
            .timeout(const Duration(seconds: 20));
        final res = describeStatus(r.statusCode);
        if (res.ok) return res;
        last = res.message;
        if (r.statusCode == 401 || r.statusCode == 403) return res;
      } catch (_) {
        last = 'سرور در دسترس نیست (VPN/اینترنت را بررسی کنید)';
      }
    }
    return TestResult(false, last);
  }

  static TestResult describeStatus(int code) {
    if (code == 200 || code == 201)
      return const TestResult(true, 'اتصال و کلید درست است ✅');
    if (code == 401)
      return const TestResult(
          false, 'کلید امنیتی یا آدرس کانال اشتباه است (۴۰۱)');
    if (code == 403)
      return const TestResult(false, 'کانال در سایت غیرفعال است (۴۰۳)');
    if (code == 429)
      return const TestResult(
          false, 'تعداد درخواست زیاد است؛ کمی بعد دوباره تست کنید (۴۲۹)');
    return TestResult(false, 'پاسخ غیرمنتظره از سرور ($code)');
  }
}
