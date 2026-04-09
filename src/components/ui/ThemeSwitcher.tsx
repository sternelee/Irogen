import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { FiChevronDown } from "solid-icons/fi";
import { i18nStore } from "../../stores/i18nStore";

interface ThemeSwitcherProps {
  class?: string;
}

interface LanguageSwitcherProps {
  class?: string;
}

// Theme definitions with icons
const themes = [
  { id: "light", name: "Light" },
  { id: "sunset", name: "Sunset" },
  { id: "black", name: "Black" },
  { id: "synthwave", name: "Synthwave" },
  { id: "abyss", name: "Abyss" },
  { id: "luxury", name: "Luxury" },
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

  // Load theme from localStorage on mount
  onMount(() => {
    const savedTheme = normalizeTheme(
      localStorage.getItem("theme") || "sunset",
    );
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
        <div class="bg-base-100 group-hover:border-base-content/20 border-base-content/10 grid shrink-0 grid-cols-2 gap-0.5 rounded-md border p-1 transition-colors">
          <div class="bg-base-content size-1 rounded-full"></div>{" "}
          <div class="bg-primary size-1 rounded-full"></div>{" "}
          <div class="bg-secondary size-1 rounded-full"></div>{" "}
          <div class="bg-accent size-1 rounded-full"></div>
        </div>
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
                    data-theme={theme.id}
                    class={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                      currentTheme() === theme.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <div class="w-5 h-5 rounded-full flex items-center justify-center">
                      <div class="bg-base-100 group-hover:border-base-content/20 border-base-content/10 grid shrink-0 grid-cols-2 gap-0.5 rounded-md border p-1 transition-colors">
                        <div class="bg-base-content size-1 rounded-full"></div>{" "}
                        <div class="bg-primary size-1 rounded-full"></div>{" "}
                        <div class="bg-secondary size-1 rounded-full"></div>{" "}
                        <div class="bg-accent size-1 rounded-full"></div>
                      </div>
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
        "language-switcher-compact inline-flex items-center gap-0.5 rounded-lg border border-base-content/10 bg-base-100/85 p-0.5 shadow-sm backdrop-blur sm:gap-1 sm:p-1",
        props.class,
      )}
    >
      <button
        type="button"
        class={cn(
          "language-switcher-compact__button rounded-md px-1.5 py-1 text-[11px] font-bold transition-colors sm:px-2.5 sm:py-1.5 sm:text-xs",
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
          "language-switcher-compact__button rounded-md px-1.5 py-1 text-[11px] font-bold transition-colors sm:px-2.5 sm:py-1.5 sm:text-xs",
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
