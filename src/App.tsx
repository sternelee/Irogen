import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { onMount } from "solid-js";
import { initializeDeviceDetection } from "./stores/deviceStore";
import { initializeMobileUtils } from "./utils/mobile";
import { getViewportManager } from "./utils/mobile/ViewportManager";
import { getAdaptiveLayoutManager } from "./utils/mobile/AdaptiveLayoutManager";
import { initializePerformanceOptimizations } from "./utils/performance";
import VConsole from "vconsole";
import "./index.css";
import "./fonts.css";
import "./styles/adaptive-layout.css";

new VConsole();

export default function Root() {
  onMount(() => {

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
