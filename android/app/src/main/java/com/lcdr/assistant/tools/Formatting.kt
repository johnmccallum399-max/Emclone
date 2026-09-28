package com.lcdr.assistant.tools

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

internal object Formatting {
    private val stamp = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")

    fun millis(epochMillis: Long): String =
        stamp.format(Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()))

    /** Accepts ISO date-times with or without offset, plain dates (start of day) and "HH:mm" (today). */
    fun parseDateTime(text: String, zone: ZoneId = ZoneId.systemDefault()): ZonedDateTime {
        val t = text.trim().replace(' ', 'T')
        runCatching { return OffsetDateTime.parse(t).atZoneSameInstant(zone) }
        runCatching { return ZonedDateTime.parse(t).withZoneSameInstant(zone) }
        runCatching { return LocalDateTime.parse(t).atZone(zone) }
        runCatching { return LocalDate.parse(t).atStartOfDay(zone) }
        runCatching { return LocalDate.now(zone).atTime(LocalTime.parse(t)).atZone(zone) }
        throw ToolException("Could not parse date/time '$text'. Use ISO 8601, e.g. 2026-09-28T14:30")
    }

    fun isDateOnly(text: String) = runCatching { LocalDate.parse(text.trim()) }.isSuccess

    fun truncate(text: String, max: Int = 20_000): String =
        if (text.length <= max) text else text.take(max) + "\n…[truncated ${text.length - max} chars]"
}
