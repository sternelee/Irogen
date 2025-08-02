import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { SearchAddon } from "xterm-addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";

interface TerminalEvent {
  timestamp: number;
  event_type:
    | "Output"
    | "Input"
    | { Resize: { width: number; height: number } }
    | "Start"
    | "End";
  data: string;
}

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

  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  useEffect(() => {
    // Initialize network when app starts
    initializeNetwork();

    return () => {
      if (terminal.current) {
        terminal.current.dispose();
      }
    };
  }, []);

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

    terminal.current = new Terminal({
      theme: {
        background: "#000000",
        foreground: "#ffffff",
        cursor: "#ffffff",
        selection: "#3e4452",
      },
      fontFamily: '"Cascadia Code", "Fira Code", "Source Code Pro", monospace',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: "block",
    });

    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(new WebLinksAddon());

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

  const handleConnect = async () => {
    if (!nodeAddress.trim()) {
      alert("Please enter session ticket");
      return;
    }

    setConnecting(true);

    try {
      // Setup terminal first
      setupTerminal();

      // Listen for terminal events
      const unlisten = await listen<TerminalEvent>(
        `terminal-event-${sessionId}`,
        (event) => {
          const terminalEvent = event.payload;

          if (terminal.current) {
            if (terminalEvent.event_type === "Output") {
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
        },
      );

      // Connect using session ticket
      await invoke("connect_to_peer", {
        sessionTicket: nodeAddress.trim(),
      });

      setIsConnected(true);
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
      setStatus("Disconnected");
      setNodeAddress("");
      setSessionId("");
    } catch (error) {
      console.error("Disconnect failed:", error);
    }
  };

  if (!isConnected) {
    return (
      <div className="app">
        <div className="connection-form">
          <h1>🌐 RiTerm - Remote Terminal</h1>
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
            className="connect-btn"
            onClick={handleConnect}
            disabled={connecting || !nodeAddress.trim()}
          >
            {connecting ? "Connecting..." : "Connect"}
          </button>
          <div
            style={{
              marginTop: "20px",
              textAlign: "center",
              fontSize: "12px",
              color: "#888",
            }}
          >
            Status: {status}
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
          Status: {status} | Session: {sessionId}
        </div>
        <button className="disconnect-btn" onClick={handleDisconnect}>
          Disconnect
        </button>
      </div>
      <div className="terminal-container">
        <div ref={terminalRef} className="terminal" />
      </div>
    </div>
  );
}

export default App;
