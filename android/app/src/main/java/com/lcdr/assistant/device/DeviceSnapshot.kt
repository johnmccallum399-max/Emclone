package com.lcdr.assistant.device

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.lcdr.assistant.tools.CalendarEvent
import com.lcdr.assistant.tools.CalendarRepository
import com.lcdr.assistant.tools.ContactsRepository
import com.lcdr.assistant.tools.DeviceStatus
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

data class SmsThreadPreview(val address: String, val name: String?, val snippet: String, val date: Long, val unread: Boolean)

data class DeviceSnapshotData(
    val battery: String,
    val smsGranted: Boolean,
    val threads: List<SmsThreadPreview>,
    val calendarGranted: Boolean,
    val events: List<CalendarEvent>,
)

/** Read-only data for the Device dashboard. Never prompts for permissions. */
@Singleton
class DeviceSnapshot @Inject constructor(
    @ApplicationContext private val context: Context,
    private val status: DeviceStatus,
    private val calendar: CalendarRepository,
    private val contacts: ContactsRepository,
) {
    suspend fun load(): DeviceSnapshotData = withContext(Dispatchers.IO) {
        val sms = granted(Manifest.permission.READ_SMS)
        val cal = granted(Manifest.permission.READ_CALENDAR)
        DeviceSnapshotData(
            battery = status.battery(),
            smsGranted = sms,
            threads = if (sms) runCatching { recentThreads() }.getOrDefault(emptyList()) else emptyList(),
            calendarGranted = cal,
            events = if (cal) runCatching { calendar.today() }.getOrDefault(emptyList()) else emptyList(),
        )
    }

    private fun recentThreads(limit: Int = 6): List<SmsThreadPreview> {
        val canName = granted(Manifest.permission.READ_CONTACTS)
        val seen = linkedMapOf<String, SmsThreadPreview>()
        context.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.READ, Telephony.Sms.TYPE),
            null, null, "${Telephony.Sms.DATE} DESC LIMIT 200",
        )?.use { c ->
            while (c.moveToNext() && seen.size < limit) {
                val address = c.getString(0) ?: continue
                if (address in seen) continue
                seen[address] = SmsThreadPreview(
                    address = address,
                    name = if (canName) contacts.nameForNumber(address) else null,
                    snippet = c.getString(1).orEmpty(),
                    date = c.getLong(2),
                    unread = c.getInt(3) == 0 && c.getInt(4) == Telephony.Sms.MESSAGE_TYPE_INBOX,
                )
            }
        }
        return seen.values.toList()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
}
