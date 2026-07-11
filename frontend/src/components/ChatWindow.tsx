import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../context/SettingsContext";
import { useChatStream } from "../hooks/useChatStream";
import { useVoiceController } from "../voice/useVoiceController";
import { ChatInput } from "./ChatInput";
import { MessageBubble } from "./MessageBubble";
import { RealtimeVoicePanel } from "./RealtimeVoicePanel";
import { VoiceControls } from "./VoiceControls";

// Lazy-loaded so the ElevenLabs SDK (which bundles livekit-client, ~500 kB)
// is only fetched when the panel is actually opened.
const ElevenLabsVoicePanel = lazy(() =>
  import("./ElevenLabsVoicePanel").then((m) => ({ default: m.ElevenLabsVoicePanel }))
);

interface ChatWindowProps {
  conversationId: number | null;
}

export function ChatWindow({ conversationId }: ChatWindowProps) {
  const { settings } = useSettings();
  const { messages, loading, streaming, error, sendMessage } = useChatStream(conversationId);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [realtimeOpen, setRealtimeOpen] = useState(false);
  const [elevenLabsOpen, setElevenLabsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingSpeakRef = useRef<((text: string) => Promise<void>) | null>(null);

  const voiceMode = settings?.voiceMode ?? "native";

  const handleTranscript = useCallback(
    (text: string) => {
      void sendMessage(text, (finalText) => {
        if (autoSpeak && pendingSpeakRef.current) {
          void pendingSpeakRef.current(finalText);
        }
      });
    },
    [sendMessage, autoSpeak]
  );

  const controller = useVoiceController(voiceMode, handleTranscript);
  pendingSpeakRef.current = controller?.speak ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const handleSend = useCallback(
    (text: string) => {
      void sendMessage(text, (finalText) => {
        if (autoSpeak && pendingSpeakRef.current) {
          void pendingSpeakRef.current(finalText);
        }
      });
    },
    [sendMessage, autoSpeak]
  );

  if (conversationId == null) {
    return (
      <div className="chat-window chat-window-empty">
        <p>Select a conversation or start a new one to begin.</p>
      </div>
    );
  }

  return (
    <div className="chat-window">
      <div className="messages" ref={scrollRef}>
        {loading && <p className="muted">Loading conversation...</p>}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {streaming && (
          <div className="message message-assistant">
            <div className="message-role">Assistant</div>
            {streaming.toolEvents.map((te, i) => (
              <div className="tool-badge" key={`${te.name}-${i}`}>
                <span className="tool-badge-icon" aria-hidden>
                  🛠
                </span>
                <span className="tool-badge-label">
                  {te.status === "calling" ? `Using ${te.name}…` : `${te.name} done`}
                </span>
              </div>
            ))}
            <div className="message-content">{streaming.content || (streaming.toolEvents.length === 0 ? "…" : "")}</div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="composer">
        <VoiceControls
          voiceMode={voiceMode}
          controller={controller}
          autoSpeak={autoSpeak}
          onToggleAutoSpeak={() => setAutoSpeak((v) => !v)}
          disabled={!!streaming}
          onOpenRealtime={() => setRealtimeOpen(true)}
          onOpenElevenLabs={() => setElevenLabsOpen(true)}
        />
        <ChatInput onSend={handleSend} disabled={!!streaming} />
      </div>

      {realtimeOpen && <RealtimeVoicePanel onClose={() => setRealtimeOpen(false)} />}
      {elevenLabsOpen && (
        <Suspense fallback={null}>
          <ElevenLabsVoicePanel onClose={() => setElevenLabsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
