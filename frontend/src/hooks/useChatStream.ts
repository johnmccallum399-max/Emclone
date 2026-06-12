import { useCallback, useEffect, useState } from "react";
import { getMessages, streamChat } from "../api/client";
import type { ChatMessage, ChatStreamEvent } from "../types";

export interface ToolEvent {
  name: string;
  status: "calling" | "done";
  result?: string;
}

export interface StreamingState {
  content: string;
  toolEvents: ToolEvent[];
}

export function useChatStream(conversationId: number | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (conversationId == null) {
      setMessages([]);
      return;
    }
    setLoading(true);
    getMessages(conversationId)
      .then(setMessages)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [conversationId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const sendMessage = useCallback(
    async (text: string, onComplete?: (finalText: string) => void) => {
      if (conversationId == null || !text.trim()) return;
      setError(null);

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          conversationId,
          role: "user",
          content: text,
          toolCalls: null,
          toolCallId: null,
          name: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setStreaming({ content: "", toolEvents: [] });

      try {
        await streamChat(conversationId, text, (event: ChatStreamEvent) => {
          if (event.type === "token") {
            setStreaming((prev) => (prev ? { ...prev, content: prev.content + event.content } : prev));
          } else if (event.type === "tool_call") {
            setStreaming((prev) =>
              prev ? { ...prev, toolEvents: [...prev.toolEvents, { name: event.name, status: "calling" }] } : prev
            );
          } else if (event.type === "tool_result") {
            setStreaming((prev) => {
              if (!prev) return prev;
              const toolEvents = prev.toolEvents.map((te) =>
                te.name === event.name && te.status === "calling"
                  ? { ...te, status: "done" as const, result: event.result }
                  : te
              );
              return { ...prev, toolEvents };
            });
          } else if (event.type === "done") {
            onComplete?.(event.content);
          } else if (event.type === "error") {
            setError(event.message);
          }
        });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setStreaming(null);
        reload();
      }
    },
    [conversationId, reload]
  );

  return { messages, loading, streaming, error, sendMessage, reload };
}
