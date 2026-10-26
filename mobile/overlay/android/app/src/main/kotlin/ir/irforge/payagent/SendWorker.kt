package ir.irforge.payagent

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** صفِ پیامک را خالی می‌کند. WorkManager بعد از ری‌استارتِ گوشی/قطعی هم کار را ادامه می‌دهد. */
class SendWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val ctx = applicationContext
        val profiles = Store.profiles(ctx).associateBy { it.id }
        var retry = false
        val offline = mutableSetOf<String>() // اتصال‌هایی که همه‌ی مسیرهایشان خراب بود؛ بقیه‌ی صفِ همان اتصال را الکی نسوزان.
        for (m in Store.pending(ctx)) {
            val cfg = profiles[m.profileId] ?: continue
            if (!cfg.enabled || !cfg.complete || cfg.id in offline) continue
            val r = Sender.send(ctx, cfg, m.sender, m.body, m.ts)
            when (r.outcome) {
                Outcome.OK -> {
                    Store.mark(ctx, m.id, "sent"); Store.setLastError(ctx, null, cfg.id)
                    if (Store.settings(ctx).notifyOnSend)
                        Notifier.notify(ctx, Notifier.ID_SENT, "پیامک به «${cfg.label}» رسید", "فرستنده: ${m.sender}")
                }
                Outcome.PERMANENT -> Store.mark(ctx, m.id, "dead")
                Outcome.AUTH -> {
                    Store.mark(ctx, m.id, "blocked")
                    Store.setLastError(ctx, r.detail, cfg.id)
                    if (Store.settings(ctx).notifyOnFailure) Notifier.alert(ctx, "کلید یا کانالِ «${cfg.label}» نامعتبر است", "پیامک‌های این اتصال ارسال نمی‌شوند. اپ را باز کنید و تنظیمات را اصلاح کنید.")
                }
                Outcome.TRANSIENT -> {
                    Store.bumpAttempts(ctx, m.id)
                    Store.setLastError(ctx, r.detail, cfg.id)
                    retry = true
                    offline += cfg.id
                }
            }
        }
        Store.prune(ctx)
        return if (retry) Result.retry() else Result.success()
    }

    companion object {
        private const val NOW = "send-now"
        private const val PERIODIC = "send-periodic"

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** فوری (به‌محضِ داشتنِ هر اینترنتی). backoff کوتاه چون مشتری منتظرِ تأییدِ پرداخت است. */
        fun kick(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<SendWorker>()
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Store.settings(ctx).backoffSeconds.toLong(), TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req)
        }

        /** تورِ ایمنی: هر ۱۵ دقیقه (کمینه‌ی اندروید) صف را دوباره خالی می‌کند، حتی اگر backoff طولانی شده باشد. */
        fun schedulePeriodic(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SendWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
        }
    }
}
