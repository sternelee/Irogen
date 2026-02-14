import { createSignal, Show, For, createEffect, onCleanup } from "solid-js";
import { getDeviceCapabilities, HapticFeedback } from "../../utils/mobile";

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
  onShowHistory?: () => void;
  onQuickConnect?: () => void;
}

export function MobileNavigation(props: MobileNavigationProps) {
  const [showStatusPanel, setShowStatusPanel] = createSignal(false);
  const [showBottomNav, setShowBottomNav] = createSignal(false);
  const [isLandscape, setIsLandscape] = createSignal(false);

  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;
  const isTablet = deviceCapabilities.isTablet;

  // Handle orientation changes
  createEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
    });
  });

  // Show bottom navigation on mobile devices in portrait mode
  createEffect(() => {
    setShowBottomNav(isMobile && !isLandscape());
  });

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

  const handleDisconnect = () => {
    HapticFeedback.medium();
    props.onDisconnect?.();
  };

  const handleShowSettings = () => {
    HapticFeedback.light();
    props.onShowSettings?.();
  };

  const handleShowHistory = () => {
    HapticFeedback.light();
    props.onShowHistory?.();
  };

  const handleQuickConnect = () => {
    HapticFeedback.light();
    props.onQuickConnect?.();
  };

  // Navigation items for bottom navigation
  const navItems: NavigationItem[] = [
    {
      id: "home",
      title: "Home",
      icon: "🏠",
      active: props.currentView === "home",
    },
    {
      id: "history",
      title: "History",
      icon: "📚",
      active: false,
      disabled: false,
    },
    {
      id: "connect",
      title: "Connect",
      icon: "🔗",
      active: false,
      disabled: false,
    },
    {
      id: "terminal",
      title: "Terminal",
      icon: "💻",
      active: props.currentView === "terminal",
      disabled: !props.isConnected,
    },
    {
      id: "settings",
      title: "Settings",
      icon: "⚙️",
      active: false,
      disabled: false,
    },
  ];

  const handleNavItemClick = (item: NavigationItem) => {
    if (item.disabled) {
      HapticFeedback.error();
      return;
    }

    HapticFeedback.light();

    switch (item.id) {
      case "home":
        props.onViewChange("home");
        break;
      case "history":
        props.onShowHistory?.();
        break;
      case "connect":
        props.onQuickConnect?.();
        break;
      case "terminal":
        if (props.isConnected) {
          props.onViewChange("terminal");
        }
        break;
      case "settings":
        props.onShowSettings?.();
        break;
    }
  };

  return (
    <>
      {/* Top Status Bar - Mobile First with Safe Area */}
      <div class="navbar bg-base-100 border-b border-base-300 min-h-10 px-4 mobile-safe-top sticky top-0 z-40">
        <div class="navbar-start">
          <div class="flex items-center space-x-2">
            <button
              class="btn btn-ghost btn-sm px-2 py-1"
              onClick={() => setShowStatusPanel(!showStatusPanel())}
            >
              <span class="text-lg hidden sm:inline">⚡</span>
              <span class="font-bold text-sm sm:text-base">RiTerm</span>
            </button>
          </div>
        </div>

        <div class="navbar-center">
          <div class="flex items-center space-x-2 text-sm">
            <span class="font-mono text-xs sm:text-sm">
              {props.currentTime}
            </span>
          </div>
        </div>

        <div class="navbar-end">
          <div class="flex items-center space-x-1 sm:space-x-2">
            {/* Quick actions for mobile */}
            <Show when={isMobile && !showBottomNav()}>
              <button
                class="btn btn-primary btn-sm px-2 py-1"
                onClick={handleQuickConnect}
                title="Quick Connect"
              >
                <span class="text-xs">🔗</span>
              </button>
            </Show>

            <button
              class={`btn btn-ghost btn-sm py-1 ${getStatusColor()}`}
              onClick={() => setShowStatusPanel(!showStatusPanel())}
              title="Network Status"
            >
              <span class="text-sm">{getNetworkIcon()}</span>
              <Show when={props.isConnected}>
                <div class="w-2 h-2 bg-success rounded-full animate-pulse"></div>
              </Show>
            </button>

            <Show when={props.isConnected}>
              <button
                class="btn btn-error btn-sm px-2 py-1"
                onClick={handleDisconnect}
                title="Disconnect"
              >
                <span class="text-xs">🔌</span>
              </button>
            </Show>

            <button
              class="btn btn-ghost btn-sm px-2 py-1"
              onClick={handleShowSettings}
              title="Settings"
            >
              <span class="text-xs">⚙️</span>
            </button>
          </div>
        </div>
      </div>

      {/* Status Panel Dropdown */}
      <Show when={showStatusPanel()}>
        <div class="bg-base-100 border-b border-base-300 px-4 py-3 animate-slide-down">
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

      {/* Bottom Navigation for Mobile Portrait */}
      <Show when={showBottomNav()}>
        <div class="fixed bottom-0 left-0 right-0 bg-base-100 border-t border-base-300 z-50 safe-area-bottom">
          <div class="flex items-center justify-around py-2">
            <For each={navItems}>
              {(item) => (
                <button
                  class={`flex flex-col items-center justify-center p-2 rounded-lg min-w-[60px] transition-all duration-200 ${
                    item.active
                      ? "text-primary bg-primary/10"
                      : item.disabled
                        ? "text-base-300 cursor-not-allowed"
                        : "text-base-content hover:bg-base-200"
                  }`}
                  onClick={() => handleNavItemClick(item)}
                  disabled={item.disabled}
                  title={item.title}
                >
                  <span class="text-lg mb-1">{item.icon}</span>
                  <span class="text-xs font-medium">{item.title}</span>
                  <Show when={item.badge}>
                    <div class="badge badge-xs badge-primary absolute -top-1 -right-1">
                      {item.badge}
                    </div>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Add padding to prevent content being hidden behind bottom nav */}
        <div class="h-20 safe-area-bottom"></div>
      </Show>
    </>
  );
}
