import { beforeEach, describe, expect, it } from "vitest";
import { setDb } from "../src/db/index.js";
import { SqliteAdapter } from "../src/db/sqlite.js";
import { ALL_TOOLS, executeTool, getEnabledTools, toOpenAITools } from "../src/tools/registry.js";

describe("tool registry", () => {
  let db: SqliteAdapter;
  let userId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(":memory:");
    await db.init();
    setDb(db);
    const user = await db.createUser("eve", "hashed");
    userId = user.id;
  });

  it("includes all tools by default", async () => {
    const tools = await getEnabledTools(userId);
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
  });

  it("excludes tools the user has disabled", async () => {
    await db.setToolPermission(userId, "web_search", false);
    const tools = await getEnabledTools(userId);
    expect(tools.find((t) => t.name === "web_search")).toBeUndefined();
    expect(tools.length).toBe(ALL_TOOLS.length - 1);
  });

  it("converts tools to OpenAI function-calling format", async () => {
    const tools = await getEnabledTools(userId);
    const openaiTools = toOpenAITools(tools);
    expect(openaiTools).toHaveLength(tools.length);
    expect(openaiTools[0]).toMatchObject({ type: "function" });
    expect(openaiTools[0].function).toHaveProperty("name");
    expect(openaiTools[0].function).toHaveProperty("parameters");
  });

  it("refuses to execute a disabled tool", async () => {
    await db.setToolPermission(userId, "calculator", false);
    const enabled = await getEnabledTools(userId);
    const { result } = await executeTool("calculator", { expression: "1+1" }, { userId }, enabled);
    expect(result).toMatch(/not available|disabled/);
  });

  it("refuses to execute an unknown tool", async () => {
    const enabled = await getEnabledTools(userId);
    const { result } = await executeTool("does_not_exist", {}, { userId }, enabled);
    expect(result).toMatch(/not available|disabled/);
  });

  it("executes an enabled tool via the registry", async () => {
    const enabled = await getEnabledTools(userId);
    const { result } = await executeTool("calculator", { expression: "6 * 7" }, { userId }, enabled);
    expect(result).toBe("42");
  });

  it("round-trips remember/recall/forget", async () => {
    const enabled = await getEnabledTools(userId);
    await executeTool("remember", { key: "name", value: "Jamie" }, { userId }, enabled);

    const recall = await executeTool("recall", { key: "name" }, { userId }, enabled);
    expect(recall.result).toContain("Jamie");

    await executeTool("forget", { key: "name" }, { userId }, enabled);
    const after = await executeTool("recall", { key: "name" }, { userId }, enabled);
    expect(after.result).toMatch(/No memory found/);
  });
});
