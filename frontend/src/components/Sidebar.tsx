import { useEffect, useRef, useState } from "react";
import { createConversation, deleteConversation, listConversations, renameConversation } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Conversation } from "../types";

interface SidebarProps {
  activeId: number | null;
  onSelect: (id: number) => void;
  onOpenSettings: () => void;
}

export function Sidebar({ activeId, onSelect, onOpenSettings }: SidebarProps) {
  const { user, logout } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const list = await listConversations();
      setConversations(list);
      return list;
    } finally {
      setLoading(false);
    }
  }

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    refresh().then((list) => {
      if (list && list.length > 0 && activeId == null) {
        onSelect(list[0].id);
      } else if (list && list.length === 0) {
        handleNewConversation();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleNewConversation() {
    const conversation = await createConversation();
    setConversations((prev) => [conversation, ...prev]);
    onSelect(conversation.id);
  }

  function startRename(conversation: Conversation) {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  }

  async function commitRename(id: number) {
    const title = editingTitle.trim();
    setEditingId(null);
    if (!title) return;

    const original = conversations.find((c) => c.id === id);
    if (!original || original.title === title) return;

    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    try {
      await renameConversation(id, title);
    } catch {
      setConversations((prev) => prev.map((c) => (c.id === id ? original : c)));
    }
  }

  async function handleDelete(id: number) {
    await deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (activeId === id) {
      if (remaining.length > 0) onSelect(remaining[0].id);
      else handleNewConversation();
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Assistant</h2>
        <button type="button" className="icon-button" onClick={handleNewConversation} title="New conversation">
          +
        </button>
      </div>

      <div className="conversation-list">
        {loading && <p className="muted">Loading...</p>}
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`conversation-item ${conversation.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(conversation.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename(conversation);
            }}
          >
            {editingId === conversation.id ? (
              <input
                autoFocus
                className="conversation-title-input"
                value={editingTitle}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => void commitRename(conversation.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename(conversation.id);
                  else if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <span className="conversation-title">{conversation.title}</span>
            )}
            <div className="conversation-actions">
              <button
                type="button"
                className="icon-button conversation-rename"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(conversation);
                }}
                title="Rename conversation"
              >
                ✎
              </button>
              <button
                type="button"
                className="icon-button conversation-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(conversation.id);
                }}
                title="Delete conversation"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button type="button" className="secondary" onClick={onOpenSettings}>
          Settings
        </button>
        <div className="user-row">
          <span className="username">{user?.username}</span>
          <button type="button" className="link-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
