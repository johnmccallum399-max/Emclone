package com.lcdr.assistant.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Brass = Color(0xFFC8A951)
private val Navy = Color(0xFF0E1116)
private val Steel = Color(0xFF1A1F27)
private val SteelHigh = Color(0xFF252C37)

private val Dark = darkColorScheme(
    primary = Brass,
    onPrimary = Navy,
    secondary = Color(0xFF8FA3B8),
    background = Navy,
    surface = Navy,
    surfaceVariant = Steel,
    surfaceContainer = Steel,
    surfaceContainerHigh = SteelHigh,
    onSurface = Color(0xFFE6E8EB),
    onSurfaceVariant = Color(0xFFA9B1BC),
    error = Color(0xFFE5736B),
)

private val Light = lightColorScheme(
    primary = Color(0xFF7A6420),
    secondary = Color(0xFF45566A),
)

@Composable
fun LcdrTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
