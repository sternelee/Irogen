import { createSignal, createEffect } from "solid-js";
import { getDeviceCapabilities } from "./mobile";

// Theme types
export interface ThemeConfig {
  id: string;
  name: string;
  description: string;
  category: "light" | "dark" | "terminal" | "custom";
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    base100: string;
    base200: string;
    base300: string;
    content: string;
  };
  mobileOptimized: boolean;
  accessibility: {
    highContrast: boolean;
    colorBlindFriendly: boolean;
    reducedMotion: boolean;
  };
  terminal: {
    background: string;
    foreground: string;
    cursor: string;
    selection: string;
    ansiColors: string[];
  };
}

// Available themes
export const themes: ThemeConfig[] = [
  {
    id: "riterm-mobile",
    name: "Mobile Light",
    description: "Optimized for mobile devices with high readability",
    category: "light",
    colors: {
      primary: "#4F46E5",
      secondary: "#10B981",
      accent: "#F59E0B",
      base100: "#ffffff",
      base200: "#F8FAFC",
      base300: "#E2E8F0",
      content: "#1E293B",
    },
    mobileOptimized: true,
    accessibility: {
      highContrast: false,
      colorBlindFriendly: true,
      reducedMotion: false,
    },
    terminal: {
      background: "rgba(255, 255, 255, 0.95)",
      foreground: "#1E293B",
      cursor: "#4F46E5",
      selection: "rgba(79, 70, 229, 0.2)",
      ansiColors: [
        "#1E293B",
        "#EF4444",
        "#10B981",
        "#F59E0B",
        "#3B82F6",
        "#8B5CF6",
        "#06B6D4",
        "#F8FAFC",
        "#64748B",
        "#F87171",
        "#34D399",
        "#FBBF24",
        "#60A5FA",
        "#A78BFA",
        "#67E8F9",
        "#FFFFFF",
      ],
    },
  },
  {
    id: "riterm-dark",
    name: "Mobile Dark",
    description: "Dark theme optimized for mobile use and battery saving",
    category: "dark",
    colors: {
      primary: "#6366F1",
      secondary: "#10B981",
      accent: "#F59E0B",
      base100: "#0F172A",
      base200: "#1E293B",
      base300: "#334155",
      content: "#F1F5F9",
    },
    mobileOptimized: true,
    accessibility: {
      highContrast: false,
      colorBlindFriendly: true,
      reducedMotion: false,
    },
    terminal: {
      background: "rgba(15, 23, 42, 0.95)",
      foreground: "#F1F5F9",
      cursor: "#6366F1",
      selection: "rgba(99, 102, 241, 0.3)",
      ansiColors: [
        "#334155",
        "#EF4444",
        "#22C55E",
        "#F97316",
        "#0EA5E9",
        "#8B5CF6",
        "#06B6D4",
        "#F1F5F9",
        "#64748B",
        "#F87171",
        "#34D399",
        "#FBBF24",
        "#60A5FA",
        "#A78BFA",
        "#67E8F9",
        "#FFFFFF",
      ],
    },
  },
  {
    id: "riterm-terminal",
    name: "Retro Terminal",
    description: "Classic green-on-black terminal aesthetic",
    category: "terminal",
    colors: {
      primary: "#00FF00",
      secondary: "#00FFFF",
      accent: "#FFFF00",
      base100: "#000000",
      base200: "#111111",
      base300: "#222222",
      content: "#00FF00",
    },
    mobileOptimized: true,
    accessibility: {
      highContrast: true,
      colorBlindFriendly: false,
      reducedMotion: true,
    },
    terminal: {
      background: "rgba(0, 0, 0, 0.98)",
      foreground: "#00FF00",
      cursor: "#00FF00",
      selection: "rgba(0, 255, 0, 0.3)",
      ansiColors: [
        "#000000",
        "#FF0000",
        "#00FF00",
        "#FFFF00",
        "#0000FF",
        "#FF00FF",
        "#00FFFF",
        "#FFFFFF",
        "#888888",
        "#FF8888",
        "#88FF88",
        "#FFFF88",
        "#8888FF",
        "#FF88FF",
        "#88FFFF",
        "#FFFFFF",
      ],
    },
  },
  {
    id: "riterm-high-contrast",
    name: "High Contrast",
    description: "Maximum contrast for accessibility",
    category: "custom",
    colors: {
      primary: "#FFFFFF",
      secondary: "#FFFF00",
      accent: "#FF00FF",
      base100: "#000000",
      base200: "#1A1A1A",
      base300: "#333333",
      content: "#FFFFFF",
    },
    mobileOptimized: true,
    accessibility: {
      highContrast: true,
      colorBlindFriendly: true,
      reducedMotion: true,
    },
    terminal: {
      background: "rgba(0, 0, 0, 1)",
      foreground: "#FFFFFF",
      cursor: "#FFFFFF",
      selection: "rgba(255, 255, 255, 0.3)",
      ansiColors: [
        "#000000",
        "#FF0000",
        "#00FF00",
        "#FFFF00",
        "#0000FF",
        "#FF00FF",
        "#00FFFF",
        "#FFFFFF",
        "#888888",
        "#FF8888",
        "#88FF88",
        "#FFFF88",
        "#8888FF",
        "#FF88FF",
        "#88FFFF",
        "#FFFFFF",
      ],
    },
  },
];

// Theme manager
class ThemeManager {
  private currentTheme = createSignal<ThemeConfig>(themes[0]);
  private autoTheme = createSignal(true);
  private reducedMotion = createSignal(false);
  private highContrast = createSignal(false);

  constructor() {
    this.detectSystemPreferences();
    this.loadUserPreferences();
    this.setupMediaQueryListeners();
  }

  detectSystemPreferences(): void {
    // Detect dark mode preference
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;

    // Detect reduced motion preference
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.reducedMotion[1](prefersReducedMotion);

    // Detect high contrast preference
    const prefersHighContrast = window.matchMedia(
      "(prefers-contrast: high)",
    ).matches;
    this.highContrast[1](prefersHighContrast);

    // Auto-select appropriate theme
    if (this.autoTheme[0]()) {
      const deviceCapabilities = getDeviceCapabilities();
      let selectedTheme: ThemeConfig;

      if (prefersHighContrast) {
        selectedTheme =
          themes.find((t) => t.id === "riterm-high-contrast") || themes[0];
      } else if (prefersDark) {
        selectedTheme = themes.find((t) => t.id === "riterm-dark") || themes[1];
      } else {
        selectedTheme =
          themes.find((t) => t.id === "riterm-mobile") || themes[0];
      }

      this.setTheme(selectedTheme);
    }
  }

  private setupMediaQueryListeners(): void {
    // Listen for system theme changes
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    darkModeQuery.addEventListener("change", (e) => {
      if (this.autoTheme[0]()) {
        const theme = e.matches
          ? themes.find((t) => t.id === "riterm-dark") || themes[1]
          : themes.find((t) => t.id === "riterm-mobile") || themes[0];
        this.setTheme(theme);
      }
    });

    // Listen for reduced motion changes
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    reducedMotionQuery.addEventListener("change", (e) => {
      this.reducedMotion[1](e.matches);
    });

    // Listen for high contrast changes
    const highContrastQuery = window.matchMedia("(prefers-contrast: high)");
    highContrastQuery.addEventListener("change", (e) => {
      this.highContrast[1](e.matches);
      if (e.matches && this.autoTheme[0]()) {
        const theme =
          themes.find((t) => t.id === "riterm-high-contrast") || themes[3];
        this.setTheme(theme);
      }
    });
  }

  private loadUserPreferences(): void {
    try {
      const saved = localStorage.getItem("riterm-theme-preferences");
      if (saved) {
        const prefs = JSON.parse(saved);
        this.autoTheme[1](prefs.autoTheme ?? true);

        if (!prefs.autoTheme && prefs.themeId) {
          const theme = themes.find((t) => t.id === prefs.themeId);
          if (theme) {
            this.setTheme(theme);
          }
        }
      }
    } catch (error) {
      console.warn("Failed to load theme preferences:", error);
    }
  }

  private saveUserPreferences(): void {
    try {
      const prefs = {
        autoTheme: this.autoTheme[0](),
        themeId: this.currentTheme[0]().id,
      };
      localStorage.setItem("riterm-theme-preferences", JSON.stringify(prefs));
    } catch (error) {
      console.warn("Failed to save theme preferences:", error);
    }
  }

  setTheme(theme: ThemeConfig): void {
    this.currentTheme[1](theme);
    this.applyTheme(theme);
    this.saveUserPreferences();
  }

  private applyTheme(theme: ThemeConfig): void {
    // Apply DaisyUI theme
    document.documentElement.setAttribute("data-theme", theme.id);

    // Apply custom CSS variables for enhanced features
    const root = document.documentElement.style;
    root.setProperty("--terminal-bg", theme.terminal.background);
    root.setProperty("--terminal-fg", theme.terminal.foreground);
    root.setProperty("--terminal-cursor", theme.terminal.cursor);
    root.setProperty("--terminal-selection", theme.terminal.selection);

    // Apply ANSI colors
    theme.terminal.ansiColors.forEach((color, index) => {
      root.setProperty(`--ansi-${index}`, color);
    });

    // Apply accessibility settings
    if (theme.accessibility.reducedMotion || this.reducedMotion[0]()) {
      document.documentElement.classList.add("reduce-motion");
    } else {
      document.documentElement.classList.remove("reduce-motion");
    }

    if (theme.accessibility.highContrast || this.highContrast[0]()) {
      document.documentElement.classList.add("high-contrast");
    } else {
      document.documentElement.classList.remove("high-contrast");
    }

    // Mobile optimizations
    if (theme.mobileOptimized) {
      document.documentElement.classList.add("mobile-optimized");
    } else {
      document.documentElement.classList.remove("mobile-optimized");
    }
  }

  getCurrentTheme(): ThemeConfig {
    return this.currentTheme[0]();
  }

  getThemes(): ThemeConfig[] {
    return themes;
  }

  isAutoTheme(): boolean {
    return this.autoTheme[0]();
  }

  setAutoTheme(enabled: boolean): void {
    this.autoTheme[1](enabled);
    if (enabled) {
      this.detectSystemPreferences();
    }
    this.saveUserPreferences();
  }

  createSignals() {
    return {
      currentTheme: this.currentTheme,
      autoTheme: this.autoTheme,
      reducedMotion: this.reducedMotion,
      highContrast: this.highContrast,
    };
  }
}

// Create global theme manager instance
export const themeManager = new ThemeManager();

// Visual feedback utilities
export class VisualFeedback {
  static showToast(
    message: string,
    type: "success" | "error" | "info" | "warning" = "info",
    duration = 3000,
  ): void {
    const toast = document.createElement("div");
    toast.className = `alert alert-${type} fixed top-4 right-4 z-50 w-auto max-w-sm animate-slide-down`;
    toast.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        ${this.getToastIcon(type)}
      </svg>
      <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
      toast.style.animation = "slideUp 0.3s ease-out forwards";
      setTimeout(() => {
        document.body.removeChild(toast);
      }, 300);
    }, duration);
  }

  private static getToastIcon(type: string): string {
    switch (type) {
      case "success":
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />';
      case "error":
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />';
      case "warning":
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />';
      default:
        return '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
    }
  }

  static showLoadingOverlay(message = "Loading..."): () => void {
    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 bg-black/50 flex items-center justify-center z-50";
    overlay.innerHTML = `
      <div class="bg-base-100 p-6 rounded-lg flex items-center space-x-3">
        <span class="loading loading-spinner loading-md"></span>
        <span>${message}</span>
      </div>
    `;

    document.body.appendChild(overlay);

    return () => {
      document.body.removeChild(overlay);
    };
  }

  static pulse(element: HTMLElement, duration = 300): void {
    element.style.animation = `pulse ${duration}ms ease-in-out`;
    setTimeout(() => {
      element.style.animation = "";
    }, duration);
  }

  static shake(element: HTMLElement, duration = 500): void {
    element.style.animation = `shake ${duration}ms ease-in-out`;
    setTimeout(() => {
      element.style.animation = "";
    }, duration);
  }

  static highlight(
    element: HTMLElement,
    color = "rgba(79, 70, 229, 0.3)",
    duration = 1000,
  ): void {
    const originalBackground = element.style.backgroundColor;
    element.style.backgroundColor = color;
    element.style.transition = `background-color ${duration}ms ease-out`;

    setTimeout(() => {
      element.style.backgroundColor = originalBackground;
      setTimeout(() => {
        element.style.transition = "";
      }, duration);
    }, 100);
  }
}

// Initialize theme system
export function initializeTheme(): void {
  themeManager.detectSystemPreferences();
}

// Export signals for reactive components
export const themeSignals = themeManager.createSignals();

