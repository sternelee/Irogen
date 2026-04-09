import { Component, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { 
  FiGlobe, 
  FiPlus, 
  FiTrash2, 
  FiRefreshCw, 
  FiExternalLink,
  FiActivity,
  FiX,
  FiChevronLeft
} from "solid-icons/fi";
import { 
  tcpForwardingStore, 
  TcpForwardingSession 
} from "../stores/tcpForwardingStore";
import { Button, Label, Input } from "./ui/primitives";
import { i18nStore } from "../stores/i18nStore";
import { HapticFeedback } from "../utils/mobile";
import { notificationStore } from "../stores/notificationStore";

interface TcpForwardingModalProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const TcpForwardingModal: Component<TcpForwardingModalProps> = (props) => {
  const { t } = i18nStore;
  const [localAddr, setLocalAddr] = createSignal("127.0.0.1:3000");
  const [remoteAddr, setRemoteAddr] = createSignal("127.0.0.1:3000");
  const [isAdding, setIsAdding] = createSignal(false);

  let unlisten: (() => void) | undefined;

  onMount(async () => {
    if (props.sessionId) {
      unlisten = await tcpForwardingStore.init(props.sessionId);
    }
  });

  onCleanup(() => {
    if (unlisten) unlisten();
  });

  const sessions = () => (props.sessionId ? tcpForwardingStore.state.sessions[props.sessionId] || [] : []);

  const handleCreate = async () => {
    if (!props.sessionId) return;
    try {
      const addr = remoteAddr().trim();
      const lastColonIndex = addr.lastIndexOf(':');
      
      if (lastColonIndex === -1) {
        notificationStore.error("Remote address must include a port (e.g., 127.0.0.1:3000)", "Format Error");
        return;
      }

      const host = addr.substring(0, lastColonIndex);
      const portStr = addr.substring(lastColonIndex + 1);
      const port = parseInt(portStr);

      if (isNaN(port) || port <= 0 || port > 65535) {
        notificationStore.error("Invalid port number", "Format Error");
        return;
      }

      HapticFeedback.medium();
      await tcpForwardingStore.createSession(
        props.sessionId,
        localAddr(),
        host || "127.0.0.1",
        port
      );
      setIsAdding(false);
    } catch (err) {
      // Error handled in store
    }
  };

  const handleStop = async (tcpSessionId: string) => {
    if (!props.sessionId) return;
    HapticFeedback.warning();
    await tcpForwardingStore.stopSession(props.sessionId, tcpSessionId);
  };

  const handleRefresh = () => {
    if (!props.sessionId) return;
    HapticFeedback.light();
    tcpForwardingStore.listSessions(props.sessionId);
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex flex-col bg-base-100 animate-in fade-in slide-in-from-right duration-200">
        {/* Header */}
        <header class="navbar px-4 pt-safe shrink-0 border-b border-base-content/5 bg-base-100/80 backdrop-blur-md sticky top-0 z-10">
          <div class="flex-none">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                HapticFeedback.light();
                props.onClose();
              }}
              class="rounded-full text-base-content/60 hover:text-base-content"
            >
              <FiChevronLeft size={24} />
            </Button>
          </div>
          <div class="flex-1 px-2">
            <h1 class="text-lg font-bold tracking-tight">{t("tcpForwarding.title")}</h1>
          </div>
          <div class="flex-none gap-1">
            <Button variant="ghost" size="icon" onClick={handleRefresh} title={t("tcpForwarding.refresh")} class="rounded-full h-10 w-10">
              <FiRefreshCw size={18} class={tcpForwardingStore.state.loading ? "animate-spin" : "opacity-60"} />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => {
                HapticFeedback.light();
                setIsAdding(!isAdding());
              }}
              class={`rounded-full h-10 w-10 ${isAdding() ? 'text-primary bg-primary/10' : 'text-base-content/60'}`}
            >
              <Show when={isAdding()} fallback={<FiPlus size={20} />}>
                <FiX size={20} />
              </Show>
            </Button>
          </div>
        </header>

        {/* Content Area */}
        <div class="flex-1 overflow-y-auto px-4 py-6 pb-safe">
          <div class="max-w-2xl mx-auto w-full">
            <Show when={isAdding()}>
              <div class="bg-base-200/50 p-5 rounded-2xl mb-8 border border-base-content/5 animate-in zoom-in-95 fade-in duration-200 shadow-sm">
                <div class="flex items-center gap-2 mb-6">
                  <div class="bg-primary/10 p-2 rounded-lg text-primary">
                    <FiPlus size={18} />
                  </div>
                  <h4 class="font-bold">{t("tcpForwarding.createNew")}</h4>
                </div>
                
                <div class="space-y-5 mb-6">
                  <div class="space-y-2">
                    <Label class="text-xs uppercase tracking-widest font-black opacity-40">{t("tcpForwarding.localAddr")}</Label>
                    <Input 
                      value={localAddr()} 
                      onInput={(e) => setLocalAddr(e.currentTarget.value)}
                      placeholder="127.0.0.1:3000"
                      class="bg-base-100 border-base-content/10 focus:border-primary/30"
                    />
                    <p class="text-[10px] opacity-40 italic">{t("tcpForwarding.localAddrDesc")}</p>
                  </div>
                  
                  <div class="space-y-2">
                    <Label class="text-xs uppercase tracking-widest font-black opacity-40">Remote Address (Host:Port)</Label>
                    <Input 
                      value={remoteAddr()} 
                      onInput={(e) => setRemoteAddr(e.currentTarget.value)}
                      placeholder="127.0.0.1:3000"
                      class="bg-base-100 border-base-content/10 focus:border-primary/30"
                    />
                    <p class="text-[10px] opacity-40 italic">Address and port on the remote CLI (e.g., localhost:8080)</p>
                  </div>
                </div>
                
                <div class="flex justify-end gap-3">
                  <Button variant="ghost" onClick={() => setIsAdding(false)}>{t("tcpForwarding.cancel")}</Button>
                  <Button variant="primary" class="px-6 rounded-xl font-bold" onClick={handleCreate} disabled={tcpForwardingStore.state.loading}>
                    <Show when={tcpForwardingStore.state.loading} fallback={t("tcpForwarding.create")}>
                      <span class="loading loading-spinner loading-xs" />
                    </Show>
                  </Button>
                </div>
              </div>
            </Show>

            <div class="space-y-4">
              <Show when={sessions().length === 0 && !isAdding()}>
                <div class="py-20 flex flex-col items-center justify-center text-center px-6">
                  <div class="w-20 h-20 rounded-full bg-base-200 flex items-center justify-center mb-6 border border-base-content/5 shadow-inner">
                    <FiGlobe size={32} class="opacity-20" />
                  </div>
                  <h3 class="text-lg font-bold opacity-40">{t("tcpForwarding.noSessions")}</h3>
                  <p class="text-sm opacity-30 mt-2 max-w-xs">{t("tcpForwarding.noSessionsDesc")}</p>
                  <Button variant="primary" class="mt-8 rounded-xl px-6" onClick={() => setIsAdding(true)}>
                    <FiPlus size={18} class="mr-2" />
                    {t("tcpForwarding.addPort")}
                  </Button>
                </div>
              </Show>

              <Show when={sessions().length > 0}>
                <div class="px-1 pb-2 flex items-center justify-between">
                  <span class="text-[10px] font-black uppercase tracking-[0.2em] opacity-30">Active Sessions</span>
                  <span class="badge badge-sm badge-ghost opacity-50 font-bold">{sessions().length}</span>
                </div>
                
                <For each={sessions()}>
                  {(session) => (
                    <div class="flex items-center justify-between p-5 bg-base-200/30 border border-base-content/5 rounded-2xl hover:bg-base-200/50 transition-all group">
                      <div class="flex items-center gap-4 min-w-0">
                        <div class={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center shadow-sm ${
                          session.status === 'running' ? 'bg-success/10 text-success ring-1 ring-success/20' : 'bg-warning/10 text-warning ring-1 ring-warning/20'
                        }`}>
                          <FiActivity size={24} class={session.status === 'running' ? 'animate-pulse' : ''} />
                        </div>
                        <div class="min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-black text-sm tracking-tight">{session.local_addr}</span>
                            <span class="text-base-content/20 text-xs">→</span>
                            <span class="text-xs font-medium opacity-50 truncate">{session.remote_host}:{session.remote_port}</span>
                          </div>
                          <div class="flex items-center gap-2 mt-1.5">
                            <span class={`text-[9px] uppercase font-black px-2 py-0.5 rounded-md ${
                              session.status === 'running' ? 'bg-success/20 text-success' : 'bg-base-300 text-base-content/40'
                            }`}>
                              {t(`tcpForwarding.status.${session.status}` as any)}
                            </span>
                            <Show when={session.status === 'running'}>
                              <a 
                                href={`http://${session.local_addr.startsWith(':') ? '127.0.0.1' + session.local_addr : session.local_addr}`} 
                                target="_blank" 
                                class="text-[10px] font-bold text-primary hover:underline flex items-center gap-1 ml-2 active:scale-95 transition-transform"
                              >
                                {t("tcpForwarding.openInBrowser")} <FiExternalLink size={10} />
                              </a>
                            </Show>
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1 pl-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          class="text-error/40 hover:text-error hover:bg-error/10 rounded-full h-10 w-10"
                          onClick={() => handleStop(session.id)}
                        >
                          <FiTrash2 size={18} />
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
