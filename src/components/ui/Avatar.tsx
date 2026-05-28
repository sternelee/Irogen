/**
 * Avatar Component
 *
 * User and agent avatars with status indicators
 */

import { type Component, Show, createMemo } from "solid-js";
import { cn } from "~/lib/utils";

// ============================================================================
// Types
// ============================================================================

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarStatus = "online" | "offline" | "away" | "busy" | "none";

export interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  class?: string;
}

export interface AvatarGroupProps {
  children: any;
  max?: number;
  class?: string;
}

// ============================================================================
// Size Classes
// ============================================================================

const sizeClasses: Record<AvatarSize, string> = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
  xl: "w-16 h-16 text-lg",
};

const statusClasses: Record<AvatarStatus, string> = {
  online: "bg-success",
  offline: "bg-base-200-foreground",
  away: "bg-warning",
  busy: "bg-error",
  none: "",
};

const statusDotClasses: Record<AvatarSize, string> = {
  xs: "w-1.5 h-1.5 border",
  sm: "w-2 h-2 border",
  md: "w-2.5 h-2.5 border-2",
  lg: "w-3 h-3 border-2",
  xl: "w-4 h-4 border-2",
};

// ============================================================================
// Avatar Component
// ============================================================================

export const Avatar: Component<AvatarProps> = (props) => {
  const size = props.size || "md";
  const status = props.status || "none";

  // Generate fallback from alt or fallback
  const fallback = createMemo(() => {
    if (props.fallback) return props.fallback;
    if (props.alt) return props.alt.charAt(0).toUpperCase();
    return "?";
  });

  return (
    <div class={cn("relative inline-flex", props.class)}>
      <Show
        when={props.src}
        fallback={
          <div
            class={cn(
              "flex items-center justify-center rounded-full bg-primary text-primary-foreground font-medium",
              sizeClasses[size]
            )}
          >
            {fallback()}
          </div>
        }
      >
        <img
          src={props.src}
          alt={props.alt}
          class={cn(
            "rounded-full object-cover",
            sizeClasses[size]
          )}
        />
      </Show>

      {/* Status Indicator */}
      <Show when={status !== "none"}>
        <div
          class={cn(
            "absolute bottom-0 right-0 rounded-full border-background",
            statusClasses[status],
            statusDotClasses[size]
          )}
        />
      </Show>
    </div>
  );
};

// ============================================================================
// Avatar Group Component
// ============================================================================

export const AvatarGroup: Component<AvatarGroupProps> = (props) => {
  return (
    <div class={cn("flex -space-x-2", props.class)}>
      {props.children}
    </div>
  );
};

// ============================================================================
// User Avatar with Name
// ============================================================================

export interface UserAvatarProps {
  name: string;
  src?: string;
  status?: AvatarStatus;
  size?: AvatarSize;
  class?: string;
}

export const UserAvatar: Component<UserAvatarProps> = (props) => {
  const size = props.size || "md";

  return (
    <div class={cn("flex items-center gap-2", props.class)}>
      <Avatar
        src={props.src}
        alt={props.name}
        size={size}
        status={props.status}
      />
      <span class={cn(
        size === "xs" || size === "sm" ? "text-xs" : "text-sm",
        "font-medium"
      )}>
        {props.name}
      </span>
    </div>
  );
};
