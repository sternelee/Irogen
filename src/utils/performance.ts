// Performance optimization utilities for mobile-first P2P terminal app

export interface PerformanceMetrics {
  fps: number;
  memoryUsage: number;
  renderTime: number;
  interactionLatency: number;
  networkLatency: number;
  batteryLevel?: number;
  screenSize: { width: number; height: number };
  devicePixelRatio: number;
}

export interface ResponsiveBreakpoint {
  name: string;
  min: number;
  max?: number;
  optimizations: string[];
}

// Responsive breakpoints optimized for the app
export const responsiveBreakpoints: ResponsiveBreakpoint[] = [
  {
    name: "mobile-small",
    min: 0,
    max: 374,
    optimizations: [
      "minimize-animations",
      "compact-ui",
      "single-column-layout",
      "large-touch-targets",
      "simplified-terminal",
    ],
  },
  {
    name: "mobile",
    min: 375,
    max: 639,
    optimizations: [
      "mobile-navigation",
      "touch-gestures",
      "virtual-keyboard-support",
      "swipe-actions",
    ],
  },
  {
    name: "tablet",
    min: 640,
    max: 1023,
    optimizations: [
      "dual-pane-layout",
      "enhanced-terminal",
      "keyboard-shortcuts",
      "multi-touch-gestures",
    ],
  },
  {
    name: "desktop",
    min: 1024,
    optimizations: [
      "full-features",
      "multiple-sessions",
      "advanced-terminal",
      "sidebar-navigation",
    ],
  },
];

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private observers: Map<string, PerformanceObserver> = new Map();
  private frameCount = 0;
  private lastFrameTime = 0;
  private isMonitoring = false;

  start(): void {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    // Monitor FPS
    this.startFPSMonitoring();

    // Monitor memory usage
    this.startMemoryMonitoring();

    // Monitor paint timing
    this.startPaintMonitoring();

    // Monitor navigation timing
    this.startNavigationMonitoring();

    // Monitor user interactions
    this.startInteractionMonitoring();
  }

  stop(): void {
    this.isMonitoring = false;
    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();
  }

  private startFPSMonitoring(): void {
    const updateFPS = (timestamp: number) => {
      if (this.lastFrameTime > 0) {
        const delta = timestamp - this.lastFrameTime;
        const fps = 1000 / delta;
        this.updateMetric("fps", fps);
      }
      this.lastFrameTime = timestamp;
      this.frameCount++;

      if (this.isMonitoring) {
        requestAnimationFrame(updateFPS);
      }
    };

    requestAnimationFrame(updateFPS);
  }

  private startMemoryMonitoring(): void {
    if ("memory" in performance) {
      setInterval(() => {
        const memory = (performance as any).memory;
        const memoryUsage = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        this.updateMetric("memoryUsage", memoryUsage * 100);
      }, 5000);
    }
  }

  private startPaintMonitoring(): void {
    if ("PerformanceObserver" in window) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "paint") {
            this.updateMetric("renderTime", entry.startTime);
          }
        }
      });

      observer.observe({ entryTypes: ["paint"] });
      this.observers.set("paint", observer);
    }
  }

  private startNavigationMonitoring(): void {
    if ("PerformanceObserver" in window) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "navigation") {
            const navEntry = entry as PerformanceNavigationTiming;
            const networkLatency = navEntry.responseEnd - navEntry.requestStart;
            this.updateMetric("networkLatency", networkLatency);
          }
        }
      });

      observer.observe({ entryTypes: ["navigation"] });
      this.observers.set("navigation", observer);
    }
  }

  private startInteractionMonitoring(): void {
    let interactionStart = 0;

    const handleInteractionStart = () => {
      interactionStart = performance.now();
    };

    const handleInteractionEnd = () => {
      if (interactionStart > 0) {
        const latency = performance.now() - interactionStart;
        this.updateMetric("interactionLatency", latency);
        interactionStart = 0;
      }
    };

    // Monitor touch interactions
    document.addEventListener("touchstart", handleInteractionStart, {
      passive: true,
    });
    document.addEventListener("touchend", handleInteractionEnd, {
      passive: true,
    });

    // Monitor click interactions
    document.addEventListener("mousedown", handleInteractionStart);
    document.addEventListener("mouseup", handleInteractionEnd);

    // Monitor keyboard interactions
    document.addEventListener("keydown", handleInteractionStart);
    document.addEventListener("keyup", handleInteractionEnd);
  }

  private updateMetric(name: keyof PerformanceMetrics, value: number): void {
    const currentMetrics = this.getCurrentMetrics();
    (currentMetrics as any)[name] = value;
  }

  getCurrentMetrics(): PerformanceMetrics {
    const screenSize = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let batteryLevel: number | undefined;
    if ("getBattery" in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        batteryLevel = battery.level * 100;
      });
    }

    return {
      fps: 60, // Default values
      memoryUsage: 0,
      renderTime: 0,
      interactionLatency: 0,
      networkLatency: 0,
      batteryLevel,
      screenSize,
      devicePixelRatio: window.devicePixelRatio || 1,
    };
  }

  getAverageMetrics(duration = 30000): PerformanceMetrics | null {
    const now = Date.now();
    const recentMetrics = this.metrics.filter(
      (metric) => now - (metric as any).timestamp < duration,
    );

    if (recentMetrics.length === 0) return null;

    // Calculate averages
    const sum = recentMetrics.reduce(
      (acc, metric) => ({
        fps: acc.fps + metric.fps,
        memoryUsage: acc.memoryUsage + metric.memoryUsage,
        renderTime: acc.renderTime + metric.renderTime,
        interactionLatency: acc.interactionLatency + metric.interactionLatency,
        networkLatency: acc.networkLatency + metric.networkLatency,
        batteryLevel: acc.batteryLevel || 0,
        screenSize: metric.screenSize,
        devicePixelRatio: metric.devicePixelRatio,
      }),
      {
        fps: 0,
        memoryUsage: 0,
        renderTime: 0,
        interactionLatency: 0,
        networkLatency: 0,
        batteryLevel: 0,
        screenSize: { width: 0, height: 0 },
        devicePixelRatio: 1,
      },
    );

    const count = recentMetrics.length;
    return {
      fps: sum.fps / count,
      memoryUsage: sum.memoryUsage / count,
      renderTime: sum.renderTime / count,
      interactionLatency: sum.interactionLatency / count,
      networkLatency: sum.networkLatency / count,
      batteryLevel: (sum.batteryLevel || 0) / count,
      screenSize: sum.screenSize,
      devicePixelRatio: sum.devicePixelRatio,
    };
  }
}

class ResponsiveOptimizer {
  private currentBreakpoint: ResponsiveBreakpoint | null = null;
  private callbacks: Array<(breakpoint: ResponsiveBreakpoint) => void> = [];

  constructor() {
    this.detectBreakpoint();
    this.setupResizeListener();
  }

  private detectBreakpoint(): void {
    const width = window.innerWidth;
    const newBreakpoint = responsiveBreakpoints.find(
      (bp) => width >= bp.min && (bp.max === undefined || width <= bp.max),
    );

    if (newBreakpoint && newBreakpoint !== this.currentBreakpoint) {
      this.currentBreakpoint = newBreakpoint;
      this.applyOptimizations(newBreakpoint);
      this.callbacks.forEach((callback) => callback(newBreakpoint));
    }
  }

  private setupResizeListener(): void {
    let resizeTimeout: number;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        this.detectBreakpoint();
      }, 150);
    });
  }

  private applyOptimizations(breakpoint: ResponsiveBreakpoint): void {
    const root = document.documentElement;

    // Remove all optimization classes
    responsiveBreakpoints.forEach((bp) => {
      bp.optimizations.forEach((opt) => {
        root.classList.remove(`opt-${opt}`);
      });
    });

    // Add current optimization classes
    breakpoint.optimizations.forEach((opt) => {
      root.classList.add(`opt-${opt}`);
    });

    // Apply CSS custom properties
    root.style.setProperty("--current-breakpoint", breakpoint.name);
    root.style.setProperty("--screen-width", `${window.innerWidth}px`);
    root.style.setProperty("--screen-height", `${window.innerHeight}px`);
  }

  onBreakpointChange(
    callback: (breakpoint: ResponsiveBreakpoint) => void,
  ): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  getCurrentBreakpoint(): ResponsiveBreakpoint | null {
    return this.currentBreakpoint;
  }

  isMobile(): boolean {
    return this.currentBreakpoint?.name.includes("mobile") || false;
  }

  isTablet(): boolean {
    return this.currentBreakpoint?.name === "tablet";
  }

  isDesktop(): boolean {
    return this.currentBreakpoint?.name === "desktop";
  }
}

class MemoryOptimizer {
  private cache = new Map<string, any>();
  public cacheLimit = 50;
  private cleanupInterval: number;

  constructor() {
    // Cleanup cache every 5 minutes
    this.cleanupInterval = window.setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000,
    );
  }

  set(key: string, value: any, ttl = 10 * 60 * 1000): void {
    if (this.cache.size >= this.cacheLimit) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + ttl,
    });
  }

  get(key: string): any {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }

  getStats(): { size: number; limit: number; usage: number } {
    return {
      size: this.cache.size,
      limit: this.cacheLimit,
      usage: (this.cache.size / this.cacheLimit) * 100,
    };
  }
}

class BatteryOptimizer {
  private batteryLevel = 1;
  private isCharging = true;
  private powerSaveMode = false;

  constructor() {
    this.initBatteryAPI();
  }

  private async initBatteryAPI(): Promise<void> {
    if ("getBattery" in navigator) {
      try {
        const battery = await (navigator as any).getBattery();
        this.batteryLevel = battery.level;
        this.isCharging = battery.charging;
        this.updatePowerSaveMode();

        battery.addEventListener("levelchange", () => {
          this.batteryLevel = battery.level;
          this.updatePowerSaveMode();
        });

        battery.addEventListener("chargingchange", () => {
          this.isCharging = battery.charging;
          this.updatePowerSaveMode();
        });
      } catch (error) {
        console.warn("Battery API not available:", error);
      }
    }
  }

  private updatePowerSaveMode(): void {
    const lowBattery = this.batteryLevel < 0.2;
    const shouldEnablePowerSave = lowBattery && !this.isCharging;

    if (shouldEnablePowerSave !== this.powerSaveMode) {
      this.powerSaveMode = shouldEnablePowerSave;
      this.applyPowerSaveOptimizations();
    }
  }

  private applyPowerSaveOptimizations(): void {
    const root = document.documentElement;

    if (this.powerSaveMode) {
      root.classList.add("power-save-mode");
      // Reduce animations, lower refresh rates, etc.
    } else {
      root.classList.remove("power-save-mode");
    }
  }

  isPowerSaveMode(): boolean {
    return this.powerSaveMode;
  }

  getBatteryLevel(): number {
    return this.batteryLevel;
  }

  isDeviceCharging(): boolean {
    return this.isCharging;
  }
}

// Global instances
export const performanceMonitor = new PerformanceMonitor();
export const responsiveOptimizer = new ResponsiveOptimizer();
export const memoryOptimizer = new MemoryOptimizer();
export const batteryOptimizer = new BatteryOptimizer();

// Utility functions
export function getOptimalSettings(): {
  animations: boolean;
  highResolution: boolean;
  backgroundTasks: boolean;
  cacheSize: number;
} {
  const metrics = performanceMonitor.getCurrentMetrics();
  const isLowEnd = metrics.memoryUsage > 80 || metrics.fps < 30;
  const isPowerSave = batteryOptimizer.isPowerSaveMode();
  const isMobile = responsiveOptimizer.isMobile();

  return {
    animations: !isLowEnd && !isPowerSave,
    highResolution: !isMobile || metrics.devicePixelRatio > 2,
    backgroundTasks: !isPowerSave && metrics.memoryUsage < 60,
    cacheSize: isLowEnd ? 25 : 50,
  };
}

export function initializePerformanceOptimizations(): void {
  performanceMonitor.start();

  // Apply initial optimizations based on device capabilities
  const settings = getOptimalSettings();
  const root = document.documentElement;

  if (!settings.animations) {
    root.classList.add("reduce-animations");
  }

  if (!settings.highResolution) {
    root.classList.add("low-resolution");
  }

  if (settings.cacheSize < 50) {
    memoryOptimizer.cacheLimit = settings.cacheSize;
  }

  // Monitor performance and adjust settings dynamically
  setInterval(() => {
    const newSettings = getOptimalSettings();
    if (JSON.stringify(newSettings) !== JSON.stringify(settings)) {
      console.log("Performance settings updated:", newSettings);
      // Apply new settings
    }
  }, 30000); // Check every 30 seconds
}

// Clean up resources when app is closed
export function cleanupPerformanceOptimizations(): void {
  performanceMonitor.stop();
  memoryOptimizer.destroy();
}

