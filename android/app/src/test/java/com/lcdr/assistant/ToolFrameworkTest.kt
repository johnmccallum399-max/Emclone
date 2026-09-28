package com.lcdr.assistant

import com.lcdr.assistant.tools.Formatting
import com.lcdr.assistant.tools.ToolException
import com.lcdr.assistant.tools.bool
import com.lcdr.assistant.tools.int
import com.lcdr.assistant.tools.longList
import com.lcdr.assistant.tools.schema
import com.lcdr.assistant.tools.str
import com.lcdr.assistant.ui.chat.ChatViewModel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ToolFrameworkTest {
    private val utc = ZoneId.of("UTC")

    @Test fun schemaBuildsOpenAiFunctionParameters() {
        val s = schema {
            string("to", "Recipient", required = true)
            integer("limit", "Max")
            string("mode", "Mode", enum = listOf("a", "b"))
            integerArray("ids", "Ids")
        }
        assertEquals("object", s["type"]!!.jsonPrimitive.content)
        val props = s["properties"]!!.jsonObject
        assertEquals(listOf("to", "limit", "mode", "ids"), props.keys.toList())
        assertEquals("integer", props["limit"]!!.jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals(2, props["mode"]!!.jsonObject["enum"]!!.jsonArray.size)
        assertEquals("integer", props["ids"]!!.jsonObject["items"]!!.jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals(listOf("to"), (s["required"] as JsonArray).map { it.jsonPrimitive.content })
    }

    @Test fun argumentHelpersTolerateStringlyTypedModelOutput() {
        val args = Json.parseToJsonElement("""{"limit":"5","flag":"true","blank":"  ","ids":[1,2]}""") as JsonObject
        assertEquals(5, args.int("limit"))
        assertEquals(true, args.bool("flag"))
        assertNull(args.str("blank"))
        assertNull(args.str("missing"))
        assertEquals(listOf(1L, 2L), args.longList("ids"))
    }

    @Test fun parsesCommonDateTimeShapes() {
        assertEquals("2026-09-28T14:30Z[UTC]", Formatting.parseDateTime("2026-09-28T14:30", utc).toString())
        assertEquals("2026-09-28T14:30Z[UTC]", Formatting.parseDateTime("2026-09-28 14:30", utc).toString())
        assertEquals("2026-09-28T12:30Z[UTC]", Formatting.parseDateTime("2026-09-28T14:30+02:00", utc).toString())
        assertEquals("2026-09-28T00:00Z[UTC]", Formatting.parseDateTime("2026-09-28", utc).toString())
        assertEquals(LocalDate.now(utc), Formatting.parseDateTime("09:15", utc).toLocalDate())
        assertTrue(Formatting.isDateOnly("2026-09-28"))
    }

    @Test(expected = ToolException::class)
    fun rejectsUnparseableDates() {
        Formatting.parseDateTime("next tuesday-ish", utc)
    }

    @Test fun truncatesLongResults() {
        val out = Formatting.truncate("x".repeat(150), 100)
        assertTrue(out.startsWith("x".repeat(100)))
        assertTrue(out.endsWith("[truncated 50 chars]"))
    }

    @Test fun summarizesToolArgsForChips() {
        val args = Json.parseToJsonElement("""{"to":"Mom","message":"${"a".repeat(60)}"}""") as JsonObject
        val summary = ChatViewModel.summarize(args)
        assertTrue(summary.startsWith("to: Mom, message: "))
        assertTrue(summary.endsWith("…"))
    }
}
