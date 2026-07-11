import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { ALL_TOOLS } from "../tools/registry.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

const VOICE_MODES = ["realtime", "elevenlabs", "pipeline", "browser", "native"] as const;

settingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const settings = await getDb().getSettings(req.userId!);
    const tools = ALL_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      permission: tool.permission,
      enabled: settings.toolPermissions[tool.name] !== false,
    }));
    res.json({
      persona: settings.persona,
      voiceMode: settings.voiceMode,
      tools,
      voiceModes: VOICE_MODES,
    });
  })
);

const personaSchema = z.object({
  name: z.string().min(1).max(50),
  systemPrompt: z.string().min(1).max(4000),
  description: z.string().max(500).optional().default(""),
});

settingsRouter.put(
  "/persona",
  asyncHandler(async (req, res) => {
    const parsed = personaSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid persona payload");
    await getDb().setPersona(req.userId!, parsed.data);
    res.status(204).send();
  })
);

const toolPermissionSchema = z.object({ enabled: z.boolean() });

settingsRouter.put(
  "/tools/:name",
  asyncHandler(async (req, res) => {
    const tool = ALL_TOOLS.find((t) => t.name === req.params.name);
    if (!tool) throw new HttpError(404, "Unknown tool");

    const parsed = toolPermissionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "'enabled' boolean is required");

    await getDb().setToolPermission(req.userId!, tool.name, parsed.data.enabled);
    res.status(204).send();
  })
);

const voiceModeSchema = z.object({ mode: z.enum(VOICE_MODES) });

settingsRouter.put(
  "/voice",
  asyncHandler(async (req, res) => {
    const parsed = voiceModeSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, `'mode' must be one of: ${VOICE_MODES.join(", ")}`);
    await getDb().setVoiceMode(req.userId!, parsed.data.mode);
    res.status(204).send();
  })
);
