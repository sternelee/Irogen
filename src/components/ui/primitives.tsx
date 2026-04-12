/**
 * Primitives - DaisyUI-based UI components
 *
 * All components use DaisyUI classes for styling.
 */

import { type ParentComponent, type JSX, Show, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

// ============================================================================
// Button
// ============================================================================

type ButtonVariant = "primary" | "secondary" | "accent" | "ghost" | "link" | "outline" | "error" | "success" | "warning" | "info" | "default" | "destructive";
type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

interface ButtonProps {
  type?: "button" | "submit" | "reset";
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  disabled?: boolean;
  loading?: boolean;
  children?: JSX.Element;
  onClick?: (e: MouseEvent) => void;
  title?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "btn-primary",
  primary: "btn-primary",
  secondary: "btn-secondary",
  accent: "btn-accent",
  ghost: "btn-ghost hover:bg-base-content/10",
  link: "btn-link",
  outline: "btn-outline hover:bg-base-content/5",
  error: "btn-error",
  success: "btn-success",
  warning: "btn-warning",
  info: "btn-info",
  destructive: "btn-error",
};

const sizeClasses: Record<ButtonSize, string> = {
  xs: "btn-xs",
  sm: "btn-sm",
  md: "btn-md",
  lg: "btn-lg",
  icon: "btn-square",
};

export const Button = (props: ButtonProps) => {
  const variant = () => props.variant || "default";
  const size = () => props.size || "md";

  return (
    <button
      type={props.type || "button"}
      class={cn(
        "btn rounded-lg",
        "transition-all duration-200 ease-out",
        "hover:scale-[1.02] hover:shadow-md",
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-base-100",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none",
        variantClasses[variant()],
        sizeClasses[size()],
        props.class
      )}
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
      title={props.title}
    >
      <Show when={props.loading}>
        <span class="loading loading-spinner loading-sm mr-2" />
      </Show>
      {props.children}
    </button>
  );
};

export const buttonVariants = (variant?: ButtonVariant, size?: ButtonSize) => {
  return cn(
    "btn rounded-lg transition-all duration-200 ease-out",
    variant ? variantClasses[variant] : "btn-primary",
    size ? sizeClasses[size] : ""
  );
};

export type { ButtonProps };

// ============================================================================
// Input
// ============================================================================

export type InputProps = JSX.InputHTMLAttributes<HTMLInputElement> & {
  class?: string;
  error?: boolean;
};

export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ["class", "error"]);
  return (
    <input
      {...rest}
      class={cn(
        "input input-bordered w-full",
        "transition-all duration-200",
        "hover:border-primary/50",
        "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
        "placeholder:text-base-content/40 placeholder:font-normal",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        local.error && "input-error border-error",
        local.class
      )}
    />
  );
}

// ============================================================================
// Textarea
// ============================================================================

export type TextareaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  class?: string;
  error?: boolean;
};

export function Textarea(props: TextareaProps) {
  const [local, rest] = splitProps(props, ["class", "error"]);
  return (
    <textarea
      {...rest}
      class={cn(
        "textarea textarea-bordered w-full",
        "transition-all duration-200",
        "hover:border-primary/50",
        "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
        "placeholder:text-base-content/40 placeholder:font-normal",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        local.error && "textarea-error border-error",
        local.class
      )}
    />
  );
}

// ============================================================================
// Label
// ============================================================================

export const Label: ParentComponent<{ class?: string; for?: string }> = (props) => {
  return (
    <label
      for={props.for}
      class={cn("label", props.class)}
    >
      <span class="label-text">{props.children}</span>
    </label>
  );
};

// ============================================================================
// Badge
// ============================================================================

type BadgeVariant = "primary" | "secondary" | "accent" | "ghost" | "info" | "success" | "warning" | "error" | "default" | "neutral" | "outline";

const badgeClasses: Record<BadgeVariant, string> = {
  default: "badge-primary",
  neutral: "badge-neutral",
  primary: "badge-primary",
  secondary: "badge-secondary",
  accent: "badge-accent",
  ghost: "badge-ghost",
  info: "badge-info",
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  outline: "badge-outline",
};

export const Badge: ParentComponent<{ variant?: BadgeVariant; class?: string }> = (props) => {
  const variant = () => props.variant || "primary";
  return (
    <div class={cn("badge", badgeClasses[variant()], props.class)}>
      {props.children}
    </div>
  );
};

export const badgeVariants = (variant?: BadgeVariant) => {
  return cn("badge", variant ? badgeClasses[variant] : "badge-primary");
};

// ============================================================================
// Alert
// ============================================================================

type AlertVariant = "info" | "success" | "warning" | "error" | "destructive";

const alertClasses: Record<AlertVariant, string> = {
  info: "alert-info",
  success: "alert-success",
  warning: "alert-warning",
  error: "alert-error",
  destructive: "alert-error",
};

export const Alert: ParentComponent<{ variant?: AlertVariant; class?: string; classList?: Record<string, boolean>; style?: Record<string, string> }> = (props) => {
  const variant = () => props.variant || "info";
  return (
    <div class={cn("alert", alertClasses[variant()], props.class, props.classList)} style={props.style}>
      {props.children}
    </div>
  );
};

export const AlertTitle: ParentComponent<{ class?: string }> = (props) => (
  <span class={cn("font-bold", props.class)}>{props.children}</span>
);

export const AlertDescription: ParentComponent<{ class?: string }> = (props) => (
  <span class={cn("text-sm", props.class)}>{props.children}</span>
);

// ============================================================================
// Card
// ============================================================================

export const Card: ParentComponent<{ class?: string; onClick?: () => void }> = (props) => (
  <div class={cn("card bg-base-100 shadow-xl", props.class)} onClick={props.onClick}>
    {props.children}
  </div>
);

export const CardHeader: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("card-body", props.class)}>
    {props.children}
  </div>
);

export const CardTitle: ParentComponent<{ class?: string }> = (props) => (
  <h3 class={cn("card-title", props.class)}>{props.children}</h3>
);

export const CardDescription: ParentComponent<{ class?: string }> = (props) => (
  <p class={cn("text-sm text-base-content/60", props.class)}>{props.children}</p>
);

export const CardContent: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("px-6 py-2", props.class)}>{props.children}</div>
);

export const CardFooter: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("card-actions justify-end px-6 py-4", props.class)}>
    {props.children}
  </div>
);

export const CardBody: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("px-6", props.class)}>{props.children}</div>
);

export const CardActions: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("flex flex-wrap items-center gap-2 mt-auto pt-4", props.class)}>
    {props.children}
  </div>
);

// ============================================================================
// Dialog (Modal) - DaisyUI Pattern
// ============================================================================

// Import from dialog.tsx which uses native DaisyUI pattern
export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./dialog";

export type DialogProps = {
  open: boolean;
  onClose?: () => void;
  class?: string;
  contentClass?: string;
  children: JSX.Element;
};

// ============================================================================
// Select
// ============================================================================

interface SelectProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  class?: string;
  children?: JSX.Element;
  disabled?: boolean;
}

export function Select(props: SelectProps) {
  return (
    <select
      id={props.id}
      class={cn("select select-bordered w-full", props.class)}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange?.(e.currentTarget.value)}
    >
      {props.children}
    </select>
  );
}

export const SelectValue: ParentComponent<{ class?: string }> = (props) => (
  <span class={props.class}>{props.children}</span>
);
export const SelectTrigger: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("select select-bordered w-full", props.class)}>{props.children}</div>
);
export const SelectContent: ParentComponent<{ class?: string }> = (props) => (
  <div class={props.class}>{props.children}</div>
);
export const SelectItem: ParentComponent<{ value: string; class?: string }> = (props) => (
  <option value={props.value} class={props.class}>{props.children}</option>
);
export const SelectLabel: ParentComponent<{ class?: string }> = (props) => (
  <option disabled class={props.class}>{props.children}</option>
);
export const SelectDescription: ParentComponent<{ class?: string }> = (props) => (
  <span class={props.class}>{props.children}</span>
);
export const SelectErrorMessage: ParentComponent<{ class?: string }> = (props) => (
  <span class={cn("text-error text-xs", props.class)}>{props.children}</span>
);

// ============================================================================
// Switch (Toggle)
// ============================================================================

interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  class?: string;
  disabled?: boolean;
  label?: string;
}

export function Switch(props: SwitchProps) {
  return (
    <input
      type="checkbox"
      class={cn("toggle", props.class)}
      checked={props.checked}
      disabled={props.disabled}
      onChange={(e) => props.onChange?.(e.currentTarget.checked)}
    />
  );
}

export const SwitchControl: ParentComponent<{ class?: string }> = (props) => (
  <div class={cn("toggle", props.class)}>{props.children}</div>
);
export const SwitchThumb: ParentComponent<{ class?: string }> = (props) => (
  <span class={props.class}>{props.children}</span>
);
export const SwitchLabel: ParentComponent<{ class?: string }> = (props) => (
  <span class={cn("label", props.class)}>{props.children}</span>
);
export const SwitchDescription: ParentComponent<{ class?: string }> = (props) => (
  <span class={props.class}>{props.children}</span>
);
export const SwitchErrorMessage: ParentComponent<{ class?: string }> = (props) => (
  <span class={cn("text-error text-xs", props.class)}>{props.children}</span>
);

// ============================================================================
// Spinner
// ============================================================================

type SpinnerSize = "xs" | "sm" | "md" | "lg";
const spinnerSizeClasses: Record<SpinnerSize, string> = {
  xs: "loading-xs",
  sm: "loading-sm",
  md: "loading-md",
  lg: "loading-lg",
};

export function Spinner(props: { class?: string; size?: SpinnerSize }) {
  return (
    <span
      class={cn("loading loading-spinner", spinnerSizeClasses[props.size ?? "md"], props.class)}
    />
  );
}

// ============================================================================
// Kbd
// ============================================================================

export const Kbd: ParentComponent<{ class?: string }> = (props) => (
  <kbd
    class={cn("kbd", props.class)}
  >
    {props.children}
  </kbd>
);

// ============================================================================
// Combobox (keep shadcnUI style)
// ============================================================================

export { Combobox, ComboboxItem, ComboboxItemLabel, ComboboxItemIndicator, ComboboxSection, ComboboxControl, ComboboxInput, ComboboxContent, ComboboxTrigger } from "./combobox"
