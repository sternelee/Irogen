import { For, Show } from "solid-js";
import { TransitionGroup } from "solid-transition-group";
import { Info, CheckCircle, TriangleAlert, XCircle, X } from "lucide-solid";
import { notificationStore } from "../stores/notificationStore";
import { cn } from "../lib/utils";

export const ToastContainer = () => {
  return (
    <div class="toast toast-top toast-end z-[100] p-4 pointer-events-none">
      <TransitionGroup
        onEnter={(el, done) => {
          const a = el.animate(
            [
              { opacity: 0, transform: "translateX(20px)" },
              { opacity: 1, transform: "translateX(0)" },
            ],
            { duration: 200 },
          );
          a.finished.then(done);
        }}
        onExit={(el, done) => {
          const a = el.animate(
            [
              { opacity: 1, transform: "translateX(0)" },
              { opacity: 0, transform: "translateX(20px)" },
            ],
            { duration: 200 },
          );
          a.finished.then(done);
        }}
      >
        <For each={notificationStore.state.notifications}>
          {(notification) => (
            <div
              class={cn(
                "alert shadow-lg mb-2 flex items-start pr-8 min-w-[300px] pointer-events-auto border border-base-content/10",
                notification.type === "success" && "alert-success",
                notification.type === "error" && "alert-error",
                notification.type === "warning" && "alert-warning",
                notification.type === "info" && "alert-info",
              )}
            >
              <div class="flex-shrink-0 mt-0.5">
                <Show when={notification.type === "success"}>
                  <CheckCircle size={18} />
                </Show>
                <Show when={notification.type === "error"}>
                  <XCircle size={18} />
                </Show>
                <Show when={notification.type === "warning"}>
                  <TriangleAlert size={18} />
                </Show>
                <Show when={notification.type === "info"}>
                  <Info size={18} />
                </Show>
              </div>
              <div class="flex flex-col gap-0.5 text-left">
                <h3 class="font-bold text-sm leading-none">
                  {notification.title}
                </h3>
                <div class="text-xs opacity-90 leading-tight">
                  {notification.message}
                </div>
              </div>
              <button
                class="btn btn-ghost btn-neutral btn-xs btn-square absolute right-2 top-2"
                onClick={() =>
                  notificationStore.removeNotification(notification.id)
                }
              >
                <X size={14} />
              </button>
            </div>
          )}
        </For>
      </TransitionGroup>
    </div>
  );
};
