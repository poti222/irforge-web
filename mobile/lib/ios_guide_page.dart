import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'setup_link.dart';

/// آیفون هیچ راهی برای خواندنِ پیامکِ دریافتی توسطِ اپ ندارد (محدودیتِ خودِ iOS)، ولی خودِ سیستم‌عامل
/// «Shortcuts ← Automation ← Message» دارد که با پیامِ فرستنده‌ی مشخص اجرا می‌شود و می‌تواند POST بزند.
/// این صفحه مقادیرِ آماده‌ی کپی را می‌دهد.
class IosGuidePage extends StatelessWidget {
  const IosGuidePage({super.key, this.config});
  final AgentConfig? config;

  @override
  Widget build(BuildContext context) {
    final c = config;
    return Scaffold(
      appBar: AppBar(title: const Text('راهنمای آیفون')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const Text(
          'در آیفون، برنامه‌ها اجازه‌ی خواندن پیامک را ندارند. راهِ رسمی، «میان‌بر خودکار» خودِ آیفون است. '
          'یک‌بار این مراحل را انجام دهید:',
        ),
        const SizedBox(height: 12),
        const _Step('۱', 'برنامه Shortcuts ← تب Automation ← ‎+‎ ← «Message».'),
        const _Step('۲',
            'در «Sender» نام/شماره بانک را انتخاب کنید. گزینه «Run Immediately» را روشن و «Notify When Run» را خاموش کنید.'),
        const _Step('۳',
            'اکشن «Get Contents of URL» را اضافه کنید: Method = POST، Request Body = File، و ورودی = «Message ← Content».'),
        const _Step(
            '۴', 'در Headers مقادیر زیر را اضافه کنید (دکمه‌های کپی پایین).'),
        const SizedBox(height: 8),
        if (c == null)
          const Text(
              'ابتدا در صفحه اصلی تنظیمات را وارد کنید تا مقادیر اینجا ظاهر شوند.',
              style: TextStyle(color: Colors.orange))
        else ...[
          _Copy(label: 'URL', value: c.urls.first),
          const _Copy(label: 'Content-Type', value: 'text/plain'),
          _Copy(label: 'X-Sms-Secret', value: c.secret),
          if (c.senders.isNotEmpty)
            _Copy(label: 'X-Sms-Sender', value: c.senders.first),
        ],
        const Divider(height: 32),
        const Text(
          'نکته مهم: آیفون در صورت قطع بودن اینترنت/VPN در لحظه دریافت پیامک، دوباره تلاش نمی‌کند. '
          'برای پایداری واقعی، سیستمِ دریافتِ پیامک را روی یک گوشی اندروید همیشه‌روشن اجرا کنید '
          'و آیفون را برای مدیریت و تست استفاده کنید. سایت هم اگر پیامکی نرسد، پرداخت را با فیش و تأیید ادمین نگه می‌دارد.',
        ),
      ]),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step(this.n, this.t);
  final String n, t;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          CircleAvatar(
              radius: 12, child: Text(n, style: const TextStyle(fontSize: 12))),
          const SizedBox(width: 8),
          Expanded(child: Text(t)),
        ]),
      );
}

class _Copy extends StatelessWidget {
  const _Copy({required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => Card(
        child: ListTile(
          title: Text(label),
          subtitle: Text(value, textDirection: TextDirection.ltr),
          trailing: IconButton(
            icon: const Icon(Icons.copy),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: value));
              if (context.mounted)
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text('$label کپی شد')));
            },
          ),
        ),
      );
}
