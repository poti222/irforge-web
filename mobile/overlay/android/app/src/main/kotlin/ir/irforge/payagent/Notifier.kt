package ir.irforge.payagent

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

object Notifier {
    private const val CH = "alerts"
    const val ID_ALERT = 1
    const val ID_SENT = 2
    const val ID_UPDATE = 3

    fun alert(ctx: Context, title: String, text: String) = notify(ctx, ID_ALERT, title, text, android.R.drawable.stat_notify_error)

    /** نوتیفِ ساده؛ با لمس اپ باز می‌شود. بدونِ مجوزِ اعلان بی‌صدا رد می‌شود. */
    fun notify(ctx: Context, id: Int, title: String, text: String, icon: Int = android.R.drawable.stat_notify_chat) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CH, "هشدارها و به‌روزرسانی", NotificationManager.IMPORTANCE_HIGH))
        val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        val pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        nm.notify(id, NotificationCompat.Builder(ctx, CH)
            .setSmallIcon(icon).setContentTitle(title).setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi).setAutoCancel(true).build())
    }
}
