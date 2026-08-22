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
  toggleMode: () => void;
  setDefaultPercentage: (percent: number) => void;
  setFactoryPercentages: (
    percentages: Record<string, number>
  ) => void;
  calculateRate: (baseRate: number, factoryId?: string) => number;
}

const NoBillContext = createContext<NoBillContextType | undefined>(undefined);

const STORAGE_KEY = "steel-rate-no-bill-settings";

type SavedSettings = {
  enabled: boolean;
  defaultPercentage: number;
  factoryPercentages: Record<string, number>;
};

function loadSettings(): SavedSettings {
  if (typeof window === "undefined") {
    return { enabled: false, defaultPercentage: 10, factoryPercentages: {} };
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { enabled: false, defaultPercentage: 10, factoryPercentages: {} };
    }

    const parsed = JSON.parse(saved);
    return {
      enabled: Boolean(parsed.enabled),
      defaultPercentage: Number(parsed.defaultPercentage) || 10,
      factoryPercentages:
        parsed.factoryPercentages && typeof parsed.factoryPercentages === "object"
          ? parsed.factoryPercentages
          : {},
    };
  } catch {
    return { enabled: false, defaultPercentage: 10, factoryPercentages: {} };
  }
}

export function NoBillProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SavedSettings>(loadSettings);

  const saveSettings = useCallback((next: SavedSettings) => {
    setSettings(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Continue working if localStorage is unavailable.
    }
  }, []);

  const toggleMode = useCallback(() => {
    setSettings((previous) => {
      const next = { ...previous, enabled: !previous.enabled };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  }, []);

  const setDefaultPercentage = useCallback(
    (percent: number) => {
      const safePercentage = Number.isFinite(percent)
        ? Math.max(0, Math.min(100, percent))
        : 10;
      saveSettings({ ...settings, defaultPercentage: safePercentage });
    },
    [saveSettings, settings]
  );

  const setFactoryPercentages = useCallback(
    (factoryPercentages: Record<string, number>) => {
      saveSettings({ ...settings, factoryPercentages });
    },
    [saveSettings, settings]
  );

  const calculateRate = useCallback(
    (baseRate: number, factoryId?: string) => {
      if (!settings.enabled) return baseRate;

      const percentage =
        factoryId && settings.factoryPercentages[factoryId] !== undefined
          ? settings.factoryPercentages[factoryId]
          : settings.defaultPercentage;

      return Math.round(baseRate + baseRate * (percentage / 100));
    },
    [settings]
  );

  return (
    <NoBillContext.Provider
      value={{
        isNoBillMode: settings.enabled,
        defaultPercentage: settings.defaultPercentage,
        factoryPercentages: settings.factoryPercentages,
        toggleMode,
        setDefaultPercentage,
        setFactoryPercentages,
        calculateRate,
      }}
    >
      {children}
    </NoBillContext.Provider>
  );
}

export function useNoBill() {
  const context = useContext(NoBillContext);
  if (!context) {
    throw new Error("useNoBill must be used within a NoBillProvider");
  }
  return context;
}
