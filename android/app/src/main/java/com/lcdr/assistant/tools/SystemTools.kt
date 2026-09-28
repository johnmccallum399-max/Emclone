package com.lcdr.assistant.tools

import android.Manifest
import android.annotation.SuppressLint
import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Looper
import android.os.Process
import android.provider.AlarmClock
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.lcdr.assistant.core.Notifications
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.time.LocalTime
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

@Singleton
class DeviceStatus @Inject constructor(@ApplicationContext private val context: Context) {

    fun battery(): String {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val pct = if (level >= 0) level * 100 / scale else -1
        val plugged = when (intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)) {
            BatteryManager.BATTERY_PLUGGED_AC -> "charging (AC)"
            BatteryManager.BATTERY_PLUGGED_USB -> "charging (USB)"
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> "charging (wireless)"
            else -> "on battery"
        }
        return if (pct >= 0) "$pct%, $plugged" else "unknown"
    }

    fun hasLocationPermission() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun lastKnownLocation(): Location? {
        if (!hasLocationPermission()) return null
        val lm = context.getSystemService(LocationManager::class.java)
        return lm.getProviders(true).mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
    }

    /** Fresh fix without Play Services; falls back to last known. */
    @SuppressLint("MissingPermission")
    suspend fun currentLocation(timeoutMs: Long = 15_000): Location? {
        val last = lastKnownLocation()
        if (last != null && System.currentTimeMillis() - last.time < 2 * 60_000) return last
        val lm = context.getSystemService(LocationManager::class.java)
        val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
            .firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) } ?: return last
        val fresh = withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<Location?> { cont ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    val signal = android.os.CancellationSignal()
                    cont.invokeOnCancellation { signal.cancel() }
                    lm.getCurrentLocation(provider, signal, ContextCompat.getMainExecutor(context)) { cont.resume(it) }
                } else {
                    val listener = object : LocationListener {
                        override fun onLocationChanged(location: Location) { if (cont.isActive) cont.resume(location) }
                        @Deprecated("Deprecated in Java")
                        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                        override fun onProviderEnabled(provider: String) {}
                        override fun onProviderDisabled(provider: String) {}
                    }
                    cont.invokeOnCancellation { lm.removeUpdates(listener) }
                    @Suppress("DEPRECATION")
                    lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
                }
            }
        }
        return fresh ?: last
    }

    /** Reverse geocode; Geocoder needs a platform backend, which some de-Googled ROMs lack. */
    suspend fun describe(location: Location): String? = withContext(Dispatchers.IO) {
        if (!Geocoder.isPresent()) return@withContext null
        runCatching {
            @Suppress("DEPRECATION")
            Geocoder(context).getFromLocation(location.latitude, location.longitude, 1)?.firstOrNull()?.let { a ->
                (0..a.maxAddressLineIndex).joinToString(", ") { a.getAddressLine(it) }
            }
        }.getOrNull()
    }

    fun hasUsageAccess(): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    data class AppUsage(val packageName: String, val label: String, val lastUsed: Long, val foregroundMs: Long)

    fun recentApps(windowMs: Long): List<AppUsage> {
        if (!hasUsageAccess()) return emptyList()
        val usm = context.getSystemService(UsageStatsManager::class.java)
        val now = System.currentTimeMillis()
        val pm = context.packageManager
        return usm.queryUsageStats(UsageStatsManager.INTERVAL_BEST, now - windowMs, now)
            .filter { it.lastTimeUsed >= now - windowMs && it.totalTimeInForeground > 0 }
            .groupBy { it.packageName }
            .map { (pkg, stats) ->
                val label = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
                AppUsage(pkg, label, stats.maxOf { it.lastTimeUsed }, stats.sumOf { it.totalTimeInForeground })
            }
            .sortedByDescending { it.lastUsed }
    }

    fun foregroundApp(): String? =
        recentApps(10 * 60_000).firstOrNull { it.packageName != context.packageName }?.label
}

class GetBatteryTool @Inject constructor(private val status: DeviceStatus) : DeviceTool {
    override val name = "get_battery"
    override val description = "Battery level and charging state."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.READ
    override val parameters = schema()
    override suspend fun execute(args: JsonObject) = status.battery()
}

class GetLocationTool @Inject constructor(private val status: DeviceStatus) : DeviceTool {
    override val name = "get_location"
    override val description = "Current GPS/network location with reverse-geocoded address when available."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.READ
    override val parameters = schema()

    override fun requiredPermissions(args: JsonObject) =
        listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    override suspend fun execute(args: JsonObject): String {
        val loc = status.currentLocation() ?: throw ToolException("No location fix (is location turned on?).")
        val address = status.describe(loc)
        return buildString {
            append("%.5f, %.5f (±%.0f m, %s, %s)".format(loc.latitude, loc.longitude, loc.accuracy, loc.provider, Formatting.millis(loc.time)))
            address?.let { append("\nAddress: ").append(it) }
        }
    }
}

class SetAlarmTool @Inject constructor(@ApplicationContext private val context: Context) : DeviceTool {
    override val name = "set_alarm"
    override val description = "Create an alarm in the system clock app."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.WRITE
    override val parameters = schema {
        string("time", "Alarm time, 24h HH:mm", required = true)
        string("label", "Alarm label")
    }

    override suspend fun execute(args: JsonObject): String {
        val time = runCatching { LocalTime.parse(args.requireStr("time").trim().padStart(5, '0')) }
            .getOrElse { throw ToolException("Use HH:mm for 'time'.") }
        val intent = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, time.hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, time.minute)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        args.str("label")?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
        if (intent.resolveActivity(context.packageManager) == null) throw ToolException("No clock app handles alarms.")
        context.startActivity(intent)
        return "Alarm set for $time${args.str("label")?.let { " ($it)" } ?: ""}."
    }
}

class SetTimerTool @Inject constructor(@ApplicationContext private val context: Context) : DeviceTool {
    override val name = "set_timer"
    override val description = "Start a countdown timer in the system clock app."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.WRITE
    override val parameters = schema {
        integer("seconds", "Duration in seconds (1–86400)", required = true)
        string("label", "Timer label")
    }

    override suspend fun execute(args: JsonObject): String {
        val seconds = args.int("seconds")?.takeIf { it in 1..86_400 } ?: throw ToolException("'seconds' must be 1–86400.")
        val intent = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        args.str("label")?.let { intent.putExtra(AlarmClock.EXTRA_MESSAGE, it) }
        if (intent.resolveActivity(context.packageManager) == null) throw ToolException("No clock app handles timers.")
        context.startActivity(intent)
        return "Timer started: ${seconds}s."
    }
}

class TakePhotoTool @Inject constructor(
    @ApplicationContext private val context: Context,
    private val broker: UiBroker,
) : DeviceTool {
    override val name = "take_photo"
    override val description = "Open the camera for the owner to take a photo; returns the saved image path."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.WRITE
    override val parameters = schema { boolean("front", "Prefer the front camera") }

    override fun requiredPermissions(args: JsonObject) = listOf(Manifest.permission.CAMERA)

    override suspend fun execute(args: JsonObject): String {
        val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "LCDR").apply { mkdirs() }
        val file = File(dir, "IMG_${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val taken = broker.takePhoto(uri, args.bool("front") == true)
        if (!taken || !file.exists() || file.length() == 0L) {
            file.delete()
            throw ToolException("No photo taken.")
        }
        return "Photo saved: ${file.absolutePath}"
    }
}

class GetClipboardTool @Inject constructor(@ApplicationContext private val context: Context) : DeviceTool {
    override val name = "get_clipboard"
    override val description = "Read the clipboard text (works while LCDR is in the foreground)."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.READ
    override val parameters = schema()

    override suspend fun execute(args: JsonObject): String = withContext(Dispatchers.Main) {
        val clip = context.getSystemService(ClipboardManager::class.java).primaryClip
        clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.ifEmpty { null }
            ?: "Clipboard is empty (or unreadable while LCDR is in the background)."
    }
}

class SetClipboardTool @Inject constructor(@ApplicationContext private val context: Context) : DeviceTool {
    override val name = "set_clipboard"
    override val description = "Copy text to the clipboard."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.WRITE
    override val parameters = schema { string("text", "Text to copy", required = true) }

    override suspend fun execute(args: JsonObject): String = withContext(Dispatchers.Main) {
        context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("LCDR", args.requireStr("text")))
        "Copied to clipboard."
    }
}

class SendNotificationTool @Inject constructor(@ApplicationContext private val context: Context) : DeviceTool {
    override val name = "send_notification"
    override val description = "Post a local notification on this device."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.WRITE
    override val parameters = schema {
        string("title", "Title", required = true)
        string("body", "Body text", required = true)
    }

    override fun requiredPermissions(args: JsonObject) =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()

    override suspend fun execute(args: JsonObject): String {
        val posted = Notifications.post(
            context, (System.currentTimeMillis() % Int.MAX_VALUE).toInt(), Notifications.CHANNEL_GENERAL,
            args.requireStr("title"), args.requireStr("body"),
        )
        return if (posted) "Notification posted." else throw ToolException("Notifications are blocked.")
    }
}

class GetRunningAppsTool @Inject constructor(private val status: DeviceStatus) : DeviceTool {
    override val name = "get_running_apps"
    override val description = "Apps used recently (foreground usage), most recent first."
    override val category = ToolCategory.SYSTEM
    override val risk = ToolRisk.READ
    override val parameters = schema { integer("minutes", "Look-back window in minutes (default 60)") }

    override fun specialAccess(args: JsonObject) = SpecialAccess.USAGE_STATS

    override suspend fun execute(args: JsonObject): String {
        val window = (args.int("minutes") ?: 60).coerceIn(1, 7 * 24 * 60) * 60_000L
        val apps = status.recentApps(window)
        if (apps.isEmpty()) return "No app usage in that window."
        return apps.take(25).joinToString("\n") {
            "${it.label} (${it.packageName}) — last used ${Formatting.millis(it.lastUsed)}, ${it.foregroundMs / 60_000} min in foreground"
        }
    }
}
