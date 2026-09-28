package com.lcdr.assistant.voice

import android.content.Context
import android.media.AudioManager
import com.lcdr.assistant.data.remote.LcdrApi
import com.lcdr.assistant.tools.ClientToolCall
import com.lcdr.assistant.tools.ToolDispatcher
import com.lcdr.assistant.tools.ToolRegistry
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class Transcript(val role: String, val text: String)

/**
 * OpenAI Realtime over raw WebRTC. The backend mints an ephemeral key (the
 * real API key never touches the device); device tools are exposed to the
 * realtime model via session.update and run through the same dispatcher.
 */
@Singleton
class RealtimeVoiceClient @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: LcdrApi,
    private val registry: ToolRegistry,
    private val dispatcher: ToolDispatcher,
    private val json: Json,
) {
    private val _connected = MutableStateFlow(false)
    val connected = _connected.asStateFlow()
    private val _transcripts = MutableSharedFlow<Transcript>(extraBufferCapacity = 64)
    val transcripts = _transcripts.asSharedFlow()
    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val errors = _errors.asSharedFlow()

    private var scope: CoroutineScope? = null
    private var factory: PeerConnectionFactory? = null
    private var audioModule: JavaAudioDeviceModule? = null
    private var peer: PeerConnection? = null
    private var channel: DataChannel? = null
    private var micTrack: AudioTrack? = null

    // Plain client: the shared one rewrites every host to the backend.
    private val http = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).build()

    suspend fun connect() {
        disconnect()
        val sessionScope = CoroutineScope(SupervisorJob() + Dispatchers.Default).also { scope = it }
        val session = api.realtimeSession()

        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions())
        val adm = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .createAudioDeviceModule().also { audioModule = it }
        val f = PeerConnectionFactory.builder().setAudioDeviceModule(adm).createPeerConnectionFactory().also { factory = it }

        context.getSystemService(AudioManager::class.java).apply {
            mode = AudioManager.MODE_IN_COMMUNICATION
            @Suppress("DEPRECATION")
            isSpeakerphoneOn = true
        }

        val config = PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN }
        val pc = f.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED -> _connected.value = true
                    PeerConnection.IceConnectionState.FAILED, PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.CLOSED -> _connected.value = false
                    else -> Unit
                }
            }
            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(candidate: IceCandidate?) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dc: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
        }) ?: throw IllegalStateException("Could not create peer connection")
        peer = pc

        val source = f.createAudioSource(MediaConstraints())
        micTrack = f.createAudioTrack("lcdr-mic", source).also { pc.addTrack(it, listOf("lcdr")) }

        val dc = pc.createDataChannel("oai-events", DataChannel.Init())
        channel = dc
        dc.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {}
            override fun onStateChange() {
                if (dc.state() == DataChannel.State.OPEN) sendSessionUpdate()
            }
            override fun onMessage(buffer: DataChannel.Buffer) {
                val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
                val event = runCatching { json.parseToJsonElement(String(bytes)).jsonObject }.getOrNull() ?: return
                sessionScope.launch { handle(event) }
            }
        })

        val offer = pc.awaitSdp { obs -> pc.createOffer(obs, MediaConstraints()) }
        pc.awaitSet { obs -> pc.setLocalDescription(obs, offer) }

        val answer = withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("https://api.openai.com/v1/realtime/calls")
                .header("Authorization", "Bearer ${session.clientSecret}")
                .post(offer.description.toRequestBody("application/sdp".toMediaType()))
                .build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("Realtime connect failed (HTTP ${response.code})")
                response.body?.string() ?: throw IllegalStateException("Empty SDP answer")
            }
        }
        pc.awaitSet { obs -> pc.setRemoteDescription(obs, SessionDescription(SessionDescription.Type.ANSWER, answer)) }
    }

    fun setMuted(muted: Boolean) {
        micTrack?.setEnabled(!muted)
    }

    fun disconnect() {
        scope?.cancel(); scope = null
        runCatching { channel?.close() }; channel = null
        runCatching { peer?.close() }; peer = null
        runCatching { factory?.dispose() }; factory = null
        runCatching { audioModule?.release() }; audioModule = null
        micTrack = null
        _connected.value = false
        context.getSystemService(AudioManager::class.java).mode = AudioManager.MODE_NORMAL
    }

    private fun sendSessionUpdate() {
        send(buildJsonObject {
            put("type", "session.update")
            putJsonObject("session") {
                put("type", "realtime")
                put("tool_choice", "auto")
                putJsonArray("tools") {
                    registry.clientToolDefinitions().forEach { tool ->
                        add(buildJsonObject {
                            put("type", "function")
                            put("name", tool.name)
                            put("description", tool.description)
                            put("parameters", tool.parameters)
                        })
                    }
                }
            }
        })
    }

    private suspend fun handle(event: JsonObject) {
        fun s(key: String) = event[key]?.jsonPrimitive?.contentOrNull
        when (s("type")) {
            "conversation.item.input_audio_transcription.completed" ->
                s("transcript")?.takeIf { it.isNotBlank() }?.let { _transcripts.emit(Transcript("user", it.trim())) }
            "response.audio_transcript.done", "response.output_audio_transcript.done" ->
                s("transcript")?.takeIf { it.isNotBlank() }?.let { _transcripts.emit(Transcript("assistant", it.trim())) }
            "response.function_call_arguments.done" -> {
                val callId = s("call_id") ?: return
                val name = s("name") ?: return
                val args = runCatching { json.parseToJsonElement(s("arguments") ?: "{}").jsonObject }.getOrElse { JsonObject(emptyMap()) }
                _transcripts.emit(Transcript("tool", "→ $name"))
                val outcome = dispatcher.execute(conversationId = 0, call = ClientToolCall(callId, name, args))
                send(buildJsonObject {
                    put("type", "conversation.item.create")
                    putJsonObject("item") {
                        put("type", "function_call_output")
                        put("call_id", callId)
                        put("output", outcome.result)
                    }
                })
                send(buildJsonObject { put("type", "response.create") })
            }
            "error" -> _errors.emit(
                (event["error"] as? JsonObject)?.get("message")?.jsonPrimitive?.contentOrNull ?: "Realtime error"
            )
        }
    }

    private fun send(event: JsonObject) {
        val bytes = event.toString().toByteArray()
        channel?.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
    }
}

private suspend fun PeerConnection.awaitSdp(start: (SdpObserver) -> Unit): SessionDescription =
    suspendCancellableCoroutine { cont ->
        start(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription) { cont.resume(sdp) }
            override fun onCreateFailure(error: String?) { cont.resumeWithException(IllegalStateException("SDP create failed: $error")) }
            override fun onSetSuccess() {}
            override fun onSetFailure(error: String?) {}
        })
    }

private suspend fun PeerConnection.awaitSet(start: (SdpObserver) -> Unit): Unit =
    suspendCancellableCoroutine { cont ->
        start(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription?) {}
            override fun onCreateFailure(error: String?) {}
            override fun onSetSuccess() { cont.resume(Unit) }
            override fun onSetFailure(error: String?) { cont.resumeWithException(IllegalStateException("SDP set failed: $error")) }
        })
    }
