package com.lcdr.assistant.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface ConversationDao {
    @Query("SELECT * FROM conversations ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<CachedConversationEntity>>

    @Transaction
    suspend fun replaceAll(items: List<CachedConversationEntity>) {
        clear()
        upsert(items)
    }

    @Upsert suspend fun upsert(items: List<CachedConversationEntity>)
    @Query("DELETE FROM conversations") suspend fun clear()
    @Query("DELETE FROM conversations WHERE id = :id") suspend fun delete(id: Long)
}

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE conversationId = :conversationId ORDER BY localId")
    suspend fun forConversation(conversationId: Long): List<CachedMessageEntity>

    @Transaction
    suspend fun replaceConversation(conversationId: Long, items: List<CachedMessageEntity>) {
        deleteConversation(conversationId)
        insert(items)
    }

    @Insert suspend fun insert(items: List<CachedMessageEntity>)
    @Query("DELETE FROM messages WHERE conversationId = :conversationId") suspend fun deleteConversation(conversationId: Long)
}

@Dao
interface MemoryDao {
    @Query("SELECT * FROM memory ORDER BY `key`") fun observeAll(): Flow<List<MemoryEntity>>

    @Transaction
    suspend fun replaceAll(items: List<MemoryEntity>) {
        clear()
        upsert(items)
    }

    @Upsert suspend fun upsert(items: List<MemoryEntity>)
    @Query("DELETE FROM memory WHERE `key` = :key") suspend fun delete(key: String)
    @Query("DELETE FROM memory") suspend fun clear()
}

@Dao
interface ActionLogDao {
    @Query("SELECT * FROM action_log ORDER BY timestamp DESC LIMIT 500")
    fun observeRecent(): Flow<List<ActionLogEntity>>

    @Insert suspend fun insert(entry: ActionLogEntity)
    @Query("DELETE FROM action_log") suspend fun clear()
}

@Dao
interface PendingActionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insert(action: PendingActionEntity)
    @Query("UPDATE pending_actions SET status = :status WHERE toolCallId = :toolCallId")
    suspend fun setStatus(toolCallId: String, status: String)
    @Query("SELECT * FROM pending_actions WHERE status = 'pending' ORDER BY createdAt")
    fun observePending(): Flow<List<PendingActionEntity>>
}
