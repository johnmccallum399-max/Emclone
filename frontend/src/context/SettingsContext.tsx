import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getSettings } from "../api/client";
import type { SettingsResponse, VoiceMode } from "../types";

interface SettingsContextValue {
  settings: SettingsResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Optimistically update the locally cached voice mode (after a successful PUT). */
  setLocalVoiceMode: (mode: VoiceMode) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSettings();
      setSettings(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const setLocalVoiceMode = useCallback((mode: VoiceMode) => {
    setSettings((prev) => (prev ? { ...prev, voiceMode: mode } : prev));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh, setLocalVoiceMode }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
