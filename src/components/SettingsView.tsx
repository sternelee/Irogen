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
    <div
      class={cn(
        "flex h-full flex-col overflow-y-auto bg-background p-4 sm:p-8",
        props.class,
      )}
    >
      <div class="mx-auto w-full max-w-4xl space-y-8">
        <header class="flex items-start sm:items-center gap-3">
          <button
            type="button"
            class="btn btn-square btn-ghost h-10 w-10 rounded-xl md:hidden shrink-0 -ml-2"
            onClick={() => navigationStore.setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <svg
              width="24"
              height="24"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="inline-block h-6 w-6 stroke-current"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 6h16M4 12h16M4 18h16"
              ></path>
            </svg>
          </button>
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t("settings.title")}
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {t("settings.desc")}
            </p>
          </div>
        </header>

        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FiMoon size={16} />
            {t("settings.appearance")}
          </h2>
          <div class="rounded-2xl border border-border/50 bg-base-200 divide-y divide-border/50">
            <div class="flex items-center justify-between p-4 sm:p-5">
              <div>
                <p class="text-sm font-medium text-foreground">
                  {t("settings.theme")}
                </p>
                <p class="text-xs text-muted-foreground mt-1">
                  {t("settings.themeDesc")}
                </p>
              </div>
              <ThemeSwitcher />
            </div>

            <div class="flex items-center justify-between p-4 sm:p-5">
              <div>
                <p class="text-sm font-medium text-foreground">
                  {t("settings.fontSize")}
                </p>
                <p class="text-xs text-muted-foreground mt-1">
                  {t("settings.fontSizeDesc")}
                </p>
              </div>
              <select
                class="select select-bordered select-sm rounded-xl bg-background border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                value={settingsStore.get().fontSize}
                onChange={(e) =>
                  settingsStore.setFontSize(
                    e.currentTarget.value as FontSizeType,
                  )
                }
              >
                {fontSizeOptions.map((size) => (
                  <option value={size.value}>{size.label}</option>
                ))}
              </select>
            </div>

            <div class="flex items-center justify-between p-4 sm:p-5">
              <div>
                <p class="text-sm font-medium text-foreground">
                  {t("settings.animations")}
                </p>
                <p class="text-xs text-muted-foreground mt-1">
                  {t("settings.animationsDesc")}
                </p>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  class="peer sr-only"
                  checked={settingsStore.get().enableAnimations}
                  onChange={() => settingsStore.toggleAnimations()}
                />
                <div class="peer h-6 w-11 rounded-full bg-muted after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-border/50 after:bg-background after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20"></div>
              </label>
            </div>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FiGlobe size={16} />
            {t("settings.language")}
          </h2>
          <div class="rounded-2xl border border-border/50 bg-base-200 divide-y divide-border/50">
            <div class="flex items-center justify-between p-4 sm:p-5">
              <div>
                <p class="text-sm font-medium text-foreground">
                  {t("settings.language")}
                </p>
                <p class="text-xs text-muted-foreground mt-1">
                  {t("settings.languageDesc")}
                </p>
              </div>
              <LanguageSwitcher />
            </div>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FiInfo size={16} />
            {t("settings.about")}
          </h2>
          <div class="rounded-2xl border border-border/50 bg-base-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-foreground">Irogen</p>
              <p class="text-xs text-muted-foreground mt-1">
                {t("settings.aboutDesc") ||
                  "Multi-agent local/remote management platform"}
              </p>
              <p class="text-xs text-muted-foreground/70 mt-1 font-mono">
                v0.6.1
              </p>
            </div>

            <button
              class="btn btn-outline border-border/50 text-error hover:bg-error/10 hover:text-error hover:border-error/50 btn-sm rounded-xl gap-2 transition-colors self-start sm:self-auto"
              onClick={handleResetSettings}
            >
              <FiRefreshCw size={14} />
              {t("action.reset")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SettingsView;
