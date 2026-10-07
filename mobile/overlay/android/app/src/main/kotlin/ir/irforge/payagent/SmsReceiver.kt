package ir.irforge.payagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val cfg = Store.config(ctx)
        var queued = false
        // پیامکِ چندبخشی = چند PDU از یک فرستنده؛ یکی‌شان کن.
        for ((sender, group) in parts.groupBy { it.originatingAddress ?: "" }) {
            val body = group.joinToString("") { it.messageBody ?: "" }
            val decision = when {
                cfg == null -> "no_config"
                body.isBlank() -> "blank"
                cfg.senders.isNotEmpty() && !senderAllowed(sender, cfg.senders) -> "not_allowed"
                // لیستِ فرستنده خالی است: فقط پیامک‌هایی که شبیه تراکنشِ بانکی‌اند (پیامکِ شخصی/OTP نه).
                cfg.senders.isEmpty() && !looksLikeBankSms(body) -> "not_bank_like"
                else -> "queued"
            }
            Log.i("PayAgent", "sms-received sender=$sender decision=$decision")
            Store.logEvent(ctx, sender, decision)
            if (decision == "queued") {
                Store.enqueue(ctx, sender, body, group.first().timestampMillis)
                queued = true
            }
        }
        if (queued) {
            SendWorker.kick(ctx)
            SendWorker.schedulePeriodic(ctx)
        }
    }

    companion object {
        /** برابریِ بی‌توجه به حروف؛ برای شماره‌ها (+98… یا 98… یا 0…) ۸ رقمِ آخر مقایسه می‌شود. */
        fun senderAllowed(sender: String, allow: List<String>): Boolean {
            val s = sender.trim()
            return allow.any { a ->
                val x = a.trim()
                x.equals(s, ignoreCase = true) || (isNum(x) && isNum(s) && x.takeLast(8) == s.takeLast(8))
            }
        }

        private fun isNum(v: String) = v.length >= 8 && v.all { it.isDigit() || it == '+' }

        private val KEYWORDS = listOf("واریز", "برداشت", "مانده", "موجودی", "ریال", "deposit", "withdraw", "balance", "IRR", "انتقال", "پرداخت")

        fun looksLikeBankSms(body: String) = KEYWORDS.any { body.contains(it, ignoreCase = true) } && body.any { it.isDigit() }
    }
}
