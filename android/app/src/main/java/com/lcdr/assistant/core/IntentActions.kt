package com.lcdr.assistant.core

object IntentActions {
    /** Open straight into voice input (quick tile, voice notification). */
    const val ACTION_VOICE = "com.lcdr.assistant.action.VOICE"
    /** Open chat with the daily briefing conversation loaded. */
    const val ACTION_BRIEFING = "com.lcdr.assistant.action.BRIEFING"
    const val EXTRA_CONVERSATION_ID = "conversation_id"
}
