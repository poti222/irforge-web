import 'package:flutter_test/flutter_test.dart';
import 'package:irforge_pay/setup_link.dart';

void main() {
  test('parses a panel setup link', () {
    final c = AgentConfig.parseLink(
        'irforge-pay://setup?u=https%3A%2F%2Firforge.ir%2Fapi%2Fpayments%2Fsms%2Fch1&u=https%3A%2F%2Fbackup.example%2Fapi%2Fpayments%2Fsms%2Fch1&s=irfsms_abc&b=Blubank,Melli');
    expect(c, isNotNull);
    expect(c!.urls.length, 2);
    expect(c.secret, 'irfsms_abc');
    expect(c.senders, ['Blubank', 'Melli']);
  });

  test('rejects foreign and incomplete links', () {
    expect(AgentConfig.parseLink('https://example.com'), isNull);
    expect(AgentConfig.parseLink('irforge-pay://setup?s=x'), isNull);
    expect(AgentConfig.parseLink('irforge-pay://setup?u=ftp%3A%2F%2Fx&s=x'), isNull);
  });
}
