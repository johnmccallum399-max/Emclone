package com.lcdr.assistant.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.lcdr.assistant.ui.ChatPrefill
import com.lcdr.assistant.ui.common.EmptyState
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(onVoice: () -> Unit, vm: ChatViewModel = hiltViewModel()) {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val conversations by vm.conversations.collectAsStateWithLifecycle()

    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet {
                Text("Conversations", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(16.dp))
                NavigationDrawerItem(
                    label = { Text("New conversation") },
                    icon = { Icon(Icons.Default.Add, null) },
                    selected = false,
                    onClick = { vm.newConversation(); scope.launch { drawer.close() } },
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                LazyColumn {
                    items(conversations, key = { it.id }) { c ->
                        NavigationDrawerItem(
                            label = { Text(c.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            selected = c.id == vm.conversationId,
                            onClick = { vm.open(c.id); scope.launch { drawer.close() } },
                            badge = {
                                IconButton(onClick = { vm.delete(c.id) }) { Icon(Icons.Default.Delete, "Delete", Modifier.size(18.dp)) }
                            },
                            modifier = Modifier.padding(horizontal = 12.dp),
                        )
                    }
                }
            }
        },
    ) {
        Column(Modifier.fillMaxSize().imePadding()) {
            TopAppBar(
                title = { Text(vm.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Default.Menu, "Conversations") } },
                actions = { IconButton(onClick = vm::newConversation) { Icon(Icons.Default.Add, "New conversation") } },
            )
            Box(Modifier.weight(1f)) {
                when {
                    vm.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    vm.items.isEmpty() -> EmptyState("LCDR standing by.", "Ask, or tap the mic. I can read and send texts, manage your calendar, files, alarms and more.")
                    else -> MessageList(vm.items)
                }
            }
            Composer(busy = vm.busy, onSend = vm::send, onStop = vm::stop, onVoice = onVoice)
        }
    }
}

@Composable
private fun MessageList(items: List<ChatItem>) {
    val state = rememberLazyListState()
    LaunchedEffect(items.size, (items.lastOrNull() as? ChatItem.Assistant)?.text?.length) {
        if (items.isNotEmpty()) state.animateScrollToItem(items.lastIndex)
    }
    LazyColumn(state = state, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(items) { _, item ->
            when (item) {
                is ChatItem.User -> Bubble(item.text, mine = true)
                is ChatItem.Assistant -> Bubble(item.text.ifEmpty { "…" }, mine = false)
                is ChatItem.Tool -> ToolChip(item)
                is ChatItem.Failure -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.ErrorOutline, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
                    Text(" ${item.message}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun Bubble(text: String, mine: Boolean) {
    Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        Surface(
            color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh,
            contentColor = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            SelectionContainer { Text(text, Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) }
        }
    }
}

@Composable
fun ToolChip(item: ChatItem.Tool) {
    var expanded by remember { mutableStateOf(false) }
    val tint = when {
        item.running -> MaterialTheme.colorScheme.primary
        item.ok -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.error
    }
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.fillMaxWidth().clickable(enabled = item.result != null) { expanded = !expanded },
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (item.device) Icons.Default.PhoneAndroid else Icons.Default.Cloud, null, tint = tint, modifier = Modifier.size(16.dp))
                Text(item.name, style = MaterialTheme.typography.labelLarge, color = tint)
                if (item.summary.isNotEmpty()) {
                    Text(item.summary, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                }
                if (item.running) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
            }
            AnimatedVisibility(expanded) {
                SelectionContainer {
                    Text(item.result.orEmpty(), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace,
                        modifier = Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun Composer(busy: Boolean, onSend: (String) -> Unit, onStop: () -> Unit, onVoice: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val prefill by ChatPrefill.collectAsStateWithLifecycle()
    LaunchedEffect(prefill) {
        prefill?.let { text = it; ChatPrefill.value = null }
    }
    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Orders?") },
            maxLines = 5,
            shape = RoundedCornerShape(24.dp),
            modifier = Modifier.weight(1f),
        )
        when {
            busy -> IconButton(onClick = onStop) { Icon(Icons.Default.Stop, "Stop") }
            text.isBlank() -> IconButton(onClick = onVoice) { Icon(Icons.Default.Mic, "Voice", tint = MaterialTheme.colorScheme.primary) }
            else -> IconButton(onClick = { onSend(text); text = "" }) {
                Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}
