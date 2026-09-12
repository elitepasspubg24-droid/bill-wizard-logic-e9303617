import React, {
  createContext,
  useContext,
  useState,
  useCallback,
} from "react";

interface NoBillContextType {
  isNoBillMode: boolean;
  defaultPercentage: number;
  factoryPercentages: Record<string, number>;
  factoryMoreAdders: Record<string, number>;
  toggleMode: () => void;
  setDefaultPercentage: (percent: number) => void;
  setFactoryPercentages: (percentages: Record<string, number>) => void;
  setFactoryMoreAdder: (factoryId: string, amount: number) => void;
  calculateRate: (baseRate: number, factoryId?: string) => number;
}

const NoBillContext = createContext<NoBillContextType | undefined>(undefined);
const STORAGE_KEY = "steel-rate-no-bill-settings";

type SavedSettings = {
  enabled: boolean;
  defaultPercentage: number;
  factoryPercentages: Record<string, number>;
  factoryMoreAdders: Record<string, number>;
};

function loadSettings(): SavedSettings {
  const defaults = { enabled: false, defaultPercentage: 10, factoryPercentages: {}, factoryMoreAdders: {} };
  if (typeof window === "undefined") return defaults;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaults;
    const parsed = JSON.parse(saved);
    return {
      enabled: Boolean(parsed.enabled),
      defaultPercentage: Number(parsed.defaultPercentage) || 10,
      factoryPercentages: parsed.factoryPercentages && typeof parsed.factoryPercentages === "object" ? parsed.factoryPercentages : {},
      factoryMoreAdders: parsed.factoryMoreAdders && typeof parsed.factoryMoreAdders === "object" ? parsed.factoryMoreAdders : {},
    };
  } catch {
    return defaults;
  }
}

export function NoBillProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SavedSettings>(loadSettings);

  const saveSettings = useCallback((next: SavedSettings) => {
    setSettings(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Ignore storage errors. */ }
  }, []);

  const toggleMode = useCallback(() => {
    setSettings((previous) => {
      const next = { ...previous, enabled: !previous.enabled };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Ignore storage errors. */ }
      return next;
    });
  }, []);

  const setDefaultPercentage = useCallback((percent: number) => {
    const safePercentage = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 10;
    saveSettings({ ...settings, defaultPercentage: safePercentage });
  }, [saveSettings, settings]);

  const setFactoryPercentages = useCallback((factoryPercentages: Record<string, number>) => {
    saveSettings({ ...settings, factoryPercentages });
  }, [saveSettings, settings]);

  const setFactoryMoreAdder = useCallback((factoryId: string, amount: number) => {
    const factoryMoreAdders = { ...settings.factoryMoreAdders, [factoryId]: Number.isFinite(amount) ? amount : 0 };
    saveSettings({ ...settings, factoryMoreAdders });
  }, [saveSettings, settings]);

  const calculateRate = useCallback((baseRate: number, factoryId?: string) => {
    if (!settings.enabled) return baseRate;
    const percentage = factoryId && settings.factoryPercentages[factoryId] !== undefined ? settings.factoryPercentages[factoryId] : settings.defaultPercentage;
    const moreAdder = factoryId ? Number(settings.factoryMoreAdders[factoryId] || 0) : 0;
    return Math.round(baseRate + baseRate * (percentage / 100) + moreAdder);
  }, [settings]);

  return (
    <NoBillContext.Provider value={{
      isNoBillMode: settings.enabled,
      defaultPercentage: settings.defaultPercentage,
      factoryPercentages: settings.factoryPercentages,
      factoryMoreAdders: settings.factoryMoreAdders,
      toggleMode,
      setDefaultPercentage,
      setFactoryPercentages,
      setFactoryMoreAdder,
      calculateRate,
    }}>
      {children}
    </NoBillContext.Provider>
  );
}

export function useNoBill() {
  const context = useContext(NoBillContext);
  if (!context) throw new Error("useNoBill must be used within a NoBillProvider");
  return context;
}
