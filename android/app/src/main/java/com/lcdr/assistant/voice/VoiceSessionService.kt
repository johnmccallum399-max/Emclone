package com.lcdr.assistant.voice

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.lcdr.assistant.R
import com.lcdr.assistant.core.IntentActions
import com.lcdr.assistant.core.Notifications
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Keeps the microphone alive (and visible to the owner via a persistent
 * notification) while a voice session runs, including with the screen off.
 */
class VoiceSessionService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopRequests.tryEmit(Unit)
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val stop = android.app.PendingIntent.getService(
            this, 0, Intent(this, VoiceSessionService::class.java).setAction(ACTION_STOP),
            android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, Notifications.CHANNEL_VOICE)
            .setSmallIcon(R.drawable.ic_lcdr)
            .setContentTitle("LCDR is listening")
            .setContentText(intent?.getStringExtra(EXTRA_MODE) ?: "Voice session active")
            .setOngoing(true)
            .setContentIntent(Notifications.openAppIntent(this) { action = IntentActions.ACTION_VOICE })
            .addAction(0, "Stop", stop)
            .build()

        ServiceCompat.startForeground(
            this, Notifications.ID_VOICE, notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0,
        )
        return START_NOT_STICKY
    }

    companion object {
        private const val ACTION_STOP = "com.lcdr.assistant.voice.STOP"
        private const val EXTRA_MODE = "mode"

        /** Fires when the owner taps Stop on the notification. */
        private val stopRequests = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
        val stops = stopRequests.asSharedFlow()

        fun start(context: Context, modeLabel: String) {
            val intent = Intent(context, VoiceSessionService::class.java).putExtra(EXTRA_MODE, modeLabel)
            androidx.core.content.ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, VoiceSessionService::class.java))
        }
    }
}
