package com.lcdr.assistant.voice

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import com.lcdr.assistant.data.remote.LcdrApi
import com.lcdr.assistant.data.remote.SpeakRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.math.log10

/**
 * "Pipeline" mode: record locally, transcribe via backend Whisper, speak via
 * backend OpenAI TTS. Recording stops after [silenceMs] of quiet following speech.
 */
@Singleton
class PipelineVoice @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: LcdrApi,
) {
    suspend fun recordUtterance(
        onLevel: (Float) -> Unit = {},
        silenceMs: Long = 1_400,
        maxMs: Long = 60_000,
    ): File? = withContext(Dispatchers.IO) {
        val file = File(context.cacheDir, "utterance.m4a").apply { delete() }
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            recorder.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioSamplingRate(16_000)
            recorder.setAudioEncodingBitRate(64_000)
            recorder.setOutputFile(file.absolutePath)
            recorder.prepare()
            recorder.start()

            val started = System.currentTimeMillis()
            var heardSpeech = false
            var lastLoud = started
            while (System.currentTimeMillis() - started < maxMs) {
                delay(100)
                val amp = recorder.maxAmplitude.coerceAtLeast(1)
                val db = (20 * log10(amp / 32767.0)).toFloat()
                onLevel(db)
                val now = System.currentTimeMillis()
                if (db > -30f) { heardSpeech = true; lastLoud = now }
                if (heardSpeech && now - lastLoud > silenceMs) break
                if (!heardSpeech && now - started > 8_000) break
            }
            recorder.stop()
            if (heardSpeech) file else null
        } catch (e: RuntimeException) {
            file.delete()
            if (e is kotlinx.coroutines.CancellationException) throw e
            null
        } finally {
            recorder.release()
        }
    }

    suspend fun transcribe(file: File): String {
        val part = MultipartBody.Part.createFormData("audio", file.name, file.asRequestBody("audio/mp4".toMediaType()))
        return api.transcribe(part).text.trim()
    }

    suspend fun speak(text: String) {
        if (text.isBlank()) return
        val mp3 = File(context.cacheDir, "reply.mp3")
        withContext(Dispatchers.IO) {
            api.speak(SpeakRequest(text.take(4000))).byteStream().use { input -> mp3.outputStream().use { input.copyTo(it) } }
        }
        withContext(Dispatchers.Main) {
            val player = MediaPlayer()
            try {
                suspendCancellableCoroutine { cont ->
                    player.setDataSource(mp3.absolutePath)
                    player.setOnCompletionListener { if (cont.isActive) cont.resume(Unit) }
                    player.setOnErrorListener { _, _, _ -> if (cont.isActive) cont.resume(Unit); true }
                    cont.invokeOnCancellation { runCatching { player.stop() } }
                    player.prepare()
                    player.start()
                }
            } finally {
                player.release()
            }
        }
    }
}
