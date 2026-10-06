package ir.irforge.payagent

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.MessageDigest

data class Manifest(
    val code: Long, val name: String, val apkUrl: String, val sha256: String, val notes: String, val mandatory: Boolean,
) {
    fun toMap() = mapOf("versionCode" to code, "versionName" to name, "notes" to notes, "mandatory" to mandatory)
}

/**
 * آپدیتِ داخلِ اپ: مانیفست (GET /api/agent/latest) ← مقایسه‌ی versionCode ← دانلود ← بررسیِ SHA-256 ← نصب با installerِ سیستم.
 * امنیت: فقط https، هشِ اجباری، و خودِ اندروید هم امضای APK جدید را با نسخه‌ی نصب‌شده تطبیق می‌دهد
 * (پس باید همیشه با «همان keystore» بیلد شود).
 */
object Updater {
    private const val PREFS = "agent"

    fun installedCode(ctx: Context): Long {
        val i = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) i.longVersionCode else @Suppress("DEPRECATION") i.versionCode.toLong()
    }

    fun installedName(ctx: Context): String = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""

    /** آدرسِ مانیفست: تنظیمِ دستی، وگرنه origin اولین آدرسِ وبهوک + /api/agent/latest. */
    fun manifestUrl(ctx: Context): String? {
        val custom = Store.settings(ctx).updateUrl
        if (custom.isNotBlank()) return custom
        val hook = Store.config(ctx)?.urls?.firstOrNull() ?: return null
        return try { val u = URI(hook); "${u.scheme}://${u.authority}/api/agent/latest" } catch (_: Exception) { null }
    }

    /** مانیفستِ نسخه‌ی جدیدتر، یا null (نسخه‌ی جدید نیست/سرور در دسترس نیست). نتیجه کش می‌شود. */
    fun check(ctx: Context): Manifest? {
        val url = manifestUrl(ctx) ?: return null
        val txt = Sender.fetchText(ctx, url) ?: return pending(ctx)
        val m = parse(txt)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("update_json", if (m != null) txt else null).apply()
        return if (m != null && m.code > installedCode(ctx)) m else null
    }

    /** آخرین مانیفستِ کش‌شده اگر هنوز جدیدتر از نسخه‌ی نصب‌شده باشد. */
    fun pending(ctx: Context): Manifest? {
        val txt = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("update_json", null) ?: return null
        val m = parse(txt) ?: return null
        return if (m.code > installedCode(ctx)) m else null
    }

    private fun parse(txt: String): Manifest? = try {
        val j = JSONObject(txt)
        if (!j.optBoolean("available", false)) null else {
            val url = j.getString("apkUrl")
            if (!url.startsWith("https://")) null
            else Manifest(j.getLong("versionCode"), j.getString("versionName"), url, j.getString("sha256").lowercase(),
                j.optString("notes", ""), j.optBoolean("mandatory", false))
        }
    } catch (_: Exception) { null }

    fun apkFile(ctx: Context) = File(File(ctx.cacheDir, "updates"), "agent.apk")

    fun lastNotifiedCode(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("update_notified", 0)
    fun setNotified(ctx: Context, code: Long) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong("update_notified", code).apply()

    /** دانلود + تطبیقِ هش. true = فایلِ سالم آماده‌ی نصب است. */
    fun download(ctx: Context, m: Manifest, onProgress: (Int) -> Unit): Boolean {
        val f = apkFile(ctx)
        f.delete()
        if (!Sender.download(ctx, m.apkUrl, f, onProgress)) return false
        val ok = sha256(f) == m.sha256
        if (!ok) f.delete()
        return ok
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { i -> val b = ByteArray(64 * 1024); while (true) { val n = i.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** "installing" | "need_permission" | "no_file" */
    fun install(ctx: Context): String {
        val f = apkFile(ctx)
        if (!f.exists()) return "no_file"
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return "need_permission"
        }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", f)
        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        return "installing"
    }
}
