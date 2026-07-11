export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: MessageRole;
  content: string;
  toolCalls: string | null;
  toolCallId: string | null;
  name: string | null;
  createdAt: string;
}

export interface Conversation {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export interface PersonaConfig {
  name: string;
  systemPrompt: string;
  description: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  permission: string;
  enabled: boolean;
}

export type VoiceMode = "realtime" | "elevenlabs" | "pipeline" | "browser" | "native";

export interface SettingsResponse {
  persona: PersonaConfig;
  voiceMode: VoiceMode;
  tools: ToolInfo[];
  voiceModes: VoiceMode[];
}

/** Streaming events emitted by POST /api/chat/conversations/:id/messages */
export type ChatStreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: string }
  | { type: "done"; content: string }
  | { type: "error"; message: string };

// ---- Orchestration hub ------------------------------------------------------

export type HubProvider = "openai" | "anthropic" | "google" | "openai_compatible";

/** A configured LLM account/persona. The API key never reaches the browser. */
export interface HubAgent {
  id: number;
  name: string;
  provider: HubProvider;
  model: string;
  baseUrl: string | null;
  systemPrompt: string;
  createdAt: string;
}

export interface HubAgentInput {
  name: string;
  provider: HubProvider;
  model: string;
  apiKey?: string;
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
  agentIds: number[];
  createdAt: string;
  updatedAt: string;
}

export type HubMessageRole = "agent" | "user" | "system" | "synthesis";

export interface HubMessage {
  id: number;
  sessionId: number;
  agentId: number | null;
  authorName: string;
  role: HubMessageRole;
  content: string;
  round: number;
  createdAt: string;
}

/** Streaming events emitted by POST /api/hub/sessions/:id/run */
export type HubRunEvent =
  | { type: "status"; status: HubSessionStatus }
  | { type: "turn_start"; agentId: number; agentName: string; round: number }
  | { type: "message"; message: HubMessage }
  | { type: "turn_error"; agentId: number; agentName: string; message: string }
  | { type: "done"; status: HubSessionStatus }
  | { type: "error"; message: string };
