/**
 * localStorage utilities for RiTerm tickets
 */

const STORAGE_KEY_LAST_TICKET = 'riterm_last_ticket';
const STORAGE_KEY_TICKET_HISTORY = 'riterm_ticket_history';
const MAX_HISTORY_SIZE = 5;

/**
 * Save a ticket to localStorage
 */
export function saveTicket(ticket: string): void {
  try {
    // Save current ticket
    localStorage.setItem(STORAGE_KEY_LAST_TICKET, ticket);

    // Update history (keep last MAX_HISTORY_SIZE unique tickets)
    const history = getTicketHistory();
    const updatedHistory = [ticket, ...history.filter(t => t !== ticket)].slice(0, MAX_HISTORY_SIZE);
    localStorage.setItem(STORAGE_KEY_TICKET_HISTORY, JSON.stringify(updatedHistory));

    console.log('💾 Ticket saved to localStorage');
  } catch (error) {
    console.warn('Failed to save ticket to localStorage:', error);
  }
}

/**
 * Get the last saved ticket from localStorage
 */
export function getLastTicket(): string | null {
  try {
    const ticket = localStorage.getItem(STORAGE_KEY_LAST_TICKET);
    return ticket?.trim() ? ticket : null;
  } catch (error) {
    console.warn('Failed to get last ticket from localStorage:', error);
    return null;
  }
}

/**
 * Get ticket history from localStorage
 */
export function getTicketHistory(): string[] {
  try {
    const historyJson = localStorage.getItem(STORAGE_KEY_TICKET_HISTORY);
    if (!historyJson) return [];

    const history = JSON.parse(historyJson);
    return Array.isArray(history) ? history.filter(t => typeof t === 'string' && t.trim()) : [];
  } catch (error) {
    console.warn('Failed to get ticket history from localStorage:', error);
    return [];
  }
}

/**
 * Clear all stored tickets from localStorage
 */
export function clearStoredTickets(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_LAST_TICKET);
    localStorage.removeItem(STORAGE_KEY_TICKET_HISTORY);
    console.log('🗑️ Cleared all stored tickets');
  } catch (error) {
    console.warn('Failed to clear stored tickets:', error);
  }
}

/**
 * Check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
  try {
    const test = '__test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}
