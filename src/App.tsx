import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import "./index.css";
import "./fonts.css";
import "./styles/adaptive-layout.css";
import "./App.css";
import { onMount } from "solid-js";
import { initializeDeviceDetection } from "./stores/deviceStore";
import { initializeMobileUtils } from "./utils/mobile";
import { getViewportManager } from "./utils/mobile/ViewportManager";
import { getAdaptiveLayoutManager } from "./utils/mobile/AdaptiveLayoutManager";
import { initializePerformanceOptimizations } from "./utils/performance";

export default function Root() {
  onMount(() => {
    // Initialize VConsole only in development
    if (import.meta.env.DEV) {
      // @ts-ignore - VConsole is loaded via import
      import('vconsole').then(({ default: VConsole }) => {
        new VConsole();
      });
    }

    // Initialize mobile optimizations
    initializeDeviceDetection();
    initializeMobileUtils({ integrateViewportManager: true });
    initializePerformanceOptimizations();

    const viewportManager = getViewportManager();
    viewportManager.initialize();

    const layoutManager = getAdaptiveLayoutManager();
    layoutManager.initialize();
    layoutManager.applyLayoutClasses();
    layoutManager.onLayoutChange(() => layoutManager.applyLayoutClasses());
  });

  return (
    <Router>
      <FileRoutes />
    </Router>
  );
}
