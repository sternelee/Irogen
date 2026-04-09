/**
 * Dialog (Modal) - DaisyUI Pattern
 *
 * Uses DaisyUI's native modal pattern:
 * <dialog class="modal">
 *   <div class="modal-box">...</div>
 * </dialog>
 */

import { type JSX, Show } from "solid-js";

type DialogProps = {
  open: boolean;
  onClose?: () => void;
  class?: string;
  contentClass?: string;
  children: JSX.Element;
};

export function Dialog(props: DialogProps) {
  return (
    <Show when={props.open}>
      {/* Use native HTML dialog element with DaisyUI classes */}
      <dialog
        class={`modal modal-bottom sm:modal-middle ${props.open ? "modal-open" : ""} ${props.class || ""}`}
      >
        {/* Backdrop - clicks outside to close */}
        <div
          class="modal-backdrop bg-black/40 backdrop-blur-[2px]"
          onClick={props.onClose}
        >
          <button
            type="button"
            class="cursor-default w-full h-full border-none"
          >
            close
          </button>
        </div>

        {/* Modal Box */}
        <div
          class={`modal-box relative rounded-t-3xl rounded-b-none sm:rounded-2xl ${props.contentClass || ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle for mobile bottom sheet */}
          <div class="flex justify-center -mt-2 mb-4 sm:hidden">
            <div class="w-10 h-1 bg-base-content/20 rounded-full" />
          </div>

          {props.children}

          {/* Close button (top right) */}
          <button
            type="button"
            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2 hidden"
            onClick={props.onClose}
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-4"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </dialog>
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
