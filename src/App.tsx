import React, { useState, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import 'xterm/css/xterm.css';
import './App.css';

function App() {
  const [sessionTicket, setSessionTicket] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const isConnectedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Initialize terminal
  useEffect(() => {
    if (terminalRef.current) {
      // Create terminal instance
      terminalInstance.current = new Terminal({
        cursorBlink: true,
        theme: {
          background: '#000000',
          foreground: '#ffffff',
          cursor: '#ffffff',
        },
        fontSize: 14,
        fontFamily: 'Monaco, "Courier New", monospace',
        allowProposedApi: true,
      });

      // Load addons
      fitAddon.current = new FitAddon();
      terminalInstance.current.loadAddon(fitAddon.current);
      terminalInstance.current.loadAddon(new WebLinksAddon());

      // Open terminal in container
      terminalInstance.current.open(terminalRef.current);

      // Fit terminal to container
      fitAddon.current.fit();

      // Display welcome message
      terminalInstance.current.writeln('\r\n\x1b[1;32m✨ Welcome to iroh-code-remote Terminal!\x1b[0m');
      terminalInstance.current.writeln('\r\n\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminalInstance.current.writeln('\r\n🚀 Ready to connect to remote sessions');
      terminalInstance.current.writeln('\r\n💡 Available commands:');
      terminalInstance.current.writeln('   \x1b[1mhelp\x1b[0m     - Show available commands');
      terminalInstance.current.writeln('   \x1b[1mls\x1b[0m       - List files in current directory');
      terminalInstance.current.writeln('   \x1b[1mpwd\x1b[0m      - Show current directory');
      terminalInstance.current.writeln('   \x1b[1mclear\x1b[0m    - Clear terminal screen');
      terminalInstance.current.writeln('\r\n\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminalInstance.current.writeln('\r\n');

      // Show initial prompt
      terminalInstance.current.write('$ ');

      // Focus the terminal
      terminalInstance.current.focus();

      // Handle window resize
      const handleResize = () => {
        if (fitAddon.current) {
          fitAddon.current.fit();
        }
      };
      window.addEventListener('resize', handleResize);

      let inputBuffer = '';
      // Handle terminal input
      const disposeOnData = terminalInstance.current.onData((data) => {
        console.log('Terminal input received:', data, data.charCodeAt(0));
        if (data.charCodeAt(0) === 124) {
          inputBuffer = inputBuffer.slice(0, -1);
        } else {
          inputBuffer += data;
        }
        if (data === '\r' || data === '\n') {
          // Handle Enter key
          if (isConnectedRef.current && sessionIdRef.current) {
            console.log('Sending input to CLI:', inputBuffer);
            // Send input to CLI
            invoke('send_terminal_input', {
              sessionId: sessionIdRef.current,
              input: inputBuffer,
            }).catch((error) => {
              console.error('Failed to send input:', error);
              terminalInstance.current?.writeln(`\r\n❌ Failed to send input: ${error}`);
            });
            inputBuffer = "";
          } else {
            // Show $ prompt for local commands
            terminalInstance.current?.writeln('\r\n');
            terminalInstance.current?.write('$ ');
          }
        } else if (data.length === 1) {
          // Handle regular character input
          terminalInstance.current?.write(data);
        }
      });

      // Handle terminal key events for special keys
      const disposeOnKey = terminalInstance.current.onKey((e) => {
        const ev = e.domEvent;
        const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;

        console.log('Key event:', ev.key, 'Printable:', printable);

        // Handle Enter key specifically
        if (ev.keyCode === 13) {
          terminalInstance.current?.write('\r\n');
        }
        // Handle Backspace key
        else if (ev.keyCode === 8) {
          console.log('Backspace key pressed');
          terminalInstance.current?.write('\b \b');
        }
      });

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);
        disposeOnData.dispose();
        disposeOnKey.dispose();
        if (unlistenRef.current) {
          unlistenRef.current();
        }
        terminalInstance.current?.dispose();
      };
    }
  }, []);

  // Focus terminal when connected or when component updates
  useEffect(() => {
    if (terminalInstance.current) {
      setTimeout(() => {
        terminalInstance.current?.focus();
      }, 100);
    }
  }, [isConnectedRef.current]);

  const initializeNetwork = async () => {
    try {
      const nodeId = await invoke<string>('initialize_network');
      setStatus(`Ready - Node ID: ${nodeId.substring(0, 8)}...`);
    } catch (error) {
      console.error('Failed to initialize network:', error);
      setStatus('Failed to initialize network');
    }
  };

  // Initialize network on mount
  useEffect(() => {
    initializeNetwork();
  }, []);

  const handleConnect = async () => {
    if (!sessionTicket.trim()) {
      alert('Please enter a session ticket.');
      return;
    }

    setConnecting(true);
    setStatus('Connecting...');

    if (terminalInstance.current) {
      terminalInstance.current.writeln('Attempting to connect...');
    }

    try {
      const actualSessionId = await invoke<string>('connect_to_peer', {
        sessionTicket: sessionTicket.trim(),
      });

      sessionIdRef.current = actualSessionId;
      isConnectedRef.current = true;

      console.log('Connected to session:', actualSessionId);
      // Listen for terminal events
      const unlisten = await listen<any>(`terminal-event-${actualSessionId}`, (event) => {
        const termEvent = event.payload;
        console.log('Terminal event received:', termEvent);
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
      if (terminalInstance.current) {
        terminalInstance.current.clear();
        terminalInstance.current.writeln('\r\n\x1b[1;32m✅ Connection established!\x1b[0m');
        terminalInstance.current.writeln('\r\n\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
        terminalInstance.current.writeln('\r\n📡 Session Information:');
        terminalInstance.current.writeln(`   Session ID: \x1b[1m${actualSessionId.substring(0, 16)}...\x1b[0m`);
        terminalInstance.current.writeln(`   Ticket: \x1b[1m${sessionTicket.substring(0, 16)}...\x1b[0m`);
        terminalInstance.current.writeln(`   Status: \x1b[1;32mConnected\x1b[0m`);
        terminalInstance.current.writeln('\r\n💡 You are now connected to the remote session.');
        terminalInstance.current.writeln('   Type commands and press Enter to execute them.');
        terminalInstance.current.writeln('\r\n\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
        terminalInstance.current.writeln('\r\n');
        terminalInstance.current.focus();
      }
    } catch (error) {
      console.error('Connection failed:', error);
      setStatus('Connection failed');
      if (terminalInstance.current) {
        terminalInstance.current.writeln(`\r\n❌ Connection failed: ${error}`);
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
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

    isConnectedRef.current = false;
    sessionIdRef.current = null;
    setStatus('Disconnected');

    if (terminalInstance.current) {
      terminalInstance.current.writeln('\r\n\x1b[1;33m👋 Disconnected from session\x1b[0m');
      terminalInstance.current.writeln('\r\n\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminalInstance.current.writeln('\r\n💡 Session ended. You can connect to a new session.');
      terminalInstance.current.writeln('\r\n\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminalInstance.current.writeln('\r\n');
      terminalInstance.current.write('$ ');
    }
  };

  // Handle form submission with Enter key
  const handleTicketKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !connecting && sessionTicket.trim()) {
      handleConnect();
    }
  };

  return (
    <div className="app">
      <div className="header">
        <h1>iroh-code-remote</h1>
        <div className="status-bar">{status}</div>
      </div>

      <div className="terminal-container-wrapper">
        <div ref={terminalRef} className="terminal-container" />
      </div>

      {!isConnectedRef.current && (
        <div className="connection-panel">
          <div className="connection-form">
            <h2>Connect to a Session</h2>
            <div className="form-group">
              <input
                type="text"
                value={sessionTicket}
                onChange={(e) => setSessionTicket(e.target.value)}
                onKeyPress={handleTicketKeyPress}
                placeholder="Enter session ticket"
                disabled={connecting}
                className="ticket-input"
                autoFocus
              />
            </div>
            <button
              className="connect-btn"
              onClick={handleConnect}
              disabled={connecting || !sessionTicket.trim()}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {isConnectedRef.current && (
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
