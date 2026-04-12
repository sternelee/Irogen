/**
 * Enhanced Toast/Notification System - DaisyUI v5
 *
 * Features:
 * - Uses DaisyUI alert component with variant classes
 * - Slide-in animations via DaisyUI transitions
 * - Progress bar for auto-dismiss countdown
 * - Stacking for multiple toasts
 * - Toast variant icons with DaisyUI styling
 * - "Undo" action support via btn classes
 * - Top-right positioning with mobile responsiveness
 */

import {
  type Component,
  Show,
  For,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";
import { cn } from "~/lib/utils";
import {
  FiCheck,
  FiX,
  FiAlertCircle,
  FiInfo,
  FiAlertTriangle,
  FiRotateCcw,
} from "solid-icons/fi";

// ============================================================================
// Types
// ============================================================================

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  action?: ToastAction;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
  stackIndex: number;
}

// ============================================================================
// Toast Icons
// ============================================================================

const toastIcons = {
  success: FiCheck,
  error: FiAlertCircle,
  warning: FiAlertTriangle,
  info: FiInfo,
};

// ============================================================================
// Toast Item Component - DaisyUI Alert Style
// ============================================================================

const ToastItem: Component<ToastItemProps> = (props) => {
  const [isVisible, setIsVisible] = createSignal(false);
  const [progress, setProgress] = createSignal(100);
  let timeoutId: number | undefined;
  let progressInterval: number | undefined;
  const duration = props.toast.duration ?? 5000;

  onMount(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Auto-dismiss after duration
    if (duration > 0) {
      const step = 50;
      const decrementPerStep = (100 / duration) * step;

      progressInterval = window.setInterval(() => {
        setProgress((prev) => {
          const next = prev - decrementPerStep;
          return next < 0 ? 0 : next;
        });
      }, step);

      timeoutId = window.setTimeout(() => {
        handleDismiss();
      }, duration);
    }
  });

  onCleanup(() => {
    if (timeoutId) clearTimeout(timeoutId);
    if (progressInterval) clearInterval(progressInterval);
  });

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => {
      props.onDismiss(props.toast.id);
    }, 200);
  };

  const Icon = toastIcons[props.toast.type];
  const alertClass = `alert-${props.toast.type}`;

  return (
    <div
      role="alert"
      class={cn(
        "alert shadow-lg transition-all duration-200",
        alertClass,
        isVisible()
          ? "translate-x-0 opacity-100 scale-100"
          : "translate-x-full opacity-0 scale-95",
        props.stackIndex > 0 && "mt-2"
      )}
    >
      {/* Icon */}
      <Icon class="shrink-0 w-5 h-5" />

      {/* Content */}
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold">{props.toast.title}</div>
        <Show when={props.toast.description}>
          <div class="text-xs opacity-80 mt-0.5 line-clamp-2">
            {props.toast.description}
          </div>
        </Show>

        {/* Action Button */}
        <Show when={props.toast.action}>
          <button
            type="button"
            onClick={() => {
              props.toast.action?.onClick();
              handleDismiss();
            }}
            class="btn btn-xs btn-ghost mt-1"
          >
            <FiRotateCcw class="w-3 h-3 mr-1" />
            {props.toast.action?.label}
          </button>
        </Show>
      </div>

      {/* Close Button */}
      <button
        type="button"
        onClick={handleDismiss}
        class="btn btn-sm btn-ghost btn-square"
      >
        <FiX class="w-4 h-4" />
      </button>

      {/* Progress Bar */}
      <Show when={duration > 0 && progress() > 0}>
        <div
          class="absolute bottom-0 left-0 h-1 bg-base-100/50 transition-all duration-50 ease-linear rounded-none"
          style={{ width: `${progress()}%` }}
        />
      </Show>
    </div>
  );
};

// ============================================================================
// Toast Container Component
// ============================================================================

export interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  class?: string;
}

export const ToastContainer: Component<ToastContainerProps> = (props) => {
  return (
    <div
      class={cn(
        "toast toast-top toast-end z-[100]",
        "flex flex-col gap-2",
        "max-h-[calc(100vh-2rem)]",
        props.class
      )}
    >
      <For each={props.toasts}>
        {(toast, index) => (
          <ToastItem
            toast={toast}
            onDismiss={props.onDismiss}
            stackIndex={index()}
          />
        )}
      </For>
    </div>
  );
};

// ============================================================================
// Toast Hook (for usage in stores)
// ============================================================================

export interface UseToastOptions {
  duration?: number;
}

export function createToast(options: UseToastOptions = {}) {
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const addToast = (
    type: ToastType,
    title: string,
    description?: string,
    action?: ToastAction
  ) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = {
      id,
      type,
      title,
      description,
      duration: options.duration,
      action,
    };
    setToasts((prev) => [...prev.slice(-4), toast]);
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const dismissAll = () => {
    setToasts([]);
  };

  const success = (title: string, description?: string, action?: ToastAction) =>
    addToast("success", title, description, action);
  const error = (title: string, description?: string, action?: ToastAction) =>
    addToast("error", title, description, action);
  const warning = (title: string, description?: string, action?: ToastAction) =>
    addToast("warning", title, description, action);
  const info = (title: string, description?: string, action?: ToastAction) =>
    addToast("info", title, description, action);

  return {
    toasts,
    addToast,
    dismissToast,
    dismissAll,
    success,
    error,
    warning,
    info,
  };
}

export type { Toast, ToastAction, ToastType };