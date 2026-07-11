import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../src/db/sqlite.js";
import { openSecret, sealSecret } from "../src/utils/secretBox.js";

describe("secretBox", () => {
  it("round-trips secrets", () => {
    const sealed = sealSecret("sk-super-secret");
    expect(sealed).not.toContain("sk-super-secret");
    expect(openSecret(sealed)).toBe("sk-super-secret");
  });

  it("produces a different ciphertext each time", () => {
    expect(sealSecret("same")).not.toBe(sealSecret("same"));
  });

  it("rejects malformed input", () => {
    expect(() => openSecret("not-a-sealed-secret")).toThrow();
  });
});

describe("SqliteAdapter hub storage", () => {
  let db: SqliteAdapter;
  let userId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(":memory:");
    await db.init();
    userId = (await db.createUser("alice", "hashed")).id;
  });

  async function createAgent(name: string) {
    return db.createHubAgent({
      userId,
      name,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKeySealed: sealSecret(`key-for-${name}`),
    });
  }

  it("creates, lists, updates, and deletes agents", async () => {
    const agent = await createAgent("GPT");
    expect(agent.name).toBe("GPT");
    expect(agent.systemPrompt).toBe("");
    expect(openSecret(agent.apiKeySealed)).toBe("key-for-GPT");

    const updated = await db.updateHubAgent(agent.id, userId, {
      name: "GPT-4o",
      provider: "openai_compatible",
      baseUrl: "https://example.com/v1",
      systemPrompt: "Be terse.",
    });
    expect(updated?.name).toBe("GPT-4o");
    expect(updated?.baseUrl).toBe("https://example.com/v1");
    // Untouched fields survive a partial update.
    expect(openSecret(updated!.apiKeySealed)).toBe("key-for-GPT");

    expect(await db.updateHubAgent(agent.id, 9999, { name: "Nope" })).toBeNull();
    expect((await db.getHubAgent(agent.id, userId))?.name).toBe("GPT-4o");

    await db.deleteHubAgent(agent.id, userId);
    expect(await db.listHubAgents(userId)).toHaveLength(0);
  });

  it("creates sessions with ordered participants", async () => {
    const first = await createAgent("First");
    const second = await createAgent("Second");

    const session = await db.createHubSession({
      userId,
      title: "Test session",
      goal: "Decide something",
      mode: "debate",
      maxRounds: 2,
      synthesize: false,
      agentIds: [second.id, first.id],
    });

    expect(session.status).toBe("idle");
    expect(session.mode).toBe("debate");
    expect(session.synthesize).toBe(false);
    expect(session.agentIds).toEqual([second.id, first.id]);

    await db.setHubSessionStatus(session.id, "completed");
    expect((await db.getHubSession(session.id, userId))?.status).toBe("completed");
    expect(await db.getHubSession(session.id, 9999)).toBeNull();

    await db.deleteHubSession(session.id, userId);
    expect(await db.listHubSessions(userId)).toHaveLength(0);
  });

  it("stores transcript messages and keeps author names when an agent is deleted", async () => {
    const agent = await createAgent("Claude");
    const session = await db.createHubSession({
      userId,
      title: "T",
      goal: "G",
      mode: "discussion",
      maxRounds: 1,
      synthesize: true,
      agentIds: [agent.id],
    });

    await db.addHubMessage({ sessionId: session.id, authorName: "User", role: "user", content: "Kick off" });
    await db.addHubMessage({
      sessionId: session.id,
      agentId: agent.id,
      authorName: agent.name,
      role: "agent",
      content: "First take",
      round: 1,
    });

    let messages = await db.getHubMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].agentId).toBe(agent.id);
    expect(messages[1].round).toBe(1);

    await db.deleteHubAgent(agent.id, userId);
    messages = await db.getHubMessages(session.id);
    expect(messages[1].agentId).toBeNull();
    expect(messages[1].authorName).toBe("Claude");

    // The deleted agent also leaves the session's participant list.
    expect((await db.getHubSession(session.id, userId))?.agentIds).toEqual([]);
  });
});
