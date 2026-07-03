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
