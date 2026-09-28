package com.lcdr.assistant.briefing

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.lcdr.assistant.data.prefs.SettingsStore
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 24h periodic work whose first run is anchored to the chosen clock time.
 * Changing the time re-enqueues so the anchor moves with it.
 */
@Singleton
class BriefingScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val settings: SettingsStore,
) {
    private val workManager get() = WorkManager.getInstance(context)

    private val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /**
     * Applies the current setting: (re)schedules, or cancels. [replace] = false
     * keeps an already-scheduled run (app start), so a late run isn't skipped.
     */
    fun reschedule(replace: Boolean = true) {
        if (!settings.current.briefingEnabled) {
            workManager.cancelUniqueWork(UNIQUE)
            return
        }
        val minute = settings.current.briefingMinuteOfDay
        val now = LocalDateTime.now()
        var next = LocalDate.now().atTime(LocalTime.of(minute / 60, minute % 60))
        if (!next.isAfter(now)) next = next.plusDays(1)

        workManager.enqueueUniquePeriodicWork(
            UNIQUE,
            if (replace) ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE else ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<BriefingWorker>(24, TimeUnit.HOURS)
                .setInitialDelay(Duration.between(now, next).toMillis(), TimeUnit.MILLISECONDS)
                .setConstraints(constraints)
                .build(),
        )
    }

    fun runNow() {
        workManager.enqueueUniqueWork(
            "$UNIQUE-now",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<BriefingWorker>().setConstraints(constraints).build(),
        )
    }

    private companion object {
        const val UNIQUE = "daily-briefing"
    }
}

/** WorkManager survives reboots; re-applying re-anchors the run time after clock or timezone changes. */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {
    @Inject lateinit var scheduler: BriefingScheduler

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) scheduler.reschedule()
    }
}
