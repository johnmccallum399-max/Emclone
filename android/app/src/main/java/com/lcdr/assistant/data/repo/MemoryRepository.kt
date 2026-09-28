package com.lcdr.assistant.data.repo

import com.lcdr.assistant.data.local.MemoryDao
import com.lcdr.assistant.data.local.MemoryEntity
import com.lcdr.assistant.data.remote.LcdrApi
import com.lcdr.assistant.data.remote.SetMemoryRequest
import javax.inject.Inject
import javax.inject.Singleton

/** Backend long-term memory, mirrored into Room for offline viewing. */
@Singleton
class MemoryRepository @Inject constructor(private val api: LcdrApi, private val dao: MemoryDao) {
    val entries = dao.observeAll()

    suspend fun refresh() {
        dao.replaceAll(api.memory().entries.map { MemoryEntity(it.key, it.value, it.updatedAt) })
    }

    suspend fun set(key: String, value: String) {
        api.setMemory(SetMemoryRequest(key.trim(), value.trim()))
        refresh()
    }

    suspend fun delete(key: String) {
        api.deleteMemory(key)
        dao.delete(key)
    }
}
