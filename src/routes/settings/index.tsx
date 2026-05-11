import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { ArrowLeft } from "lucide-react";

export function SettingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => navigate({ to: "/sessions" })}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 font-semibold">{t("settings.title")}</div>
      </div>

      <div className="app-scroll-y flex-1 min-h-0 p-4">
        <div className="mx-auto max-w-content space-y-6">
          {/* Appearance */}
          <section>
            <h2 className="text-sm font-semibold mb-3">{t("settings.appearance")}</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">{t("settings.theme")}</div>
                  <div className="text-xs text-[var(--app-hint)]">System</div>
                </div>
                <select className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-1.5 text-sm text-[var(--app-fg)]">
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">{t("settings.fontSize")}</div>
                  <div className="text-xs text-[var(--app-hint)]">Medium</div>
                </div>
                <select className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-1.5 text-sm text-[var(--app-fg)]">
                  <option value="small">Small</option>
                  <option value="medium" selected>Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">{t("settings.language")}</div>
                  <div className="text-xs text-[var(--app-hint)]">English</div>
                </div>
                <select className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] px-3 py-1.5 text-sm text-[var(--app-fg)]">
                  <option value="en">English</option>
                  <option value="zh-CN">简体中文</option>
                </select>
              </div>
            </div>
          </section>

          {/* About */}
          <section>
            <h2 className="text-sm font-semibold mb-3">About</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Version</span>
                <span className="text-sm text-[var(--app-hint)]">0.6.1</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Platform</span>
                <span className="text-sm text-[var(--app-hint)]">React 19</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
