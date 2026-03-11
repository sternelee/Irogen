/**
 * Notification Display Component
 *
 * Toast-style notifications for P2P push notifications.
 */

import { Component, For, Show } from "solid-js";
import {
  FiInfo,
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
  FiX,
} from "solid-icons/fi";
import { notificationStore, Notification } from "../stores/notificationStore";
import { Alert } from "./ui/primitives";
import { Button } from "./ui/primitives";

// ============================================================================
// Types
// ============================================================================

interface NotificationDisplayProps {
  class?: string;
  position?:
    | "top-right"
    | "top-left"
    | "bottom-right"
    | "bottom-left"
    | "top-center"
    | "bottom-center";
}

// ============================================================================
// Helper functions
// ============================================================================

const getNotificationIcon = (type: Notification["type"]) => {
  switch (type) {
    case "info":
      return <FiInfo size={20} />;
    case "success":
      return <FiCheckCircle size={20} />;
    case "warning":
      return <FiAlertTriangle size={20} />;
    case "error":
      return <FiXCircle size={20} />;
  }
};

const getNotificationColor = (
  type: Notification["type"],
): "info" | "success" | "warning" | "error" => {
  switch (type) {
    case "info":
      return "info";
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
  }
};

const getPositionClasses = (position: string): string => {
  switch (position) {
    case "top-right":
      return "top-4 right-2 sm:right-4";
    case "top-left":
      return "top-4 left-2 sm:left-4";
    case "bottom-right":
      return "bottom-4 right-2 sm:right-4";
    case "bottom-left":
      return "bottom-4 left-2 sm:left-4";
    case "top-center":
      return "top-4 left-1/2 -translate-x-1/2";
    case "bottom-center":
      return "bottom-4 left-1/2 -translate-x-1/2";
    default:
      return "top-4 right-4";
  }
};

// ============================================================================
// Single Notification Component
// ============================================================================

const NotificationItem = (props: { notification: Notification }) => {
  const { dismissNotification, executeAction } = notificationStore;

  const handleDismiss = () => {
    dismissNotification(props.notification.id);
  };

  const handleAction = (index: number) => {
    executeAction(props.notification.id, index);
  };

  return (
    <Alert
      variant={getNotificationColor(props.notification.type)}
      class="relative mb-2 w-full max-w-[min(22rem,calc(100vw-1rem))] sm:max-w-sm shadow-lg"
      classList={{
        "opacity-0 translate-x-full": props.notification.dismissed,
        "opacity-100 translate-x-0": !props.notification.dismissed,
      }}
      style={{
        transition: "all 0.3s ease-out",
      }}
    >
      <div class="flex-shrink-0">
        {getNotificationIcon(props.notification.type)}
      </div>

      <div class="flex-1 min-w-0">
        <h4 class="font-semibold text-xs sm:text-sm leading-5">
          {props.notification.title}
        </h4>
        <p class="text-xs sm:text-sm opacity-90 break-words leading-5">
          {props.notification.message}
        </p>

        {/* Actions */}
        <Show
          when={
            props.notification.actions && props.notification.actions.length > 0
          }
        >
          <div class="flex gap-2 mt-2">
            <For each={props.notification.actions || []}>
              {(action, index) => (
                <Button
                  size="xs"
                  variant={action.primary ? "primary" : "ghost"}
                  onClick={() => handleAction(index())}
                >
                  {action.label}
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Progress bar for auto-dismiss */}
      <Show
        when={props.notification.duration && props.notification.duration > 0}
      >
        <div
          class="absolute bottom-0 left-0 h-1 bg-current opacity-20 animate-[shrink_300ms_linear_forwards]"
          style={{
            "animation-duration": `${props.notification.duration}ms`,
            width: "100%",
          }}
        />
      </Show>

      {/* Dismiss button */}
      <Button
        size="icon"
        variant="ghost"
        class="h-7 w-7 sm:h-8 sm:w-8"
        onClick={handleDismiss}
      >
        <FiX size={14} />
      </Button>
    </Alert>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export const NotificationDisplay: Component<NotificationDisplayProps> = (
  props,
) => {
  const { getVisibleNotifications } = notificationStore;

  const visible = () => getVisibleNotifications();
  const position = () => props.position || "top-right";

  return (
    <div
      class={`notification-container fixed z-50 flex flex-col ${getPositionClasses(position())} ${props.class || ""}`}
    >
      <For each={visible()}>
        {(notification) => <NotificationItem notification={notification} />}
      </For>

      {/* Empty state */}
      <Show when={visible().length === 0}>
        <div class="hidden" />
      </Show>
    </div>
  );
};

export default NotificationDisplay;
