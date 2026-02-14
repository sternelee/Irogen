// Mobile utilities index - centralized exports
export { ViewportManager, getViewportManager } from "./ViewportManager";
export type {
  SafeAreaInsets,
  ViewportDimensions,
  CursorPosition,
  ViewportChangeCallback,
  UnsubscribeFn,
} from "./ViewportManager";

// Re-export from parent mobile.ts for convenience
export {
  getDeviceCapabilities,
  HapticFeedback,
  GestureRecognizer,
  MobileKeyboard,
  KeyboardManager,
  InputFocusManager,
  MobilePerformance,
  ScreenOrientation,
  initializeMobileUtils,
} from "../mobile";

export type {
  DeviceCapabilities,
  KeyboardInfo,
  FixedElementConfig,
  TouchPoint,
  GestureState,
} from "../mobile";
