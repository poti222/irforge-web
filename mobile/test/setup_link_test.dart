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

  test('payment link defaults: kind payment, no name, no keywords', () {
    final c = AgentConfig.parseLink(
        'irforge-pay://setup?u=https%3A%2F%2Firforge.ir%2Fapi%2Fpayments%2Fsms%2Fch1&s=irfsms_abc');
    expect(c!.kind, AgentConfig.kindPayment);
    expect(c.name, '');
    expect(c.keywords, isEmpty);
    expect(c.label, 'پرداخت');
  });

  test('forward link carries name, kind and keywords', () {
    final c = AgentConfig.parseLink(
        'irforge-pay://setup?u=https%3A%2F%2Firforge.ir%2Fapi%2Fsms-forward%2Fhook%2Fsmf_1&s=irfsmf_abc&n=%D8%AA%D9%84%DA%AF%D8%B1%D8%A7%D9%85&k=forward&kw=%D9%88%D8%A7%D8%B1%DB%8C%D8%B2,OTP');
    expect(c, isNotNull);
    expect(c!.isForward, isTrue);
    expect(c.name, 'تلگرام');
    expect(c.keywords, ['واریز', 'OTP']);
    expect(c.label, 'تلگرام');
  });

  test('unknown kind falls back to payment', () {
    final c = AgentConfig.parseLink(
        'irforge-pay://setup?u=https%3A%2F%2Fx.ir%2Fh&s=k&k=weird');
    expect(c!.kind, AgentConfig.kindPayment);
  });

  test('map round trip keeps profile fields and ignores stats on write', () {
    const c = AgentConfig(
      urls: ['https://x.ir/h'],
      secret: 'k',
      id: 'p1',
      name: 'n',
      kind: AgentConfig.kindForward,
      senders: ['Blubank'],
      keywords: ['واریز'],
      enabled: false,
    );
    final back = AgentConfig.fromMap(c.toMap())!;
    expect(back.id, 'p1');
    expect(back.kind, AgentConfig.kindForward);
    expect(back.enabled, isFalse);
    expect(back.keywords, ['واریز']);
    expect(c.toMap().containsKey('sent'), isFalse);
  });

  test('splitList handles latin and persian commas and newlines', () {
    expect(splitList('a, b،c\nd'), ['a', 'b', 'c', 'd']);
    expect(splitList(null), isEmpty);
  });
}
