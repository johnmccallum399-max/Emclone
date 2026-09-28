package com.lcdr.assistant.data.repo

import com.lcdr.assistant.data.remote.CreateHubSessionRequest
import com.lcdr.assistant.data.remote.HubMessageDto
import com.lcdr.assistant.data.remote.InterjectRequest
import com.lcdr.assistant.data.remote.LcdrApi
import com.lcdr.assistant.data.remote.SseClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

sealed interface HubEvent {
    data class Status(val status: String) : HubEvent
    data class TurnStart(val agentName: String, val round: Int) : HubEvent
    data class Message(val message: HubMessageDto) : HubEvent
    data class TurnError(val agentName: String, val message: String) : HubEvent
    data class Done(val status: String) : HubEvent
    data class Error(val message: String) : HubEvent
}

@Singleton
class HubRepository @Inject constructor(
    private val api: LcdrApi,
    private val sse: SseClient,
    private val json: Json,
) {
    suspend fun agents() = api.hubAgents().agents
    suspend fun sessions() = api.hubSessions().sessions
    suspend fun session(id: Long) = api.hubSession(id)
    suspend fun create(request: CreateHubSessionRequest) = api.createHubSession(request).session
    suspend fun interject(id: Long, content: String) = api.interject(id, InterjectRequest(content))
    suspend fun stop(id: Long) = api.stopHubSession(id)
    suspend fun delete(id: Long) = api.deleteHubSession(id)

    fun run(id: Long): Flow<HubEvent> =
        sse.post("api/hub/sessions/$id/run", JsonObject(emptyMap()), JsonObject.serializer()).mapNotNull(::parse)

    private fun parse(o: JsonObject): HubEvent? {
        fun s(key: String) = o[key]?.jsonPrimitive?.contentOrNull.orEmpty()
        return when (s("type")) {
            "status" -> HubEvent.Status(s("status"))
            "turn_start" -> HubEvent.TurnStart(s("agentName"), s("round").toIntOrNull() ?: 0)
            "message" -> o["message"]?.let { HubEvent.Message(json.decodeFromJsonElement<HubMessageDto>(it)) }
            "turn_error" -> HubEvent.TurnError(s("agentName"), s("message"))
            "done" -> HubEvent.Done(s("status"))
            "error" -> HubEvent.Error(s("message"))
            else -> null
        }
    }
}
