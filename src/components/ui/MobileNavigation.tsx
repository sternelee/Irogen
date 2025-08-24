import { createSignal, Show, For } from "solid-js";
import { ThemeSwitcher } from "./ThemeSwitcher";

export interface NavigationItem {
  id: string;
  title: string;
  icon: string;
  badge?: string | number;
  active?: boolean;
  disabled?: boolean;
}

interface MobileNavigationProps {
  currentView: string;
  onViewChange: (view: string) => void;
  isConnected: boolean;
  networkStrength: number;
  status: string;
  currentTime: string;
  onDisconnect?: () => void;
  onShowSettings?: () => void;
}

export function MobileNavigation(props: MobileNavigationProps) {
  const [showStatusPanel, setShowStatusPanel] = createSignal(false);

  const getNetworkIcon = () => {
    if (!props.isConnected) return "📶";
    switch (props.networkStrength) {
      case 0:
        return "📵";
      case 1:
        return "📶";
      case 2:
        return "📶";
      case 3:
        return "📶";
      case 4:
        return "📶";
      default:
        return "📶";
    }
  };

  const getStatusColor = () => {
    if (!props.isConnected) return "text-base-content";
    switch (props.networkStrength) {
      case 0:
        return "text-error";
      case 1:
        return "text-warning";
      case 2:
        return "text-warning";
      case 3:
        return "text-success";
      case 4:
        return "text-success";
      default:
        return "text-base-content";
    }
  };

  return (
    <>
      {/* Top Status Bar - Mobile First with Safe Area */}
      <div class="navbar bg-base-100 border-b border-base-300 min-h-12 px-4 mobile-safe-top">
        <div class="navbar-start">
          <div class="flex items-center space-x-2">
            <button
              class="btn btn-ghost btn-sm px-2"
              onClick={() => setShowStatusPanel(!showStatusPanel())}
            >
              <span class="text-lg">⚡</span>
              <span class="font-bold hidden sm:inline">RiTerm</span>
            </button>
          </div>
        </div>

        <div class="navbar-center">
          <div class="flex items-center space-x-2 text-sm">
            <span class="font-mono">{props.currentTime}</span>
          </div>
        </div>

        <div class="navbar-end">
          <div class="flex items-center space-x-2">
            {/* Theme Switcher */}
            <ThemeSwitcher />

            <button
              class={`btn btn-ghost btn-sm ${getStatusColor()}`}
              onClick={() => setShowStatusPanel(!showStatusPanel())}
            >
              <span class="text-sm">{getNetworkIcon()}</span>
              <Show when={props.isConnected}>
                <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
              </Show>
            </button>

            <Show when={props.isConnected}>
              <button
                class="btn btn-error btn-sm px-2"
                onClick={props.onDisconnect}
              >
                <span class="text-xs">🔌</span>
                <span class="hidden sm:inline text-xs">Disconnect</span>
              </button>
            </Show>
          </div>
        </div>
      </div>

      {/* Status Panel Dropdown */}
      <Show when={showStatusPanel()}>
        <div class="bg-base-100 border-b border-base-300 px-4 py-3">
          <div class="flex items-center justify-between">
            <div class="text-sm">
              <div class="font-medium">Network Status</div>
              <div class={`text-xs ${getStatusColor()}`}>{props.status}</div>
            </div>
            <div class="flex items-center space-x-2">
              <div
                class={`badge badge-sm ${props.isConnected ? "badge-success" : "badge-neutral"}`}
              >
                {props.isConnected ? "Connected" : "Offline"}
              </div>
              <div class="flex">
                <For each={[1, 2, 3, 4]}>
                  {(level) => (
                    <div
                      class={`w-1 h-3 mx-px rounded-sm ${
                        level <= props.networkStrength
                          ? "bg-success"
                          : "bg-base-300"
                      }`}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Desktop Sidebar - Hidden on Mobile */}
      <div class="hidden lg:flex drawer-side">
        <label for="drawer-sidebar" class="drawer-overlay"></label>
        <aside class="w-64 min-h-full bg-base-200">
          <div class="p-4">
            <div class="flex items-center justify-between mb-8">
              <div class="flex items-center space-x-3">
                <span class="text-2xl">⚡</span>
                <h1 class="text-xl font-bold">RiTerm</h1>
              </div>
              {/* Theme Switcher for Desktop */}
              <ThemeSwitcher />
            </div>

            <div class="mt-8 p-4 bg-base-100 rounded-lg">
              <div class="text-sm">
                <div class="font-medium mb-2">Status</div>
                <div class="flex items-center justify-between">
                  <span class={`text-xs ${getStatusColor()}`}>
                    {props.status}
                  </span>
                  <div class="flex">
                    <For each={[1, 2, 3, 4]}>
                      {(level) => (
                        <div
                          class={`w-1 h-3 mx-px rounded-sm ${
                            level <= props.networkStrength
                              ? "bg-success"
                              : "bg-base-300"
                          }`}
                        />
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
