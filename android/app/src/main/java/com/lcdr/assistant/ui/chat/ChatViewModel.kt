package com.lcdr.assistant.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lcdr.assistant.data.local.CachedConversationEntity
import com.lcdr.assistant.data.repo.ChatEvent
import com.lcdr.assistant.data.repo.ChatRepository
import com.lcdr.assistant.data.repo.UiMessage
import com.lcdr.assistant.ui.common.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import javax.inject.Inject

sealed interface ChatItem {
    data class User(val text: String) : ChatItem
    data class Assistant(val text: String, val streaming: Boolean = false) : ChatItem
    data class Tool(
        val name: String,
        val summary: String,
        val device: Boolean,
        val result: String? = null,
        val ok: Boolean = true,
    ) : ChatItem {
        val running get() = result == null
    }
    data class Failure(val message: String) : ChatItem
}

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chat: ChatRepository,
    savedState: SavedStateHandle,
) : ViewModel() {

    val conversations: StateFlow<List<CachedConversationEntity>> =
        chat.cachedConversations.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val items = mutableStateListOf<ChatItem>()
    var conversationId by mutableStateOf<Long?>(null); private set
    var title by mutableStateOf("New conversation"); private set
    var busy by mutableStateOf(false); private set
    var loading by mutableStateOf(false); private set

    private var turn: Job? = null

    init {
        val requested = savedState.get<Long>("c")?.takeIf { it > 0 }
        viewModelScope.launch {
            val list = runCatching { chat.refreshConversations() }.getOrNull()
            when {
                requested != null -> open(requested)
                list != null && list.isNotEmpty() -> open(list.first().id)
            }
        }
    }

    fun open(id: Long) {
        if (busy) return
        conversationId = id
        title = conversations.value.firstOrNull { it.id == id }?.title ?: title
        items.clear()
        loading = true
        viewModelScope.launch {
            runCatching { chat.history(id) }
                .onSuccess { history -> items.addAll(history.toItems()) }
                .onFailure { items += ChatItem.Failure(it.userMessage()) }
            loading = false
        }
    }

    fun newConversation() {
        if (busy) return
        conversationId = null
        title = "New conversation"
        items.clear()
    }

    fun delete(id: Long) = viewModelScope.launch {
        runCatching { chat.delete(id) }
        if (conversationId == id) newConversation()
    }

    fun send(text: String) {
        val message = text.trim()
        if (message.isEmpty() || busy) return
        busy = true
        items += ChatItem.User(message)
        turn = viewModelScope.launch {
            try {
                val id = conversationId ?: chat.createConversation(message.take(60)).also {
                    conversationId = it.id
                    title = it.title
                }.id
                runTurn(id, message)
                runCatching { chat.refreshConversations() }
                chat.cache(id, items.toUiMessages())
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                items += ChatItem.Failure(e.userMessage())
            } finally {
                finishStreaming()
                busy = false
            }
        }
    }

    fun stop() {
        turn?.cancel()
    }

    private suspend fun runTurn(id: Long, message: String) {
        chat.send(id, message).collect { event ->
            when (event) {
                is ChatEvent.Token -> appendToken(event.text)
                is ChatEvent.ToolStarted -> {
                    finishStreaming()
                    items += ChatItem.Tool(event.name, summarize(event.args), event.device)
                }
                is ChatEvent.ToolFinished -> {
                    val index = items.indexOfLast { it is ChatItem.Tool && it.name == event.name && it.running }
                    if (index >= 0) {
                        items[index] = (items[index] as ChatItem.Tool).copy(result = event.result, ok = event.ok)
                    } else {
                        items += ChatItem.Tool(event.name, "", device = false, result = event.result, ok = event.ok)
                    }
                }
                is ChatEvent.Done -> finishStreaming()
                is ChatEvent.Failed -> items += ChatItem.Failure(event.message)
            }
        }
    }

    private fun appendToken(text: String) {
        val last = items.lastOrNull()
        if (last is ChatItem.Assistant && last.streaming) {
            items[items.lastIndex] = last.copy(text = last.text + text)
        } else {
            items += ChatItem.Assistant(text, streaming = true)
        }
    }

    private fun finishStreaming() {
        val last = items.lastOrNull()
        if (last is ChatItem.Assistant && last.streaming) items[items.lastIndex] = last.copy(streaming = false)
    }

    companion object {
        fun summarize(args: JsonObject): String = args.entries.joinToString(", ") { (k, v) ->
            val value = (v as? JsonPrimitive)?.content ?: v.toString()
            "$k: ${if (value.length > 40) value.take(40) + "…" else value}"
        }

        fun List<UiMessage>.toItems(): List<ChatItem> = map {
            when (it.role) {
                "user" -> ChatItem.User(it.content)
                "tool" -> ChatItem.Tool(it.toolName ?: "tool", "", device = false, result = it.content, ok = !it.content.startsWith("Error"))
                else -> ChatItem.Assistant(it.content)
            }
        }

        fun List<ChatItem>.toUiMessages(): List<UiMessage> = mapNotNull {
            when (it) {
                is ChatItem.User -> UiMessage("user", it.text)
                is ChatItem.Assistant -> UiMessage("assistant", it.text)
                is ChatItem.Tool -> it.result?.let { r -> UiMessage("tool", r, it.name) }
                is ChatItem.Failure -> null
            }
        }
    }
}
