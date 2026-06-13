import OpenAI from "openai";
import { env } from "../config/env.js";

/**
 * Single shared OpenAI client. The API key lives only on the server -
 * it is never sent to the frontend. Voice features that need browser-side
 * access (the Realtime API) use short-lived ephemeral tokens instead
 * (see services/realtime.ts).
 */
export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
