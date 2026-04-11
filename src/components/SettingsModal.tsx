import { Show } from "solid-js";
import {
  settingsStore,
  t,
  ThemeType,
  LanguageType,
  FontSizeType,
} from "../stores/settingsStore";
import { Button } from "./ui/primitives";
import { Dialog } from "./ui/primitives";
import { Label } from "./ui/primitives";
import { Select } from "./ui/primitives";
import { Switch } from "./ui/primitives";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const themeOptions = [
    { value: "dark", label: t("theme.dark") },
    { value: "light", label: t("theme.light") },
    { value: "corporate", label: t("theme.corporate") },
    { value: "business", label: t("theme.business") },
    { value: "night", label: t("theme.night") },
    { value: "black", label: t("theme.black") },
    { value: "abyss", label: t("theme.abyss") },
    { value: "luxury", label: t("theme.luxury") },
    { value: "synthwave", label: t("theme.synthwave") },
  ];

  return (
    <Show when={props.isOpen}>
      <Dialog
        open={props.isOpen}
        onClose={props.onClose}
        contentClass="w-11/12 max-w-2xl"
      >
        <h3 class="text-lg font-bold">{t("settings.title")}</h3>

        <div class="space-y-6 py-4">
          <div class="space-y-2">
            <Label>{t("settings.theme")}</Label>
            <Select
              value={settingsStore.get().theme}
              onChange={(val) => settingsStore.setTheme(val as ThemeType)}
            >
              {themeOptions.map((theme) => (
                <option value={theme.value}>{theme.label}</option>
              ))}
            </Select>
          </div>

          <div class="space-y-2">
            <Label>{t("settings.language")}</Label>
            <Select
              value={settingsStore.get().language}
              onChange={(val) => settingsStore.setLanguage(val as LanguageType)}
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </Select>
          </div>

          <div class="space-y-2">
            <Label>{t("settings.fontSize")}</Label>
            <Select
              value={settingsStore.get().fontSize}
              onChange={(val) => settingsStore.setFontSize(val as FontSizeType)}
              class="w-fit max-w-20 ml-auto"
            >
              <option value="small">{t("fontSize.small")}</option>
              <option value="medium">{t("fontSize.medium")}</option>
              <option value="large">{t("fontSize.large")}</option>
              <option value="extra-large">{t("fontSize.extra-large")}</option>
            </Select>
          </div>

          <div class="flex items-center justify-between rounded-lg border border-border p-3">
            <Label>{t("settings.animations")}</Label>
            <Switch
              checked={settingsStore.get().enableAnimations}
              onChange={() => settingsStore.toggleAnimations()}
            />
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              settingsStore.resetToDefaults();
              props.onClose();
            }}
          >
            {t("action.reset")}
          </Button>
        </div>
      </Dialog>
    </Show>
  );
}
