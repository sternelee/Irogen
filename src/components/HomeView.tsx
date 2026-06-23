/**
 * HomeView Component (unified: dashboard + devices)
 *
 * Sections:
 *   - Quick Actions
 *   - Recent Sessions
 *   - Local Daemon Status
 *   - Add New Connection (ticket input)
 *   - Active Remote Hosts
 *   - Saved Tickets History
 *
 * Zed-inspired: hard lines, high contrast, no gradients/shadows/animations.
 */

import {
  createMemo,
  createSignal,
  For,
  Show,
  type Component,
} from "solid-js";
import {
  FiServer,
  FiPlus,
  FiTrash2,
  FiWifi,
  FiGlobe,
  FiTerminal,
} from "solid-icons/fi";
import { sessionStore } from "../stores/sessionStore";
import { navigationStore } from "../stores/navigationStore";
import { notificationStore } from "../stores/notificationStore";
import {
  getTicketHistory,
  clearStoredTickets,
} from "../utils/localStorage";
import { getTicketDisplayId } from "../utils/ticketParser";
import { t } from "../stores/i18nStore";

export const HomeView: Component = () => {
  // Devices / tickets
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
          <h1 class="text-2xl font-bold tracking-tight text-base-content sm:text-3xl">
            {t("devices.localDaemon")}
          </h1>
          <div class="mt-1 flex items-center gap-2">
            <span class="h-2 w-2 rounded-full bg-success" />
            <span class="text-sm text-base-content/50 font-medium">{t("devices.running")}</span>
          </div>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div class="max-w-5xl mx-auto space-y-8">
          {/* Quick Actions */}
          <section>
            <h2 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest mb-3">
              {t("home.quickActions")}
            </h2>
            <div class="grid grid-cols-1 gap-2">
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
            </div>
          </section>

          {/* Local Daemon Status (compact summary, since title is the hero) */}
          <section class="hidden">
            <h2 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest mb-3">
              {t("devices.localEnv")}
            </h2>
            <div class="card card-bordered bg-base-100 flex-row items-center justify-between p-4 sm:p-5">
              <div class="flex items-center gap-4">
                <div class="flex h-12 w-12 items-center justify-center rounded-xl border border-base-content/10 text-base-content/40">
                  <FiTerminal size={24} />
                </div>
                <div>
                  <h3 class="font-semibold text-base-content">{t("devices.localDaemon")}</h3>
                  <div class="flex items-center gap-2 mt-1">
                    <span class="h-2.5 w-2.5 rounded-full bg-success" />
                    <span class="text-sm text-base-content/50 font-medium">{t("devices.running")}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Add New Connection */}
          <section>
            <h2 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest mb-3">
              {t("devices.addNew")}
            </h2>
            <div class="card card-bordered bg-base-100 p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-end">
              <div class="flex-1 space-y-2">
                <label class="text-sm font-medium text-base-content">{t("devices.sessionTicket")}</label>
                <input
                  id="ticket-input"
                  type="text"
                  class="input input-bordered w-full font-mono text-sm"
                  placeholder={t("devices.ticketPlaceholder")}
                  value={ticketInput()}
                  onInput={(e) => setTicketInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConnect(ticketInput());
                  }}
                />
              </div>
              <button
                class="btn btn-outline min-w-[120px]"
                disabled={!ticketInput() || isConnecting()}
                onClick={() => handleConnect(ticketInput())}
              >
                {isConnecting() ? (
                  <span class="inline-block w-4 h-4 border-2 border-base-content/30 border-t-base-content/60" />
                ) : (
                  <>
                    <FiPlus size={18} class="inline mr-2" />{t("action.connect")}
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Active Remote Hosts */}
          <section>
            <h2 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest mb-3">
              {t("devices.activeHosts")}
            </h2>
            <div class="card card-bordered bg-base-100">
              <Show
                when={connectedHosts().length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
                    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-base-200/60 text-base-content/30 shadow-sm">
                      <FiServer size={28} />
                    </div>
                    <p class="text-sm text-base-content/60 font-medium">{t("devices.noActiveHosts")}</p>
                    <p class="text-xs text-base-content/40 mt-1 max-w-xs">
                      {t("devices.noActiveHostsDesc")}
                    </p>
                  </div>
                }
              >
                <For each={connectedHosts()}>
                  {(host) => (
                    <div class="flex items-center justify-between p-4 sm:p-5 border-b border-base-content/10 last:border-b-0 hover:bg-base-200/30 transition-colors duration-150">
                      <div class="flex items-center gap-4">
                        <div class="flex h-10 w-10 items-center justify-center rounded-xl border border-base-content/10 text-base-content/40">
                          <FiGlobe size={20} />
                        </div>
                        <div>
                          <h3 class="font-medium text-sm text-base-content">
                            {host.hostname}
                          </h3>
                          <p class="mt-0.5 text-xs text-base-content/50 font-mono">
                            ID: {host.controlSessionId.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                      <div class="flex items-center gap-3">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-success border border-success/20">
                          <span class="h-1.5 w-1.5 rounded-full bg-success" />{t("devices.connected")}</span>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </section>

          {/* Saved Tickets History */}
          <Show when={history().length > 0}>
            <section>
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-[10px] font-semibold text-base-content/40 uppercase tracking-widest">
                  {t("devices.savedDevices")}
                </h2>
                <button
                  class="text-xs text-error border border-error/20 px-3 py-1.5 rounded-lg hover:bg-error hover:text-error-content transition-all duration-150"
                  onClick={handleClearHistory}
                >
                  <FiTrash2 size={12} class="inline mr-1" />
                  {t("devices.clear")}
                </button>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <For each={history()}>
                  {(ticket) => {
                    const isActive = connectedHosts().some((h) =>
                      ticket.includes(h.controlSessionId),
                    );
                    return (
                      <div class="card card-bordered bg-base-100 gap-3 p-4">
                        <div class="flex items-center justify-between">
                          <div class="flex items-center gap-3">
                            <div class="flex h-8 w-8 items-center justify-center rounded-lg border border-base-content/10 text-base-content/40">
                              <FiWifi size={16} />
                            </div>
                            <div>
                              <p class="font-medium text-sm text-base-content">
                                Machine {getTicketDisplayId(ticket)}
                              </p>
                              <p class="text-[10px] text-base-content/50 font-mono truncate max-w-[120px]">
                                {ticket}
                              </p>
                            </div>
                          </div>
                          <Show
                            when={!isActive}
                            fallback={<span class="text-xs font-semibold text-success">{t("devices.active")}</span>}
                          >
                            <button
                              class="btn btn-outline btn-xs font-medium"
                              onClick={() => handleConnect(ticket)}
                            >{t("action.connect")}</button>
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
    </div>
  );
};