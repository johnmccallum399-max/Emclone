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
  | { type: "done"; content: string }
  | { type: "error"; message: string };

async function buildSystemPrompt(userId: number): Promise<string> {
  const { persona } = await getDb().getSettings(userId);
  const memory = await getDb().listMemory(userId);

  let prompt = persona.systemPrompt;
  if (memory.length > 0) {
    prompt += "\n\nKnown facts about the user (from long-term memory):\n";
    prompt += memory.map((m) => `- ${m.key}: ${m.value}`).join("\n");
  }
  return prompt;
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
  userMessage: string
): AsyncGenerator<ChatStreamEvent> {
  const db = getDb();
  await db.addMessage({ conversationId, role: "user", content: userMessage });

  const enabledTools = await getEnabledTools(userId);
  const openaiTools: ChatCompletionTool[] = toOpenAITools(enabledTools);
  const systemPrompt = await buildSystemPrompt(userId);

  const history = await db.getMessages(conversationId, HISTORY_LIMIT);
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

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
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
    // Loop again so the model can use the tool results.
  }

  yield { type: "error", message: "Reached maximum tool-call rounds without a final response." };
}
