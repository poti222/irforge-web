package ir.irforge.payagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val cfg = Store.config(ctx) ?: return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        // پیامکِ چندبخشی = چند PDU از یک فرستنده؛ یکی‌شان کن.
        for ((sender, group) in parts.groupBy { it.originatingAddress ?: "" }) {
            if (!allowed(sender, cfg.senders)) continue // فقط بانک؛ پیامکِ شخصی هرگز از گوشی خارج نمی‌شود.
            val body = group.joinToString("") { it.messageBody ?: "" }
            if (body.isBlank()) continue
            Store.enqueue(ctx, sender, body, group.first().timestampMillis)
        }
        SendWorker.kick(ctx)
        SendWorker.schedulePeriodic(ctx)
    }

    private fun allowed(sender: String, allow: List<String>) =
        allow.isNotEmpty() && allow.any { it.equals(sender, ignoreCase = true) }
}
