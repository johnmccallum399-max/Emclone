package com.lcdr.assistant.core

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.lcdr.assistant.MainActivity
import com.lcdr.assistant.R

object Notifications {
    const val CHANNEL_VOICE = "voice"
    const val CHANNEL_BRIEFING = "briefing"
    const val CHANNEL_GENERAL = "general"

    const val ID_VOICE = 1001
    const val ID_BRIEFING = 1002

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(CHANNEL_VOICE, "Voice session", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Shown while LCDR is listening" },
                NotificationChannel(CHANNEL_BRIEFING, "Daily briefing", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CHANNEL_GENERAL, "LCDR notifications", NotificationManager.IMPORTANCE_HIGH),
            )
        )
    }

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun openAppIntent(context: Context, configure: Intent.() -> Unit = {}): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            configure()
        }
        return PendingIntent.getActivity(
            context,
            intent.action.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /** Returns false if notifications are not permitted. */
    fun post(context: Context, id: Int, channel: String, title: String, body: String, tap: PendingIntent? = null): Boolean {
        if (!canPost(context)) return false
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_lcdr)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(tap ?: openAppIntent(context))
            .build()
        @Suppress("MissingPermission")
        NotificationManagerCompat.from(context).notify(id, notification)
        return true
    }
}
