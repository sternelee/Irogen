import { onMount, onCleanup, createEffect } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { SearchAddon } from "xterm-addon-search";
import { WandSparkles } from "lucide-solid";
import "xterm/css/xterm.css";
import { settingsStore } from "../stores/settingsStore";

interface TerminalViewProps {
  onInput: (data: string) => void;
  onReady: (terminal: Terminal, fitAddon: FitAddon) => void;
}

export function TerminalView(props: TerminalViewProps) {
  let terminalRef: HTMLDivElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let terminalInstance: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let searchAddon: SearchAddon | null = null;
  let onDataDispose: { dispose: () => void } | null = null;

  // Dynamic theme based on settings
  const getTerminalTheme = () => {
    const theme = settingsStore.get().theme;
    const opacity = settingsStore.get().terminalOpacity;

    const themeMap = {
      "terminal-green": {
        background: `rgba(0, 0, 0, ${opacity})`,
        foreground: "#00ff41",
        cursor: "#00ff41",
        cursorAccent: "#000000",
        selection: "rgba(0, 255, 65, 0.3)",
        black: "#000000",
        red: "#ff0000",
        green: "#00ff41",
        yellow: "#ffaa00",
        blue: "#0099ff",
        magenta: "#ff00ff",
        cyan: "#00ffff",
        white: "#ffffff",
        brightBlack: "#444444",
        brightRed: "#ff4444",
        brightGreen: "#44ff44",
        brightYellow: "#ffff44",
        brightBlue: "#4444ff",
        brightMagenta: "#ff44ff",
        brightCyan: "#44ffff",
        brightWhite: "#ffffff",
      },
      "terminal-amber": {
        background: `rgba(10, 10, 8, ${opacity})`,
        foreground: "#ffaa00",
        cursor: "#ffaa00",
        cursorAccent: "#000000",
        selection: "rgba(255, 170, 0, 0.3)",
        black: "#000000",
        red: "#ff4444",
        green: "#88ff00",
        yellow: "#ffaa00",
        blue: "#0099ff",
        magenta: "#ff8800",
        cyan: "#00aaff",
        white: "#ffffff",
        brightBlack: "#444444",
        brightRed: "#ff6666",
        brightGreen: "#aaff22",
        brightYellow: "#ffcc22",
        brightBlue: "#2299ff",
        brightMagenta: "#ffaa22",
        brightCyan: "#22aaff",
        brightWhite: "#ffffff",
      },
      "terminal-cyan": {
        background: `rgba(0, 17, 17, ${opacity})`,
        foreground: "#00ffff",
        cursor: "#00ffff",
        cursorAccent: "#000000",
        selection: "rgba(0, 255, 255, 0.3)",
        black: "#000000",
        red: "#ff4444",
        green: "#44ff44",
        yellow: "#ffaa00",
        blue: "#4488ff",
        magenta: "#ff44ff",
        cyan: "#00ffff",
        white: "#ffffff",
        brightBlack: "#444444",
        brightRed: "#ff6666",
        brightGreen: "#66ff66",
        brightYellow: "#ffcc22",
        brightBlue: "#6699ff",
        brightMagenta: "#ff66ff",
        brightCyan: "#22ffff",
        brightWhite: "#ffffff",
      },
    };

    return themeMap[theme];
  };

  const getFontSettings = () => {
    const fontSize = settingsStore.get().fontSize;
    const fontSizeMap = {
      small: 12,
      medium: 14,
      large: 16,
      "extra-large": 18,
    };

    return {
      fontSize: fontSizeMap[fontSize],
      fontFamily:
        "JetBrains Mono, Fira Code, Cascadia Code, SF Mono, Monaco, Inconsolata, Roboto Mono, Source Code Pro, Menlo, Consolas, DejaVu Sans Mono, monospace",
    };
  };

  const initializeTerminal = () => {
    if (terminalRef && !terminalInstance) {
      const fontSettings = getFontSettings();

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10000,
        theme: getTerminalTheme(),
        fontSize: fontSettings.fontSize,
        fontFamily: fontSettings.fontFamily,
        letterSpacing: 0.5,
        lineHeight: 1.2,
        allowProposedApi: true,
        allowTransparency: true,
        convertEol: true,
        screenReaderMode: false,
        rightClickSelectsWord: true,
        macOptionIsMeta: true,
        fastScrollModifier: "alt",
        fastScrollSensitivity: 5,
        scrollSensitivity: 3,
        minimumContrastRatio: 4.5,
      });

      // Load addons
      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const searchAddon = new SearchAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(searchAddon);

      // Store references
      terminalInstance = term;
      TerminalView.fitAddon = fitAddon;
      TerminalView.searchAddon = searchAddon;

      // Open terminal
      term.open(terminalRef);
      fitAddon.fit();

      // Add terminal-specific styling
      if (terminalRef) {
        terminalRef.style.background = "transparent";
        const terminalElement = terminalRef.querySelector(".terminal");
        if (terminalElement) {
          (terminalElement as HTMLElement).style.background = "transparent";
        }
      }

      // Welcome message with cyber styling
      const welcomeMessage = [
        "\x1b[1;32m╔══════════════════════════════════════════════════════════════╗\x1b[0m",
        "\x1b[1;32m║\x1b[0m                    \x1b[1;36mRiTerm P2P Terminal\x1b[0m                       \x1b[1;32m║\x1b[0m",
        "\x1b[1;32m║\x1b[0m                  \x1b[36mSecure • Fast • Decentralized\x1b[0m               \x1b[1;32m║\x1b[0m",
        "\x1b[1;32m╚══════════════════════════════════════════════════════════════╝\x1b[0m",
        "",
        "\x1b[33m[INFO]\x1b[0m Terminal initialized with cyber theme",
        "\x1b[33m[INFO]\x1b[0m P2P network stack ready",
        "\x1b[32m[READY]\x1b[0m Awaiting connection...",
        "",
      ].join("\r\n");

      term.write(welcomeMessage);
      term.focus();

      // Setup callbacks
      props.onReady(term, fitAddon);

      onDataDispose = term.onData((data) => {
        props.onInput(data);
      });

      // Handle resize
      const handleResize = () => {
        if (fitAddon && terminalInstance) {
          setTimeout(() => fitAddon.fit(), 100);
        }
      };

      window.addEventListener("resize", handleResize);
      onCleanup(() => window.removeEventListener("resize", handleResize));
    }
  };

  // Update terminal theme when settings change
  createEffect(() => {
    if (terminalInstance) {
      terminalInstance.options.theme = getTerminalTheme();
      const fontSettings = getFontSettings();
      terminalInstance.options.fontSize = fontSettings.fontSize;
      terminalInstance.options.fontFamily = fontSettings.fontFamily;

      if (TerminalView.fitAddon) {
        TerminalView.fitAddon.fit();
      }
    }
  });

  onMount(() => {
    // Delay initialization slightly to ensure DOM is ready
    setTimeout(initializeTerminal, 50);
  });

  onCleanup(() => {
    if (onDataDispose) {
      onDataDispose.dispose();
    }
    if (terminalInstance) {
      terminalInstance.dispose();
      terminalInstance = null;
    }
  });

  return (
    <div
      ref={containerRef}
      class="terminal-container h-full w-full flex flex-col overflow-hidden"
    >
      {/* Terminal Content Area */}
      <div class="flex-1 relative overflow-hidden">
        {/* Terminal Background Effects */}

        {/* Scanning Line Effect */}
        <div
          class="absolute inset-0 pointer-events-none z-10"
          classList={{ hidden: !settingsStore.get().enableScanLines }}
        >
          <div class="scan-line" />
        </div>

        {/* Terminal Content */}
        <div class="relative z-20 h-full">
          <div
            ref={terminalRef}
            class="terminal-content h-full w-full terminal-glow"
            style={{
              filter: settingsStore.get().customCSSFilters || "none",
            }}
          />
        </div>

        {/* Corner Decorations */}
        <div class="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-current opacity-50 pointer-events-none z-30" />
        <div class="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-current opacity-50 pointer-events-none z-30" />
        <div class="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-current opacity-50 pointer-events-none z-30" />
        <div class="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-current opacity-50 pointer-events-none z-30" />

        {/* Status Bar - Only show on desktop */}
        <div class="hidden md:block absolute bottom-0 right-0 p-2 text-xs font-mono opacity-50 pointer-events-none z-30">
          <div class="flex items-center space-x-2">
            <span>SECURE</span>
            <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          </div>
        </div>
      </div>

      {/* Mobile Terminal Toolbar - Only visible on mobile */}
      <div class="md:hidden flex-shrink-0 bg-gray-900/90 backdrop-blur-sm border-t border-gray-700">
        <div class="flex items-center justify-between px-2 py-2">
          {/* Left side buttons */}
          <div class="flex items-center space-x-1">
            <button
              class="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("\x1b")}
              title="ESC"
            >
              ESC
            </button>
            <button
              class="p-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("\t")}
              title="Tab"
            >
              ⇥
            </button>
            <button
              class="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("~")}
              title="~"
            >
              ~
            </button>
            <button
              class="px-3 py-2 h-9.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("~")}
              title="~"
            >
              <WandSparkles size={14} />
            </button>
          </div>

          {/* Center arrow keys */}
          <div class="flex items-center space-x-1">
            <div class="grid grid-cols-3 gap-1 hidden">
              <div></div>
              <button
                class="w-8 h-8 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded border border-gray-600 active:bg-gray-600 transition-colors flex items-center justify-center"
                onClick={() => terminalInstance?.write("\x1b[A")}
                title="Up"
              >
                ↑
              </button>
              <div></div>
              <button
                class="w-8 h-8 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded border border-gray-600 active:bg-gray-600 transition-colors flex items-center justify-center"
                onClick={() => terminalInstance?.write("\x1b[D")}
                title="Left"
              >
                ←
              </button>
              <button
                class="w-8 h-8 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded border border-gray-600 active:bg-gray-600 transition-colors flex items-center justify-center"
                onClick={() => terminalInstance?.write("\x1b[B")}
                title="Down"
              >
                ↓
              </button>
              <button
                class="w-8 h-8 bg-gray-800 hover:bg-gray-700 text-white text-xs rounded border border-gray-600 active:bg-gray-600 transition-colors flex items-center justify-center"
                onClick={() => terminalInstance?.write("\x1b[C")}
                title="Right"
              >
                →
              </button>
            </div>
          </div>

          {/* Right side buttons */}
          <div class="flex items-center space-x-1">
            <button
              class="px-3 py-2 bg-blue-800 hover:bg-blue-700 text-white text-sm font-mono rounded border border-blue-600 active:bg-blue-600 transition-colors"
              onClick={() => terminalInstance?.write("\x03")}
              title="Ctrl+C"
            >
              Ctrl
            </button>
            <button
              class="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => {
                // Toggle virtual keyboard
                const input = document.createElement("input");
                input.style.position = "absolute";
                input.style.left = "-9999px";
                document.body.appendChild(input);
                input.focus();
                setTimeout(() => document.body.removeChild(input), 100);
              }}
              title="Keyboard"
            >
              ⌨
            </button>
          </div>
        </div>

        {/* Second row with more functions */}
        <div class="flex items-center justify-between px-2 pb-2 hidden">
          <div class="flex items-center space-x-1">
            <button
              class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("|")}
              title="Pipe"
            >
              |
            </button>
            <button
              class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("&")}
              title="&"
            >
              &
            </button>
            <button
              class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("$")}
              title="$"
            >
              $
            </button>
            <button
              class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("/")}
              title="/"
            >
              /
            </button>
          </div>

          <div class="flex items-center space-x-1 hidden">
            <button
              class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("\x7f")}
              title="Backspace"
            >
              ⌫
            </button>
            <button
              class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-mono rounded border border-gray-600 active:bg-gray-600 transition-colors"
              onClick={() => terminalInstance?.write("\r")}
              title="Enter"
            >
              ↵
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Static references for external access
TerminalView.fitAddon = null;
TerminalView.searchAddon = null;
