/**
 * localStorage utilities for RiTerm tickets
 */

const STORAGE_KEY_LAST_TICKET = 'riterm_last_ticket';
const STORAGE_KEY_TICKET_HISTORY = 'riterm_ticket_history';
const MAX_HISTORY_SIZE = 3;

/**
 * Ticket history item with optional hostname
 */
export interface TicketHistoryItem {
  ticket: string;
  hostname?: string;
  timestamp: number;
}

/**
 * Save a ticket to localStorage (with optional hostname)
 */
export function saveTicket(ticket: string, hostname?: string): void {
  try {
    // Save current ticket
    localStorage.setItem(STORAGE_KEY_LAST_TICKET, ticket);

    // Update history (keep last MAX_HISTORY_SIZE unique tickets)
    const history = getTicketHistory();
    const existingItem = history.find(item => item.ticket === ticket);

    if (existingItem) {
      // Update existing item with new hostname and timestamp
      existingItem.hostname = hostname || existingItem.hostname;
      existingItem.timestamp = Date.now();
    } else {
      // Add new item to the beginning
      history.unshift({
        ticket,
        hostname,
        timestamp: Date.now(),
      });
    }

    // Sort by timestamp and keep only MAX_HISTORY_SIZE
    const sortedHistory = history
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_HISTORY_SIZE);

    localStorage.setItem(STORAGE_KEY_TICKET_HISTORY, JSON.stringify(sortedHistory));

    console.log('💾 Ticket saved to localStorage', hostname ? `(${hostname})` : '');
  } catch (error) {
    console.warn('Failed to save ticket to localStorage:', error);
  }
}

/**
 * Update hostname for an existing ticket in history
 */
export function updateTicketHostname(ticket: string, hostname: string): void {
  try {
    const history = getTicketHistory();
    const item = history.find(item => item.ticket === ticket);

    if (item) {
      item.hostname = hostname;
      item.timestamp = Date.now();
      localStorage.setItem(STORAGE_KEY_TICKET_HISTORY, JSON.stringify(history));
      console.log('💾 Updated hostname for ticket:', hostname);
    }
  } catch (error) {
    console.warn('Failed to update ticket hostname:', error);
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
export function getTicketHistory(): TicketHistoryItem[] {
  try {
    const historyJson = localStorage.getItem(STORAGE_KEY_TICKET_HISTORY);
    if (!historyJson) return [];

    const history = JSON.parse(historyJson);

    // Handle old format (string array) - migrate to new format
    if (Array.isArray(history) && history.length > 0 && typeof history[0] === 'string') {
      const migrated: TicketHistoryItem[] = (history as string[]).map(ticket => ({
        ticket,
        timestamp: Date.now(),
      }));
      localStorage.setItem(STORAGE_KEY_TICKET_HISTORY, JSON.stringify(migrated));
      return migrated;
    }

    // Return new format
    return Array.isArray(history) ? history.filter((item: any) =>
      item && typeof item.ticket === 'string' && item.ticket.trim()
    ) : [];
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
