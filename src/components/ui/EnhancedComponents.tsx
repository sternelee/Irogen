import { JSX, Show, createEffect, createSignal } from "solid-js";
import {
  Badge,
  Button,
  Card,
  CardActions,
  CardBody,
  CardTitle,
  Input,
  Spinner,
} from "./primitives";
import { cn } from "~/lib/utils";

interface EnhancedCardProps {
  title?: string;
  subtitle?: string;
  icon?: string;
  children: JSX.Element;
  class?: string;
  variant?: "default" | "compact" | "featured" | "minimal";
  onTap?: () => void;
  actions?: JSX.Element;
  status?: "success" | "warning" | "error" | "info";
}

export function EnhancedCard(props: EnhancedCardProps) {
  const variantClass = () => {
    switch (props.variant) {
      case "compact":
        return "";
      case "featured":
        return "bg-gradient-to-br from-primary/10 to-secondary/10";
      case "minimal":
        return "border-base-300 bg-base-50";
      default:
        return "bg-base-100 shadow-lg";
    }
  };

  const statusClass = () => {
    if (!props.status) return "";
    if (props.status === "success") return "border-l-4 border-l-success";
    if (props.status === "warning") return "border-l-4 border-l-warning";
    if (props.status === "error") return "border-l-4 border-l-error";
    return "border-l-4 border-l-info";
  };

  return (
    <Card
      class={cn(
        variantClass(),
        statusClass(),
        props.class,
      )}
      onClick={props.onTap}
    >
      <CardBody class={cn(props.variant === "compact" ? "p-4" : "p-4 md:p-6")}>
        <Show when={props.title || props.icon}>
          <div class="mb-2 flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <Show when={props.icon}>
                <span class="text-2xl">{props.icon}</span>
              </Show>
              <div>
                <Show when={props.title}>
                  <CardTitle class="text-lg">{props.title}</CardTitle>
                </Show>
                <Show when={props.subtitle}>
                  <p class="text-sm opacity-70">{props.subtitle}</p>
                </Show>
              </div>
            </div>
            <Show when={props.actions}>
              <CardActions class="mt-0">{props.actions}</CardActions>
            </Show>
          </div>
        </Show>
        {props.children}
      </CardBody>
    </Card>
  );
}

interface EnhancedButtonProps {
  children?: JSX.Element;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "accent" | "ghost" | "outline" | "error" | "success";
  size?: "xs" | "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  class?: string;
  fullWidth?: boolean;
  haptic?: boolean;
}

export function EnhancedButton(props: EnhancedButtonProps) {
  const toVariant = () => {
    if (props.variant === "error") return "destructive";
    if (props.variant === "accent") return "secondary";
    return (props.variant ?? "primary") as
      | "primary"
      | "secondary"
      | "ghost"
      | "outline"
      | "success"
      | "destructive";
  };

  return (
    <Button
      variant={toVariant()}
      size={props.size ?? "md"}
      loading={props.loading}
      disabled={props.disabled}
      class={cn(
        props.fullWidth ? "w-full" : "",
        "transition-all duration-200 hover:scale-[1.02] active:scale-95",
        props.class,
      )}
      onClick={() => {
        if (props.haptic && window.navigator?.vibrate) {
          window.navigator.vibrate(10);
        }
        props.onClick?.();
      }}
    >
      <Show when={props.icon && !props.loading}>
        <span>{props.icon}</span>
      </Show>
      {props.children}
    </Button>
  );
}

interface EnhancedInputProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "url";
  icon?: string;
  error?: string;
  label?: string;
  class?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}

export function EnhancedInput(props: EnhancedInputProps) {
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.autoFocus && inputRef) {
      inputRef.focus();
    }
  });

  return (
    <div class="w-full space-y-2">
      <Show when={props.label}>
        <label class="text-sm font-medium">{props.label}</label>
      </Show>
      <div class="relative">
        <Show when={props.icon}>
          <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-base-content/50">
            <span>{props.icon}</span>
          </div>
        </Show>
        <Input
          ref={inputRef}
          type={props.type || "text"}
          placeholder={props.placeholder}
          class={cn(props.icon ? "pl-10" : "", props.class)}
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && props.onEnter) {
              props.onEnter();
            }
          }}
          disabled={props.disabled}
        />
      </div>
      <Show when={props.error}>
        <p class="text-xs text-error">{props.error}</p>
      </Show>
    </div>
  );
}

interface FloatingActionButtonProps {
  icon: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "accent";
  position?: "bottom-right" | "bottom-left" | "bottom-center";
  class?: string;
  badge?: string | number;
}

export function FloatingActionButton(props: FloatingActionButtonProps) {
  const getPositionClass = () => {
    switch (props.position) {
      case "bottom-left":
        return "fixed bottom-6 left-6 z-50";
      case "bottom-center":
        return "fixed bottom-6 left-1/2 z-50 -translate-x-1/2";
      default:
        return "fixed bottom-6 right-6 z-50";
    }
  };

  return (
    <div class={getPositionClass()}>
      <Button
        variant={props.variant === "accent" ? "secondary" : props.variant ?? "primary"}
        size="icon"
        class={cn("h-12 w-12 shadow-2xl", props.class)}
        onClick={props.onClick}
      >
        <span class="text-xl">{props.icon}</span>
      </Button>
      <Show when={props.badge}>
        <Badge variant="error" class="absolute -right-2 -top-2 h-5 px-1.5">
          {props.badge}
        </Badge>
      </Show>
    </div>
  );
}

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: JSX.Element;
  class?: string;
  threshold?: number;
}

export function PullToRefresh(props: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = createSignal(0);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  const [isPulling, setIsPulling] = createSignal(false);
  let startY = 0;
  let containerRef: HTMLDivElement | undefined;
  const threshold = props.threshold || 80;

  return (
    <div
      ref={containerRef}
      class={cn("relative overflow-auto", props.class)}
      onTouchStart={(e) => {
        if (containerRef && containerRef.scrollTop === 0) {
          startY = e.touches[0].clientY;
          setIsPulling(true);
        }
      }}
      onTouchMove={(e) => {
        if (!isPulling()) return;
        const distance = Math.max(0, e.touches[0].clientY - startY);
        if (distance > 0) {
          e.preventDefault();
          setPullDistance(Math.min(distance, threshold * 1.5));
        }
      }}
      onTouchEnd={async () => {
        if (!isPulling()) return;
        setIsPulling(false);
        if (pullDistance() >= threshold) {
          setIsRefreshing(true);
          try {
            await props.onRefresh();
          } finally {
            setIsRefreshing(false);
          }
        }
        setPullDistance(0);
      }}
      style={{ transform: `translateY(${Math.min(pullDistance(), threshold)}px)` }}
    >
      <Show when={pullDistance() > 0 || isRefreshing()}>
        <div class="absolute left-0 right-0 top-0 flex justify-center bg-base-100 py-4">
          <Show
            when={isRefreshing()}
            fallback={
              <div class="flex flex-col items-center text-sm opacity-70">
                <span class="mb-1 text-2xl">⬇️</span>
                <span>{pullDistance() >= threshold ? "Release to refresh" : "Pull to refresh"}</span>
              </div>
            }
          >
            <div class="flex items-center gap-2 text-sm">
              <Spinner size="sm" />
              Refreshing...
            </div>
          </Show>
        </div>
      </Show>
      {props.children}
    </div>
  );
}
