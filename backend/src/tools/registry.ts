import { getDb } from "../db/index.js";
import { calculatorTool } from "./calculator.js";
import { forgetTool, recallTool, rememberTool } from "./memory.js";
import { placeholderApiTool } from "./placeholderApi.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { webSearchTool } from "./webSearch.js";

/**
 * All tools available to the assistant. To add a new tool: implement a
 * `ToolDefinition` (see tools/types.ts) and add it to this array. Users can
 * enable/disable individual tools (or whole permission scopes) in Settings.
 */
export const ALL_TOOLS: ToolDefinition[] = [
  webSearchTool,
  rememberTool,
  recallTool,
  forgetTool,
  calculatorTool,
  placeholderApiTool,
];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

/**
 * Returns the tools enabled for a given user, taking their stored
 * tool_permissions into account. Tools default to enabled unless explicitly
 * disabled.
 */
export async function getEnabledTools(userId: number): Promise<ToolDefinition[]> {
  const { toolPermissions } = await getDb().getSettings(userId);
  return ALL_TOOLS.filter((tool) => toolPermissions[tool.name] !== false);
}

/** Converts tool definitions into the OpenAI function-calling tool format. */
export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export interface ToolExecutionResult {
  name: string;
  result: string;
}

/**
 * Executes a tool by name, enforcing that it is in the caller's enabled set.
 * Returns a string result suitable for a `tool` role chat message.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  enabledTools: ToolDefinition[]
): Promise<ToolExecutionResult> {
  const tool = TOOLS_BY_NAME.get(name);
  const isEnabled = enabledTools.some((t) => t.name === name);

  if (!tool || !isEnabled) {
    return { name, result: `Error: tool '${name}' is not available or has been disabled in Settings.` };
  }

  try {
    const result = await tool.execute(args, ctx);
    return { name, result };
  } catch (err) {
    return { name, result: `Error: tool '${name}' failed (${(err as Error).message}).` };
  }
}
