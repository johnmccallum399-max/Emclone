package com.lcdr.assistant.ui.memory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.lcdr.assistant.data.local.MemoryEntity
import com.lcdr.assistant.data.repo.MemoryRepository
import com.lcdr.assistant.ui.common.EmptyState
import com.lcdr.assistant.ui.common.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MemoryViewModel @Inject constructor(private val memory: MemoryRepository) : ViewModel() {
    val entries = memory.entries.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    var error by mutableStateOf<String?>(null); private set

    init { refresh() }

    fun refresh() = launchSafely { memory.refresh() }
    fun save(key: String, value: String) = launchSafely { memory.set(key, value) }
    fun delete(key: String) = launchSafely { memory.delete(key) }

    private fun launchSafely(block: suspend () -> Unit) = viewModelScope.launch {
        error = null
        runCatching { block() }.onFailure { error = it.userMessage() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MemoryScreen(vm: MemoryViewModel = hiltViewModel()) {
    val entries by vm.entries.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<MemoryEntity?>(null) }
    var adding by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        Column {
            TopAppBar(
                title = { Text("Long-term memory") },
                actions = { IconButton(onClick = { vm.refresh() }) { Icon(Icons.Default.Refresh, "Refresh") } },
            )
            Text(
                "Injected into every conversation. LCDR also writes here itself via remember().",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
            if (entries.isEmpty()) {
                EmptyState("Nothing remembered yet.", "Tell LCDR \"remember that…\" or add an entry.")
            } else {
                LazyColumn {
                    items(entries, key = { it.key }) { e ->
                        ListItem(
                            headlineContent = { Text(e.key) },
                            supportingContent = { Text(e.value) },
                            trailingContent = { IconButton(onClick = { vm.delete(e.key) }) { Icon(Icons.Default.Delete, "Delete") } },
                            modifier = Modifier.clickable { editing = e },
                        )
                    }
                }
            }
        }
        FloatingActionButton(onClick = { adding = true }, modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp)) {
            Icon(Icons.Default.Add, "Add memory")
        }
    }

    if (adding || editing != null) {
        MemoryDialog(
            initial = editing,
            onDismiss = { adding = false; editing = null },
            onSave = { k, v -> vm.save(k, v); adding = false; editing = null },
        )
    }
}

@Composable
private fun MemoryDialog(initial: MemoryEntity?, onDismiss: () -> Unit, onSave: (String, String) -> Unit) {
    var key by remember { mutableStateOf(initial?.key.orEmpty()) }
    var value by remember { mutableStateOf(initial?.value.orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "Add memory" else "Edit memory") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(key, { key = it.take(100) }, label = { Text("Key") }, singleLine = true, enabled = initial == null)
                OutlinedTextField(value, { value = it.take(2000) }, label = { Text("Value") }, minLines = 3)
            }
        },
        confirmButton = { TextButton(onClick = { onSave(key, value) }, enabled = key.isNotBlank() && value.isNotBlank()) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
