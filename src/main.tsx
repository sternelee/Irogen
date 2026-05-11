import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "@/lib/query-client";
import { ToastProvider } from "@/lib/toast-context";
import { createAppRouter } from "@/router";
import { AppContextProvider } from "@/lib/app-context";
import "./index.css";

// Tauri imports
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type as osType } from "@tauri-apps/plugin-os";

async function bootstrap() {
  // Detect device info
  let deviceInfo = { os: "unknown", platform: "web", isMobile: false };
  try {
    const os = osType();
    deviceInfo = {
      os,
      platform: os,
      isMobile: os === "android" || os === "ios",
    };
  } catch {
    // Not running in Tauri
  }

  if (deviceInfo.isMobile) {
    document.documentElement.classList.add("mobile");
  }

  const appContext = {
    invoke: <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      return invoke<T>(cmd, args);
    },
    listen: <T,>(event: string, handler: (payload: T) => void) => {
      return listen<T>(event, (e) => handler(e.payload));
    },
    deviceInfo,
  };

  const router = createAppRouter();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppContextProvider value={appContext}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </AppContextProvider>
    </React.StrictMode>
  );
}

bootstrap();
