package com.lcdr.assistant.ui.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lcdr.assistant.data.prefs.SettingsStore
import com.lcdr.assistant.data.prefs.VoiceMode
import com.lcdr.assistant.data.repo.ChatEvent
import com.lcdr.assistant.data.repo.ChatRepository
import com.lcdr.assistant.tools.PermissionRationale
import com.lcdr.assistant.tools.UiBroker
import com.lcdr.assistant.ui.common.userMessage
import com.lcdr.assistant.voice.PipelineVoice
import com.lcdr.assistant.voice.RealtimeVoiceClient
import com.lcdr.assistant.voice.SpeechInput
import com.lcdr.assistant.voice.SpeechOutput
import com.lcdr.assistant.voice.Transcript
import com.lcdr.assistant.voice.VoiceSessionService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import javax.inject.Inject

enum class VoicePhase(val label: String) {
    IDLE("Tap to talk"),
    CONNECTING("Connecting…"),
    LISTENING("Listening"),
    THINKING("Working"),
    SPEAKING("Speaking"),
    LIVE("Live"),
}

@HiltViewModel
class VoiceViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val settings: SettingsStore,
    private val chat: ChatRepository,
    private val broker: UiBroker,
    private val speechIn: SpeechInput,
    private val speechOut: SpeechOutput,
    private val pipeline: PipelineVoice,
    private val realtime: RealtimeVoiceClient,
) : ViewModel() {

    val mode: VoiceMode get() = settings.current.voiceMode
    var phase by mutableStateOf(VoicePhase.IDLE); private set
    var partial by mutableStateOf(""); private set
    var level by mutableStateOf(0f); private set
    var error by mutableStateOf<String?>(null); private set
    var muted by mutableStateOf(false); private set
    val transcript = mutableStateListOf<Transcript>()

    private var session: Job? = null
    private var conversationId: Long? = null

    init {
        viewModelScope.launch { VoiceSessionService.stops.collect { stop() } }
        viewModelScope.launch { realtime.transcripts.collect { transcript += it } }
        viewModelScope.launch { realtime.errors.collect { error = it } }
        viewModelScope.launch { realtime.connected.collect { if (it && mode == VoiceMode.REALTIME) phase = VoicePhase.LIVE } }
    }

    var active by mutableStateOf(false); private set

    fun toggle() = if (active) stop() else start()

    fun start() {
        if (active) return
        error = null
        active = true
        session = viewModelScope.launch {
            if (!ensureMic()) {
                error = "Microphone permission is required for voice."
                return@launch
            }
            VoiceSessionService.start(context, mode.label)
            try {
                when (mode) {
                    VoiceMode.REALTIME -> {
                        phase = VoicePhase.CONNECTING
                        realtime.connect()
                        realtime.setMuted(muted)
                        kotlinx.coroutines.awaitCancellation()
                    }
                    else -> conversationLoop()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                realtime.disconnect()
                speechOut.stop()
                VoiceSessionService.stop(context)
                phase = VoicePhase.IDLE
                partial = ""
            }
        }.also { job -> job.invokeOnCompletion { active = false } }
    }

    fun stop() {
        session?.cancel()
        session = null
    }

    fun toggleMute() {
        muted = !muted
        realtime.setMuted(muted)
    }

    private suspend fun ensureMic(): Boolean {
        val perm = Manifest.permission.RECORD_AUDIO
        if (granted(perm)) return true
        broker.requestPermissions(listOf(perm), PermissionRationale.explain(listOf(perm)))
        return granted(perm)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    /** Listen → think (with device tools) → speak, until stopped. */
    private suspend fun conversationLoop() {
        var misses = 0
        while (true) {
            phase = VoicePhase.LISTENING
            partial = ""
            val heard = listen()
            if (heard.isNullOrBlank()) {
                // Stop after a stretch of silence rather than listening forever.
                if (++misses >= 3) return
                continue
            }
            misses = 0
            transcript += Transcript("user", heard)
            partial = ""

            phase = VoicePhase.THINKING
            val id = conversationId ?: chat.createConversation(
                "Voice " + LocalDateTime.now().format(DateTimeFormatter.ofPattern("MMM d HH:mm"))
            ).id.also { conversationId = it }

            var reply = ""
            chat.send(id, heard).collect { event ->
                when (event) {
                    is ChatEvent.Token -> { reply += event.text; partial = reply }
                    is ChatEvent.ToolStarted -> transcript += Transcript("tool", "→ ${event.name}")
                    is ChatEvent.Done -> reply = event.text.ifBlank { reply }
                    is ChatEvent.Failed -> error = event.message
                    is ChatEvent.ToolFinished -> Unit
                }
            }
            partial = ""
            if (reply.isNotBlank()) {
                transcript += Transcript("assistant", reply)
                if (settings.current.speakReplies) {
                    phase = VoicePhase.SPEAKING
                    if (mode == VoiceMode.PIPELINE) {
                        runCatching { pipeline.speak(reply) }.onFailure { if (it is CancellationException) throw it; speechOut.speak(reply) }
                    } else {
                        speechOut.speak(reply)
                    }
                }
            }
        }
    }

    private suspend fun listen(): String? = when (mode) {
        VoiceMode.PIPELINE -> pipeline.recordUtterance(onLevel = { level = it })?.let { file ->
            phase = VoicePhase.THINKING
            pipeline.transcribe(file)
        }
        else -> speechIn.listenOnce(preferOffline = true, onPartial = { partial = it }, onLevel = { level = it })
    }

    override fun onCleared() {
        stop()
        realtime.disconnect()
        VoiceSessionService.stop(context)
    }
}
