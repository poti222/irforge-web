package ir.irforge.payagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** بعد از روشن شدنِ گوشی یا آپدیتِ اپ: تورِ ایمنی را دوباره بچین و صفِ مانده را بفرست. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (Store.config(ctx) == null) return
        SendWorker.schedulePeriodic(ctx)
        UpdateWorker.schedule(ctx)
        SendWorker.kick(ctx)
    }
}
