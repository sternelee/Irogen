/**
 * Notification Store (DaisyUI Toast)
 */

import { createStore } from "solid-js/store";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  title: string;
  duration: number;
}

interface NotificationState {
  notifications: Notification[];
}

const [state, setState] = createStore<NotificationState>({
  notifications: [],
});

const removeNotification = (id: string) => {
  setState("notifications", (notifications) =>
    notifications.filter((n) => n.id !== id),
  );
};

const notify = (
  type: NotificationType,
  message: string,
  title: string,
  duration: number,
): string => {
  const id = Math.random().toString(36).substring(2, 9);
  const newNotification: Notification = {
    id,
    type,
    message,
    title,
    duration,
  };

  setState("notifications", (notifications) => [
    ...notifications,
    newNotification,
  ]);

  if (duration > 0) {
    setTimeout(() => {
      removeNotification(id);
    }, duration);
  }

  return id;
};

export const createNotificationStore = () => {
  const info = (message: string, title?: string, duration = 15000) =>
    notify("info", message, title ?? "Info", duration);

  const success = (message: string, title?: string, duration = 13000) =>
    notify("success", message, title ?? "Success", duration);

  const warning = (message: string, title?: string, duration = 15000) =>
    notify("warning", message, title ?? "Warning", duration);

  const error = (message: string, title?: string, duration = 0) =>
    notify("error", message, title ?? "Error", duration);

  return {
    state,
    info,
    success,
    warning,
    error,
    removeNotification,
  };
};

export const notificationStore = createNotificationStore();
