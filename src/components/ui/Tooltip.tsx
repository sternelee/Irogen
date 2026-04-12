/**
 * Tooltip Component with OpenChamber Animations
 *
 * Features:
 * - Smooth fade-in/zoom animations
 * - Improved arrow styling
 * - Better positioning and offset handling
 * - Portal rendering for proper z-index
 */

import { type Component, Show, createSignal, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "~/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type TooltipPosition = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: JSX.Element;
  children: JSX.Element;
  position?: TooltipPosition;
  delay?: number;
  class?: string;
}

// ============================================================================
// Tooltip Component
// ============================================================================

export const Tooltip: Component<TooltipProps> = (props) => {
  const [isVisible, setIsVisible] = createSignal(false);
  const [coords, setCoords] = createSignal({ top: 0, left: 0 });
  let triggerRef: HTMLDivElement | undefined;
  let timeoutId: number | undefined;

  const position = props.position || "top";

  // Enhanced position classes with better offsets
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-2.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-2.5",
  };

  // Improved arrow classes with proper borders
  const arrowClasses = {
    top: "top-full left-1/2 -translate-x-1/2 border-t-base-content/20 border-x-transparent border-b-transparent",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-base-content/20 border-x-transparent border-t-transparent",
    left: "left-full top-1/2 -translate-y-1/2 border-l-base-content/20 border-y-transparent border-r-transparent",
    right: "right-full top-1/2 -translate-y-1/2 border-r-base-content/20 border-y-transparent border-l-transparent",
  };

  // Arrow position adjustments
  const arrowTranslate = {
    top: "-translate-x-1/2 -translate-y-full",
    bottom: "-translate-x-1/2 translate-y-full",
    left: "-translate-y-1/2 -translate-x-full",
    right: "-translate-y-1/2 translate-x-full",
  };

  const handleMouseEnter = () => {
    const delay = props.delay ?? 300;
    timeoutId = window.setTimeout(() => {
      updateCoords();
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    setIsVisible(false);
  };

  const updateCoords = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    
    setCoords({
      top: rect.top + scrollY,
      left: rect.left + scrollX,
    });
  };

  onCleanup(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  return (
    <div
      ref={triggerRef}
      class={cn("relative inline-flex", props.class)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {props.children}

      {/* Portal rendered tooltip for proper z-index */}
      <Show when={isVisible()}>
        <Portal>
          <div
            class={cn(
              "absolute z-[100] px-3 py-2",
              "text-sm font-medium",
              "bg-base-300/95 backdrop-blur-sm border border-base-content/10",
              "rounded-lg shadow-lg",
              "animate-tooltip-in", // fade + zoom animation
              positionClasses[position]
            )}
            style={{
              top: `${coords().top}px`,
              left: `${coords().left}px`,
            }}
          >
            {props.content}
            {/* Improved Arrow with proper borders */}
            <div
              class={cn(
                "absolute w-0 h-0 border-[6px]",
                arrowClasses[position]
              )}
            />
          </div>
        </Portal>
      </Show>
    </div>
  );
};

// ============================================================================
// Tooltip Provider (for managing tooltips)
// ============================================================================

export interface TooltipProviderProps {
  children: JSX.Element;
  delayDuration?: number;
}

export const TooltipProvider: Component<TooltipProviderProps> = (props) => {
  return <>{props.children}</>;
};
