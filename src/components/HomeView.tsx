import { createMemo, For, type Component } from "solid-js";
import { FiPlus, FiServer, FiActivity, FiMessageSquare } from "solid-icons/fi";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import { t } from "../stores/i18nStore";

export const HomeView: Component = () => {
  const sessions = createMemo(() => sessionStore.getSessions());
  const activeSessionId = createMemo(() => sessionStore.state.activeSessionId);

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
    <div class="flex h-full flex-col overflow-y-auto bg-background p-4 sm:p-8">
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
              {t("home.welcomeTitle")}
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {t("home.welcomeDescription")}
            </p>
          </div>
        </header>

        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("home.quickActions")}
          </h2>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <button
              class="group flex flex-col items-start gap-3 rounded-2xl border border-border/50 bg-base-200 p-5 text-left transition-all hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm"
              onClick={() => sessionStore.openNewSessionModal()}
            >
              <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FiPlus size={20} />
              </div>
              <div>
                <h3 class="font-medium text-foreground group-hover:text-primary">
                  {t("home.startNewSession")}
                </h3>
                <p class="mt-1 text-xs text-muted-foreground">
                  {t("home.startNewSessionDesc")}
                </p>
              </div>
            </button>

            <button
              class="group flex flex-col items-start gap-3 rounded-2xl border border-border/50 bg-base-200 p-5 text-left transition-all hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm"
              onClick={() => navigationStore.setActiveView("devices")}
            >
              <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FiServer size={20} />
              </div>
              <div>
                <h3 class="font-medium text-foreground group-hover:text-primary">
                  {t("home.connectToHost")}
                </h3>
                <p class="mt-1 text-xs text-muted-foreground">
                  {t("home.connectToHostDesc")}
                </p>
              </div>
            </button>
          </div>
        </section>

        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t("home.recentSessions")}
          </h2>
          <div class="rounded-2xl border border-border/50 bg-base-200 overflow-hidden">
            {getRecentSessions().length === 0 ? (
              <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <FiActivity size={24} class="text-muted-foreground" />
                </div>
                <h3 class="text-sm font-medium text-foreground">
                  {t("home.noRecentSessions")}
                </h3>
                <p class="mt-1 text-xs text-muted-foreground">
                  {t("home.noRecentSessionsDesc")}
                </p>
              </div>
            ) : (
              <div class="divide-y divide-border/50">
                <For each={getRecentSessions()}>
                  {(session) => {
                    const isActive = activeSessionId() === session.sessionId;
                    return (
                      <div class="flex items-center justify-between p-4 transition-colors hover:bg-muted/30">
                        <div class="flex items-center gap-4 min-w-0">
                          <div
                            class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                          >
                            <FiMessageSquare size={18} />
                          </div>
                          <div class="min-w-0 flex-1">
                            <p class="truncate font-medium text-sm text-foreground">
                              {session.projectPath.split("/").pop() ||
                                t("common.unknownProject")}
                            </p>
                            <p class="truncate text-xs text-muted-foreground">
                              {session.agentType} •{" "}
                              {session.mode === "local"
                                ? t("common.local")
                                : t("common.remote")}
                            </p>
                          </div>
                        </div>
                        <div class="flex items-center gap-3 shrink-0">
                          <span
                            class={`h-2.5 w-2.5 rounded-full ${session.active ? "bg-green-500" : "bg-muted-foreground/30"}`}
                            title={
                              session.active
                                ? t("devices.active")
                                : t("common.close")
                            }
                          />
                          <button
                            class="btn btn-ghost btn-sm text-xs rounded-lg hidden sm:inline-flex"
                            onClick={() =>
                              handleResumeSession(session.sessionId)
                            }
                          >
                            {t("home.resume")}
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
