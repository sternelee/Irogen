/**
 * Card Component
 *
 * Content containers with various styles
 */

import { type Component, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface CardProps {
  children: JSX.Element;
  class?: string;
  variant?: "default" | "bordered" | "elevated" | "ghost";
  padding?: "none" | "sm" | "md" | "lg";
}

export interface CardHeaderProps {
  title?: string;
  description?: string;
  action?: JSX.Element;
  class?: string;
}

export interface CardContentProps {
  children: JSX.Element;
  class?: string;
}

export interface CardFooterProps {
  children: JSX.Element;
  class?: string;
}

// ============================================================================
// Variant Classes
// ============================================================================

const variantClasses = {
  default: "bg-base-100 border border-border/50",
  bordered: "bg-base-100 border-2 border-border",
  elevated: "bg-base-100 shadow-lg shadow-base-content/5 border border-border/30",
  ghost: "bg-transparent border-transparent",
};

const paddingClasses = {
  none: "",
  sm: "p-3",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6 lg:p-8",
};

// ============================================================================
// Card Component
// ============================================================================

export const Card: Component<CardProps> = (props) => {
  const variant = props.variant || "default";
  const padding = props.padding || "md";

  return (
    <div
      class={cn(
        "rounded-xl overflow-hidden",
        variantClasses[variant],
        paddingClasses[padding],
        props.class,
      )}
    >
      {props.children}
    </div>
  );
};

// ============================================================================
// Card Header Component
// ============================================================================

export const CardHeader: Component<CardHeaderProps> = (props) => {
  return (
    <div class={cn("flex items-start justify-between mb-4", props.class)}>
      <div>
        <Show when={props.title}>
          <h3 class="text-lg font-semibold">{props.title}</h3>
        </Show>
        <Show when={props.description}>
          <p class="text-sm text-muted-foreground mt-1">{props.description}</p>
        </Show>
      </div>
      <Show when={props.action}>
        <div>{props.action}</div>
      </Show>
    </div>
  );
};

// ============================================================================
// Card Content Component
// ============================================================================

export const CardContent: Component<CardContentProps> = (props) => {
  return <div class={cn(props.class)}>{props.children}</div>;
};

// ============================================================================
// Card Footer Component
// ============================================================================

export const CardFooter: Component<CardFooterProps> = (props) => {
  return (
    <div
      class={cn(
        "flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
};

// ============================================================================
// Card Title Component
// ============================================================================

export interface CardTitleProps {
  children: JSX.Element;
  class?: string;
}

export const CardTitle: Component<CardTitleProps> = (props) => {
  return (
    <h3 class={cn("text-lg font-semibold", props.class)}>{props.children}</h3>
  );
};

// ============================================================================
// Card Description Component
// ============================================================================

export interface CardDescriptionProps {
  children: JSX.Element;
  class?: string;
}

export const CardDescription: Component<CardDescriptionProps> = (props) => {
  return (
    <p class={cn("text-sm text-muted-foreground", props.class)}>
      {props.children}
    </p>
  );
};

// ============================================================================
// Interactive Card
// ============================================================================

export interface CardActionProps {
  children: JSX.Element;
  onClick?: () => void;
  class?: string;
}

export const CardAction: Component<CardActionProps> = (props) => {
  return (
    <div
      class={cn(
        "cursor-pointer hover:opacity-80 transition-opacity",
        props.class,
      )}
      onClick={props.onClick}
    >
      {props.children}
    </div>
  );
};
