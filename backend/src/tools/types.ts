export interface ToolContext {
  userId: number;
}

/** JSON Schema object describing a tool's parameters (OpenAI function-calling format). */
export type ToolParameterSchema = Record<string, unknown>;

export interface ToolDefinition {
  /** Unique tool name, used as the OpenAI function name. */
  name: string;
  /** Human-readable description shown to the model and in Settings. */
  description: string;
  /**
   * Permission scope required to use this tool. Users can disable any tool
   * by scope in Settings; disabled tools are simply not advertised to the
   * model and calls to them are rejected.
   */
  permission: "web_access" | "memory" | "compute" | "external_api";
  /** JSON Schema for the function's arguments. */
  parameters: ToolParameterSchema;
  /** Executes the tool and returns a string result to feed back to the model. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}
