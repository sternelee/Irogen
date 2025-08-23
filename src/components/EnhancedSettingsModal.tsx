import { createSignal, Show, For, createEffect } from "solid-js";
import { HistoryEntry } from "../hooks/useConnectionHistory";
import { settingsStore, t } from "../stores/settingsStore";
import {
  EnhancedCard,
  EnhancedButton,
  EnhancedInput,
} from "./ui/EnhancedComponents";
import {
  themes,
  themeManager,
  themeSignals,
  VisualFeedback,
} from "../utils/theme";
import { getDeviceCapabilities, HapticFeedback } from "../utils/mobile";

interface EnhancedSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: HistoryEntry | null;
  onSave?: (ticket: string, updates: Partial<HistoryEntry>) => void;
}

export function EnhancedSettingsModal(props: EnhancedSettingsModalProps) {
  const [activeTab, setActiveTab] = createSignal<
    "appearance" | "terminal" | "connection" | "accessibility" | "about"
  >("appearance");
  const [tempSettings, setTempSettings] = createSignal({
    theme: themeManager.getCurrentTheme().id,
    autoTheme: themeSignals.autoTheme[0](),
    fontSize: 14,
    fontFamily: "JetBrains Mono",
    terminalOpacity: 0.95,
    animationSpeed: "normal" as "slow" | "normal" | "fast" | "none",
    hapticFeedback: true,
    soundEffects: false,
    notifications: true,
    autoConnect: false,
    connectionTimeout: 10,
    maxHistoryEntries: 50,
    autoSaveHistory: true,
    language: "en",
    reducedMotion: themeSignals.reducedMotion[0](),
    highContrast: themeSignals.highContrast[0](),
    colorBlindMode: false,
    screenReader: false,
  });

  const deviceCapabilities = getDeviceCapabilities();

  createEffect(() => {
    if (props.isOpen) {
      // Reset temp settings when modal opens
      setTempSettings({
        theme: themeManager.getCurrentTheme().id,
        autoTheme: themeSignals.autoTheme[0](),
        fontSize: 14,
        fontFamily: "JetBrains Mono",
        terminalOpacity: 0.95,
        animationSpeed: "normal",
        hapticFeedback: true,
        soundEffects: false,
        notifications: true,
        autoConnect: false,
        connectionTimeout: 10,
        maxHistoryEntries: 50,
        autoSaveHistory: true,
        language: "en",
        reducedMotion: themeSignals.reducedMotion[0](),
        highContrast: themeSignals.highContrast[0](),
        colorBlindMode: false,
        screenReader: false,
      });
    }
  });

  const handleSave = () => {
    const settings = tempSettings();

    // Apply theme changes
    if (settings.theme !== themeManager.getCurrentTheme().id) {
      const theme = themes.find((t) => t.id === settings.theme);
      if (theme) {
        themeManager.setTheme(theme);
      }
    }

    themeManager.setAutoTheme(settings.autoTheme);

    // Save other settings to localStorage
    try {
      localStorage.setItem("riterm-user-settings", JSON.stringify(settings));
      VisualFeedback.showToast("Settings saved successfully!", "success");

      if (settings.hapticFeedback) {
        HapticFeedback.success();
      }
    } catch (error) {
      VisualFeedback.showToast("Failed to save settings", "error");
      console.error("Failed to save settings:", error);
    }

    props.onClose();
  };

  const handleReset = () => {
    setTempSettings({
      theme: "riterm-mobile",
      autoTheme: true,
      fontSize: 14,
      fontFamily: "JetBrains Mono",
      terminalOpacity: 0.95,
      animationSpeed: "normal",
      hapticFeedback: true,
      soundEffects: false,
      notifications: true,
      autoConnect: false,
      connectionTimeout: 10,
      maxHistoryEntries: 50,
      autoSaveHistory: true,
      language: "en",
      reducedMotion: false,
      highContrast: false,
      colorBlindMode: false,
      screenReader: false,
    });

    VisualFeedback.showToast("Settings reset to defaults", "info");
  };

  const handleExportSettings = () => {
    const settings = tempSettings();
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "riterm-settings.json";
    a.click();
    URL.revokeObjectURL(url);

    VisualFeedback.showToast("Settings exported successfully!", "success");
  };

  const handleImportSettings = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const imported = JSON.parse(event.target?.result as string);
            setTempSettings((prev) => ({ ...prev, ...imported }));
            VisualFeedback.showToast(
              "Settings imported successfully!",
              "success",
            );
          } catch (error) {
            VisualFeedback.showToast("Invalid settings file", "error");
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const renderAppearanceTab = () => (
    <div class="space-y-6">
      {/* Theme Selection */}\n{" "}
      <EnhancedCard title="Theme" icon="🎨">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Auto theme (follows system)</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={tempSettings().autoTheme}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    autoTheme: e.currentTarget.checked,
                  }))
                }
              />
            </label>
          </div>

          <Show when={!tempSettings().autoTheme}>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <For each={themes}>
                {(theme) => (
                  <div
                    class={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      tempSettings().theme === theme.id
                        ? "border-primary bg-primary/10"
                        : "border-base-300 hover:border-base-400"
                    }`}
                    onClick={() =>
                      setTempSettings((prev) => ({ ...prev, theme: theme.id }))
                    }
                  >
                    <div class="flex items-center space-x-3 mb-2">
                      <div
                        class="w-4 h-4 rounded-full"
                        style={{ "background-color": theme.colors.primary }}
                      ></div>
                      <span class="font-medium">{theme.name}</span>
                    </div>
                    <p class="text-xs opacity-70">{theme.description}</p>
                    <div class="flex space-x-1 mt-2">
                      <div
                        class="w-3 h-3 rounded-full"
                        style={{ "background-color": theme.colors.primary }}
                      ></div>
                      <div
                        class="w-3 h-3 rounded-full"
                        style={{ "background-color": theme.colors.secondary }}
                      ></div>
                      <div
                        class="w-3 h-3 rounded-full"
                        style={{ "background-color": theme.colors.accent }}
                      ></div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </EnhancedCard>
      {/* Animation Settings */}
      <EnhancedCard title="Animations" icon="✨">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Animation speed</span>
            </label>
            <select
              class="select select-bordered"
              value={tempSettings().animationSpeed}
              onChange={(e) =>
                setTempSettings((prev) => ({
                  ...prev,
                  animationSpeed: e.currentTarget.value as any,
                }))
              }
            >
              <option value="none">None</option>
              <option value="slow">Slow</option>
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
            </select>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Reduce motion (accessibility)</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={tempSettings().reducedMotion}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    reducedMotion: e.currentTarget.checked,
                  }))
                }
              />
            </label>
          </div>
        </div>
      </EnhancedCard>
    </div>
  );

  const renderTerminalTab = () => (
    <div class="space-y-6">
      {/* Font Settings */}
      <EnhancedCard title="Font" icon="🔤">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Font family</span>
            </label>
            <select
              class="select select-bordered"
              value={tempSettings().fontFamily}
              onChange={(e) =>
                setTempSettings((prev) => ({
                  ...prev,
                  fontFamily: e.currentTarget.value,
                }))
              }
            >
              <option value="JetBrains Mono">JetBrains Mono</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Cascadia Code">Cascadia Code</option>
              <option value="SF Mono">SF Mono</option>
              <option value="Monaco">Monaco</option>
              <option value="Inconsolata">Inconsolata</option>
            </select>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">
                Font size: {tempSettings().fontSize}px
              </span>
            </label>
            <input
              type="range"
              min="8"
              max="24"
              value={tempSettings().fontSize}
              class="range range-primary"
              onInput={(e) =>
                setTempSettings((prev) => ({
                  ...prev,
                  fontSize: parseInt(e.currentTarget.value),
                }))
              }
            />
            <div class="w-full flex justify-between text-xs px-2">
              <span>8px</span>
              <span>16px</span>
              <span>24px</span>
            </div>
          </div>
        </div>
      </EnhancedCard>

      {/* Terminal Appearance */}
      <EnhancedCard title="Appearance" icon="🎭">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">
                Background opacity:{" "}
                {Math.round(tempSettings().terminalOpacity * 100)}%
              </span>
            </label>
            <input
              type="range"
              min="0.5"
              max="1"
              step="0.05"
              value={tempSettings().terminalOpacity}
              class="range range-primary"
              onInput={(e) =>
                setTempSettings((prev) => ({
                  ...prev,
                  terminalOpacity: parseFloat(e.currentTarget.value),
                }))
              }
            />
          </div>

          {/* Terminal Preview */}
          <div
            class="bg-black p-4 rounded-lg font-mono text-green-400 text-sm"
            style={{ opacity: tempSettings().terminalOpacity }}
          >
            <div>$ riterm connect</div>
            <div class="text-blue-400">⚡ Connecting to P2P session...</div>
            <div class="text-green-400">✅ Connected successfully!</div>
            <div>
              user@riterm:~$ <span class="animate-pulse">█</span>
            </div>
          </div>
        </div>
      </EnhancedCard>
    </div>
  );

  const renderConnectionTab = () => (
    <div class="space-y-6">
      <EnhancedCard title="Connection" icon="🌐">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Auto-connect to last session</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={tempSettings().autoConnect}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    autoConnect: e.currentTarget.checked,
                  }))
                }
              />
            </label>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">
                Connection timeout: {tempSettings().connectionTimeout}s
              </span>
            </label>
            <input
              type="range"
              min="5"
              max="60"
              value={tempSettings().connectionTimeout}
              class="range range-primary"
              onInput={(e) =>
                setTempSettings((prev) => ({
                  ...prev,
                  connectionTimeout: parseInt(e.currentTarget.value),
                }))
              }
            />
          </div>
        </div>
      </EnhancedCard>

      <EnhancedCard title="History" icon="📚">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Auto-save connection history</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={tempSettings().autoSaveHistory}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    autoSaveHistory: e.currentTarget.checked,
                  }))
                }
              />
            </label>
          </div>

          <div class="form-control">
            <label class="label">
              <span class="label-text">
                Max history entries: {tempSettings().maxHistoryEntries}
              </span>
            </label>
            <input
              type="range"
              min="10"
              max="100"
              value={tempSettings().maxHistoryEntries}
              class="range range-primary"
              onInput={(e) =>
                setTempSettings((prev) => ({
                  ...prev,
                  maxHistoryEntries: parseInt(e.currentTarget.value),
                }))
              }
            />
          </div>
        </div>
      </EnhancedCard>

      {/* Mobile-specific settings */}
      <Show when={deviceCapabilities.isMobile}>
        <EnhancedCard title="Mobile" icon="📱">
          <div class="space-y-4">
            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Haptic feedback</span>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  checked={tempSettings().hapticFeedback}
                  onChange={(e) =>
                    setTempSettings((prev) => ({
                      ...prev,
                      hapticFeedback: e.currentTarget.checked,
                    }))
                  }
                />
              </label>
            </div>

            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Sound effects</span>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  checked={tempSettings().soundEffects}
                  onChange={(e) =>
                    setTempSettings((prev) => ({
                      ...prev,
                      soundEffects: e.currentTarget.checked,
                    }))
                  }
                />
              </label>
            </div>

            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Push notifications</span>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  checked={tempSettings().notifications}
                  onChange={(e) =>
                    setTempSettings((prev) => ({
                      ...prev,
                      notifications: e.currentTarget.checked,
                    }))
                  }
                />
              </label>
            </div>
          </div>
        </EnhancedCard>
      </Show>
    </div>
  );

  const renderAccessibilityTab = () => (
    <div class="space-y-6">
      <EnhancedCard title="Visual Accessibility" icon="👁️">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">High contrast mode</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={tempSettings().highContrast}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    highContrast: e.currentTarget.checked,
                  }))
                }
              />
            </label>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Color blind friendly</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={tempSettings().colorBlindMode}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    colorBlindMode: e.currentTarget.checked,
                  }))
                }
              />
            </label>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Screen reader support</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                checked={tempSettings().screenReader}
                onChange={(e) =>
                  setTempSettings((prev) => ({
                    ...prev,
                    screenReader: e.currentTarget.checked,
                  }))
                }
              />
            </label>
          </div>
        </div>
      </EnhancedCard>

      <EnhancedCard title="Interaction" icon="🎮">
        <div class="space-y-4">
          <div class="form-control">
            <label class="label">
              <span class="label-text">Language</span>
            </label>
            <select
              class="select select-bordered"
              value={tempSettings().language}
              onChange={(e) =>
                setTempSettings((prev) => ({
                  ...prev,
                  language: e.currentTarget.value,
                }))
              }
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </div>
      </EnhancedCard>
    </div>
  );

  const renderAboutTab = () => (
    <div class="space-y-6">
      <EnhancedCard title="About RiTerm" icon="ℹ️">
        <div class="space-y-4">
          <div class="text-center">
            <div class="text-6xl text-primary mb-4">⚡</div>
            <h2 class="text-2xl font-bold mb-2">RiTerm</h2>
            <p class="text-sm opacity-70 mb-4">P2P Terminal Sharing</p>
            <div class="badge badge-primary">v1.0.0</div>
          </div>

          <div class="stats stats-vertical w-full">
            <div class="stat">
              <div class="stat-title">Device Type</div>
              <div class="stat-value text-lg">
                {deviceCapabilities.isMobile
                  ? "Mobile"
                  : deviceCapabilities.isTablet
                    ? "Tablet"
                    : "Desktop"}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Screen Size</div>
              <div class="stat-value text-lg">
                {deviceCapabilities.screenSize.toUpperCase()}
              </div>
            </div>
            <div class="stat">
              <div class="stat-title">Touch Support</div>
              <div class="stat-value text-lg">
                {deviceCapabilities.supportsTouch ? "Yes" : "No"}
              </div>
            </div>
          </div>

          <div class="space-y-2">
            <EnhancedButton
              variant="outline"
              fullWidth
              onClick={handleExportSettings}
              icon="📤"
            >
              Export Settings
            </EnhancedButton>
            <EnhancedButton
              variant="outline"
              fullWidth
              onClick={handleImportSettings}
              icon="📥"
            >
              Import Settings
            </EnhancedButton>
            <EnhancedButton
              variant="outline"
              fullWidth
              onClick={handleReset}
              icon="🔄"
            >
              Reset to Defaults
            </EnhancedButton>
          </div>
        </div>
      </EnhancedCard>
    </div>
  );

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="bg-base-100 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
          {/* Header */}
          <div class="flex items-center justify-between p-6 border-b border-base-300">
            <h2 class="text-2xl font-bold">Settings</h2>
            <EnhancedButton
              variant="ghost"
              size="sm"
              onClick={props.onClose}
              icon="✕"
            >
              Close
            </EnhancedButton>
          </div>

          {/* Tabs */}
          <div class="tabs tabs-boxed mx-6 mt-4">
            <button
              class={`tab ${activeTab() === "appearance" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("appearance")}
            >
              🎨 Appearance
            </button>
            <button
              class={`tab ${activeTab() === "terminal" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("terminal")}
            >
              💻 Terminal
            </button>
            <button
              class={`tab ${activeTab() === "connection" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("connection")}
            >
              🌐 Connection
            </button>
            <button
              class={`tab ${activeTab() === "accessibility" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("accessibility")}
            >
              ♿ Accessibility
            </button>
            <button
              class={`tab ${activeTab() === "about" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("about")}
            >
              ℹ️ About
            </button>
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto p-6">
            <Show when={activeTab() === "appearance"}>
              {renderAppearanceTab()}
            </Show>
            <Show when={activeTab() === "terminal"}>{renderTerminalTab()}</Show>
            <Show when={activeTab() === "connection"}>
              {renderConnectionTab()}
            </Show>
            <Show when={activeTab() === "accessibility"}>
              {renderAccessibilityTab()}
            </Show>
            <Show when={activeTab() === "about"}>{renderAboutTab()}</Show>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-end space-x-3 p-6 border-t border-base-300">
            <EnhancedButton variant="ghost" onClick={props.onClose}>
              Cancel
            </EnhancedButton>
            <EnhancedButton
              variant="primary"
              onClick={handleSave}
              icon="💾"
              haptic
            >
              Save Settings
            </EnhancedButton>
          </div>
        </div>
      </div>
    </Show>
  );
}

