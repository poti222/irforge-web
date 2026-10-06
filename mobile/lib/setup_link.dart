/// پارسِ لینکِ راه‌اندازی که پنلِ سایت در QR می‌گذارد:
/// `irforge-pay://setup?u=<webhook>&u=<backup>&s=<secret>&b=<sender1,sender2>`
class AgentConfig {
  const AgentConfig(
      {required this.urls, required this.secret, this.senders = const []});

  final List<String> urls;
  final String secret;
  final List<String> senders;

  bool get isComplete => urls.isNotEmpty && secret.isNotEmpty;

  Map<String, dynamic> toMap() =>
      {'urls': urls, 'secret': secret, 'senders': senders};

  static AgentConfig? fromMap(Map<dynamic, dynamic>? m) {
    if (m == null) return null;
    final c = AgentConfig(
      urls: List<String>.from(m['urls'] as List? ?? const []),
      secret: (m['secret'] as String?) ?? '',
      senders: List<String>.from(m['senders'] as List? ?? const []),
    );
    return c.isComplete ? c : null;
  }

  /// null = لینکِ نامعتبر.
  static AgentConfig? parseLink(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'irforge-pay' || uri.host != 'setup')
      return null;
    final urls = (uri.queryParametersAll['u'] ?? const [])
        .where(isValidWebhookUrl)
        .toList();
    final secret = uri.queryParameters['s']?.trim() ?? '';
    final senders = (uri.queryParameters['b'] ?? '')
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .toList();
    final c = AgentConfig(urls: urls, secret: secret, senders: senders);
    return c.isComplete ? c : null;
  }
}

bool isValidWebhookUrl(String u) {
  final uri = Uri.tryParse(u.trim());
  return uri != null &&
      (uri.scheme == 'https' || uri.scheme == 'http') &&
      uri.host.isNotEmpty;
}
