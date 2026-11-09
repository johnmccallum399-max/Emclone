import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDb } from "../src/db/index.js";
import { SqliteAdapter } from "../src/db/sqlite.js";
import type { HubRunEvent } from "../src/hub/orchestrator.js";
import { requestStop, runHubSession } from "../src/hub/orchestrator.js";
import { completeChat } from "../src/hub/providers.js";
import { sealSecret } from "../src/utils/secretBox.js";

vi.mock("../src/hub/providers.js", () => ({ completeChat: vi.fn() }));
const mockedComplete = vi.mocked(completeChat);

async function collect(gen: AsyncGenerator<HubRunEvent>): Promise<HubRunEvent[]> {
  const events: HubRunEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("runHubSession", () => {
  let db: SqliteAdapter;
  let userId: number;

  beforeEach(async () => {
    mockedComplete.mockReset();
    db = new SqliteAdapter(":memory:");
    await db.init();
    setDb(db);
    userId = (await db.createUser("alice", "hash")).id;
  });

  async function makeSession(agentNames: string[], overrides: { maxRounds?: number; synthesize?: boolean } = {}) {
    const agentIds: number[] = [];
    for (const name of agentNames) {
      const agent = await db.createHubAgent({
        userId,
        name,
        provider: "openai",
        model: "m",
        apiKeySealed: sealSecret("k"),
      });
      agentIds.push(agent.id);
    }
    return db.createHubSession({
      userId,
      title: "T",
      goal: "Decide",
      mode: "discussion",
      maxRounds: overrides.maxRounds ?? 2,
      synthesize: overrides.synthesize ?? true,
      agentIds,
    });
  }

  it("alternates agents each round, then synthesizes with the first agent", async () => {
    mockedComplete.mockImplementation(async (agent) => `from ${agent.name}`);
    const session = await makeSession(["A", "B"]);

    const events = await collect(runHubSession(userId, session.id));
    const messages = await db.getHubMessages(session.id);

    expect(messages.map((m) => `${m.authorName}:${m.round}`)).toEqual([
      "A:1",
      "B:1",
      "A:2",
      "B:2",
      "A (synthesis):3",
    ]);
    expect(events.at(-1)).toEqual({ type: "done", status: "completed" });
    expect((await db.getHubSession(session.id, userId))?.status).toBe("completed");
  });

  it("shows each agent the transcript so far, labeled by speaker", async () => {
    mockedComplete.mockImplementation(async (agent) => `from ${agent.name}`);
    const session = await makeSession(["A", "B"], { maxRounds: 1, synthesize: false });
    await collect(runHubSession(userId, session.id));

    const secondPrompt = mockedComplete.mock.calls[1][1].prompt;
    expect(secondPrompt).toContain("Decide");
    expect(secondPrompt).toContain("[A]\nfrom A");
  });

  it("skips synthesis when there is only one participant", async () => {
    mockedComplete.mockResolvedValue("solo answer");
    const session = await makeSession(["Solo"], { maxRounds: 1 });
    await collect(runHubSession(userId, session.id));

    expect(mockedComplete).toHaveBeenCalledTimes(1);
    expect((await db.getHubMessages(session.id)).map((m) => m.role)).toEqual(["agent"]);
  });

  it("records a failed turn in the transcript and lets the others continue", async () => {
    mockedComplete.mockImplementation(async (agent) => {
      if (agent.name === "A") throw new Error("rate limited");
      return `from ${agent.name}`;
    });
    const session = await makeSession(["A", "B"], { maxRounds: 1, synthesize: false });

    const events = await collect(runHubSession(userId, session.id));
    const messages = await db.getHubMessages(session.id);

    expect(events.some((e) => e.type === "turn_error" && e.agentName === "A")).toBe(true);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("rate limited");
    expect(messages[1].content).toBe("from B");
    expect(events.at(-1)).toEqual({ type: "done", status: "completed" });
  });

  it("ends in error when every agent fails a round", async () => {
    mockedComplete.mockRejectedValue(new Error("bad key"));
    const session = await makeSession(["A", "B"], { maxRounds: 2 });

    const events = await collect(runHubSession(userId, session.id));

    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect((await db.getHubSession(session.id, userId))?.status).toBe("error");
  });

  it("stops after the in-flight turn when asked", async () => {
    const session = await makeSession(["A", "B"], { maxRounds: 3 });
    mockedComplete.mockImplementation(async (agent) => {
      requestStop(session.id);
      return `from ${agent.name}`;
    });

    const events = await collect(runHubSession(userId, session.id));

    expect(mockedComplete).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: "done", status: "stopped" });
    expect((await db.getHubSession(session.id, userId))?.status).toBe("stopped");
  });

  it("continues round numbering from the existing transcript", async () => {
    mockedComplete.mockResolvedValue("x");
    const session = await makeSession(["A", "B"], { maxRounds: 1, synthesize: false });
    await collect(runHubSession(userId, session.id));
    await collect(runHubSession(userId, session.id));

    const rounds = (await db.getHubMessages(session.id)).map((m) => m.round);
    expect(rounds).toEqual([1, 1, 2, 2]);
  });
});
