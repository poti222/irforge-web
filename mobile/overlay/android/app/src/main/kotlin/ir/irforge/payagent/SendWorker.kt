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
        val cfg = Store.config(applicationContext) ?: return Result.success()
        var retry = false
        for (m in Store.pending(applicationContext)) {
            val r = Sender.send(applicationContext, cfg, m.sender, m.body, m.ts)
            when (r.outcome) {
                Outcome.OK -> {
                    Store.mark(applicationContext, m.id, "sent"); Store.setLastError(applicationContext, null)
                    if (Store.settings(applicationContext).notifyOnSend)
                        Notifier.notify(applicationContext, Notifier.ID_SENT, "پیامک بانک به سایت رسید", "فرستنده: ${m.sender}")
                }
                Outcome.PERMANENT -> Store.mark(applicationContext, m.id, "dead")
                Outcome.AUTH -> {
                    Store.mark(applicationContext, m.id, "blocked")
                    Store.setLastError(applicationContext, r.detail)
                    if (Store.settings(applicationContext).notifyOnFailure) Notifier.alert(applicationContext, "کلید یا کانال نامعتبر است", "پیامک‌های بانک ارسال نمی‌شوند. اپ را باز کنید و تنظیمات را اصلاح کنید.")
                }
                Outcome.TRANSIENT -> {
                    Store.bumpAttempts(applicationContext, m.id)
                    Store.setLastError(applicationContext, r.detail)
                    retry = true
                    break // مسیرها همه خراب‌اند؛ بقیه‌ی صف را الکی نسوزان.
                }
            }
        }
        Store.prune(applicationContext)
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
