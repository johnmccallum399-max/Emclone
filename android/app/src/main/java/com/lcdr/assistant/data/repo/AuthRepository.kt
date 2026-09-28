package com.lcdr.assistant.data.repo

import com.lcdr.assistant.data.auth.TokenStore
import com.lcdr.assistant.data.remote.LcdrApi
import com.lcdr.assistant.data.remote.LoginRequest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(private val api: LcdrApi, private val tokens: TokenStore) {
    val token = tokens.token
    val username: String? get() = tokens.username

    suspend fun login(username: String, password: String) {
        val response = api.login(LoginRequest(username.trim(), password))
        tokens.save(response.token, response.user.username)
    }

    fun logout() = tokens.clear()
}
