package com.lcdr.assistant.tools

import com.lcdr.assistant.data.remote.CreateHubSessionRequest
import com.lcdr.assistant.data.repo.HubEvent
import com.lcdr.assistant.data.repo.HubRepository
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject

class HubListAgentsTool @Inject constructor(private val hub: HubRepository) : DeviceTool {
    override val name = "hub_list_agents"
    override val description = "List the orchestration hub's configured LLM agents (ids, providers, models)."
    override val category = ToolCategory.HUB
    override val risk = ToolRisk.READ
    override val parameters = schema()

    override suspend fun execute(args: JsonObject): String {
        val agents = hub.agents()
        if (agents.isEmpty()) return "No hub agents configured."
        return agents.joinToString("\n") { "#${it.id} ${it.name} — ${it.provider}/${it.model}" }
    }
}

class HubCreateSessionTool @Inject constructor(private val hub: HubRepository) : DeviceTool {
    override val name = "hub_create_session"
    override val description = "Create a multi-agent hub session. Run it with hub_run_session."
    override val category = ToolCategory.HUB
    override val risk = ToolRisk.WRITE
    override val parameters = schema {
        string("goal", "What the agents should accomplish", required = true)
        integerArray("agent_ids", "Participating agent ids, in speaking order", required = true)
        string("mode", "Collaboration mode", enum = listOf("discussion", "debate", "pipeline"))
        integer("max_rounds", "Rounds (1–10, default 3)")
    }

    override suspend fun execute(args: JsonObject): String {
        val ids = args.longList("agent_ids").ifEmpty { throw ToolException("'agent_ids' needs at least one id.") }
        val session = hub.create(
            CreateHubSessionRequest(
                goal = args.requireStr("goal"),
                agentIds = ids,
                mode = args.str("mode") ?: "discussion",
                maxRounds = (args.int("max_rounds") ?: 3).coerceIn(1, 10),
            )
        )
        return "Created hub session #${session.id} \"${session.title}\" (${session.mode}, ${session.maxRounds} rounds)."
    }
}

class HubRunSessionTool @Inject constructor(private val hub: HubRepository) : DeviceTool {
    override val name = "hub_run_session"
    override val description = "Run a hub session to completion and return the transcript (can take a few minutes)."
    override val category = ToolCategory.HUB
    override val risk = ToolRisk.WRITE
    override val parameters = schema { integer("session_id", "Hub session id", required = true) }

    override suspend fun execute(args: JsonObject): String {
        val id = args.long("session_id") ?: throw ToolException("'session_id' is required")
        val transcript = StringBuilder()
        var status = "unknown"
        hub.run(id).collect { event ->
            when (event) {
                is HubEvent.Message -> transcript.append("[${event.message.authorName}, round ${event.message.round}] ")
                    .append(event.message.content).append("\n\n")
                is HubEvent.TurnError -> transcript.append("[${event.agentName} failed] ${event.message}\n\n")
                is HubEvent.Done -> status = event.status
                is HubEvent.Error -> throw ToolException(event.message)
                else -> Unit
            }
        }
        return Formatting.truncate("Session #$id finished ($status).\n\n$transcript", 30_000)
    }
}
