import { env } from "../config/env.js";

/**
 * Mints a short-lived ephemeral token the frontend can use to connect
 * directly to the OpenAI Realtime API over WebRTC, without ever exposing the
 * long-lived OPENAI_API_KEY to the browser.
 *
 * See: https://platform.openai.com/docs/guides/realtime
 */
export async function createRealtimeSession(instructions: string): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_REALTIME_MODEL,
      voice: env.OPENAI_TTS_VOICE,
      instructions,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create realtime session (${response.status}): ${text}`);
  }

  return response.json();
}
