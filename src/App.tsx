import { useEffect } from "react";
import { Outlet } from "@tanstack/react-router";
import { useAppContext } from "@/lib/app-context";
import { useTauriEvents } from "@/hooks/useTauriEvents";
import { SessionStoreProvider } from "@/lib/session-store";
import { ToastContainer } from "@/components/ToastContainer";

function AppInner() {
  // Wire up Tauri event listeners
  useTauriEvents();

  // Initialize device CSS classes
  const { deviceInfo } = useAppContext();

  useEffect(() => {
    if (deviceInfo.isMobile) {
      document.documentElement.classList.add("mobile");
    }
    if (deviceInfo.platform) {
      document.documentElement.classList.add(`platform-${deviceInfo.platform}`);
    }
  }, [deviceInfo]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
      <ToastContainer />
    </div>
  );
}

export function App() {
  return (
    <SessionStoreProvider>
      <AppInner />
    </SessionStoreProvider>
  );
}
