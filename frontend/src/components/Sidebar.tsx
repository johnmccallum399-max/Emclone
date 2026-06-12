import { useEffect, useState } from "react";
import { createConversation, deleteConversation, listConversations } from "../api/client";
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

  useEffect(() => {
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
          >
            <span className="conversation-title">{conversation.title}</span>
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
