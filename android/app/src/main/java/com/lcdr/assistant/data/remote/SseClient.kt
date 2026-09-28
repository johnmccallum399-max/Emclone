package com.lcdr.assistant.data.remote

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

class HttpStatusException(val code: Int, message: String) : IOException(message)

/**
 * POST + text/event-stream via OkHttp's EventSource. The backend frames each
 * event as `data: {json}`; every frame is emitted as a parsed JsonObject.
 */
@Singleton
class SseClient @Inject constructor(client: OkHttpClient, private val json: Json) {

    // Model turns (and hub runs) can take minutes; no read timeout between frames.
    private val streamingClient = client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private val factory = EventSources.createFactory(streamingClient)

    fun <T> post(path: String, body: T, serializer: kotlinx.serialization.KSerializer<T>): Flow<JsonObject> =
        callbackFlow {
            val request = Request.Builder()
                .url(BaseUrlInterceptor.PLACEHOLDER + path)
                .header("Accept", "text/event-stream")
                .post(json.encodeToString(serializer, body).toRequestBody(JSON))
                .build()

            val source = factory.newEventSource(request, object : EventSourceListener() {
                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    runCatching { json.parseToJsonElement(data).jsonObject }.onSuccess { trySend(it) }
                }

                override fun onClosed(eventSource: EventSource) {
                    channel.close()
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    val error = when {
                        response != null && !response.isSuccessful -> HttpStatusException(
                            response.code,
                            "HTTP ${response.code}: ${runCatching { response.body?.string() }.getOrNull().orEmpty().take(300)}",
                        )
                        else -> t ?: IOException("Stream failed")
                    }
                    channel.close(error)
                }
            })
            awaitClose { source.cancel() }
        }

    private companion object {
        val JSON = "application/json".toMediaType()
    }
}
