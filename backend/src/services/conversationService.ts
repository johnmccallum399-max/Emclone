import type OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/index.js";
import { env } from "../config/env.js";
import { getDb, type ChatMessageRecord } from "../db/index.js";
import { openai } from "./openaiClient.js";
import { executeTool, getEnabledTools, toOpenAITools } from "../tools/registry.js";

/** Maximum number of recent messages loaded as short-term memory for the model. */
const HISTORY_LIMIT = 30;

/** Safety cap on tool-call round trips per user turn. */
const MAX_TOOL_ROUNDS = 5;

export type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: string }
  | { type: "client_tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "awaiting_client_tools"; toolCallIds: string[] }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

/**
 * A tool that runs on the calling client (e.g. the Android app's SMS or
 * calendar access) rather than on the server. The client advertises these
 * per request; when the model calls one, the stream pauses with an
 * `awaiting_client_tools` event and resumes once the client posts results.
 */
export interface ClientToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequestOptions {
  clientTools?: ClientToolDefinition[];
  /** Replaces the stored persona prompt for this request. */
  systemPrompt?: string;
  /** Live per-request context (time, battery, location...) appended to the system prompt. */
  clientContext?: string;
}

export interface ClientToolResult {
  toolCallId: string;
  result: string;
}

async function buildSystemPrompt(userId: number, options: ChatRequestOptions): Promise<string> {
  const { persona } = await getDb().getSettings(userId);
  const memory = await getDb().listMemory(userId);

  let prompt = options.systemPrompt || persona.systemPrompt;
  if (memory.length > 0) {
    prompt += "\n\nKnown facts about the user (from long-term memory):\n";
    prompt += memory.map((m) => `- ${m.key}: ${m.value}`).join("\n");
  }
  if (options.clientContext) {
    prompt += `\n\nLive device context:\n${options.clientContext}`;
  }
  return prompt;
}

/**
 * History is loaded with a row limit, which can cut between an assistant
 * tool-call message and its tool results. OpenAI rejects a `tool` message
 * without its preceding request, so drop any orphaned leading tool rows.
 */
function trimOrphanedToolMessages(history: ChatMessageRecord[]): ChatMessageRecord[] {
  let start = 0;
  while (start < history.length && history[start].role === "tool") start++;
  return history.slice(start);
}

/** Tool calls from the latest assistant message that have no tool result yet. */
export function findPendingToolCalls(history: ChatMessageRecord[]): AccumulatedToolCall[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    if (record.role === "user") return [];
    if (record.role === "assistant" && record.toolCalls) {
      const calls = JSON.parse(record.toolCalls) as AccumulatedToolCall[];
      const answered = new Set(history.slice(i + 1).map((m) => m.toolCallId));
      return calls.filter((call) => !answered.has(call.id));
    }
    if (record.role === "assistant") return [];
  }
  return [];
}

function toOpenAIMessage(record: ChatMessageRecord): ChatCompletionMessageParam {
  switch (record.role) {
    case "user":
      return { role: "user", content: record.content };
    case "assistant": {
      const toolCalls = record.toolCalls ? JSON.parse(record.toolCalls) : undefined;
      return {
        role: "assistant",
        content: record.content || null,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      } as ChatCompletionMessageParam;
    }
    case "tool":
      return {
        role: "tool",
        tool_call_id: record.toolCallId ?? "",
        content: record.content,
      };
    default:
      return { role: "user", content: record.content };
  }
}

interface AccumulatedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/**
 * Runs one user turn: saves the user message, calls the model (streaming),
 * executes any requested tools, and yields incremental events. The final
 * assistant message is persisted before the generator completes.
 */
export async function* streamChatResponse(
  userId: number,
  conversationId: number,
  userMessage: string,
  options: ChatRequestOptions = {}
): AsyncGenerator<ChatStreamEvent> {
  const db = getDb();
  // A previous turn may have paused on client tools that were never answered
  // (app closed, user cancelled). Close them out so the history stays valid.
  for (const call of findPendingToolCalls(await db.getMessages(conversationId, HISTORY_LIMIT))) {
    await db.addMessage({
      conversationId,
      role: "tool",
      content: "Error: cancelled before the device returned a result.",
      toolCallId: call.id,
      name: call.function.name,
    });
  }
  await db.addMessage({ conversationId, role: "user", content: userMessage });
  yield* runModelLoop(userId, conversationId, options);
}

/**
 * Resumes a turn that paused on `awaiting_client_tools`: persists the
 * client's tool results, then lets the model continue.
 */
export async function* resumeWithClientToolResults(
  userId: number,
  conversationId: number,
  results: ClientToolResult[],
  options: ChatRequestOptions = {}
): AsyncGenerator<ChatStreamEvent> {
  const db = getDb();
  const pending = findPendingToolCalls(await db.getMessages(conversationId, HISTORY_LIMIT));
  const pendingById = new Map(pending.map((call) => [call.id, call]));

  for (const { toolCallId } of results) {
    if (!pendingById.has(toolCallId)) {
      yield { type: "error", message: `No pending tool call with id '${toolCallId}'.` };
      return;
    }
  }

  const resultsById = new Map(results.map((r) => [r.toolCallId, r.result]));
  for (const call of pending) {
    // A call the client never answered still needs a tool message, or the
    // model rejects the history on the next request.
    const result = resultsById.get(call.id) ?? "Error: the device did not return a result for this tool call.";
    await db.addMessage({ conversationId, role: "tool", content: result, toolCallId: call.id, name: call.function.name });
    yield { type: "tool_result", name: call.function.name, result };
  }

  yield* runModelLoop(userId, conversationId, options);
}

async function* runModelLoop(
  userId: number,
  conversationId: number,
  options: ChatRequestOptions
): AsyncGenerator<ChatStreamEvent> {
  const db = getDb();

  const enabledTools = await getEnabledTools(userId);
  const serverToolNames = new Set(enabledTools.map((tool) => tool.name));
  // Server tools win on a name clash so a client can't shadow them.
  const clientTools = (options.clientTools ?? []).filter((tool) => !serverToolNames.has(tool.name));
  const clientToolNames = new Set(clientTools.map((tool) => tool.name));
  const openaiTools: ChatCompletionTool[] = [
    ...toOpenAITools(enabledTools),
    ...clientTools.map((tool) => ({
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })),
  ];
  const systemPrompt = await buildSystemPrompt(userId, options);

  const history = trimOrphanedToolMessages(await db.getMessages(conversationId, HISTORY_LIMIT));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map(toOpenAIMessage),
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        stream: true,
      });
    } catch (err) {
      yield { type: "error", message: `OpenAI request failed: ${(err as Error).message}` };
      return;
    }

    let content = "";
    const toolCalls: AccumulatedToolCall[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        yield { type: "token", content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index ?? 0;
          if (!toolCalls[index]) {
            toolCalls[index] = { id: tc.id ?? "", type: "function", function: { name: "", arguments: "" } };
          }
          if (tc.id) toolCalls[index].id = tc.id;
          if (tc.function?.name) toolCalls[index].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[index].function.arguments += tc.function.arguments;
        }
      }
    }

    if (toolCalls.length === 0) {
      await db.addMessage({ conversationId, role: "assistant", content });
      await db.touchConversation(conversationId);
      yield { type: "done", content };
      return;
    }

    // Persist the assistant's tool-call request, then execute each tool.
    await db.addMessage({
      conversationId,
      role: "assistant",
      content,
      toolCalls: JSON.stringify(toolCalls),
    });
    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: toolCalls,
    } as ChatCompletionMessageParam);

    const awaitingClient: string[] = [];

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      if (clientToolNames.has(call.function.name)) {
        awaitingClient.push(call.id);
        yield { type: "client_tool_call", id: call.id, name: call.function.name, args };
        continue;
      }

      yield { type: "tool_call", name: call.function.name, args };

      const { result } = await executeTool(call.function.name, args, { userId }, enabledTools);

      await db.addMessage({
        conversationId,
        role: "tool",
        content: result,
        toolCallId: call.id,
        name: call.function.name,
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });

      yield { type: "tool_result", name: call.function.name, result };
    }

    if (awaitingClient.length > 0) {
      // The client executes these and resumes via resumeWithClientToolResults.
      await db.touchConversation(conversationId);
      yield { type: "awaiting_client_tools", toolCallIds: awaitingClient };
      return;
    }
    // Loop again so the model can use the tool results.
  }

  yield { type: "error", message: "Reached maximum tool-call rounds without a final response." };
}
