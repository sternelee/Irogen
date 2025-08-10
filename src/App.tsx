import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { SearchAddon } from "xterm-addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";

interface TerminalTheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const themes: Record<string, TerminalTheme> = {
  dark: {
    name: "Dark",
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    selection: "rgba(62, 68, 82, 0.5)",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  },
  light: {
    name: "Light",
    background: "#ffffff",
    foreground: "#24292e",
    cursor: "#24292e",
    selection: "rgba(0, 0, 0, 0.1)",
    black: "#24292e",
    red: "#d73a49",
    green: "#28a745",
    yellow: "#ffd33d",
    blue: "#0366d6",
    magenta: "#ea4aaa",
    cyan: "#17a2b8",
    white: "#6a737d",
    brightBlack: "#959da5",
    brightRed: "#cb2431",
    brightGreen: "#22863a",
    brightYellow: "#b08800",
    brightBlue: "#005cc5",
    brightMagenta: "#e559f9",
    brightCyan: "#3192aa",
    brightWhite: "#d1d5da",
  },
  solarizedDark: {
    name: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    selection: "rgba(131, 148, 150, 0.3)",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  dracula: {
    name: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    selection: "rgba(248, 248, 242, 0.3)",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
};

const fontFamilies = [
  '"Cascadia Code", "Fira Code", "Source Code Pro", monospace',
  '"Fira Code", "Cascadia Code", "Source Code Pro", monospace',
  '"Source Code Pro", "Fira Code", "Cascadia Code", monospace',
  '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  '"Monaco", "Menlo", "Ubuntu Mono", monospace',
  '"Consolas", "Monaco", monospace',
];

interface ConnectionConfig {
  node_address: string;
  session_id: string;
}

interface ConnectionHistory {
  node_address: string;
  session_id: string;
  timestamp: number;
  nickname?: string;
}

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [nodeAddress, setNodeAddress] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionNickname, setSessionNickname] = useState("");
  const [status, setStatus] = useState("Disconnected");
  const [nodeId, setNodeId] = useState("");
  const [connectionHistory, setConnectionHistory] = useState<
    ConnectionHistory[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [currentTheme, setCurrentTheme] = useState<string>("dark");
  const [fontSize, setFontSize] = useState<number>(14);
  const [fontFamily, setFontFamily] = useState<string>(fontFamilies[0]);
  const [showSettings, setShowSettings] = useState(false);
  const [commandHistoryIndex, setCommandHistoryIndex] = useState<number>(-1);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [sessionDuration, setSessionDuration] = useState<string>("00:00");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);

  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const searchAddon = useRef<SearchAddon | null>(null);

  useEffect(() => {
    // Initialize network when app starts
    initializeNetwork();

    // Load saved preferences
    const savedTheme = localStorage.getItem("terminal-theme");
    const savedFontSize = localStorage.getItem("terminal-font-size");
    const savedFontFamily = localStorage.getItem("terminal-font-family");

    if (savedTheme && themes[savedTheme]) {
      setCurrentTheme(savedTheme);
    }
    if (savedFontSize) {
      setFontSize(Number(savedFontSize));
    }
    if (savedFontFamily) {
      setFontFamily(savedFontFamily);
    }

    return () => {
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
  }, []);

  useEffect(() => {
    // Save preferences to localStorage
    localStorage.setItem("terminal-theme", currentTheme);
    localStorage.setItem("terminal-font-size", fontSize.toString());
    localStorage.setItem("terminal-font-family", fontFamily);
  }, [currentTheme, fontSize, fontFamily]);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (sessionStartTime && isConnected) {
      interval = setInterval(() => {
        const now = Date.now();
        const duration = Math.floor((now - sessionStartTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        setSessionDuration(
          `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
        );
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [sessionStartTime, isConnected]);

  const initializeNetwork = async () => {
    try {
      const nodeId = await invoke<string>("initialize_network");
      setStatus(`Ready - Node ID: ${nodeId.substring(0, 8)}...`);
    } catch (error) {
      console.error("Failed to initialize network:", error);
      setStatus("Failed to initialize network");
    }
  };

  const setupTerminal = () => {
    if (!terminalRef.current) return;

    const theme = themes[currentTheme];

    terminal.current = new Terminal({
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selection: theme.selection,
        black: theme.black,
        red: theme.red,
        green: theme.green,
        yellow: theme.yellow,
        blue: theme.blue,
        magenta: theme.magenta,
        cyan: theme.cyan,
        white: theme.white,
        brightBlack: theme.brightBlack,
        brightRed: theme.brightRed,
        brightGreen: theme.brightGreen,
        brightYellow: theme.brightYellow,
        brightBlue: theme.brightBlue,
        brightMagenta: theme.brightMagenta,
        brightCyan: theme.brightCyan,
        brightWhite: theme.brightWhite,
      },
      fontFamily: fontFamily,
      fontSize: fontSize,
      cursorBlink: true,
      cursorStyle: "block",
      allowTransparency: true,
      scrollback: 10000,
    });

    fitAddon.current = new FitAddon();
    searchAddon.current = new SearchAddon();
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(new WebLinksAddon());
    terminal.current.loadAddon(searchAddon.current);

    terminal.current.open(terminalRef.current);
    fitAddon.current.fit();

    // Handle terminal input
    terminal.current.onData((data) => {
      if (isConnected && sessionId) {
        invoke("send_terminal_input", {
          sessionId: sessionId,
          input: data,
        }).catch(console.error);
      }
    });

    // Handle window resize
    const handleResize = () => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  };

  const updateTerminalTheme = () => {
    if (terminal.current) {
      const theme = themes[currentTheme];
      terminal.current.options.theme = {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selection: theme.selection,
        black: theme.black,
        red: theme.red,
        green: theme.green,
        yellow: theme.yellow,
        blue: theme.blue,
        magenta: theme.magenta,
        cyan: theme.cyan,
        white: theme.white,
        brightBlack: theme.brightBlack,
        brightRed: theme.brightRed,
        brightGreen: theme.brightGreen,
        brightYellow: theme.brightYellow,
        brightBlue: theme.brightBlue,
        brightMagenta: theme.brightMagenta,
        brightCyan: theme.brightCyan,
        brightWhite: theme.brightWhite,
      };
    }
  };

  const updateTerminalFont = () => {
    if (terminal.current) {
      terminal.current.options.fontFamily = fontFamily;
      terminal.current.options.fontSize = fontSize;
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    }
  };

  useEffect(() => {
    updateTerminalTheme();
  }, [currentTheme]);

  useEffect(() => {
    updateTerminalFont();
  }, [fontFamily, fontSize]);

  const handleConnect = async () => {
    if (!nodeAddress.trim()) {
      alert("Please enter session ticket");
      return;
    }

    setConnecting(true);

    try {
      // Setup terminal first
      setupTerminal();

      // Connect using session ticket and get the session ID
      const actualSessionId = await invoke<string>("connect_to_peer", {
        sessionTicket: nodeAddress.trim(),
      });

      console.log(`Connected with session ID: ${actualSessionId}`);

      // Listen for terminal events using the actual session ID
      const eventName = `terminal-event-${actualSessionId}`;
      console.log(`Listening for events: ${eventName}`);

      const unlisten = await listen<TerminalEvent>(eventName, (event) => {
        console.log("Received terminal event:", event);
        const terminalEvent = event.payload;

        if (terminal.current) {
          if (terminalEvent.event_type === "Output") {
            console.log("Writing output to terminal:", terminalEvent.data);
            terminal.current.write(terminalEvent.data);
          } else if (terminalEvent.event_type === "Start") {
            terminal.current.writeln(
              `🎬 Session started: ${terminalEvent.data}`,
            );
            setStatus("Connected");
          } else if (terminalEvent.event_type === "End") {
            terminal.current.writeln("\r\n🛑 Session ended");
            setStatus("Session ended");
            setIsConnected(false);
          }
        }
      });

      // Set the session ID for later use
      setSessionId(actualSessionId);

      setIsConnected(true);
      setSessionStartTime(Date.now());
      setStatus("Connecting...");

      // Store the unlisten function for cleanup
      (window as any).unlistenTerminalEvents = unlisten;
    } catch (error) {
      console.error("Connection failed:", error);
      alert(`Connection failed: ${error}`);
      setStatus("Connection failed");

      if (terminal.current) {
        terminal.current.dispose();
        terminal.current = null;
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (sessionId) {
        await invoke("disconnect_session", { sessionId });
      }

      // Clean up event listener
      if ((window as any).unlistenTerminalEvents) {
        (window as any).unlistenTerminalEvents();
        (window as any).unlistenTerminalEvents = null;
      }

      if (terminal.current) {
        terminal.current.dispose();
        terminal.current = null;
      }

      setIsConnected(false);
      setSessionStartTime(null);
      setSessionDuration("00:00");
      setStatus("Disconnected");
      setNodeAddress("");
      setSessionId("");
      setTerminalOutput([]);
    } catch (error) {
      console.error("Disconnect failed:", error);
    }
  };

  const executeCommand = async (command: string) => {
    if (!isConnected || !sessionId || !command.trim()) return;

    // Add command to history
    setCommandHistory((prev) => [...prev, command]);

    // Display command in terminal
    if (terminal.current) {
      terminal.current.writeln(`$ ${command}`);
    }

    try {
      // Send command using the new execute_remote_command function
      await invoke("execute_remote_command", {
        command: command,
        sessionId: sessionId,
      });

      setCommandInput("");
    } catch (error) {
      console.error("Failed to execute command:", error);
      if (terminal.current) {
        terminal.current.writeln(`Error: ${error}`);
      }
    }
  };

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    executeCommand(commandInput);
  };

  const handleCommandKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" && commandHistory.length > 0) {
      e.preventDefault();
      if (commandHistoryIndex === -1) {
        setCommandHistoryIndex(commandHistory.length - 1);
        setCommandInput(commandHistory[commandHistory.length - 1]);
      } else if (commandHistoryIndex > 0) {
        setCommandHistoryIndex(commandHistoryIndex - 1);
        setCommandInput(commandHistory[commandHistoryIndex]);
      }
    } else if (e.key === "ArrowDown" && commandHistory.length > 0) {
      e.preventDefault();
      if (commandHistoryIndex < commandHistory.length - 1) {
        setCommandHistoryIndex(commandHistoryIndex + 1);
        setCommandInput(commandHistory[commandHistoryIndex]);
      } else {
        setCommandHistoryIndex(-1);
        setCommandInput("");
      }
    } else if (e.key === "Enter") {
      setCommandHistoryIndex(-1);
    }
  };

  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ctrl+K: Clear terminal
      if (e.ctrlKey && e.key === "k" && terminal.current) {
        e.preventDefault();
        terminal.current.clear();
      }
      // Ctrl+L: Clear terminal (alternative)
      else if (e.ctrlKey && e.key === "l" && terminal.current) {
        e.preventDefault();
        terminal.current.clear();
      }
      // Ctrl+F: Open find dialog
      else if (e.ctrlKey && e.key === "f" && terminal.current) {
        e.preventDefault();
        const searchTerm = prompt("Search terminal:");
        if (searchTerm && searchAddon.current) {
          searchAddon.current.findNext(searchTerm);
        }
      }
      // Ctrl+T: Toggle settings
      else if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        setShowSettings(!showSettings);
      }
      // Ctrl+N: New session
      else if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        handleDisconnect();
      }
    },
    [showSettings],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [handleGlobalKeyDown]);

  const clearCommandHistory = () => {
    setCommandHistory([]);
    setCommandHistoryIndex(-1);
    setCommandInput("");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      if (terminal.current) {
        terminal.current.writeln("\r\n✓ Copied to clipboard");
      }
    });
  };

  const filteredCommandHistory = commandHistory.filter((cmd) =>
    cmd.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (!isConnected) {
    return (
      <div className="app">
        <div className="connection-form">
          <div className="header">
            <h1>🌐 RiTerm - Remote Terminal</h1>
            <button
              className="settings-btn"
              onClick={() => setShowSettings(!showSettings)}
              title="Settings"
            >
              ⚙️
            </button>
          </div>

          {showSettings && (
            <div className="settings-panel">
              <h3>Settings</h3>
              <div className="setting-group">
                <label>Theme:</label>
                <select
                  value={currentTheme}
                  onChange={(e) => setCurrentTheme(e.target.value)}
                >
                  {Object.entries(themes).map(([key, theme]) => (
                    <option key={key} value={key}>
                      {theme.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="setting-group">
                <label>Font Size:</label>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                />
                <span>{fontSize}px</span>
              </div>
              <div className="setting-group">
                <label>Font Family:</label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                >
                  {fontFamilies.map((font, index) => (
                    <option key={index} value={font}>
                      {font.split(",")[0].replace(/"/g, "")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="nodeAddress">Session Ticket:</label>
            <input
              id="nodeAddress"
              type="text"
              value={nodeAddress}
              onChange={(e) => setNodeAddress(e.target.value)}
              placeholder="Paste session ticket here"
              disabled={connecting}
            />
          </div>
          <button
            className="connect-btn ripple"
            onClick={handleConnect}
            disabled={connecting || !nodeAddress.trim()}
          >
            {connecting ? (
              <>
                <span className="loading-spinner"></span>
                <span>Connecting...</span>
              </>
            ) : (
              <span>Connect</span>
            )}
          </button>
          <div className="status-text">Status: {status}</div>
          <div className="shortcuts-hint">
            <strong>Keyboard Shortcuts:</strong>
            <div>Ctrl+T: Toggle Settings</div>
            <div>Ctrl+K/L: Clear Terminal</div>
            <div>Ctrl+F: Find in Terminal</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="status-bar">
        <div
          className={`status ${isConnected ? "status-connected" : "status-disconnected"}`}
        >
          <span className="status-indicator"></span>
          <div className="status-info">
            <span>{status}</span>
            {isConnected && (
              <>
                <span className="session-separator">•</span>
                <span className="session-id">
                  Session: {sessionId.substring(0, 8)}...
                </span>
                <span className="session-separator">•</span>
                <span className="session-duration">⏱️ {sessionDuration}</span>
              </>
            )}
          </div>
        </div>
        <div className="status-controls">
          <button
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings (Ctrl+T)"
          >
            ⚙️
          </button>
          <button className="disconnect-btn" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <div className="settings-header">
            <h3>⚙️ Settings</h3>
            <button
              className="close-btn"
              onClick={() => setShowSettings(false)}
            >
              ×
            </button>
          </div>
          <div className="settings-content">
            <div className="setting-group">
              <label>Theme:</label>
              <select
                value={currentTheme}
                onChange={(e) => setCurrentTheme(e.target.value)}
              >
                {Object.entries(themes).map(([key, theme]) => (
                  <option key={key} value={key}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="setting-group">
              <label>Font Size:</label>
              <input
                type="range"
                min="10"
                max="24"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
              <span>{fontSize}px</span>
            </div>
            <div className="setting-group">
              <label>Font Family:</label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
              >
                {fontFamilies.map((font, index) => (
                  <option key={index} value={font}>
                    {font.split(",")[0].replace(/"/g, "")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="terminal-container">
        <div ref={terminalRef} className="terminal" />
      </div>

      <div className="command-section">
        <div className="command-input-container">
          <form onSubmit={handleCommandSubmit} className="command-form">
            <div className="command-input-wrapper">
              <span className="command-prompt">$</span>
              <input
                type="text"
                value={commandInput}
                onChange={(e) => {
                  setCommandInput(e.target.value);
                  setCommandHistoryIndex(-1);
                }}
                onKeyDown={handleCommandKeyDown}
                placeholder="Enter command to execute remotely..."
                className="command-input"
                disabled={!isConnected}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="execute-btn ripple"
              disabled={!isConnected || !commandInput.trim()}
              title="Execute command"
            >
              <span>▶</span>
              <span>Execute</span>
            </button>
          </form>

          {commandHistory.length > 0 && (
            <div className="command-history-panel">
              <div className="history-header">
                <h4>Command History ({commandHistory.length})</h4>
                <div className="history-controls">
                  <input
                    type="text"
                    placeholder="Search history..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="history-search"
                  />
                  <button
                    onClick={clearCommandHistory}
                    className="clear-history-btn"
                    title="Clear history"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <div className="history-list">
                {filteredCommandHistory
                  .slice(-20)
                  .reverse()
                  .map((cmd, index) => (
                    <div
                      key={index}
                      className="history-item"
                      onClick={() => {
                        setCommandInput(cmd);
                        setSearchQuery("");
                      }}
                    >
                      <span className="history-cmd">{cmd}</span>
                      <button
                        className="copy-cmd-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(cmd);
                        }}
                        title="Copy command"
                      >
                        📋
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        <div className="shortcuts-bar">
          <div className="shortcuts-hint">
            <strong>Shortcuts:</strong>
            <span>Ctrl+K/L: Clear</span>
            <span>Ctrl+F: Find</span>
            <span>Ctrl+T: Settings</span>
            <span>↑↓: History</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
