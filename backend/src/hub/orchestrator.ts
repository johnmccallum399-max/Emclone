import { getDb } from "../db/index.js";
import type {
  HubAgent,
  HubMessageRecord,
  HubSession,
  HubSessionMode,
  HubSessionStatus,
} from "../db/types.js";
import { logger } from "../utils/logger.js";
import { completeChat } from "./providers.js";

/**
 * The orchestration engine: runs a hub session by relaying a shared,
 * speaker-labeled transcript between the participating agents so they can
 * collaborate autonomously — no manual copy/pasting between accounts.
 */

export type HubRunEvent =
  | { type: "status"; status: HubSessionStatus }
  | { type: "turn_start"; agentId: number; agentName: string; round: number }
  | { type: "message"; message: HubMessageRecord }
  | { type: "turn_error"; agentId: number; agentName: string; message: string }
  | { type: "done"; status: HubSessionStatus }
  | { type: "error"; message: string };

/** Sessions currently executing, to reject concurrent runs. */
const runningSessions = new Set<number>();

/** Sessions asked to stop after the in-flight turn finishes. */
const stopRequests = new Set<number>();

/** Rough transcript budget (characters) sent to each agent per turn. */
const TRANSCRIPT_CHAR_BUDGET = 30_000;

export function isSessionRunning(sessionId: number): boolean {
  return runningSessions.has(sessionId);
}

/** Asks a running session to stop after the current turn. */
export function requestStop(sessionId: number): boolean {
  if (!runningSessions.has(sessionId)) return false;
  stopRequests.add(sessionId);
  return true;
}

const MODE_INSTRUCTIONS: Record<HubSessionMode, string> = {
  discussion: [
    "This is a collaborative working session. Read the transcript, build on the",
    "strongest ideas so far, respectfully disagree when warranted, and add",
    "something genuinely new each turn — do not restate what has been said.",
    "Address other participants by name when responding to their points.",
    "Keep each contribution focused and under roughly 250 words.",
  ].join(" "),
  debate: [
    "This is a structured debate. Take a clear position on the question, argue",
    "for it with evidence and reasoning, and directly challenge weak points in",
    "the other participants' arguments (address them by name). Concede points",
    "when you are genuinely convinced. Keep each contribution under roughly",
    "250 words.",
  ].join(" "),
  pipeline: [
    "This is an assembly line. Treat the most recent contribution in the",
    "transcript as the current draft of the deliverable. Your job is to improve",
    "and extend it: fix problems, fill gaps, and raise its quality. Output the",
    "complete improved version of the deliverable itself — not commentary about",
    "it. If there is no draft yet, produce the first one.",
  ].join(" "),
};

function describeParticipants(agents: HubAgent[]): string {
  return agents.map((agent) => `- ${agent.name} (${agent.provider}/${agent.model})`).join("\n");
}

function buildAgentSystemPrompt(agent: HubAgent, session: HubSession, agents: HubAgent[]): string {
  const parts: string[] = [];
  if (agent.systemPrompt.trim()) parts.push(agent.systemPrompt.trim());
  parts.push(
    [
      `You are "${agent.name}", one of ${agents.length} AI participants in a`,
      `multi-model working session run by an orchestration hub. The human who`,
      `convened the session may also interject as [User].`,
    ].join(" ")
  );
  parts.push(`Participants:\n${describeParticipants(agents)}`);
  parts.push(MODE_INSTRUCTIONS[session.mode]);
  parts.push(
    "Speak only as yourself. Never fabricate or roleplay contributions from other participants."
  );
  return parts.join("\n\n");
}

interface TranscriptEntry {
  authorName: string;
  content: string;
}

function renderTranscript(entries: TranscriptEntry[]): string {
  if (entries.length === 0) {
    return "(The session is just starting — nothing has been said yet. You speak first.)";
  }
  const lines = entries.map((entry) => `[${entry.authorName}]\n${entry.content}`);
  let rendered = lines.join("\n\n");
  // Trim oldest entries when the transcript outgrows the per-turn budget.
  let start = 0;
  while (rendered.length > TRANSCRIPT_CHAR_BUDGET && start < lines.length - 1) {
    start++;
    rendered = lines.slice(start).join("\n\n");
  }
  if (start > 0) rendered = `(...earlier messages omitted...)\n\n${rendered}`;
  return rendered;
}

function buildTurnPrompt(agent: HubAgent, session: HubSession, entries: TranscriptEntry[]): string {
  return [
    "=== Session goal ===",
    session.goal,
    "",
    "=== Transcript so far ===",
    renderTranscript(entries),
    "",
    "=== Your turn ===",
    `Reply with your next contribution as ${agent.name}. Output only the`,
    "contribution itself — no name prefix, no speaker labels.",
  ].join("\n");
}

function buildSynthesisPrompt(session: HubSession, entries: TranscriptEntry[]): string {
  return [
    "=== Session goal ===",
    session.goal,
    "",
    "=== Transcript so far ===",
    renderTranscript(entries),
    "",
    "=== Your turn ===",
    "The session is over. Synthesize the transcript into the single best final",
    "answer to the session goal: integrate the strongest points from every",
    "participant, resolve disagreements with your best judgment, and present a",
    "complete, self-contained result. Output only the final answer.",
  ].join("\n");
}

/**
 * Runs the session's rounds, persisting each turn and yielding progress
 * events. Re-running a session continues from the existing transcript with
 * another `maxRounds` rounds (plus synthesis if enabled).
 */
export async function* runHubSession(userId: number, sessionId: number): AsyncGenerator<HubRunEvent> {
  const db = getDb();

  const session = await db.getHubSession(sessionId, userId);
  if (!session) {
    yield { type: "error", message: "Session not found" };
    return;
  }
  if (runningSessions.has(sessionId)) {
    yield { type: "error", message: "Session is already running" };
    return;
  }

  const allAgents = await db.listHubAgents(userId);
  const agentsById = new Map(allAgents.map((agent) => [agent.id, agent]));
  const agents = session.agentIds
    .map((id) => agentsById.get(id))
    .filter((agent): agent is HubAgent => Boolean(agent));

  if (agents.length === 0) {
    yield { type: "error", message: "Session has no participating agents (were they deleted?)" };
    return;
  }

  runningSessions.add(sessionId);
  stopRequests.delete(sessionId);

  try {
    await db.setHubSessionStatus(sessionId, "running");
    yield { type: "status", status: "running" };

    const existing = await db.getHubMessages(sessionId);
    const transcript: TranscriptEntry[] = existing.map((m) => ({
      authorName: m.authorName,
      content: m.content,
    }));
    const startRound = existing.reduce((max, m) => Math.max(max, m.round), 0) + 1;

    let stopped = false;

    for (let round = startRound; round < startRound + session.maxRounds && !stopped; round++) {
      let successesThisRound = 0;

      for (const agent of agents) {
        if (stopRequests.has(sessionId)) {
          stopped = true;
          break;
        }

        yield { type: "turn_start", agentId: agent.id, agentName: agent.name, round };

        try {
          const content = await completeChat(agent, {
            system: buildAgentSystemPrompt(agent, session, agents),
            prompt: buildTurnPrompt(agent, session, transcript),
          });
          const message = await db.addHubMessage({
            sessionId,
            agentId: agent.id,
            authorName: agent.name,
            role: "agent",
            content: content.trim(),
            round,
          });
          transcript.push({ authorName: agent.name, content: message.content });
          successesThisRound++;
          yield { type: "message", message };
        } catch (err) {
          const message = (err as Error).message;
          logger.warn({ sessionId, agentId: agent.id, err: message }, "hub agent turn failed");
          yield { type: "turn_error", agentId: agent.id, agentName: agent.name, message };
          // Keep the failure visible in the shared transcript so other agents
          // (and later runs) know this participant missed the turn.
          const failureNote = await db.addHubMessage({
            sessionId,
            agentId: agent.id,
            authorName: "Hub",
            role: "system",
            content: `${agent.name} could not take this turn: ${message}`,
            round,
          });
          transcript.push({ authorName: failureNote.authorName, content: failureNote.content });
          yield { type: "message", message: failureNote };
        }
      }

      if (!stopped && successesThisRound === 0) {
        throw new Error("Every agent failed this round — check the agents' API keys and models.");
      }
    }

    if (!stopped && session.synthesize) {
      const synthesizer = agents[0];
      const round = startRound + session.maxRounds;
      yield { type: "turn_start", agentId: synthesizer.id, agentName: synthesizer.name, round };
      const content = await completeChat(synthesizer, {
        system: buildAgentSystemPrompt(synthesizer, session, agents),
        prompt: buildSynthesisPrompt(session, transcript),
      });
      const message = await db.addHubMessage({
        sessionId,
        agentId: synthesizer.id,
        authorName: `${synthesizer.name} (synthesis)`,
        role: "synthesis",
        content: content.trim(),
        round,
      });
      yield { type: "message", message };
    }

    const finalStatus: HubSessionStatus = stopped ? "stopped" : "completed";
    await db.setHubSessionStatus(sessionId, finalStatus);
    yield { type: "done", status: finalStatus };
  } catch (err) {
    await db.setHubSessionStatus(sessionId, "error");
    yield { type: "error", message: (err as Error).message };
  } finally {
    runningSessions.delete(sessionId);
    stopRequests.delete(sessionId);
  }
}
