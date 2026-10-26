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
        // فقط اتصال‌های روشن و کامل؛ هر پیامک جداگانه برای هر اتصال سنجیده می‌شود (یک پیامک می‌تواند به چند مقصد برود).
        val profiles = Store.profiles(ctx).filter { it.enabled && it.complete }
        var queued = false
        // پیامکِ چندبخشی = چند PDU از یک فرستنده؛ یکی‌شان کن.
        for ((sender, group) in parts.groupBy { it.originatingAddress ?: "" }) {
            val body = group.joinToString("") { it.messageBody ?: "" }
            val to = mutableListOf<String>()
            var reason: String? = null
            if (profiles.isEmpty()) reason = "no_config"
            else if (body.isBlank()) reason = "blank"
            else for (p in profiles) {
                val d = decide(p, sender, body)
                if (d == "queued") {
                    Store.enqueue(ctx, p.id, sender, body, group.first().timestampMillis)
                    to += p.label
                } else if (reason == null) reason = d
            }
            val decision = if (to.isNotEmpty()) "queued" else reason ?: "not_allowed"
            Log.i("PayAgent", "sms-received sender=$sender decision=$decision")
            Store.logEvent(ctx, sender, decision, to.joinToString("، "))
            if (to.isNotEmpty()) queued = true
        }
        if (queued) {
            SendWorker.kick(ctx)
            SendWorker.schedulePeriodic(ctx)
        }
    }

    companion object {
        /** تصمیمِ یک اتصال برای یک پیامک. «forward» حتماً باید فیلترِ فرستنده یا کلمه داشته باشد (وگرنه پیامکِ شخصی لو می‌رفت). */
        fun decide(p: Config, sender: String, body: String): String = when {
            p.senders.isNotEmpty() && !senderAllowed(sender, p.senders) -> "not_allowed"
            p.kind == "forward" && p.senders.isEmpty() && p.keywords.isEmpty() -> "no_filter"
            // لیستِ فرستنده خالی است: فقط پیامک‌هایی که شبیه تراکنشِ بانکی‌اند (پیامکِ شخصی/OTP نه).
            p.kind != "forward" && p.senders.isEmpty() && !looksLikeBankSms(body) -> "not_bank_like"
            p.keywords.isNotEmpty() && p.keywords.none { body.contains(it, ignoreCase = true) } -> "no_keyword"
            else -> "queued"
        }

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
