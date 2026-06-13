import { Pool } from "pg";
import { DEFAULT_PERSONA, type PersonaConfig } from "../config/persona.js";
import type {
  ChatMessageRecord,
  Conversation,
  DatabaseAdapter,
  MemoryEntry,
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

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id);
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
}
