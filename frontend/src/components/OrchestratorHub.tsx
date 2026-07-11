import { useEffect, useState } from "react";
import {
  type CreateHubAgentInput,
  type HubAgentSummary,
  createHubAgent,
  deleteHubAgent,
  listHubAgents,
} from "../api/client";

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)", requiresBase: false },
  { value: "openai-compatible", label: "OpenAI-compatible (Grok, Mistral, Groq, OpenRouter…)", requiresBase: true },
] as const;

type Provider = (typeof PROVIDERS)[number]["value"];

interface FormState {
  name: string;
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  persona: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  provider: "anthropic",
  model: "",
  apiKey: "",
  baseUrl: "",
  persona: "",
};

export function OrchestratorHub({ onClose }: { onClose: () => void }) {
  const [agents, setAgents] = useState<HubAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listHubAgents()
      .then(setAgents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const providerMeta = PROVIDERS.find((p) => p.value === form.provider)!;

  async function handleAdd() {
    setError(null);
    setSaving(true);
    try {
      const input: CreateHubAgentInput = {
        name: form.name.trim(),
        provider: form.provider,
        model: form.model.trim(),
        apiKey: form.apiKey,
        baseUrl: providerMeta.requiresBase ? form.baseUrl.trim() || null : null,
        persona: form.persona.trim() || null,
      };
      const agent = await createHubAgent(input);
      setAgents((prev) => [...prev, agent]);
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await deleteHubAgent(id);
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Orchestration Hub">
      <div className="modal hub-panel">
        <div className="modal-header">
          <h2>Orchestration Hub</h2>
          <button className="icon-button" onClick={() => setShowForm((v) => !v)} title="Add agent">
            +
          </button>
        </div>

        <p className="hub-description">
          Each agent is one of your LLM accounts: a provider, an API key (stored encrypted on your
          server, never shown again), a model, and an optional persona.
        </p>

        {error && <p className="error-text">{error}</p>}

        {showForm && (
          <div className="hub-form">
            <label className="hub-field">
              <span>Name</span>
              <input
                placeholder="e.g. Grok"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className="hub-field">
              <span>Provider</span>
              <select
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as Provider }))}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="hub-field">
              <span>Model</span>
              <input
                placeholder="e.g. grok-3-mini"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              />
            </label>

            <label className="hub-field">
              <span>API key</span>
              <input
                type="password"
                placeholder="sk-…"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                autoComplete="new-password"
              />
            </label>

            {providerMeta.requiresBase && (
              <label className="hub-field">
                <span>Base URL (required)</span>
                <input
                  placeholder="https://api.x.ai/v1"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
              </label>
            )}

            <label className="hub-field">
              <span>Persona / system prompt (optional)</span>
              <textarea
                placeholder="e.g. You are a skeptical security engineer. Poke holes in every proposal."
                rows={3}
                value={form.persona}
                onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button onClick={handleAdd} disabled={saving || !form.name || !form.model || !form.apiKey}>
                {saving ? "Saving…" : "Add agent"}
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setShowForm(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="hub-agent-list">
          {loading && <p className="muted">Loading…</p>}
          {!loading && agents.length === 0 && !showForm && (
            <p className="muted">No agents yet. Press + to add one.</p>
          )}
          {agents.map((agent) => (
            <div key={agent.id} className="hub-agent-item">
              <div className="hub-agent-info">
                <span className="hub-agent-name">{agent.name}</span>
                <span className="hub-agent-meta">
                  {agent.model}
                  {agent.baseUrl ? ` · ${agent.baseUrl}` : ""}
                </span>
              </div>
              <button
                className="icon-button hub-agent-delete"
                onClick={() => void handleDelete(agent.id)}
                title="Remove agent"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
