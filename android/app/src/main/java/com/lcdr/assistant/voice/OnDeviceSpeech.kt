package com.lcdr.assistant.voice

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

class SpeechUnavailableException(message: String) : Exception(message)

/** Android SpeechRecognizer; prefers the on-device recognizer when present (API 31+). */
@Singleton
class SpeechInput @Inject constructor(@ApplicationContext private val context: Context) {

    val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    /**
     * Listens for one utterance. Returns null on silence / no match.
     * [onPartial] receives live partial transcripts; [onLevel] receives RMS dB.
     */
    suspend fun listenOnce(
        preferOffline: Boolean,
        onPartial: (String) -> Unit = {},
        onLevel: (Float) -> Unit = {},
    ): String? = withContext(Dispatchers.Main) {
        if (!available) throw SpeechUnavailableException("No speech recognizer on this device.")
        val recognizer = if (preferOffline && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        ) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            SpeechRecognizer.createSpeechRecognizer(context)
        }
        try {
            suspendCancellableCoroutine<String?> { cont ->
                recognizer.setRecognitionListener(object : RecognitionListener {
                    override fun onResults(results: Bundle?) {
                        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                        if (cont.isActive) cont.resume(text?.takeIf { it.isNotBlank() })
                    }
                    override fun onPartialResults(partial: Bundle?) {
                        partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
                    }
                    override fun onError(error: Int) {
                        if (!cont.isActive) return
                        when (error) {
                            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> cont.resume(null)
                            else -> cont.resumeWith(Result.failure(SpeechUnavailableException("Speech recognition error $error")))
                        }
                    }
                    override fun onRmsChanged(rmsdB: Float) = onLevel(rmsdB)
                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
                cont.invokeOnCancellation { recognizer.cancel() }
                recognizer.startListening(
                    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                        .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
                )
            }
        } finally {
            recognizer.destroy()
        }
    }
}

/** Platform TextToSpeech with a suspend speak() that returns when the utterance finishes. */
@Singleton
class SpeechOutput @Inject constructor(@ApplicationContext private val context: Context) {
    private var tts: TextToSpeech? = null
    private val ready = CompletableDeferred<Boolean>()
    private val pending = mutableMapOf<String, CompletableDeferred<Unit>>()

    private fun ensure(): TextToSpeech = tts ?: TextToSpeech(context) { status ->
        ready.complete(status == TextToSpeech.SUCCESS)
    }.also { engine ->
        tts = engine
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) { synchronized(pending) { pending.remove(utteranceId) }?.complete(Unit) }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { synchronized(pending) { pending.remove(utteranceId) }?.complete(Unit) }
        })
    }

    suspend fun speak(text: String) {
        val engine = withContext(Dispatchers.Main) { ensure() }
        if (!ready.await() || text.isBlank()) return
        engine.language = Locale.getDefault()
        // TTS engines cap utterance length; split on sentence boundaries.
        for (chunk in chunks(text)) {
            val id = UUID.randomUUID().toString()
            val done = CompletableDeferred<Unit>()
            synchronized(pending) { pending[id] = done }
            engine.speak(chunk, TextToSpeech.QUEUE_ADD, null, id)
            try { done.await() } catch (e: kotlinx.coroutines.CancellationException) { engine.stop(); throw e }
        }
    }

    fun stop() { tts?.stop() }

    private fun chunks(text: String): List<String> {
        val max = TextToSpeech.getMaxSpeechInputLength() - 1
        val out = mutableListOf<String>()
        val current = StringBuilder()
        text.split(Regex("(?<=[.!?])\\s+")).forEach { sentence ->
            if (current.length + sentence.length + 1 > max && current.isNotEmpty()) { out += current.toString(); current.clear() }
            current.append(sentence.take(max)).append(' ')
        }
        if (current.isNotBlank()) out += current.toString().trim()
        return out
    }
}
