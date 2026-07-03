import { useEffect, useState, type FormEvent } from "react";
import { deleteMemory, listMemory, setMemory, setToolEnabled, setVoiceMode, updatePersona } from "../api/client";
import { useSettings } from "../context/SettingsContext";
import type { MemoryEntry, PersonaConfig, VoiceMode } from "../types";

interface SettingsPanelProps {
  onClose: () => void;
}

const VOICE_MODE_LABELS: Record<VoiceMode, string> = {
  realtime: "Realtime (live voice, WebRTC)",
  elevenlabs: "ElevenLabs (live voice, cmdr Montebank agent)",
  pipeline: "Whisper + TTS pipeline",
  browser: "Browser mic + OpenAI voice",
  native: "Fully on-device (free)",
};

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { settings, loading, refresh, setLocalVoiceMode } = useSettings();

  const [persona, setPersona] = useState<PersonaConfig>({ name: "", systemPrompt: "", description: "" });
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaSaved, setPersonaSaved] = useState(false);

  const [memory, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    if (settings) setPersona(settings.persona);
  }, [settings]);

  useEffect(() => {
    void refreshMemory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshMemory() {
    setMemoryLoading(true);
    try {
      setMemoryEntries(await listMemory());
    } finally {
      setMemoryLoading(false);
    }
  }

  async function handleSavePersona(e: FormEvent) {
    e.preventDefault();
    setPersonaSaving(true);
    setPersonaSaved(false);
    try {
      await updatePersona(persona);
      await refresh();
      setPersonaSaved(true);
    } finally {
      setPersonaSaving(false);
    }
  }

  async function handleToggleTool(name: string, enabled: boolean) {
    await setToolEnabled(name, enabled);
    await refresh();
  }

  async function handleVoiceModeChange(mode: VoiceMode) {
    setLocalVoiceMode(mode);
    await setVoiceMode(mode);
  }

  async function handleAddMemory(e: FormEvent) {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    await setMemory(newKey.trim(), newValue.trim());
    setNewKey("");
    setNewValue("");
    await refreshMemory();
  }

  async function handleDeleteMemory(key: string) {
    await deleteMemory(key);
    await refreshMemory();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal settings-panel">
        <div className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        {loading && <p className="muted">Loading settings...</p>}

        {settings && (
          <>
            <section className="settings-section">
              <h3>Personality</h3>
              <form onSubmit={handleSavePersona} className="persona-form">
                <label htmlFor="persona-name">Name</label>
                <input
                  id="persona-name"
                  value={persona.name}
                  onChange={(e) => setPersona((p) => ({ ...p, name: e.target.value }))}
                  maxLength={50}
                  required
                />

                <label htmlFor="persona-description">Description</label>
                <input
                  id="persona-description"
                  value={persona.description}
                  onChange={(e) => setPersona((p) => ({ ...p, description: e.target.value }))}
                  maxLength={500}
                />

                <label htmlFor="persona-prompt">System prompt</label>
                <textarea
                  id="persona-prompt"
                  value={persona.systemPrompt}
                  onChange={(e) => setPersona((p) => ({ ...p, systemPrompt: e.target.value }))}
                  rows={6}
                  maxLength={4000}
                  required
                />

                <div className="settings-actions">
                  <button type="submit" disabled={personaSaving}>
                    {personaSaving ? "Saving..." : "Save personality"}
                  </button>
                  {personaSaved && <span className="settings-saved">Saved</span>}
                </div>
              </form>
            </section>

            <section className="settings-section">
              <h3>Voice mode</h3>
              <div className="voice-mode-options">
                {settings.voiceModes.map((mode) => (
                  <label key={mode} className="voice-mode-option">
                    <input
                      type="radio"
                      name="voice-mode"
                      value={mode}
                      checked={settings.voiceMode === mode}
                      onChange={() => void handleVoiceModeChange(mode)}
                    />
                    {VOICE_MODE_LABELS[mode]}
                  </label>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <h3>Tools</h3>
              <div className="tool-list">
                {settings.tools.map((tool) => (
                  <label key={tool.name} className="tool-item">
                    <input
                      type="checkbox"
                      checked={tool.enabled}
                      onChange={(e) => void handleToggleTool(tool.name, e.target.checked)}
                    />
                    <div className="tool-info">
                      <span className="tool-name">{tool.name}</span>
                      <span className="tool-description">{tool.description}</span>
                      <span className="tool-permission">permission: {tool.permission}</span>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="settings-section">
              <h3>Long-term memory</h3>
              <form onSubmit={handleAddMemory} className="memory-form">
                <input
                  placeholder="Key (e.g. favorite_color)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />
                <input placeholder="Value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
                <button type="submit">Add</button>
              </form>

              {memoryLoading && <p className="muted">Loading memory...</p>}
              {!memoryLoading && memory.length === 0 && <p className="muted">No memories saved yet.</p>}
              <div className="memory-list">
                {memory.map((entry) => (
                  <div key={entry.key} className="memory-item">
                    <div className="memory-text">
                      <span className="memory-key">{entry.key}</span>
                      <span className="memory-value">{entry.value}</span>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void handleDeleteMemory(entry.key)}
                      title="Delete memory"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
