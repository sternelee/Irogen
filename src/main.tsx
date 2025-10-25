import { render } from "solid-js/web";
// import VConsole from 'vconsole';

import App from "./App";
import "./index.css";
import "./fonts.css";
import "./styles/adaptive-layout.css";
import { initializeMobileUtils } from "./utils/mobile";
import { getViewportManager } from "./utils/mobile/ViewportManager";
import { getAdaptiveLayoutManager } from "./utils/mobile/AdaptiveLayoutManager";
import { initializeTheme } from "./utils/theme";
import { initializePerformanceOptimizations } from "./utils/performance";

// new VConsole();

// Initialize mobile utilities and optimizations with ViewportManager integration
initializeMobileUtils({ integrateViewportManager: true });
initializeTheme();
initializePerformanceOptimizations();

// Initialize ViewportManager
const viewportManager = getViewportManager();
viewportManager.initialize();

// Initialize AdaptiveLayoutManager
const layoutManager = getAdaptiveLayoutManager();
layoutManager.initialize();

// Apply initial layout classes
layoutManager.applyLayoutClasses();

// Update layout classes on changes
layoutManager.onLayoutChange(() => {
  layoutManager.applyLayoutClasses();
});

render(() => <App />, document.getElementById("root") as HTMLElement);

// Handle app lifecycle
window.addEventListener("beforeunload", () => {
  // Cleanup resources when app is about to close
  const { cleanupPerformanceOptimizations } = require("./utils/performance");
  cleanupPerformanceOptimizations();
});
