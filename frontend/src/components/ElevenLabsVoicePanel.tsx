import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { listMemory } from "../api/client";
import { useSettings } from "../context/SettingsContext";

/**
 * Public agent ID for the ElevenLabs Conversational AI agent
 * ("cmdr Montebank") that provides the assistant's audio interface.
 * Overridable at build time so other deployments can point at their own
 * agent without touching code.
 */
const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID || "agent_0701kwm991q5etvrar8ndy4zyy8k";

interface TranscriptEntry {
  role: "user" | "agent";
  text: string;
}

type SessionOverrides = {
  agent: { prompt: { prompt: string }; firstMessage: string };
};

function ElevenLabsConversation({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const assistantName = settings?.persona.name || "Assistant";

  // Tracks the current connection attempt so a rejected persona override can
  // fall back to the agent's built-in persona exactly once.
  const attemptRef = useRef<"idle" | "overrides" | "plain">("idle");

  const conversation = useConversation({
    onMessage: ({ message, role }) => {
      setTranscripts((prev) => [...prev, { role, text: message }]);
    },
    onError: (message) => {
      if (attemptRef.current === "overrides") {
        attemptRef.current = "plain";
        setNotice(
          "The agent rejected the persona override (enable prompt/first-message overrides in its ElevenLabs security settings). Connected with the agent's default persona instead."
        );
        conversation.startSession({ agentId: AGENT_ID, connectionType: "webrtc" });
        return;
      }
      setError(message);
    },
  });

  const connected = conversation.status === "connected";
  const connecting = conversation.status === "connecting";

  const connect = useCallback(async () => {
    setError(null);
    setNotice(null);
    setTranscripts([]);

    try {
      // Prompt for mic access up front so startSession doesn't fail silently.
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Apply the app assistant's identity to the voice session: the
      // configured system prompt plus persisted long-term memory, so the
      // agent speaks as this assistant rather than as a standalone persona.
      let overrides: SessionOverrides | undefined;
      const persona = settings?.persona;
      if (persona) {
        let memoryBlock = "";
        try {
          const memory = await listMemory();
          if (memory.length > 0) {
            memoryBlock =
              "\n\nKnown facts about the user (from long-term memory):\n" +
              memory.map((m) => `- ${m.key}: ${m.value}`).join("\n");
          }
        } catch {
          // Memory is enrichment only; connect without it if the call fails.
        }
        overrides = {
          agent: {
            prompt: {
              prompt: `You are ${persona.name}, speaking with the user by voice.\n\n${persona.systemPrompt}${memoryBlock}`,
            },
            firstMessage: `Hi, I'm ${persona.name}. What's on your mind?`,
          },
        };
      }

      attemptRef.current = overrides ? "overrides" : "plain";
      conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "webrtc",
        overrides,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [conversation, settings]);

  const disconnect = useCallback(() => {
    attemptRef.current = "idle";
    conversation.endSession();
  }, [conversation]);

  useEffect(() => {
    return () => conversation.endSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`${assistantName} live voice`}>
      <div className="modal realtime-panel">
        <h2>{assistantName} - live voice</h2>
        <p className="realtime-hint">
          Talk naturally with {assistantName} - your assistant's personality and memory are applied
          to the voice session, audio streams back in real time, and you can interrupt it by
          speaking.
        </p>

        {error && <p className="error-text">{error}</p>}
        {notice && <p className="muted">{notice}</p>}

        <div className="realtime-transcripts">
          {transcripts.length === 0 && (
            <p className="muted">
              {connected
                ? conversation.isSpeaking
                  ? `${assistantName} is speaking…`
                  : "Listening… start talking."
                : "Not connected yet."}
            </p>
          )}
          {transcripts.map((t, i) => (
            <div key={i} className={`realtime-line realtime-${t.role === "user" ? "user" : "assistant"}`}>
              <strong>{t.role === "user" ? "You" : assistantName}:</strong> {t.text}
            </div>
          ))}
        </div>

        {connected && (
          <p className="muted">{conversation.isSpeaking ? `${assistantName} is speaking…` : "Listening…"}</p>
        )}

        <div className="modal-actions">
          {!connected ? (
            <button onClick={() => void connect()} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect"}
            </button>
          ) : (
            <button onClick={disconnect}>Disconnect</button>
          )}
          <button
            className="secondary"
            onClick={() => {
              disconnect();
              onClose();
            }}
          >
            Close
          </button>
        </div>

        <p className="realtime-note">
          Note: voice audio is handled by the ElevenLabs agent "cmdr Montebank" directly from your
          browser and is not currently saved to your chat history.
        </p>
      </div>
    </div>
  );
}

export function ElevenLabsVoicePanel({ onClose }: { onClose: () => void }) {
  return (
    <ConversationProvider>
      <ElevenLabsConversation onClose={onClose} />
    </ConversationProvider>
  );
}
