import { createSignal, createEffect } from "solid-js";

const HISTORY_KEY = "riterm-connection-history";
const MAX_HISTORY_ITEMS = 20;

export type ConnectionStatus =
  | "Active"
  | "Completed"
  | "Failed"
  | "Waiting Input";

export interface HistoryEntry {
  ticket: string; // Using ticket as the unique ID
  timestamp: number;
  title: string;
  description: string;
  status: ConnectionStatus;
}

const generateDefaultTitle = (ticket: string): string => {
  const parts = ticket.split("-");
  if (parts.length > 2) {
    const potentialTitle = parts.slice(0, -2).join(" ");
    return potentialTitle.charAt(0).toUpperCase() + potentialTitle.slice(1);
  }
  return `Session ${ticket.substring(0, 8)}...`;
};

export function createConnectionHistory() {
  // 首先获取初始历史记录
  let initialHistory: HistoryEntry[] = [];
  try {
    const storedHistory = localStorage.getItem(HISTORY_KEY);
    console.log("storedHistory", storedHistory);
    initialHistory = storedHistory ? JSON.parse(storedHistory) : [];
  } catch (error) {
    console.error("Failed to parse connection history:", error);
  }

  // 然后将其作为直接值传递给createSignal
  const [history, setHistory] = createSignal<HistoryEntry[]>(initialHistory);

  const saveHistory = (newHistory: HistoryEntry[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch (error) {
      console.error("Failed to save connection history:", error);
    }
  };

  const addHistoryEntry = (ticket: string) => {
    setHistory((prevHistory) => {
      const filteredHistory = prevHistory.filter(
        (entry) => entry.ticket !== ticket,
      );

      const newEntry: HistoryEntry = {
        ticket,
        timestamp: Date.now(),
        title: generateDefaultTitle(ticket),
        description: "Connecting to peer...",
        status: "Active",
      };

      const newHistory = [newEntry, ...filteredHistory].slice(
        0,
        MAX_HISTORY_ITEMS,
      );
      saveHistory(newHistory);
      return newHistory;
    });
  };

  const updateHistoryEntry = (
    ticket: string,
    updates: Partial<Omit<HistoryEntry, "ticket">>,
  ) => {
    setHistory((prevHistory) => {
      const newHistory = prevHistory.map((entry) =>
        entry.ticket === ticket
          ? { ...entry, ...updates, timestamp: Date.now() }
          : entry,
      );
      saveHistory(newHistory);
      return newHistory;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      console.error("Failed to clear connection history:", error);
    }
  };

  const deleteHistoryEntry = (ticket: string) => {
    setHistory((prevHistory) => {
      const newHistory = prevHistory.filter((entry) => entry.ticket !== ticket);
      saveHistory(newHistory);
      return newHistory;
    });
  };

  return {
    history,
    addHistoryEntry,
    updateHistoryEntry,
    clearHistory,
    deleteHistoryEntry,
  };
}
