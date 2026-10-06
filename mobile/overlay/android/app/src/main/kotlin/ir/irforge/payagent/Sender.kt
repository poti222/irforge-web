package ir.irforge.payagent

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.InetAddress
import java.util.concurrent.TimeUnit

enum class Outcome { OK, PERMANENT, AUTH, TRANSIENT }
data class SendResult(val outcome: Outcome, val code: Int, val detail: String)

/**
 * ارسالِ یک پیامک به وبهوک، مقاوم در برابرِ تغییرِ IP و روشن/خاموش شدنِ VPN:
 *  - هر آدرس (اصلی + پشتیبان‌ها) روی **هر شبکه‌ی موجود** تلاش می‌شود: شبکه‌ی فعلی، بعد بقیه (Wi-Fi/موبایل،
 *    با VPN یا بی‌VPN). یعنی اگر دامنه فقط از یکی از مسیرها باز است، همان مسیر پیدا می‌شود.
 *  - سرور idempotent است (content_hash)، پس retry و ارسالِ تکراری امن است.
 *  - هر پاسخِ HTTP نهایی (۲xx/۴۰۰/۴۰۱/۴۰۳) تلاش را تمام می‌کند؛ ۴۲۹/۵xx و خطای شبکه → مسیرِ بعدی.
 */
object Sender {
    private val TEXT = "text/plain; charset=utf-8".toMediaType()

    fun send(ctx: Context, cfg: Config, sender: String, body: String, tsMillis: Long): SendResult {
        var last = SendResult(Outcome.TRANSIENT, 0, "بدون شبکه")
        for (net in routes(ctx)) {
            val client = clientFor(ctx, net)
            for (url in cfg.urls) {
                val req = Request.Builder().url(url)
                    .header("X-Sms-Secret", cfg.secret)
                    .header("X-Sms-Sender", sender)
                    .header("X-Sms-Time", tsMillis.toString())
                    .post(body.toRequestBody(TEXT))
                    .build()
                try {
                    client.newCall(req).execute().use { r ->
                        val c = r.code
                        when {
                            c == 200 || c == 201 -> return SendResult(Outcome.OK, c, "ok")
                            c == 401 || c == 403 -> return SendResult(Outcome.AUTH, c, "کلید/کانال نامعتبر ($c)")
                            c == 400 -> return SendResult(Outcome.PERMANENT, c, "بدنه نامعتبر (400)")
                            else -> last = SendResult(Outcome.TRANSIENT, c, "پاسخ سرور $c")
                        }
                    }
                } catch (e: Exception) {
                    last = SendResult(Outcome.TRANSIENT, 0, "خطای شبکه: ${e.javaClass.simpleName}")
                }
            }
        }
        return last
    }

    /** null = شبکه‌ی پیش‌فرضِ سیستم (بدونِ bind). ترتیب: فعلی، سپس بقیه‌ی شبکه‌های دارایِ اینترنت. */
    private fun routes(ctx: Context): List<Network?> {
        if (!Store.settings(ctx).tryAllNetworks) return listOf(null)
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val out = mutableListOf<Network?>()
        val active = cm.activeNetwork
        if (active != null) out += active
        for (n in cm.allNetworks) {
            val caps = cm.getNetworkCapabilities(n) ?: continue
            if (n != active && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) out += n
        }
        out += null
        return out
    }

    private fun clientFor(ctx: Context, net: Network?, long: Boolean = false): OkHttpClient {
        val t = Store.settings(ctx).timeoutSeconds.toLong()
        val b = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(t, TimeUnit.SECONDS)
            .callTimeout(if (long) 0 else t + 10, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
        if (net != null) {
            b.socketFactory(net.socketFactory)
            b.dns(object : Dns {
                override fun lookup(hostname: String): List<InetAddress> = net.getAllByName(hostname).toList()
            })
        }
        return b.build()
    }

    /** GET متنی با همان منطقِ چندشبکه‌ای (برای مانیفستِ آپدیت). null = همه‌ی مسیرها شکست خوردند. */
    fun fetchText(ctx: Context, url: String): String? {
        for (net in routes(ctx)) {
            try {
                clientFor(ctx, net).newCall(Request.Builder().url(url).build()).execute().use { r ->
                    if (r.isSuccessful) return r.body?.string()
                }
            } catch (_: Exception) {}
        }
        return null
    }

    /** دانلودِ فایل با درصدِ پیشرفت؛ روی همه‌ی مسیرها امتحان می‌شود. */
    fun download(ctx: Context, url: String, dest: java.io.File, onProgress: (Int) -> Unit): Boolean {
        for (net in routes(ctx)) {
            try {
                clientFor(ctx, net, long = true).newCall(Request.Builder().url(url).build()).execute().use { r ->
                    val body = r.body
                    if (!r.isSuccessful || body == null) return@use
                    val total = body.contentLength()
                    dest.parentFile?.mkdirs()
                    var done = 0L; var last = -1
                    body.byteStream().use { input ->
                        dest.outputStream().use { out ->
                            val buf = ByteArray(32 * 1024)
                            while (true) {
                                val n = input.read(buf); if (n < 0) break
                                out.write(buf, 0, n); done += n
                                if (total > 0) { val pct = (done * 100 / total).toInt(); if (pct != last) { last = pct; onProgress(pct) } }
                            }
                        }
                    }
                    return true
                }
            } catch (_: Exception) {}
        }
        return false
    }
}
