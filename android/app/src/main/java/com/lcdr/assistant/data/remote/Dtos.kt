package com.lcdr.assistant.data.remote

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable data class LoginRequest(val username: String, val password: String)
@Serializable data class UserDto(val id: Long, val username: String)
@Serializable data class LoginResponse(val token: String, val user: UserDto)
@Serializable data class MeResponse(val user: UserDto)

@Serializable data class ConversationDto(
    val id: Long,
    val title: String,
    val createdAt: String = "",
    val updatedAt: String = "",
)
@Serializable data class ConversationsResponse(val conversations: List<ConversationDto>)
@Serializable data class ConversationResponse(val conversation: ConversationDto)
@Serializable data class CreateConversationRequest(val title: String? = null)
@Serializable data class RenameConversationRequest(val title: String)

@Serializable data class MessageDto(
    val id: Long,
    val conversationId: Long,
    val role: String,
    val content: String,
    val toolCalls: String? = null,
    val toolCallId: String? = null,
    val name: String? = null,
    val createdAt: String = "",
)
@Serializable data class MessagesResponse(val messages: List<MessageDto>)

@Serializable data class ClientToolDto(val name: String, val description: String, val parameters: JsonObject)

@Serializable data class ChatRequest(
    val message: String,
    val clientTools: List<ClientToolDto>? = null,
    val systemPrompt: String? = null,
    val clientContext: String? = null,
)

@Serializable data class ToolResultDto(val toolCallId: String, val result: String)

@Serializable data class ToolResultsRequest(
    val results: List<ToolResultDto>,
    val clientTools: List<ClientToolDto>? = null,
    val systemPrompt: String? = null,
    val clientContext: String? = null,
)

@Serializable data class MemoryEntryDto(val key: String, val value: String, val updatedAt: String = "")
@Serializable data class MemoryResponse(val entries: List<MemoryEntryDto>)
@Serializable data class SetMemoryRequest(val key: String, val value: String)

@Serializable data class PersonaDto(val name: String, val systemPrompt: String, val description: String = "")
@Serializable data class ServerToolDto(
    val name: String,
    val description: String,
    val permission: String,
    val enabled: Boolean,
)
@Serializable data class SettingsResponse(
    val persona: PersonaDto,
    val voiceMode: String,
    val tools: List<ServerToolDto>,
    val voiceModes: List<String> = emptyList(),
)
@Serializable data class ToolToggleRequest(val enabled: Boolean)

@Serializable data class HubAgentDto(
    val id: Long,
    val name: String,
    val provider: String,
    val model: String,
    val baseUrl: String? = null,
    val systemPrompt: String = "",
    val createdAt: String = "",
)
@Serializable data class HubAgentsResponse(val agents: List<HubAgentDto>)

@Serializable data class HubSessionDto(
    val id: Long,
    val title: String,
    val goal: String,
    val mode: String,
    val maxRounds: Int,
    val synthesize: Boolean,
    val status: String,
    val agentIds: List<Long>,
    val createdAt: String = "",
    val updatedAt: String = "",
)
@Serializable data class HubSessionsResponse(val sessions: List<HubSessionDto>)
@Serializable data class HubSessionResponse(val session: HubSessionDto)

@Serializable data class HubMessageDto(
    val id: Long,
    val sessionId: Long,
    val agentId: Long? = null,
    val authorName: String,
    val role: String,
    val content: String,
    val round: Int = 0,
    val createdAt: String = "",
)
@Serializable data class HubSessionDetail(
    val session: HubSessionDto,
    val messages: List<HubMessageDto>,
    val agents: List<HubAgentDto>,
)
@Serializable data class CreateHubSessionRequest(
    val goal: String,
    val agentIds: List<Long>,
    val mode: String = "discussion",
    val maxRounds: Int = 3,
    val synthesize: Boolean = true,
    val title: String? = null,
)
@Serializable data class InterjectRequest(val content: String)
@Serializable data class StopResponse(val stopping: Boolean)

@Serializable data class RealtimeSessionDto(val clientSecret: String, val model: String, val expiresAt: Long? = null)
@Serializable data class TranscribeResponse(val text: String)
@Serializable data class SpeakRequest(val text: String)
