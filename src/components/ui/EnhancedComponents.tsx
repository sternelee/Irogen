import { createSignal, createEffect, Show, For, JSX } from "solid-js";

// Enhanced Card Component with Mobile-First Design
interface EnhancedCardProps {
  title?: string;
  subtitle?: string;
  icon?: string;
  children: JSX.Element;
  class?: string;
  variant?: "default" | "compact" | "featured" | "minimal";
  onTap?: () => void;
  actions?: JSX.Element;
  status?: "success" | "warning" | "error" | "info";
}

export function EnhancedCard(props: EnhancedCardProps) {
  const getVariantClass = () => {
    switch (props.variant) {
      case "compact":
        return "card-compact";
      case "featured":
        return "card bg-gradient-to-br from-primary/10 to-secondary/10";
      case "minimal":
        return "border border-base-300 bg-base-50";
      default:
        return "card bg-base-100 shadow-lg";
    }
  };

  const getStatusIndicator = () => {
    if (!props.status) return null;
    const colors = {
      success: "bg-success",
      warning: "bg-warning",
      error: "bg-error",
      info: "bg-info"
    };
    return <div class={`w-1 h-full ${colors[props.status]} rounded-l-lg`}></div>;
  };

  return (
    <div
      class={`${getVariantClass()} ${props.class || ""} ${props.onTap ? "cursor-pointer hover:shadow-xl transition-all duration-200" : ""} relative overflow-hidden`}
      onClick={props.onTap}
    >
      {getStatusIndicator()}
      <div class="card-body p-4 md:p-6">
        <Show when={props.title || props.icon}>
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center space-x-3">
              <Show when={props.icon}>
                <span class="text-2xl">{props.icon}</span>
              </Show>
              <div>
                <Show when={props.title}>
                  <h2 class="card-title text-lg">{props.title}</h2>
                </Show>
                <Show when={props.subtitle}>
                  <p class="text-sm opacity-70">{props.subtitle}</p>
                </Show>
              </div>
            </div>
            <Show when={props.actions}>
              <div class="card-actions">{props.actions}</div>
            </Show>
          </div>
        </Show>
        {props.children}
      </div>
    </div>
  );
}

// Enhanced Button with Haptic Feedback
interface EnhancedButtonProps {
  children?: JSX.Element;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "accent" | "ghost" | "outline" | "error" | "success";
  size?: "xs" | "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  class?: string;
  fullWidth?: boolean;
  haptic?: boolean;
}

export function EnhancedButton(props: EnhancedButtonProps) {
  const handleClick = () => {
    // Add haptic feedback for mobile
    if (props.haptic && window.navigator?.vibrate) {
      window.navigator.vibrate(10);
    }
    props.onClick?.();
  };

  const getVariantClass = () => {
    switch (props.variant) {
      case "primary": return "btn-primary";
      case "secondary": return "btn-secondary";
      case "accent": return "btn-accent";
      case "ghost": return "btn-ghost";
      case "outline": return "btn-outline";
      case "error": return "btn-error";
      case "success": return "btn-success";
      default: return "btn-primary";
    }
  };

  const getSizeClass = () => {
    switch (props.size) {
      case "xs": return "btn-xs";
      case "sm": return "btn-sm";
      case "md": return "btn-md";
      case "lg": return "btn-lg";
      default: return "btn-md";
    }
  };

  return (
    <button
      class={`btn ${getVariantClass()} ${getSizeClass()} ${props.fullWidth ? "w-full" : ""} ${props.class || ""} transition-all duration-200 hover:scale-105 active:scale-95`}
      onClick={handleClick}
      disabled={props.disabled || props.loading}
    >
      <Show when={props.loading}>
        <span class="loading loading-spinner loading-sm"></span>
      </Show>
      <Show when={props.icon && !props.loading}>
        <span>{props.icon}</span>
      </Show>
      {props.children}
    </button>
  );
}

// Enhanced Input with Mobile Optimizations
interface EnhancedInputProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "url";
  icon?: string;
  error?: string;
  label?: string;
  class?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}

export function EnhancedInput(props: EnhancedInputProps) {
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.autoFocus && inputRef) {
      inputRef.focus();
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && props.onEnter) {
      props.onEnter();
    }
  };

  return (
    <div class="form-control w-full">
      <Show when={props.label}>
        <label class="label">
          <span class="label-text font-medium">{props.label}</span>
        </label>
      </Show>
      <div class="relative">
        <Show when={props.icon}>
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span class="text-base-content/50">{props.icon}</span>
          </div>
        </Show>
        <input
          ref={inputRef}
          type={props.type || "text"}
          placeholder={props.placeholder}
          class={`input input-bordered w-full ${props.icon ? "pl-10" : ""} ${props.error ? "input-error" : ""} ${props.class || ""}`}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={props.disabled}
        />
      </div>
      <Show when={props.error}>
        <label class="label">
          <span class="label-text-alt text-error">{props.error}</span>
        </label>
      </Show>
    </div>
  );
}

// Floating Action Button for Mobile
interface FloatingActionButtonProps {
  icon: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "accent";
  position?: "bottom-right" | "bottom-left" | "bottom-center";
  class?: string;
  badge?: string | number;
}

export function FloatingActionButton(props: FloatingActionButtonProps) {
  const getPositionClass = () => {
    switch (props.position) {
      case "bottom-left":
        return "fixed bottom-6 left-6 z-50";
      case "bottom-center":
        return "fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50";
      case "bottom-right":
      default:
        return "fixed bottom-6 right-6 z-50";
    }
  };

  const getVariantClass = () => {
    switch (props.variant) {
      case "secondary": return "btn-secondary";
      case "accent": return "btn-accent";
      default: return "btn-primary";
    }
  };

  return (
    <div class={getPositionClass()}>
      <button
        class={`btn btn-circle btn-lg ${getVariantClass()} shadow-2xl hover:scale-110 transition-all duration-200 ${props.class || ""}`}
        onClick={props.onClick}
      >
        <span class="text-xl">{props.icon}</span>
        <Show when={props.badge}>
          <div class="absolute -top-2 -right-2 badge badge-error badge-sm">
            {props.badge}
          </div>
        </Show>
      </button>
    </div>
  );
}

// Pull-to-Refresh Component
interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: JSX.Element;
  class?: string;
  threshold?: number;
}

export function PullToRefresh(props: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = createSignal(0);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  const [isPulling, setIsPulling] = createSignal(false);
  let startY = 0;
  let containerRef: HTMLDivElement | undefined;

  const threshold = props.threshold || 80;

  const handleTouchStart = (e: TouchEvent) => {
    if (containerRef && containerRef.scrollTop === 0) {
      startY = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isPulling()) return;

    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - startY);

    if (distance > 0) {
      e.preventDefault();
      setPullDistance(Math.min(distance, threshold * 1.5));
    }
  };

  const handleTouchEnd = async () => {
    if (!isPulling()) return;

    setIsPulling(false);

    if (pullDistance() >= threshold) {
      setIsRefreshing(true);
      try {
        await props.onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  };

  return (
    <div
      ref={containerRef}
      class={`relative overflow-auto ${props.class || ""}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ transform: `translateY(${Math.min(pullDistance(), threshold)}px)` }}
    >
      <Show when={pullDistance() > 0 || isRefreshing()}>
        <div class="absolute top-0 left-0 right-0 flex justify-center py-4 bg-base-100">
          <Show
            when={isRefreshing()}
            fallback={
              <div class="flex flex-col items-center text-sm opacity-70">
                <span class="text-2xl mb-1">⬇️</span>
                <span>{pullDistance() >= threshold ? "Release to refresh" : "Pull to refresh"}</span>
              </div>
            }
          >
            <div class="flex flex-col items-center text-sm">
              <span class="loading loading-spinner loading-md mb-1"></span>
              <span>Refreshing...</span>
            </div>
          </Show>
        </div>
      </Show>

      <div style={{ "margin-top": pullDistance() > 0 ? "60px" : "0px" }}>
        {props.children}
      </div>
    </div>
  );
}

// Swipe Gesture Component
interface SwipeGestureProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  children: JSX.Element;
  threshold?: number;
  class?: string;
}

export function SwipeGesture(props: SwipeGestureProps) {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  const threshold = props.threshold || 50;
  const timeThreshold = 300;

  const handleTouchStart = (e: TouchEvent) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
  };

  const handleTouchEnd = (e: TouchEvent) => {
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const endTime = Date.now();

    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const deltaTime = endTime - startTime;

    if (deltaTime > timeThreshold) return;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX > absY && absX > threshold) {
      // Horizontal swipe
      if (deltaX > 0) {
        props.onSwipeRight?.();
      } else {
        props.onSwipeLeft?.();
      }
    } else if (absY > absX && absY > threshold) {
      // Vertical swipe
      if (deltaY > 0) {
        props.onSwipeDown?.();
      } else {
        props.onSwipeUp?.();
      }
    }
  };

  return (
    <div
      class={props.class}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {props.children}
    </div>
  );
}
