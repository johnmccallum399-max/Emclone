import { env } from "../config/env.js";
import type { ToolDefinition } from "./types.js";

/**
 * Template tool demonstrating how to wire up a future external API
 * integration (e.g. a calendar, smart-home, or task-manager API).
 *
 * To build a real integration:
 *  1. Copy this file, rename the tool and its `name`/`description`.
 *  2. Add any required secrets to `.env` / `.env.example`.
 *  3. Replace the body of `execute` with a real `fetch()` call.
 *  4. Register the new tool in `tools/index.ts`.
 *
 * If `PLACEHOLDER_API_URL` is not configured, this tool explains itself
 * instead of failing, so it is safe to leave enabled in a fresh install.
 */
export const placeholderApiTool: ToolDefinition = {
  name: "placeholder_api",
  description:
    "Example/template tool for a future external API integration. Currently returns a " +
    "description of how to configure it. Use only if the user explicitly asks to test the " +
    "placeholder/example tool.",
  permission: "external_api",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Arbitrary input that would be forwarded to the external API." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(args) {
    const query = String(args.query ?? "").trim();

    if (!env.PLACEHOLDER_API_URL) {
      return (
        "This is a placeholder tool. Set PLACEHOLDER_API_URL in .env and implement the " +
        "fetch logic in backend/src/tools/placeholderApi.ts to connect a real API. " +
        `(received query: "${query}")`
      );
    }

    try {
      const url = new URL(env.PLACEHOLDER_API_URL);
      url.searchParams.set("q", query);
      const response = await fetch(url.toString());
      if (!response.ok) {
        return `Placeholder API request failed with status ${response.status}.`;
      }
      const text = await response.text();
      return text.slice(0, 2000);
    } catch (err) {
      return `Error: placeholder API request failed (${(err as Error).message}).`;
    }
  },
};
