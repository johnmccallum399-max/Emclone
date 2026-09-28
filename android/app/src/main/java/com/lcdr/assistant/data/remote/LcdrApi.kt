package com.lcdr.assistant.data.remote

import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path

/** Non-streaming endpoints. Streaming endpoints go through [SseClient]. */
interface LcdrApi {
    @POST("api/auth/login") suspend fun login(@Body body: LoginRequest): LoginResponse
    @GET("api/auth/me") suspend fun me(): MeResponse

    @GET("api/chat/conversations") suspend fun conversations(): ConversationsResponse
    @POST("api/chat/conversations") suspend fun createConversation(@Body body: CreateConversationRequest): ConversationResponse
    @PATCH("api/chat/conversations/{id}")
    suspend fun renameConversation(@Path("id") id: Long, @Body body: RenameConversationRequest): ConversationResponse
    @DELETE("api/chat/conversations/{id}") suspend fun deleteConversation(@Path("id") id: Long)
    @GET("api/chat/conversations/{id}/messages") suspend fun messages(@Path("id") id: Long): MessagesResponse

    @GET("api/memory") suspend fun memory(): MemoryResponse
    @PUT("api/memory") suspend fun setMemory(@Body body: SetMemoryRequest)
    @DELETE("api/memory/{key}") suspend fun deleteMemory(@Path("key") key: String)

    @GET("api/settings") suspend fun settings(): SettingsResponse
    @PUT("api/settings/tools/{name}") suspend fun setServerTool(@Path("name") name: String, @Body body: ToolToggleRequest)

    @GET("api/hub/agents") suspend fun hubAgents(): HubAgentsResponse
    @GET("api/hub/sessions") suspend fun hubSessions(): HubSessionsResponse
    @POST("api/hub/sessions") suspend fun createHubSession(@Body body: CreateHubSessionRequest): HubSessionResponse
    @GET("api/hub/sessions/{id}") suspend fun hubSession(@Path("id") id: Long): HubSessionDetail
    @DELETE("api/hub/sessions/{id}") suspend fun deleteHubSession(@Path("id") id: Long)
    @POST("api/hub/sessions/{id}/messages") suspend fun interject(@Path("id") id: Long, @Body body: InterjectRequest)
    @POST("api/hub/sessions/{id}/stop") suspend fun stopHubSession(@Path("id") id: Long): StopResponse

    @POST("api/voice/realtime-session") suspend fun realtimeSession(): RealtimeSessionDto
    @Multipart @POST("api/voice/transcribe") suspend fun transcribe(@Part audio: MultipartBody.Part): TranscribeResponse
    @POST("api/voice/speak") suspend fun speak(@Body body: SpeakRequest): ResponseBody
}
