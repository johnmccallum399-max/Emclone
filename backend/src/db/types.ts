import type { PersonaConfig } from "../config/persona.js";

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface Conversation {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessageRecord {
  id: number;
  conversationId: number;
  role: MessageRole;
  content: string;
  /** JSON-serialized OpenAI tool_calls array, when role === "assistant" */
  toolCalls: string | null;
  /** Tool call id this message is responding to, when role === "tool" */
  toolCallId: string | null;
  /** Tool name, when role === "tool" */
  name: string | null;
  createdAt: string;
}

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export interface UserSettings {
  persona: PersonaConfig;
  toolPermissions: Record<string, boolean>;
  voiceMode: string;
}

export interface NewMessageInput {
  conversationId: number;
  role: MessageRole;
  content: string;
  toolCalls?: string | null;
  toolCallId?: string | null;
  name?: string | null;
}

/**
 * Storage-agnostic interface implemented by both the SQLite and PostgreSQL
 * adapters. Keeping this surface small makes it straightforward to add new
 * backends later.
 */
export interface DatabaseAdapter {
  init(): Promise<void>;
  close(): Promise<void>;

  // Users
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(id: number): Promise<User | null>;
  createUser(username: string, passwordHash: string): Promise<User>;
  countUsers(): Promise<number>;

  // Conversations
  createConversation(userId: number, title: string): Promise<Conversation>;
  listConversations(userId: number): Promise<Conversation[]>;
  getConversation(id: number, userId: number): Promise<Conversation | null>;
  touchConversation(id: number): Promise<void>;
  deleteConversation(id: number, userId: number): Promise<void>;

  // Messages
  addMessage(input: NewMessageInput): Promise<ChatMessageRecord>;
  getMessages(conversationId: number, limit?: number): Promise<ChatMessageRecord[]>;

  // Long-term memory (user preferences / facts)
  listMemory(userId: number): Promise<MemoryEntry[]>;
  getMemory(userId: number, key: string): Promise<MemoryEntry | null>;
  setMemory(userId: number, key: string, value: string): Promise<void>;
  deleteMemory(userId: number, key: string): Promise<void>;

  // Settings (persona + tool permissions + voice mode)
  getSettings(userId: number): Promise<UserSettings>;
  setPersona(userId: number, persona: PersonaConfig): Promise<void>;
  setToolPermission(userId: number, tool: string, enabled: boolean): Promise<void>;
  setVoiceMode(userId: number, mode: string): Promise<void>;
}
