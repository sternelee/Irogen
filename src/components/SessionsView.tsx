import { createSignal, createMemo, For, Show, type Component } from "solid-js";
import {
  FiActivity,
  FiServer,
  FiHome,
  FiSearch,
  FiPlus,
  FiX,
} from "solid-icons/fi";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import { t } from "../stores/i18nStore";

export const SessionsView: Component = () => {
  const [filter, setFilter] = createSignal<
    "all" | "active" | "local" | "remote"
  >("all");
  const [searchQuery, setSearchQuery] = createSignal("");

  const sessions = createMemo(() => {
    let list = sessionStore.getSessions();

    if (filter() === "active") {
      list = list.filter((s) => s.active);
    } else if (filter() === "local") {
      list = list.filter((s) => s.mode === "local");
    } else if (filter() === "remote") {
      list = list.filter((s) => s.mode === "remote");
    }

    const query = searchQuery().toLowerCase().trim();
    if (query) {
      list = list.filter(
        (s) =>
          s.projectPath.toLowerCase().includes(query) ||
          s.agentType.toLowerCase().includes(query) ||
          s.hostname?.toLowerCase().includes(query),
      );
    }

    return list.sort((a, b) => b.startedAt - a.startedAt);
  });

  const activeSessionId = createMemo(() => sessionStore.state.activeSessionId);

  const handleResumeSession = (sessionId: string) => {
    sessionStore.setActiveSession(sessionId);
    navigationStore.setActiveView("workspace");
  };

  const handleDeleteSession = (e: MouseEvent, sessionId: string) => {
    e.stopPropagation();
    sessionStore.removeSession(sessionId);
  };

  return (
    <div class="flex h-full flex-col overflow-y-auto bg-background p-4 sm:p-8">
      <div class="mx-auto w-full max-w-4xl space-y-6">
        <header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-start sm:items-center gap-3">
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
                {t("sessionsView.title")}
              </h1>
              <p class="mt-1 text-sm text-muted-foreground">
                {t("sessionsView.desc")}
              </p>
            </div>
          </div>
          <button
            class="btn btn-primary btn-sm rounded-xl gap-2"
            onClick={() => sessionStore.openNewSessionModal()}
          >
            <FiPlus size={16} />
            {t("sessionsView.startNew")}
          </button>
        </header>

        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-base-200 p-2 rounded-2xl border border-border/50">
          <div class="flex items-center gap-1 p-1 bg-background rounded-xl overflow-x-auto">
            {(["all", "active", "local", "remote"] as const).map((f) => (
              <button
                class={`px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  filter() === f
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                onClick={() => setFilter(f)}
              >
                {t(
                  `sessionsView.filter${f.charAt(0).toUpperCase()}${f.slice(1)}` as any,
                )}
              </button>
            ))}
          </div>

          <div class="relative max-w-xs w-full px-2 pb-2 sm:p-0">
            <FiSearch
              class="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground sm:left-3"
              size={16}
            />
            <input
              type="text"
              placeholder={t("sessionsView.searchPlaceholder")}
              class="w-full rounded-xl border border-border/50 bg-background py-2 pl-10 pr-4 text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>
        </div>

        {/* Sessions List */}
        <div class="rounded-2xl border border-border/50 bg-base-200 overflow-hidden">
          <Show
            when={sessions().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <FiActivity size={28} class="text-muted-foreground/60" />
                </div>
                <h3 class="text-base font-semibold text-foreground">
                  {t("sessionsView.noSessions")}
                </h3>
                <p class="mt-1 max-w-xs text-sm text-muted-foreground">
                  {searchQuery() || filter() !== "all"
                    ? t("sessionsView.noSessionsDesc")
                    : t("home.noRecentSessionsDesc")}
                </p>
              </div>
            }
          >
            <div class="divide-y divide-border/50">
              <For each={sessions()}>
                {(session) => {
                  const isActive = activeSessionId() === session.sessionId;
                  return (
                    <div
                      class="group flex flex-col sm:flex-row sm:items-center justify-between p-4 transition-colors hover:bg-muted/30 cursor-pointer gap-4"
                      onClick={() => handleResumeSession(session.sessionId)}
                    >
                      <div class="flex items-start sm:items-center gap-4 min-w-0">
                        <div
                          class={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
                            isActive
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "bg-background text-muted-foreground border-border/50"
                          }`}
                        >
                          <Show
                            when={session.mode === "local"}
                            fallback={<FiServer size={20} />}
                          >
                            <FiHome size={20} />
                          </Show>
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2">
                            <h3 class="truncate font-semibold text-base text-foreground">
                              {session.projectPath.split("/").pop() ||
                                t("common.unknownProject")}
                            </h3>
                            <Show when={session.active}>
                              <span
                                class="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                                title={t("devices.active")}
                              />
                            </Show>
                          </div>
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                            <span class="inline-flex items-center gap-1.5 font-medium">
                              <span class="capitalize">
                                {session.agentType}
                              </span>
                            </span>
                            <span class="text-muted-foreground/40">•</span>
                            <span class="truncate font-mono text-[11px] bg-background px-1.5 py-0.5 rounded border border-border/50">
                              {session.mode === "local"
                                ? t("common.local")
                                : `${t("common.remote")}: ${session.hostname || session.controlSessionId?.slice(0, 8)}`}
                            </span>
                            <span class="text-muted-foreground/40 hidden sm:inline">
                              •
                            </span>
                            <span class="hidden sm:inline">
                              {new Date(session.startedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center gap-2 shrink-0 ml-16 sm:ml-0">
                        <button
                          class={`btn btn-sm rounded-xl ${isActive ? "btn-primary" : "btn-ghost border border-border/50 bg-background hover:border-primary/30"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResumeSession(session.sessionId);
                          }}
                        >
                          {isActive
                            ? t("sessionsView.current")
                            : t("sessionsView.resume")}
                        </button>
                        <Show when={session.active}>
                          <button
                            class="btn btn-ghost btn-sm btn-square rounded-xl text-error hover:bg-error/10"
                            onClick={(e) =>
                              handleDeleteSession(e, session.sessionId)
                            }
                            title={t("sidebar.closeSession")}
                          >
                            <FiX size={16} />
                          </button>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
