import { useState, type FormEvent } from "react";
import { createHubAgent, deleteHubAgent, updateHubAgent } from "../api/client";
import type { HubAgent, HubProvider } from "../types";

export const PROVIDER_OPTIONS: {
  value: HubProvider;
  label: string;
  placeholderModel: string;
  needsBaseUrl: boolean;
}[] = [
  { value: "openai", label: "OpenAI", placeholderModel: "gpt-4o-mini", needsBaseUrl: false },
  { value: "anthropic", label: "Anthropic (Claude)", placeholderModel: "claude-sonnet-4-5", needsBaseUrl: false },
  { value: "google", label: "Google (Gemini)", placeholderModel: "gemini-2.5-flash", needsBaseUrl: false },
  {
    value: "openai_compatible",
    label: "OpenAI-compatible (Grok, Mistral, Groq, OpenRouter, Ollama, ...)",
    placeholderModel: "e.g. grok-3-mini",
    needsBaseUrl: true,
  },
];

export function providerLabel(provider: HubProvider): string {
  return PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

interface AgentsPanelProps {
  agents: HubAgent[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}

interface AgentFormState {
  name: string;
  provider: HubProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  systemPrompt: string;
}

const EMPTY_FORM: AgentFormState = {
  name: "",
  provider: "openai",
  model: "",
  apiKey: "",
  baseUrl: "",
  systemPrompt: "",
};

export function AgentsPanel({ agents, onChanged, onClose }: AgentsPanelProps) {
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerOption = PROVIDER_OPTIONS.find((option) => option.value === form.provider)!;

  function startNew() {
    setForm(EMPTY_FORM);
    setEditingId("new");
    setError(null);
  }

  function startEdit(agent: HubAgent) {
    setForm({
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      apiKey: "",
      baseUrl: agent.baseUrl ?? "",
      systemPrompt: agent.systemPrompt,
    });
    setEditingId(agent.id);
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const baseUrl = form.baseUrl.trim() || null;
    if (providerOption.needsBaseUrl && !baseUrl) {
      setError("A base URL is required for OpenAI-compatible providers.");
      return;
    }

    setSaving(true);
    try {
      if (editingId === "new") {
        await createHubAgent({
          name: form.name.trim(),
          provider: form.provider,
          model: form.model.trim(),
          apiKey: form.apiKey,
          baseUrl,
          systemPrompt: form.systemPrompt,
        });
      } else if (typeof editingId === "number") {
        await updateHubAgent(editingId, {
          name: form.name.trim(),
          provider: form.provider,
          model: form.model.trim(),
          // Leave the stored key untouched unless a new one was entered.
          ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          baseUrl,
          systemPrompt: form.systemPrompt,
        });
      }
      await onChanged();
      setEditingId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(agent: HubAgent) {
    if (!window.confirm(`Delete agent "${agent.name}"? It will be removed from its sessions.`)) return;
    try {
      await deleteHubAgent(agent.id);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal hub-agents-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>LLM agents</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <p className="muted">
          Each agent is one of your LLM accounts: a provider, an API key (stored encrypted on your
          server, never shown again), a model, and an optional persona.
        </p>

        {error && <p className="error-text">{error}</p>}

        {editingId === null ? (
          <>
            <div className="hub-agent-list">
              {agents.length === 0 && <p className="muted">No agents yet — add your first LLM account.</p>}
              {agents.map((agent) => (
                <div key={agent.id} className="hub-agent-item">
                  <div className="hub-agent-info">
                    <span className="hub-agent-name">{agent.name}</span>
                    <span className="hub-agent-meta">
                      {providerLabel(agent.provider)} · {agent.model}
                    </span>
                  </div>
                  <div className="hub-agent-actions">
                    <button type="button" className="icon-button" onClick={() => startEdit(agent)} title="Edit agent">
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void handleDelete(agent)}
                      title="Delete agent"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" onClick={startNew}>
                Add agent
              </button>
            </div>
          </>
        ) : (
          <form className="persona-form" onSubmit={(e) => void handleSubmit(e)}>
            <label htmlFor="agent-name">Name</label>
            <input
              id="agent-name"
              required
              maxLength={80}
              placeholder="e.g. Claude, GPT, Gemini"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <label htmlFor="agent-provider">Provider</label>
            <select
              id="agent-provider"
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value as HubProvider })}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label htmlFor="agent-model">Model</label>
            <input
              id="agent-model"
              required
              maxLength={120}
              placeholder={providerOption.placeholderModel}
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />

            <label htmlFor="agent-key">API key {editingId !== "new" && "(leave blank to keep current)"}</label>
            <input
              id="agent-key"
              type="password"
              autoComplete="off"
              required={editingId === "new"}
              placeholder={editingId === "new" ? "sk-..." : "••••••••"}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />

            <label htmlFor="agent-base-url">
              Base URL {providerOption.needsBaseUrl ? "(required)" : "(optional override)"}
            </label>
            <input
              id="agent-base-url"
              type="url"
              placeholder="https://api.x.ai/v1"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />

            <label htmlFor="agent-prompt">Persona / system prompt (optional)</label>
            <textarea
              id="agent-prompt"
              rows={3}
              maxLength={8000}
              placeholder="e.g. You are a skeptical security engineer. Poke holes in every proposal."
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            />

            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingId === "new" ? "Add agent" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
