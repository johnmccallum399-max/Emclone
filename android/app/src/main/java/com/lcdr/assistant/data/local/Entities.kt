package com.lcdr.assistant.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Offline cache of a conversation's rendered messages. */
@Entity(tableName = "messages", indices = [Index("conversationId")])
data class CachedMessageEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val conversationId: Long,
    /** user | assistant | tool */
    val role: String,
    val content: String,
    /** Tool name for role = tool. */
    val toolName: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "conversations")
data class CachedConversationEntity(
    @PrimaryKey val id: Long,
    val title: String,
    val updatedAt: String,
)

/** Mirror of backend long-term memory so the screen works offline. */
@Entity(tableName = "memory")
data class MemoryEntity(
    @PrimaryKey val key: String,
    val value: String,
    val updatedAt: String,
)

/** Every write/send tool call, for Settings → Action history. */
@Entity(tableName = "action_log")
data class ActionLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long = System.currentTimeMillis(),
    val tool: String,
    val argsJson: String,
    /** executed | declined | failed | denied_permission */
    val outcome: String,
    val result: String,
)

/** Tool calls waiting on the owner's confirmation; survives process death for auditability. */
@Entity(tableName = "pending_actions")
data class PendingActionEntity(
    @PrimaryKey val toolCallId: String,
    val conversationId: Long,
    val tool: String,
    val argsJson: String,
    val prompt: String,
    /** pending | approved | declined */
    val status: String = "pending",
    val createdAt: Long = System.currentTimeMillis(),
)
