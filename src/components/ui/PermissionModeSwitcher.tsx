/**
 * Permission Mode Switcher
 *
 * Dropdown selector for choosing the agent's permission mode.
 * Modes:
 *   - AlwaysAsk  : manual approval for every tool call
 *   - AcceptEdits: auto-approve file edits, ask for shell/fetch
 *   - Plan       : auto-approve reads, ask for writes
 *   - AutoApprove: approve everything (⚠ dangerous)
 */

import { type Component, createMemo, Show } from "solid-js";
import {
  FiShield,
  FiEdit,
  FiBook,
  FiZap,
  FiChevronDown,
} from "solid-icons/fi";
import type { PermissionMode } from "~/stores/sessionStore";
import { cn } from "~/lib/utils";

// ============================================================================
// Config
// ============================================================================

interface ModeConfig {
  label: string;
  description: string;
  icon: typeof FiShield;
  badgeClass: string;
  textClass: string;
  danger?: boolean;
}

const MODES: Record<PermissionMode, ModeConfig> = {
  AlwaysAsk: {
    label: "Always Ask",
    description: "Manual approval for every tool call",
    icon: FiShield,
    badgeClass: "badge-neutral",
    textClass: "text-base-content",
  },
  AcceptEdits: {
    label: "Accept Edits",
    description: "Auto-approve file edits, ask for shell commands",
    icon: FiEdit,
    badgeClass: "badge-primary",
    textClass: "text-primary",
  },
  Plan: {
    label: "Plan",
    description: "Auto-approve reads/search, ask for writes",
    icon: FiBook,
    badgeClass: "badge-info",
    textClass: "text-info",
  },
  AutoApprove: {
    label: "Auto-Approve",
    description: "Approve everything — use with caution",
    icon: FiZap,
    badgeClass: "badge-warning",
    textClass: "text-warning",
    danger: true,
  },
};

// ============================================================================
// Props
// ============================================================================

interface PermissionModeSwitcherProps {
  mode: PermissionMode;
  disabled?: boolean;
  compact?: boolean; // icon only with tooltip
  onChange: (mode: PermissionMode) => void;
}

// ============================================================================
// Component
// ============================================================================

export const PermissionModeSwitcher: Component<PermissionModeSwitcherProps> = (
  props,
) => {
  const config = createMemo(() => MODES[props.mode] ?? MODES.AlwaysAsk);
  const Icon = createMemo(() => config().icon);

  return (
    <div class="dropdown dropdown-end">
      {/* Trigger */}
      <div
        tabIndex={0}
        role="button"
        class={cn(
          "btn btn-ghost btn-xs rounded-lg flex items-center gap-1.5 h-8 px-2",
          "border border-base-300/50 hover:border-base-300",
          "text-base-content/70 hover:text-base-content",
          props.disabled && "opacity-50 pointer-events-none",
        )}
        aria-label={`Permission mode: ${config().label}`}
      >
        {(() => { const I = Icon(); return <I size={13} class={cn(config().textClass, config().danger && "text-warning")} />; })()}
        <Show when={!props.compact}>
          <span class="text-[11px] font-medium hidden sm:inline">
            {config().label}
          </span>
        </Show>
        <FiChevronDown size={10} class="text-base-content/40" />
      </div>

      {/* Dropdown Menu */}
      <ul
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        class="dropdown-content menu menu-sm z-[100] mt-1 w-64 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-xl"
      >
        <li class="menu-title px-2 py-1">
          <span class="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">
            Permission Mode
          </span>
        </li>
        {(Object.entries(MODES) as [PermissionMode, ModeConfig][]).map(
          ([key, cfg]) => {
            const ModeIcon = cfg.icon;
            const isActive = () => props.mode === key;
            return (
              <li>
                <button
                  type="button"
                  class={cn(
                    "flex items-start gap-3 rounded-lg px-3 py-2 text-left w-full transition-colors",
                    isActive()
                      ? "bg-base-200"
                      : "hover:bg-base-200/60",
                  )}
                  onClick={() => {
                    props.onChange(key);
                    // Close dropdown by blurring the active element
                    (document.activeElement as HTMLElement)?.blur();
                  }}
                >
                  <div
                    class={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                      isActive() ? "bg-primary/10" : "bg-base-200",
                    )}
                  >
                    <ModeIcon
                      size={13}
                      class={cn(
                        isActive() ? cfg.textClass : "text-base-content/50",
                        cfg.danger && isActive() && "text-warning",
                      )}
                    />
                  </div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span
                        class={cn(
                          "text-sm font-medium",
                          isActive() ? "text-base-content" : "text-base-content/80",
                        )}
                      >
                        {cfg.label}
                      </span>
                      {isActive() && (
                        <span class={cn("badge badge-xs", cfg.badgeClass)}>
                          Active
                        </span>
                      )}
                      {cfg.danger && (
                        <span class="badge badge-xs badge-warning badge-outline">
                          ⚠
                        </span>
                      )}
                    </div>
                    <p class="text-[11px] text-base-content/50 mt-0.5 leading-tight">
                      {cfg.description}
                    </p>
                  </div>
                </button>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

export default PermissionModeSwitcher;
