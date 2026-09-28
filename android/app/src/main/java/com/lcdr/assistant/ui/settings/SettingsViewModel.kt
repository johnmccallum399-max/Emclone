package com.lcdr.assistant.ui.settings

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lcdr.assistant.briefing.BriefingScheduler
import com.lcdr.assistant.data.local.ActionLogDao
import com.lcdr.assistant.data.prefs.AppSettings
import com.lcdr.assistant.data.prefs.SettingsStore
import com.lcdr.assistant.data.remote.LcdrApi
import com.lcdr.assistant.data.remote.ServerToolDto
import com.lcdr.assistant.data.remote.ToolToggleRequest
import com.lcdr.assistant.data.repo.AuthRepository
import com.lcdr.assistant.tools.ToolRegistry
import com.lcdr.assistant.ui.common.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val store: SettingsStore,
    private val api: LcdrApi,
    private val auth: AuthRepository,
    private val briefing: BriefingScheduler,
    val registry: ToolRegistry,
    actionLog: ActionLogDao,
) : ViewModel() {
    val settings = store.settings
    val username = auth.username
    val actions = actionLog.observeRecent().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    private val actionLogDao = actionLog

    var serverTools by mutableStateOf<List<ServerToolDto>>(emptyList()); private set
    var error by mutableStateOf<String?>(null); private set

    init {
        viewModelScope.launch {
            runCatching { api.settings() }.onSuccess { serverTools = it.tools }.onFailure { error = it.userMessage() }
        }
    }

    fun update(transform: (AppSettings) -> AppSettings) {
        val before = store.current
        store.update(transform)
        val after = store.current
        if (before.briefingEnabled != after.briefingEnabled || before.briefingMinuteOfDay != after.briefingMinuteOfDay) {
            briefing.reschedule()
        }
    }

    fun setDeviceTool(name: String, enabled: Boolean) = update {
        it.copy(disabledTools = if (enabled) it.disabledTools - name else it.disabledTools + name)
    }

    fun setServerTool(name: String, enabled: Boolean) = viewModelScope.launch {
        serverTools = serverTools.map { if (it.name == name) it.copy(enabled = enabled) else it }
        runCatching { api.setServerTool(name, ToolToggleRequest(enabled)) }.onFailure {
            error = it.userMessage()
            serverTools = serverTools.map { t -> if (t.name == name) t.copy(enabled = !enabled) else t }
        }
    }

    fun runBriefingNow() = briefing.runNow()

    fun clearHistory() = viewModelScope.launch { actionLogDao.clear() }

    fun logout() = auth.logout()
}
