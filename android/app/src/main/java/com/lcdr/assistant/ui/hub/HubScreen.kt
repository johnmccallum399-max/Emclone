package com.lcdr.assistant.ui.hub

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lcdr.assistant.data.remote.CreateHubSessionRequest
import com.lcdr.assistant.data.remote.HubAgentDto
import com.lcdr.assistant.data.remote.HubMessageDto
import com.lcdr.assistant.data.remote.HubSessionDto
import com.lcdr.assistant.data.repo.HubEvent
import com.lcdr.assistant.data.repo.HubRepository
import com.lcdr.assistant.ui.common.EmptyState
import com.lcdr.assistant.ui.common.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Thin client over /api/hub — agents are managed on the web; sessions run from here. */
@HiltViewModel
class HubViewModel @Inject constructor(private val hub: HubRepository) : ViewModel() {
    var agents by mutableStateOf<List<HubAgentDto>>(emptyList()); private set
    var sessions by mutableStateOf<List<HubSessionDto>>(emptyList()); private set
    var open by mutableStateOf<HubSessionDto?>(null); private set
    val messages = mutableStateListOf<HubMessageDto>()
    var speaking by mutableStateOf<String?>(null); private set
    var running by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    private var runJob: Job? = null

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        runCatching { agents = hub.agents(); sessions = hub.sessions() }.onFailure { error = it.userMessage() }
    }

    fun openSession(id: Long) = viewModelScope.launch {
        runCatching { hub.session(id) }
            .onSuccess { detail ->
                open = detail.session
                messages.clear(); messages.addAll(detail.messages)
                running = detail.session.status == "running"
            }
            .onFailure { error = it.userMessage() }
    }

    fun close() { open = null; messages.clear(); refresh() }

    fun create(goal: String, agentIds: List<Long>, mode: String, rounds: Int) = viewModelScope.launch {
        runCatching { hub.create(CreateHubSessionRequest(goal, agentIds, mode, rounds)) }
            .onSuccess { openSession(it.id).join(); run() }
            .onFailure { error = it.userMessage() }
    }

    fun run() {
        val session = open ?: return
        if (running) return
        running = true
        runJob = viewModelScope.launch {
            try {
                hub.run(session.id).collect { e ->
                    when (e) {
                        is HubEvent.TurnStart -> speaking = "${e.agentName} (round ${e.round})"
                        is HubEvent.Message -> messages += e.message
                        is HubEvent.TurnError -> error = "${e.agentName}: ${e.message}"
                        is HubEvent.Error -> error = e.message
                        is HubEvent.Done, is HubEvent.Status -> Unit
                    }
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                error = e.userMessage()
            } finally {
                running = false
                speaking = null
            }
        }
    }

    fun stop() = viewModelScope.launch { open?.let { runCatching { hub.stop(it.id) } } }

    fun interject(text: String) = viewModelScope.launch {
        val session = open ?: return@launch
        runCatching { hub.interject(session.id, text) }
            .onSuccess { openSession(session.id) }
            .onFailure { error = it.userMessage() }
    }

    fun delete(id: Long) = viewModelScope.launch {
        runCatching { hub.delete(id) }.onFailure { error = it.userMessage() }
        refresh()
    }

    fun dismissError() { error = null }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HubScreen(vm: HubViewModel = hiltViewModel()) {
    var creating by remember { mutableStateOf(false) }
    val session = vm.open

    Column(Modifier.fillMaxSize().imePadding()) {
        TopAppBar(
            title = { Text(session?.title ?: "Orchestration hub", maxLines = 1) },
            navigationIcon = { if (session != null) IconButton(onClick = vm::close) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            actions = {
                if (session == null) {
                    IconButton(onClick = { vm.refresh() }) { Icon(Icons.Default.Refresh, "Refresh") }
                    IconButton(onClick = { creating = true }, enabled = vm.agents.isNotEmpty()) { Icon(Icons.Default.Add, "New session") }
                } else if (vm.running) {
                    IconButton(onClick = { vm.stop() }) { Icon(Icons.Default.Stop, "Stop") }
                } else {
                    IconButton(onClick = vm::run) { Icon(Icons.Default.PlayArrow, "Run") }
                }
            },
        )
        if (vm.running) LinearProgressIndicator(Modifier.fillMaxWidth())
        vm.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp).clickable { vm.dismissError() })
        }

        if (session == null) SessionList(vm) else Transcript(vm)
    }

    if (creating) NewSessionDialog(vm.agents, onDismiss = { creating = false }) { goal, ids, mode, rounds ->
        creating = false
        vm.create(goal, ids, mode, rounds)
    }
}

@Composable
private fun SessionList(vm: HubViewModel) {
    if (vm.sessions.isEmpty()) {
        EmptyState(
            if (vm.agents.isEmpty()) "No hub agents yet." else "No sessions yet.",
            if (vm.agents.isEmpty()) "Add agents (with their API keys) from the web app's Hub; they appear here." else "Tap + to set a goal and let your agents work it.",
        )
        return
    }
    LazyColumn {
        items(vm.sessions, key = { it.id }) { s ->
            ListItem(
                headlineContent = { Text(s.title, maxLines = 1) },
                supportingContent = { Text("${s.mode} · ${s.maxRounds} rounds · ${s.status}") },
                trailingContent = { IconButton(onClick = { vm.delete(s.id) }) { Icon(Icons.Default.Delete, "Delete") } },
                modifier = Modifier.clickable { vm.openSession(s.id) },
            )
        }
    }
}

@Composable
private fun Transcript(vm: HubViewModel) {
    val state = rememberLazyListState()
    LaunchedEffect(vm.messages.size) { if (vm.messages.isNotEmpty()) state.animateScrollToItem(vm.messages.lastIndex) }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(state = state, modifier = Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text(vm.open?.goal.orEmpty(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(vm.messages, key = { it.id }) { m ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("${m.authorName} · ${m.role} · r${m.round}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        SelectionContainer { Text(m.content, style = MaterialTheme.typography.bodyMedium) }
                    }
                }
            }
            vm.speaking?.let { item { Text("$it is thinking…", style = MaterialTheme.typography.labelMedium) } }
        }
        if (!vm.running) {
            var text by remember { mutableStateOf("") }
            Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(text, { text = it }, placeholder = { Text("Interject…") }, modifier = Modifier.weight(1f))
                IconButton(onClick = { vm.interject(text); text = "" }, enabled = text.isNotBlank()) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
            }
        }
    }
}

@Composable
private fun NewSessionDialog(agents: List<HubAgentDto>, onDismiss: () -> Unit, onCreate: (String, List<Long>, String, Int) -> Unit) {
    var goal by remember { mutableStateOf("") }
    val selected = remember { mutableStateListOf<Long>() }
    var mode by remember { mutableStateOf("discussion") }
    var rounds by remember { mutableStateOf(3) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New hub session") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(goal, { goal = it }, label = { Text("Goal") }, minLines = 2)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("discussion", "debate", "pipeline").forEach { m ->
                        FilterChip(selected = mode == m, onClick = { mode = m }, label = { Text(m) })
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Rounds: $rounds", Modifier.weight(1f))
                    TextButton(onClick = { rounds = (rounds - 1).coerceAtLeast(1) }) { Text("−") }
                    TextButton(onClick = { rounds = (rounds + 1).coerceAtMost(10) }) { Text("+") }
                }
                agents.forEach { a ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable {
                        if (a.id in selected) selected.remove(a.id) else selected.add(a.id)
                    }) {
                        Checkbox(checked = a.id in selected, onCheckedChange = null)
                        Text("${a.name} (${a.model})")
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(goal, selected.toList(), mode, rounds) }, enabled = goal.isNotBlank() && selected.isNotEmpty()) { Text("Start") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
