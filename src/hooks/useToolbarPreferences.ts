// useToolbarPreferences - Persistent toolbar configuration
import { createSignal, createEffect, onMount } from "solid-js";
// QuickAccessToolbar may not exist yet - define types inline
interface QuickAccessKey {
  id: string;
  key: string;
  action: string;
}

type ToolbarLayout = "auto" | "compact" | "expanded";
type ToolbarPosition = "top" | "bottom" | "floating";

export interface ToolbarPreferences {
  layout: ToolbarLayout;
  position: ToolbarPosition;
  customKeys: QuickAccessKey[];
  visible: boolean;
}

const STORAGE_KEY = "irogen-toolbar-preferences";

const DEFAULT_PREFERENCES: ToolbarPreferences = {
  layout: "auto",
  position: "bottom",
  customKeys: [],
  visible: true,
};

export function useToolbarPreferences() {
  const [preferences, setPreferences] =
    createSignal<ToolbarPreferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = createSignal(false);

  // Load preferences from localStorage
  onMount(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ToolbarPreferences;
        setPreferences(parsed);
        console.log("[useToolbarPreferences] Loaded preferences:", parsed);
      }
    } catch (error) {
      console.error(
        "[useToolbarPreferences] Failed to load preferences:",
        error,
      );
    } finally {
      setIsLoaded(true);
    }
  });

  // Save preferences to localStorage
  createEffect(() => {
    if (!isLoaded()) return;

    try {
      const prefs = preferences();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      console.log("[useToolbarPreferences] Saved preferences:", prefs);
    } catch (error) {
      console.error(
        "[useToolbarPreferences] Failed to save preferences:",
        error,
      );
    }
  });

  // Update individual preference
  const updatePreference = <K extends keyof ToolbarPreferences>(
    key: K,
    value: ToolbarPreferences[K],
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
  };

  // Add custom key
  const addCustomKey = (key: QuickAccessKey) => {
    setPreferences((prev) => ({
      ...prev,
      customKeys: [...prev.customKeys, key],
    }));
  };

  // Remove custom key
  const removeCustomKey = (keyId: string) => {
    setPreferences((prev) => ({
      ...prev,
      customKeys: prev.customKeys.filter((k) => k.id !== keyId),
    }));
  };

  // Reset to defaults
  const resetToDefaults = () => {
    setPreferences(DEFAULT_PREFERENCES);
  };

  // Export preferences
  const exportPreferences = (): string => {
    return JSON.stringify(preferences(), null, 2);
  };

  // Import preferences
  const importPreferences = (json: string): boolean => {
    try {
      const parsed = JSON.parse(json) as ToolbarPreferences;
      setPreferences(parsed);
      return true;
    } catch (error) {
      console.error(
        "[useToolbarPreferences] Failed to import preferences:",
        error,
      );
      return false;
    }
  };

  return {
    preferences,
    isLoaded,
    updatePreference,
    addCustomKey,
    removeCustomKey,
    resetToDefaults,
    exportPreferences,
    importPreferences,
  };
}
