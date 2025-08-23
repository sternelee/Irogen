import { render } from "solid-js/web";
import App from "./App";
import "./index.css";
import "./fonts.css";
import { initializeMobileUtils } from "./utils/mobile";
import { initializeTheme } from "./utils/theme";
import { initializePerformanceOptimizations } from "./utils/performance";

// Initialize mobile utilities and optimizations
initializeMobileUtils();
initializeTheme();
initializePerformanceOptimizations();

render(() => <App />, document.getElementById("root") as HTMLElement);

// Handle app lifecycle
window.addEventListener("beforeunload", () => {
  // Cleanup resources when app is about to close
  const { cleanupPerformanceOptimizations } = require("./utils/performance");
  cleanupPerformanceOptimizations();
});
