package com.lcdr.assistant.tools

import android.Manifest

/** Plain-language reasons shown before each runtime permission dialog. */
object PermissionRationale {
    private val reasons = mapOf(
        Manifest.permission.READ_SMS to "read your text messages when you ask about them",
        Manifest.permission.SEND_SMS to "send texts you've approved",
        Manifest.permission.READ_CONTACTS to "look up people by name or number",
        Manifest.permission.WRITE_CONTACTS to "add or update contacts you ask for",
        Manifest.permission.READ_CALENDAR to "see your events",
        Manifest.permission.WRITE_CALENDAR to "create or delete events you ask for",
        Manifest.permission.ACCESS_FINE_LOCATION to "tell you where you are and use it for local answers",
        Manifest.permission.ACCESS_COARSE_LOCATION to "know roughly where you are",
        Manifest.permission.CAMERA to "take photos when you ask",
        Manifest.permission.RECORD_AUDIO to "hear you in voice mode",
        Manifest.permission.READ_EXTERNAL_STORAGE to "read files you point it at",
        Manifest.permission.WRITE_EXTERNAL_STORAGE to "write files you ask for",
        "android.permission.POST_NOTIFICATIONS" to "post reminders and your daily briefing",
    )

    fun explain(permissions: List<String>): String {
        val lines = permissions.mapNotNull { reasons[it] }.distinct()
        return if (lines.isEmpty()) "LCDR needs this permission to complete the request."
        else "LCDR needs this to " + lines.joinToString("; ") + "."
    }
}
