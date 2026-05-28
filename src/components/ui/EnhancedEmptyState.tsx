/**
 * EnhancedEmptyState - Reusable empty state component
 *
 * A friendly, inviting empty state that helps users understand what to do.
 * Supports animations, tips, and action buttons.
 */

import { type Component, Show, For } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "~/lib/utils";

type AnimationType = "float" | "pulse" | "bounce" | "none";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: Component<{ size?: number; class?: string }>;
}

interface EnhancedEmptyStateProps {
  icon: Component<{ size?: number; class?: string }>;
  title: string;
  description: string;
  tips?: string[];
  actions?: EmptyStateAction[];
  animation?: AnimationType;
  class?: string;
}

const animationClasses: Record<AnimationType, string> = {
  float: "animate-[float_3s_ease-in-out_infinite]",
  pulse: "animate-pulse",
  bounce: "animate-bounce",
  none: "",
};

// Add float animation to index.css if not present
const FloatKeyframes = `
@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-8px);
  }
}
`;

// Inject float animation once
let floatAnimationInjected = false;
const injectFloatAnimation = () => {
  if (floatAnimationInjected) return;
  floatAnimationInjected = true;

  const style = document.createElement("style");
  style.textContent = FloatKeyframes;
  document.head.appendChild(style);
};

export const EnhancedEmptyState: Component<EnhancedEmptyStateProps> = (
  props,
) => {
  const animation = () => props.animation || "float";

  // Inject float animation on first render
  if (animation() === "float") {
    injectFloatAnimation();
  }

  return (
    <div
      class={cn(
        "flex flex-col items-center justify-center px-4 py-12 text-center",
        props.class,
      )}
    >
      {/* Animated Icon Container */}
      <div class={cn("relative mb-6", animationClasses[animation()])}>
        {/* Background glow */}
        <div class="absolute inset-0 bg-primary/10 rounded-3xl blur-xl" />

        {/* Main icon container */}
        <div class="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10">
          <props.icon size={36} class="text-primary" />
        </div>

        {/* Decorative elements */}
        <div class="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
          <span class="text-primary text-xs">✨</span>
        </div>
      </div>

      {/* Title */}
      <h3 class="text-lg font-semibold tracking-tight mb-2">{props.title}</h3>

      {/* Description */}
      <p class="text-sm text-base-content/50 max-w-xs mb-6 leading-relaxed">
        {props.description}
      </p>

      {/* Tips Section */}
      <Show when={props.tips && props.tips.length > 0}>
        <div class="mb-6 w-full max-w-sm">
          <div class="rounded-xl bg-base-200/30 border border-base-300/50 p-4 text-left">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-base-content/50/60 mb-2">
              Quick Tips
            </p>
            <ul class="space-y-2">
              <For each={props.tips}>
                {(tip) => (
                  <li class="flex items-start gap-2 text-xs text-base-content/50">
                    <span class="text-primary mt-0.5">•</span>
                    <span>{tip}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </div>
      </Show>

      {/* Action Buttons */}
      <Show when={props.actions && props.actions.length > 0}>
        <div class="flex flex-wrap gap-2 justify-center">
          <For each={props.actions}>
            {(action, index) => (
              <button
                type="button"
                onClick={action.onClick}
                class={cn(
                  "px-4 py-2 text-sm rounded-xl font-medium transition-all duration-200",
                  "hover:scale-105 active:scale-95",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  index() === 0
                    ? "bg-primary text-primary-contrast shadow-lg shadow-primary/20 hover:shadow-xl"
                    : "bg-base-200/50 hover:bg-base-200 border border-base-300",
                )}
              >
                <Show when={action.icon}>
                  <Dynamic
                    component={action.icon}
                    size={14}
                    class="inline mr-1.5 -mt-0.5"
                  />
                </Show>
                {action.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default EnhancedEmptyState;
