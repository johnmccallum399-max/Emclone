package com.lcdr.assistant.device

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.lcdr.assistant.data.prefs.ContextToggles
import com.lcdr.assistant.tools.CalendarRepository
import com.lcdr.assistant.tools.DeviceStatus
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Layer 3 of the system prompt: live device state, rebuilt for every
 * message. Only uses permissions already granted — never prompts.
 */
@Singleton
class DeviceContextProvider @Inject constructor(
    @ApplicationContext private val context: Context,
    private val status: DeviceStatus,
    private val calendar: CalendarRepository,
) {
    suspend fun build(toggles: ContextToggles): String = withContext(Dispatchers.IO) {
        buildList {
            if (toggles.time) {
                add("Time: " + ZonedDateTime.now().format(DateTimeFormatter.ofPattern("EEEE yyyy-MM-dd HH:mm zzz")))
            }
            if (toggles.battery) add("Battery: ${status.battery()}")
            if (toggles.location) {
                status.lastKnownLocation()?.let { loc ->
                    val place = status.describe(loc)
                    add("Location: %.4f, %.4f".format(loc.latitude, loc.longitude) + (place?.let { " ($it)" } ?: ""))
                }
            }
            if (toggles.activeApp) status.foregroundApp()?.let { add("Last app in use: $it") }
            if (toggles.calendar && granted(Manifest.permission.READ_CALENDAR)) {
                val events = runCatching { calendar.today() }.getOrDefault(emptyList())
                add(
                    if (events.isEmpty()) "Calendar today: nothing scheduled"
                    else "Calendar today:\n" + events.joinToString("\n") { "  " + calendar.format(it) }
                )
            }
        }.joinToString("\n")
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
}
