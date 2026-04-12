/**
 * Loading Components - DaisyUI v5
 *
 * Uses DaisyUI native classes:
 * - loading-spinner for spinners
 * - loading-dots for loading dots
 * - Skeleton with bg-base-200/70
 * - Dashboard skeleton screens
 * - Chat skeleton screens
 */

import { type Component, Show, For } from "solid-js";
import { cn } from "~/lib/utils";

// ============================================================================
// Skeleton Loader
// ============================================================================

export interface SkeletonProps {
  width?: string;
  height?: string;
  rounded?: "none" | "sm" | "md" | "lg" | "full";
  class?: string;
}

export const Skeleton: Component<SkeletonProps> = (props) => {
  const roundedClass = {
    none: "",
    sm: "rounded",
    md: "rounded-md",
    lg: "rounded-lg",
    full: "rounded-full",
  };

  return (
    <div
      class={cn(
        "animate-pulse bg-base-200/70",
        roundedClass[props.rounded || "md"],
        props.class
      )}
      style={{
        width: props.width || "100%",
        height: props.height || "1rem",
      }}
    />
  );
};

// ============================================================================
// Card Skeleton
// ============================================================================

export const CardSkeleton: Component<{ class?: string }> = (props) => {
  return (
    <div class={cn("card bg-base-100 shadow border border-base-300", props.class)}>
      <div class="card-body gap-3">
        <div class="flex items-center gap-3">
          <Skeleton width="40px" height="40px" rounded="full" />
          <div class="flex-1 space-y-2">
            <Skeleton width="60%" height="14px" />
            <Skeleton width="40%" height="12px" />
          </div>
        </div>
        <Skeleton height="60px" />
        <div class="flex gap-2">
          <Skeleton width="80px" height="32px" rounded="btn" />
          <Skeleton width="80px" height="32px" rounded="btn" />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Message Bubble Skeleton
// ============================================================================

export const MessageBubbleSkeleton: Component<{ isUser?: boolean; class?: string }> = (props) => {
  return (
    <div class={cn("flex items-start gap-2", props.isUser && "flex-row-reverse", props.class)}>
      <Skeleton width="32px" height="32px" rounded="full" class="shrink-0" />
      <div class="space-y-2 max-w-[70%]">
        <Skeleton width="120px" height="16px" rounded="lg" />
        <Skeleton width="200px" height="60px" rounded="xl" />
        <Skeleton width="80px" height="12px" rounded="md" class="self-end" />
      </div>
    </div>
  );
};

// ============================================================================
// Chat View Skeleton
// ============================================================================

export const ChatViewSkeleton: Component<{ class?: string }> = (props) => {
  return (
    <div class={cn("flex flex-col h-full", props.class)}>
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-base-300">
        <div class="flex items-center gap-3">
          <Skeleton width="36px" height="36px" rounded="lg" />
          <div class="space-y-1.5">
            <Skeleton width="100px" height="14px" />
            <Skeleton width="60px" height="10px" />
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Skeleton width="32px" height="32px" rounded="md" />
          <Skeleton width="32px" height="32px" rounded="md" />
        </div>
      </div>

      {/* Messages */}
      <div class="flex-1 overflow-y-auto p-4 space-y-6">
        <MessageBubbleSkeleton />
        <MessageBubbleSkeleton isUser />
        <MessageBubbleSkeleton />
        <div class="flex items-start gap-2">
          <Skeleton width="32px" height="32px" rounded="full" class="shrink-0" />
          <div class="space-y-2 max-w-[70%]">
            <Skeleton width="150px" height="16px" rounded="lg" />
            <Skeleton width="100%" height="120px" rounded="xl" />
            <Skeleton width="60px" height="12px" rounded="md" />
          </div>
        </div>
      </div>

      {/* Input */}
      <div class="p-4 border-t border-base-300">
        <div class="flex items-end gap-2">
          <Skeleton width="100%" height="44px" rounded="textarea" class="flex-1" />
          <Skeleton width="44px" height="44px" rounded="btn" />
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Dashboard Skeleton
// ============================================================================

export const DashboardSkeleton: Component<{ class?: string }> = (props) => {
  return (
    <div class={cn("p-4 space-y-6", props.class)}>
      {/* Header */}
      <div class="flex items-center justify-between">
        <div class="space-y-1.5">
          <Skeleton width="180px" height="24px" />
          <Skeleton width="120px" height="14px" />
        </div>
        <Skeleton width="100px" height="36px" rounded="btn" />
      </div>

      {/* Stats Cards */}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(() => (
          <div class="card bg-base-100 shadow border border-base-300 p-4 space-y-3">
            <div class="flex items-center gap-2">
              <Skeleton width="32px" height="32px" rounded="lg" />
              <Skeleton width="80px" height="12px" />
            </div>
            <Skeleton width="60px" height="24px" />
          </div>
        ))}
      </div>

      {/* Sessions */}
      <div class="space-y-3">
        <Skeleton width="100px" height="18px" />
        <div class="space-y-2">
          {[1, 2, 3].map(() => (
            <div class="flex items-center gap-3 p-3 bg-base-100 rounded-xl border border-base-300">
              <Skeleton width="40px" height="40px" rounded="lg" />
              <div class="flex-1 space-y-1.5">
                <Skeleton width="60%" height="14px" />
                <Skeleton width="40%" height="12px" />
              </div>
              <Skeleton width="60px" height="24px" rounded="full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Content Skeleton (Generic)
// ============================================================================

export const ContentSkeleton: Component<{ lines?: number; class?: string }> = (props) => {
  const lines = () => props.lines || 5;

  return (
    <div class={cn("space-y-3", props.class)}>
      <For each={Array(lines()).fill(0)}>
        {(_, i) => (
          <Skeleton 
            width={i() === lines() - 1 ? "60%" : "100%"} 
            height="14px" 
            rounded="md" 
          />
        )}
      </For>
    </div>
  );
};

// ============================================================================
// Loading Spinner (DaisyUI native)
// ============================================================================

export interface SpinnerProps {
  size?: "xs" | "sm" | "md" | "lg";
  class?: string;
}

export const Spinner: Component<SpinnerProps> = (props) => {
  const sizeClass = {
    xs: "loading-xs",
    sm: "loading-sm",
    md: "loading-md",
    lg: "loading-lg",
  };

  return (
    <span class={cn("loading loading-spinner text-primary", sizeClass[props.size || "md"], props.class)} />
  );
};

// ============================================================================
// Loading Dots (DaisyUI native)
// ============================================================================

export interface LoadingDotsProps {
  size?: "xs" | "sm" | "md";
  class?: string;
}

export const LoadingDots: Component<LoadingDotsProps> = (props) => {
  const sizeClass = {
    xs: "loading-xs",
    sm: "loading-sm",
    md: "loading-md",
  };

  return (
    <span class={cn("loading loading-dots", sizeClass[props.size || "md"], props.class)} />
  );
};

// ============================================================================
// Loading Bar
// ============================================================================

export interface LoadingBarProps {
  class?: string;
}

export const LoadingBar: Component<LoadingBarProps> = (props) => {
  return (
    <div class={cn("progress w-full", props.class)}>
      <div class="progress-bar progress-primary animate-pulse" />
    </div>
  );
};

// ============================================================================
// Inline Loading (text + spinner)
// ============================================================================

export interface LoadingTextProps {
  text?: string;
  class?: string;
}

export const LoadingText: Component<LoadingTextProps> = (props) => {
  return (
    <div class={cn("flex items-center gap-2", props.class)}>
      <span class="loading loading-spinner loading-sm text-primary" />
      <Show when={props.text}>
        <span class="text-sm text-base-content/60">{props.text}</span>
      </Show>
    </div>
  );
};

// Alias for backward compatibility
export const SpinnerWithLabel = LoadingText;

// ============================================================================
// Pulse Ring (for emphasis)
// ============================================================================

export interface PulseRingProps {
  size?: "xs" | "sm" | "md" | "lg";
  class?: string;
}

export const PulseRing: Component<PulseRingProps> = (props) => {
  const sizeClass = {
    xs: "w-3 h-3",
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <div class={cn("relative", sizeClass[props.size || "md"], props.class)}>
      <div class="absolute inset-0 rounded-full animate-ping opacity-75 bg-primary" />
      <div class="relative rounded-full bg-primary" />
    </div>
  );
};

// All components already exported individually above
// Backward compatibility alias
// Note: ContentSkeleton is exported above and used directly