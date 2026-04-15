import { createSignal, createMemo, For, Show, type Component } from "solid-js";
import {
  FiServer,
  FiPlus,
  FiTrash2,
  FiWifi,
  FiGlobe,
  FiTerminal,
} from "solid-icons/fi";
import { sessionStore } from "../stores/sessionStore";
import { getTicketHistory, clearStoredTickets } from "../utils/localStorage";
import { getTicketDisplayId } from "../utils/ticketParser";
import { notificationStore } from "../stores/notificationStore";
import { navigationStore } from "../stores/navigationStore";
import { t } from "../stores/i18nStore";

export const DevicesView: Component = () => {
  const [history, setHistory] = createSignal(getTicketHistory());
  const [ticketInput, setTicketInput] = createSignal("");
  const [isConnecting, setIsConnecting] = createSignal(false);

  const connectedHosts = createMemo(() => sessionStore.getConnectedHosts());

  const handleConnect = async (ticket: string) => {
    if (!ticket) return;
    setIsConnecting(true);
    sessionStore.setSessionTicket(ticket);
    try {
      await sessionStore.handleRemoteConnect();
      notificationStore.success("Connected to host", "Success");
      setHistory(getTicketHistory());
      setTicketInput("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notificationStore.error(`Connection failed: ${msg}`, "Error");
    } finally {
      setIsConnecting(false);
    }
  };

  const handleClearHistory = () => {
    clearStoredTickets();
    setHistory([]);
    notificationStore.info("History cleared", "Info");
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
            <h1 class="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t("devices.title")}</h1>
            <p class="mt-1 text-sm text-muted-foreground">{t("devices.desc")}</p>
          </div>
        </header>

        {/* Local Daemon Status */}
        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("devices.localEnv")}</h2>
          <div class="flex items-center justify-between rounded-2xl border border-border/50 bg-base-200 p-4 sm:p-5">
            <div class="flex items-center gap-4">
              <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <FiTerminal size={24} />
              </div>
              <div>
                <h3 class="font-semibold text-foreground">{t("devices.localDaemon")}</h3>
                <div class="flex items-center gap-2 mt-1">
                  <span class="h-2.5 w-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                  <span class="text-sm text-muted-foreground font-medium">{t("devices.running")}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Add New Connection */}
        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("devices.addNew")}</h2>
          <div class="rounded-2xl border border-border/50 bg-base-200 p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-end">
            <div class="flex-1 space-y-2">
              <label class="text-sm font-medium text-foreground">{t("devices.sessionTicket")}</label>
              <input
                type="text"
                class="w-full rounded-xl border border-border/50 bg-background px-4 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                placeholder={t("devices.ticketPlaceholder")}
                value={ticketInput()}
                onInput={(e) => setTicketInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect(ticketInput());
                }}
              />
            </div>
            <button
              class="btn btn-primary rounded-xl px-6 py-2.5 min-w-[120px]"
              disabled={!ticketInput() || isConnecting()}
              onClick={() => handleConnect(ticketInput())}
            >
              {isConnecting() ? (
                <span class="loading loading-spinner loading-sm" />
              ) : (
                <>
                  <FiPlus size={18} class="mr-2" />{t("action.connect")}</>
              )}
            </button>
          </div>
        </section>

        {/* Active Remote Hosts */}
        <section>
          <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("devices.activeHosts")}</h2>
          <div class="rounded-2xl border border-border/50 bg-base-200 overflow-hidden">
            <Show
              when={connectedHosts().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <FiServer size={24} class="text-muted-foreground/60" />
                  </div>
                  <p class="text-sm text-muted-foreground font-medium">{t("devices.noActiveHosts")}</p>
                </div>
              }
            >
              <div class="divide-y divide-border/50">
                <For each={connectedHosts()}>
                  {(host) => (
                    <div class="flex items-center justify-between p-4 sm:p-5 transition-colors hover:bg-muted/30">
                      <div class="flex items-center gap-4">
                        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                          <FiGlobe size={20} />
                        </div>
                        <div>
                          <h3 class="font-medium text-sm text-foreground">
                            {host.hostname}
                          </h3>
                          <p class="mt-0.5 text-xs text-muted-foreground font-mono">
                            ID: {host.controlSessionId.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                      <div class="flex items-center gap-3">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 text-green-500 text-xs font-semibold border border-green-500/20">
                          <span class="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />{t("devices.connected")}</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </section>

        {/* Saved Tickets History */}
        <Show when={history().length > 0}>
          <section>
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("devices.savedDevices")}</h2>
              <button
                class="btn btn-ghost btn-xs text-error hover:bg-error/10 rounded-lg gap-1.5"
                onClick={handleClearHistory}
              >
                <FiTrash2 size={12} />\n                <FiTrash2 size={12} />\n                {t("devices.clear")}\n              </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <For each={history()}>
                {(ticket) => {
                  const isActive = connectedHosts().some((h) =>
                    ticket.includes(h.controlSessionId),
                  );
                  return (
                    <div class="group flex flex-col gap-3 rounded-2xl border border-border/50 bg-base-200 p-4 transition-all hover:border-primary/30">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <FiWifi size={16} />
                          </div>
                          <div>
                            <p class="font-medium text-sm text-foreground">
                              Machine {getTicketDisplayId(ticket)}
                            </p>
                            <p class="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">
                              {ticket}
                            </p>
                          </div>
                        </div>
                        <Show when={!isActive}>
                          <button
                            class="btn btn-outline btn-sm rounded-xl h-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleConnect(ticket)}
                          >{t("action.connect")}</button>
                        </Show>
                        <Show when={isActive}>
                          <span class="text-xs font-semibold text-green-500">{t("devices.active")}</span>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </section>
        </Show>
      </div>
    </div>
  );
};
