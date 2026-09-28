package com.lcdr.assistant.tools

import com.lcdr.assistant.data.remote.ClientToolDto
import com.lcdr.assistant.data.prefs.SettingsStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ToolRegistry @Inject constructor(
    tools: Set<@JvmSuppressWildcards DeviceTool>,
    private val settings: SettingsStore,
) {
    val all: List<DeviceTool> = tools.sortedWith(compareBy({ it.category.ordinal }, { it.name }))
    private val byName = all.associateBy { it.name }

    operator fun get(name: String): DeviceTool? = byName[name]

    /** Enabled tools, in the shape the backend advertises to the model. */
    fun clientToolDefinitions(): List<ClientToolDto> =
        all.filter { settings.isToolEnabled(it.name) }.map { ClientToolDto(it.name, it.description, it.parameters) }
}
