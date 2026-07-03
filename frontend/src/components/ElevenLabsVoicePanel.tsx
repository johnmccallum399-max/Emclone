import { useCallback, useEffect, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

/**
 * Public agent ID for the ElevenLabs Conversational AI agent
 * ("cmdr Montebank"). Overridable at build time so other deployments can
 * point at their own agent without touching code.
 */
const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID || "agent_0701kwm991q5etvrar8ndy4zyy8k";

interface TranscriptEntry {
  role: "user" | "agent";
  text: string;
}

function ElevenLabsConversation({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const conversation = useConversation({
    onMessage: ({ message, role }) => {
      setTranscripts((prev) => [...prev, { role, text: message }]);
    },
    onError: (message) => setError(message),
  });

  const connected = conversation.status === "connected";
  const connecting = conversation.status === "connecting";

  const connect = useCallback(async () => {
    setError(null);
    setTranscripts([]);
    try {
      // Prompt for mic access up front so startSession doesn't fail silently.
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "webrtc",
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [conversation]);

  const disconnect = useCallback(() => {
    conversation.endSession();
  }, [conversation]);

  useEffect(() => {
    return () => conversation.endSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="cmdr Montebank live voice">
      <div className="modal realtime-panel">
        <h2>cmdr Montebank</h2>
        <p className="realtime-hint">
          Talk naturally with cmdr Montebank (ElevenLabs) - the agent streams audio back in real
          time and you can interrupt it by speaking.
        </p>

        {error && <p className="error-text">{error}</p>}

        <div className="realtime-transcripts">
          {transcripts.length === 0 && (
            <p className="muted">
              {connected
                ? conversation.isSpeaking
                  ? "Agent is speaking…"
                  : "Listening… start talking."
                : "Not connected yet."}
            </p>
          )}
          {transcripts.map((t, i) => (
            <div key={i} className={`realtime-line realtime-${t.role === "user" ? "user" : "assistant"}`}>
              <strong>{t.role === "user" ? "You" : "cmdr Montebank"}:</strong> {t.text}
            </div>
          ))}
        </div>

        {connected && (
          <p className="muted">{conversation.isSpeaking ? "Agent is speaking…" : "Listening…"}</p>
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
          Note: this voice mode connects directly to ElevenLabs from your browser and is not
          currently saved to your chat history.
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
