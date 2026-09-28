package com.lcdr.assistant.briefing

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.lcdr.assistant.core.IntentActions
import com.lcdr.assistant.core.Notifications
import com.lcdr.assistant.data.auth.TokenStore
import com.lcdr.assistant.data.prefs.ContextToggles
import com.lcdr.assistant.data.repo.ChatEvent
import com.lcdr.assistant.data.repo.ChatRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Composes the daily briefing through the normal chat pipeline (so it gets
 * memory, calendar/location context and web_search for weather) and posts
 * it as an expandable notification that opens the conversation.
 */
@HiltWorker
class BriefingWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val tokens: TokenStore,
    private val chat: ChatRepository,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        try {
            if (tokens.token.value == null) return Result.success()

            val today = LocalDate.now().format(DateTimeFormatter.ofPattern("EEE MMM d"))
            val conversation = chat.createConversation("Briefing — $today")
            var text = ""
            var failure: String? = null
            chat.send(
                conversation.id,
                PROMPT,
                ContextToggles(time = true, battery = true, location = true, activeApp = false, calendar = true),
            ).collect { event ->
                when (event) {
                    is ChatEvent.Token -> text += event.text
                    is ChatEvent.Done -> text = event.text.ifBlank { text }
                    is ChatEvent.Failed -> failure = event.message
                    else -> Unit
                }
            }
            if (text.isBlank()) {
                return if (runAttemptCount < 2) Result.retry() else Result.failure().also { failure?.let { notifyFailure(it) } }
            }

            Notifications.post(
                applicationContext,
                Notifications.ID_BRIEFING,
                Notifications.CHANNEL_BRIEFING,
                "Briefing — $today",
                text.trim(),
                Notifications.openAppIntent(applicationContext) {
                    action = IntentActions.ACTION_BRIEFING
                    putExtra(IntentActions.EXTRA_CONVERSATION_ID, conversation.id)
                },
            )
            return Result.success()
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            return if (runAttemptCount < 2) Result.retry() else Result.failure()
        }
    }

    private fun notifyFailure(message: String) {
        Notifications.post(applicationContext, Notifications.ID_BRIEFING, Notifications.CHANNEL_BRIEFING, "Briefing failed", message)
    }

    companion object {
        const val PROMPT = """Compose my daily briefing. Cover, in this order and only if there is something to say:
1. Today's calendar (from device context) with anything that needs prep.
2. Weather for my location today — use web_search.
3. Anything from long-term memory that's relevant today (deadlines, birthdays, commitments).
4. Unread texts that look like they need a reply — use read_sms with unread_only.
Terse, scannable, no preamble. Plain text, short lines, no markdown headers."""
    }
}
