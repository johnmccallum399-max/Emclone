package com.lcdr.assistant.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lcdr.assistant.core.Persona
import com.lcdr.assistant.data.prefs.VoiceMode
import com.lcdr.assistant.tools.Formatting
import com.lcdr.assistant.tools.ToolRisk

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onActionHistory: () -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val s by vm.settings.collectAsStateWithLifecycle()
    var pickingTime by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(title = { Text("Settings") })
        Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }

            Section("Persona")
            Field("Name", s.personaName) { v -> vm.update { it.copy(personaName = v.ifBlank { Persona.DEFAULT_NAME }) } }
            Field("Your name (optional)", s.ownerName) { v -> vm.update { it.copy(ownerName = v) } }
            OutlinedTextField(
                value = s.systemPromptOverride,
                onValueChange = { v -> vm.update { it.copy(systemPromptOverride = v.take(8000)) } },
                label = { Text("System prompt override") },
                placeholder = { Text("Empty = built-in LCDR identity") },
                minLines = 3,
                maxLines = 10,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
            if (s.systemPromptOverride.isNotEmpty()) {
                TextButton(onClick = { vm.update { it.copy(systemPromptOverride = "") } }, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text("Reset to built-in identity")
                }
            }

            Section("Voice mode")
            VoiceMode.entries.forEach { mode ->
                Row(
                    Modifier.fillMaxWidth().selectable(s.voiceMode == mode) { vm.update { it.copy(voiceMode = mode) } }.padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = s.voiceMode == mode, onClick = null)
                    Text(mode.label, Modifier.padding(start = 12.dp))
                }
            }
            Toggle("Speak replies aloud", s.speakReplies) { v -> vm.update { it.copy(speakReplies = v) } }

            Section("Device context sent with each message")
            Toggle("Time", s.context.time) { v -> vm.update { it.copy(context = it.context.copy(time = v)) } }
            Toggle("Battery", s.context.battery) { v -> vm.update { it.copy(context = it.context.copy(battery = v)) } }
            Toggle("Location (last known)", s.context.location) { v -> vm.update { it.copy(context = it.context.copy(location = v)) } }
            Toggle("Active app (needs usage access)", s.context.activeApp) { v -> vm.update { it.copy(context = it.context.copy(activeApp = v)) } }
            Toggle("Today's calendar", s.context.calendar) { v -> vm.update { it.copy(context = it.context.copy(calendar = v)) } }

            Section("Device tools")
            vm.registry.all.groupBy { it.category }.forEach { (category, tools) ->
                Text(category.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, top = 8.dp))
                tools.forEach { tool ->
                    val badge = when (tool.risk) { ToolRisk.DESTRUCTIVE -> " · confirms"; ToolRisk.WRITE -> " · logged"; ToolRisk.READ -> "" }
                    Toggle(tool.name + badge, tool.name !in s.disabledTools, tool.description) { vm.setDeviceTool(tool.name, it) }
                }
            }

            Section("Server tools")
            if (vm.serverTools.isEmpty()) Text("Unavailable offline.", Modifier.padding(horizontal = 16.dp))
            vm.serverTools.forEach { tool -> Toggle(tool.name, tool.enabled, tool.description) { vm.setServerTool(tool.name, it) } }

            Section("Daily briefing")
            Toggle("Enabled", s.briefingEnabled) { v -> vm.update { it.copy(briefingEnabled = v) } }
            ListItem(
                headlineContent = { Text("Time") },
                supportingContent = { Text("%02d:%02d".format(s.briefingMinuteOfDay / 60, s.briefingMinuteOfDay % 60)) },
                modifier = Modifier.clickable { pickingTime = true },
            )
            OutlinedButton(onClick = vm::runBriefingNow, modifier = Modifier.padding(horizontal = 16.dp)) { Text("Send a briefing now") }

            Section("Security")
            Toggle("Biometric lock on open", s.biometricLock) { v -> vm.update { it.copy(biometricLock = v) } }
            ListItem(
                headlineContent = { Text("Action history") },
                supportingContent = { Text("Every write/send LCDR performed") },
                trailingContent = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) },
                modifier = Modifier.clickable(onClick = onActionHistory),
            )

            Section("Account")
            Field("Backend URL", s.backendUrl) { v -> vm.update { it.copy(backendUrl = v) } }
            ListItem(headlineContent = { Text("Signed in as ${vm.username ?: "?"}") })
            OutlinedButton(onClick = vm::logout, modifier = Modifier.padding(horizontal = 16.dp)) { Text("Sign out") }
        }
    }

    if (pickingTime) {
        val state = rememberTimePickerState(s.briefingMinuteOfDay / 60, s.briefingMinuteOfDay % 60, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickingTime = false },
            text = { TimePicker(state) },
            confirmButton = {
                TextButton(onClick = {
                    vm.update { it.copy(briefingMinuteOfDay = state.hour * 60 + state.minute) }
                    pickingTime = false
                }) { Text("Set") }
            },
            dismissButton = { TextButton(onClick = { pickingTime = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Section(title: String) {
    HorizontalDivider(Modifier.padding(top = 16.dp))
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(16.dp, 12.dp, 16.dp, 4.dp))
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(value, onChange, label = { Text(label) }, singleLine = true,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp))
}

@Composable
private fun Toggle(title: String, checked: Boolean, subtitle: String? = null, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = if (subtitle != null) {
            { Text(subtitle, style = MaterialTheme.typography.bodySmall) }
        } else {
            null
        },
        trailingContent = { Switch(checked = checked, onCheckedChange = onChange) },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActionHistoryScreen(onBack: () -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val actions by vm.actions.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Action history") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = { IconButton(onClick = { vm.clearHistory() }) { Icon(Icons.Default.Delete, "Clear") } },
        )
        if (actions.isEmpty()) {
            com.lcdr.assistant.ui.common.EmptyState("No actions yet.", "Sends, writes and deletes LCDR performs are logged here.")
            return@Column
        }
        androidx.compose.foundation.lazy.LazyColumn {
            items(actions.size) { i ->
                val a = actions[i]
                Column(Modifier.fillMaxWidth().padding(16.dp, 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row {
                        Text(a.tool, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        Text(a.outcome, style = MaterialTheme.typography.labelMedium,
                            color = if (a.outcome == "executed") MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error)
                    }
                    Text(Formatting.millis(a.timestamp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(a.argsJson, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, maxLines = 4)
                    Text(a.result, style = MaterialTheme.typography.bodySmall, maxLines = 3)
                }
                HorizontalDivider()
            }
        }
    }
}
