package com.lcdr.assistant.tools

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import javax.inject.Inject
import javax.inject.Singleton

data class CalendarEvent(
    val id: Long,
    val title: String,
    val begin: Long,
    val end: Long,
    val allDay: Boolean,
    val location: String?,
    val calendar: String?,
)

@Singleton
class CalendarRepository @Inject constructor(@ApplicationContext private val context: Context) {

    fun instances(startMillis: Long, endMillis: Long): List<CalendarEvent> {
        val uri = Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, startMillis)
            ContentUris.appendId(it, endMillis)
        }.build()
        val out = mutableListOf<CalendarEvent>()
        context.contentResolver.query(
            uri,
            arrayOf(Instances.EVENT_ID, Instances.TITLE, Instances.BEGIN, Instances.END, Instances.ALL_DAY, Instances.EVENT_LOCATION, Instances.CALENDAR_DISPLAY_NAME),
            "${Instances.VISIBLE} = 1", null, "${Instances.BEGIN} ASC",
        )?.use { c ->
            while (c.moveToNext()) {
                out += CalendarEvent(
                    id = c.getLong(0),
                    title = c.getString(1) ?: "(no title)",
                    begin = c.getLong(2),
                    end = c.getLong(3),
                    allDay = c.getInt(4) == 1,
                    location = c.getString(5)?.takeIf { it.isNotBlank() },
                    calendar = c.getString(6),
                )
            }
        }
        return out
    }

    fun today(zone: ZoneId = ZoneId.systemDefault()): List<CalendarEvent> {
        val start = LocalDate.now(zone).atStartOfDay(zone)
        return instances(start.toInstant().toEpochMilli(), start.plusDays(1).toInstant().toEpochMilli())
    }

    fun format(e: CalendarEvent): String = buildString {
        append("#${e.id} ")
        if (e.allDay) append("[all day ${Formatting.millis(e.begin).take(10)}]")
        else append("[${Formatting.millis(e.begin)} – ${Formatting.millis(e.end).takeLast(5)}]")
        append(" ").append(e.title)
        e.location?.let { append(" @ ").append(it) }
        e.calendar?.let { append(" (").append(it).append(")") }
    }

    /** Primary calendar the owner can write to, else the first writable visible one. */
    fun defaultWritableCalendar(): Long? = context.contentResolver.query(
        CalendarContract.Calendars.CONTENT_URI,
        arrayOf(CalendarContract.Calendars._ID),
        "${CalendarContract.Calendars.VISIBLE} = 1 AND ${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR}",
        null,
        "${CalendarContract.Calendars.IS_PRIMARY} DESC, ${CalendarContract.Calendars._ID} ASC",
    )?.use { if (it.moveToFirst()) it.getLong(0) else null }

    fun eventTitle(id: Long): String? = context.contentResolver.query(
        ContentUris.withAppendedId(Events.CONTENT_URI, id), arrayOf(Events.TITLE, Events.DTSTART), null, null, null,
    )?.use { if (it.moveToFirst()) "${it.getString(0)} (${Formatting.millis(it.getLong(1))})" else null }
}

class ListEventsTool @Inject constructor(private val calendar: CalendarRepository) : DeviceTool {
    override val name = "list_events"
    override val description = "List calendar events between two dates/times (ISO 8601). Defaults to today. Returns event ids for delete_event."
    override val category = ToolCategory.CALENDAR
    override val risk = ToolRisk.READ
    override val parameters = schema {
        string("start", "Range start, e.g. 2026-09-28 or 2026-09-28T09:00. Default: start of today")
        string("end", "Range end (exclusive). Default: one day after start")
    }

    override fun requiredPermissions(args: JsonObject) = listOf(Manifest.permission.READ_CALENDAR)

    override suspend fun execute(args: JsonObject): String {
        val zone = ZoneId.systemDefault()
        val start = args.str("start")?.let { Formatting.parseDateTime(it, zone) } ?: LocalDate.now(zone).atStartOfDay(zone)
        val end = args.str("end")?.let {
            val parsed = Formatting.parseDateTime(it, zone)
            // A bare end date means "through that day".
            if (Formatting.isDateOnly(it)) parsed.plusDays(1) else parsed
        } ?: start.plusDays(1)
        val events = calendar.instances(start.toInstant().toEpochMilli(), end.toInstant().toEpochMilli())
        return if (events.isEmpty()) "No events." else events.joinToString("\n", transform = calendar::format)
    }
}

class CreateEventTool @Inject constructor(
    @ApplicationContext private val context: Context,
    private val calendar: CalendarRepository,
) : DeviceTool {
    override val name = "create_event"
    override val description = "Create a calendar event on the primary calendar. Times are local unless an offset is given."
    override val category = ToolCategory.CALENDAR
    override val risk = ToolRisk.WRITE
    override val parameters = schema {
        string("title", "Event title", required = true)
        string("start", "Start, ISO 8601 (a bare date makes an all-day event)", required = true)
        string("end", "End, ISO 8601. Default: start + 1 hour")
        string("location", "Location")
        string("notes", "Description / notes")
    }

    override fun requiredPermissions(args: JsonObject) =
        listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)

    override suspend fun execute(args: JsonObject): String {
        val calendarId = calendar.defaultWritableCalendar() ?: throw ToolException("No writable calendar on this device.")
        val zone = ZoneId.systemDefault()
        val startText = args.requireStr("start")
        val allDay = Formatting.isDateOnly(startText)
        val values = ContentValues().apply {
            put(Events.CALENDAR_ID, calendarId)
            put(Events.TITLE, args.requireStr("title"))
            args.str("location")?.let { put(Events.EVENT_LOCATION, it) }
            args.str("notes")?.let { put(Events.DESCRIPTION, it) }
            if (allDay) {
                // All-day events are stored at UTC midnight.
                val day = LocalDate.parse(startText.trim())
                val endDay = args.str("end")?.let { LocalDate.parse(it.trim().take(10)) }?.plusDays(1) ?: day.plusDays(1)
                put(Events.DTSTART, day.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
                put(Events.DTEND, endDay.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
                put(Events.ALL_DAY, 1)
                put(Events.EVENT_TIMEZONE, "UTC")
            } else {
                val start = Formatting.parseDateTime(startText, zone)
                val end = args.str("end")?.let { Formatting.parseDateTime(it, zone) } ?: start.plusHours(1)
                if (!end.isAfter(start)) throw ToolException("End must be after start.")
                put(Events.DTSTART, start.toInstant().toEpochMilli())
                put(Events.DTEND, end.toInstant().toEpochMilli())
                put(Events.EVENT_TIMEZONE, zone.id)
            }
        }
        val uri = context.contentResolver.insert(Events.CONTENT_URI, values) ?: throw ToolException("Calendar provider rejected the event.")
        return "Created event #${ContentUris.parseId(uri)}."
    }
}

class DeleteEventTool @Inject constructor(
    @ApplicationContext private val context: Context,
    private val calendar: CalendarRepository,
) : DeviceTool {
    override val name = "delete_event"
    override val description = "Delete a calendar event by id (from list_events). Deletes the whole series for recurring events."
    override val category = ToolCategory.CALENDAR
    override val risk = ToolRisk.DESTRUCTIVE
    override val parameters = schema { integer("id", "Event id", required = true) }

    override fun requiredPermissions(args: JsonObject) =
        listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)

    private fun id(args: JsonObject) = args.long("id") ?: throw ToolException("'id' is required")

    override suspend fun confirmation(args: JsonObject): String {
        val title = calendar.eventTitle(id(args)) ?: throw ToolException("No event #${id(args)}.")
        return "Delete event: $title?"
    }

    override suspend fun execute(args: JsonObject): String {
        val rows = context.contentResolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, id(args)), null, null)
        return if (rows > 0) "Deleted event #${id(args)}." else throw ToolException("No event #${id(args)}.")
    }
}
