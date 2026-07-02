import type { HubAgent, HubProvider } from "../db/types.js";
import { openSecret } from "../utils/secretBox.js";

/**
 * Thin multi-provider completion client for the orchestration hub.
 *
 * Every hub turn is a single (system prompt, user prompt) pair — the shared
 * transcript is composed into the user prompt by the orchestrator — so each
 * provider call is a simple one-shot request with no role-alternation or
 * tool-calling concerns.
 */

export interface ProviderTurn {
  system: string;
  prompt: string;
}

/** Per-request timeout: hub turns can be slow on large models. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Anthropic requires an explicit output cap. Generous but bounded. */
const ANTHROPIC_MAX_TOKENS = 4096;

export const PROVIDER_LABELS: Record<HubProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
  openai_compatible: "OpenAI-compatible (Grok, Mistral, Groq, OpenRouter, Ollama, ...)",
};

async function readErrorSnippet(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 400);
  } catch {
    return "";
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const snippet = await readErrorSnippet(response);
    throw new Error(`Provider request failed (HTTP ${response.status}): ${snippet || response.statusText}`);
  }
  return response.json();
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function completeOpenAI(agent: HubAgent, apiKey: string, turn: ProviderTurn): Promise<string> {
  const base = trimTrailingSlash(agent.baseUrl || "https://api.openai.com/v1");
  const data = await postJson(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${apiKey}` },
    {
      model: agent.model,
      messages: [
        { role: "system", content: turn.system },
        { role: "user", content: turn.prompt },
      ],
    }
  );
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("Provider returned no message content");
  return content;
}

async function completeAnthropic(agent: HubAgent, apiKey: string, turn: ProviderTurn): Promise<string> {
  const base = trimTrailingSlash(agent.baseUrl || "https://api.anthropic.com");
  const data = await postJson(
    `${base}/v1/messages`,
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    {
      model: agent.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system: turn.system,
      messages: [{ role: "user", content: turn.prompt }],
    }
  );
  const blocks: any[] = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  if (!text) throw new Error("Provider returned no message content");
  return text;
}

async function completeGoogle(agent: HubAgent, apiKey: string, turn: ProviderTurn): Promise<string> {
  const base = trimTrailingSlash(agent.baseUrl || "https://generativelanguage.googleapis.com");
  const data = await postJson(
    `${base}/v1beta/models/${encodeURIComponent(agent.model)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      system_instruction: { parts: [{ text: turn.system }] },
      contents: [{ role: "user", parts: [{ text: turn.prompt }] }],
    }
  );
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((part) => typeof part?.text === "string")
    .map((part) => part.text)
    .join("");
  if (!text) throw new Error("Provider returned no message content");
  return text;
}

/** Runs one completion turn against the agent's configured provider. */
export async function completeChat(agent: HubAgent, turn: ProviderTurn): Promise<string> {
  const apiKey = openSecret(agent.apiKeySealed);

  switch (agent.provider) {
    case "openai":
    case "openai_compatible":
      if (agent.provider === "openai_compatible" && !agent.baseUrl) {
        throw new Error(`Agent "${agent.name}" needs a base URL for its OpenAI-compatible provider`);
      }
      return completeOpenAI(agent, apiKey, turn);
    case "anthropic":
      return completeAnthropic(agent, apiKey, turn);
    case "google":
      return completeGoogle(agent, apiKey, turn);
    default:
      throw new Error(`Unknown provider: ${agent.provider satisfies never}`);
  }
}
