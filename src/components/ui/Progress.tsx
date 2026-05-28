/**
 * Progress Component
 *
 * Loading progress bars with animations
 */

import { type Component, Show, createMemo } from "solid-js";
import { cn } from "~/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type ProgressVariant = "default" | "success" | "warning" | "error" | "primary";
export type ProgressSize = "sm" | "md" | "lg";

export interface ProgressProps {
  value: number;
  max?: number;
  variant?: ProgressVariant;
  size?: ProgressSize;
  showLabel?: boolean;
  label?: string;
  class?: string;
}

export interface CircularProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  variant?: ProgressVariant;
  showLabel?: boolean;
  class?: string;
}

// ============================================================================
// Variant Classes
// ============================================================================

const indicatorVariantClasses: Record<ProgressVariant, string> = {
  default: "bg-base-200-foreground",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
};

// ============================================================================
// Linear Progress Component
// ============================================================================

export const Progress: Component<ProgressProps> = (props) => {
  const max = props.max || 100;
  const size = props.size || "md";
  const variant = props.variant || "default";

  const percentage = createMemo(() => {
    return Math.min(Math.max((props.value / max) * 100, 0), 100);
  });

  const sizeClasses = {
    sm: "h-1",
    md: "h-2",
    lg: "h-3",
  };

  return (
    <div class={cn("w-full", props.class)}>
      <Show when={props.showLabel || props.label}>
        <div class="flex justify-between items-center mb-1">
          <Show when={props.label}>
            <span class="text-xs text-base-content/50">{props.label}</span>
          </Show>
          <Show when={props.showLabel}>
            <span class="text-xs font-medium">{Math.round(percentage())}%</span>
          </Show>
        </div>
      </Show>
      <div
        class={cn(
          "w-full rounded-full overflow-hidden bg-base-200",
          sizeClasses[size]
        )}
      >
        <div
          class={cn(
            "h-full rounded-full transition-all duration-300 ease-out",
            indicatorVariantClasses[variant]
          )}
          style={{ width: `${percentage()}%` }}
        />
      </div>
    </div>
  );
};

// ============================================================================
// Circular Progress Component
// ============================================================================

export const CircularProgress: Component<CircularProgressProps> = (props) => {
  const size = props.size || 48;
  const strokeWidth = props.strokeWidth || 4;
  const max = props.max || 100;
  const variant = props.variant || "primary";

  const percentage = createMemo(() => {
    return Math.min(Math.max((props.value / max) * 100, 0), 100);
  });

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage() / 100) * circumference;

  return (
    <div class={cn("relative inline-flex items-center justify-center", props.class)}>
      <svg
        width={size}
        height={size}
        class="-rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          stroke-width={strokeWidth}
          class="text-muted"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          stroke-width={strokeWidth}
          stroke-dasharray={`${circumference}`}
          stroke-dashoffset={`${offset}`}
          stroke-linecap="round"
          class={cn(
            "transition-all duration-300 ease-out",
            indicatorVariantClasses[variant]
          )}
        />
      </svg>
      <Show when={props.showLabel}>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-xs font-medium">{Math.round(percentage())}%</span>
        </div>
      </Show>
    </div>
  );
};

// ============================================================================
// Progress Group (multiple bars)
// ============================================================================

export interface ProgressGroupProps {
  items: { label: string; value: number; max?: number; variant?: ProgressVariant }[];
  class?: string;
}

export const ProgressGroup: Component<ProgressGroupProps> = (props) => {
  return (
    <div class={cn("space-y-3", props.class)}>
      {props.items.map((item) => (
        <Progress
          value={item.value}
          max={item.max}
          variant={item.variant}
          showLabel
          label={item.label}
        />
      ))}
    </div>
  );
};
