import { createSignal, createEffect, Show } from "solid-js";
import {
  settingsStore,
  t,
  ThemeType,
  LanguageType,
  FontSizeType,
} from "../stores/settingsStore";
import { ModernCard, ModernButton } from "./ui/CyberEffects";
import { HistoryEntry } from "../hooks/useConnectionHistory";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry?: HistoryEntry | null;
  onSave?: (
    ticket: string,
    updates: { title: string; description: string },
  ) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");

  createEffect(() => {
    if (props.entry) {
      setTitle(props.entry.title);
      setDescription(props.entry.description);
    }
  });

  const handleSave = () => {
    if (props.entry && props.onSave) {
      props.onSave(props.entry.ticket, {
        title: title(),
        description: description(),
      });
    }
    props.onClose();
  };

  const themeOptions = [
    { value: "riterm-dark", label: t("theme.riterm-dark") },
    { value: "riterm-light", label: t("theme.riterm-light") },
    { value: "dark", label: t("theme.dark") },
    { value: "light", label: t("theme.light") },
    { value: "corporate", label: t("theme.corporate") },
    { value: "business", label: t("theme.business") },
    { value: "night", label: t("theme.night") },
    { value: "forest", label: t("theme.forest") },
    { value: "dracula", label: t("theme.dracula") },
    { value: "luxury", label: t("theme.luxury") },
    { value: "synthwave", label: t("theme.synthwave") },
  ];

  return (
    <Show when={props.isOpen}>
      <div class="modal modal-open">
        <div class="modal-box w-11/12 max-w-2xl">
          <h3 class="font-bold text-lg">{t("settings.title")}</h3>

          <div class="py-4 space-y-6">
            {/* Theme Selection */}
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">
                  {t("settings.theme")}
                </span>
              </label>
              <select
                class="select select-bordered w-full"
                value={settingsStore.get().theme}
                onChange={(e) =>
                  settingsStore.setTheme(e.currentTarget.value as ThemeType)
                }
              >
                {themeOptions.map((theme) => (
                  <option value={theme.value}>{theme.label}</option>
                ))}
              </select>
            </div>

            {/* Language Selection */}
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">
                  {t("settings.language")}
                </span>
              </label>
              <select
                class="select select-bordered w-full"
                value={settingsStore.get().language}
                onChange={(e) =>
                  settingsStore.setLanguage(
                    e.currentTarget.value as LanguageType,
                  )
                }
              >
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </div>

            {/* Font Size */}
            <div class="form-control">
              <label class="label">
                <span class="label-text font-medium">
                  {t("settings.fontSize")}
                </span>
              </label>
              <select
                class="select select-bordered w-full"
                value={settingsStore.get().fontSize}
                onChange={(e) =>
                  settingsStore.setFontSize(
                    e.currentTarget.value as FontSizeType,
                  )
                }
              >
                <option value="small">{t("fontSize.small")}</option>
                <option value="medium">{t("fontSize.medium")}</option>
                <option value="large">{t("fontSize.large")}</option>
                <option value="extra-large">{t("fontSize.extra-large")}</option>
              </select>
            </div>

            {/* Toggle Settings */}
            <div class="form-control">
              <label class="cursor-pointer label">
                <span class="label-text font-medium">
                  {t("settings.animations")}
                </span>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  checked={settingsStore.get().enableAnimations}
                  onChange={() => settingsStore.toggleAnimations()}
                />
              </label>
            </div>
          </div>

          <div class="modal-action">
            <button class="btn btn-ghost" onClick={props.onClose}>
              {t("action.cancel")}
            </button>
            <button
              class="btn btn-error"
              onClick={() => {
                settingsStore.resetToDefaults();
                props.onClose();
              }}
            >
              {t("action.reset")}
            </button>
          </div>
        </div>
        <div class="modal-backdrop" onClick={props.onClose} />
      </div>
    </Show>
  );
}
