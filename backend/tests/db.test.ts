import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../src/db/sqlite.js";

describe("SqliteAdapter", () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(":memory:");
    await db.init();
  });

  it("creates and retrieves users", async () => {
    const user = await db.createUser("alice", "hashed");
    expect(user.username).toBe("alice");
    expect(await db.countUsers()).toBe(1);

    const fetched = await db.getUserByUsername("alice");
    expect(fetched?.id).toBe(user.id);
    expect(await db.getUserById(user.id)).not.toBeNull();
    expect(await db.getUserByUsername("nobody")).toBeNull();
  });

  it("manages conversations and short-term message history", async () => {
    const user = await db.createUser("bob", "hashed");
    const convo = await db.createConversation(user.id, "Test");
    expect(convo.userId).toBe(user.id);

    await db.addMessage({ conversationId: convo.id, role: "user", content: "Hello" });
    await db.addMessage({ conversationId: convo.id, role: "assistant", content: "Hi there" });

    const messages = await db.getMessages(convo.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");

    const list = await db.listConversations(user.id);
    expect(list).toHaveLength(1);

    const renamed = await db.renameConversation(convo.id, user.id, "Trip planning");
    expect(renamed?.title).toBe("Trip planning");
    expect(await db.renameConversation(convo.id, 9999, "Nope")).toBeNull();

    await db.deleteConversation(convo.id, user.id);
    expect(await db.listConversations(user.id)).toHaveLength(0);
  });

  it("stores and retrieves long-term memory", async () => {
    const user = await db.createUser("carol", "hashed");
    await db.setMemory(user.id, "favorite_color", "blue");
    const entry = await db.getMemory(user.id, "favorite_color");
    expect(entry?.value).toBe("blue");

    await db.setMemory(user.id, "favorite_color", "green");
    expect((await db.getMemory(user.id, "favorite_color"))?.value).toBe("green");

    const all = await db.listMemory(user.id);
    expect(all).toHaveLength(1);

    await db.deleteMemory(user.id, "favorite_color");
    expect(await db.getMemory(user.id, "favorite_color")).toBeNull();
  });

  it("persists persona, tool permissions, and voice mode", async () => {
    const user = await db.createUser("dave", "hashed");

    await db.setPersona(user.id, { name: "Dave Bot", systemPrompt: "Be helpful", description: "" });
    await db.setToolPermission(user.id, "web_search", false);
    await db.setVoiceMode(user.id, "pipeline");

    const settings = await db.getSettings(user.id);
    expect(settings.persona.name).toBe("Dave Bot");
    expect(settings.toolPermissions.web_search).toBe(false);
    expect(settings.voiceMode).toBe("pipeline");
  });

  it("returns sensible defaults for a user with no settings", async () => {
    const user = await db.createUser("erin", "hashed");
    const settings = await db.getSettings(user.id);
    expect(settings.voiceMode).toBe("native");
    expect(settings.toolPermissions).toEqual({});
    expect(settings.persona.name).toBe("Assistant");
  });
});
