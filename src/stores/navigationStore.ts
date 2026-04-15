/**
 * Navigation Store
 *
 * Manages navigation state for the bottom navigation bar
 */

import { createStore } from "solid-js/store";

// ============================================================================
// Types
// ============================================================================

export type NavigationView =
  | "home"
  | "sessions"
  | "devices"
  | "settings"
  | "workspace"
  | "dashboard"
  | "hosts"
  | "chat"
  | "proxies";

interface NavigationState {
  activeView: NavigationView;
  previewProxyId: string | null;
  sidebarOpen: boolean;
}

// ============================================================================
// Store
// ============================================================================

const initialState: NavigationState = {
  activeView: "home",
  previewProxyId: null,
  sidebarOpen: true,
};

export const createNavigationStore = () => {
  const [state, setState] = createStore<NavigationState>(initialState);

  const setActiveView = (view: NavigationView) => {
    let targetView = view;
    if (view === "dashboard") targetView = "home";
    if (view === "hosts" || view === "proxies") targetView = "devices";
    if (view === "chat") targetView = "workspace";

    setState("activeView", targetView);
  };

  const setPreviewProxyId = (proxyId: string | null) => {
    setState("previewProxyId", proxyId);
  };

  const toggleSidebar = () => {
    setState("sidebarOpen", (prev) => !prev);
  };

  const setSidebarOpen = (open: boolean) => {
    setState("sidebarOpen", open);
  };

  return {
    state,
    setActiveView,
    setPreviewProxyId,
    toggleSidebar,
    setSidebarOpen,
  };
};

// Global store instance
// Start sidebar open on desktop (>=768px), closed on mobile
export const navigationStore = createNavigationStore();
// Sync sidebar with window size on load
if (typeof window !== "undefined") {
  if (window.innerWidth < 768) {
    navigationStore.setSidebarOpen(false);
  }
  window.addEventListener("resize", () => {
    if (window.innerWidth >= 768) {
      navigationStore.setSidebarOpen(true);
    }
  });
}
