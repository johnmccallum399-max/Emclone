package com.lcdr.assistant.ui.device

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.BatteryStd
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lcdr.assistant.device.DeviceSnapshot
import com.lcdr.assistant.device.DeviceSnapshotData
import com.lcdr.assistant.tools.CalendarRepository
import com.lcdr.assistant.tools.Formatting
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DeviceViewModel @Inject constructor(
    private val snapshot: DeviceSnapshot,
    val calendar: CalendarRepository,
) : ViewModel() {
    var data by mutableStateOf<DeviceSnapshotData?>(null); private set

    init { refresh() }

    fun refresh() = viewModelScope.launch { data = snapshot.load() }
}

private data class QuickAction(val label: String, val icon: ImageVector, val prompt: String)

private val quickActions = listOf(
    QuickAction("New reminder", Icons.Default.Alarm, "Remind me to "),
    QuickAction("Send message", Icons.AutoMirrored.Filled.Message, "Text "),
    QuickAction("Open file", Icons.Default.Folder, "Open the file "),
    QuickAction("Add event", Icons.Default.Event, "Add to my calendar: "),
    QuickAction("Where am I?", Icons.Default.MyLocation, "Where am I right now?"),
    QuickAction("Unread texts", Icons.AutoMirrored.Filled.Message, "Summarize my unread texts."),
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DeviceScreen(onAsk: (String) -> Unit, vm: DeviceViewModel = hiltViewModel()) {
    val grant = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.refresh() }
    val d = vm.data

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Device") },
            actions = { IconButton(onClick = { vm.refresh() }) { Icon(Icons.Default.Refresh, "Refresh") } },
        )
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Card(Modifier.fillMaxWidth()) {
                ListItem(
                    leadingContent = { Icon(Icons.Default.BatteryStd, null) },
                    headlineContent = { Text(d?.battery ?: "…") },
                )
            }

            Text("Quick actions", style = MaterialTheme.typography.titleSmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                quickActions.forEach { a ->
                    AssistChip(onClick = { onAsk(a.prompt) }, label = { Text(a.label) }, leadingIcon = { Icon(a.icon, null) })
                }
            }

            Text("Today", style = MaterialTheme.typography.titleSmall)
            Card(Modifier.fillMaxWidth()) {
                when {
                    d == null -> Unit
                    !d.calendarGranted -> TextButton(onClick = { grant.launch(arrayOf(Manifest.permission.READ_CALENDAR)) }, modifier = Modifier.padding(8.dp)) {
                        Text("Allow calendar access to see today's events")
                    }
                    d.events.isEmpty() -> Text("Nothing scheduled.", Modifier.padding(16.dp))
                    else -> Column {
                        d.events.forEach { e ->
                            ListItem(
                                headlineContent = { Text(e.title) },
                                supportingContent = {
                                    Text(if (e.allDay) "All day" else "${Formatting.millis(e.begin).takeLast(5)} – ${Formatting.millis(e.end).takeLast(5)}" +
                                        (e.location?.let { " · $it" } ?: ""))
                                },
                            )
                        }
                    }
                }
            }

            Text("Recent messages", style = MaterialTheme.typography.titleSmall)
            Card(Modifier.fillMaxWidth()) {
                when {
                    d == null -> Unit
                    !d.smsGranted -> TextButton(
                        onClick = { grant.launch(arrayOf(Manifest.permission.READ_SMS, Manifest.permission.READ_CONTACTS)) },
                        modifier = Modifier.padding(8.dp),
                    ) { Text("Allow SMS access to see recent messages") }
                    d.threads.isEmpty() -> Text("No messages.", Modifier.padding(16.dp))
                    else -> Column {
                        d.threads.forEach { t ->
                            val who = t.name ?: t.address
                            ListItem(
                                headlineContent = { Text(who, fontWeight = if (t.unread) FontWeight.Bold else FontWeight.Normal) },
                                supportingContent = { Text(t.snippet, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                trailingContent = { Text(Formatting.millis(t.date).takeLast(5), style = MaterialTheme.typography.labelSmall) },
                                modifier = Modifier.clickable { onAsk("Reply to $who: ") },
                            )
                        }
                    }
                }
            }
        }
    }
}
