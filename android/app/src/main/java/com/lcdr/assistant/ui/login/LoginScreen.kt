package com.lcdr.assistant.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.lcdr.assistant.data.prefs.SettingsStore
import com.lcdr.assistant.data.repo.AuthRepository
import com.lcdr.assistant.ui.common.userMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val settings: SettingsStore,
) : ViewModel() {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    val lastUsername = auth.username.orEmpty()
    var backendUrl by mutableStateOf(settings.current.backendUrl); private set

    fun setBackend(url: String) {
        backendUrl = url
        settings.update { it.copy(backendUrl = url.trim().trimEnd('/')) }
    }

    fun login(username: String, password: String) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            runCatching { auth.login(username, password) }
                .onFailure { error = if (it is retrofit2.HttpException && it.code() == 401) "Wrong username or password." else it.userMessage() }
            busy = false
        }
    }
}

@Composable
fun LoginScreen(vm: LoginViewModel = hiltViewModel()) {
    var username by remember { mutableStateOf(vm.lastUsername) }
    var password by remember { mutableStateOf("") }
    var showServer by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().imePadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("LCDR", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary)
        Text("Personal device assistant", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(username, { username = it }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            password, { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            modifier = Modifier.fillMaxWidth(),
        )
        vm.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = { vm.login(username, password) },
            enabled = !vm.busy && username.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (vm.busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.padding(2.dp)) else Text("Sign in")
        }
        TextButton(onClick = { showServer = !showServer }) { Text(if (showServer) "Hide server" else "Server: ${vm.backendUrl.removePrefix("https://")}") }
        if (showServer) {
            OutlinedTextField(vm.backendUrl, vm::setBackend, label = { Text("Backend URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
    }
}
