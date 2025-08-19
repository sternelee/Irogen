import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

interface TerminalViewProps {
  onInput: (data: string) => void;
  onReady: (terminal: Terminal, fitAddon: FitAddon) => void;
}

export function TerminalView({ onInput, onReady }: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const onInputRef = useRef(onInput);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    if (terminalRef.current && !terminalInstance.current) {
      const term = new Terminal({
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

      const addon = new FitAddon();
      fitAddon.current = addon;
      term.loadAddon(addon);
      term.loadAddon(new WebLinksAddon());

      term.open(terminalRef.current);
      addon.fit();
      term.focus();

      terminalInstance.current = term;
      onReady(term, addon);

      const onDataDispose = term.onData((data) => {
        onInputRef.current(data);
      });

      return () => {
        onDataDispose.dispose();
        term.dispose();
        terminalInstance.current = null;
      };
    }
  }, [onReady]);

  return <div ref={terminalRef} className="terminal-container" />;
}
