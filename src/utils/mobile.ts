// Mobile-specific utilities and features - Enhanced for mobile-first UI
import { getDeviceCapabilities as getDeviceCapabilitiesFromStore } from "../stores/deviceStore";

export interface FixedElementConfig {
  adjustWithKeyboard: boolean;
  onKeyboardShow?: (keyboardHeight: number) => void;
  onKeyboardHide?: () => void;
}

export interface KeyboardInfo {
  height: number;
  viewportHeight: number;
  viewportOffsetTop?: number;
  threshold: number;
}

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

// Re-export device capabilities from store
export function getDeviceCapabilities(): DeviceCapabilities {
  return getDeviceCapabilitiesFromStore();
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

  static warning(): void {
    if (this.isSupported()) {
      navigator.vibrate([50, 30, 50]);
    }
  }

  static success(): void {
    if (this.isSupported()) {
      navigator.vibrate(15);
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

// Enhanced gesture recognition with mobile-first optimizations
export class GestureRecognizer {
  private gestureCallbacks: Map<string, (state: GestureState) => void> =
    new Map();
  private currentGesture: GestureState | null = null;
  private element: HTMLElement;
  private threshold = {
    tap: 150, // ms - reduced for better responsiveness
    swipe: 30, // px - reduced for easier triggering
    pinch: 1.05, // scale - more sensitive
    rotate: 10, // degrees - more sensitive
    longPress: 500, // ms - for long press detection
    doubleTap: 300, // ms - for double tap detection
  };
  private lastTapTime = 0;
  private lastTapPoint: TouchPoint | null = null;
  private longPressTimeout: number | null = null;

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
    this.element.addEventListener(
      "touchcancel",
      this.handleTouchCancel.bind(this),
      {
        passive: false,
      },
    );
  }

  private handleTouchStart(event: TouchEvent): void {
    const touches = Array.from(event.touches);
    const touchPoints: TouchPoint[] = touches.map((touch, _index) => ({
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

    // Setup long press detection
    if (touches.length === 1) {
      this.longPressTimeout = window.setTimeout(() => {
        if (
          this.currentGesture &&
          this.currentGesture.startPoints.length === 1
        ) {
          this.triggerCallback("longPress", this.currentGesture);
        }
      }, this.threshold.longPress);
    }

    // Check for double tap
    const now = Date.now();
    if (
      this.lastTapPoint &&
      now - this.lastTapTime < this.threshold.doubleTap &&
      touches.length === 1
    ) {
      const distance = this.getDistance(this.lastTapPoint, touchPoints[0]);
      if (distance < 50) {
        // Within 50px
        this.triggerCallback("doubleTap", this.currentGesture);
        this.lastTapPoint = null;
        this.lastTapTime = 0;
        return;
      }
    }
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

    // Cancel long press if moving
    if (this.longPressTimeout && this.currentGesture.distance > 10) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }

    // Prevent default scrolling for multi-touch gestures
    if (touches.length > 1) {
      event.preventDefault();
    }
  }

  private handleTouchEnd(_event: TouchEvent): void {
    if (!this.currentGesture) return;

    // Clear long press timeout
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
    }

    const gesture = this.currentGesture;
    const duration = Date.now() - gesture.startTime;

    // Store tap info for double tap detection
    if (gesture.startPoints.length === 1 && duration < this.threshold.tap) {
      this.lastTapTime = Date.now();
      this.lastTapPoint = gesture.startPoints[0];
    }

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

  private handleTouchCancel(_event: TouchEvent): void {
    // Clear long press timeout
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
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
      // Add haptic feedback for better mobile experience
      this.triggerHapticFeedback(gestureType);
    }
  }

  private triggerHapticFeedback(gestureType: string): void {
    switch (gestureType) {
      case "tap":
      case "doubleTap":
        HapticFeedback.light();
        break;
      case "swipe":
      case "longPress":
        HapticFeedback.medium();
        break;
      case "pinch":
      case "rotate":
        HapticFeedback.heavy();
        break;
    }
  }

  private triggerDirectionalSwipe(gesture: GestureState): void {
    const angle = gesture.angle;

    // Convert angle to direction with 45-degree sectors
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

  onDoubleTap(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("doubleTap", callback);
  }

  onLongPress(callback: (state: GestureState) => void): void {
    this.gestureCallbacks.set("longPress", callback);
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
    this.element.removeEventListener("touchcancel", this.handleTouchCancel);
    this.gestureCallbacks.clear();
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
    }
  }
}

// Enhanced Mobile keyboard utilities with intelligent input handling
export class MobileKeyboard {
  private static isVisible = false;
  private static callbacks: Array<
    (visible: boolean, keyboardInfo?: KeyboardInfo) => void
  > = [];
  private static activeInput: HTMLElement | null = null;
  private static initialWindowHeight = 0;
  private static keyboardHeight = 0;
  private static adjustmentCallbacks: Array<() => void> = [];
  private static debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private static viewportManagerIntegration = false;

  static init(integrateWithViewportManager: boolean = false): void {
    // Store initial heights for accurate comparison
    this.initialWindowHeight = window.innerHeight;
    this.viewportManagerIntegration = integrateWithViewportManager;

    // Set up input focus tracking
    this.setupInputTracking();

    // Primary method: Use visualViewport API (recommended and modern)
    if ("visualViewport" in window && window.visualViewport) {
      window.visualViewport.addEventListener(
        "resize",
        this.handleVisualViewportChange.bind(this),
      );
    } else {
      // Fallback for older browsers
      window.addEventListener("resize", this.handleWindowResize.bind(this));
    }

    // Handle page load and orientation changes
    window.addEventListener("load", () => {
      this.initialWindowHeight = window.innerHeight;
    });

    console.log("[MobileKeyboard] Initialized", {
      visualViewportSupported: "visualViewport" in window,
      viewportManagerIntegration: this.viewportManagerIntegration,
    });
  }

  private static setupInputTracking(): void {
    // Track active input elements
    document.addEventListener("focusin", (e) => {
      const target = e.target as HTMLElement;
      if (this.isInputElement(target)) {
        this.activeInput = target;
        // Wait for keyboard animation
        setTimeout(() => this.adjustScrollIfNeeded(), 100);
        setTimeout(() => this.adjustScrollIfNeeded(), 300);
      }
    });

    document.addEventListener("focusout", () => {
      this.activeInput = null;
      // Wait for keyboard to hide
      setTimeout(() => {
        if (!this.activeInput) {
          this.resetScroll();
        }
      }, 300);
    });
  }

  private static isInputElement(element: HTMLElement): boolean {
    return (
      element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.contentEditable === "true"
    );
  }

  private static handleVisualViewportChange(): void {
    const v = window.visualViewport;
    if (!v) return;

    const currentViewportHeight = v.height;
    const viewportOffsetTop = v.offsetTop;

    // Calculate keyboard height for other UI elements
    const heightDiff = window.innerHeight - currentViewportHeight;
    this.keyboardHeight = Math.max(heightDiff, 0);

    const capabilities = getDeviceCapabilities();
    const threshold = capabilities.isMobile ? 120 : 150;
    const isKeyboardVisible = this.keyboardHeight > threshold;

    this.updateKeyboardState(isKeyboardVisible, {
      height: this.keyboardHeight,
      viewportHeight: currentViewportHeight,
      viewportOffsetTop,
      threshold,
    });
  }

  private static handleWindowResize(): void {
    // Debounce resize events
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      const currentHeight = window.innerHeight;
      this.keyboardHeight = this.initialWindowHeight - currentHeight;

      const capabilities = getDeviceCapabilities();
      const threshold = capabilities.isMobile ? 120 : 150;
      const isKeyboardVisible = this.keyboardHeight > threshold;

      this.updateKeyboardState(isKeyboardVisible, {
        height: this.keyboardHeight,
        viewportHeight: currentHeight,
        threshold,
      });
    }, 100);
  }

  private static updateKeyboardState(
    isVisible: boolean,
    keyboardInfo: KeyboardInfo,
  ): void {
    if (isVisible !== this.isVisible) {
      this.isVisible = isVisible;
      this.callbacks.forEach((callback) =>
        callback(this.isVisible, keyboardInfo),
      );

      // Update fixed elements
      KeyboardManager.adjustFixedElements(isVisible ? this.keyboardHeight : 0);

      if (isVisible) {
        this.adjustScrollIfNeeded();
      }
    }
  }

  private static adjustScrollIfNeeded(): void {
    if (!this.activeInput || !this.isVisible) return;

    const inputRect = this.activeInput.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const viewportOffsetTop = window.visualViewport?.offsetTop || 0;

    // Calculate if input is blocked by keyboard
    const inputBottomInViewport = inputRect.bottom - viewportOffsetTop;
    const availableHeight = viewportHeight - viewportOffsetTop;

    // Check if input is already properly positioned above the keyboard
    // If input is within the visible area and not blocked, skip scrolling
    const keyboardHeight = this.keyboardHeight;
    if (
      inputBottomInViewport <= availableHeight &&
      inputBottomInViewport > keyboardHeight
    ) {
      // Input is already visible and above keyboard - skip scroll
      return;
    }

    if (inputBottomInViewport > availableHeight) {
      // Input is blocked by keyboard, scroll it into view
      this.activeInput.scrollIntoView({
        behavior: "smooth",
        block: "end", // Align bottom of input with bottom of visible area
        inline: "nearest",
      });

      // Add additional buffer space to ensure input is not right at the edge
      setTimeout(() => {
        const newRect = this.activeInput?.getBoundingClientRect();
        if (newRect) {
          const diff =
            newRect.bottom - viewportOffsetTop - availableHeight + 20; // 20px buffer
          if (diff > 0) {
            window.scrollBy({
              top: diff,
              behavior: "smooth",
            });
          }
        }
      }, 250); // Wait for scrollIntoView to complete
    } else if (inputBottomInViewport < 0) {
      // Input is above visible area
      this.activeInput.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    }

    // Trigger adjustment callbacks for custom handling
    this.adjustmentCallbacks.forEach((callback) => callback());
  }

  private static resetScroll(): void {
    // Optional: Reset scroll position when keyboard hides
    // Usually browsers handle this automatically, but we can add custom logic here
  }

  static onVisibilityChange(
    callback: (visible: boolean, keyboardInfo?: KeyboardInfo) => void,
  ): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  static onScrollAdjustment(callback: () => void): () => void {
    this.adjustmentCallbacks.push(callback);
    return () => {
      const index = this.adjustmentCallbacks.indexOf(callback);
      if (index > -1) {
        this.adjustmentCallbacks.splice(index, 1);
      }
    };
  }

  static isKeyboardVisible(): boolean {
    return this.isVisible;
  }

  static getKeyboardHeight(): number {
    return this.keyboardHeight;
  }

  static getActiveInput(): HTMLElement | null {
    return this.activeInput;
  }

  static forceScrollAdjustment(): void {
    if (this.isVisible && this.activeInput) {
      this.adjustScrollIfNeeded();
    }
  }

  static hide(): void {
    // Try to hide the keyboard by blurring active input
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && activeElement.blur) {
      activeElement.blur();
    }
  }
}

// Advanced keyboard management for fixed positioned elements
export class KeyboardManager {
  private static fixedElements: Map<HTMLElement, FixedElementConfig> =
    new Map();
  private static originalStyles: Map<HTMLElement, string> = new Map();

  static registerFixedElement(
    element: HTMLElement,
    config: FixedElementConfig,
  ): () => void {
    this.fixedElements.set(element, config);
    this.originalStyles.set(element, element.style.bottom);

    return () => {
      this.unregisterFixedElement(element);
    };
  }

  static unregisterFixedElement(element: HTMLElement): void {
    const originalStyle = this.originalStyles.get(element);
    if (originalStyle !== undefined) {
      element.style.bottom = originalStyle;
    }

    this.fixedElements.delete(element);
    this.originalStyles.delete(element);
  }

  static adjustFixedElements(keyboardHeight: number): void {
    this.fixedElements.forEach((config, element) => {
      if (keyboardHeight > 0) {
        // Keyboard is visible, adjust element position
        const adjustment = config.adjustWithKeyboard ? keyboardHeight : 0;
        element.style.bottom = `${adjustment}px`;

        if (config.onKeyboardShow) {
          config.onKeyboardShow(keyboardHeight);
        }
      } else {
        // Keyboard is hidden, restore original position
        const originalStyle = this.originalStyles.get(element) || "0px";
        element.style.bottom = originalStyle;

        if (config.onKeyboardHide) {
          config.onKeyboardHide();
        }
      }
    });
  }

  static clear(): void {
    this.fixedElements.forEach((_config, element) => {
      this.unregisterFixedElement(element);
    });
  }
}

// Enhanced input focus management
export class InputFocusManager {
  private static activeInputs: Set<HTMLElement> = new Set();
  private static scrollHistory: Array<{ x: number; y: number }> = [];

  static trackInput(input: HTMLElement): () => void {
    this.activeInputs.add(input);

    const cleanup = () => {
      this.activeInputs.delete(input);
    };

    // Setup input-specific handlers
    const handleFocus = () => {
      // Store current scroll position
      this.scrollHistory.push({
        x: window.scrollX || window.pageXOffset,
        y: window.scrollY || window.pageYOffset,
      });

      // Wait for keyboard and adjust
      setTimeout(() => this.ensureInputVisible(input), 100);
      setTimeout(() => this.ensureInputVisible(input), 300);
      setTimeout(() => this.ensureInputVisible(input), 600);
    };

    const handleBlur = () => {
      // Optionally restore scroll position
      setTimeout(() => {
        if (
          !MobileKeyboard.isKeyboardVisible() &&
          this.activeInputs.size === 0
        ) {
          // Only restore if no other inputs are focused and keyboard is hidden
          if (this.activeInputs.size === 0) {
            // this.restoreScrollPosition(); // Uncomment if needed
          }
        }
      }, 300);
    };

    input.addEventListener("focus", handleFocus);
    input.addEventListener("blur", handleBlur);

    return () => {
      input.removeEventListener("focus", handleFocus);
      input.removeEventListener("blur", handleBlur);
      cleanup();
    };
  }

  private static ensureInputVisible(input: HTMLElement): void {
    if (!MobileKeyboard.isKeyboardVisible()) return;

    const inputRect = input.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const viewportTop = window.visualViewport?.offsetTop || 0;

    // Calculate visible area
    const visibleTop = viewportTop;
    const visibleBottom = viewportTop + viewportHeight;

    // Check if input is within visible area with some buffer
    const buffer = 50; // 50px buffer
    const inputTop = inputRect.top;
    const inputBottom = inputRect.bottom;

    if (inputBottom > visibleBottom - buffer) {
      // Input bottom is too close to or below keyboard
      input.scrollIntoView({
        behavior: "smooth",
        block: "end", // Align bottom of input with bottom of visible area
        inline: "nearest",
      });

      // Fine-tune positioning after scroll
      setTimeout(() => {
        const newRect = input.getBoundingClientRect();
        const overflow =
          newRect.bottom - viewportTop - (visibleBottom - buffer);
        if (overflow > 0) {
          window.scrollBy({
            top: overflow,
            behavior: "smooth",
          });
        }
      }, 250);
    } else if (inputTop < visibleTop + buffer) {
      // Input top is above visible area
      input.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
    }
  }

  // @ts-expect-error reserved for future use
  private static restoreScrollPosition(): void {
    if (this.scrollHistory.length > 0) {
      const lastPosition = this.scrollHistory.pop()!;
      window.scrollTo({
        left: lastPosition.x,
        top: lastPosition.y,
        behavior: "smooth",
      });
    }
  }

  static clear(): void {
    this.activeInputs.clear();
    this.scrollHistory = [];
  }
}
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

// Enhanced mobile utilities initialization
export function initializeMobileUtils(
  options: { integrateViewportManager?: boolean } = {},
): void {
  const integrateViewportManager = options.integrateViewportManager ?? false;

  MobileKeyboard.init(integrateViewportManager);

  // Get capabilities from store (already initialized)
  const capabilities = getDeviceCapabilities();

  // Add safe area support class
  if (capabilities.isMobile || capabilities.isTablet) {
    document.documentElement.classList.add("has-safe-area");
    document.documentElement.classList.add("mobile-optimized");

    // Enhanced CSS custom properties for mobile viewport handling
    const style = document.createElement("style");
    style.textContent = `
      :root {
        --safe-area-inset-top: env(safe-area-inset-top, 0px);
        --safe-area-inset-right: env(safe-area-inset-right, 0px);
        --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
        --safe-area-inset-left: env(safe-area-inset-left, 0px);
        --keyboard-height: 0px;
      }

      /* iOS Safari specialized viewport handling */
      @supports (-webkit-touch-callout: none) {
        input[type="text"],
        input[type="email"],
        input[type="password"],
        textarea {
          font-size: 16px !important; /* Prevent zoom */
        }
      }

      /* Aggressive layout stability for mobile - Pure CSS Approach */
      html, body {
        height: 100% !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background-color: oklch(var(--b2));
      }

      #app, .app-root {
        width: 100% !important;
        height: 100% !important;
        height: 100dvh !important;
        display: flex !important;
        flex-grow: 1 !important;
        flex-direction: column !important;
        overflow: hidden !important;
        background-color: oklch(var(--b1));
      }

      /* Smooth transitions for viewport changes */
      .mobile-viewport-transition {
        transition: height 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }
    `;
    document.head.appendChild(style);
  }

  // Enhanced viewport meta tag for mobile optimization
  if (
    capabilities.isMobile &&
    !document.querySelector('meta[name="viewport"]')
  ) {
    const viewport = document.createElement("meta");
    viewport.name = "viewport";
    viewport.content =
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
    document.head.appendChild(viewport);
  }

  // Fight iOS auto-scroll by resetting window scroll on any scroll event
  window.addEventListener("scroll", () => {
    if (document.documentElement.classList.contains("keyboard-visible")) {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    }
  }, { passive: true });

  // Simplified keyboard state management
  MobileKeyboard.onVisibilityChange((visible, keyboardInfo) => {
    document.documentElement.classList.toggle("keyboard-visible", visible);

    // Update CSS variable for keyboard height
    if (visible && keyboardInfo) {
      document.documentElement.style.setProperty(
        "--keyboard-height",
        `${keyboardInfo.height}px`,
      );
    } else {
      document.documentElement.style.setProperty("--keyboard-height", "0px");
    }

    // Always reset scroll to 0 to prevent OS-level jumping
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
  });

  // Auto-register common input elements for focus management
  const autoRegisterInputs = () => {
    document
      .querySelectorAll('input, textarea, [contenteditable="true"]')
      .forEach((input) => {
        if (
          input instanceof HTMLElement &&
          !input.hasAttribute("data-focus-managed")
        ) {
          input.setAttribute("data-focus-managed", "true");
          InputFocusManager.trackInput(input);
        }
      });
  };

  // Initial registration and observe for new inputs
  autoRegisterInputs();

  // Use MutationObserver to handle dynamically added inputs
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            // Check if it's an input or contains inputs
            if (element.matches('input, textarea, [contenteditable="true"]')) {
              if (
                element instanceof HTMLElement &&
                !element.hasAttribute("data-focus-managed")
              ) {
                element.setAttribute("data-focus-managed", "true");
                InputFocusManager.trackInput(element);
              }
            } else {
              // Check for inputs within the added element
              element
                .querySelectorAll('input, textarea, [contenteditable="true"]')
                .forEach((input) => {
                  if (
                    input instanceof HTMLElement &&
                    !input.hasAttribute("data-focus-managed")
                  ) {
                    input.setAttribute("data-focus-managed", "true");
                    InputFocusManager.trackInput(input);
                  }
                });
            }
          }
        });
      }
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Cleanup function for proper resource management
  const cleanup = () => {
    observer.disconnect();
    KeyboardManager.clear();
    InputFocusManager.clear();
  };

  // Store cleanup function globally for potential use
  (window as any).__mobileUtilsCleanup = cleanup;
}
