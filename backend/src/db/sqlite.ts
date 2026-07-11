import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PERSONA, type PersonaConfig } from "../config/persona.js";
import type {
  ChatMessageRecord,
  Conversation,
  DatabaseAdapter,
  HubAgent,
  HubAgentPatch,
  HubMessageRecord,
  HubSession,
  HubSessionStatus,
  MemoryEntry,
  NewHubAgentInput,
  NewHubMessageInput,
  NewHubSessionInput,
  NewMessageInput,
  User,
  UserSettings,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_call_id TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS tool_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, tool_name)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  persona TEXT,
  voice_mode TEXT NOT NULL DEFAULT 'native'
);

CREATE TABLE IF NOT EXISTS hub_agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hub_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'discussion',
  max_rounds INTEGER NOT NULL DEFAULT 3,
  synthesize INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hub_session_agents (
  session_id INTEGER NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES hub_agents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (session_id, agent_id)
);

CREATE TABLE IF NOT EXISTS hub_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES hub_agents(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id);
CREATE INDEX IF NOT EXISTS idx_hub_agents_user ON hub_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_hub_sessions_user ON hub_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_hub_messages_session ON hub_messages(session_id);
`;

export class SqliteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(filePath: string) {
    const dir = path.dirname(filePath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async init(): Promise<void> {
    this.db.exec(SCHEMA);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ---- Users ----------------------------------------------------------

  async getUserByUsername(username: string): Promise<User | null> {
    const row = this.db
      .prepare("SELECT id, username, password_hash, created_at FROM users WHERE username = ?")
      .get(username) as any;
    return row ? this.mapUser(row) : null;
  }

  async getUserById(id: number): Promise<User | null> {
    const row = this.db
      .prepare("SELECT id, username, password_hash, created_at FROM users WHERE id = ?")
      .get(id) as any;
    return row ? this.mapUser(row) : null;
  }

  async createUser(username: string, passwordHash: string): Promise<User> {
    const result = this.db
      .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
      .run(username, passwordHash);
    const user = await this.getUserById(Number(result.lastInsertRowid));
    if (!user) throw new Error("Failed to create user");
    return user;
  }

  async countUsers(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
    return Number(row.count);
  }

  // ---- Conversations ----------------------------------------------------

  async createConversation(userId: number, title: string): Promise<Conversation> {
    const result = this.db
      .prepare("INSERT INTO conversations (user_id, title) VALUES (?, ?)")
      .run(userId, title);
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(result.lastInsertRowid) as any;
    return this.mapConversation(row);
  }

  async listConversations(userId: number): Promise<Conversation[]> {
    const rows = this.db
      .prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as any[];
    return rows.map((row) => this.mapConversation(row));
  }

  async getConversation(id: number, userId: number): Promise<Conversation | null> {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
      .get(id, userId) as any;
    return row ? this.mapConversation(row) : null;
  }

  async touchConversation(id: number): Promise<void> {
    this.db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(id);
  }

  async renameConversation(id: number, userId: number, title: string): Promise<Conversation | null> {
    this.db
      .prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?")
      .run(title, id, userId);
    return this.getConversation(id, userId);
  }

  async deleteConversation(id: number, userId: number): Promise<void> {
    this.db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId);
  }

  // ---- Messages ----------------------------------------------------------

  async addMessage(input: NewMessageInput): Promise<ChatMessageRecord> {
    const result = this.db
      .prepare(
        `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id, name)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.conversationId,
        input.role,
        input.content,
        input.toolCalls ?? null,
        input.toolCallId ?? null,
        input.name ?? null
      );
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid) as any;
    return this.mapMessage(row);
  }

  async getMessages(conversationId: number, limit = 100): Promise<ChatMessageRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
         ) sub ORDER BY id ASC`
      )
      .all(conversationId, limit) as any[];
    return rows.map((row) => this.mapMessage(row));
  }

  // ---- Memory ----------------------------------------------------------

  async listMemory(userId: number): Promise<MemoryEntry[]> {
    const rows = this.db
      .prepare("SELECT key, value, updated_at FROM memory WHERE user_id = ? ORDER BY key ASC")
      .all(userId) as any[];
    return rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }));
  }

  async getMemory(userId: number, key: string): Promise<MemoryEntry | null> {
    const row = this.db
      .prepare("SELECT key, value, updated_at FROM memory WHERE user_id = ? AND key = ?")
      .get(userId, key) as any;
    return row ? { key: row.key, value: row.value, updatedAt: row.updated_at } : null;
  }

  async setMemory(userId: number, key: string, value: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memory (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      )
      .run(userId, key, value);
  }

  async deleteMemory(userId: number, key: string): Promise<void> {
    this.db.prepare("DELETE FROM memory WHERE user_id = ? AND key = ?").run(userId, key);
  }

  // ---- Settings ----------------------------------------------------------

  async getSettings(userId: number): Promise<UserSettings> {
    const row = this.db
      .prepare("SELECT persona, voice_mode FROM user_settings WHERE user_id = ?")
      .get(userId) as any;

    const persona: PersonaConfig = row?.persona ? JSON.parse(row.persona) : DEFAULT_PERSONA;
    const voiceMode: string = row?.voice_mode ?? "native";

    const permissionRows = this.db
      .prepare("SELECT tool_name, enabled FROM tool_permissions WHERE user_id = ?")
      .all(userId) as any[];
    const toolPermissions: Record<string, boolean> = {};
    for (const permRow of permissionRows) {
      toolPermissions[permRow.tool_name] = Boolean(permRow.enabled);
    }

    return { persona, toolPermissions, voiceMode };
  }

  async setPersona(userId: number, persona: PersonaConfig): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, persona) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET persona = excluded.persona`
      )
      .run(userId, JSON.stringify(persona));
  }

  async setToolPermission(userId: number, tool: string, enabled: boolean): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO tool_permissions (user_id, tool_name, enabled) VALUES (?, ?, ?)
         ON CONFLICT(user_id, tool_name) DO UPDATE SET enabled = excluded.enabled`
      )
      .run(userId, tool, enabled ? 1 : 0);
  }

  async setVoiceMode(userId: number, mode: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, voice_mode) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET voice_mode = excluded.voice_mode`
      )
      .run(userId, mode);
  }

  // ---- Hub agents ---------------------------------------------------------

  async createHubAgent(input: NewHubAgentInput): Promise<HubAgent> {
    const result = this.db
      .prepare(
        `INSERT INTO hub_agents (user_id, name, provider, model, api_key, base_url, system_prompt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.userId,
        input.name,
        input.provider,
        input.model,
        input.apiKeySealed,
        input.baseUrl ?? null,
        input.systemPrompt ?? ""
      );
    const row = this.db.prepare("SELECT * FROM hub_agents WHERE id = ?").get(result.lastInsertRowid) as any;
    return this.mapHubAgent(row);
  }

  async listHubAgents(userId: number): Promise<HubAgent[]> {
    const rows = this.db
      .prepare("SELECT * FROM hub_agents WHERE user_id = ? ORDER BY id ASC")
      .all(userId) as any[];
    return rows.map((row) => this.mapHubAgent(row));
  }

  async getHubAgent(id: number, userId: number): Promise<HubAgent | null> {
    const row = this.db
      .prepare("SELECT * FROM hub_agents WHERE id = ? AND user_id = ?")
      .get(id, userId) as any;
    return row ? this.mapHubAgent(row) : null;
  }

  async updateHubAgent(id: number, userId: number, patch: HubAgentPatch): Promise<HubAgent | null> {
    const columns: Record<string, unknown> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.provider !== undefined) columns.provider = patch.provider;
    if (patch.model !== undefined) columns.model = patch.model;
    if (patch.apiKeySealed !== undefined) columns.api_key = patch.apiKeySealed;
    if (patch.baseUrl !== undefined) columns.base_url = patch.baseUrl;
    if (patch.systemPrompt !== undefined) columns.system_prompt = patch.systemPrompt;
    const sets = Object.keys(columns).map((column) => `${column} = ?`);
    const values = Object.values(columns);
    if (sets.length > 0) {
      this.db
        .prepare(`UPDATE hub_agents SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
        .run(...values, id, userId);
    }
    return this.getHubAgent(id, userId);
  }

  async deleteHubAgent(id: number, userId: number): Promise<void> {
    this.db.prepare("DELETE FROM hub_agents WHERE id = ? AND user_id = ?").run(id, userId);
  }

  // ---- Hub sessions -------------------------------------------------------

  async createHubSession(input: NewHubSessionInput): Promise<HubSession> {
    const result = this.db
      .prepare(
        `INSERT INTO hub_sessions (user_id, title, goal, mode, max_rounds, synthesize)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.userId, input.title, input.goal, input.mode, input.maxRounds, input.synthesize ? 1 : 0);
    const sessionId = Number(result.lastInsertRowid);

    const insertAgent = this.db.prepare(
      "INSERT INTO hub_session_agents (session_id, agent_id, position) VALUES (?, ?, ?)"
    );
    input.agentIds.forEach((agentId, position) => insertAgent.run(sessionId, agentId, position));

    const session = await this.getHubSession(sessionId, input.userId);
    if (!session) throw new Error("Failed to create hub session");
    return session;
  }

  async listHubSessions(userId: number): Promise<HubSession[]> {
    const rows = this.db
      .prepare("SELECT * FROM hub_sessions WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId) as any[];
    return rows.map((row) => this.mapHubSession(row, this.getSessionAgentIds(row.id)));
  }

  async getHubSession(id: number, userId: number): Promise<HubSession | null> {
    const row = this.db
      .prepare("SELECT * FROM hub_sessions WHERE id = ? AND user_id = ?")
      .get(id, userId) as any;
    return row ? this.mapHubSession(row, this.getSessionAgentIds(row.id)) : null;
  }

  async setHubSessionStatus(id: number, status: HubSessionStatus): Promise<void> {
    this.db
      .prepare("UPDATE hub_sessions SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, id);
  }

  async deleteHubSession(id: number, userId: number): Promise<void> {
    this.db.prepare("DELETE FROM hub_sessions WHERE id = ? AND user_id = ?").run(id, userId);
  }

  // ---- Hub messages -------------------------------------------------------

  async addHubMessage(input: NewHubMessageInput): Promise<HubMessageRecord> {
    const result = this.db
      .prepare(
        `INSERT INTO hub_messages (session_id, agent_id, author_name, role, content, round)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.sessionId,
        input.agentId ?? null,
        input.authorName,
        input.role,
        input.content,
        input.round ?? 0
      );
    this.db
      .prepare("UPDATE hub_sessions SET updated_at = datetime('now') WHERE id = ?")
      .run(input.sessionId);
    const row = this.db.prepare("SELECT * FROM hub_messages WHERE id = ?").get(result.lastInsertRowid) as any;
    return this.mapHubMessage(row);
  }

  async getHubMessages(sessionId: number, limit = 500): Promise<HubMessageRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM hub_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?
         ) sub ORDER BY id ASC`
      )
      .all(sessionId, limit) as any[];
    return rows.map((row) => this.mapHubMessage(row));
  }

  private getSessionAgentIds(sessionId: number): number[] {
    const rows = this.db
      .prepare("SELECT agent_id FROM hub_session_agents WHERE session_id = ? ORDER BY position ASC")
      .all(sessionId) as any[];
    return rows.map((row) => Number(row.agent_id));
  }

  // ---- Mappers ----------------------------------------------------------

  private mapUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    };
  }

  private mapConversation(row: any): Conversation {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapMessage(row: any): ChatMessageRecord {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      name: row.name,
      createdAt: row.created_at,
    };
  }

  private mapHubAgent(row: any): HubAgent {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      provider: row.provider,
      model: row.model,
      apiKeySealed: row.api_key,
      baseUrl: row.base_url,
      systemPrompt: row.system_prompt,
      createdAt: row.created_at,
    };
  }

  private mapHubSession(row: any, agentIds: number[]): HubSession {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      goal: row.goal,
      mode: row.mode,
      maxRounds: row.max_rounds,
      synthesize: Boolean(row.synthesize),
      status: row.status,
      agentIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapHubMessage(row: any): HubMessageRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      agentId: row.agent_id ?? null,
      authorName: row.author_name,
      role: row.role,
      content: row.content,
      round: row.round,
      createdAt: row.created_at,
    };
  }
}
