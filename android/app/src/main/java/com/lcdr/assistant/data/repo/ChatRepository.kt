package com.lcdr.assistant.data.repo

import com.lcdr.assistant.data.local.CachedConversationEntity
import com.lcdr.assistant.data.local.CachedMessageEntity
import com.lcdr.assistant.data.local.ConversationDao
import com.lcdr.assistant.data.local.MessageDao
import com.lcdr.assistant.data.prefs.ContextToggles
import com.lcdr.assistant.data.prefs.SettingsStore
import com.lcdr.assistant.data.remote.ChatRequest
import com.lcdr.assistant.data.remote.ConversationDto
import com.lcdr.assistant.data.remote.CreateConversationRequest
import com.lcdr.assistant.data.remote.LcdrApi
import com.lcdr.assistant.data.remote.RenameConversationRequest
import com.lcdr.assistant.data.remote.SseClient
import com.lcdr.assistant.data.remote.ToolResultDto
import com.lcdr.assistant.data.remote.ToolResultsRequest
import com.lcdr.assistant.device.DeviceContextProvider
import com.lcdr.assistant.tools.ClientToolCall
import com.lcdr.assistant.tools.ToolDispatcher
import com.lcdr.assistant.tools.ToolRegistry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import javax.inject.Inject
import javax.inject.Singleton

/** UI-facing events for one user turn, including device tool execution. */
sealed interface ChatEvent {
    data class Token(val text: String) : ChatEvent
    /** A tool started; [device] = ran on this phone rather than the backend. */
    data class ToolStarted(val name: String, val args: JsonObject, val device: Boolean) : ChatEvent
    data class ToolFinished(val name: String, val result: String, val ok: Boolean) : ChatEvent
    data class Done(val text: String) : ChatEvent
    data class Failed(val message: String) : ChatEvent
}

data class UiMessage(val role: String, val content: String, val toolName: String? = null)

@Singleton
class ChatRepository @Inject constructor(
    private val api: LcdrApi,
    private val sse: SseClient,
    private val conversationDao: ConversationDao,
    private val messageDao: MessageDao,
    private val settings: SettingsStore,
    private val deviceContext: DeviceContextProvider,
    private val registry: ToolRegistry,
    private val dispatcher: ToolDispatcher,
) {
    val cachedConversations = conversationDao.observeAll()

    suspend fun refreshConversations(): List<ConversationDto> {
        val list = api.conversations().conversations
        conversationDao.replaceAll(list.map { CachedConversationEntity(it.id, it.title, it.updatedAt) })
        return list
    }

    suspend fun createConversation(title: String? = null): ConversationDto =
        api.createConversation(CreateConversationRequest(title)).conversation.also {
            conversationDao.upsert(listOf(CachedConversationEntity(it.id, it.title, it.updatedAt)))
        }

    suspend fun rename(id: Long, title: String) = api.renameConversation(id, RenameConversationRequest(title))

    suspend fun delete(id: Long) {
        api.deleteConversation(id)
        conversationDao.delete(id)
        messageDao.deleteConversation(id)
    }

    /** Server history (falls back to the Room cache when offline). */
    suspend fun history(conversationId: Long): List<UiMessage> = runCatching {
        val messages = api.messages(conversationId).messages
            .filter { it.role != "system" && !(it.role == "assistant" && it.content.isBlank()) }
            .map { UiMessage(it.role, it.content, it.name) }
        cache(conversationId, messages)
        messages
    }.getOrElse { error ->
        messageDao.forConversation(conversationId).map { UiMessage(it.role, it.content, it.toolName) }
            .ifEmpty { throw error }
    }

    suspend fun cache(conversationId: Long, messages: List<UiMessage>) {
        messageDao.replaceConversation(
            conversationId,
            messages.map { CachedMessageEntity(conversationId = conversationId, role = it.role, content = it.content, toolName = it.toolName) },
        )
    }

    /**
     * Sends a message and drives the whole turn: streams tokens, and whenever
     * the backend pauses on device tools, runs them here and resumes.
     */
    fun send(conversationId: Long, message: String, contextToggles: ContextToggles? = null): Flow<ChatEvent> = flow {
        val current = settings.current
        val toggles = contextToggles ?: current.context
        val systemPrompt = current.systemPrompt()
        val clientContext = deviceContext.build(toggles).ifBlank { null }
        val tools = registry.clientToolDefinitions()

        var stream = sse.post(
            "api/chat/conversations/$conversationId/messages",
            ChatRequest(message, tools, systemPrompt, clientContext),
            ChatRequest.serializer(),
        )

        // Device results the backend echoes as tool_result on resume; already shown, so skipped.
        val echoed = mutableListOf<String>()

        while (true) {
            val calls = mutableListOf<ClientToolCall>()
            var paused = false
            var finished = false
            stream.collect { e ->
                fun s(key: String) = e[key]?.jsonPrimitive?.contentOrNull.orEmpty()
                when (s("type")) {
                    "token" -> emit(ChatEvent.Token(s("content")))
                    "tool_call" -> emit(ChatEvent.ToolStarted(s("name"), e["args"]?.jsonObject ?: JsonObject(emptyMap()), device = false))
                    "tool_result" -> if (!echoed.remove(s("name"))) {
                        emit(ChatEvent.ToolFinished(s("name"), s("result"), ok = !s("result").startsWith("Error")))
                    }
                    "client_tool_call" -> calls += ClientToolCall(s("id"), s("name"), e["args"]?.jsonObject ?: JsonObject(emptyMap()))
                    "awaiting_client_tools" -> paused = true
                    "done" -> { finished = true; emit(ChatEvent.Done(s("content"))) }
                    "error" -> { finished = true; emit(ChatEvent.Failed(s("message"))) }
                }
            }
            if (!paused || calls.isEmpty()) {
                if (!finished) emit(ChatEvent.Failed("Stream ended unexpectedly."))
                return@flow
            }

            val results = calls.map { call ->
                emit(ChatEvent.ToolStarted(call.name, call.args, device = true))
                val outcome = dispatcher.execute(conversationId, call)
                emit(ChatEvent.ToolFinished(call.name, outcome.result, outcome.ok))
                echoed += call.name
                ToolResultDto(call.id, outcome.result)
            }
            stream = sse.post(
                "api/chat/conversations/$conversationId/tool-results",
                ToolResultsRequest(results, tools, systemPrompt, deviceContext.build(toggles).ifBlank { null }),
                ToolResultsRequest.serializer(),
            )
        }
    }
}
