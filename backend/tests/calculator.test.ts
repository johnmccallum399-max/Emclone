import { describe, expect, it } from "vitest";
import { calculatorTool } from "../src/tools/calculator.js";

describe("calculatorTool", () => {
  it("evaluates basic arithmetic", async () => {
    const result = await calculatorTool.execute({ expression: "2 + 3 * 4" }, { userId: 1 });
    expect(result).toBe("14");
  });

  it("supports unit conversions", async () => {
    const result = await calculatorTool.execute({ expression: "2 km to m" }, { userId: 1 });
    expect(result).toContain("2000");
  });

  it("returns an error for invalid expressions", async () => {
    const result = await calculatorTool.execute({ expression: "2 +" }, { userId: 1 });
    expect(result).toMatch(/^Error/);
  });

  it("requires an expression", async () => {
    const result = await calculatorTool.execute({}, { userId: 1 });
    expect(result).toMatch(/^Error/);
  });
});
