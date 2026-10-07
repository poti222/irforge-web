package ir.irforge.payagent

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import java.security.MessageDigest

data class Config(val urls: List<String>, val secret: String, val senders: List<String>) {
    val complete get() = urls.isNotEmpty() && secret.isNotEmpty()
}

/** همه‌ی مقادیرِ قابل‌تنظیم برای خودکارسازی/پایداری — از صفحه‌ی «تنظیمات» اپ عوض می‌شوند. */
data class AgentSettings(
    val backoffSeconds: Int = 10,      // فاصله‌ی اولِ تلاشِ مجدد (نمایی دو برابر می‌شود)
    val timeoutSeconds: Int = 15,      // مهلتِ خواندنِ پاسخ در هر تلاش
    val tryAllNetworks: Boolean = true,// امتحانِ همه‌ی شبکه‌ها (VPN/بی‌VPN/موبایل/Wi-Fi)
    val keepDays: Int = 7,             // نگهداریِ سابقه‌ی ارسال‌شده/ردشده
    val notifyOnSend: Boolean = false, // نوتیف به‌ازای هر پیامکِ رسیده به سایت
    val notifyOnFailure: Boolean = true,
    val autoUpdateCheck: Boolean = true,
    val updateCheckHours: Int = 6,
    val updateUrl: String = "",        // خالی = از origin وبهوک: /api/agent/latest
    val keywords: String = "",         // کلمات (با ویرگول): فقط پیامکی که یکی‌شان را دارد ارسال شود؛ خالی = فیلتر نیست
)

data class QueuedSms(val id: String, val sender: String, val body: String, val ts: Long, val attempts: Int)

/** ذخیره‌ی تنظیمات (SharedPreferences) و صفِ ماندگارِ پیامک‌ها (SQLite) — بعد از ری‌استارت/کرشِ گوشی هم می‌ماند. */
object Store {
    private const val PREFS = "agent"

    fun config(ctx: Context): Config? {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val c = Config(
            urls = jsonList(p.getString("urls", "[]")),
            secret = p.getString("secret", "") ?: "",
            senders = jsonList(p.getString("senders", "[]")),
        )
        return if (c.complete) c else null
    }

    fun saveConfig(ctx: Context, c: Config) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("urls", JSONArray(c.urls).toString())
            .putString("secret", c.secret)
            .putString("senders", JSONArray(c.senders).toString())
            .apply()
        // کلید اصلاح شده → پیامک‌هایی که به‌خاطر ۴۰۱/۴۰۳ متوقف بودند دوباره در صف می‌روند.
        db(ctx).writableDatabase.execSQL("UPDATE sms SET status='pending', attempts=0 WHERE status='blocked'")
    }

    fun clearConfig(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun setLastError(ctx: Context, e: String?) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("lastError", e).apply()

    fun lastError(ctx: Context): String? =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("lastError", null)

    fun lastSentAt(ctx: Context): Long =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("lastSentAt", 0)

    private fun jsonList(s: String?): List<String> {
        val a = JSONArray(s ?: "[]")
        return (0 until a.length()).map { a.getString(it) }
    }

    // ── صف ──────────────────────────────────────────────────────────────────────────
    private class Db(ctx: Context) : SQLiteOpenHelper(ctx, "queue.db", null, 1) {
        override fun onCreate(d: SQLiteDatabase) {
            d.execSQL("CREATE TABLE sms(id TEXT PRIMARY KEY, sender TEXT, body TEXT, ts INTEGER, attempts INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', created INTEGER)")
        }
        override fun onUpgrade(d: SQLiteDatabase, o: Int, n: Int) {}
    }

    @Volatile private var helper: Db? = null
    private fun db(ctx: Context): Db = helper ?: synchronized(this) { helper ?: Db(ctx.applicationContext).also { helper = it } }

    /** false = پیامکِ تکراری (همان فرستنده/متن/زمان) که قبلاً در صف آمده. */
    fun enqueue(ctx: Context, sender: String, body: String, ts: Long): Boolean {
        val id = sha(sender + "\u0000" + body + "\u0000" + ts)
        val v = ContentValues().apply {
            put("id", id); put("sender", sender); put("body", body); put("ts", ts); put("created", System.currentTimeMillis())
        }
        return db(ctx).writableDatabase.insertWithOnConflict("sms", null, v, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    fun pending(ctx: Context): List<QueuedSms> {
        val out = mutableListOf<QueuedSms>()
        db(ctx).readableDatabase.rawQuery("SELECT id,sender,body,ts,attempts FROM sms WHERE status='pending' ORDER BY ts", null).use {
            while (it.moveToNext()) out += QueuedSms(it.getString(0), it.getString(1), it.getString(2), it.getLong(3), it.getInt(4))
        }
        return out
    }

    fun mark(ctx: Context, id: String, status: String) {
        db(ctx).writableDatabase.execSQL("UPDATE sms SET status=? WHERE id=?", arrayOf(status, id))
        if (status == "sent") {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("lastSentAt", System.currentTimeMillis()).apply()
            // متنِ پیامکِ ارسال‌شده را دیگر نگه نمی‌داریم (حریمِ خصوصی)؛ فقط ردیفِ شمارشی می‌ماند.
            db(ctx).writableDatabase.execSQL("UPDATE sms SET body='' WHERE id=?", arrayOf(id))
        }
    }

    fun bumpAttempts(ctx: Context, id: String) =
        db(ctx).writableDatabase.execSQL("UPDATE sms SET attempts=attempts+1 WHERE id=?", arrayOf(id))

    fun count(ctx: Context, status: String): Int =
        db(ctx).readableDatabase.rawQuery("SELECT COUNT(*) FROM sms WHERE status=?", arrayOf(status)).use { it.moveToFirst(); it.getInt(0) }

    fun prune(ctx: Context) {
        val cutoff = System.currentTimeMillis() - settings(ctx).keepDays * 24L * 3600 * 1000
        db(ctx).writableDatabase.execSQL("DELETE FROM sms WHERE status IN ('sent','dead') AND created < ?", arrayOf(cutoff))
    }

    private fun sha(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    // ── تنظیمات ─────────────────────────────────────────────────────────────────────
    fun settings(ctx: Context): AgentSettings {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val d = AgentSettings()
        return AgentSettings(
            backoffSeconds = p.getInt("s_backoff", d.backoffSeconds).coerceIn(5, 600),
            timeoutSeconds = p.getInt("s_timeout", d.timeoutSeconds).coerceIn(5, 60),
            tryAllNetworks = p.getBoolean("s_allnet", d.tryAllNetworks),
            keepDays = p.getInt("s_keep", d.keepDays).coerceIn(1, 90),
            notifyOnSend = p.getBoolean("s_notsend", d.notifyOnSend),
            notifyOnFailure = p.getBoolean("s_notfail", d.notifyOnFailure),
            autoUpdateCheck = p.getBoolean("s_autoupd", d.autoUpdateCheck),
            updateCheckHours = p.getInt("s_updhours", d.updateCheckHours).coerceIn(1, 72),
            updateUrl = p.getString("s_updurl", d.updateUrl) ?: "",
            keywords = p.getString("s_keywords", d.keywords) ?: "",
        )
    }

    fun saveSettings(ctx: Context, s: AgentSettings) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("s_backoff", s.backoffSeconds).putInt("s_timeout", s.timeoutSeconds)
            .putBoolean("s_allnet", s.tryAllNetworks).putInt("s_keep", s.keepDays)
            .putBoolean("s_notsend", s.notifyOnSend).putBoolean("s_notfail", s.notifyOnFailure)
            .putBoolean("s_autoupd", s.autoUpdateCheck).putInt("s_updhours", s.updateCheckHours)
            .putString("s_updurl", s.updateUrl.trim())
            .putString("s_keywords", s.keywords.trim())
            .apply()
    }

    // ── مدیریتِ صف از داخل اپ ───────────────────────────────────────────────────────
    /** متنِ پیامک فقط برای ردیف‌هایی که هنوز ارسال نشده‌اند برمی‌گردد (حریمِ خصوصی). */
    fun all(ctx: Context, limit: Int = 200): List<Map<String, Any>> {
        val out = mutableListOf<Map<String, Any>>()
        db(ctx).readableDatabase.rawQuery(
            "SELECT id,sender,body,ts,attempts,status FROM sms ORDER BY ts DESC LIMIT ?", arrayOf(limit.toString())
        ).use {
            while (it.moveToNext()) out += mapOf(
                "id" to it.getString(0), "sender" to it.getString(1),
                "body" to if (it.getString(5) == "sent") "" else it.getString(2),
                "ts" to it.getLong(3), "attempts" to it.getInt(4), "status" to it.getString(5),
            )
        }
        return out
    }

    fun retry(ctx: Context, id: String) =
        db(ctx).writableDatabase.execSQL("UPDATE sms SET status='pending', attempts=0 WHERE id=? AND status IN ('blocked','dead')", arrayOf(id))

    fun retryAll(ctx: Context) =
        db(ctx).writableDatabase.execSQL("UPDATE sms SET status='pending', attempts=0 WHERE status IN ('blocked','dead')")

    fun delete(ctx: Context, id: String) =
        db(ctx).writableDatabase.execSQL("DELETE FROM sms WHERE id=?", arrayOf(id))

    // ── لاگِ دریافتِ پیامک (برای عیب‌یابی در خودِ اپ) ───────────────────────────────
    /** فقط فرستنده + تصمیم؛ متنِ پیامکِ ردشده هرگز ذخیره نمی‌شود. */
    @Synchronized
    fun logEvent(ctx: Context, sender: String, decision: String) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(p.getString("events", "[]"))
        val o = org.json.JSONObject().put("ts", System.currentTimeMillis()).put("sender", sender).put("decision", decision)
        val out = JSONArray().put(o)
        for (i in 0 until minOf(arr.length(), 39)) out.put(arr.get(i))
        p.edit().putString("events", out.toString()).apply()
    }

    fun events(ctx: Context): List<Map<String, Any>> {
        val arr = JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("events", "[]"))
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            mapOf("ts" to o.getLong("ts"), "sender" to o.getString("sender"), "decision" to o.getString("decision"))
        }
    }

    fun clearEvents(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("events").apply()
}
