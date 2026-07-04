import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import type { HubAgent } from "../db/types.js";
import { isSessionRunning, requestStop, runHubSession } from "../hub/orchestrator.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sealSecret } from "../utils/secretBox.js";

export const hubRouter = Router();

hubRouter.use(requireAuth);

/** Agents as sent to the client — the API key never leaves the server. */
function toPublicAgent(agent: HubAgent) {
  return {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    baseUrl: agent.baseUrl,
    systemPrompt: agent.systemPrompt,
    createdAt: agent.createdAt,
  };
}

// ---- Agents ---------------------------------------------------------------

const providerSchema = z.enum(["openai", "anthropic", "google", "openai_compatible"]);

const createAgentSchema = z
  .object({
    name: z.string().min(1).max(80),
    provider: providerSchema,
    model: z.string().min(1).max(120),
    apiKey: z.string().min(1).max(500),
    baseUrl: z.string().url().max(500).nullish(),
    systemPrompt: z.string().max(8000).optional(),
  })
  .refine((data) => data.provider !== "openai_compatible" || Boolean(data.baseUrl), {
    message: "baseUrl is required for openai_compatible providers",
  });

hubRouter.get(
  "/agents",
  asyncHandler(async (req, res) => {
    const agents = await getDb().listHubAgents(req.userId!);
    res.json({ agents: agents.map(toPublicAgent) });
  })
);

hubRouter.post(
  "/agents",
  asyncHandler(async (req, res) => {
    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid agent");

    const agent = await getDb().createHubAgent({
      userId: req.userId!,
      name: parsed.data.name,
      provider: parsed.data.provider,
      model: parsed.data.model,
      apiKeySealed: sealSecret(parsed.data.apiKey),
      baseUrl: parsed.data.baseUrl ?? null,
      systemPrompt: parsed.data.systemPrompt ?? "",
    });
    res.status(201).json({ agent: toPublicAgent(agent) });
  })
);

const updateAgentSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  provider: providerSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  baseUrl: z.string().url().max(500).nullish(),
  systemPrompt: z.string().max(8000).optional(),
});

hubRouter.patch(
  "/agents/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = updateAgentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid agent");

    const agent = await getDb().updateHubAgent(id, req.userId!, {
      name: parsed.data.name,
      provider: parsed.data.provider,
      model: parsed.data.model,
      apiKeySealed: parsed.data.apiKey !== undefined ? sealSecret(parsed.data.apiKey) : undefined,
      baseUrl: parsed.data.baseUrl === undefined ? undefined : parsed.data.baseUrl,
      systemPrompt: parsed.data.systemPrompt,
    });
    if (!agent) throw new HttpError(404, "Agent not found");
    res.json({ agent: toPublicAgent(agent) });
  })
);

hubRouter.delete(
  "/agents/:id",
  asyncHandler(async (req, res) => {
    await getDb().deleteHubAgent(Number(req.params.id), req.userId!);
    res.status(204).send();
  })
);

// ---- Sessions ---------------------------------------------------------------

const createSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  goal: z.string().min(1).max(8000),
  mode: z.enum(["discussion", "debate", "pipeline"]).default("discussion"),
  maxRounds: z.coerce.number().int().min(1).max(10).default(3),
  synthesize: z.boolean().default(true),
  agentIds: z.array(z.number().int().positive()).min(1).max(8),
});

hubRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const sessions = await getDb().listHubSessions(req.userId!);
    res.json({
      sessions: sessions.map((session) => ({
        ...session,
        status: isSessionRunning(session.id) ? "running" : session.status,
      })),
    });
  })
);

hubRouter.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid session");

    const db = getDb();
    for (const agentId of parsed.data.agentIds) {
      const agent = await db.getHubAgent(agentId, req.userId!);
      if (!agent) throw new HttpError(400, `Agent ${agentId} not found`);
    }

    const title =
      parsed.data.title ??
      (parsed.data.goal.length > 60 ? `${parsed.data.goal.slice(0, 57)}...` : parsed.data.goal);

    const session = await db.createHubSession({
      userId: req.userId!,
      title,
      goal: parsed.data.goal,
      mode: parsed.data.mode,
      maxRounds: parsed.data.maxRounds,
      synthesize: parsed.data.synthesize,
      agentIds: parsed.data.agentIds,
    });
    res.status(201).json({ session });
  })
);

hubRouter.get(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const session = await db.getHubSession(id, req.userId!);
    if (!session) throw new HttpError(404, "Session not found");

    const messages = await db.getHubMessages(id);
    const agents = await db.listHubAgents(req.userId!);
    const participants = agents.filter((agent) => session.agentIds.includes(agent.id));
    res.json({
      session: { ...session, status: isSessionRunning(id) ? "running" : session.status },
      messages,
      agents: participants.map(toPublicAgent),
    });
  })
);

hubRouter.delete(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (isSessionRunning(id)) throw new HttpError(409, "Stop the session before deleting it");
    await getDb().deleteHubSession(id, req.userId!);
    res.status(204).send();
  })
);

// ---- User interjections -----------------------------------------------------

const interjectSchema = z.object({ content: z.string().min(1).max(8000) });

hubRouter.post(
  "/sessions/:id/messages",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = interjectSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "A non-empty 'content' string is required");

    const db = getDb();
    const session = await db.getHubSession(id, req.userId!);
    if (!session) throw new HttpError(404, "Session not found");
    if (isSessionRunning(id)) {
      throw new HttpError(409, "Wait for the session to pause before interjecting");
    }

    const existing = await db.getHubMessages(id);
    const round = existing.reduce((max, m) => Math.max(max, m.round), 0);
    const message = await db.addHubMessage({
      sessionId: id,
      authorName: "User",
      role: "user",
      content: parsed.data.content,
      round,
    });
    res.status(201).json({ message });
  })
);

// ---- Run / stop ---------------------------------------------------------------

/**
 * Runs the session's agent rounds, streaming progress as SSE frames.
 * POST (not EventSource) so the Authorization header can be sent.
 */
hubRouter.post(
  "/sessions/:id/run",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const session = await getDb().getHubSession(id, req.userId!);
    if (!session) throw new HttpError(404, "Session not found");
    if (isSessionRunning(id)) throw new HttpError(409, "Session is already running");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Keep orchestrating even if the client disconnects mid-run; the
    // transcript is persisted and can be reloaded. Writing to a closed
    // response is a no-op.
    try {
      for await (const event of runHubSession(req.userId!, id)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: "error", message: (err as Error).message })}\n\n`);
    } finally {
      res.end();
    }
  })
);

hubRouter.post(
  "/sessions/:id/stop",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const session = await getDb().getHubSession(id, req.userId!);
    if (!session) throw new HttpError(404, "Session not found");

    const stopping = requestStop(id);
    res.json({ stopping });
  })
);
