import { createSignal, Show, For, createEffect, onCleanup } from "solid-js";
import { getDeviceCapabilities, HapticFeedback } from "../../utils/mobile";
import { Badge, Button } from "./primitives";

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
        return "text-error-content";
      case 1:
        return "text-warning-content";
      case 2:
        return "text-warning-content";
      case 3:
        return "text-success-content";
      case 4:
        return "text-success-content";
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

  // @ts-ignore reserved for future use
  const _handleShowHistory = () => {
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
      active: props.currentView === "home" || props.currentView === "dashboard",
    },
    {
      id: "sessions",
      title: "Sessions",
      icon: "📚",
      active: props.currentView === "sessions",
    },
    {
      id: "devices",
      title: "Devices",
      icon: "💻",
      active:
        props.currentView === "devices" ||
        props.currentView === "hosts" ||
        props.currentView === "proxies",
    },
    {
      id: "settings",
      title: "Settings",
      icon: "⚙️",
      active: props.currentView === "settings",
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
      case "sessions":
        props.onViewChange("sessions");
        break;
      case "devices":
        props.onViewChange("devices");
        break;
      case "settings":
        props.onShowSettings?.();
        break;
    }
  };

  return (
    <>
      {/* Top Status Bar - Mobile First with Safe Area */}
      <div class="sticky top-0 z-40 flex min-h-10 items-center justify-between border-b border-border bg-background px-4 mobile-safe-top">
        <div class="flex items-center">
          <div class="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              class="px-2 py-1"
              onClick={() => setShowStatusPanel(!showStatusPanel())}
            >
              <span class="text-lg hidden sm:inline">⚡</span>
              <span class="font-bold text-sm sm:text-base">Irogen</span>
            </Button>
          </div>
        </div>

        <div class="flex items-center">
          <div class="flex items-center space-x-2 text-sm">
            <span class="font-mono text-xs sm:text-sm">
              {props.currentTime}
            </span>
          </div>
        </div>

        <div class="flex items-center">
          <div class="flex items-center space-x-1 sm:space-x-2">
            {/* Quick actions for mobile */}
            <Show when={isMobile && !showBottomNav()}>
              <Button
                variant="default"
                size="sm"
                class="px-2 py-1"
                onClick={handleQuickConnect}
                title="Quick Connect"
              >
                <span class="text-xs">🔗</span>
              </Button>
            </Show>

            <Button
              variant="ghost"
              size="sm"
              class={`py-1 ${getStatusColor()}`}
              onClick={() => setShowStatusPanel(!showStatusPanel())}
              title="Network Status"
            >
              <span class="text-sm">{getNetworkIcon()}</span>
              <Show when={props.isConnected}>
                <div class="h-2 w-2 rounded-full bg-success animate-pulse shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-base-100)_80%,transparent)]"></div>
              </Show>
            </Button>

            <Show when={props.isConnected}>
              <Button
                variant="destructive"
                size="sm"
                class="px-2 py-1"
                onClick={handleDisconnect}
                title="Disconnect"
              >
                <span class="text-xs">🔌</span>
              </Button>
            </Show>

            <Button
              variant="ghost"
              size="sm"
              class="px-2 py-1"
              onClick={handleShowSettings}
              title="Settings"
            >
              <span class="text-xs">⚙️</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Status Panel Dropdown */}
      <Show when={showStatusPanel()}>
        <div class="bg-background border-b border-border px-4 py-3 animate-slide-down">
          <div class="flex items-center justify-between">
            <div class="text-sm">
              <div class="font-medium">Network Status</div>
              <div class={`text-xs ${getStatusColor()}`}>{props.status}</div>
            </div>
            <div class="flex items-center space-x-2">
              <Badge
                variant={props.isConnected ? "success" : "neutral"}
                class="h-5 px-2 text-[10px]"
              >
                {props.isConnected ? "Connected" : "Offline"}
              </Badge>
              <div class="flex">
                <For each={[1, 2, 3, 4]}>
                  {(level) => (
                    <div
                      class={`w-1 h-3 mx-px rounded-sm ${
                        level <= props.networkStrength
                          ? "bg-success/80"
                          : "bg-muted"
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
        <div class="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 safe-area-bottom">
          <div class="flex items-center justify-around py-2">
            <For each={navItems}>
              {(item) => (
                <button
                  type="button"
                  class={`flex flex-col items-center justify-center p-2 rounded-lg min-w-[60px] transition-all duration-200 ${
                    item.active
                      ? "text-primary bg-primary/10"
                      : item.disabled
                        ? "text-muted cursor-not-allowed"
                        : "text-foreground hover:bg-muted"
                  }`}
                  onClick={() => handleNavItemClick(item)}
                  disabled={item.disabled}
                  title={item.title}
                >
                  <span class="text-lg mb-1">{item.icon}</span>
                  <span class="text-xs font-medium">{item.title}</span>
                  <Show when={item.badge}>
                    <Badge
                      variant="default"
                      class="absolute -right-1 -top-1 h-4 px-1 text-[9px]"
                    >
                      {item.badge}
                    </Badge>
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
