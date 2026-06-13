import { getDb } from "../db/index.js";
import type { ToolDefinition } from "./types.js";

/** Stores or updates a long-term fact/preference about the user. */
export const rememberTool: ToolDefinition = {
  name: "remember",
  description:
    "Save a fact or preference about the user for future conversations (e.g. their name, " +
    "favorite tools, timezone, ongoing projects). Overwrites any existing value for the same key.",
  permission: "memory",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short identifier for the fact, e.g. 'name' or 'favorite_language'." },
      value: { type: "string", description: "The fact or preference to remember." },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const key = String(args.key ?? "").trim();
    const value = String(args.value ?? "").trim();
    if (!key || !value) return "Error: both 'key' and 'value' are required.";
    await getDb().setMemory(ctx.userId, key, value);
    return `Remembered: ${key} = ${value}`;
  },
};

/** Retrieves previously stored facts/preferences. */
export const recallTool: ToolDefinition = {
  name: "recall",
  description:
    "Look up previously remembered facts/preferences about the user. If 'key' is omitted, " +
    "returns everything that has been remembered.",
  permission: "memory",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Specific fact to look up. Omit to list all remembered facts." },
    },
    required: [],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const key = args.key ? String(args.key).trim() : undefined;
    const db = getDb();
    if (key) {
      const entry = await db.getMemory(ctx.userId, key);
      return entry ? `${entry.key} = ${entry.value}` : `No memory found for '${key}'.`;
    }
    const entries = await db.listMemory(ctx.userId);
    if (entries.length === 0) return "No facts have been remembered yet.";
    return entries.map((e) => `${e.key} = ${e.value}`).join("\n");
  },
};

/** Deletes a previously stored fact/preference. */
export const forgetTool: ToolDefinition = {
  name: "forget",
  description: "Delete a previously remembered fact/preference by key.",
  permission: "memory",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "The fact's key to delete." },
    },
    required: ["key"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const key = String(args.key ?? "").trim();
    if (!key) return "Error: 'key' is required.";
    await getDb().deleteMemory(ctx.userId, key);
    return `Forgot '${key}'.`;
  },
};
