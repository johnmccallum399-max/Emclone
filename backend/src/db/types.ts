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

// ---- Orchestration hub -----------------------------------------------------

/**
 * Where an agent's completions come from. `openai_compatible` covers any
 * service exposing the OpenAI chat-completions API shape (Grok/xAI, Mistral,
 * Groq, OpenRouter, DeepSeek, Ollama, ...) via a custom base URL.
 */
export type HubProvider = "openai" | "anthropic" | "google" | "openai_compatible";

export interface HubAgent {
  id: number;
  userId: number;
  name: string;
  provider: HubProvider;
  model: string;
  /** Sealed (AES-256-GCM) API key — decrypt with utils/secretBox before use. */
  apiKeySealed: string;
  baseUrl: string | null;
  systemPrompt: string;
  createdAt: string;
}

export interface NewHubAgentInput {
  userId: number;
  name: string;
  provider: HubProvider;
  model: string;
  apiKeySealed: string;
  baseUrl?: string | null;
  systemPrompt?: string;
}

export interface HubAgentPatch {
  name?: string;
  provider?: HubProvider;
  model?: string;
  apiKeySealed?: string;
  baseUrl?: string | null;
  systemPrompt?: string;
}

export type HubSessionMode = "discussion" | "debate" | "pipeline";
export type HubSessionStatus = "idle" | "running" | "completed" | "stopped" | "error";

export interface HubSession {
  id: number;
  userId: number;
  title: string;
  goal: string;
  mode: HubSessionMode;
  maxRounds: number;
  synthesize: boolean;
  status: HubSessionStatus;
  /** Participating agent ids, in speaking order. */
  agentIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface NewHubSessionInput {
  userId: number;
  title: string;
  goal: string;
  mode: HubSessionMode;
  maxRounds: number;
  synthesize: boolean;
  agentIds: number[];
}

export type HubMessageRole = "agent" | "user" | "system" | "synthesis";

export interface HubMessageRecord {
  id: number;
  sessionId: number;
  /** Null for user/system messages, or when the authoring agent was deleted. */
  agentId: number | null;
  /** Display-name snapshot so transcripts survive agent renames/deletes. */
  authorName: string;
  role: HubMessageRole;
  content: string;
  round: number;
  createdAt: string;
}

export interface NewHubMessageInput {
  sessionId: number;
  agentId?: number | null;
  authorName: string;
  role: HubMessageRole;
  content: string;
  round?: number;
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
  renameConversation(id: number, userId: number, title: string): Promise<Conversation | null>;
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

  // Orchestration hub: agents
  createHubAgent(input: NewHubAgentInput): Promise<HubAgent>;
  listHubAgents(userId: number): Promise<HubAgent[]>;
  getHubAgent(id: number, userId: number): Promise<HubAgent | null>;
  updateHubAgent(id: number, userId: number, patch: HubAgentPatch): Promise<HubAgent | null>;
  deleteHubAgent(id: number, userId: number): Promise<void>;

  // Orchestration hub: sessions
  createHubSession(input: NewHubSessionInput): Promise<HubSession>;
  listHubSessions(userId: number): Promise<HubSession[]>;
  getHubSession(id: number, userId: number): Promise<HubSession | null>;
  setHubSessionStatus(id: number, status: HubSessionStatus): Promise<void>;
  deleteHubSession(id: number, userId: number): Promise<void>;

  // Orchestration hub: messages
  addHubMessage(input: NewHubMessageInput): Promise<HubMessageRecord>;
  getHubMessages(sessionId: number, limit?: number): Promise<HubMessageRecord[]>;
}
