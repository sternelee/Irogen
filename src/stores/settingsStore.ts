import { createSignal, createEffect } from "solid-js";

export type ThemeType =
  | "sunset"
  | "dark"
  | "light"
  | "corporate"
  | "business"
  | "night"
  | "black"
  | "abyss"
  | "luxury"
  | "synthwave";
export type LanguageType = "en" | "zh-CN" | "zh-TW" | "ja" | "ko";
export type FontSizeType = "small" | "medium" | "large" | "extra-large";

export interface UserSettings {
  theme: ThemeType;
  language: LanguageType;
  fontSize: FontSizeType;
  enableAnimations: boolean;
  enableScanLines: boolean;
  enableMatrixRain: boolean;
  enableSoundEffects: boolean;
  autoConnect: boolean;
  rememberLastSession: boolean;
  saveConnectionHistory: boolean;
  maxHistoryEntries: number;
  customCSSFilters: string;
  networkTimeout: number;
  retryAttempts: number;
}

const defaultSettings: UserSettings = {
  theme: "sunset",
  language: "en",
  fontSize: "medium",
  enableAnimations: true,
  enableScanLines: false,
  enableMatrixRain: false,
  enableSoundEffects: false,
  autoConnect: false,
  rememberLastSession: true,
  saveConnectionHistory: true,
  maxHistoryEntries: 3,
  customCSSFilters: "",
  networkTimeout: 30000,
  retryAttempts: 3,
};

// Local storage key
const SETTINGS_KEY = "irogen-settings";

const normalizeTheme = (theme: unknown): ThemeType => {
  switch (theme) {
    case "forest":
      return "abyss";
    case "dracula":
      return "black";
    case "sunset":
    case "dark":
    case "light":
    case "corporate":
    case "business":
    case "night":
    case "black":
    case "abyss":
    case "luxury":
    case "synthwave":
      return theme;
    default:
      return defaultSettings.theme;
  }
};

// Load settings from localStorage
const loadSettings = (): UserSettings => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...defaultSettings,
        ...parsed,
        theme: normalizeTheme(parsed.theme),
      };
    }
  } catch (error) {
    console.error("Failed to load settings from localStorage:", error);
  }
  return defaultSettings;
};

// Save settings to localStorage
const saveSettings = (settings: UserSettings) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Failed to save settings to localStorage:", error);
  }
};

// Create reactive settings store
const [settings, setSettings] = createSignal<UserSettings>(loadSettings());

// Auto-save settings whenever they change
createEffect(() => {
  const currentSettings = settings();
  saveSettings(currentSettings);

  // Apply theme to document
  document.documentElement.setAttribute("data-theme", currentSettings.theme);

  // Apply font size class to body
  document.body.classList.remove("text-sm", "text-base", "text-lg", "text-xl");
  const fontSizeClass = {
    small: "text-sm",
    medium: "text-base",
    large: "text-lg",
    "extra-large": "text-xl",
  }[currentSettings.fontSize];
  document.body.classList.add(fontSizeClass);

  // Toggle animations
  document.body.classList.toggle(
    "reduce-motion",
    !currentSettings.enableAnimations,
  );
});

// Helper functions to update specific settings
export const settingsStore = {
  get: () => settings(),

  setTheme: (theme: ThemeType) => {
    setSettings((prev) => ({ ...prev, theme }));
  },

  setLanguage: (language: LanguageType) => {
    setSettings((prev) => ({ ...prev, language }));
  },

  setFontSize: (fontSize: FontSizeType) => {
    setSettings((prev) => ({ ...prev, fontSize }));
  },

  toggleAnimations: () => {
    setSettings((prev) => ({
      ...prev,
      enableAnimations: !prev.enableAnimations,
    }));
  },

  toggleScanLines: () => {
    setSettings((prev) => ({
      ...prev,
      enableScanLines: !prev.enableScanLines,
    }));
  },

  toggleMatrixRain: () => {
    setSettings((prev) => ({
      ...prev,
      enableMatrixRain: !prev.enableMatrixRain,
    }));
  },

  toggleSoundEffects: () => {
    setSettings((prev) => ({
      ...prev,
      enableSoundEffects: !prev.enableSoundEffects,
    }));
  },

  updateSettings: (updates: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
  },

  resetToDefaults: () => {
    setSettings(defaultSettings);
  },

  exportSettings: () => {
    return JSON.stringify(settings(), null, 2);
  },

  importSettings: (settingsJson: string) => {
    try {
      const imported = JSON.parse(settingsJson);
      setSettings({ ...defaultSettings, ...imported });
      return true;
    } catch (error) {
      console.error("Failed to import settings:", error);
      return false;
    }
  },
};

// Translations
export const translations = {
  en: {
    // UI Labels
    "app.title": "Irogen - P2P Agent",
    "connection.title": "Agent Connection",
    "settings.title": "Settings",
    "hosts.title": "Hosts",

    // Connection
    "connection.ticket.placeholder":
      "Enter session ticket or connection string",
    "connection.connect": "Connect",
    "connection.connecting": "Connecting...",
    "connection.disconnect": "Disconnect",
    "connection.status.connected": "Connected",
    "connection.status.disconnected": "Disconnected",
    "connection.status.connecting": "Connecting",
    "connection.status.failed": "Connection Failed",

    // Settings
    "settings.description": "Customize your Irogen experience",
    "settings.appearance": "Appearance",
    "settings.theme": "Theme",
    "settings.language": "Language",
    "settings.fontSize": "Font Size",
    "settings.animations": "Enable Animations",
    "settings.about": "About",
    "settings.aboutDesc": "Multi-agent local/remote management platform",
    "settings.scanLines": "Enable Scan Lines",
    "settings.matrixRain": "Enable Matrix Rain",
    "settings.soundEffects": "Sound Effects",
    "settings.autoConnect": "Auto Connect",
    "settings.rememberSession": "Remember Last Session",
    "settings.saveHistory": "Save Connection History",
    "settings.maxHistory": "Max History Entries",
    "settings.networkTimeout": "Network Timeout (ms)",
    "settings.retryAttempts": "Retry Attempts",

    // Setup Guide
    "setupGuide.title": "Setup Guide",
    "setupGuide.settingsDesc": "Learn how to set up Irogen on your devices",
    "setupGuide.open": "Open Setup Guide",

    // Themes
    "theme.dark": "Dark",
    "theme.light": "Light",
    "theme.corporate": "Corporate",
    "theme.business": "Business",
    "theme.night": "Night",
    "theme.black": "Black",
    "theme.abyss": "Abyss",
    "theme.luxury": "Luxury",
    "theme.synthwave": "Synthwave",

    // Font Sizes
    "fontSize.small": "Small",
    "fontSize.medium": "Medium",
    "fontSize.large": "Large",
    "fontSize.extra-large": "Extra Large",

    // Actions
    "action.save": "Save",
    "action.cancel": "Cancel",
    "action.reset": "Reset to Defaults",
    "action.export": "Export Settings",
    "action.import": "Import Settings",

    // Messages
    "message.settingsSaved": "Settings saved successfully",
    "message.settingsReset": "Settings reset to defaults",
    "message.settingsImported": "Settings imported successfully",
    "message.importFailed": "Failed to import settings",
  },
  "zh-CN": {
    // UI Labels
    "app.title": "Irogen - P2P 终端",
    "connection.title": "终端连接",
    "settings.title": "设置",
    "hosts.title": "主机",

    // Connection
    "connection.ticket.placeholder": "输入会话票据或连接字符串",
    "connection.connect": "连接",
    "connection.connecting": "连接中...",
    "connection.disconnect": "断开连接",
    "connection.status.connected": "已连接",
    "connection.status.disconnected": "未连接",
    "connection.status.connecting": "连接中",
    "connection.status.failed": "连接失败",

    // Settings
    "settings.description": "自定义您的 Irogen 体验",
    "settings.appearance": "外观",
    "settings.theme": "主题",
    "settings.language": "语言",
    "settings.fontSize": "字体大小",
    "settings.animations": "启用动画",
    "settings.about": "关于",
    "settings.aboutDesc": "多代理本地/远程管理平台",
    "settings.scanLines": "启用扫描线",
    "settings.matrixRain": "启用矩阵雨",
    "settings.soundEffects": "声音效果",
    "settings.autoConnect": "自动连接",
    "settings.rememberSession": "记住上次会话",
    "settings.saveHistory": "保存连接历史",

    // Setup Guide
    "setupGuide.title": "设置指南",
    "setupGuide.settingsDesc": "了解如何在您的设备上设置 Irogen",
    "setupGuide.open": "打开设置指南",
    "settings.maxHistory": "最大历史条目",
    "settings.networkTimeout": "网络超时 (毫秒)",
    "settings.retryAttempts": "重试次数",

    // Themes
    "theme.dark": "深色",
    "theme.light": "浅色",
    "theme.corporate": "企业",
    "theme.business": "商务",
    "theme.night": "夜晚",
    "theme.black": "黑曜",
    "theme.abyss": "深渊",
    "theme.luxury": "奢华",
    "theme.synthwave": "合成波",

    // Font Sizes
    "fontSize.small": "小",
    "fontSize.medium": "中",
    "fontSize.large": "大",
    "fontSize.extra-large": "特大",

    // Actions
    "action.save": "保存",
    "action.cancel": "取消",
    "action.reset": "重置为默认",
    "action.export": "导出设置",
    "action.import": "导入设置",

    // Messages
    "message.settingsSaved": "设置保存成功",
    "message.settingsReset": "设置已重置为默认",
    "message.settingsImported": "设置导入成功",
    "message.importFailed": "设置导入失败",
  },
};

// Translation helper
export const t = (key: string, lang?: LanguageType): string => {
  const currentLang = lang || settings().language;
  const allTranslations = translations as Record<
    string,
    Record<string, string>
  >;
  return allTranslations[currentLang]?.[key] || allTranslations.en[key] || key;
};

// Initialize theme on app start
document.documentElement.setAttribute("data-theme", settings().theme);
