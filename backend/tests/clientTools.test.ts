import type { Express } from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Each create() call pops the next scripted stream of chunks.
const scriptedStreams: unknown[][] = [];
const createCalls: any[] = [];

vi.mock("../src/services/openaiClient.js", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(async (params: unknown) => {
          createCalls.push(JSON.parse(JSON.stringify(params)));
          const chunks = scriptedStreams.shift() ?? [];
          return (async function* () {
            yield* chunks;
          })();
        }),
      },
    },
  },
}));

const { createApp } = await import("../src/app.js");
const { setDb } = await import("../src/db/index.js");
const { SqliteAdapter } = await import("../src/db/sqlite.js");
const { ensureSeedUser } = await import("../src/services/bootstrap.js");

function parseEvents(body: string) {
  return body
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)));
}

const deviceTool = {
  name: "get_battery",
  description: "Battery level",
  parameters: { type: "object", properties: {} },
};

describe("client-side tools", () => {
  let app: Express;
  let token: string;
  let conversationId: number;

  beforeAll(async () => {
    const db = new SqliteAdapter(":memory:");
    await db.init();
    setDb(db);
    await ensureSeedUser();
    app = createApp();
    const login = await request(app).post("/api/auth/login").send({ username: "testuser", password: "testpass" });
    token = login.body.token;
  });

  beforeEach(async () => {
    scriptedStreams.length = 0;
    createCalls.length = 0;
    const res = await request(app).post("/api/chat/conversations").set("Authorization", `Bearer ${token}`).send({});
    conversationId = res.body.conversation.id;
  });

  it("pauses on a client tool call and resumes with the posted result", async () => {
    scriptedStreams.push([
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: "get_battery", arguments: "{}" } }],
            },
          },
        ],
      },
    ]);

    const first = await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        message: "battery?",
        clientTools: [deviceTool],
        systemPrompt: "You are LCDR.",
        clientContext: "Battery: 40%",
      });

    const firstEvents = parseEvents(first.text);
    expect(firstEvents).toEqual([
      { type: "client_tool_call", id: "call_1", name: "get_battery", args: {} },
      { type: "awaiting_client_tools", toolCallIds: ["call_1"] },
    ]);
    const systemMessage = createCalls[0].messages[0].content as string;
    expect(systemMessage.startsWith("You are LCDR.")).toBe(true);
    expect(systemMessage).toContain("Live device context:\nBattery: 40%");
    expect(createCalls[0].tools.map((t: any) => t.function.name)).toContain("get_battery");

    scriptedStreams.push([{ choices: [{ delta: { content: "40%." } }] }]);

    const second = await request(app)
      .post(`/api/chat/conversations/${conversationId}/tool-results`)
      .set("Authorization", `Bearer ${token}`)
      .send({ results: [{ toolCallId: "call_1", result: "40%, charging" }], clientTools: [deviceTool] });

    expect(parseEvents(second.text)).toEqual([
      { type: "tool_result", name: "get_battery", result: "40%, charging" },
      { type: "token", content: "40%." },
      { type: "done", content: "40%." },
    ]);
    const resumedMessages = createCalls[1].messages;
    expect(resumedMessages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "40%, charging" });
  });

  it("rejects results for a tool call that is not pending", async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${conversationId}/tool-results`)
      .set("Authorization", `Bearer ${token}`)
      .send({ results: [{ toolCallId: "nope", result: "x" }] });

    expect(parseEvents(res.text)).toEqual([{ type: "error", message: "No pending tool call with id 'nope'." }]);
    expect(createCalls).toHaveLength(0);
  });

  it("closes out unanswered client tool calls when the next message arrives", async () => {
    scriptedStreams.push([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_x", function: { name: "get_battery", arguments: "{}" } }] } }] },
    ]);
    await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "battery?", clientTools: [deviceTool] });

    scriptedStreams.push([{ choices: [{ delta: { content: "ok" } }] }]);
    await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "never mind" });

    const roles = createCalls[1].messages.map((m: any) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(createCalls[1].messages[3]).toMatchObject({ tool_call_id: "call_x" });
  });

  it("does not let a client tool shadow a server tool", async () => {
    scriptedStreams.push([{ choices: [{ delta: { content: "ok" } }] }]);
    await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "hi", clientTools: [{ ...deviceTool, name: "calculator" }] });

    const names = createCalls[0].tools.map((t: any) => t.function.name);
    expect(names.filter((n: string) => n === "calculator")).toHaveLength(1);
  });
});
