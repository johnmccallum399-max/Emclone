import { Router } from "express";
import multer from "multer";
import { toFile } from "openai";
import { z } from "zod";
import { env } from "../config/env.js";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { openai } from "../services/openaiClient.js";
import { createRealtimeSession } from "../services/realtime.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const voiceRouter = Router();

voiceRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * Mints an ephemeral session for the OpenAI Realtime API ("realtime" voice
 * mode). The browser uses the returned client secret to open a direct
 * WebRTC connection to OpenAI - our long-lived API key never leaves the
 * server.
 */
voiceRouter.post(
  "/realtime-session",
  asyncHandler(async (req, res) => {
    const { persona } = await getDb().getSettings(req.userId!);
    try {
      const session = await createRealtimeSession(persona.systemPrompt);
      res.json(session);
    } catch (err) {
      throw new HttpError(502, (err as Error).message);
    }
  })
);

/** Speech-to-text for the "pipeline" and "browser" voice modes. */
voiceRouter.post(
  "/transcribe",
  upload.single("audio"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "An 'audio' file is required");

    const file = await toFile(req.file.buffer, req.file.originalname || "audio.webm");
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: env.OPENAI_STT_MODEL,
    });

    res.json({ text: transcription.text });
  })
);

const speakSchema = z.object({ text: z.string().min(1).max(4000) });

/** Text-to-speech for the "pipeline" and "browser" voice modes. */
voiceRouter.post(
  "/speak",
  asyncHandler(async (req, res) => {
    const parsed = speakSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "A non-empty 'text' string is required");

    const speech = await openai.audio.speech.create({
      model: env.OPENAI_TTS_MODEL,
      voice: env.OPENAI_TTS_VOICE as any,
      input: parsed.data.text,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  })
);
