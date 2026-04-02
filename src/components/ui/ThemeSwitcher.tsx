import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { FiSun, FiMoon, FiMonitor, FiChevronDown } from "solid-icons/fi";
import { i18nStore } from "../../stores/i18nStore";

interface ThemeSwitcherProps {
  class?: string;
}

interface LanguageSwitcherProps {
  class?: string;
}

// Theme definitions with icons
const themes = [
  { id: "light", name: "Light", icon: FiSun, color: "#fbbf24" },
  { id: "sunset", name: "Sunset", icon: FiSun, color: "#fb923c" },
  { id: "black", name: "Black", icon: FiMoon, color: "#0f0f0f" },
  { id: "synthwave", name: "Synthwave", icon: FiMonitor, color: "#d946ef" },
  { id: "abyss", name: "Abyss", icon: FiMoon, color: "#0f172a" },
  { id: "luxury", name: "Luxury", icon: FiMoon, color: "#78716c" },
];

const normalizeTheme = (theme: string) => {
  if (theme === "forest") return "abyss";
  if (theme === "dracula") return "black";
  return theme;
};

export function ThemeSwitcher(props: ThemeSwitcherProps) {
  const [currentTheme, setCurrentTheme] = createSignal("sunset");
  const [isOpen, setIsOpen] = createSignal(false);

  // Get current theme info
  const currentThemeInfo = () =>
    themes.find((t) => t.id === currentTheme()) || themes[0];
  const CurrentIcon = currentThemeInfo().icon;

  // Load theme from localStorage on mount
  onMount(() => {
    const savedTheme = normalizeTheme(localStorage.getItem("theme") || "sunset");
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);
  });

  // Save theme to localStorage and update DOM when theme changes
  createEffect(() => {
    const theme = normalizeTheme(currentTheme());
    localStorage.setItem("theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  });

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    setIsOpen(false);
  };

  // Close dropdown when clicking outside
  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".theme-switcher")) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  });

  return (
    <div class={cn("relative theme-switcher", props.class)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
          "hover:bg-muted text-sm font-medium",
        )}
      >
        <CurrentIcon size={16} />
        <span class="hidden sm:inline">{currentThemeInfo().name}</span>
        <FiChevronDown
          size={14}
          class={cn(
            "transition-transform duration-200",
            isOpen() && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      <Show when={isOpen()}>
        <div
          class={cn(
            "absolute right-0 mt-2 w-48 bg-base-100 rounded-xl border border-border shadow-xl overflow-hidden z-50",
            "animate-fade-in origin-top-right",
          )}
        >
          <div class="p-2">
            <div class="text-xs font-semibold text-muted-foreground px-3 py-2 uppercase tracking-wide">
              Choose Theme
            </div>
            <div class="space-y-1">
              <For each={themes}>
                {(theme) => (
                  <button
                    type="button"
                    onClick={() => handleThemeChange(theme.id)}
                    class={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                      currentTheme() === theme.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <div
                      class="w-5 h-5 rounded-full flex items-center justify-center"
                      style={`background-color: ${theme.color}`}
                    >
                      <Show when={currentTheme() === theme.id}>
                        <FiSun size={10} class="text-white" />
                      </Show>
                    </div>
                    <span class="text-sm">{theme.name}</span>
                    <Show when={currentTheme() === theme.id}>
                      <div class="ml-auto">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

export function LanguageSwitcher(props: LanguageSwitcherProps) {
  const t = i18nStore.t;

  return (
    <div
      class={cn(
        "inline-flex items-center gap-1 rounded-lg border border-base-content/10 bg-base-100/85 p-1 shadow-sm backdrop-blur",
        props.class,
      )}
    >
      <button
        type="button"
        class={cn(
          "rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors",
          i18nStore.locale() === "en"
            ? "bg-primary text-primary-content"
            : "text-base-content/60 hover:bg-base-content/5",
        )}
        onClick={() => i18nStore.setLocale("en")}
        title={t("common.english")}
      >
        EN
      </button>
      <button
        type="button"
        class={cn(
          "rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors",
          i18nStore.locale() === "zh-CN"
            ? "bg-primary text-primary-content"
            : "text-base-content/60 hover:bg-base-content/5",
        )}
        onClick={() => i18nStore.setLocale("zh-CN")}
        title={t("common.chinese")}
      >
        中
      </button>
    </div>
  );
}
