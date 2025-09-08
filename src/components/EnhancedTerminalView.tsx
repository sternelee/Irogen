import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  SwipeGesture,
  EnhancedButton,
  FloatingActionButton,
} from "./ui/EnhancedComponents";
import {
  getDeviceCapabilities,
  MobileKeyboard,
  KeyboardManager,
  InputFocusManager,
} from "../utils/mobile";

interface EnhancedTerminalViewProps {
  onReady: (terminal: Terminal, fitAddon: FitAddon) => void;
  onInput: (data: string) => void;
  isConnected?: boolean;
  onDisconnect?: () => void;
  onShowKeyboard?: () => void;
  sessionTitle?: string;
  terminalType?: string;
  workingDirectory?: string;
  // 新增移动端适配属性
  keyboardVisible?: boolean;
  safeViewportHeight?: number;
  onKeyboardToggle?: (visible: boolean) => void;
}

// Terminal debugging utility
const debugTerminal = (message: string, terminal?: Terminal | null) => {
  if (
    typeof window !== "undefined" &&
    window.location.hostname === "localhost"
  ) {
    console.log(`[EnhancedTerminalView] ${message}`, {
      terminalExists: !!terminal,
      terminalElement: terminal?.element,
      isDisposed: terminal && !(terminal as any)._core,
    });
  }
};

export function EnhancedTerminalView(props: EnhancedTerminalViewProps) {
  const [terminal, setTerminal] = createSignal<Terminal | null>(null);
  const [fitAddon, setFitAddon] = createSignal<FitAddon | null>(null);
  const [searchAddon, setSearchAddon] = createSignal<SearchAddon | null>(null);
  const [showMobileKeyboard, setShowMobileKeyboard] = createSignal(false);
  const [showTerminalActions, setShowTerminalActions] = createSignal(false);
  const [showSearchBar, setShowSearchBar] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [fontSize, setFontSize] = createSignal(14);
  const [opacity, setOpacity] = createSignal(1);
  const [deviceCapabilities] = createSignal(getDeviceCapabilities());
  const [terminalHeight, setTerminalHeight] = createSignal<number | null>(null);
  const [lastResizeTime, setLastResizeTime] = createSignal(0);

  // Enhanced mobile keyboard and input management
  const [keyboardCleanup, setKeyboardCleanup] = createSignal<
    (() => void) | null
  >(null);
  const [inputCleanup, setInputCleanup] = createSignal<(() => void) | null>(
    null,
  );
  const [fixedElementCleanup, setFixedElementCleanup] = createSignal<
    (() => void) | null
  >(null);

  // 响应外部键盘状态变化
  createEffect(() => {
    const isExternalKeyboardVisible = props.keyboardVisible;
    if (isExternalKeyboardVisible !== undefined) {
      // 外部键盘显示时，隐藏内部移动键盘以节省空间
      if (isExternalKeyboardVisible && showMobileKeyboard()) {
        setShowMobileKeyboard(false);
      }

      // 调整终端尺寸以适应键盘
      const fit = fitAddon();
      if (fit && terminalInstance) {
        setTimeout(() => {
          try {
            fit.fit();
            terminalInstance?.focus();
            setLastResizeTime(Date.now());
          } catch (error) {
            console.warn(
              "Failed to fit terminal after keyboard change:",
              error,
            );
          }
        }, 100);
      }
    }
  });

  // 计算最佳终端高度
  const calculateTerminalHeight = () => {
    if (!props.safeViewportHeight) return null;

    const baseHeight = props.safeViewportHeight;
    let availableHeight = baseHeight;

    // 减去固定UI元素的高度
    availableHeight -= 60; // 终端头部

    if (showSearchBar()) {
      availableHeight -= 50; // 搜索栏
    }

    if (showTerminalActions()) {
      availableHeight -= 120; // 操作面板
    }

    if (showMobileKeyboard()) {
      availableHeight -= 160; // 移动键盘
    }

    return Math.max(availableHeight, 200); // 最小高度200px
  };

  // Optimized terminal height monitoring with better debouncing
  createEffect(() => {
    const calculatedHeight = calculateTerminalHeight();
    if (calculatedHeight && calculatedHeight !== terminalHeight()) {
      setTerminalHeight(calculatedHeight);

      // Enhanced debouncing for smoother terminal resizing
      const now = Date.now();
      const timeSinceLastResize = now - lastResizeTime();

      if (timeSinceLastResize > 200) {
        // Increased threshold for better stability
        const fit = fitAddon();
        if (fit && terminalInstance) {
          // Use requestAnimationFrame for smooth resizing
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                fit.fit();
                terminalInstance?.focus();
                setLastResizeTime(now);
                debugTerminal(
                  `Terminal height adjusted to ${calculatedHeight}px`,
                );
              } catch (error) {
                console.warn(
                  "Failed to fit terminal after height change:",
                  error,
                );
              }
            }, 50); // Reduced timeout for responsiveness
          });
        }
      }
    }
  });

  // Touch gesture state
  const [isPinching, setIsPinching] = createSignal(false);
  const [lastPinchDistance, setLastPinchDistance] = createSignal(0);

  let terminalInstance: Terminal | null = null;
  let onDataDispose: { dispose: () => void } | null = null;
  let terminalElement: HTMLDivElement | undefined;
  let mobileKeyboardRef: HTMLDivElement | undefined;
  let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Get terminal theme similar to original TerminalView
  const getTerminalTheme = () => ({
    background: "rgba(17, 24, 39, 0.95)",
    foreground: "#F9FAFB",
    cursor: "#4F46E5",
    cursorAccent: "#1F2937",
    selectionBackground: "rgba(79, 70, 229, 0.3)",
    black: "#374151",
    red: "#EF4444",
    green: "#10B981",
    yellow: "#F59E0B",
    blue: "#3B82F6",
    magenta: "#8B5CF6",
    cyan: "#06B6D4",
    white: "#F9FAFB",
    brightBlack: "#6B7280",
    brightRed: "#F87171",
    brightGreen: "#34D399",
    brightYellow: "#FBBF24",
    brightBlue: "#60A5FA",
    brightMagenta: "#A78BFA",
    brightCyan: "#67E8F9",
    brightWhite: "#FFFFFF",
  });

  const initializeTerminal = () => {
    if (terminalElement && !terminalInstance) {
      debugTerminal("Initializing new terminal...");

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10000,
        theme: getTerminalTheme(),
        fontSize: fontSize(),
        fontFamily:
          '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "Monaco", "Inconsolata", "Roboto Mono", "Source Code Pro", "Menlo", "Consolas", "DejaVu Sans Mono", monospace',
        letterSpacing: 0.5,
        lineHeight: 1.2,
        allowTransparency: true,
        convertEol: true,
        rightClickSelectsWord: true,
        macOptionIsMeta: true,
        // Enhanced scrolling performance settings
        fastScrollModifier: "alt",
        fastScrollSensitivity: 3, // Reduced for smoother scrolling
        scrollSensitivity: 1, // Reduced for finer control
        minimumContrastRatio: 4.5,
        fontWeight: "normal",
        fontWeightBold: "bold",
        drawBoldTextInBrightColors: true,
        // Mobile optimization settings
        cols: deviceCapabilities().isMobile ? 80 : undefined,
        wordSeparator: deviceCapabilities().isMobile ? " \t\n\r\f" : undefined,
        // Performance optimizations
        disableStdin: false,
        allowProposedApi: true, // Enable performance improvements
        windowOptions: {
          restoreWin: true,
          minimizeWin: true,
          setWinPosition: true,
          setWinSizePixels: true,
          raiseWin: true,
          lowerWin: true,
          refreshWin: true,
          setWinSizeChars: true,
          maximizeWin: true,
          fullscreenWin: true,
        },
      });

      // Load addons
      const fit = new FitAddon();
      const webLinks = new WebLinksAddon();
      const search = new SearchAddon();

      term.loadAddon(fit);
      term.loadAddon(webLinks);
      term.loadAddon(search);

      // Store references
      terminalInstance = term;
      setTerminal(term);
      setFitAddon(fit);
      setSearchAddon(search);

      // Open terminal
      term.open(terminalElement);

      // Ensure font size is applied immediately after opening
      const initialFontSize = fontSize();
      term.options.fontSize = initialFontSize;
      debugTerminal(`Initial font size set to ${initialFontSize}px`);

      // Fit terminal after font size is set
      fit.fit();

      // Force a refresh to apply all settings
      setTimeout(() => {
        try {
          term.refresh(0, term.rows - 1);
          fit.fit();
          debugTerminal(
            `Terminal refreshed with font size ${term.options.fontSize}px`,
          );
        } catch (error) {
          console.warn(
            "Failed to refresh terminal after initialization:",
            error,
          );
        }
      }, 100);

      // Enhanced terminal styling for smooth scrolling
      if (terminalElement) {
        terminalElement.style.background = "transparent";
        // Hardware acceleration for the container
        terminalElement.style.transform = "translateZ(0)";
        terminalElement.style.backfaceVisibility = "hidden";
        terminalElement.style.willChange = "scroll-position, transform";

        const terminalEl = terminalElement.querySelector(".terminal");
        if (terminalEl) {
          const el = terminalEl as HTMLElement;
          el.style.background = "transparent";
          // Enhanced scrolling for xterm container
          el.style.transform = "translateZ(0)";
          el.style.backfaceVisibility = "hidden";
          el.style.willChange = "scroll-position";
        }

        // Optimize xterm viewport
        const viewport = terminalElement.querySelector(".xterm-viewport");
        if (viewport) {
          const el = viewport as HTMLElement;
          (el.style as any).webkitOverflowScrolling = "touch";
          el.style.scrollBehavior = "smooth";
          el.style.overscrollBehavior = "contain";
          // Hardware acceleration for viewport
          el.style.transform = "translateZ(0)";
          el.style.willChange = "scroll-position";
        }

        // Optimize xterm screen
        const screen = terminalElement.querySelector(".xterm-screen");
        if (screen) {
          const el = screen as HTMLElement;
          el.style.transform = "translateZ(0)";
          el.style.backfaceVisibility = "hidden";
        }
      }

      // Welcome message
      const welcomeMessage = [
        "\x1b[1;32m╔══════════════════════════════════════════════════════════════╗\x1b[0m",
        "\x1b[1;32m║\x1b[0m                    \x1b[1;36mRiTerm P2P Terminal\x1b[0m                     \x1b[1;32m║\x1b[0m",
        "\x1b[1;32m║\x1b[0m                  \x1b[36mSecure • Fast • Decentralized\x1b[0m                \x1b[1;32m║\x1b[0m",
        "\x1b[1;32m╚══════════════════════════════════════════════════════════════╝\x1b[0m",
        "",
        "\x1b[33m[INFO]\x1b[0m Terminal initialized with enhanced theme",
        "\x1b[33m[INFO]\x1b[0m P2P network stack ready",
        "\x1b[32m[READY]\x1b[0m Awaiting connection...",
        "",
      ].join("\r\n");

      term.write(welcomeMessage);
      term.focus();

      // Setup callbacks
      props.onReady(term, fit);

      onDataDispose = term.onData((data) => {
        debugTerminal(`Terminal input: ${data}`);
        props.onInput(data);
      });

      // Enhanced resize handling with debouncing
      let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleResize = () => {
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }

        resizeTimeout = setTimeout(() => {
          if (fit && terminalInstance) {
            try {
              fit.fit();
              terminalInstance?.focus();
              debugTerminal("Terminal resized and refitted successfully");
            } catch (error) {
              console.warn("Failed to fit terminal:", error);
            }
          }
        }, 150); // Increased debounce time for smoother performance
      };

      window.addEventListener("resize", handleResize);
      debugTerminal("Terminal initialized successfully", term);

      onCleanup(() => {
        debugTerminal("Starting terminal cleanup...");

        // Clear resize timeout
        if (resizeTimeout) {
          clearTimeout(resizeTimeout);
        }

        window.removeEventListener("resize", handleResize);

        if (onDataDispose) {
          onDataDispose.dispose();
          onDataDispose = null;
        }

        if (terminalInstance) {
          try {
            terminalInstance.dispose();
          } catch (error) {
            console.warn("Error disposing terminal:", error);
          }
          terminalInstance = null;
        }

        setTerminal(null);
        setFitAddon(null);
        setSearchAddon(null);
        debugTerminal("Terminal cleanup completed");
      });
    }
  };

  // Enhanced terminal initialization with mobile support
  onMount(() => {
    // Delay initialization slightly to ensure DOM is ready
    setTimeout(initializeTerminal, 50);

    // Enhanced mobile keyboard and input management setup
    if (deviceCapabilities().isMobile) {
      // Register terminal element for input focus management
      if (terminalElement) {
        const cleanup = InputFocusManager.trackInput(terminalElement);
        setInputCleanup(() => cleanup);
      }

      // Set up keyboard scroll adjustment callback
      const keyboardCleanupFn = MobileKeyboard.onScrollAdjustment(() => {
        // Force terminal to adjust when keyboard triggers scroll adjustments
        const fit = fitAddon();
        if (fit && terminalInstance) {
          setTimeout(() => {
            try {
              fit.fit();
              terminalInstance?.focus();
            } catch (error) {
              console.warn(
                "Failed to adjust terminal for keyboard scroll:",
                error,
              );
            }
          }, 100);
        }
      });
      setKeyboardCleanup(() => keyboardCleanupFn);

      // Register mobile keyboard as fixed element if it exists
      setTimeout(() => {
        if (mobileKeyboardRef) {
          const fixedCleanup = KeyboardManager.registerFixedElement(
            mobileKeyboardRef,
            {
              adjustWithKeyboard: true,
              onKeyboardShow: (keyboardHeight) => {
                console.log(
                  `Mobile keyboard adjusted for keyboard height: ${keyboardHeight}px`,
                );
              },
              onKeyboardHide: () => {
                console.log("Mobile keyboard restored to normal position");
              },
            },
          );
          setFixedElementCleanup(() => fixedCleanup);
        }
      }, 100);
    }

    // Enhanced cleanup
    onCleanup(() => {
      const inputCleanupFn = inputCleanup();
      if (inputCleanupFn) {
        inputCleanupFn();
        setInputCleanup(null);
      }

      const keyboardCleanupFn = keyboardCleanup();
      if (keyboardCleanupFn) {
        keyboardCleanupFn();
        setKeyboardCleanup(null);
      }

      const fixedCleanupFn = fixedElementCleanup();
      if (fixedCleanupFn) {
        fixedCleanupFn();
        setFixedElementCleanup(null);
      }
    });
  });

  // Enhanced font size and theme updates with performance optimization
  createEffect(() => {
    const currentFontSize = fontSize();
    const currentTerminal = terminal();

    if (currentTerminal && terminalInstance) {
      debugTerminal(`Updating font size to ${currentFontSize}px`);

      // Update terminal options
      currentTerminal.options.fontSize = currentFontSize;
      currentTerminal.options.theme = getTerminalTheme();

      // Use requestAnimationFrame for smoother updates
      requestAnimationFrame(() => {
        const fit = fitAddon();
        if (fit && terminalInstance) {
          // Use a timeout to ensure font changes are applied
          setTimeout(() => {
            try {
              // Refresh the terminal to apply font changes
              currentTerminal.refresh(0, currentTerminal.rows - 1);
              // Then fit the terminal
              fit.fit();
              currentTerminal.focus();

              debugTerminal(
                `Font size updated successfully to ${currentFontSize}px`,
              );
            } catch (error) {
              console.warn("Failed to update terminal font size:", error);
            }
          }, 100); // Reduced timeout for better responsiveness
        }
      });
    }
  });

  // Enhanced touch gesture handlers with scroll optimization
  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      // Only handle pinch gestures
      setIsPinching(true);
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      setLastPinchDistance(distance);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isPinching() && e.touches.length === 2) {
      // Only prevent default for pinch gestures, allow normal scrolling
      e.preventDefault();
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      const scale = distance / lastPinchDistance();

      // Use more conservative thresholds to prevent accidental zooming during scrolling
      if (scale > 1.1) {
        // Zoom in - increased threshold for stability
        const newSize = Math.min(fontSize() + 1, 24);
        if (newSize !== fontSize()) {
          setFontSize(newSize);
          setLastPinchDistance(distance);
          debugTerminal(`Pinch zoom in: font size ${newSize}px`);

          // Haptic feedback
          if (window.navigator?.vibrate) {
            window.navigator.vibrate(10);
          }
        }
      } else if (scale < 0.9) {
        // Zoom out - increased threshold for stability
        const newSize = Math.max(fontSize() - 1, 8);
        if (newSize !== fontSize()) {
          setFontSize(newSize);
          setLastPinchDistance(distance);
          debugTerminal(`Pinch zoom out: font size ${newSize}px`);

          // Haptic feedback
          if (window.navigator?.vibrate) {
            window.navigator.vibrate(10);
          }
        }
      }
    }
    // Allow single-touch scrolling to work normally by not preventing default
  };

  const handleTouchEnd = () => {
    setIsPinching(false);
    setLastPinchDistance(0);
  };

  const getTouchDistance = (touch1: Touch, touch2: Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Mobile keyboard actions - 优化移动端按键布局
  const commonKeys = [
    { label: "Tab", key: "\t" },
    { label: "Ctrl+C", key: "\x03" },
    { label: "Ctrl+D", key: "\x04" },
    { label: "Ctrl+L", key: "\x0c" },
    { label: "Esc", key: "\x1b" },
    { label: "Enter", key: "\r" },
    { label: "←", key: "\x1b[D" },
    { label: "→", key: "\x1b[C" },
    { label: "↑", key: "\x1b[A" },
    { label: "↓", key: "\x1b[B" },
    // 移动端额外按键
    ...(deviceCapabilities().isMobile
      ? [
          { label: "Home", key: "\x1b[H" },
          { label: "End", key: "\x1b[F" },
          { label: "PgUp", key: "\x1b[5~" },
          { label: "PgDn", key: "\x1b[6~" },
          { label: "Ctrl+Z", key: "\x1a" },
          { label: "Ctrl+X", key: "\x18" },
        ]
      : []),
  ];

  const sendKey = (key: string) => {
    if (key) {
      debugTerminal(`Sending key: "${key}"`);
      props.onInput(key);

      // Haptic feedback
      if (window.navigator?.vibrate) {
        window.navigator.vibrate(5);
      }
    }
  };

  // Search functionality
  const handleSearch = (
    query: string,
    direction: "next" | "previous" = "next",
  ) => {
    const search = searchAddon();
    if (search && query) {
      if (direction === "next") {
        search.findNext(query);
      } else {
        search.findPrevious(query);
      }
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen());
    // Add fullscreen API call if supported
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      terminalElement?.requestFullscreen?.();
    }
  };

  return (
    <div
      class={`relative w-full h-full flex flex-col ${isFullscreen() ? "fixed inset-0 z-50 bg-black" : ""}`}
    >
      {/* Terminal Header - 显示标题和终端信息 */}
      <div class="flex items-center justify-between p-3 bg-base-100 border-b border-base-300 shrink-0">
        <div class="flex items-center space-x-3">
          {/* 终端状态指示器 */}
          <div class="flex items-center space-x-2">
            <div
              class={`w-2 h-2 rounded-full ${props.isConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`}
            ></div>
            <div class="font-medium text-sm">
              {props.isConnected ? "已连接" : "未连接"}
            </div>
          </div>

          {/* 分隔线 */}
          <div class="w-px h-4 bg-base-300"></div>

          {/* 会话信息 */}
          <div class="flex items-center space-x-2 text-sm">
            <Show when={props.sessionTitle} fallback="RiTerm">
              <span class="font-medium">{props.sessionTitle}</span>
            </Show>
            <Show when={props.terminalType}>
              <span class="opacity-60">({props.terminalType})</span>
            </Show>
          </div>

          {/* 工作目录 */}
          <Show when={props.workingDirectory}>
            <>
              <div class="w-px h-4 bg-base-300"></div>
              <div class="text-xs opacity-50 font-mono hidden sm:block">
                {props.workingDirectory}
              </div>
            </>
          </Show>
        </div>

        <div class="flex items-center space-x-2">
          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowTerminalActions(!showTerminalActions())}
            icon="⚙️"
          >
            <span class="hidden sm:inline">操作</span>
          </EnhancedButton>

          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowSearchBar(!showSearchBar())}
            icon="🔍"
          >
            <span class="hidden sm:inline">搜索</span>
          </EnhancedButton>

          <div class="text-xs opacity-70 hidden sm:block">
            字体: {fontSize()}px
          </div>

          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            icon={isFullscreen() ? "🗗" : "⛶"}
          >
            <span class="hidden sm:inline">
              {isFullscreen() ? "退出" : "全屏"}
            </span>
          </EnhancedButton>
        </div>
      </div>

      {/* Search Bar */}
      <Show when={showSearchBar()}>
        <div class="flex items-center space-x-2 p-2 bg-base-200 border-b border-base-300">
          <div class="flex-1 flex space-x-2">
            <input
              type="text"
              placeholder="Search terminal..."
              class="input input-sm input-bordered flex-1"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSearch(searchQuery());
                }
              }}
            />
            <EnhancedButton
              variant="primary"
              size="sm"
              onClick={() => handleSearch(searchQuery())}
              icon="⬇️"
            >
              Next
            </EnhancedButton>
            <EnhancedButton
              variant="secondary"
              size="sm"
              onClick={() => handleSearch(searchQuery(), "previous")}
              icon="⬆️"
            >
              Prev
            </EnhancedButton>
          </div>
          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowSearchBar(false)}
            icon="✕"
          >
            Close
          </EnhancedButton>
        </div>
      </Show>

      {/* Terminal Actions Panel */}
      <Show when={showTerminalActions()}>
        <div class="p-3 bg-base-200 border-b border-base-300">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => terminal()?.clear()}
              icon="🗑️"
            >
              Clear
            </EnhancedButton>

            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => terminal()?.selectAll()}
              icon="📋"
            >
              Select All
            </EnhancedButton>

            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => setShowMobileKeyboard(!showMobileKeyboard())}
              icon="⌨️"
            >
              Keyboard
            </EnhancedButton>

            <EnhancedButton
              variant="outline"
              size="sm"
              onClick={() => {
                const currentTerminal = terminal();
                if (currentTerminal) {
                  currentTerminal.reset();
                  // Also reset font size to default
                  setFontSize(14);
                  debugTerminal("Terminal reset with default font size 14px");
                }
              }}
              icon="🔄"
            >
              Reset
            </EnhancedButton>
          </div>

          {/* Font Size Control */}
          <div class="flex items-center justify-between">
            <span class="text-sm">Font Size:</span>
            <div class="flex items-center space-x-2">
              <EnhancedButton
                variant="ghost"
                size="xs"
                onClick={() => {
                  const newSize = Math.max(fontSize() - 1, 8);
                  if (newSize !== fontSize()) {
                    setFontSize(newSize);
                    debugTerminal(
                      `Font size decreased to ${newSize}px via button`,
                    );
                  }
                }}
                disabled={fontSize() <= 8}
              >
                A-
              </EnhancedButton>
              <span class="text-sm w-12 text-center font-mono bg-base-300 px-2 py-1 rounded">
                {fontSize()}px
              </span>
              <EnhancedButton
                variant="ghost"
                size="xs"
                onClick={() => {
                  const newSize = Math.min(fontSize() + 1, 24);
                  if (newSize !== fontSize()) {
                    setFontSize(newSize);
                    debugTerminal(
                      `Font size increased to ${newSize}px via button`,
                    );
                  }
                }}
                disabled={fontSize() >= 24}
              >
                A+
              </EnhancedButton>
            </div>
          </div>
        </div>
      </Show>

      {/* Terminal Container with Touch Support and Mobile Optimizations */}
      <div
        class="flex-1 relative overflow-hidden terminal-container"
        style={{
          height: terminalHeight() ? `${terminalHeight()}px` : "100%",
          "max-height": terminalHeight() ? `${terminalHeight()}px` : "100%",
          transition:
            "height 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <SwipeGesture
          onSwipeDown={() => {
            if (!props.keyboardVisible) {
              setShowMobileKeyboard(true);
              props.onKeyboardToggle?.(true);
            }
          }}
          onSwipeUp={() => {
            setShowMobileKeyboard(false);
            props.onKeyboardToggle?.(false);
          }}
          class="w-full h-full"
        >
          <div
            ref={terminalElement}
            id="enhanced-terminal-container"
            class={`terminal-content w-full ${deviceCapabilities().isMobile ? "mobile-terminal" : ""}`}
            style={{
              height: "100%",
              opacity: opacity(),
              background: "transparent",
              // Enhanced scrolling optimizations
              "overflow-x": deviceCapabilities().isMobile ? "auto" : "hidden",
              "overflow-y": "hidden",
              "min-width": deviceCapabilities().isMobile ? "640px" : "auto",
              // Hardware acceleration for smooth scrolling
              transform: "translateZ(0)",
              "will-change": "scroll-position, transform",
              "backface-visibility": "hidden",
              // iOS Safari smooth scrolling optimization
              "-webkit-overflow-scrolling": "touch",
              "scroll-behavior": "smooth",
              // Prevent scroll bouncing
              "overscroll-behavior": "contain",
              // Force GPU layer for better performance
              contain: "layout style paint",
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </SwipeGesture>
      </div>

      {/* Mobile Keyboard */}
      <Show when={showMobileKeyboard() && !props.keyboardVisible}>
        <div
          ref={mobileKeyboardRef}
          class="bg-base-100 border-t border-base-300 p-3 shrink-0 mobile-keyboard fixed-bottom"
          style={{
            animation: "slideUpKeyboard 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">Terminal Keys</span>
            <EnhancedButton
              variant="ghost"
              size="xs"
              onClick={() => setShowMobileKeyboard(false)}
              icon="✕"
            >
              Close
            </EnhancedButton>
          </div>

          <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {commonKeys.map((keyDef) => (
              <EnhancedButton
                variant="outline"
                size="sm"
                onClick={() => sendKey(keyDef.key)}
                haptic
                class={`text-xs ${deviceCapabilities().isMobile ? "min-h-[40px]" : ""}`}
              >
                {keyDef.label}
              </EnhancedButton>
            ))}
          </div>
        </div>
      </Show>

      {/* Floating Action Buttons */}
      <Show
        when={
          !showMobileKeyboard() && !isFullscreen() && !props.keyboardVisible
        }
      >
        <FloatingActionButton
          icon="⌨️"
          onClick={() => {
            setShowMobileKeyboard(true);
            props.onKeyboardToggle?.(true);
          }}
          position="bottom-right"
          variant="primary"
        />
      </Show>
    </div>
  );
}
