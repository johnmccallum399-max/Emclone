package com.lcdr.assistant.data.remote

import com.lcdr.assistant.data.auth.TokenStore
import com.lcdr.assistant.data.prefs.SettingsStore
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/** Retrofit is built against a placeholder host; this points each request at the configured backend. */
@Singleton
class BaseUrlInterceptor @Inject constructor(private val settings: SettingsStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val base = settings.current.backendUrl.toHttpUrlOrNull() ?: return chain.proceed(request)
        val basePath = base.encodedPath.trimEnd('/')
        val url = request.url.newBuilder()
            .scheme(base.scheme)
            .host(base.host)
            .port(base.port)
            .encodedPath(basePath + request.url.encodedPath)
            .build()
        return chain.proceed(request.newBuilder().url(url).build())
    }

    companion object {
        const val PLACEHOLDER = "http://lcdr.invalid/"
    }
}

/** Adds the JWT; on 401 clears it so the UI routes back to login. */
@Singleton
class AuthInterceptor @Inject constructor(private val tokens: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokens.token.value
        val request = if (token != null) {
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        val response = chain.proceed(request)
        if (response.code == 401 && token != null && !request.url.encodedPath.endsWith("/auth/login")) {
            tokens.clear()
        }
        return response
    }
}
