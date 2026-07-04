import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createHubSession,
  deleteHubSession,
  getHubSession,
  interjectHubMessage,
  listHubAgents,
  listHubSessions,
  stopHubSession,
  streamHubRun,
} from "../api/client";
import type {
  HubAgent,
  HubMessage,
  HubRunEvent,
  HubSession,
  HubSessionMode,
  HubSessionStatus,
} from "../types";
import { AgentsPanel, providerLabel } from "./AgentsPanel";

const AGENT_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#a855f7", "#ef4444", "#84cc16"];

function agentColor(agentId: number | null): string {
  if (agentId == null) return "#6b7280";
  return AGENT_COLORS[agentId % AGENT_COLORS.length];
}

const MODE_LABELS: Record<HubSessionMode, string> = {
  discussion: "Discussion — agents collaborate toward the goal",
  debate: "Debate — agents argue opposing sides",
  pipeline: "Pipeline — each agent improves the previous draft",
};

const STATUS_LABELS: Record<HubSessionStatus, string> = {
  idle: "Idle",
  running: "Running",
  completed: "Completed",
  stopped: "Stopped",
  error: "Error",
};

interface HubViewProps {
  onBackToChat: () => void;
}

export function HubView({ onBackToChat }: HubViewProps) {
  const [agents, setAgents] = useState<HubAgent[]>([]);
  const [sessions, setSessions] = useState<HubSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [session, setSession] = useState<HubSession | null>(null);
  const [messages, setMessages] = useState<HubMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [thinkingAgent, setThinkingAgent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [interjection, setInterjection] = useState("");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinkingAgent]);

  async function refreshAgents() {
    setAgents(await listHubAgents());
  }

  async function refreshSessions() {
    const list = await listHubSessions();
    setSessions(list);
    return list;
  }

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      try {
        const [, list] = await Promise.all([refreshAgents(), refreshSessions()]);
        if (list.length > 0) await openSession(list[0].id);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openSession(id: number) {
    setActiveId(id);
    setError(null);
    try {
      const detail = await getHubSession(id);
      setSession(detail.session);
      setMessages(detail.messages);
      setRunning(detail.session.status === "running");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function applyRunEvent(event: HubRunEvent) {
    switch (event.type) {
      case "status":
        setSession((prev) => (prev ? { ...prev, status: event.status } : prev));
        break;
      case "turn_start":
        setThinkingAgent(event.agentName);
        break;
      case "message":
        setThinkingAgent(null);
        setMessages((prev) => [...prev, event.message]);
        break;
      case "turn_error":
        // A hub system message describing the failure follows in the stream.
        setThinkingAgent(null);
        break;
      case "done":
        setThinkingAgent(null);
        setSession((prev) => (prev ? { ...prev, status: event.status } : prev));
        break;
      case "error":
        setThinkingAgent(null);
        setError(event.message);
        setSession((prev) => (prev ? { ...prev, status: "error" } : prev));
        break;
    }
  }

  async function handleRun() {
    if (!session) return;
    setError(null);
    setRunning(true);
    try {
      await streamHubRun(session.id, applyRunEvent);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
      setThinkingAgent(null);
      void refreshSessions();
    }
  }

  async function handleStop() {
    if (!session) return;
    try {
      await stopHubSession(session.id);
      setThinkingAgent(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleInterject(event: FormEvent) {
    event.preventDefault();
    if (!session || !interjection.trim()) return;
    try {
      const message = await interjectHubMessage(session.id, interjection.trim());
      setMessages((prev) => [...prev, message]);
      setInterjection("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteSession(id: number) {
    if (!window.confirm("Delete this session and its transcript?")) return;
    try {
      await deleteHubSession(id);
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);
      if (activeId === id) {
        setActiveId(null);
        setSession(null);
        setMessages([]);
        if (remaining.length > 0) await openSession(remaining[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSessionCreated(created: HubSession) {
    setShowNewSession(false);
    setSessions((prev) => [created, ...prev]);
    await openSession(created.id);
  }

  const hasRun = messages.some((m) => m.role !== "user");

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Orchestration Hub</h2>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowNewSession(true)}
            title="New session"
            disabled={agents.length === 0}
          >
            +
          </button>
        </div>

        <div className="conversation-list">
          {loading && <p className="muted">Loading...</p>}
          {!loading && agents.length === 0 && (
            <p className="muted hub-hint">Add your LLM accounts under “Agents” to get started.</p>
          )}
          {!loading && agents.length > 0 && sessions.length === 0 && (
            <p className="muted hub-hint">No sessions yet — press + to convene your agents.</p>
          )}
          {sessions.map((item) => (
            <div
              key={item.id}
              className={`conversation-item ${item.id === activeId ? "active" : ""}`}
              onClick={() => void openSession(item.id)}
            >
              <span className="conversation-title">{item.title}</span>
              <div className="conversation-actions">
                <span className={`hub-status hub-status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                <button
                  type="button"
                  className="icon-button conversation-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteSession(item.id);
                  }}
                  title="Delete session"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button type="button" className="secondary" onClick={() => setShowAgents(true)}>
            Agents ({agents.length})
          </button>
          <button type="button" className="secondary" onClick={onBackToChat}>
            ← Back to chat
          </button>
        </div>
      </aside>

      <main className="chat-window hub-main">
        {!session ? (
          <div className="chat-window chat-window-empty">
            <div className="hub-empty">
              <h2>Let your LLMs talk to each other</h2>
              <p className="muted">
                Register each of your LLM accounts as an agent, then start a session with a goal. The
                hub relays the conversation between them automatically — no copy-pasting prompts back
                and forth.
              </p>
              {agents.length === 0 ? (
                <button type="button" onClick={() => setShowAgents(true)}>
                  Add your first agent
                </button>
              ) : (
                <button type="button" onClick={() => setShowNewSession(true)}>
                  New session
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="hub-session-header">
              <div className="hub-session-titles">
                <h3>{session.title}</h3>
                <span className="muted">
                  {MODE_LABELS[session.mode]} · {session.maxRounds} round{session.maxRounds > 1 ? "s" : ""} per run
                  {session.synthesize ? " · final synthesis" : ""}
                </span>
              </div>
              <div className="hub-session-controls">
                <span className={`hub-status hub-status-${session.status}`}>{STATUS_LABELS[session.status]}</span>
                {running ? (
                  <button type="button" className="secondary" onClick={() => void handleStop()}>
                    Stop
                  </button>
                ) : (
                  <button type="button" onClick={() => void handleRun()}>
                    {hasRun ? "Continue" : "Run"}
                  </button>
                )}
              </div>
            </div>

            <div className="messages hub-messages">
              <div className="hub-goal">
                <span className="message-role">Goal</span>
                <p>{session.goal}</p>
              </div>

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`hub-message hub-message-${message.role}`}
                  style={
                    message.role === "agent" || message.role === "synthesis"
                      ? { borderLeftColor: agentColor(message.agentId) }
                      : undefined
                  }
                >
                  <div className="hub-message-header">
                    <span
                      className="hub-message-author"
                      style={{ color: message.role === "user" ? undefined : agentColor(message.agentId) }}
                    >
                      {message.authorName}
                    </span>
                    {message.round > 0 && <span className="hub-message-round">round {message.round}</span>}
                  </div>
                  <div className="hub-message-content">{message.content}</div>
                </div>
              ))}

              {thinkingAgent && (
                <p className="muted hub-thinking">
                  {thinkingAgent} is thinking<span className="hub-ellipsis">...</span>
                </p>
              )}
              {error && <p className="error-text">{error}</p>}
              <div ref={messagesEndRef} />
            </div>

            <form className="composer hub-composer" onSubmit={(e) => void handleInterject(e)}>
              <div className="chat-input">
                <textarea
                  rows={1}
                  placeholder={
                    running
                      ? "Wait for the session to pause to interject..."
                      : "Interject with guidance for the agents, then press Continue"
                  }
                  disabled={running}
                  value={interjection}
                  onChange={(e) => setInterjection(e.target.value)}
                />
                <button type="submit" disabled={running || !interjection.trim()}>
                  Interject
                </button>
              </div>
            </form>
          </>
        )}
      </main>

      {showAgents && (
        <AgentsPanel
          agents={agents}
          onChanged={async () => {
            await refreshAgents();
            await refreshSessions();
          }}
          onClose={() => setShowAgents(false)}
        />
      )}

      {showNewSession && (
        <NewSessionModal
          agents={agents}
          onCreated={(created) => void handleSessionCreated(created)}
          onClose={() => setShowNewSession(false)}
        />
      )}
    </div>
  );
}

// ---- New session modal ------------------------------------------------------

interface NewSessionModalProps {
  agents: HubAgent[];
  onCreated: (session: HubSession) => void;
  onClose: () => void;
}

function NewSessionModal({ agents, onCreated, onClose }: NewSessionModalProps) {
  const [goal, setGoal] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<HubSessionMode>("discussion");
  const [maxRounds, setMaxRounds] = useState(3);
  const [synthesize, setSynthesize] = useState(true);
  const [selected, setSelected] = useState<number[]>(agents.map((agent) => agent.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleAgent(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (selected.length === 0) {
      setError("Pick at least one agent.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Preserve the agents' list order as the speaking order.
      const agentIds = agents.filter((agent) => selected.includes(agent.id)).map((agent) => agent.id);
      const session = await createHubSession({
        title: title.trim() || undefined,
        goal: goal.trim(),
        mode,
        maxRounds,
        synthesize,
        agentIds,
      });
      onCreated(session);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New session</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        <form className="persona-form" onSubmit={(e) => void handleSubmit(e)}>
          <label htmlFor="session-goal">Goal / topic</label>
          <textarea
            id="session-goal"
            required
            rows={3}
            maxLength={8000}
            placeholder="e.g. Design a launch plan for my app. Debate the tradeoffs and agree on a final plan."
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />

          <label htmlFor="session-title">Title (optional)</label>
          <input
            id="session-title"
            maxLength={200}
            placeholder="Defaults to the goal"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <label htmlFor="session-mode">Mode</label>
          <select id="session-mode" value={mode} onChange={(e) => setMode(e.target.value as HubSessionMode)}>
            <option value="discussion">Discussion — collaborate toward the goal</option>
            <option value="debate">Debate — argue opposing sides</option>
            <option value="pipeline">Pipeline — each agent improves the previous draft</option>
          </select>

          <label htmlFor="session-rounds">Rounds per run (each agent speaks once per round)</label>
          <input
            id="session-rounds"
            type="number"
            min={1}
            max={10}
            value={maxRounds}
            onChange={(e) => setMaxRounds(Number(e.target.value) || 1)}
          />

          <label className="voice-mode-option">
            <input type="checkbox" checked={synthesize} onChange={(e) => setSynthesize(e.target.checked)} />
            End each run with a synthesized final answer
          </label>

          <label>Participants (speak in this order)</label>
          <div className="hub-agent-picker">
            {agents.map((agent) => (
              <label key={agent.id} className="voice-mode-option">
                <input
                  type="checkbox"
                  checked={selected.includes(agent.id)}
                  onChange={() => toggleAgent(agent.id)}
                />
                {agent.name}
                <span className="muted">
                  {providerLabel(agent.provider)} · {agent.model}
                </span>
              </label>
            ))}
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
