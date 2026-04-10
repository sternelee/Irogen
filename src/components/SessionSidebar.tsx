/**
 * SessionSidebar Component
 *
 * Left navigation sidebar for desktop (md and above)
 * Acts as navigation menu - no session list
 */

import {
  Show,
  type Component,
} from "solid-js";
import { FiX, FiActivity, FiServer, FiMessageSquare, FiBox } from "solid-icons/fi";
import { navigationStore, type NavigationView } from "../stores/navigationStore";
import { sessionStore } from "../stores/sessionStore";

// ============================================================================
// Navigation Items
// ============================================================================

interface NavItem {
  id: NavigationView;
  label: string;
  icon: typeof FiActivity;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Topology", icon: FiActivity },
  { id: "chat", label: "Chat", icon: FiMessageSquare },
  { id: "hosts", label: "Hosts", icon: FiServer },
  { id: "proxies", label: "Preview", icon: FiBox },
];

// ============================================================================
// Nav Item Component
// ============================================================================

interface NavItemButtonProps {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}

const NavItemButton: Component<NavItemButtonProps> = (props) => {
  const Icon = props.item.icon;

  return (
    <button
      type="button"
      class={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
        ${
          props.isActive
            ? "bg-primary/10 text-primary border border-primary/20"
            : "text-base-content/60 hover:bg-base-content/5 hover:text-base-content"
        }`}
      onClick={props.onClick}
    >
      <Icon size={20} class={props.isActive ? "text-primary" : ""} />
      <span class="font-medium text-sm">{props.item.label}</span>
      <Show when={props.item.id === "chat" && sessionStore.getActiveSessions().length > 0}>
        <span class="ml-auto w-2 h-2 rounded-full bg-primary animate-pulse" />
      </Show>
    </button>
  );
};

// ============================================================================
// SessionSidebar Component
// ============================================================================

interface SessionSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const activeView = () => navigationStore.state.activeView;

  const handleNavClick = (view: NavigationView) => {
    navigationStore.setActiveView(view);
  };

  return (
    <aside
      class={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-base-200 border-r border-base-content/10
        transform transition-transform duration-300 ease-in-out backdrop-blur-md
        ${props.isOpen ? "translate-x-0" : "-translate-x-full"}
        h-dvh flex flex-col shadow-2xl
      `}
    >
      {/* Header */}
      <div class="flex items-center justify-between px-5 py-4 border-b border-base-content/10 bg-base-100/50 backdrop-blur">
        <div class="flex items-center gap-3">
          {/* App Logo */}
          <div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <span class="text-primary-content font-black text-lg">P</span>
          </div>
          <div>
            <h1 class="text-sm font-black tracking-tight uppercase leading-none">
              Irogen
            </h1>
            <p class="text-[10px] opacity-40 mt-0.5 font-bold uppercase tracking-wider">
              Navigation
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square"
            onClick={props.onToggle}
            title="Close"
          >
            <FiX size={18} />
          </button>
        </div>
      </div>

      {/* Navigation Items */}
      <div class="flex-1 overflow-y-auto p-3 space-y-1">
        <div class="px-4 py-2 text-[10px] font-black text-base-content/30 uppercase tracking-[0.15em]">
          Menu
        </div>
        {NAV_ITEMS.map((item) => (
          <NavItemButton
            item={item}
            isActive={activeView() === item.id}
            onClick={() => handleNavClick(item.id)}
          />
        ))}
      </div>

      {/* Footer - Connection Status */}
      <div class="px-4 py-3 border-t border-base-content/10 bg-base-100/50">
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-tighter opacity-40">
            <span class={`w-2 h-2 rounded-full ${sessionStore.state.connectionState === "connected" ? "bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-base-content/30"}`} />
            {sessionStore.state.connectionState === "connected" ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
    </aside>
  );
};

export default SessionSidebar;
