import { JSX, Show } from "solid-js";
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardBody,
  CardTitle,
  Dialog,
  Input,
  Select,
  Spinner,
  Switch,
} from "./primitives";
import { cn } from "~/lib/utils";

export interface SimpleButtonProps {
  variant?: "primary" | "secondary" | "accent" | "ghost" | "error" | "warning";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  class?: string;
  children: JSX.Element;
}

export function SimpleButton(props: SimpleButtonProps) {
  const mappedVariant =
    props.variant === "error"
      ? "destructive"
      : props.variant === "warning"
        ? "warning"
        : props.variant === "accent"
          ? "secondary"
          : props.variant ?? "primary";

  return (
    <Button
      variant={mappedVariant}
      size={props.size ?? "md"}
      loading={props.loading}
      disabled={props.disabled}
      onClick={props.onClick}
      class={props.class}
    >
      {props.children}
    </Button>
  );
}

export const CyberButton = SimpleButton;

export interface SimpleInputProps {
  type?: "text" | "password" | "email" | "url";
  placeholder?: string;
  value?: string;
  onInput?: (value: string) => void;
  disabled?: boolean;
  error?: string;
  success?: string;
  class?: string;
}

export function SimpleInput(props: SimpleInputProps) {
  return (
    <div class="w-full space-y-1.5">
      <Input
        type={props.type || "text"}
        placeholder={props.placeholder}
        value={props.value || ""}
        onInput={(e) => props.onInput?.(e.currentTarget.value)}
        disabled={props.disabled}
        class={props.class}
      />
      <Show when={props.error}>
        <p class="text-xs text-error">{props.error}</p>
      </Show>
      <Show when={props.success}>
        <p class="text-xs text-success">{props.success}</p>
      </Show>
    </div>
  );
}

export const CyberInput = SimpleInput;

export interface SimpleCardProps {
  title?: string;
  subtitle?: string;
  children: JSX.Element;
  actions?: JSX.Element;
  class?: string;
}

export function SimpleCard(props: SimpleCardProps) {
  return (
    <Card class={cn("bg-base-100 shadow-md", props.class)}>
      <CardBody>
        <Show when={props.title}>
          <CardTitle>{props.title}</CardTitle>
        </Show>
        <Show when={props.subtitle}>
          <p class="text-sm text-base-content opacity-70">{props.subtitle}</p>
        </Show>
        <div class="mt-4">{props.children}</div>
        <Show when={props.actions}>
          <CardActions class="justify-end">{props.actions}</CardActions>
        </Show>
      </CardBody>
    </Card>
  );
}

export const CyberCard = SimpleCard;

export interface SimpleSelectProps {
  options: { value: string; label: string }[];
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  class?: string;
}

export function SimpleSelect(props: SimpleSelectProps) {
  return (
    <Select
      value={props.value || ""}
      onChange={(val) => props.onChange?.(val)}
      disabled={props.disabled}
      class={props.class}
    >
      <Show when={props.placeholder}>
        <option disabled value="">
          {props.placeholder}
        </option>
      </Show>
      {props.options.map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </Select>
  );
}

export const CyberSelect = SimpleSelect;

export interface SimpleToggleProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  class?: string;
}

export function SimpleToggle(props: SimpleToggleProps) {
  return (
    <Switch
      class={props.class}
      checked={props.checked || false}
      onChange={props.onChange}
      disabled={props.disabled}
      label={props.label}
    />
  );
}

export const CyberToggle = SimpleToggle;

export interface SimpleProgressProps {
  value: number;
  label?: string;
  color?: "primary" | "secondary" | "accent" | "success" | "warning" | "error";
  class?: string;
}

export function SimpleProgress(props: SimpleProgressProps) {
  const getColor = () => {
    switch (props.color) {
      case "secondary":
      case "accent":
        return "text-secondary";
      case "success":
        return "text-success";
      case "warning":
        return "text-warning";
      case "error":
        return "text-error";
      default:
        return "text-primary";
    }
  };

  return (
    <div class={props.class}>
      <Show when={props.label}>
        <div class="mb-1 flex justify-between text-sm">
          <span>{props.label}</span>
          <span>{props.value}%</span>
        </div>
      </Show>
      <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          class={cn("h-full transition-all", getColor(), "bg-current")}
          style={{ width: `${Math.max(0, Math.min(100, props.value))}%` }}
        />
      </div>
    </div>
  );
}

export const CyberProgress = SimpleProgress;

export interface SimpleAlertProps {
  type: "info" | "success" | "warning" | "error";
  message: string;
  class?: string;
}

export function SimpleAlert(props: SimpleAlertProps) {
  return (
    <Alert variant={props.type} class={props.class}>
      <span>{props.message}</span>
    </Alert>
  );
}

export const CyberAlert = SimpleAlert;

export interface SimpleSpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  class?: string;
}

export function SimpleSpinner(props: SimpleSpinnerProps) {
  return (
    <div class={cn("flex items-center gap-3", props.class)}>
      <Spinner size={props.size || "md"} class="text-primary" />
      <Show when={props.label}>
        <span>{props.label}</span>
      </Show>
    </div>
  );
}

export const CyberSpinner = SimpleSpinner;

export interface SimpleModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
  actions?: JSX.Element;
  size?: "sm" | "md" | "lg" | "xl";
  class?: string;
}

export function SimpleModal(props: SimpleModalProps) {
  const sizeClass = () => {
    switch (props.size) {
      case "sm":
        return "max-w-sm";
      case "lg":
        return "max-w-lg";
      case "xl":
        return "max-w-xl";
      default:
        return "max-w-md";
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} contentClass={cn(sizeClass(), props.class)}>
      <div class="mb-4 flex items-center justify-between">
        <Show when={props.title}>
          <h3 class="text-lg font-bold">{props.title}</h3>
        </Show>
        <Button variant="ghost" size="icon" class="h-8 w-8" onClick={props.onClose}>
          ✕
        </Button>
      </div>
      <div class="py-2">{props.children}</div>
      <Show when={props.actions}>
        <div class="mt-4 flex justify-end gap-2">{props.actions}</div>
      </Show>
    </Dialog>
  );
}

export const CyberModal = SimpleModal;
