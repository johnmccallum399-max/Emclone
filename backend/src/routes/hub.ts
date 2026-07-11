import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { decryptApiKey, encryptApiKey } from "../utils/crypto.js";

export const hubRouter = Router();

hubRouter.use(requireAuth);

hubRouter.get(
  "/agents",
  asyncHandler(async (req, res) => {
    const agents = await getDb().listHubAgents(req.userId!);
    res.json({
      agents: agents.map(({ apiKeyEnc: _enc, ...rest }) => ({
        ...rest,
        hasApiKey: true,
      })),
    });
  })
);

const createAgentSchema = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(["anthropic", "openai-compatible"]),
  model: z.string().min(1).max(120),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional().nullable(),
  persona: z.string().max(4000).optional().nullable(),
});

hubRouter.post(
  "/agents",
  asyncHandler(async (req, res) => {
    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid input");

    const { name, provider, model, apiKey, baseUrl, persona } = parsed.data;

    if (provider === "openai-compatible" && !baseUrl) {
      throw new HttpError(400, "baseUrl is required for openai-compatible providers");
    }

    const apiKeyEnc = encryptApiKey(apiKey, env.JWT_SECRET);
    const agent = await getDb().createHubAgent(
      req.userId!,
      name,
      provider,
      model,
      apiKeyEnc,
      baseUrl ?? null,
      persona ?? null
    );

    const { apiKeyEnc: _enc, ...safe } = agent;
    res.status(201).json({ agent: { ...safe, hasApiKey: true } });
  })
);

hubRouter.delete(
  "/agents/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid agent id");
    await getDb().deleteHubAgent(id, req.userId!);
    res.status(204).send();
  })
);

// Expose the decrypted key for use by internal server-side calls only —
// never call this from the browser client.
export async function getDecryptedApiKey(agentId: number, userId: number): Promise<string> {
  const agents = await getDb().listHubAgents(userId);
  const agent = agents.find((a) => a.id === agentId && a.userId === userId);
  if (!agent) throw new HttpError(404, "Agent not found");
  return decryptApiKey(agent.apiKeyEnc, env.JWT_SECRET);
}
