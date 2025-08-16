import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { SearchAddon } from "xterm-addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { type } from "@tauri-apps/plugin-os";
import { scan, Format } from "@tauri-apps/plugin-barcode-scanner";
import "xterm/css/xterm.css";
import TitleBar from "./components/TitleBar";
import "./components/TitleBar.css";
import "./components/Tabs.css";

// Interfaces
export interface Session {
  id: number;
  sessionId: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  unlisten: UnlistenFn;
  title: string;
  isConnected: boolean;
}

export interface ConnectionRecord {
  id: string;
  ticket: string;
  timestamp: number;
  name?: string;
}

interface TerminalTheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

const themes: Record<string, TerminalTheme> = {
  dark: {
    name: "Dark",
    background: "rgba(0, 0, 0, 0.5)", // Make it semi-transparent
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
    background: "rgba(255, 255, 255, 0.5)",
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
};

const fontFamilies = [
  '"Cascadia Code", "Fira Code", "Source Code Pro", monospace',
  '"Fira Code", "Cascadia Code", "Source Code Pro", monospace',
];

function App() {
  // Use React to avoid TS6133 error
  React.useEffect;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessionTicket, setSessionTicket] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const [currentTheme, setCurrentTheme] = useState<string>("dark");
  const [fontSize, setFontSize] = useState<number>(15);
  const [fontFamily, setFontFamily] = useState<string>(fontFamilies[0]);
  const [isMobile, setIsMobile] = useState(false);
  const [connectionHistory, setConnectionHistory] = useState<ConnectionRecord[]>([]);

  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const nextSessionId = useRef(0);

  // Load settings and initialize network on mount
  useEffect(() => {
    initializeNetwork();
    const savedTheme = localStorage.getItem("terminal-theme");
    const savedFontSize = localStorage.getItem("terminal-font-size");
    const savedFontFamily = localStorage.getItem("terminal-font-family");
    const savedConnectionHistory = localStorage.getItem("connection-history");

    if (savedTheme && themes[savedTheme]) setCurrentTheme(savedTheme);
    if (savedFontSize) setFontSize(Number(savedFontSize));
    if (savedFontFamily) setFontFamily(savedFontFamily);
    if (savedConnectionHistory) {
      try {
        setConnectionHistory(JSON.parse(savedConnectionHistory));
      } catch (e) {
        console.error("Failed to parse connection history", e);
      }
    }

    // Check if running on mobile
    const checkPlatform = async () => {
      try {
        const osType = await type();
        setIsMobile(osType === "ios" || osType === "android");
      } catch (error) {
        console.log("Could not detect platform, assuming desktop");
      }
    };
    checkPlatform();

    // Create the first tab on startup
    handleNewTab();
  }, []);

  const addConnectionToHistory = (ticket: string) => {
    const newRecord: ConnectionRecord = {
      id: Date.now().toString(),
      ticket,
      timestamp: Date.now(),
    };

    setConnectionHistory(prev => {
      // Remove duplicates and limit to 10 records
      const filtered = prev.filter(record => record.ticket !== ticket);
      return [newRecord, ...filtered].slice(0, 10);
    });
  };

  const handleScanQRCode = async () => {
    try {
      const result = await scan({
        cameraDirection: 'back',
        formats: [Format.QRCode]
      });

      if (result && result.content) {
        setSessionTicket(result.content);
      }
    } catch (error) {
      console.error("Failed to scan QR code:", error);
      alert("Failed to scan QR code: " + (error as Error).message);
    }
  };

  // Save settings when they change
  useEffect(() => {
    localStorage.setItem("terminal-theme", currentTheme);
    localStorage.setItem("terminal-font-size", fontSize.toString());
    localStorage.setItem("terminal-font-family", fontFamily);
  }, [currentTheme, fontSize, fontFamily]);

  // Save connection history when it changes
  useEffect(() => {
    localStorage.setItem("connection-history", JSON.stringify(connectionHistory));
  }, [connectionHistory]);

  // Effect to manage terminal attachment and settings updates
  useEffect(() => {
    if (!terminalContainerRef.current) return;

    // Detach all terminals first
    while (terminalContainerRef.current.firstChild) {
      terminalContainerRef.current.removeChild(
        terminalContainerRef.current.firstChild,
      );
    }

    const activeSession = sessions.find((s) => s.id === activeSessionId);
    if (activeSession) {
      // Attach the active terminal
      activeSession.terminal.open(terminalContainerRef.current);
      activeSession.fitAddon.fit();
      activeSession.terminal.focus();
    }

    // Update theme and font for all terminals
    sessions.forEach((session) => {
      session.terminal.options.theme = themes[currentTheme];
      session.terminal.options.fontFamily = fontFamily;
      session.terminal.options.fontSize = fontSize;
      session.fitAddon.fit();
    });
  }, [activeSessionId, sessions, currentTheme, fontSize, fontFamily]);

  const initializeNetwork = async () => {
    try {
      const nodeId = await invoke<string>("initialize_network");
      setStatus(`Ready - Node ID: ${nodeId.substring(0, 8)}...`);
    } catch (error) {
      console.error("Failed to initialize network:", error);
      setStatus("Failed to initialize network");
    }
  };

  const handleNewTab = () => {
    const newId = nextSessionId.current++;

    const term = new Terminal({
      theme: themes[currentTheme],
      fontFamily,
      fontSize,
      cursorBlink: true,
      cursorStyle: "block",
      allowTransparency: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(searchAddon);

    const newSession: Omit<Session, "sessionId" | "unlisten"> = {
      id: newId,
      terminal: term,
      fitAddon,
      searchAddon,
      title: `Session ${newId + 1}`,
      isConnected: false,
    };

    // Temporarily add to state to render the connection form
    setSessions((s) => [
      ...s,
      { ...newSession, sessionId: "", unlisten: () => { } },
    ]);
    setActiveSessionId(newId);
  };

  const handleConnect = async (tabId: number, ticket: string) => {
    if (!ticket.trim()) {
      alert("Please enter a session ticket.");
      return;
    }
    setConnecting(true);
    setStatus("Connecting...");

    const session = sessions.find((s) => s.id === tabId);
    if (!session) return;

    session.terminal.writeln("Attempting to connect...");

    try {
      const actualSessionId = await invoke<string>("connect_to_peer", {
        sessionTicket: ticket.trim(),
      });
      const eventName = `terminal-event-${actualSessionId}`;

      const unlisten = await listen<any>(eventName, (event) => {
        const termEvent = event.payload;
        const targetSession = sessions.find(
          (s) => s.sessionId === actualSessionId,
        );
        if (targetSession) {
          if (termEvent.event_type === "Output") {
            targetSession.terminal.write(termEvent.data);
          } else if (termEvent.event_type === "End") {
            targetSession.terminal.writeln("\r\n\r\n[Session Ended]");
            handleCloseTab(targetSession.id);
          }
        }
      });

      setSessions((s) =>
        s.map((sess) =>
          sess.id === tabId
            ? {
              ...sess,
              sessionId: actualSessionId,
              unlisten,
              isConnected: true,
              title: `Remote ${actualSessionId.substring(0, 6)}`,
            }
            : sess,
        ),
      );

      // Add to connection history
      addConnectionToHistory(ticket.trim());

      setStatus("Connected");
      session.terminal.clear();
      session.terminal.writeln("✅ Connection established.");
      session.terminal.focus();

      session.terminal.onData((data) => {
        if (actualSessionId) {
          invoke("send_terminal_input", {
            sessionId: actualSessionId,
            input: data,
          }).catch(console.error);
        }
      });
    } catch (error) {
      console.error("Connection failed:", error);
      setStatus("Connection failed");
      session.terminal.writeln(`\r\n❌ Connection failed: ${error}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleCloseTab = (id: number) => {
    const sessionToClose = sessions.find((s) => s.id === id);
    if (sessionToClose) {
      if (sessionToClose.isConnected) {
        invoke("disconnect_session", { sessionId: sessionToClose.sessionId });
        sessionToClose.unlisten();
      }
      sessionToClose.terminal.dispose();
    }

    setSessions((s) => {
      const remaining = s.filter((sess) => sess.id !== id);
      if (activeSessionId === id) {
        setActiveSessionId(remaining[remaining.length - 1]?.id ?? null);
      }
      return remaining;
    });
  };

  return (
    <div className="app">
      <TitleBar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onTabClick={setActiveSessionId}
      />

      <div ref={terminalContainerRef} className="terminal-container" />

      {sessions.length === 0 && (
        <div className="connection-overlay">
          <div className="connection-form">
            <h1>No Active Sessions</h1>
            <p>Click the '+' in the title bar to start a new session.</p>
          </div>
        </div>
      )}

      {sessions.map(
        (session) =>
          !session.isConnected &&
          activeSessionId === session.id && (
            <div key={session.id} className="connection-overlay">
              <div className="connection-form">
                <h1>Connect to a Session</h1>
                <p>{status}</p>

                {/* Connection History */}
                {connectionHistory.length > 0 && (
                  <div className="history-section">
                    <h3>Recent Connections</h3>
                    <div className="history-list">
                      {connectionHistory.map((record) => (
                        <div
                          key={record.id}
                          className="history-item"
                          onClick={() => {
                            setSessionTicket(record.ticket);
                          }}
                        >
                          <span className="history-ticket">{record.ticket.substring(0, 30)}{record.ticket.length > 30 ? '...' : ''}</span>
                          <span className="history-time">
                            {new Date(record.timestamp).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <div className="input-group">
                    <input
                      type="text"
                      value={sessionTicket}
                      onChange={(e) => setSessionTicket(e.target.value)}
                      placeholder="Paste session ticket here"
                      disabled={connecting}
                      autoFocus
                      className="ticket-input"
                    />
                    {isMobile && (
                      <button
                        className="scan-btn ripple"
                        onClick={handleScanQRCode}
                        disabled={connecting}
                        title="Scan QR Code"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          <path d="M3 9h18"></path>
                          <path d="M9 21v-6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v6"></path>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <button
                  className="connect-btn ripple"
                  onClick={() => handleConnect(session.id, sessionTicket)}
                  disabled={connecting || !sessionTicket.trim()}
                >
                  {connecting ? "Connecting..." : "Connect"}
                </button>
              </div>
            </div>
          ),
      )}
    </div>
  );
}

export default App;
