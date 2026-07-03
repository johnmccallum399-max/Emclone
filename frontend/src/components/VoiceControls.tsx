import type { VoiceMode } from "../types";
import type { VoiceController } from "../voice/types";

interface VoiceControlsProps {
  voiceMode: VoiceMode;
  controller: VoiceController | null;
  autoSpeak: boolean;
  onToggleAutoSpeak: () => void;
  disabled?: boolean;
  onOpenRealtime: () => void;
  onOpenElevenLabs: () => void;
}

const MODE_LABELS: Record<VoiceMode, string> = {
  realtime: "Realtime (live voice)",
  elevenlabs: "cmdr Montebank (ElevenLabs)",
  pipeline: "Whisper + TTS pipeline",
  browser: "Browser mic + OpenAI voice",
  native: "Fully on-device (free)",
};

export function VoiceControls({
  voiceMode,
  controller,
  autoSpeak,
  onToggleAutoSpeak,
  disabled,
  onOpenRealtime,
  onOpenElevenLabs,
}: VoiceControlsProps) {
  if (voiceMode === "realtime" || voiceMode === "elevenlabs") {
    return (
      <div className="voice-controls">
        <button
          type="button"
          className="voice-btn"
          onClick={voiceMode === "realtime" ? onOpenRealtime : onOpenElevenLabs}
          disabled={disabled}
        >
          Start live voice
        </button>
        <span className="voice-mode-label">{MODE_LABELS[voiceMode]}</span>
      </div>
    );
  }

  if (!controller) return null;

  if (!controller.supported) {
    return (
      <div className="voice-controls voice-unsupported">
        Voice mode "{MODE_LABELS[voiceMode]}" is not supported in this browser. Try Chrome/Edge, or
        switch modes in Settings.
      </div>
    );
  }

  return (
    <div className="voice-controls">
      <button
        type="button"
        className={`voice-btn mic-btn ${controller.isListening ? "listening" : ""}`}
        onClick={() => (controller.isListening ? controller.stop() : controller.start())}
        disabled={disabled}
        title={controller.isListening ? "Stop listening" : "Speak to the assistant"}
        aria-pressed={controller.isListening}
      >
        {controller.isListening ? "Stop" : "Speak"}
      </button>

      <label className="auto-speak-toggle">
        <input type="checkbox" checked={autoSpeak} onChange={onToggleAutoSpeak} />
        Speak replies
      </label>

      <span className="voice-mode-label">{MODE_LABELS[voiceMode]}</span>

      {controller.isSpeaking && <span className="speaking-indicator">Speaking…</span>}
      {controller.error && <span className="voice-error">{controller.error}</span>}
    </div>
  );
}
