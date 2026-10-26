package ir.irforge.payagent

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import java.security.MessageDigest

/**
 * یک «اتصال» (پروفایل): هر کدام آدرس/کلیدِ جدا و فیلترِ جدای خودش را دارد؛ مثلاً یکی برای تأییدِ پرداختِ بانک و
 * یکی برای «ارسال پیامک به تلگرام». `kind`: payment (پیش‌فرض) | forward.
 */
data class Config(
    val urls: List<String>,
    val secret: String,
    val senders: List<String>,
    val id: String = "default",
    val name: String = "",
    val kind: String = "payment",
    val keywords: List<String> = emptyList(),
    val enabled: Boolean = true,
) {
    val complete get() = urls.isNotEmpty() && secret.isNotEmpty()
    val label get() = name.ifBlank { if (kind == "forward") "ارسال به تلگرام" else "پرداخت" }
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

data class QueuedSms(val id: String, val sender: String, val body: String, val ts: Long, val attempts: Int, val profileId: String)

/** ذخیره‌ی تنظیمات (SharedPreferences) و صفِ ماندگارِ پیامک‌ها (SQLite) — بعد از ری‌استارت/کرشِ گوشی هم می‌ماند. */
object Store {
    private const val PREFS = "agent"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** اولین اتصالِ کامل (برای جاهایی که فقط یک آدرس لازم دارند، مثل مانیفستِ آپدیت). */
    fun config(ctx: Context): Config? = profiles(ctx).firstOrNull { it.complete }

    /** همه‌ی اتصال‌ها. اگر فقط تنظیماتِ قدیمیِ تک‌کلیدی هست، یک‌بار به اتصالِ «default» مهاجرت می‌کند. */
    @Synchronized
    fun profiles(ctx: Context): List<Config> {
        val p = prefs(ctx)
        val raw = p.getString("profiles", null)
        if (raw != null) return parseProfiles(raw)
        val urls = jsonList(p.getString("urls", "[]"))
        val secret = p.getString("secret", "") ?: ""
        if (urls.isEmpty() || secret.isEmpty()) return emptyList()
        val kw = (p.getString("s_keywords", "") ?: "").split(',', '،', '\n').map { it.trim() }.filter { it.isNotEmpty() }
        val c = Config(urls = urls, secret = secret, senders = jsonList(p.getString("senders", "[]")), id = "default", keywords = kw)
        writeProfiles(ctx, listOf(c))
        p.edit().remove("urls").remove("secret").remove("senders").apply()
        return listOf(c)
    }

    fun profile(ctx: Context, id: String): Config? = profiles(ctx).firstOrNull { it.id == id }

    /** ساخت/ویرایش (با id). کلید اصلاح‌شده → پیامک‌های «متوقف»ِ همین اتصال دوباره در صف می‌روند. */
    @Synchronized
    fun saveProfile(ctx: Context, c: Config): Config {
        val list = profiles(ctx).toMutableList()
        val id = c.id.ifBlank { "p" + java.util.UUID.randomUUID().toString().replace("-", "").take(8) }
        val next = c.copy(id = id)
        val i = list.indexOfFirst { it.id == id }
        if (i >= 0) list[i] = next else list += next
        writeProfiles(ctx, list)
        db(ctx).writableDatabase.execSQL("UPDATE sms SET status='pending', attempts=0 WHERE status='blocked' AND profile_id=?", arrayOf(id))
        return next
    }

    @Synchronized
    fun deleteProfile(ctx: Context, id: String) {
        writeProfiles(ctx, profiles(ctx).filter { it.id != id })
        db(ctx).writableDatabase.execSQL("DELETE FROM sms WHERE profile_id=?", arrayOf(id))
        prefs(ctx).edit().remove("lastError_$id").remove("lastSentAt_$id").apply()
    }

    private fun writeProfiles(ctx: Context, list: List<Config>) {
        prefs(ctx).edit().putString("profiles", JSONArray(list.map { toJson(it) }).toString()).apply()
    }

    private fun parseProfiles(raw: String): List<Config> {
        val a = try { JSONArray(raw) } catch (_: Exception) { return emptyList() }
        return (0 until a.length()).map { fromJson(a.getJSONObject(it)) }
    }

    private fun strList(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { a.getString(it) }

    private fun toJson(c: Config) = org.json.JSONObject()
        .put("id", c.id).put("name", c.name).put("kind", c.kind)
        .put("urls", JSONArray(c.urls)).put("secret", c.secret)
        .put("senders", JSONArray(c.senders)).put("keywords", JSONArray(c.keywords)).put("enabled", c.enabled)

    private fun fromJson(o: org.json.JSONObject) = Config(
        urls = strList(o.optJSONArray("urls")), secret = o.optString("secret", ""), senders = strList(o.optJSONArray("senders")),
        id = o.optString("id", "default"), name = o.optString("name", ""), kind = o.optString("kind", "payment"),
        keywords = strList(o.optJSONArray("keywords")), enabled = o.optBoolean("enabled", true),
    )

    fun setLastError(ctx: Context, e: String?, profileId: String? = null) {
        val ed = prefs(ctx).edit().putString("lastError", e)
        if (profileId != null) ed.putString("lastError_$profileId", e)
        ed.apply()
    }

    fun lastError(ctx: Context, profileId: String? = null): String? =
        prefs(ctx).getString(if (profileId == null) "lastError" else "lastError_$profileId", null)

    fun lastSentAt(ctx: Context, profileId: String? = null): Long =
        prefs(ctx).getLong(if (profileId == null) "lastSentAt" else "lastSentAt_$profileId", 0)

    private fun jsonList(s: String?): List<String> {
        val a = JSONArray(s ?: "[]")
        return (0 until a.length()).map { a.getString(it) }
    }

    // ── صف ──────────────────────────────────────────────────────────────────────────
    private class Db(ctx: Context) : SQLiteOpenHelper(ctx, "queue.db", null, 2) {
        override fun onCreate(d: SQLiteDatabase) {
            d.execSQL("CREATE TABLE sms(id TEXT PRIMARY KEY, sender TEXT, body TEXT, ts INTEGER, attempts INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', created INTEGER, profile_id TEXT DEFAULT 'default')")
        }
        override fun onUpgrade(d: SQLiteDatabase, o: Int, n: Int) {
            if (o < 2) d.execSQL("ALTER TABLE sms ADD COLUMN profile_id TEXT DEFAULT 'default'")
        }
    }

    @Volatile private var helper: Db? = null
    private fun db(ctx: Context): Db = helper ?: synchronized(this) { helper ?: Db(ctx.applicationContext).also { helper = it } }

    /** false = پیامکِ تکراری (همان فرستنده/متن/زمان) که قبلاً در صف آمده. */
    fun enqueue(ctx: Context, profileId: String, sender: String, body: String, ts: Long): Boolean {
        // «default» همان فرمولِ قبلی را نگه می‌دارد تا ردیف‌های قبل از مهاجرت تکراری ساخته نشوند.
        val id = sha((if (profileId == "default") "" else profileId + "\u0000") + sender + "\u0000" + body + "\u0000" + ts)
        val v = ContentValues().apply {
            put("id", id); put("sender", sender); put("body", body); put("ts", ts); put("created", System.currentTimeMillis())
            put("profile_id", profileId)
        }
        return db(ctx).writableDatabase.insertWithOnConflict("sms", null, v, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    fun pending(ctx: Context): List<QueuedSms> {
        val out = mutableListOf<QueuedSms>()
        db(ctx).readableDatabase.rawQuery("SELECT id,sender,body,ts,attempts,profile_id FROM sms WHERE status='pending' ORDER BY ts", null).use {
            while (it.moveToNext()) out += QueuedSms(it.getString(0), it.getString(1), it.getString(2), it.getLong(3), it.getInt(4), it.getString(5) ?: "default")
        }
        return out
    }

    fun mark(ctx: Context, id: String, status: String) {
        db(ctx).writableDatabase.execSQL("UPDATE sms SET status=? WHERE id=?", arrayOf(status, id))
        if (status == "sent") {
            val now = System.currentTimeMillis()
            val ed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("lastSentAt", now)
            db(ctx).readableDatabase.rawQuery("SELECT profile_id FROM sms WHERE id=?", arrayOf(id)).use {
                if (it.moveToFirst()) ed.putLong("lastSentAt_${it.getString(0) ?: "default"}", now)
            }
            ed.apply()
            // متنِ پیامکِ ارسال‌شده را دیگر نگه نمی‌داریم (حریمِ خصوصی)؛ فقط ردیفِ شمارشی می‌ماند.
            db(ctx).writableDatabase.execSQL("UPDATE sms SET body='' WHERE id=?", arrayOf(id))
        }
    }

    fun bumpAttempts(ctx: Context, id: String) =
        db(ctx).writableDatabase.execSQL("UPDATE sms SET attempts=attempts+1 WHERE id=?", arrayOf(id))

    fun count(ctx: Context, status: String, profileId: String? = null): Int =
        if (profileId == null)
            db(ctx).readableDatabase.rawQuery("SELECT COUNT(*) FROM sms WHERE status=?", arrayOf(status)).use { it.moveToFirst(); it.getInt(0) }
        else
            db(ctx).readableDatabase.rawQuery("SELECT COUNT(*) FROM sms WHERE status=? AND profile_id=?", arrayOf(status, profileId)).use { it.moveToFirst(); it.getInt(0) }

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
        val names = profiles(ctx).associate { it.id to it.label }
        db(ctx).readableDatabase.rawQuery(
            "SELECT id,sender,body,ts,attempts,status,profile_id FROM sms ORDER BY ts DESC LIMIT ?", arrayOf(limit.toString())
        ).use {
            while (it.moveToNext()) out += mapOf(
                "id" to it.getString(0), "sender" to it.getString(1),
                "body" to if (it.getString(5) == "sent") "" else it.getString(2),
                "ts" to it.getLong(3), "attempts" to it.getInt(4), "status" to it.getString(5),
                "profile" to (names[it.getString(6) ?: "default"] ?: ""),
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
    fun logEvent(ctx: Context, sender: String, decision: String, to: String = "") {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = JSONArray(p.getString("events", "[]"))
        val o = org.json.JSONObject().put("ts", System.currentTimeMillis()).put("sender", sender).put("decision", decision).put("to", to)
        val out = JSONArray().put(o)
        for (i in 0 until minOf(arr.length(), 39)) out.put(arr.get(i))
        p.edit().putString("events", out.toString()).apply()
    }

    fun events(ctx: Context): List<Map<String, Any>> {
        val arr = JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("events", "[]"))
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            mapOf("ts" to o.getLong("ts"), "sender" to o.getString("sender"), "decision" to o.getString("decision"), "to" to o.optString("to", ""))
        }
    }

    fun clearEvents(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("events").apply()
}
