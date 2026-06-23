/**
 * localStorage utilities for Irogen tickets
 */

const STORAGE_KEY_LAST_TICKET = "irogen_last_ticket";
const STORAGE_KEY_TICKET_HISTORY = "irogen_ticket_history";
const STORAGE_KEY_PROJECT_PATH_HISTORY = "irogen_project_path_history";
const MAX_TICKET_HISTORY_SIZE = 3;
const MAX_PROJECT_PATH_HISTORY_SIZE = 10;

/**
 * Save a ticket to localStorage
 */
export function saveTicket(ticket: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Save current ticket
    localStorage.setItem(STORAGE_KEY_LAST_TICKET, ticket);

    // Update history (keep last MAX_TICKET_HISTORY_SIZE unique tickets)
    const history = getTicketHistory();
    const updatedHistory = [
      ticket,
      ...history.filter((t) => t !== ticket),
    ].slice(0, MAX_TICKET_HISTORY_SIZE);
    localStorage.setItem(
      STORAGE_KEY_TICKET_HISTORY,
      JSON.stringify(updatedHistory),
    );

    console.log("💾 Ticket saved to localStorage");
  } catch (error) {
    console.warn("Failed to save ticket to localStorage:", error);
  }
}

/**
 * Get the last saved ticket from localStorage
 */
export function getLastTicket(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const ticket = localStorage.getItem(STORAGE_KEY_LAST_TICKET);
    return ticket?.trim() ? ticket : null;
  } catch (error) {
    console.warn("Failed to get last ticket from localStorage:", error);
    return null;
  }
}

/**
 * Get ticket history from localStorage
 */
export function getTicketHistory(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const historyJson = localStorage.getItem(STORAGE_KEY_TICKET_HISTORY);
    if (!historyJson) return [];

    const history = JSON.parse(historyJson);
    return Array.isArray(history)
      ? history.filter((t) => typeof t === "string" && t.trim())
      : [];
  } catch (error) {
    console.warn("Failed to get ticket history from localStorage:", error);
    return [];
  }
}

/**
 * Save a project path to localStorage history
 */
export function saveProjectPath(path: string): void {
  if (typeof localStorage === "undefined") return;
  const trimmed = path.trim();
  if (!trimmed) return;

  try {
    const history = getProjectPathHistory();
    const updatedHistory = [
      trimmed,
      ...history.filter((item) => item !== trimmed),
    ].slice(0, MAX_PROJECT_PATH_HISTORY_SIZE);

    localStorage.setItem(
      STORAGE_KEY_PROJECT_PATH_HISTORY,
      JSON.stringify(updatedHistory),
    );
  } catch (error) {
    console.warn("Failed to save project path to localStorage:", error);
  }
}

/**
 * Get project path history from localStorage
 */
export function getProjectPathHistory(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const historyJson = localStorage.getItem(STORAGE_KEY_PROJECT_PATH_HISTORY);
    if (!historyJson) return [];

    const history = JSON.parse(historyJson);
    return Array.isArray(history)
      ? history.filter((path) => typeof path === "string" && path.trim())
      : [];
  } catch (error) {
    console.warn("Failed to get project path history from localStorage:", error);
    return [];
  }
}

/**
 * Clear all stored tickets from localStorage
 */
export function clearStoredTickets(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY_LAST_TICKET);
    localStorage.removeItem(STORAGE_KEY_TICKET_HISTORY);
    console.log("🗑️ Cleared all stored tickets");
  } catch (error) {
    console.warn("Failed to clear stored tickets:", error);
  }
}

/**
 * Check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const test = "__test__";
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}
