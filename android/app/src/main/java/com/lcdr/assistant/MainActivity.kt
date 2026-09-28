package com.lcdr.assistant

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.lcdr.assistant.data.prefs.SettingsStore
import com.lcdr.assistant.tools.SpecialAccess
import com.lcdr.assistant.tools.UiBroker
import com.lcdr.assistant.tools.UiRequest
import com.lcdr.assistant.ui.LcdrNavHost
import com.lcdr.assistant.ui.common.CapturePhoto
import com.lcdr.assistant.ui.theme.LcdrTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    @Inject lateinit var broker: UiBroker
    @Inject lateinit var settings: SettingsStore

    /** Latest entry-point intent (quick tile, briefing notification) for the nav host to consume. */
    val entryIntents = MutableStateFlow<Intent?>(null)

    private var dialog by mutableStateOf<UiRequest?>(null)
    private var inFlight: UiRequest? = null

    private var locked by mutableStateOf(false)
    private var stoppedAt = 0L

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        // The dispatcher re-checks what was actually granted.
        complete(true)
    }
    private val settingsLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { complete(true) }
    private val cameraLauncher = registerForActivityResult(CapturePhoto()) { complete(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        locked = settings.current.biometricLock && canUseBiometrics()
        entryIntents.value = intent

        lifecycleScope.launch {
            broker.requests.collect { request ->
                inFlight = request
                handle(request)
                request.result.await()
                inFlight = null
            }
        }

        setContent {
            LcdrTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (locked) LockedScreen(onUnlock = ::promptBiometric) else LcdrNavHost(entryIntents)
                    dialog?.let { BrokerDialog(it) }
                }
            }
        }
        if (locked) promptBiometric()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        entryIntents.value = intent
    }

    override fun onStart() {
        super.onStart()
        broker.onActivityStarted()
        // Re-lock after a real absence, not after a camera or settings round trip.
        if (settings.current.biometricLock && stoppedAt > 0 && System.currentTimeMillis() - stoppedAt > RELOCK_AFTER_MS && inFlight == null) {
            locked = canUseBiometrics()
            if (locked) promptBiometric()
        }
    }

    override fun onStop() {
        super.onStop()
        broker.onActivityStopped()
        stoppedAt = System.currentTimeMillis()
    }

    override fun onDestroy() {
        inFlight?.result?.complete(false)
        super.onDestroy()
    }

    private fun handle(request: UiRequest) {
        when (request) {
            is UiRequest.Permissions, is UiRequest.Special, is UiRequest.Confirm -> dialog = request
            is UiRequest.TakePhoto -> cameraLauncher.launch(request.output to request.frontCamera)
        }
    }

    private fun complete(result: Boolean) {
        dialog = null
        inFlight?.result?.complete(result)
    }

    private fun proceed(request: UiRequest) {
        dialog = null
        when (request) {
            is UiRequest.Permissions -> permissionLauncher.launch(request.permissions.toTypedArray())
            is UiRequest.Special -> settingsLauncher.launch(specialAccessIntent(request.access))
            is UiRequest.Confirm -> request.result.complete(true)
            is UiRequest.TakePhoto -> Unit
        }
    }

    private fun specialAccessIntent(access: SpecialAccess): Intent = when (access) {
        SpecialAccess.ALL_FILES -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName"))
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
        }
        SpecialAccess.USAGE_STATS -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
    }

    @androidx.compose.runtime.Composable
    private fun BrokerDialog(request: UiRequest) {
        val (title, body, confirm) = when (request) {
            is UiRequest.Permissions -> Triple("Permission needed", request.rationale, "Continue")
            is UiRequest.Special -> Triple(request.access.label, request.access.rationale + "\n\nYou'll be taken to system settings; toggle LCDR on, then come back.", "Open settings")
            is UiRequest.Confirm -> Triple("Confirm", request.message, "Do it")
            is UiRequest.TakePhoto -> return
        }
        AlertDialog(
            onDismissRequest = { complete(false) },
            title = { Text(title) },
            text = { Text(body) },
            confirmButton = { TextButton(onClick = { proceed(request) }) { Text(confirm) } },
            dismissButton = { TextButton(onClick = { complete(false) }) { Text(if (request is UiRequest.Confirm) "Cancel" else "Not now") } },
        )
    }

    private fun canUseBiometrics() = BiometricManager.from(this)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL) ==
        BiometricManager.BIOMETRIC_SUCCESS

    private fun promptBiometric() {
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                locked = false
            }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock LCDR")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build()
        )
    }

    private companion object {
        const val RELOCK_AFTER_MS = 60_000L
    }
}

@androidx.compose.runtime.Composable
private fun LockedScreen(onUnlock: () -> Unit) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Default.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Text("LCDR is locked", style = MaterialTheme.typography.titleMedium)
        Button(onClick = onUnlock) { Text("Unlock") }
    }
}
