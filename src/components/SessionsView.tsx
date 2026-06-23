/**
 * SessionsView Component
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

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
    <div class="flex h-full flex-col overflow-y-auto bg-base-100 p-4 sm:p-6 lg:p-8">
      <div class="mx-auto w-full max-w-6xl space-y-6">
        <header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-start sm:items-center gap-3">
            <button
              type="button"
              class="btn btn-ghost btn-square md:hidden btn-sm"
              onClick={() => navigationStore.setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <svg
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" />
              </svg>
            </button>
            <div>
              <h1 class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl">
                {t("sessionsView.title")}
              </h1>
              <p class="mt-1 text-sm text-base-content/50">
                {t("sessionsView.desc")}
              </p>
            </div>
          </div>
          <button
            class="btn btn-outline btn-sm"
            onClick={() => sessionStore.openNewSessionModal()}
          >
            <FiPlus size={16} />
            {t("sessionsView.startNew")}
          </button>
        </header>

        <div class="card card-bordered bg-base-100 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between p-2">
          <div class="flex items-center gap-1 overflow-x-auto">
            {(["all", "active", "local", "remote"] as const).map((f) => (
              <button
                class={`px-4 py-1.5 text-sm font-medium whitespace-nowrap rounded-lg transition-colors duration-150 ${
                  filter() === f
                    ? "bg-primary text-primary-content"
                    : "text-base-content/50 hover:text-base-content hover:bg-base-200/50"
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
              class="absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40 sm:left-3"
              size={16}
            />
            <input
              type="text"
              placeholder={t("sessionsView.searchPlaceholder")}
              class="input input-bordered w-full pl-10 pr-4 text-sm"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>
        </div>

        {/* Sessions List */}
        <div class="card card-bordered bg-base-100">
          <Show
            when={sessions().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-20 px-4 text-center">
                <div class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-base-200/60 text-base-content/30 shadow-sm">
                  <FiActivity size={32} />
                </div>
                <h3 class="text-base font-semibold text-base-content mb-1">
                  {t("sessionsView.noSessions")}
                </h3>
                <p class="max-w-xs text-sm text-base-content/50">
                  {searchQuery() || filter() !== "all"
                    ? t("sessionsView.noSessionsDesc")
                    : t("home.noRecentSessionsDesc")}
                </p>
                <Show when={!searchQuery() && filter() === "all"}>
                  <button
                    class="btn btn-primary btn-sm mt-5"
                    onClick={() => sessionStore.openNewSessionModal()}
                  >
                    <FiPlus size={15} />
                    {t("sessionsView.startNew")}
                  </button>
                </Show>
              </div>
            }
          >
            <div>
              <For each={sessions()}>
                {(session) => {
                  const isActive = activeSessionId() === session.sessionId;
                  return (
                    <div
                      class="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b border-base-content/10 last:border-b-0 cursor-pointer hover:bg-base-200/30 transition-colors duration-150"
                      onClick={() => handleResumeSession(session.sessionId)}
                    >
                      <div class="flex items-start sm:items-center gap-4 min-w-0">
                        <div
                          class={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${
                            isActive
                              ? "bg-primary text-primary-content border-base-content"
                              : "bg-base-100 text-base-content/40 border-base-content/10"
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
                            <h3 class="truncate font-semibold text-base text-base-content">
                              {session.projectPath.split("/").pop() ||
                                t("common.unknownProject")}
                            </h3>
                            <Show when={session.active}>
                              <span
                                class="h-2 w-2 bg-success"
                                title={t("devices.active")}
                              />
                            </Show>
                          </div>
                          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-base-content/50">
                            <span class="inline-flex items-center gap-1.5 font-medium">
                              <span class="capitalize">
                                {session.agentType}
                              </span>
                            </span>
                            <span class="text-base-content/30">•</span>
                            <span class="badge badge-outline badge-sm font-mono">
                              {session.mode === "local"
                                ? t("common.local")
                                : `${t("common.remote")}: ${session.hostname || session.controlSessionId?.slice(0, 8)}`}
                            </span>
                            <span class="text-base-content/30 hidden sm:inline">
                              •
                            </span>
                            <span class="hidden sm:inline">
                              {new Date(session.startedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center gap-2 shrink-0 ml-16 sm:ml-0 mt-4 sm:mt-0">
                        <button
                          class={`border px-3 py-1.5 text-sm font-medium ${
                            isActive
                              ? "bg-primary text-primary-content border-base-content"
                              : "border-base-content/10 hover:bg-base-200"
                          }`}
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
                            class="btn btn-ghost btn-square btn-xs text-base-content/40 hover:text-error"
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
