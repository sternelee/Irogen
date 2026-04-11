/**
 * Settings View Component
 *
 * Settings page with theme, language, setup guide, and other preferences
 */

import { type Component, createSignal, Show } from "solid-js";
import { settingsStore, t, FontSizeType } from "../stores/settingsStore";
import { notificationStore } from "../stores/notificationStore";
import { FiMoon, FiGlobe, FiPlay, FiInfo } from "solid-icons/fi";
import { Button } from "./ui/primitives";
import { Label, Select, Switch } from "./ui/primitives";
import { ThemeSwitcher, LanguageSwitcher } from "./ui/ThemeSwitcher";
import { SetupGuide } from "./mobile/SetupGuide";

interface SettingsViewProps {
  class?: string;
}

export const SettingsView: Component<SettingsViewProps> = (props) => {
  const [showSetupGuide, setShowSetupGuide] = createSignal(false);

  const fontSizeOptions = [
    { value: "small", label: t("fontSize.small") },
    { value: "medium", label: t("fontSize.medium") },
    { value: "large", label: t("fontSize.large") },
    { value: "extra-large", label: t("fontSize.extra-large") },
  ];

  const handleResetSettings = () => {
    settingsStore.resetToDefaults();
    notificationStore.success(
      "Settings reset to defaults",
      "Reset Complete",
    );
  };

  return (
    <div class={props.class}>
      {/* Page Header with Hamburger Menu */}
      <header class="compact-mobile-controls z-20 flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-base-content/10 bg-base-100/80 px-4 py-3 backdrop-blur-lg md:px-6">
        <div class="flex items-center gap-3">
          {/* Hamburger menu - only visible on mobile */}
          <label
            for="drawer"
            aria-label="Open menu"
            class="btn btn-square btn-ghost drawer-button lg:hidden"
          >
            <svg
              width="20"
              height="20"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="inline-block h-5 w-5 stroke-current"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 6h16M4 12h16M4 18h16"
              ></path>
            </svg>
          </label>
          <h1 class="text-xl font-bold">{t("settings.title")}</h1>
        </div>
      </header>

      <div class="flex flex-col gap-6 p-4 sm:p-6 max-w-2xl mx-auto">
        {/* Description */}
        <p class="text-sm opacity-60">
          {t("settings.description") || "Customize your Irogen experience"}
        </p>

        {/* Appearance Section */}
        <div class="card bg-base-200 shadow">
          <div class="card-body">
            <h2 class="card-title text-base">
              <FiMoon size={18} />
              {t("settings.appearance") || "Appearance"}
            </h2>

            {/* Theme Switcher - Label left, switcher right */}
            <div class="flex items-center justify-between">
              <Label>{t("settings.theme")}</Label>
              <ThemeSwitcher />
            </div>

            {/* Font Size */}
            <div class="flex items-center justify-between">
              <Label>{t("settings.fontSize")}</Label>
              <Select
                value={settingsStore.get().fontSize}
                onChange={(val) =>
                  settingsStore.setFontSize(val as FontSizeType)
                }
              >
                {fontSizeOptions.map((size) => (
                  <option value={size.value}>{size.label}</option>
                ))}
              </Select>
            </div>

            {/* Animations */}
            <div class="flex items-center justify-between">
              <Label>{t("settings.animations")}</Label>
              <Switch
                checked={settingsStore.get().enableAnimations}
                onChange={() => settingsStore.toggleAnimations()}
              />
            </div>
          </div>
        </div>

        {/* Language Section */}
        <div class="card bg-base-200 shadow">
          <div class="card-body">
            <h2 class="card-title text-base">
              <FiGlobe size={18} />
              {t("settings.language") || "Language"}
            </h2>

            <div class="flex items-center justify-between">
              <Label>{t("settings.language")}</Label>
              <LanguageSwitcher />
            </div>
          </div>
        </div>

        {/* Setup Guide Section */}
        <div class="card bg-base-200 shadow">
          <div class="card-body">
            <h2 class="card-title text-base">
              <FiPlay size={18} />
              {t("setupGuide.title") || "Setup Guide"}
            </h2>

            <p class="text-sm opacity-70">
              {t("setupGuide.settingsDesc") ||
                "Learn how to set up Irogen on your devices"}
            </p>

            <div class="card-actions justify-end mt-2">
              <Button variant="primary" onClick={() => setShowSetupGuide(true)}>
                {t("setupGuide.open") || "Open Setup Guide"}
              </Button>
            </div>
          </div>
        </div>

        {/* About Section */}
        <div class="card bg-base-200 shadow">
          <div class="card-body">
            <h2 class="card-title text-base">
              <FiInfo size={18} />
              {t("settings.about") || "About"}
            </h2>

            <div class="text-sm opacity-70 space-y-1">
              <p>
                <span class="font-semibold">Irogen</span> v0.6.1
              </p>
              <p>
                {t("settings.aboutDesc") ||
                  "Multi-agent local/remote management platform"}
              </p>
            </div>
          </div>
        </div>

        {/* Reset Button */}
        <div class="flex justify-end">
          <Button variant="destructive" onClick={handleResetSettings}>
            {t("action.reset") || "Reset to Defaults"}
          </Button>
        </div>
      </div>

      {/* Setup Guide Modal */}
      <Show when={showSetupGuide()}>
        <div class="fixed inset-0 z-70 bg-base-100 pb-safe">
          <SetupGuide
            onClose={() => setShowSetupGuide(false)}
            onSkip={() => setShowSetupGuide(false)}
          />
        </div>
      </Show>
    </div>
  );
};

export default SettingsView;