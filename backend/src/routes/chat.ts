import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import { streamChatResponse } from "../services/conversationService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const chatRouter = Router();

chatRouter.use(requireAuth);

// ---- Conversations -------------------------------------------------------

chatRouter.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const conversations = await getDb().listConversations(req.userId!);
    res.json({ conversations });
  })
);

const createConversationSchema = z.object({ title: z.string().min(1).max(200).optional() });

chatRouter.post(
  "/conversations",
  asyncHandler(async (req, res) => {
    const parsed = createConversationSchema.safeParse(req.body ?? {});
    const title = parsed.success && parsed.data.title ? parsed.data.title : "New conversation";
    const conversation = await getDb().createConversation(req.userId!, title);
    res.status(201).json({ conversation });
  })
);

chatRouter.get(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const conversation = await getDb().getConversation(id, req.userId!);
    if (!conversation) throw new HttpError(404, "Conversation not found");

    const messages = await getDb().getMessages(id, 200);
    res.json({ messages });
  })
);

chatRouter.delete(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await getDb().deleteConversation(id, req.userId!);
    res.status(204).send();
  })
);

// ---- Streaming chat --------------------------------------------------------

const sendMessageSchema = z.object({ message: z.string().min(1).max(8000) });

/**
 * Streams the assistant's reply as newline-delimited JSON events
 * (text/event-stream framing). Using a POST + readable stream (instead of
 * EventSource) lets the frontend send the Authorization header.
 */
chatRouter.post(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const conversation = await getDb().getConversation(id, req.userId!);
    if (!conversation) throw new HttpError(404, "Conversation not found");

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "A non-empty 'message' string is required");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    try {
      for await (const event of streamChatResponse(req.userId!, id, parsed.data.message)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: "error", message: (err as Error).message })}\n\n`);
    } finally {
      res.end();
    }
  })
);
