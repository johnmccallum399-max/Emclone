package com.lcdr.assistant.ui.voice

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.lcdr.assistant.data.prefs.VoiceMode

@Composable
fun VoiceScreen(onClose: () -> Unit, vm: VoiceViewModel = hiltViewModel()) {
    // Opening the screen (mic button, quick tile) starts listening immediately.
    LaunchedEffect(Unit) { vm.start() }

    val pulse by animateFloatAsState(
        targetValue = if (vm.phase == VoicePhase.LISTENING) 1f + ((vm.level + 2f) / 12f).coerceIn(0f, 0.35f) else 1f,
        label = "pulse",
    )

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(vm.mode.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            IconButton(onClick = { vm.stop(); onClose() }) { Icon(Icons.Default.Close, "Close") }
        }

        val listState = rememberLazyListState()
        LaunchedEffect(vm.transcript.size) { if (vm.transcript.isNotEmpty()) listState.animateScrollToItem(vm.transcript.lastIndex) }
        LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(vm.transcript) { t ->
                when (t.role) {
                    "user" -> Text(t.text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    "tool" -> Text(t.text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
                    else -> Text(t.text, style = MaterialTheme.typography.titleMedium)
                }
            }
        }

        if (vm.partial.isNotBlank()) {
            Text(vm.partial, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(vertical = 8.dp))
        }
        vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp)) }

        Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(vm.phase.label, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                if (vm.mode == VoiceMode.REALTIME && vm.active) {
                    IconButton(onClick = vm::toggleMute) {
                        Icon(if (vm.muted) Icons.Default.MicOff else Icons.Default.Mic, if (vm.muted) "Unmute" else "Mute")
                    }
                }
                Box(contentAlignment = Alignment.Center) {
                    Box(Modifier.size(96.dp).scale(pulse).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.18f), CircleShape))
                    FilledIconButton(
                        onClick = vm::toggle,
                        modifier = Modifier.size(72.dp),
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.primary),
                    ) {
                        Icon(if (vm.active) Icons.Default.Stop else Icons.Default.Mic, if (vm.active) "Stop" else "Talk", Modifier.size(32.dp))
                    }
                }
            }
        }
    }
}
