import { useState, useCallback } from 'react';

const HISTORY_KEY = 'riterm-connection-history';
const MAX_HISTORY_ITEMS = 10;

export interface HistoryEntry {
  ticket: string;
  timestamp: number;
}

export function useConnectionHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const storedHistory = localStorage.getItem(HISTORY_KEY);
      return storedHistory ? JSON.parse(storedHistory) : [];
    } catch (error) {
      console.error('Failed to parse connection history:', error);
      return [];
    }
  });

  const addHistoryEntry = useCallback((ticket: string) => {
    setHistory((prevHistory) => {
      // Remove any previous entries with the same ticket
      const filteredHistory = prevHistory.filter((entry) => entry.ticket !== ticket);

      // Add the new entry to the top
      const newHistory: HistoryEntry[] = [
        { ticket, timestamp: Date.now() },
        ...filteredHistory,
      ].slice(0, MAX_HISTORY_ITEMS); // Limit the number of history items

      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
      } catch (error) {
        console.error('Failed to save connection history:', error);
      }

      return newHistory;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      console.error('Failed to clear connection history:', error);
    }
  }, []);

  return { history, addHistoryEntry, clearHistory };
}