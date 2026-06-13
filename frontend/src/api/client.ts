import type {
  ChatMessage,
  ChatStreamEvent,
  Conversation,
  MemoryEntry,
  PersonaConfig,
  SettingsResponse,
  VoiceMode,
} from "../types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

const TOKEN_STORAGE_KEY = "assistant.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(response.status, message);
  }

  return response;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  return (await response.json()) as T;
}

// ---- Auth -------------------------------------------------------------

export async function login(username: string, password: string): Promise<{ token: string; user: { id: number; username: string } }> {
  return apiJson("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export async function getMe(): Promise<{ user: { id: number; username: string } }> {
  return apiJson("/api/auth/me");
}

// ---- Conversations & chat ------------------------------------------------

export async function listConversations(): Promise<Conversation[]> {
  const data = await apiJson<{ conversations: Conversation[] }>("/api/chat/conversations");
  return data.conversations;
}

export async function createConversation(title?: string): Promise<Conversation> {
  const data = await apiJson<{ conversation: Conversation }>("/api/chat/conversations", {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
  return data.conversation;
}

export async function deleteConversation(id: number): Promise<void> {
  await apiFetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
}

export async function getMessages(conversationId: number): Promise<ChatMessage[]> {
  const data = await apiJson<{ messages: ChatMessage[] }>(`/api/chat/conversations/${conversationId}/messages`);
  return data.messages;
}

/**
 * Sends a message and streams the assistant's reply. Uses fetch + a
 * ReadableStream (not EventSource) so the Authorization header can be sent.
 */
export async function streamChat(
  conversationId: number,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await apiFetch(`/api/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message }),
    signal,
  });

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming is not supported by this browser.");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice("data:".length).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as ChatStreamEvent);
      } catch {
        // ignore malformed frames
      }
    }
  }
}

// ---- Memory -------------------------------------------------------------

export async function listMemory(): Promise<MemoryEntry[]> {
  const data = await apiJson<{ entries: MemoryEntry[] }>("/api/memory");
  return data.entries;
}

export async function setMemory(key: string, value: string): Promise<void> {
  await apiFetch("/api/memory", { method: "PUT", body: JSON.stringify({ key, value }) });
}

export async function deleteMemory(key: string): Promise<void> {
  await apiFetch(`/api/memory/${encodeURIComponent(key)}`, { method: "DELETE" });
}

// ---- Settings -------------------------------------------------------------

export async function getSettings(): Promise<SettingsResponse> {
  return apiJson("/api/settings");
}

export async function updatePersona(persona: PersonaConfig): Promise<void> {
  await apiFetch("/api/settings/persona", { method: "PUT", body: JSON.stringify(persona) });
}

export async function setToolEnabled(name: string, enabled: boolean): Promise<void> {
  await apiFetch(`/api/settings/tools/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export async function setVoiceMode(mode: VoiceMode): Promise<void> {
  await apiFetch("/api/settings/voice", { method: "PUT", body: JSON.stringify({ mode }) });
}

// ---- Voice ----------------------------------------------------------------

export async function createRealtimeSession(): Promise<any> {
  return apiJson("/api/voice/realtime-session", { method: "POST" });
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", blob, "recording.webm");
  const data = await apiJson<{ text: string }>("/api/voice/transcribe", {
    method: "POST",
    body: formData,
  });
  return data.text;
}

export async function speakText(text: string): Promise<Blob> {
  const response = await apiFetch("/api/voice/speak", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return response.blob();
}
