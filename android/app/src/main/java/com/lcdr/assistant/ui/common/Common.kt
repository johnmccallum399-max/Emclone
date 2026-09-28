package com.lcdr.assistant.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import retrofit2.HttpException
import java.io.IOException

@Composable
fun EmptyState(title: String, body: String? = null, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            body?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
        }
    }
}

fun Throwable.userMessage(): String = when (this) {
    is HttpException -> when (code()) {
        401 -> "Session expired — sign in again."
        else -> "Server error ${code()}."
    }
    is IOException -> message?.takeIf { it.startsWith("HTTP") } ?: "Can't reach the backend. Check your connection (Render may be waking up)."
    else -> message ?: this::class.simpleName ?: "Error"
}
