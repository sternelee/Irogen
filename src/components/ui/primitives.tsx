/**
 * Primitives - Basic UI components
 *
 * These are simple components that don't have separate files yet.
 * Components that have been migrated to separate files should be imported directly:
 * - Button from "./ui/button"
 * - Card from "./ui/card"
 * - Dialog from "./ui/dialog"
 * - Select from "./ui/select"
 * - Switch from "./ui/switch"
 * - Alert from "./ui/alert"
 * - Badge from "./ui/badge"
 * - Label from "./ui/label"
 * - Combobox from "./ui/combobox"
 */

import { splitProps, type ParentComponent } from "solid-js";
import type { JSX } from "solid-js";
import { cn } from "~/lib/utils";

// ============================================================================
// Input
// ============================================================================

type InputBaseProps = {
  class?: string;
  variant?: "default" | "ghost";
};

export type InputProps = JSX.InputHTMLAttributes<HTMLInputElement> & InputBaseProps;

const inputVariants = {
  default: [
    "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
    "border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none",
    "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
    "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  ],
  ghost: "bg-transparent outline-none text-sm",
};

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <input
      {...rest}
      class={cn(
        ...inputVariants[local.variant ?? "default"],
        local.class,
      )}
    />
  );
}

// ============================================================================
// Textarea
// ============================================================================

export type TextareaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> &
  InputBaseProps;

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <textarea
      {...rest}
      class={cn(
        "min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-[color,box-shadow] outline-none",
        local.class,
      )}
    />
  );
}

// ============================================================================
// Spinner
// ============================================================================

type SpinnerSize = "xs" | "sm" | "md" | "lg";
const spinnerSizeClasses: Record<SpinnerSize, string> = {
  xs: "h-3 w-3 border",
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-7 w-7 border-[3px]",
};

export function Spinner(props: { class?: string; size?: SpinnerSize }) {
  return (
    <span
      class={cn(
        "inline-block animate-spin rounded-full border-current border-t-transparent",
        spinnerSizeClasses[props.size ?? "md"],
        props.class,
      )}
    />
  );
}

// ============================================================================
// Kbd
// ============================================================================

export const Kbd: ParentComponent<{ class?: string }> = (props) => (
  <kbd
    class={cn(
      "inline-flex min-h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 text-[10px] font-semibold",
      props.class,
    )}
  >
    {props.children}
  </kbd>
);

// ============================================================================
// Card Components - re-export from card module
// ============================================================================

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./card"
export const CardBody: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("px-6", props.class)}>{props.children}</div>
);
export const CardActions: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("flex flex-wrap items-center gap-2 mt-auto pt-4", props.class)}>
    {props.children}
  </div>
);

// ============================================================================
// Dialog Components - re-export from dialog module
// ============================================================================

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./dialog"
export type DialogProps = {
  open: boolean;
  onClose?: () => void;
  class?: string;
  contentClass?: string;
  showCloseButton?: boolean;
  children: JSX.Element;
};

// ============================================================================
// Label
// ============================================================================

export const Label: ParentComponent<{ class?: string; for?: string }> = (
  props,
) => (
  <label for={props.for} class={cn("text-sm font-medium text-foreground", props.class)}>
    {props.children}
  </label>
);

// ============================================================================
// Re-export from other UI modules for backward compatibility
// ============================================================================

export { Button, buttonVariants } from "./button"
export { Alert, AlertTitle, AlertDescription } from "./alert"
export { Badge, badgeVariants } from "./badge"
// Card already exported above
export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectLabel, SelectDescription, SelectErrorMessage } from "./select"
export { Switch, SwitchControl, SwitchThumb, SwitchLabel, SwitchDescription, SwitchErrorMessage } from "./switch"
export { Label as LabelComponent } from "./label"
export { Combobox, ComboboxItem, ComboboxItemLabel, ComboboxItemIndicator, ComboboxSection, ComboboxControl, ComboboxInput, ComboboxContent, ComboboxTrigger } from "./combobox"
