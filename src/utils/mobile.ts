// Mobile-specific utilities and features

export interface DeviceCapabilities {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  supportsTouch: boolean;
  supportsHaptic: boolean;
  supportsFullscreen: boolean;
  supportsOrientation: boolean;
  screenSize: "xs" | "sm" | "md" | "lg" | "xl";
  hasPhysicalKeyboard: boolean;
}

export interface TouchPoint {
  id: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface GestureState {
  startTime: number;
  startPoints: TouchPoint[];
  currentPoints: TouchPoint[];
  velocity: { x: number; y: number };
  distance: number;
  angle: number;
  scale: number;
  rotation: number;
}

// Device capability detection
export function getDeviceCapabilities(): DeviceCapabilities {
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobile =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
      userAgent,
    );
  const isTablet = /ipad|android(?!.*mobile)/i.test(userAgent);
  const isDesktop = !isMobile && !isTablet;

  const screenWidth = window.screen.width;
  let screenSize: DeviceCapabilities["screenSize"];

  if (screenWidth < 475) screenSize = "xs";
  else if (screenWidth < 640) screenSize = "sm";
  else if (screenWidth < 768) screenSize = "md";
  else if (screenWidth < 1024) screenSize = "lg";
  else screenSize = "xl";

  return {
    isMobile,
    isTablet,
    isDesktop,
    supportsTouch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    supportsHaptic: "vibrate" in navigator,
    supportsFullscreen: "requestFullscreen" in document.documentElement,
    supportsOrientation: "orientation" in window,
    screenSize,
    hasPhysicalKeyboard: !isMobile || isTablet,
  };
}

// Haptic feedback utilities
export class HapticFeedback {
  static isSupported(): boolean {
    return "vibrate" in navigator;
  }

  static light(): void {
    if (this.isSupported()) {
      navigator.vibrate(10);
    }
  }

  static medium(): void {
    if (this.isSupported()) {
      navigator.vibrate(20);
    }
  }

  static heavy(): void {
    if (this.isSupported()) {
      navigator.vibrate([30, 10, 30]);
    }
  }

  static success(): void {
    if (this.isSupported()) {
      navigator.vibrate([10, 5, 10]);
    }
  }

  static error(): void {
    if (this.isSupported()) {
      navigator.vibrate([50, 10, 50, 10, 50]);
    }
  }

  static selection(): void {
    if (this.isSupported()) {
      navigator.vibrate(5);
    }
  }

  static custom(pattern: number | number[]): void {
    if (this.isSupported()) {
      navigator.vibrate(pattern);
    }
  }
}

// Advanced gesture recognition
export class GestureRecognizer {
  private gestureCallbacks: Map<string, (state: GestureState) => void> =
    new Map();
  private currentGesture: GestureState | null = null;
  private element: HTMLElement;
  private threshold = {
    tap: 150, // ms
    swipe: 50, // px
    pinch: 1.1, // scale
    rotate: 15, // degrees
  };

  constructor(element: HTMLElement) {
    this.element = element;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.element.addEventListener(
      "touchstart",
      this.handleTouchStart.bind(this),
      { passive: false },
    );
    this.element.addEventListener(
      "touchmove",
      this.handleTouchMove.bind(this),
      { passive: false },
    );
    this.element.addEventListener("touchend", this.handleTouchEnd.bind(this), {
      passive: false,
    });
  }

  private handleTouchStart(event: TouchEvent): void {
    const touches = Array.from(event.touches);
    const touchPoints: TouchPoint[] = touches.map((touch, index) => ({
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
    }));

    this.currentGesture = {
      startTime: Date.now(),
      startPoints: touchPoints,
      currentPoints: touchPoints,
      velocity: { x: 0, y: 0 },
      distance: 0,
      angle: 0,
      scale: 1,
      rotation: 0,
    };
  }

  private handleTouchMove(event: TouchEvent): void {
    if (!this.currentGesture) return;

    const touches = Array.from(event.touches);
    const touchPoints: TouchPoint[] = touches.map((touch) => ({
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      timestamp: Date.now(),
    }));

    this.updateGestureState(touchPoints);

    // Prevent default scrolling for multi-touch gestures
    if (touches.length > 1) {
      event.preventDefault();
    }
  }

  private handleTouchEnd(event: TouchEvent): void {
    if (!this.currentGesture) return;

    const gesture = this.currentGesture;
    const duration = Date.now() - gesture.startTime;

    // Determine gesture type and trigger appropriate callback
    if (gesture.startPoints.length === 1 && duration < this.threshold.tap) {
      this.triggerCallback("tap", gesture);
    } else if (
      gesture.startPoints.length === 1 &&
      gesture.distance > this.threshold.swipe
    ) {
      this.triggerCallback("swipe", gesture);
      this.triggerDirectionalSwipe(gesture);
    } else if (gesture.startPoints.length === 2) {
      if (Math.abs(gesture.scale - 1) > this.threshold.pinch - 1) {
        this.triggerCallback("pinch", gesture);
      }
      if (Math.abs(gesture.rotation) > this.threshold.rotate) {
        this.triggerCallback("rotate", gesture);
      }
    }

    this.currentGesture = null;
  }

  private updateGestureState(currentPoints: TouchPoint[]): void {
    if (!this.currentGesture) return;

    const gesture = this.currentGesture;
    gesture.currentPoints = currentPoints;

    if (gesture.startPoints.length === 1 && currentPoints.length === 1) {
      // Single touch - calculate distance and velocity
      const start = gesture.startPoints[0];
      const current = currentPoints[0];

      const dx = current.x - start.x;
      const dy = current.y - start.y;

      gesture.distance = Math.sqrt(dx * dx + dy * dy);
      gesture.angle = Math.atan2(dy, dx) * (180 / Math.PI);

      const dt = current.timestamp - start.timestamp;
      if (dt > 0) {
        gesture.velocity = {
          x: dx / dt,
          y: dy / dt,
        };
      }
    } else if (gesture.startPoints.length === 2 && currentPoints.length === 2) {
      // Two touch - calculate scale and rotation
      const startDistance = this.getDistance(
        gesture.startPoints[0],
        gesture.startPoints[1],
      );
      const currentDistance = this.getDistance(
        currentPoints[0],
        currentPoints[1],
      );

      gesture.scale = currentDistance / startDistance;

      const startAngle = this.getAngle(
        gesture.startPoints[0],
        gesture.startPoints[1],
      );
      const currentAngle = this.getAngle(currentPoints[0], currentPoints[1]);

      gesture.rotation = currentAngle - startAngle;
    }
  }

  private getDistance(point1: TouchPoint, point2: TouchPoint): number {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getAngle(point1: TouchPoint, point2: TouchPoint): number {
    return (
      Math.atan2(point2.y - point1.y, point2.x - point1.x) * (180 / Math.PI)
    );
  }

  private triggerCallback(gestureType: string, state: GestureState): void {
    const callback = this.gestureCallbacks.get(gestureType);
    if (callback) {
      callback(state);
    }
  }

  private triggerDirectionalSwipe(gesture: GestureState): void {
    const angle = gesture.angle;

    // Convert angle to direction
    if (angle >= -45 && angle <= 45) {
      this.triggerCallback("swipeRight", gesture);
    } else if (angle >= 45 && angle <= 135) {
      this.triggerCallback("swipeDown", gesture);
    } else if (angle >= 135 || angle <= -135) {
      this.triggerCallback("swipeLeft", gesture);
    } else if (angle >= -135 && angle <= -45) {
      this.triggerCallback("swipeUp", gesture);
    }
  }

  // Public API
  onTap(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("tap", callback);
  }

  onSwipe(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("swipe", callback);
  }

  onSwipeLeft(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("swipeLeft", callback);
  }

  onSwipeRight(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("swipeRight", callback);
  }

  onSwipeUp(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("swipeUp", callback);
  }

  onSwipeDown(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("swipeDown", callback);
  }

  onPinch(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("pinch", callback);
  }

  onRotate(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("rotate", callback);
  }

  destroy(): void {
    this.element.removeEventListener("touchstart", this.handleTouchStart);
    this.element.removeEventListener("touchmove", this.handleTouchMove);
    this.element.removeEventListener("touchend", this.handleTouchEnd);
    this.gestureCallbacks.clear();
  }
}

// Mobile keyboard utilities
export class MobileKeyboard {
  private static isVisible = false;
  private static callbacks: Array<(visible: boolean) => void> = [];

  static init(): void {
    // Detect virtual keyboard visibility changes
    if ("visualViewport" in window) {
      window.visualViewport?.addEventListener("resize", () => {
        const heightDiff =
          window.innerHeight - (window.visualViewport?.height || 0);
        const isKeyboardVisible = heightDiff > 150; // 150px threshold

        if (isKeyboardVisible !== this.isVisible) {
          this.isVisible = isKeyboardVisible;
          this.callbacks.forEach((callback) => callback(this.isVisible));
        }
      });
    } else {
      // Fallback for older browsers
      const handleResize = () => {
        const currentHeight = window.innerHeight;
        const initialHeight = window.screen.height;
        const heightDiff = initialHeight - currentHeight;
        const isKeyboardVisible = heightDiff > 150;

        if (isKeyboardVisible !== this.isVisible) {
          this.isVisible = isKeyboardVisible;
          this.callbacks.forEach((callback) => callback(this.isVisible));
        }
      };

      (window as any).addEventListener("resize", handleResize);
    }
  }

  static onVisibilityChange(callback: (visible: boolean) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  static isKeyboardVisible(): boolean {
    return this.isVisible;
  }

  static hide(): void {
    // Try to hide the keyboard by blurring active input
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && activeElement.blur) {
      activeElement.blur();
    }
  }
}

// Performance optimization for mobile
export class MobilePerformance {
  static optimizeScrolling(element: HTMLElement): void {
    (element.style as any).webkitOverflowScrolling = "touch";
    element.style.willChange = "scroll-position";
  }

  static enableHardwareAcceleration(element: HTMLElement): void {
    element.style.transform = "translateZ(0)";
    element.style.backfaceVisibility = "hidden";
    element.style.perspective = "1000px";
  }

  static throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number,
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    return function (this: any, ...args: Parameters<T>) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  }

  static debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number,
  ): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout>;
    return function (this: any, ...args: Parameters<T>) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }
}

// Screen orientation utilities
export class ScreenOrientation {
  static isLandscape(): boolean {
    return window.innerWidth > window.innerHeight;
  }

  static isPortrait(): boolean {
    return window.innerHeight > window.innerWidth;
  }

  static onChange(
    callback: (orientation: "portrait" | "landscape") => void,
  ): () => void {
    const handler = () => {
      callback(this.isLandscape() ? "landscape" : "portrait");
    };

    window.addEventListener("orientationchange", handler);
    window.addEventListener("resize", handler);

    return () => {
      window.removeEventListener("orientationchange", handler);
      window.removeEventListener("resize", handler);
    };
  }

  static async lock(orientation: "portrait" | "landscape"): Promise<void> {
    if (
      "screen" in window &&
      "orientation" in window.screen &&
      "lock" in (window.screen as any).orientation
    ) {
      try {
        await (window.screen as any).orientation.lock(
          orientation === "portrait" ? "portrait-primary" : "landscape-primary",
        );
      } catch (error) {
        console.warn("Screen orientation lock not supported or failed:", error);
      }
    }
  }

  static unlock(): void {
    if (
      "screen" in window &&
      "orientation" in window.screen &&
      "unlock" in (window.screen as any).orientation
    ) {
      (window.screen as any).orientation.unlock();
    }
  }
}

// Initialize mobile utilities
export function initializeMobileUtils(): void {
  MobileKeyboard.init();

  // Add mobile-specific CSS classes
  const capabilities = getDeviceCapabilities();
  document.documentElement.classList.toggle("mobile", capabilities.isMobile);
  document.documentElement.classList.toggle("tablet", capabilities.isTablet);
  document.documentElement.classList.toggle("desktop", capabilities.isDesktop);
  document.documentElement.classList.toggle(
    "touch",
    capabilities.supportsTouch,
  );
  document.documentElement.classList.add(`screen-${capabilities.screenSize}`);
}

