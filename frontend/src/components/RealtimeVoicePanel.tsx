import { useEffect } from "react";
import { useRealtimeSession } from "../voice/useRealtimeSession";

export function RealtimeVoicePanel({ onClose }: { onClose: () => void }) {
  const { connected, connecting, error, transcripts, muted, gain, connect, disconnect, toggleMute, setGain } =
    useRealtimeSession();

  useEffect(() => {
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Live voice">
      <div className="modal realtime-panel">
        <h2>Live voice</h2>
        <p className="realtime-hint">
          Talk naturally - the assistant streams audio back in real time and you can interrupt it
          by speaking.
        </p>

        {error && <p className="error-text">{error}</p>}

        <div className="realtime-transcripts">
          {transcripts.length === 0 && (
            <p className="muted">{connected ? "Listening… start talking." : "Not connected yet."}</p>
          )}
          {transcripts.map((t, i) => (
            <div key={i} className={`realtime-line realtime-${t.role}`}>
              <strong>{t.role === "user" ? "You" : "Assistant"}:</strong> {t.text}
            </div>
          ))}
        </div>

        {connected && (
          <div className="realtime-controls">
            <button
              className={`mic-mute-btn${muted ? " muted" : ""}`}
              onClick={toggleMute}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? "🎤✕ Unmute" : "🎤 Mute"}
            </button>
            <label className="gain-label">
              <span>Sensitivity</span>
              <input
                type="range"
                className="gain-slider"
                min={0}
                max={2}
                step={0.05}
                value={gain}
                onChange={(e) => setGain(Number(e.target.value))}
                aria-label="Microphone sensitivity"
              />
              <span className="gain-value">{Math.round(gain * 100)}%</span>
            </label>
          </div>
        )}

        <div className="modal-actions">
          {!connected ? (
            <button onClick={connect} disabled={connecting}>
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
          Note: live voice conversations connect directly to OpenAI from your browser using a
          short-lived token and are not currently saved to your chat history.
        </p>
      </div>
    </div>
  );
}
