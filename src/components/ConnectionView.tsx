import React from 'react';
import { HistoryEntry } from '../hooks/useConnectionHistory';

interface ConnectionViewProps {
  sessionTicket: string;
  setSessionTicket: (ticket: string) => void;
  handleConnect: () => void;
  connecting: boolean;
  history: HistoryEntry[];
  connectionError: string | null;
}

function formatTimestamp(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ago`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ago`;
  }
  if (diffMinutes > 0) {
    return `${diffMinutes}m ago`;
  }
  return 'Just now';
}

export function ConnectionView({
  sessionTicket,
  setSessionTicket,
  handleConnect,
  connecting,
  history,
  connectionError,
}: ConnectionViewProps) {
  const handleTicketKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !connecting && sessionTicket.trim()) {
      handleConnect();
    }
  };

  return (
    <div className="connection-overlay">
      <div className="connection-form">
        <h1>Connect to a Remote Session</h1>
        <p>Enter a session ticket to start a secure P2P terminal session.</p>

        {connectionError && (
          <div className="error-message">
            <p>Connection Failed:</p>
            <pre>{connectionError}</pre>
          </div>
        )}

        {history.length > 0 && (
          <div className="history-section">
            <h3>Connection History</h3>
            <div className="history-list">
              {history.map((entry) => (
                <div
                  key={entry.timestamp}
                  className="history-item"
                  onClick={() => setSessionTicket(entry.ticket)}
                >
                  <span className="history-ticket" title={entry.ticket}>
                    {entry.ticket.substring(0, 20)}...
                  </span>
                  <span className="history-time">
                    {formatTimestamp(entry.timestamp)}
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
              onKeyPress={handleTicketKeyPress}
              placeholder="Enter session ticket"
              disabled={connecting}
              className="ticket-input"
              autoFocus
            />
          </div>
        </div>
        <button
          className="connect-btn ripple"
          onClick={handleConnect}
          disabled={connecting || !sessionTicket.trim()}
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
}