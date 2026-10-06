import 'dart:io' show Platform;

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
  });

  final bool smsPermission;
  final bool batteryExempt;
  final int pending;
  final int sent;
  final int blocked;
  final int dead;
  final DateTime? lastSentAt;
  final String? lastError;

  static AgentStatus fromMap(Map<dynamic, dynamic> m) => AgentStatus(
        smsPermission: m['smsPermission'] == true,
        batteryExempt: m['batteryExempt'] == true,
        pending: (m['pending'] as num?)?.toInt() ?? 0,
        sent: (m['sent'] as num?)?.toInt() ?? 0,
        blocked: (m['blocked'] as num?)?.toInt() ?? 0,
        dead: (m['dead'] as num?)?.toInt() ?? 0,
        lastSentAt: (m['lastSentAt'] as num?) == null || (m['lastSentAt'] as num) <= 0
            ? null
            : DateTime.fromMillisecondsSinceEpoch((m['lastSentAt'] as num).toInt()),
        lastError: m['lastError'] as String?,
      );
}

class TestResult {
  const TestResult(this.ok, this.message);
  final bool ok;
  final String message;
}

/// پلی بینِ Flutter و کدِ native اندروید. روی iOS (که دریافتِ پیامک ندارد) فقط تست و ذخیره‌ی تنظیمات کار می‌کند.
class Native {
  static const _ch = MethodChannel('ir.irforge.payagent/native');
  static bool get isAndroid => Platform.isAndroid;

  static Future<AgentConfig?> loadConfig() async {
    if (!isAndroid) return null;
    return AgentConfig.fromMap(await _ch.invokeMethod<Map>('getConfig'));
  }

  static Future<void> saveConfig(AgentConfig c) async {
    if (isAndroid) await _ch.invokeMethod('saveConfig', c.toMap());
  }

  static Future<void> clearConfig() async {
    if (isAndroid) await _ch.invokeMethod('clearConfig');
  }

  static Future<AgentStatus> status() async {
    if (!isAndroid) return const AgentStatus();
    return AgentStatus.fromMap(await _ch.invokeMethod<Map>('status') ?? const {});
  }

  static Future<bool> requestSmsPermission() async =>
      isAndroid && (await _ch.invokeMethod<bool>('requestSmsPermission') ?? false);

  static Future<void> requestBatteryExemption() async {
    if (isAndroid) await _ch.invokeMethod('requestBatteryExemption');
  }

  static Future<void> flushNow() async {
    if (isAndroid) await _ch.invokeMethod('flushNow');
  }

  /// تستِ اتصال. اندروید: از همان مسیرِ چندشبکه‌ایِ ارسالِ واقعی؛ iOS: یک POST ساده.
  static Future<TestResult> testConnection(AgentConfig c) async {
    if (isAndroid) {
      final m = await _ch.invokeMethod<Map>('test', c.toMap()) ?? const {};
      return TestResult(m['ok'] == true, (m['message'] as String?) ?? '');
    }
    String last = 'ارتباط برقرار نشد';
    for (final u in c.urls) {
      try {
        final r = await http
            .post(Uri.parse(u), headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Sms-Secret': c.secret,
              'X-Sms-Sender': 'IrForgeTest',
            }, body: 'IrForge Pay Agent connectivity test')
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
    if (code == 200 || code == 201) return const TestResult(true, 'اتصال و کلید درست است ✅');
    if (code == 401) return const TestResult(false, 'کلید امنیتی یا آدرس کانال اشتباه است (۴۰۱)');
    if (code == 403) return const TestResult(false, 'کانال در سایت غیرفعال است (۴۰۳)');
    if (code == 429) return const TestResult(false, 'تعداد درخواست زیاد است؛ کمی بعد دوباره تست کنید (۴۲۹)');
    return TestResult(false, 'پاسخ غیرمنتظره از سرور ($code)');
  }
}
