package ir.irforge.payagent

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import kotlin.concurrent.thread

class MainActivity : FlutterActivity() {
    private var permResult: MethodChannel.Result? = null
    private lateinit var channel: MethodChannel

    override fun configureFlutterEngine(engine: FlutterEngine) {
        super.configureFlutterEngine(engine)
        channel = MethodChannel(engine.dartExecutor.binaryMessenger, "ir.irforge.payagent/native")
        runCatching { UpdateWorker.schedule(this) }
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "getConfig" -> result.success(Store.config(this)?.let { mapOf("urls" to it.urls, "secret" to it.secret, "senders" to it.senders) })
                "saveConfig" -> {
                    Store.saveConfig(this, cfgFrom(call.arguments as Map<*, *>))
                    SendWorker.schedulePeriodic(this); SendWorker.kick(this)
                    result.success(null)
                }
                "clearConfig" -> { Store.clearConfig(this); result.success(null) }
                "status" -> result.success(mapOf(
                    "smsPermission" to hasSms(),
                    "batteryExempt" to batteryExempt(),
                    "pending" to Store.count(this, "pending"),
                    "sent" to Store.count(this, "sent"),
                    "blocked" to Store.count(this, "blocked"),
                    "dead" to Store.count(this, "dead"),
                    "lastSentAt" to Store.lastSentAt(this),
                    "lastError" to Store.lastError(this),
                    "versionCode" to Updater.installedCode(this),
                    "versionName" to Updater.installedName(this),
                    "update" to Updater.pending(this)?.toMap(),
                ))
                "getSettings" -> result.success(settingsMap(Store.settings(this)))
                "saveSettings" -> {
                    Store.saveSettings(this, settingsFrom(call.arguments as Map<*, *>))
                    UpdateWorker.schedule(this); result.success(null)
                }
                "events" -> result.success(Store.events(this))
                "clearEvents" -> { Store.clearEvents(this); result.success(null) }
                "queue" -> result.success(Store.all(this))
                "queueRetry" -> { Store.retry(this, call.arguments as String); SendWorker.kick(this); result.success(null) }
                "queueRetryAll" -> { Store.retryAll(this); SendWorker.kick(this); result.success(null) }
                "queueDelete" -> { Store.delete(this, call.arguments as String); result.success(null) }
                "checkUpdate" -> thread {
                    val m = Updater.check(this)
                    runOnUiThread { result.success(m?.toMap()) }
                }
                "downloadUpdate" -> thread {
                    val m = Updater.pending(this)
                    val ok = m != null && Updater.download(this, m) { pct -> runOnUiThread { channel.invokeMethod("updateProgress", pct) } }
                    runOnUiThread { result.success(ok) }
                }
                "installUpdate" -> result.success(Updater.install(this))
                "requestSmsPermission" -> requestSms(result)
                "requestBatteryExemption" -> { openBattery(); result.success(null) }
                "openAppSettings" -> {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                    result.success(null)
                }
                "flushNow" -> { SendWorker.kick(this); result.success(null) }
                "test" -> {
                    val cfg = cfgFrom(call.arguments as Map<*, *>)
                    thread {
                        val r = Sender.send(this, cfg, "IrForgeTest", "IrForge Pay Agent connectivity test", System.currentTimeMillis())
                        val msg = when (r.outcome) {
                            Outcome.OK -> "اتصال و کلید درست است ✅"
                            Outcome.AUTH -> "کلید امنیتی یا آدرس کانال اشتباه است (${r.code})"
                            Outcome.PERMANENT -> "سرور درخواست را نپذیرفت (${r.code})"
                            Outcome.TRANSIENT -> "سرور در دسترس نیست — VPN/اینترنت را بررسی کنید. (${r.detail})"
                        }
                        runOnUiThread { result.success(mapOf("ok" to (r.outcome == Outcome.OK), "message" to msg)) }
                    }
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun settingsMap(s: AgentSettings) = mapOf(
        "backoffSeconds" to s.backoffSeconds, "timeoutSeconds" to s.timeoutSeconds, "tryAllNetworks" to s.tryAllNetworks,
        "keepDays" to s.keepDays, "notifyOnSend" to s.notifyOnSend, "notifyOnFailure" to s.notifyOnFailure,
        "autoUpdateCheck" to s.autoUpdateCheck, "updateCheckHours" to s.updateCheckHours, "updateUrl" to s.updateUrl, "keywords" to s.keywords,
    )

    private fun settingsFrom(m: Map<*, *>): AgentSettings {
        val d = AgentSettings()
        return AgentSettings(
            backoffSeconds = (m["backoffSeconds"] as? Int) ?: d.backoffSeconds,
            timeoutSeconds = (m["timeoutSeconds"] as? Int) ?: d.timeoutSeconds,
            tryAllNetworks = (m["tryAllNetworks"] as? Boolean) ?: d.tryAllNetworks,
            keepDays = (m["keepDays"] as? Int) ?: d.keepDays,
            notifyOnSend = (m["notifyOnSend"] as? Boolean) ?: d.notifyOnSend,
            notifyOnFailure = (m["notifyOnFailure"] as? Boolean) ?: d.notifyOnFailure,
            autoUpdateCheck = (m["autoUpdateCheck"] as? Boolean) ?: d.autoUpdateCheck,
            updateCheckHours = (m["updateCheckHours"] as? Int) ?: d.updateCheckHours,
            updateUrl = (m["updateUrl"] as? String) ?: d.updateUrl,
            keywords = (m["keywords"] as? String) ?: d.keywords,
        )
    }

    private fun cfgFrom(m: Map<*, *>) = Config(
        urls = (m["urls"] as List<*>).map { it.toString() },
        secret = m["secret"].toString(),
        senders = (m["senders"] as? List<*>)?.map { it.toString() } ?: emptyList(),
    )

    private fun hasSms() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED

    private fun batteryExempt() =
        (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)

    private fun requestSms(result: MethodChannel.Result) {
        val perms = mutableListOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT >= 33) perms += Manifest.permission.POST_NOTIFICATIONS
        if (hasSms()) { result.success(true); return }
        permResult = result
        ActivityCompat.requestPermissions(this, perms.toTypedArray(), 77)
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        super.onRequestPermissionsResult(code, perms, res)
        if (code == 77) { permResult?.success(hasSms()); permResult = null }
    }

    private fun openBattery() {
        val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
        try { startActivity(i) } catch (_: Exception) { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }
}
