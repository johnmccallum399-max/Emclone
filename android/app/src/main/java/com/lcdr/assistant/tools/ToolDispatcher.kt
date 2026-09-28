package com.lcdr.assistant.tools

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import androidx.core.content.ContextCompat
import com.lcdr.assistant.data.local.ActionLogDao
import com.lcdr.assistant.data.local.ActionLogEntity
import com.lcdr.assistant.data.local.PendingActionDao
import com.lcdr.assistant.data.local.PendingActionEntity
import com.lcdr.assistant.data.prefs.SettingsStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject
import javax.inject.Singleton

data class ClientToolCall(val id: String, val name: String, val args: JsonObject)

data class ToolOutcome(val result: String, val ok: Boolean)

/**
 * Runs a model-requested device tool: enabled check → permissions (asked at
 * first use, with a plain-language reason) → owner confirmation for
 * destructive calls → execute → action log for anything that writes or sends.
 */
@Singleton
class ToolDispatcher @Inject constructor(
    @ApplicationContext private val context: Context,
    private val registry: ToolRegistry,
    private val settings: SettingsStore,
    private val broker: UiBroker,
    private val actionLog: ActionLogDao,
    private val pending: PendingActionDao,
    private val status: DeviceStatus,
) {
    suspend fun execute(conversationId: Long, call: ClientToolCall): ToolOutcome {
        val tool = registry[call.name] ?: return ToolOutcome("Error: unknown device tool '${call.name}'.", false)
        if (!settings.isToolEnabled(tool.name)) {
            return ToolOutcome("Error: '${tool.name}' is disabled in Settings → Tool permissions.", false)
        }

        try {
            val missing = tool.requiredPermissions(call.args).filterNot(::granted)
            if (missing.isNotEmpty()) {
                broker.requestPermissions(missing, PermissionRationale.explain(missing))
                // Location asks for fine+coarse; approximate-only is acceptable.
                val stillMissing = tool.requiredPermissions(call.args).filterNot(::granted)
                val locationOk = stillMissing.all { it == android.Manifest.permission.ACCESS_FINE_LOCATION } &&
                    granted(android.Manifest.permission.ACCESS_COARSE_LOCATION)
                if (stillMissing.isNotEmpty() && !locationOk) {
                    return log(tool, call, "denied_permission", "Error: permission not granted (${stillMissing.joinToString { it.substringAfterLast('.') }}).")
                }
            }

            tool.specialAccess(call.args)?.let { access ->
                if (!hasSpecialAccess(access) && (!broker.requestSpecialAccess(access) || !hasSpecialAccess(access))) {
                    return log(tool, call, "denied_permission", "Error: ${access.label} not granted.")
                }
            }

            if (tool.risk == ToolRisk.DESTRUCTIVE) {
                val prompt = tool.confirmation(call.args)
                if (prompt != null) {
                    pending.insert(PendingActionEntity(call.id, conversationId, tool.name, call.args.toString(), prompt))
                    val approved = broker.confirm(tool.name, prompt)
                    pending.setStatus(call.id, if (approved) "approved" else "declined")
                    if (!approved) {
                        val why = if (broker.hasForegroundUi) "The owner declined." else "Not run: confirmation needs the app open."
                        return log(tool, call, "declined", why)
                    }
                }
            }

            val result = withContext(Dispatchers.IO) { tool.execute(call.args) }
            return log(tool, call, "executed", Formatting.truncate(result, 30_000), ok = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: ToolException) {
            return log(tool, call, "failed", "Error: ${e.message}")
        } catch (e: SecurityException) {
            return log(tool, call, "denied_permission", "Error: permission denied (${e.message}).")
        } catch (e: Exception) {
            return log(tool, call, "failed", "Error: ${e::class.simpleName}: ${e.message}")
        }
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun hasSpecialAccess(access: SpecialAccess) = when (access) {
        SpecialAccess.ALL_FILES -> Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()
        SpecialAccess.USAGE_STATS -> status.hasUsageAccess()
    }

    private suspend fun log(tool: DeviceTool, call: ClientToolCall, outcome: String, result: String, ok: Boolean = false): ToolOutcome {
        if (tool.risk != ToolRisk.READ) {
            actionLog.insert(ActionLogEntity(tool = tool.name, argsJson = call.args.toString(), outcome = outcome, result = result.take(2000)))
        }
        return ToolOutcome(result, ok)
    }
}
