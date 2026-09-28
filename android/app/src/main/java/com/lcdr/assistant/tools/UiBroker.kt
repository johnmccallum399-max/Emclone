package com.lcdr.assistant.tools

import android.net.Uri
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

sealed interface UiRequest {
    val result: CompletableDeferred<Boolean>

    class Permissions(val permissions: List<String>, val rationale: String, override val result: CompletableDeferred<Boolean>) : UiRequest
    class Special(val access: SpecialAccess, override val result: CompletableDeferred<Boolean>) : UiRequest
    class Confirm(val tool: String, val message: String, override val result: CompletableDeferred<Boolean>) : UiRequest
    class TakePhoto(val output: Uri, val frontCamera: Boolean, override val result: CompletableDeferred<Boolean>) : UiRequest
}

/**
 * Lets tools (which live in the data layer) ask the foreground Activity for
 * things only an Activity can do: permission dialogs, confirmations, camera.
 * When no Activity is in the foreground (e.g. the briefing worker) requests
 * fail immediately instead of hanging.
 */
@Singleton
class UiBroker @Inject constructor() {
    private val channel = Channel<UiRequest>(Channel.UNLIMITED)
    val requests: Flow<UiRequest> = channel.receiveAsFlow()

    private val foregroundActivities = AtomicInteger(0)
    val hasForegroundUi: Boolean get() = foregroundActivities.get() > 0

    fun onActivityStarted() { foregroundActivities.incrementAndGet() }
    fun onActivityStopped() { foregroundActivities.decrementAndGet() }

    private suspend fun send(build: (CompletableDeferred<Boolean>) -> UiRequest): Boolean {
        if (!hasForegroundUi) return false
        val deferred = CompletableDeferred<Boolean>()
        channel.send(build(deferred))
        return deferred.await()
    }

    suspend fun requestPermissions(permissions: List<String>, rationale: String) =
        send { UiRequest.Permissions(permissions, rationale, it) }

    suspend fun requestSpecialAccess(access: SpecialAccess) = send { UiRequest.Special(access, it) }

    suspend fun confirm(tool: String, message: String) = send { UiRequest.Confirm(tool, message, it) }

    suspend fun takePhoto(output: Uri, frontCamera: Boolean) = send { UiRequest.TakePhoto(output, frontCamera, it) }
}
