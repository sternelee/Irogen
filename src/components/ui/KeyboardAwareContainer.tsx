import { JSX, Show, createEffect, createSignal, onCleanup } from "solid-js";
import {
  KeyboardInfo,
  MobileKeyboard,
  getDeviceCapabilities,
} from "../../utils/mobile";
import { Button, Input } from "./primitives";
import { cn } from "~/lib/utils";

interface KeyboardAwareContainerProps {
  children: JSX.Element;
  class?: string;
  onKeyboardShow?: (keyboardInfo: KeyboardInfo) => void;
  onKeyboardHide?: () => void;
  adjustHeight?: boolean;
  preserveContent?: boolean;
  enablePullToHide?: boolean;
  minHeight?: number;
}

export function KeyboardAwareContainer(props: KeyboardAwareContainerProps) {
  const [keyboardVisible, setKeyboardVisible] = createSignal(false);
  const [keyboardHeight, setKeyboardHeight] = createSignal(0);
  const [effectiveHeight, setEffectiveHeight] = createSignal(
    window.innerHeight,
  );
  const [isPulling, setIsPulling] = createSignal(false);
  const [pullDistance, setPullDistance] = createSignal(0);

  const deviceCapabilities = getDeviceCapabilities();
  const isMobile = deviceCapabilities.isMobile;

  let containerRef: HTMLDivElement | undefined;
  let touchStartY = 0;
  let touchStartTime = 0;
  const pullToHideThreshold = 100;
  const maxPullDistance = 200;

  createEffect(() => {
    const unsubscribe = MobileKeyboard.onVisibilityChange(
      (visible, keyboardInfo) => {
        setKeyboardVisible(visible);
        if (visible && keyboardInfo) {
          setKeyboardHeight(keyboardInfo.height);
          setEffectiveHeight(
            keyboardInfo.viewportHeight - (keyboardInfo.viewportOffsetTop || 0),
          );
          props.onKeyboardShow?.(keyboardInfo);
        } else {
          setKeyboardHeight(0);
          setEffectiveHeight(window.innerHeight);
          props.onKeyboardHide?.();
        }
      },
    );
    onCleanup(() => unsubscribe());
  });

  const getContainerHeight = () => {
    if (!props.adjustHeight) return undefined;
    const baseHeight = effectiveHeight();
    const minHeight = props.minHeight || 200;

    if (isPulling() && keyboardVisible()) {
      const pullRatio = pullDistance() / maxPullDistance;
      const heightReduction = pullRatio * keyboardHeight() * 0.5;
      return Math.max(baseHeight - heightReduction, minHeight);
    }

    return Math.max(baseHeight, minHeight);
  };

  return (
    <div
      ref={containerRef}
      class={cn("relative overflow-hidden", props.class)}
      style={{
        ...(props.adjustHeight
          ? {
              height: `${getContainerHeight()}px`,
              "max-height": `${getContainerHeight()}px`,
              transition: isPulling()
                ? "none"
                : "height 0.2s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            }
          : {}),
        ...(isPulling() && keyboardVisible()
          ? {
              transform: `translateY(${pullDistance() * 0.3}px)`,
              transition: "transform 0.1s ease-out",
            }
          : {}),
      }}
      onTouchStart={(e) => {
        if (!props.enablePullToHide || !keyboardVisible()) return;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        setIsPulling(true);
        setPullDistance(0);
      }}
      onTouchMove={(e) => {
        if (!props.enablePullToHide || !isPulling() || !keyboardVisible())
          return;
        const deltaY = e.touches[0].clientY - touchStartY;
        if (deltaY <= 0) return;
        const distance = Math.min(deltaY, maxPullDistance);
        setPullDistance(distance);
      }}
      onTouchEnd={() => {
        if (!props.enablePullToHide || !isPulling()) return;
        const distance = pullDistance();
        const duration = Date.now() - touchStartTime;
        if (
          distance >= pullToHideThreshold ||
          (distance > 50 && duration < 200)
        ) {
          MobileKeyboard.hide();
          if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
        }
        setIsPulling(false);
        setPullDistance(0);
      }}
    >
      <Show
        when={
          isMobile && props.enablePullToHide && keyboardVisible() && isPulling()
        }
      >
        <div
          class="pointer-events-none fixed left-0 right-0 top-0 z-50 flex justify-center"
          style={{
            transform: `translateY(${pullDistance() + 20}px)`,
            opacity: Math.min(pullDistance() / pullToHideThreshold, 1),
            transition: "opacity 0.1s ease-out",
          }}
        >
          <div class="rounded-full bg-background p-3 shadow-lg">
            <div class="text-center">
              <div class="mb-1 text-2xl">⬇️</div>
              <div class="text-xs text-muted-foreground/70">
                {pullDistance() >= pullToHideThreshold
                  ? "Release to hide keyboard"
                  : "Pull to hide keyboard"}
              </div>
            </div>
          </div>
        </div>
      </Show>

      <div
        class={cn("h-full", !isPulling() ? "transition-all duration-200" : "")}
      >
        {props.children}
      </div>

      <Show when={keyboardVisible() && props.preserveContent}>
        <div
          class="absolute bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm"
          style={{ height: `${keyboardHeight()}px` }}
        >
          <div class="flex h-full items-center justify-center text-sm text-muted-foreground/60">
            Keyboard active - swipe down to hide
          </div>
        </div>
      </Show>
    </div>
  );
}

interface KeyboardAwareInputProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "url";
  class?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  icon?: string;
  label?: string;
  error?: string;
  preserveSpace?: boolean;
}

export function KeyboardAwareInput(props: KeyboardAwareInputProps) {
  const [isFocused, setIsFocused] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.autoFocus && inputRef) {
      setTimeout(() => inputRef?.focus(), 100);
    }
  });

  return (
    <div class={cn("w-full space-y-2", props.class)}>
      <Show when={props.label}>
        <label class="text-sm font-medium">{props.label}</label>
      </Show>

      <div class="relative">
        <Show when={props.icon}>
          <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground/50">
            <span>{props.icon}</span>
          </div>
        </Show>

        <Input
          ref={inputRef}
          type={props.type || "text"}
          placeholder={props.placeholder}
          class={cn(
            props.icon ? "pl-10" : "",
            isFocused() ? "ring-1 ring-ring ring-offset-1" : "",
          )}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && props.onEnter) props.onEnter();
          }}
          onFocus={() => {
            setIsFocused(true);
            setTimeout(() => MobileKeyboard.forceScrollAdjustment(), 100);
          }}
          onBlur={() => setIsFocused(false)}
        />
      </div>

      <Show when={props.error}>
        <p class="text-xs text-error">{props.error}</p>
      </Show>
      <Show when={props.preserveSpace && isFocused()}>
        <div class="h-20" aria-hidden="true" />
      </Show>
    </div>
  );
}

interface KeyboardAwareButtonProps {
  children: JSX.Element;
  onClick: () => void;
  variant?: "primary" | "secondary" | "accent" | "ghost" | "outline";
  size?: "xs" | "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  class?: string;
  fullWidth?: boolean;
  haptic?: boolean;
  keyboardAware?: boolean;
}

export function KeyboardAwareButton(props: KeyboardAwareButtonProps) {
  const variant =
    props.variant === "accent" ? "secondary" : (props.variant ?? "primary");

  return (
    <Button
      variant={variant}
      size={props.size ?? "md"}
      loading={props.loading}
      disabled={props.disabled}
      class={cn(
        props.fullWidth ? "w-full" : "",
        "mobile-button-optimized",
        props.class,
      )}
      onClick={() => {
        if (props.keyboardAware && MobileKeyboard.isKeyboardVisible()) {
          MobileKeyboard.hide();
        }
        if (props.haptic && navigator.vibrate) navigator.vibrate(10);
        props.onClick();
      }}
    >
      {props.children}
    </Button>
  );
}
