package com.lcdr.assistant.di

import android.content.Context
import androidx.room.Room
import com.lcdr.assistant.BuildConfig
import com.lcdr.assistant.data.local.LcdrDatabase
import com.lcdr.assistant.data.remote.AuthInterceptor
import com.lcdr.assistant.data.remote.BaseUrlInterceptor
import com.lcdr.assistant.data.remote.LcdrApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        coerceInputValues = true
    }

    @Provides @Singleton
    fun okHttp(baseUrl: BaseUrlInterceptor, auth: AuthInterceptor): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(baseUrl)
            .addInterceptor(auth)
            .apply {
                if (BuildConfig.DEBUG) {
                    addInterceptor(HttpLoggingInterceptor().setLevel(HttpLoggingInterceptor.Level.BASIC))
                }
            }
            // Render free-tier cold starts can take ~50s.
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()

    @Provides @Singleton
    fun api(client: OkHttpClient, json: Json): LcdrApi =
        Retrofit.Builder()
            .baseUrl(BaseUrlInterceptor.PLACEHOLDER)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(LcdrApi::class.java)

    @Provides @Singleton
    fun database(@ApplicationContext context: Context): LcdrDatabase =
        Room.databaseBuilder(context, LcdrDatabase::class.java, "lcdr.db").build()

    @Provides fun conversationDao(db: LcdrDatabase) = db.conversations()
    @Provides fun messageDao(db: LcdrDatabase) = db.messages()
    @Provides fun memoryDao(db: LcdrDatabase) = db.memory()
    @Provides fun actionLogDao(db: LcdrDatabase) = db.actionLog()
    @Provides fun pendingActionDao(db: LcdrDatabase) = db.pendingActions()
}
