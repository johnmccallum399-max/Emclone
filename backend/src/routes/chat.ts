import { Router, type Response } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/errorHandler.js";
import {
  resumeWithClientToolResults,
  streamChatResponse,
  type ChatStreamEvent,
} from "../services/conversationService.js";
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

const renameConversationSchema = z.object({ title: z.string().min(1).max(200) });

chatRouter.patch(
  "/conversations/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const parsed = renameConversationSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "A non-empty 'title' string (max 200 chars) is required");

    const conversation = await getDb().renameConversation(id, req.userId!, parsed.data.title);
    if (!conversation) throw new HttpError(404, "Conversation not found");
    res.json({ conversation });
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

const clientToolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  description: z.string().max(1000),
  parameters: z.record(z.unknown()),
});

/** Optional fields a client (e.g. the Android app) can attach to a chat request. */
const chatOptionsSchema = z.object({
  clientTools: z.array(clientToolSchema).max(64).optional(),
  systemPrompt: z.string().max(8000).optional(),
  clientContext: z.string().max(4000).optional(),
});

const sendMessageSchema = chatOptionsSchema.extend({ message: z.string().min(1).max(8000) });

const toolResultsSchema = chatOptionsSchema.extend({
  results: z
    .array(z.object({ toolCallId: z.string().min(1).max(200), result: z.string().max(50_000) }))
    .min(1)
    .max(32),
});

async function writeEventStream(res: Response, events: AsyncGenerator<ChatStreamEvent>) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    for await (const event of events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", message: (err as Error).message })}\n\n`);
  } finally {
    res.end();
  }
}

/**
 * Streams the assistant's reply as newline-delimited JSON events
 * (text/event-stream framing). Using a POST + readable stream (instead of
 * EventSource) lets the frontend send the Authorization header.
 *
 * If the request advertises `clientTools` and the model calls one, the
 * stream emits `client_tool_call` events followed by `awaiting_client_tools`
 * and ends; the client runs the tools and POSTs to `/tool-results`.
 */
chatRouter.post(
  "/conversations/:id/messages",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const conversation = await getDb().getConversation(id, req.userId!);
    if (!conversation) throw new HttpError(404, "Conversation not found");

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "A non-empty 'message' string is required");

    const { message, ...options } = parsed.data;
    await writeEventStream(res, streamChatResponse(req.userId!, id, message, options));
  })
);

/** Resumes a turn paused on `awaiting_client_tools` with the client's results. */
chatRouter.post(
  "/conversations/:id/tool-results",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const conversation = await getDb().getConversation(id, req.userId!);
    if (!conversation) throw new HttpError(404, "Conversation not found");

    const parsed = toolResultsSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "A non-empty 'results' array is required");

    const { results, ...options } = parsed.data;
    await writeEventStream(res, resumeWithClientToolResults(req.userId!, id, results, options));
  })
);
