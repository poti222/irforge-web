import 'package:flutter/material.dart';

import 'native.dart';

/// مدیریتِ صفِ پیامک‌ها: ببین چه چیزی منتظر/متوقف/ارسال‌شده است، دوباره بفرست یا حذف کن.
class QueuePage extends StatefulWidget {
  const QueuePage({super.key});

  @override
  State<QueuePage> createState() => _QueuePageState();
}

class _QueuePageState extends State<QueuePage> {
  List<QueueItem>? _items;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final l = await Native.queue();
    if (mounted) setState(() => _items = l);
  }

  static const _labels = {
    'pending': 'در صف ارسال',
    'sent': 'ارسال شد',
    'blocked': 'متوقف (کلید/کانال)',
    'dead': 'ردشده توسط سرور'
  };
  static const _colors = {
    'pending': Colors.orange,
    'sent': Colors.green,
    'blocked': Colors.red,
    'dead': Colors.grey
  };

  String _fmt(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final stuck =
        items?.any((e) => e.status == 'blocked' || e.status == 'dead') ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('صف پیامک‌ها'), actions: [
        if (stuck)
          TextButton(
              onPressed: () async {
                await Native.queueRetryAll();
                await _load();
              },
              child: const Text('ارسال مجدد همه')),
      ]),
      body: items == null
          ? const Center(child: CircularProgressIndicator())
          : items.isEmpty
              ? const Center(child: Text('هنوز پیامکی دریافت نشده'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final e = items[i];
                      return ListTile(
                        leading: Icon(Icons.circle,
                            size: 12, color: _colors[e.status]),
                        title: Text(
                            '${e.sender} · ${_labels[e.status] ?? e.status}'),
                        subtitle: Text(
                            '${_fmt(e.ts)}${e.attempts > 0 ? ' · ${e.attempts} تلاش' : ''}${e.body.isNotEmpty ? '\n${e.body}' : ''}',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis),
                        isThreeLine: e.body.isNotEmpty,
                        trailing: PopupMenuButton<String>(
                          onSelected: (v) async {
                            if (v == 'retry') await Native.queueRetry(e.id);
                            if (v == 'delete') await Native.queueDelete(e.id);
                            await _load();
                          },
                          itemBuilder: (_) => [
                            if (e.status == 'blocked' || e.status == 'dead')
                              const PopupMenuItem(
                                  value: 'retry', child: Text('ارسال مجدد')),
                            const PopupMenuItem(
                                value: 'delete', child: Text('حذف')),
                          ],
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
