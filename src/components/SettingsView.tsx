/**
 * SettingsView Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import { type Component } from "solid-js";
import { cn } from "../lib/utils";
import { settingsStore, FontSizeType } from "../stores/settingsStore";
import { t } from "../stores/i18nStore";
import { notificationStore } from "../stores/notificationStore";
import { navigationStore } from "../stores/navigationStore";
import { FiMoon, FiGlobe, FiInfo, FiRefreshCw } from "solid-icons/fi";
import { ThemeSwitcher, LanguageSwitcher } from "./ui/ThemeSwitcher";

interface SettingsViewProps {
  class?: string;
}

export const SettingsView: Component<SettingsViewProps> = (props) => {
  const fontSizeOptions = [
    { value: "small", label: t("settings.fontSizeSmall") as string },
    { value: "medium", label: t("settings.fontSizeMedium") as string },
    { value: "large", label: t("settings.fontSizeLarge") as string },
    { value: "extra-large", label: t("settings.fontSizeExtraLarge") as string },
  ];

  const handleResetSettings = () => {
    settingsStore.resetToDefaults();
    notificationStore.success("Settings reset to defaults", "Reset Complete");
  };

  return (
    <div class={cn("flex h-full flex-col bg-background", props.class)}>
      <header class="flex items-center gap-4 px-6 py-5 border-b border-black/10">
        <button
          type="button"
          class="text-zinc-500 hover:text-foreground md:hidden"
          onClick={() => navigationStore.setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
          </svg>
        </button>
        <div>
          <h1 class="text-xl font-bold text-foreground">{t("settings.title")}</h1>
          <p class="text-sm text-zinc-500">{t("settings.desc")}</p>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-6">
        <div class="max-w-2xl mx-auto space-y-8">
          {/* Appearance */}
          <section>
            <h2 class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <FiMoon size={12} />
              {t("settings.appearance")}
            </h2>
            <div class="border border-black/10">
              <div class="flex items-center justify-between px-4 py-3 border-b border-black/5">
                <div>
                  <p class="text-sm font-medium text-foreground">{t("settings.theme")}</p>
                  <p class="text-xs text-zinc-500">{t("settings.themeDesc")}</p>
                </div>
                <ThemeSwitcher />
              </div>
              <div class="flex items-center justify-between px-4 py-3 border-b border-black/5">
                <div>
                  <p class="text-sm font-medium text-foreground">{t("settings.fontSize")}</p>
                  <p class="text-xs text-zinc-500">{t("settings.fontSizeDesc")}</p>
                </div>
                <select
                  class="border border-black/10 px-2 py-1 text-sm bg-background focus:outline-none focus:border-zinc-400"
                  value={settingsStore.get().fontSize}
                  onChange={(e) => settingsStore.setFontSize(e.currentTarget.value as FontSizeType)}
                >
                  {fontSizeOptions.map((size) => (
                    <option value={size.value}>{size.label}</option>
                  ))}
                </select>
              </div>
              <div class="flex items-center justify-between px-4 py-3">
                <div>
                  <p class="text-sm font-medium text-foreground">{t("settings.animations")}</p>
                  <p class="text-xs text-zinc-500">{t("settings.animationsDesc")}</p>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    class="peer sr-only"
                    checked={settingsStore.get().enableAnimations}
                    onChange={() => settingsStore.toggleAnimations()}
                  />
                  <div class="h-5 w-9 bg-zinc-200 peer-checked:bg-zinc-400"></div>
                </label>
              </div>
            </div>
          </section>

          {/* Language */}
          <section>
            <h2 class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <FiGlobe size={12} />
              {t("settings.language")}
            </h2>
            <div class="border border-black/10">
              <div class="flex items-center justify-between px-4 py-3">
                <div>
                  <p class="text-sm font-medium text-foreground">{t("settings.language")}</p>
                  <p class="text-xs text-zinc-500">{t("settings.languageDesc")}</p>
                </div>
                <LanguageSwitcher />
              </div>
            </div>
          </section>

          {/* About */}
          <section>
            <h2 class="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <FiInfo size={12} />
              {t("settings.about")}
            </h2>
            <div class="border border-black/10 px-4 py-3 flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-foreground">Acpx</p>
                <p class="text-xs text-zinc-500">Multi-agent local/remote management platform</p>
                <p class="text-xs text-zinc-400 font-mono mt-1">v0.6.1</p>
              </div>
              <button
                class="text-xs text-red-500 border border-red-500/20 px-3 py-1.5 hover:bg-red-500 hover:text-white"
                onClick={handleResetSettings}
              >
                <FiRefreshCw size={12} class="inline mr-1" />
                {t("action.reset")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsView;