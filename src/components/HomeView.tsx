/**
 * HomeView Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import { createMemo, For, type Component } from "solid-js";
import { FiServer, FiActivity } from "solid-icons/fi";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import { t } from "../stores/i18nStore";
import { cn } from "~/lib/utils";

export const HomeView: Component = () => {
  const sessions = createMemo(() => sessionStore.getSessions());

  const getRecentSessions = () => {
    return [...sessions()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5);
  };

  const handleResumeSession = (sessionId: string) => {
    sessionStore.setActiveSession(sessionId);
    navigationStore.setActiveView("workspace");
  };

  return (
    <div class="flex h-full flex-col bg-base-100">
      <header class="flex items-center gap-4 px-6 py-5 border-b border-base-content/10">
        <button
          type="button"
          class="text-base-content/50 hover:text-base-content md:hidden"
          onClick={() => navigationStore.setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
          </svg>
        </button>
        <div>
          <h1 class="text-xl font-bold text-base-content">
            {t("home.welcomeTitle")}
          </h1>
          <p class="text-sm text-base-content/50">
            {t("home.welcomeDescription")}
          </p>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-6">
        <div class="max-w-2xl mx-auto space-y-8">
          {/* Quick Actions */}
          <section>
            <h2 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest mb-3">
              {t("home.quickActions")}
            </h2>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="card card-bordered bg-base-100 flex-row items-center gap-3 p-4 text-left hover:bg-base-200/50 hover:border-base-content/30 transition-all duration-150"
                onClick={() => sessionStore.openNewSessionModal()}
              >
                <span class="text-base-content/40">+</span>
                <div>
                  <div class="text-sm font-medium text-base-content">
                    {t("home.startNewSession")}
                  </div>
                  <div class="text-xs text-base-content/50">
                    {t("home.startNewSessionDesc")}
                  </div>
                </div>
              </button>
              <button
                class="card card-bordered bg-base-100 flex-row items-center gap-3 p-4 text-left hover:bg-base-200/50 hover:border-base-content/30 transition-all duration-150"
                onClick={() => navigationStore.setActiveView("devices")}
              >
                <FiServer size={16} class="text-base-content/40" />
                <div>
                  <div class="text-sm font-medium text-base-content">
                    {t("home.connectToHost")}
                  </div>
                  <div class="text-xs text-base-content/50">
                    {t("home.connectToHostDesc")}
                  </div>
                </div>
              </button>
            </div>
          </section>

          {/* Recent Sessions */}
          <section>
            <h2 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest mb-3">
              {t("home.recentSessions")}
            </h2>
            <div class="card card-bordered bg-base-100">
              {getRecentSessions().length === 0 ? (
                <div class="py-12 text-center">
                  <FiActivity size={24} class="text-base-content/20 mx-auto mb-2" />
                  <p class="text-sm text-base-content/50">{t("home.noRecentSessions")}</p>
                </div>
              ) : (
                <For each={getRecentSessions()}>
                  {(session) => (
                    <div class="flex items-center justify-between px-4 py-3 border-b border-base-content/5 last:border-b-0 hover:bg-base-200/50 transition-colors duration-150">
                      <div class="flex items-center gap-3 min-w-0">
                        <span
                          class={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            session.active ? "bg-success" : "bg-base-content/20",
                          )}
                        />
                        <div class="min-w-0">
                          <div class="text-sm font-medium text-base-content truncate">
                            {session.projectPath.split("/").pop() || t("common.unknownProject")}
                          </div>
                          <div class="text-xs text-base-content/50">
                            {session.agentType} &middot; {session.mode === "local" ? t("common.local") : t("common.remote")}
                          </div>
                        </div>
                      </div>
                      <button
                        class="btn btn-ghost btn-xs text-base-content/50 hover:text-base-content"
                        onClick={() => handleResumeSession(session.sessionId)}
                      >
                        {t("home.resume")}
                      </button>
                    </div>
                  )}
                </For>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};