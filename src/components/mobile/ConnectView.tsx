import { Component, createSignal, For, Show } from "solid-js";
import {
  Terminal,
  Settings,
  RefreshCw,
  Plus,
  Scan,
  Lightbulb,
  Trash2,
  ChevronRight,
} from "lucide-solid";
import { getTicketHistory, clearStoredTickets } from "../../utils/localStorage";
import { getTicketDisplayId } from "../../utils/ticketParser";
import { HapticFeedback } from "../../utils/mobile";
import { Button } from "../ui/primitives";

interface ConnectViewProps {
  onConnect: (ticket: string) => void;
  onOpenGuide: () => void;
  onOpenSettings: () => void;
  onScanQR: () => void;
  onToggleSidebar: () => void;
  isConnecting: boolean;
}

export const ConnectView: Component<ConnectViewProps> = (props) => {
  const [history, setHistory] = createSignal(getTicketHistory());
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);

  const handleRefresh = () => {
    HapticFeedback.light();
    setHistory(getTicketHistory());
  };

  const handleClearHistory = () => {
    HapticFeedback.medium();
    clearStoredTickets();
    setHistory([]);
    setShowDeleteConfirm(false);
  };

  const handleConnect = (ticket: string) => {
    HapticFeedback.medium();
    props.onConnect(ticket);
  };

  return (
    <div class="flex flex-col h-full bg-base-100 text-base-content font-sans overflow-hidden">
      {/* Header */}
      <header class="navbar bg-base-100 px-4 pt-safe shrink-0">
        <div class="flex-none">
          <span
            class="tooltip tooltip-bottom before:text-xs before:content-[attr(data-tip)]"
            data-tip="Menu"
          >
            <button
              aria-label="Open menu"
              class="btn btn-square btn-ghost"
              onClick={() => props.onToggleSidebar()}
            >
              <svg
                width="20"
                height="20"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                class="inline-block h-5 w-5 stroke-current md:h-6 md:w-6"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h16"
                ></path>
              </svg>
            </button>
          </span>
        </div>
        <div class="flex-1">
          <h1 class="text-xl font-black tracking-tighter text-primary px-2">
            Irogen
          </h1>
        </div>
        <div class="flex-none">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              HapticFeedback.light();
              props.onOpenSettings();
            }}
            class="rounded-full"
          >
            <Settings size={22} />
          </Button>
        </div>
      </header>

      {/* Machines Section */}
      <div class="flex-1 px-6 overflow-hidden flex flex-col">
        <div class="flex items-center justify-between mb-4 px-1 shrink-0">
          <div class="flex items-center gap-2 text-primary">
            <Terminal size={14} stroke-width={3} />
            <span class="font-black text-[10px] tracking-widest uppercase text-base-content/50">
              Machines
            </span>
          </div>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              class="btn-square btn-xs text-base-content/40 hover:text-primary"
              onClick={handleRefresh}
            >
              <RefreshCw size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="btn-square btn-xs text-base-content/40 hover:text-primary"
              onClick={() => {
                HapticFeedback.light();
                props.onConnect("");
              }}
            >
              <Plus size={16} />
            </Button>
          </div>
        </div>

        {/* Machine List Card */}
        <div class="bg-base-200/40 rounded-3xl border border-base-content/5 shadow-inner p-4 overflow-y-auto flex-1 mb-6">
          <Show
            when={history().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center py-12 text-center h-full">
                <div class="w-16 h-16 rounded-full bg-base-300 flex items-center justify-center mb-4 text-base-content/20">
                  <Plus size={24} />
                </div>
                <p class="text-sm text-base-content/40 mb-8 max-w-50 font-medium leading-relaxed">
                  暂无保存的设备信息。
                  <br />
                  请添加一个新设备以快速连接。
                </p>
                <Button
                  variant="primary"
                  class="rounded-xl px-8 font-bold shadow-lg shadow-base-content/10"
                  onClick={() => {
                    HapticFeedback.medium();
                    props.onConnect("");
                  }}
                >
                  <Plus size={18} class="mr-1" stroke-width={3} />
                  添加设备
                </Button>
              </div>
            }
          >
            <div class="space-y-3">
              <For each={history()}>
                {(ticket) => (
                  <div
                    onClick={() => handleConnect(ticket)}
                    class="group flex items-center justify-between p-4 rounded-2xl bg-base-100 border border-base-content/5 active:scale-[0.98] active:bg-base-300 transition-all cursor-pointer shadow-sm"
                  >
                    <div class="flex items-center gap-4">
                      <div class="w-10 h-10 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center text-primary">
                        <Terminal size={18} />
                      </div>
                      <div class="text-left">
                        <div class="font-bold text-sm">
                          Machine {getTicketDisplayId(ticket)}
                        </div>
                        <div class="text-[10px] text-base-content/40 font-mono truncate max-w-35">
                          {ticket}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      size={18}
                      class="text-base-content/20 group-hover:text-primary transition-colors"
                    />
                  </div>
                )}
              </For>

              <button
                onClick={() => setShowDeleteConfirm(true)}
                class="btn btn-ghost btn-xs w-full mt-4 text-error/40 hover:text-error hover:bg-error/5 border-none font-bold"
              >
                <Trash2 size={12} />
                清除历史记录
              </button>
            </div>
          </Show>
        </div>

        {/* Action Buttons */}
        <div class="flex flex-col gap-2 mb-8 shrink-0">
          <Button
            variant="outline"
            class="h-auto rounded-xl border-2 border-primary/10 py-3 font-bold text-primary shadow-sm hover:bg-primary/10 hover:text-primary"
            onClick={() => {
              HapticFeedback.medium();
              props.onScanQR();
            }}
          >
            <Scan size={18} class="mr-2" stroke-width={2.5} />
            扫描二维码
          </Button>

          <Button
            variant="ghost"
            size="sm"
            class="rounded-xl text-primary/60 hover:text-primary font-bold"
            onClick={() => {
              HapticFeedback.light();
              props.onOpenGuide();
            }}
          >
            <Lightbulb size={14} class="mr-1" />
            设置指南
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Modal Overlay */}
      <Show when={showDeleteConfirm()}>
        <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-100 flex items-end sm:items-center justify-center p-4">
          <div class="bg-base-100 rounded-3xl p-8 w-full max-w-sm shadow-2xl animate-content-show border border-base-content/10">
            <h3 class="text-xl font-bold mb-3">清除历史记录？</h3>
            <p class="text-sm text-base-content/60 mb-8 leading-relaxed font-medium">
              这将从您的设备中移除所有已保存的 P2P 连接票据。此操作无法撤销。
            </p>
            <div class="flex flex-col gap-2">
              <Button
                variant="error"
                class="rounded-xl py-3 h-auto font-bold text-error-content"
                onClick={handleClearHistory}
              >
                全部清除
              </Button>
              <Button
                variant="ghost"
                class="h-auto rounded-xl py-3 font-bold text-base-content/55"
                onClick={() => setShowDeleteConfirm(false)}
              >
                取消
              </Button>
            </div>
          </div>
        </div>
      </Show>

      {/* Loading Overlay */}
      <Show when={props.isConnecting}>
        <div class="fixed inset-0 bg-base-100/90 backdrop-blur-md z-110 flex flex-col items-center justify-center">
          <span class="loading loading-ring loading-lg text-primary mb-4 scale-150"></span>
          <p class="font-black text-primary text-xs tracking-[0.2em] animate-pulse">
            CONNECTING
          </p>
        </div>
      </Show>
    </div>
  );
};
