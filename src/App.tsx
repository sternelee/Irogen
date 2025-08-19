import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from 'xterm-addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './App.css';
import { useConnectionHistory } from './hooks/useConnectionHistory';
import { ConnectionView } from './components/ConnectionView';
import { TerminalView } from './components/TerminalView';

function App() {
  const [sessionTicket, setSessionTicket] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const { history, addHistoryEntry } = useConnectionHistory();

  const initializeNetwork = useCallback(async () => {
    try {
      const nodeId = await invoke<string>('initialize_network');
      setStatus(`Ready - Node ID: ${nodeId.substring(0, 8)}...`);
    } catch (error) {
      console.error('Failed to initialize network:', error);
      setStatus('Failed to initialize network');
    }
  }, []);

  useEffect(() => {
    initializeNetwork();
  }, [initializeNetwork]);

  const handleTerminalReady = useCallback((term: Terminal, addon: FitAddon) => {
    terminalInstance.current = term;
    fitAddon.current = addon;
    window.addEventListener('resize', () => addon.fit());
  }, []);

  const handleTerminalInput = useCallback((data: string) => {
    if (isConnected && sessionIdRef.current) {
      invoke('send_terminal_input', {
        sessionId: sessionIdRef.current,
        input: data,
      }).catch((error) => {
        console.error('Failed to send input:', error);
        terminalInstance.current?.writeln(`\r\n❌ Failed to send input: ${error}`);
      });
    }
  }, [isConnected]);

  const handleDisconnect = useCallback(async () => {
    if (terminalInstance.current) {
      terminalInstance.current.writeln('\r\n\x1b[1;33m👋 Disconnected from session\x1b[0m');
    }

    if (sessionIdRef.current) {
      try {
        await invoke('disconnect_session', { sessionId: sessionIdRef.current });
      } catch (error) {
        console.error('Failed to disconnect:', error);
      }
    }

    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    setIsConnected(false);
    sessionIdRef.current = null;
    setStatus('Disconnected');
  }, []);

  const handleConnect = useCallback(async () => {
    if (!sessionTicket.trim()) {
      alert('Please enter a session ticket.');
      return;
    }

    setConnecting(true);
    setStatus('Connecting...');
    setConnectionError(null);

    try {
      const actualSessionId = await invoke<string>('connect_to_peer', {
        sessionTicket: sessionTicket.trim(),
      });

      sessionIdRef.current = actualSessionId;
      addHistoryEntry(sessionTicket.trim());
      setIsConnected(true);

      const unlisten = await listen<any>(`terminal-event-${actualSessionId}`, (event) => {
        const termEvent = event.payload;
        if (terminalInstance.current) {
          if (termEvent.event_type === 'Output') {
            terminalInstance.current.write(termEvent.data);
          } else if (termEvent.event_type === 'End') {
            terminalInstance.current.writeln('\r\n\r\n[Session Ended]');
            handleDisconnect();
          }
        }
      });

      unlistenRef.current = unlisten;
      setStatus('Connected');
      terminalInstance.current?.clear();
      terminalInstance.current?.writeln('\r\n\x1b[1;32m✅ Connection established!\x1b[0m');
      terminalInstance.current?.focus();
    } catch (error) {
      console.error('Connection failed:', error);
      setStatus('Connection failed');
      setConnectionError(String(error));
    } finally {
      setConnecting(false);
    }
  }, [sessionTicket, addHistoryEntry, handleDisconnect]);

  return (
    <div className="app">
      <div className="header">
        <h1>iroh-code-remote</h1>
        <div className="status-bar">{status}</div>
      </div>

      <div className="terminal-container-wrapper">
        {isConnected ? (
          <TerminalView onReady={handleTerminalReady} onInput={handleTerminalInput} />
        ) : (
          <ConnectionView
            sessionTicket={sessionTicket}
            setSessionTicket={setSessionTicket}
            handleConnect={handleConnect}
            connecting={connecting}
            history={history}
            connectionError={connectionError}
          />
        )}
      </div>

      {isConnected && (
        <div className="controls">
          <button className="disconnect-btn" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
