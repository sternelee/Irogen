import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import {
  SwipeGesture,
  EnhancedButton,
  FloatingActionButton,
} from "./ui/EnhancedComponents";

interface EnhancedTerminalViewProps {
  onReady: (terminal: Terminal, fitAddon: FitAddon) => void;
  onInput: (data: string) => void;
  isConnected?: boolean;
  onDisconnect?: () => void;
  onShowKeyboard?: () => void;
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
  const [isInitialized, setIsInitialized] = createSignal(false);

  let terminalElement: HTMLDivElement | undefined;
  let mobileKeyboardRef: HTMLDivElement | undefined;

  // Touch gesture state
  const [isPinching, setIsPinching] = createSignal(false);
  const [lastPinchDistance, setLastPinchDistance] = createSignal(0);

  let terminalInstance: Terminal | null = null;
  let onDataDispose: { dispose: () => void } | null = null;

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
        fastScrollModifier: "alt",
        fastScrollSensitivity: 5,
        scrollSensitivity: 3,
        minimumContrastRatio: 4.5,
        fontWeight: "normal",
        fontWeightBold: "bold",
        drawBoldTextInBrightColors: true,
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
      fit.fit();

      // Add terminal-specific styling
      if (terminalElement) {
        terminalElement.style.background = "transparent";
        const terminalEl = terminalElement.querySelector(".terminal");
        if (terminalEl) {
          (terminalEl as HTMLElement).style.background = "transparent";
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

      // Handle resize
      const handleResize = () => {
        if (fit && terminalInstance) {
          setTimeout(() => {
            try {
              fit.fit();
              terminalInstance?.focus();
            } catch (error) {
              console.warn("Failed to fit terminal:", error);
            }
          }, 100);
        }
      };

      window.addEventListener("resize", handleResize);
      setIsInitialized(true);
      debugTerminal("Terminal initialized successfully", term);

      onCleanup(() => {
        debugTerminal("Starting terminal cleanup...");
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
        setIsInitialized(false);
        debugTerminal("Terminal cleanup completed");
      });
    }
  };

  // Initialize terminal
  onMount(() => {
    // Delay initialization slightly to ensure DOM is ready
    setTimeout(initializeTerminal, 50);
  });

  // Update font size and theme
  createEffect(() => {
    if (terminalInstance) {
      terminalInstance.options.fontSize = fontSize();
      terminalInstance.options.theme = getTerminalTheme();
      const fit = fitAddon();
      if (fit) {
        setTimeout(() => {
          try {
            fit.fit();
            terminalInstance?.focus();
          } catch (error) {
            console.warn("Failed to fit terminal after font change:", error);
          }
        }, 100);
      }
    }
  });

  // Touch gesture handlers
  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      setIsPinching(true);
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      setLastPinchDistance(distance);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (isPinching() && e.touches.length === 2) {
      e.preventDefault();
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      const scale = distance / lastPinchDistance();

      if (scale > 1.1) {
        // Zoom in
        setFontSize(Math.min(fontSize() + 1, 24));
        setLastPinchDistance(distance);

        // Haptic feedback
        if (window.navigator?.vibrate) {
          window.navigator.vibrate(10);
        }
      } else if (scale < 0.9) {
        // Zoom out
        setFontSize(Math.max(fontSize() - 1, 8));
        setLastPinchDistance(distance);

        // Haptic feedback
        if (window.navigator?.vibrate) {
          window.navigator.vibrate(10);
        }
      }
    }
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

  // Mobile keyboard actions
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
      {/* Terminal Header - Mobile Optimized */}
      <div class="flex items-center justify-between p-2 bg-base-100 border-b border-base-300 shrink-0">
        <div class="flex items-center space-x-2">
          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowTerminalActions(!showTerminalActions())}
            icon="⚙️"
          >
            <span class="hidden sm:inline">Actions</span>
          </EnhancedButton>

          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={() => setShowSearchBar(!showSearchBar())}
            icon="🔍"
          >
            <span class="hidden sm:inline">Search</span>
          </EnhancedButton>
        </div>

        <div class="flex items-center space-x-2">
          <div class="text-xs opacity-70 hidden sm:block">
            Font: {fontSize()}px
          </div>

          <EnhancedButton
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            icon={isFullscreen() ? "🗗" : "⛶"}
          >
            <span class="hidden sm:inline">
              {isFullscreen() ? "Exit" : "Fullscreen"}
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
              onClick={() => terminal()?.reset()}
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
                onClick={() => setFontSize(Math.max(fontSize() - 1, 8))}
                disabled={fontSize() <= 8}
              >
                A-
              </EnhancedButton>
              <span class="text-sm w-8 text-center">{fontSize()}</span>
              <EnhancedButton
                variant="ghost"
                size="xs"
                onClick={() => setFontSize(Math.min(fontSize() + 1, 24))}
                disabled={fontSize() >= 24}
              >
                A+
              </EnhancedButton>
            </div>
          </div>
        </div>
      </Show>

      {/* Terminal Container with Touch Support */}
      <SwipeGesture
        onSwipeDown={() => setShowMobileKeyboard(true)}
        onSwipeUp={() => setShowMobileKeyboard(false)}
        class="flex-1 relative overflow-hidden terminal-container"
      >
        <div
          ref={terminalElement}
          id="enhanced-terminal-container"
          class="terminal-content h-full w-full"
          style={{
            opacity: opacity(),
            background: "transparent",
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </SwipeGesture>

      {/* Mobile Keyboard */}
      <Show when={showMobileKeyboard()}>
        <div
          ref={mobileKeyboardRef}
          class="bg-base-100 border-t border-base-300 p-3 shrink-0"
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
                class="text-xs"
              >
                {keyDef.label}
              </EnhancedButton>
            ))}
          </div>

          <div class="mt-3 text-xs opacity-70 text-center">
            Swipe down on terminal to show • Swipe up to hide • Pinch to zoom
          </div>
        </div>
      </Show>

      {/* Floating Action Buttons */}
      <Show when={!showMobileKeyboard() && !isFullscreen()}>
        <FloatingActionButton
          icon="⌨️"
          onClick={() => setShowMobileKeyboard(true)}
          position="bottom-right"
          variant="primary"
        />
      </Show>

      <Show when={props.isConnected && !isFullscreen()}>
        <FloatingActionButton
          icon="🔌"
          onClick={() => props.onDisconnect?.()}
          position="bottom-left"
          variant="secondary"
        />
      </Show>

      {/* Connection Status Overlay */}
      <Show when={!props.isConnected}>
        <div class="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div class="bg-base-100 p-6 rounded-lg text-center max-w-sm mx-4">
            <div class="text-4xl mb-2">📡</div>
            <div class="font-medium mb-2">No Connection</div>
            <div class="text-sm opacity-70 mb-4">
              Terminal will display content when connected to a P2P session
            </div>
            <EnhancedButton
              variant="primary"
              onClick={() => window.history.back()}
              icon="🏠"
            >
              Go to Connections
            </EnhancedButton>
          </div>
        </div>
      </Show>

      {/* Touch Hints */}
      <Show when={!showMobileKeyboard()}>
        <div class="absolute bottom-4 left-1/2 transform -translate-x-1/2 opacity-30 pointer-events-none">
          <div class="bg-black/70 text-white text-xs px-3 py-1 rounded-full">
            Swipe down for keyboard • Pinch to zoom
          </div>
        </div>
      </Show>
    </div>
  );
}

