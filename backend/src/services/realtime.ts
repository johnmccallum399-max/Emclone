import { env } from "../config/env.js";

export interface RealtimeSession {
  clientSecret: string;
  model: string;
  expiresAt?: number;
}

/**
 * Mints a short-lived ephemeral token the frontend can use to connect
 * directly to the OpenAI Realtime API over WebRTC, without ever exposing the
 * long-lived OPENAI_API_KEY to the browser.
 *
 * Uses the /v1/realtime/client_secrets endpoint, which replaced the older
 * /v1/realtime/sessions endpoint (the latter's preview models, e.g.
 * gpt-4o-mini-realtime-preview, have since been retired).
 *
 * The raw OpenAI response shape is `{ value, expires_at, session: {...} }`,
 * but we normalize it here rather than passing it through verbatim: the
 * model is already known (we asked for it), and isolating the one upstream
 * field we depend on (`value`) in one place means a future OpenAI-side shape
 * change only needs a fix here, not in the browser.
 *
 * See: https://platform.openai.com/docs/guides/realtime
 */
export async function createRealtimeSession(instructions: string): Promise<RealtimeSession> {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: env.OPENAI_REALTIME_MODEL,
        instructions,
        audio: { output: { voice: env.OPENAI_TTS_VOICE } },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create realtime session (${response.status}): ${text}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const clientSecret: string | undefined = data.value ?? data.client_secret?.value;
  if (!clientSecret) {
    throw new Error(`Realtime session response did not include a client secret: ${JSON.stringify(data)}`);
  }

  return {
    clientSecret,
    model: env.OPENAI_REALTIME_MODEL,
    expiresAt: data.expires_at,
  };
}
