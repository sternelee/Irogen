/**
 * Dialog (Modal) - DaisyUI Pattern with OpenChamber Animations
 *
 * Features:
 * - Smooth fade-in/zoom-in/slide-in animations
 * - Improved overlay with blur and dimming
 * - Focus trap for accessibility
 * - Better close button positioning
 */

import { type JSX, Show, createEffect, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { FiX } from "solid-icons/fi";
import { cn } from "~/lib/utils";

type DialogProps = {
  open: boolean;
  onClose?: () => void;
  class?: string;
  contentClass?: string;
  children: JSX.Element;
};

export function Dialog(props: DialogProps) {
  let dialogRef: HTMLDialogElement | undefined;
  let previousFocus: HTMLElement | null = null;

  // Handle escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && props.onClose) {
      e.preventDefault();
      props.onClose();
    }
  };

  // Focus trap
  const trapFocus = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef) return;

    const focusableElements = dialogRef.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]',
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  createEffect(() => {
    if (props.open) {
      // Store previous focus
      previousFocus = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", trapFocus);

      // Focus first focusable element
      setTimeout(() => {
        const firstFocusable = dialogRef?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]',
        );
        firstFocusable?.focus();
      }, 50);
    } else {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", trapFocus);
      // Restore previous focus
      previousFocus?.focus();
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("keydown", trapFocus);
    document.body.style.overflow = "";
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
        >
          {/* Enhanced Overlay - blur + dim */}
          <div
            class="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={props.onClose}
            aria-hidden="true"
          />

          {/* Dialog */}
          <dialog
            ref={dialogRef}
            class={cn(
              "relative bg-base-100 rounded-t-3xl rounded-b-none sm:rounded-2xl",
              "shadow-2xl max-h-[85vh] overflow-auto",
              "animate-content-show", // zoom-in animation
              props.class,
            )}
            open
          >
            {/* Mobile handle */}
            <div class="flex justify-center -mt-3 mb-2 sm:hidden">
              <div class="w-12 h-1.5 bg-base-content/20 rounded-full" />
            </div>

            {/* Content wrapper with slide-up effect */}
            <div
              class={cn(
                "relative px-6 py-4 sm:px-8 sm:py-6",
                "animate-slide-up",
                props.contentClass,
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {props.children}

              {/* Improved Close button - top right, always visible */}

              <button
                type="button"
                class={cn(
                  "absolute right-4 top-4 w-8 h-8 p-0",
                  "btn btn-ghost btn-sm btn-square",
                  "flex items-center justify-center",
                  "bg-base-200/50 hover:bg-base-200",
                  "text-base-content/60 hover:text-base-content",
                  "transition-all duration-200",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                )}
                onClick={props.onClose}
              >
                <FiX size={18} />
              </button>
            </div>
          </dialog>
        </div>
      </Portal>
    </Show>
  );
}

// Re-export Dialog components for compatibility
export const DialogTrigger = "button";
export const DialogContent: any = (props: {
  class?: string;
  children?: JSX.Element;
}) => <div class={`modal-box ${props.class || ""}`}>{props.children}</div>;
export const DialogHeader: any = (props: {
  class?: string;
  children?: JSX.Element;
}) => <div class={`modal-header ${props.class || ""}`}>{props.children}</div>;
export const DialogFooter: any = (props: {
  class?: string;
  children?: JSX.Element;
}) => <div class={`modal-action ${props.class || ""}`}>{props.children}</div>;
export const DialogTitle: any = (props: {
  class?: string;
  children?: JSX.Element;
}) => (
  <h3 class={`modal-title font-bold text-lg ${props.class || ""}`}>
    {props.children}
  </h3>
);
export const DialogDescription: any = (props: {
  class?: string;
  children?: JSX.Element;
}) => <p class={`text-sm opacity-60 ${props.class || ""}`}>{props.children}</p>;

export type DialogComponentProps = {
  class?: string;
  children?: JSX.Element;
};
