/**
 * Enhanced Toast/Notification System
 *
 * AI-native toast notifications inspired by Vercel AI Elements
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
} from "solid-icons/fi";

// ============================================================================
// Types
// ============================================================================

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
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

const toastStyles = {
  success: "alert-success",
  error: "alert-error",
  warning: "alert-warning",
  info: "alert-info",
};

// ============================================================================
// Toast Item Component
// ============================================================================

const ToastItem: Component<ToastItemProps> = (props) => {
  let timeoutId: number | undefined;

  onMount(() => {
    // Auto-dismiss after duration
    const duration = props.toast.duration || 5000;
    if (duration > 0) {
      timeoutId = window.setTimeout(() => {
        props.onDismiss(props.toast.id);
      }, duration);
    }
  });

  onCleanup(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  const Icon = toastIcons[props.toast.type];

  return (
    <div role="alert" class={cn("alert", toastStyles[props.toast.type])}>
      <Icon size={20} />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium">{props.toast.title}</div>
        <Show when={props.toast.description}>
          <div class="text-xs opacity-80 mt-0.5">{props.toast.description}</div>
        </Show>
      </div>
      <button
        type="button"
        onClick={() => props.onDismiss(props.toast.id)}
        class="btn btn-sm btn-square bg-base-content/25 hover:bg-base-content/40 text-base-200 border-0"
      >
        <FiX size={16} />
      </button>
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
        "fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 sm:max-w-sm",
        props.class,
      )}
    >
      <For each={props.toasts}>
        {(toast) => <ToastItem toast={toast} onDismiss={props.onDismiss} />}
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

  const addToast = (type: ToastType, title: string, description?: string) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = {
      id,
      type,
      title,
      description,
      duration: options.duration,
    };
    setToasts((prev) => [...prev, toast]);
    return id;
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const success = (title: string, description?: string) =>
    addToast("success", title, description);
  const error = (title: string, description?: string) =>
    addToast("error", title, description);
  const warning = (title: string, description?: string) =>
    addToast("warning", title, description);
  const info = (title: string, description?: string) =>
    addToast("info", title, description);

  return {
    toasts,
    addToast,
    dismissToast,
    success,
    error,
    warning,
    info,
  };
}
