package com.lcdr.assistant.data.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/** JWT + username, encrypted at rest (AES-256 GCM values, AES-256 SIV keys, Keystore-backed master key). */
@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "lcdr_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val _token = MutableStateFlow(prefs.getString(KEY_TOKEN, null))
    val token: StateFlow<String?> = _token.asStateFlow()

    val username: String? get() = prefs.getString(KEY_USERNAME, null)

    fun save(token: String, username: String) {
        prefs.edit { putString(KEY_TOKEN, token); putString(KEY_USERNAME, username) }
        _token.value = token
    }

    fun clear() {
        prefs.edit { remove(KEY_TOKEN) }
        _token.value = null
    }

    private companion object {
        const val KEY_TOKEN = "jwt"
        const val KEY_USERNAME = "username"
    }
}
