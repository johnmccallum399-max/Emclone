import { Pool } from "pg";
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
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_call_id TEXT,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS tool_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, tool_name)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  persona TEXT,
  voice_mode TEXT NOT NULL DEFAULT 'native'
);

CREATE TABLE IF NOT EXISTS hub_agents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL,
  base_url TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'discussion',
  max_rounds INTEGER NOT NULL DEFAULT 3,
  synthesize BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hub_session_agents (
  session_id INTEGER NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES hub_agents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (session_id, agent_id)
);

CREATE TABLE IF NOT EXISTS hub_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES hub_agents(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id);
CREATE INDEX IF NOT EXISTS idx_hub_agents_user ON hub_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_hub_sessions_user ON hub_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_hub_messages_session ON hub_messages(session_id);
`;

export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ---- Users ----------------------------------------------------------

  async getUserByUsername(username: string): Promise<User | null> {
    const result = await this.pool.query(
      "SELECT id, username, password_hash, created_at FROM users WHERE username = $1",
      [username]
    );
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async getUserById(id: number): Promise<User | null> {
    const result = await this.pool.query(
      "SELECT id, username, password_hash, created_at FROM users WHERE id = $1",
      [id]
    );
    return result.rows[0] ? this.mapUser(result.rows[0]) : null;
  }

  async createUser(username: string, passwordHash: string): Promise<User> {
    const result = await this.pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *",
      [username, passwordHash]
    );
    return this.mapUser(result.rows[0]);
  }

  async countUsers(): Promise<number> {
    const result = await this.pool.query("SELECT COUNT(*) as count FROM users");
    return Number(result.rows[0].count);
  }

  // ---- Conversations ----------------------------------------------------

  async createConversation(userId: number, title: string): Promise<Conversation> {
    const result = await this.pool.query(
      "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING *",
      [userId, title]
    );
    return this.mapConversation(result.rows[0]);
  }

  async listConversations(userId: number): Promise<Conversation[]> {
    const result = await this.pool.query(
      "SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId]
    );
    return result.rows.map((row) => this.mapConversation(row));
  }

  async getConversation(id: number, userId: number): Promise<Conversation | null> {
    const result = await this.pool.query(
      "SELECT * FROM conversations WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    return result.rows[0] ? this.mapConversation(result.rows[0]) : null;
  }

  async touchConversation(id: number): Promise<void> {
    await this.pool.query("UPDATE conversations SET updated_at = now() WHERE id = $1", [id]);
  }

  async renameConversation(id: number, userId: number, title: string): Promise<Conversation | null> {
    const result = await this.pool.query(
      "UPDATE conversations SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
      [title, id, userId]
    );
    return result.rows[0] ? this.mapConversation(result.rows[0]) : null;
  }

  async deleteConversation(id: number, userId: number): Promise<void> {
    await this.pool.query("DELETE FROM conversations WHERE id = $1 AND user_id = $2", [id, userId]);
  }

  // ---- Messages ----------------------------------------------------------

  async addMessage(input: NewMessageInput): Promise<ChatMessageRecord> {
    const result = await this.pool.query(
      `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id, name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        input.conversationId,
        input.role,
        input.content,
        input.toolCalls ?? null,
        input.toolCallId ?? null,
        input.name ?? null,
      ]
    );
    return this.mapMessage(result.rows[0]);
  }

  async getMessages(conversationId: number, limit = 100): Promise<ChatMessageRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM (
         SELECT * FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2
       ) sub ORDER BY id ASC`,
      [conversationId, limit]
    );
    return result.rows.map((row) => this.mapMessage(row));
  }

  // ---- Memory ----------------------------------------------------------

  async listMemory(userId: number): Promise<MemoryEntry[]> {
    const result = await this.pool.query(
      "SELECT key, value, updated_at FROM memory WHERE user_id = $1 ORDER BY key ASC",
      [userId]
    );
    return result.rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: this.toIso(row.updated_at),
    }));
  }

  async getMemory(userId: number, key: string): Promise<MemoryEntry | null> {
    const result = await this.pool.query(
      "SELECT key, value, updated_at FROM memory WHERE user_id = $1 AND key = $2",
      [userId, key]
    );
    const row = result.rows[0];
    return row ? { key: row.key, value: row.value, updatedAt: this.toIso(row.updated_at) } : null;
  }

  async setMemory(userId: number, key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory (user_id, key, value, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [userId, key, value]
    );
  }

  async deleteMemory(userId: number, key: string): Promise<void> {
    await this.pool.query("DELETE FROM memory WHERE user_id = $1 AND key = $2", [userId, key]);
  }

  // ---- Settings ----------------------------------------------------------

  async getSettings(userId: number): Promise<UserSettings> {
    const settingsResult = await this.pool.query(
      "SELECT persona, voice_mode FROM user_settings WHERE user_id = $1",
      [userId]
    );
    const row = settingsResult.rows[0];
    const persona: PersonaConfig = row?.persona ? JSON.parse(row.persona) : DEFAULT_PERSONA;
    const voiceMode: string = row?.voice_mode ?? "native";

    const permissionResult = await this.pool.query(
      "SELECT tool_name, enabled FROM tool_permissions WHERE user_id = $1",
      [userId]
    );
    const toolPermissions: Record<string, boolean> = {};
    for (const permRow of permissionResult.rows) {
      toolPermissions[permRow.tool_name] = Boolean(permRow.enabled);
    }

    return { persona, toolPermissions, voiceMode };
  }

  async setPersona(userId: number, persona: PersonaConfig): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_settings (user_id, persona) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET persona = EXCLUDED.persona`,
      [userId, JSON.stringify(persona)]
    );
  }

  async setToolPermission(userId: number, tool: string, enabled: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_permissions (user_id, tool_name, enabled) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tool_name) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [userId, tool, enabled]
    );
  }

  async setVoiceMode(userId: number, mode: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_settings (user_id, voice_mode) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET voice_mode = EXCLUDED.voice_mode`,
      [userId, mode]
    );
  }

  // ---- Hub agents ---------------------------------------------------------

  async createHubAgent(input: NewHubAgentInput): Promise<HubAgent> {
    const result = await this.pool.query(
      `INSERT INTO hub_agents (user_id, name, provider, model, api_key, base_url, system_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        input.userId,
        input.name,
        input.provider,
        input.model,
        input.apiKeySealed,
        input.baseUrl ?? null,
        input.systemPrompt ?? "",
      ]
    );
    return this.mapHubAgent(result.rows[0]);
  }

  async listHubAgents(userId: number): Promise<HubAgent[]> {
    const result = await this.pool.query(
      "SELECT * FROM hub_agents WHERE user_id = $1 ORDER BY id ASC",
      [userId]
    );
    return result.rows.map((row) => this.mapHubAgent(row));
  }

  async getHubAgent(id: number, userId: number): Promise<HubAgent | null> {
    const result = await this.pool.query(
      "SELECT * FROM hub_agents WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    return result.rows[0] ? this.mapHubAgent(result.rows[0]) : null;
  }

  async updateHubAgent(id: number, userId: number, patch: HubAgentPatch): Promise<HubAgent | null> {
    const columns: Record<string, unknown> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.provider !== undefined) columns.provider = patch.provider;
    if (patch.model !== undefined) columns.model = patch.model;
    if (patch.apiKeySealed !== undefined) columns.api_key = patch.apiKeySealed;
    if (patch.baseUrl !== undefined) columns.base_url = patch.baseUrl;
    if (patch.systemPrompt !== undefined) columns.system_prompt = patch.systemPrompt;

    const entries = Object.entries(columns);
    if (entries.length > 0) {
      const sets = entries.map(([column], index) => `${column} = $${index + 3}`);
      await this.pool.query(
        `UPDATE hub_agents SET ${sets.join(", ")} WHERE id = $1 AND user_id = $2`,
        [id, userId, ...entries.map(([, value]) => value)]
      );
    }
    return this.getHubAgent(id, userId);
  }

  async deleteHubAgent(id: number, userId: number): Promise<void> {
    await this.pool.query("DELETE FROM hub_agents WHERE id = $1 AND user_id = $2", [id, userId]);
  }

  // ---- Hub sessions -------------------------------------------------------

  async createHubSession(input: NewHubSessionInput): Promise<HubSession> {
    const result = await this.pool.query(
      `INSERT INTO hub_sessions (user_id, title, goal, mode, max_rounds, synthesize)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.userId, input.title, input.goal, input.mode, input.maxRounds, input.synthesize]
    );
    const sessionId = result.rows[0].id;

    for (let position = 0; position < input.agentIds.length; position++) {
      await this.pool.query(
        "INSERT INTO hub_session_agents (session_id, agent_id, position) VALUES ($1, $2, $3)",
        [sessionId, input.agentIds[position], position]
      );
    }

    const session = await this.getHubSession(sessionId, input.userId);
    if (!session) throw new Error("Failed to create hub session");
    return session;
  }

  async listHubSessions(userId: number): Promise<HubSession[]> {
    const result = await this.pool.query(
      "SELECT * FROM hub_sessions WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId]
    );
    const sessions: HubSession[] = [];
    for (const row of result.rows) {
      sessions.push(this.mapHubSession(row, await this.getSessionAgentIds(row.id)));
    }
    return sessions;
  }

  async getHubSession(id: number, userId: number): Promise<HubSession | null> {
    const result = await this.pool.query(
      "SELECT * FROM hub_sessions WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    const row = result.rows[0];
    return row ? this.mapHubSession(row, await this.getSessionAgentIds(row.id)) : null;
  }

  async setHubSessionStatus(id: number, status: HubSessionStatus): Promise<void> {
    await this.pool.query(
      "UPDATE hub_sessions SET status = $1, updated_at = now() WHERE id = $2",
      [status, id]
    );
  }

  async deleteHubSession(id: number, userId: number): Promise<void> {
    await this.pool.query("DELETE FROM hub_sessions WHERE id = $1 AND user_id = $2", [id, userId]);
  }

  // ---- Hub messages -------------------------------------------------------

  async addHubMessage(input: NewHubMessageInput): Promise<HubMessageRecord> {
    const result = await this.pool.query(
      `INSERT INTO hub_messages (session_id, agent_id, author_name, role, content, round)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        input.sessionId,
        input.agentId ?? null,
        input.authorName,
        input.role,
        input.content,
        input.round ?? 0,
      ]
    );
    await this.pool.query("UPDATE hub_sessions SET updated_at = now() WHERE id = $1", [
      input.sessionId,
    ]);
    return this.mapHubMessage(result.rows[0]);
  }

  async getHubMessages(sessionId: number, limit = 500): Promise<HubMessageRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM (
         SELECT * FROM hub_messages WHERE session_id = $1 ORDER BY id DESC LIMIT $2
       ) sub ORDER BY id ASC`,
      [sessionId, limit]
    );
    return result.rows.map((row) => this.mapHubMessage(row));
  }

  private async getSessionAgentIds(sessionId: number): Promise<number[]> {
    const result = await this.pool.query(
      "SELECT agent_id FROM hub_session_agents WHERE session_id = $1 ORDER BY position ASC",
      [sessionId]
    );
    return result.rows.map((row) => Number(row.agent_id));
  }

  // ---- Mappers ----------------------------------------------------------

  private toIso(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private mapUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: this.toIso(row.created_at),
    };
  }

  private mapConversation(row: any): Conversation {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
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
      createdAt: this.toIso(row.created_at),
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
      createdAt: this.toIso(row.created_at),
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
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
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
      createdAt: this.toIso(row.created_at),
    };
  }
}
