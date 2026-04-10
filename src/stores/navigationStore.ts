/**
 * Navigation Store
 *
 * Manages navigation state for the bottom navigation bar
 */

import { createStore } from "solid-js/store";

// ============================================================================
// Types
// ============================================================================

export type NavigationView = "dashboard" | "hosts" | "chat" | "proxies";

interface NavigationState {
  activeView: NavigationView;
  previewProxyId: string | null;
}

// ============================================================================
// Store
// ============================================================================

const initialState: NavigationState = {
  activeView: "dashboard",
  previewProxyId: null,
};

export const createNavigationStore = () => {
  const [state, setState] = createStore<NavigationState>(initialState);

  const setActiveView = (view: NavigationView) => {
    setState("activeView", view);
  };

  const setPreviewProxyId = (proxyId: string | null) => {
    setState("previewProxyId", proxyId);
  };

  return {
    state,
    setActiveView,
    setPreviewProxyId,
  };
};

// Global store instance
export const navigationStore = createNavigationStore();
