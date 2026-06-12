import { evaluate } from "mathjs";
import type { ToolDefinition } from "./types.js";

/**
 * Safe arithmetic/expression evaluator. Uses mathjs's `evaluate`, which does
 * not have access to JS globals, `require`, or the filesystem, so it is safe
 * to run on model-provided input.
 */
export const calculatorTool: ToolDefinition = {
  name: "calculator",
  description:
    "Evaluate a mathematical expression (arithmetic, percentages, trigonometry, unit " +
    "conversions, etc.) and return the numeric result. Use this for any calculation " +
    "instead of guessing.",
  permission: "compute",
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "A mathjs-compatible expression, e.g. '12.5 * (3 + 7) / 2' or '2 km to miles'.",
      },
    },
    required: ["expression"],
    additionalProperties: false,
  },
  async execute(args) {
    const expression = String(args.expression ?? "");
    if (!expression.trim()) {
      return "Error: no expression provided.";
    }
    try {
      const result = evaluate(expression);
      return String(result);
    } catch (err) {
      return `Error: could not evaluate expression (${(err as Error).message}).`;
    }
  },
};
