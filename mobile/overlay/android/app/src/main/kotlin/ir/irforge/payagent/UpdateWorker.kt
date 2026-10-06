package ir.irforge.payagent

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.Worker
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** دوره‌ای مانیفستِ آپدیت را می‌خواند و برای هر نسخه‌ی جدید فقط یک‌بار نوتیف می‌دهد. */
class UpdateWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val m = Updater.check(applicationContext) ?: return Result.success()
        if (Updater.lastNotifiedCode(applicationContext) != m.code) {
            Updater.setNotified(applicationContext, m.code)
            Notifier.notify(applicationContext, Notifier.ID_UPDATE, "نسخه‌ی جدید ${m.name} آماده است",
                if (m.notes.isNotBlank()) m.notes else "اپ را باز کنید و «دانلود و نصب» را بزنید.", android.R.drawable.stat_sys_download_done)
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "update-check"
        fun schedule(ctx: Context) {
            val wm = WorkManager.getInstance(ctx)
            val s = Store.settings(ctx)
            if (!s.autoUpdateCheck) { wm.cancelUniqueWork(NAME); return }
            val req = PeriodicWorkRequestBuilder<UpdateWorker>(s.updateCheckHours.toLong(), TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, req)
        }
    }
}
