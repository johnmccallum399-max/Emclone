package com.lcdr.assistant.data.prefs

import android.content.Context
import androidx.core.content.edit
import com.lcdr.assistant.BuildConfig
import com.lcdr.assistant.core.Persona
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class VoiceMode(val label: String) {
    ON_DEVICE("On-device (offline STT/TTS)"),
    PIPELINE("Pipeline (Whisper + OpenAI TTS)"),
    REALTIME("Realtime (WebRTC)"),
}

/** Which live context is injected into each message. */
data class ContextToggles(
    val time: Boolean = true,
    val battery: Boolean = true,
    val location: Boolean = false,
    val activeApp: Boolean = false,
    val calendar: Boolean = true,
)

data class AppSettings(
    val backendUrl: String = BuildConfig.BACKEND_URL,
    val personaName: String = Persona.DEFAULT_NAME,
    /** Empty = use the built-in base identity. */
    val systemPromptOverride: String = "",
    val ownerName: String = "",
    val voiceMode: VoiceMode = VoiceMode.ON_DEVICE,
    val speakReplies: Boolean = true,
    val disabledTools: Set<String> = emptySet(),
    val context: ContextToggles = ContextToggles(),
    val biometricLock: Boolean = false,
    val briefingEnabled: Boolean = false,
    /** Minutes after midnight, local time. */
    val briefingMinuteOfDay: Int = 7 * 60,
) {
    fun systemPrompt(): String =
        systemPromptOverride.ifBlank { Persona.baseIdentity(personaName, ownerName.ifBlank { null }) }
}

/**
 * Plain SharedPreferences (nothing secret lives here) exposed as a StateFlow
 * so it can be read synchronously, e.g. from the OkHttp base-URL interceptor.
 */
@Singleton
class SettingsStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs = context.getSharedPreferences("lcdr_settings", Context.MODE_PRIVATE)
    private val _settings = MutableStateFlow(load())
    val settings: StateFlow<AppSettings> = _settings.asStateFlow()
    val current: AppSettings get() = _settings.value

    fun update(transform: (AppSettings) -> AppSettings) {
        val next = transform(_settings.value)
        save(next)
        _settings.value = next
    }

    fun isToolEnabled(name: String) = name !in current.disabledTools

    private fun load(): AppSettings {
        val d = AppSettings()
        return AppSettings(
            backendUrl = prefs.getString("backendUrl", null) ?: d.backendUrl,
            personaName = prefs.getString("personaName", null) ?: d.personaName,
            systemPromptOverride = prefs.getString("systemPromptOverride", null) ?: "",
            ownerName = prefs.getString("ownerName", null) ?: "",
            voiceMode = prefs.getString("voiceMode", null)
                ?.let { runCatching { VoiceMode.valueOf(it) }.getOrNull() } ?: d.voiceMode,
            speakReplies = prefs.getBoolean("speakReplies", d.speakReplies),
            disabledTools = prefs.getStringSet("disabledTools", null)?.toSet() ?: emptySet(),
            context = ContextToggles(
                time = prefs.getBoolean("ctx.time", d.context.time),
                battery = prefs.getBoolean("ctx.battery", d.context.battery),
                location = prefs.getBoolean("ctx.location", d.context.location),
                activeApp = prefs.getBoolean("ctx.activeApp", d.context.activeApp),
                calendar = prefs.getBoolean("ctx.calendar", d.context.calendar),
            ),
            biometricLock = prefs.getBoolean("biometricLock", false),
            briefingEnabled = prefs.getBoolean("briefingEnabled", false),
            briefingMinuteOfDay = prefs.getInt("briefingMinuteOfDay", d.briefingMinuteOfDay),
        )
    }

    private fun save(s: AppSettings) = prefs.edit {
        putString("backendUrl", s.backendUrl.trim().trimEnd('/'))
        putString("personaName", s.personaName)
        putString("systemPromptOverride", s.systemPromptOverride)
        putString("ownerName", s.ownerName)
        putString("voiceMode", s.voiceMode.name)
        putBoolean("speakReplies", s.speakReplies)
        putStringSet("disabledTools", s.disabledTools)
        putBoolean("ctx.time", s.context.time)
        putBoolean("ctx.battery", s.context.battery)
        putBoolean("ctx.location", s.context.location)
        putBoolean("ctx.activeApp", s.context.activeApp)
        putBoolean("ctx.calendar", s.context.calendar)
        putBoolean("biometricLock", s.biometricLock)
        putBoolean("briefingEnabled", s.briefingEnabled)
        putInt("briefingMinuteOfDay", s.briefingMinuteOfDay)
    }
}
