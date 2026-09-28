package com.lcdr.assistant.ui

import android.content.Intent
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.lcdr.assistant.core.IntentActions
import com.lcdr.assistant.data.repo.AuthRepository
import com.lcdr.assistant.ui.chat.ChatScreen
import com.lcdr.assistant.ui.device.DeviceScreen
import com.lcdr.assistant.ui.hub.HubScreen
import com.lcdr.assistant.ui.login.LoginScreen
import com.lcdr.assistant.ui.memory.MemoryScreen
import com.lcdr.assistant.ui.settings.ActionHistoryScreen
import com.lcdr.assistant.ui.settings.SettingsScreen
import com.lcdr.assistant.ui.voice.VoiceScreen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject

@HiltViewModel
class RootViewModel @Inject constructor(auth: AuthRepository) : ViewModel() {
    val token = auth.token
}

object Routes {
    const val CHAT = "chat?c={c}"
    const val VOICE = "voice"
    const val HUB = "hub"
    const val MEMORY = "memory"
    const val SETTINGS = "settings"
    const val HISTORY = "settings/history"
    const val DEVICE = "device"
    fun chat(conversationId: Long? = null) = if (conversationId == null) "chat" else "chat?c=$conversationId"
}

private data class Tab(val route: String, val target: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(Routes.CHAT, "chat", "Chat", Icons.AutoMirrored.Filled.Chat),
    Tab(Routes.DEVICE, Routes.DEVICE, "Device", Icons.Default.Smartphone),
    Tab(Routes.HUB, Routes.HUB, "Hub", Icons.Default.Hub),
    Tab(Routes.MEMORY, Routes.MEMORY, "Memory", Icons.Default.Psychology),
    Tab(Routes.SETTINGS, Routes.SETTINGS, "Settings", Icons.Default.Settings),
)

@Composable
fun LcdrNavHost(entryIntents: MutableStateFlow<Intent?>, root: RootViewModel = hiltViewModel()) {
    val token by root.token.collectAsStateWithLifecycle()
    if (token == null) {
        LoginScreen()
        return
    }

    val nav = rememberNavController()
    val entry by entryIntents.collectAsStateWithLifecycle()
    LaunchedEffect(entry) {
        val intent = entry ?: return@LaunchedEffect
        when (intent.action) {
            IntentActions.ACTION_VOICE -> nav.navigate(Routes.VOICE) { launchSingleTop = true }
            IntentActions.ACTION_BRIEFING -> {
                val id = intent.getLongExtra(IntentActions.EXTRA_CONVERSATION_ID, -1L).takeIf { it > 0 }
                nav.navigate(Routes.chat(id)) { popUpTo(nav.graph.findStartDestination().id) }
            }
        }
        entryIntents.value = null
    }

    val backStack by nav.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route
    val showBar = currentRoute != Routes.VOICE

    Scaffold(
        bottomBar = {
            if (showBar) NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = currentRoute == tab.route || (tab.route == Routes.SETTINGS && currentRoute == Routes.HISTORY),
                        onClick = {
                            nav.navigate(tab.target) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = Routes.CHAT, modifier = Modifier.padding(padding)) {
            composable(
                Routes.CHAT,
                arguments = listOf(navArgument("c") { type = NavType.LongType; defaultValue = -1L }),
            ) { ChatScreen(onVoice = { nav.navigate(Routes.VOICE) }) }
            composable(Routes.VOICE) { VoiceScreen(onClose = { nav.popBackStack() }) }
            composable(Routes.HUB) { HubScreen() }
            composable(Routes.MEMORY) { MemoryScreen() }
            composable(Routes.SETTINGS) { SettingsScreen(onActionHistory = { nav.navigate(Routes.HISTORY) }) }
            composable(Routes.HISTORY) { ActionHistoryScreen(onBack = { nav.popBackStack() }) }
            composable(Routes.DEVICE) {
                DeviceScreen(
                    onAsk = { prompt -> nav.navigate(Routes.chat()) { launchSingleTop = true }; ChatPrefill.value = prompt },
                )
            }
        }
    }
}

/** One-shot text to drop into the chat composer (Device quick actions). */
val ChatPrefill = MutableStateFlow<String?>(null)
