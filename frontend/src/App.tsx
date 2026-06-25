import { useState } from "react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ChatWindow } from "./components/ChatWindow";
import { LoginScreen } from "./components/LoginScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { SettingsProvider } from "./context/SettingsContext";

function AuthenticatedApp() {
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <SettingsProvider>
      <div className="app-layout">
        <Sidebar
          activeId={activeConversationId}
          onSelect={setActiveConversationId}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ChatWindow conversationId={activeConversationId} />
        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      </div>
    </SettingsProvider>
  );
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return <AuthenticatedApp />;
}

export function App() {
  return (
    <AuthProvider>
      <AppContent />
      <SpeedInsights />
    </AuthProvider>
  );
}
