package com.lcdr.assistant.tools

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

enum class ToolCategory(val label: String) {
    COMMUNICATIONS("Communications"),
    CALENDAR("Calendar"),
    FILES("Files"),
    SYSTEM("System"),
    HUB("Orchestration hub"),
}

enum class ToolRisk {
    /** Read-only; not logged. */
    READ,
    /** Changes state; logged to action history. */
    WRITE,
    /** Sends, deletes or overwrites; confirmed by the owner first, then logged. */
    DESTRUCTIVE,
}

/** Access granted from a system settings page rather than a runtime dialog. */
enum class SpecialAccess(val label: String, val rationale: String) {
    ALL_FILES(
        "All files access",
        "LCDR needs all-files access to browse, read and write files anywhere in your storage when you ask it to.",
    ),
    USAGE_STATS(
        "Usage access",
        "LCDR needs usage access to see which apps you've used recently. Nothing leaves the device unless you ask about it.",
    ),
}

/** A capability the LLM can invoke that runs on this device. */
interface DeviceTool {
    val name: String
    val description: String
    val category: ToolCategory
    val risk: ToolRisk
    /** JSON Schema for the arguments (OpenAI function-calling format). */
    val parameters: JsonObject

    /** Runtime (dialog) permissions this call needs. */
    fun requiredPermissions(args: JsonObject): List<String> = emptyList()

    /** Settings-page access this call needs, if any. */
    fun specialAccess(args: JsonObject): SpecialAccess? = null

    /** Short owner-facing confirmation text, or null to run without asking. Only consulted for DESTRUCTIVE tools. */
    suspend fun confirmation(args: JsonObject): String? = null

    /** Runs the tool; the returned text is fed back to the model. Throw for failures. */
    suspend fun execute(args: JsonObject): String
}

class ToolException(message: String) : Exception(message)

// ---- Schema DSL ---------------------------------------------------------------

class SchemaBuilder {
    private val properties = linkedMapOf<String, JsonObject>()
    private val required = mutableListOf<String>()

    private fun prop(name: String, type: String, description: String, isRequired: Boolean, extra: Map<String, JsonElement> = emptyMap()) {
        properties[name] = buildJsonObject {
            put("type", type)
            put("description", description)
            extra.forEach { (k, v) -> put(k, v) }
        }
        if (isRequired) required += name
    }

    fun string(name: String, description: String, required: Boolean = false, enum: List<String>? = null) =
        prop(name, "string", description, required, enum?.let { mapOf("enum" to JsonArray(it.map { v -> JsonPrimitive(v) })) } ?: emptyMap())

    fun integer(name: String, description: String, required: Boolean = false) = prop(name, "integer", description, required)

    fun boolean(name: String, description: String, required: Boolean = false) = prop(name, "boolean", description, required)

    fun integerArray(name: String, description: String, required: Boolean = false) =
        prop(name, "array", description, required, mapOf("items" to buildJsonObject { put("type", "integer") }))

    fun build(): JsonObject = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") { properties.forEach { (k, v) -> put(k, v) } }
        putJsonArray("required") { required.forEach { add(JsonPrimitive(it)) } }
    }
}

fun schema(block: SchemaBuilder.() -> Unit = {}): JsonObject = SchemaBuilder().apply(block).build()

// ---- Argument helpers -----------------------------------------------------------

fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
fun JsonObject.requireStr(key: String): String = str(key) ?: throw ToolException("'$key' is required")
fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.let { it.intOrNull ?: it.contentOrNull?.toIntOrNull() }
fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() }
fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.let { it.booleanOrNull ?: it.contentOrNull?.toBooleanStrictOrNull() }
fun JsonObject.longList(key: String): List<Long> =
    (this[key] as? JsonArray)?.mapNotNull { it.jsonPrimitive.longOrNull } ?: emptyList()

