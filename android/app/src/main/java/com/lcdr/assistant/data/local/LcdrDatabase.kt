package com.lcdr.assistant.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        CachedConversationEntity::class,
        CachedMessageEntity::class,
        MemoryEntity::class,
        ActionLogEntity::class,
        PendingActionEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class LcdrDatabase : RoomDatabase() {
    abstract fun conversations(): ConversationDao
    abstract fun messages(): MessageDao
    abstract fun memory(): MemoryDao
    abstract fun actionLog(): ActionLogDao
    abstract fun pendingActions(): PendingActionDao
}
