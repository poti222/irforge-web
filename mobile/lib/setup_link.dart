/// پارسِ لینکِ راه‌اندازی که پنلِ سایت در QR می‌گذارد:
/// `irforge-pay://setup?u=<webhook>&u=<backup>&s=<secret>&b=<sender1,sender2>`
/// پارامترهای اختیاریِ جدید: `n` = نامِ اتصال، `k` = `payment` یا `forward`، `kw` = کلمه‌های فیلتر (با ویرگول).
///
/// هر `AgentConfig` یک «اتصال» است: آدرس + کلیدِ جدا + فیلترِ جدا. اپ می‌تواند چند اتصال داشته باشد
/// (مثلاً یکی برای تأییدِ پرداختِ بانک و یکی برای «ارسال پیامک به تلگرام»).
class AgentConfig {
  const AgentConfig({
    required this.urls,
    required this.secret,
    this.senders = const [],
    this.id = '',
    this.name = '',
    this.kind = kindPayment,
    this.keywords = const [],
    this.enabled = true,
    this.pending = 0,
    this.sent = 0,
    this.blocked = 0,
    this.dead = 0,
    this.lastSentAt,
    this.lastError,
  });

  static const kindPayment = 'payment';
  static const kindForward = 'forward';

  final List<String> urls;
  final String secret;
  final List<String> senders;

  /// خالی = اتصالِ تازه (native شناسه می‌سازد).
  final String id;
  final String name;
  final String kind;
  final List<String> keywords;
  final bool enabled;

  // فقط‌خواندنی (از native می‌آید؛ در toMap نمی‌رود).
  final int pending, sent, blocked, dead;
  final DateTime? lastSentAt;
  final String? lastError;

  bool get isComplete => urls.isNotEmpty && secret.isNotEmpty;
  bool get isForward => kind == kindForward;

  String get label =>
      name.trim().isNotEmpty ? name.trim() : (isForward ? 'ارسال به تلگرام' : 'پرداخت');

  AgentConfig copyWith({
    List<String>? urls,
    String? secret,
    List<String>? senders,
    String? id,
    String? name,
    String? kind,
    List<String>? keywords,
    bool? enabled,
  }) =>
      AgentConfig(
        urls: urls ?? this.urls,
        secret: secret ?? this.secret,
        senders: senders ?? this.senders,
        id: id ?? this.id,
        name: name ?? this.name,
        kind: kind ?? this.kind,
        keywords: keywords ?? this.keywords,
        enabled: enabled ?? this.enabled,
        pending: pending,
        sent: sent,
        blocked: blocked,
        dead: dead,
        lastSentAt: lastSentAt,
        lastError: lastError,
      );

  Map<String, dynamic> toMap() => {
        'id': id,
        'name': name,
        'kind': kind,
        'urls': urls,
        'secret': secret,
        'senders': senders,
        'keywords': keywords,
        'enabled': enabled,
      };

  static AgentConfig? fromMap(Map<dynamic, dynamic>? m) {
    if (m == null) return null;
    final last = (m['lastSentAt'] as num?)?.toInt() ?? 0;
    final c = AgentConfig(
      urls: List<String>.from(m['urls'] as List? ?? const []),
      secret: (m['secret'] as String?) ?? '',
      senders: List<String>.from(m['senders'] as List? ?? const []),
      id: (m['id'] as String?) ?? '',
      name: (m['name'] as String?) ?? '',
      kind: m['kind'] == kindForward ? kindForward : kindPayment,
      keywords: List<String>.from(m['keywords'] as List? ?? const []),
      enabled: m['enabled'] as bool? ?? true,
      pending: (m['pending'] as num?)?.toInt() ?? 0,
      sent: (m['sent'] as num?)?.toInt() ?? 0,
      blocked: (m['blocked'] as num?)?.toInt() ?? 0,
      dead: (m['dead'] as num?)?.toInt() ?? 0,
      lastSentAt: last > 0 ? DateTime.fromMillisecondsSinceEpoch(last) : null,
      lastError: m['lastError'] as String?,
    );
    return c.isComplete ? c : null;
  }

  /// null = لینکِ نامعتبر.
  static AgentConfig? parseLink(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'irforge-pay' || uri.host != 'setup') {
      return null;
    }
    final urls = (uri.queryParametersAll['u'] ?? const [])
        .where(isValidWebhookUrl)
        .toList();
    final secret = uri.queryParameters['s']?.trim() ?? '';
    final c = AgentConfig(
      urls: urls,
      secret: secret,
      senders: splitList(uri.queryParameters['b']),
      name: uri.queryParameters['n']?.trim() ?? '',
      kind: uri.queryParameters['k'] == kindForward ? kindForward : kindPayment,
      keywords: splitList(uri.queryParameters['kw']),
    );
    return c.isComplete ? c : null;
  }
}

/// «a, b،c\nd» → [a, b, c, d]
List<String> splitList(String? raw) => (raw ?? '')
    .split(RegExp(r'[,،\n]'))
    .map((e) => e.trim())
    .where((e) => e.isNotEmpty)
    .toList();

bool isValidWebhookUrl(String u) {
  final uri = Uri.tryParse(u.trim());
  return uri != null &&
      (uri.scheme == 'https' || uri.scheme == 'http') &&
      uri.host.isNotEmpty;
}
