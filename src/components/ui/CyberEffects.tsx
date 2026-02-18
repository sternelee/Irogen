import { For, Show } from "solid-js";
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Dialog,
  Input,
  Select,
  Switch,
} from "./primitives";

export function NetworkIndicator(props: {
  strength: number;
  connected: boolean;
  class?: string;
}) {
  const getBars = () => {
    const bars = [];
    for (let i = 1; i <= 4; i++) {
      bars.push({
        height: `${i * 25}%`,
        active: props.connected && i <= props.strength,
      });
    }
    return bars;
  };

  return (
    <div class={`network-indicator ${props.class || ""}`}>
      <For each={getBars()}>
        {(bar) => (
          <div
            class="network-bar"
            classList={{
              "text-primary": bar.active,
              "text-base-300 opacity-40": !bar.active,
            }}
            style={{ height: bar.height }}
          />
        )}
      </For>
    </div>
  );
}

export function ModernButton(props: {
  children: any;
  onClick?: () => void;
  variant?:
    | "primary"
    | "secondary"
    | "accent"
    | "ghost"
    | "outline"
    | "neutral";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  disabled?: boolean;
  class?: string;
}) {
  const variant = () => {
    if (props.variant === "accent") return "secondary";
    if (props.variant === "neutral") return "outline";
    return (props.variant ?? "primary") as
      | "primary"
      | "secondary"
      | "ghost"
      | "outline";
  };

  const size = () => {
    if (props.size === "xl") return "lg";
    return (props.size ?? "md") as "xs" | "sm" | "md" | "lg";
  };

  return (
    <Button
      variant={variant()}
      size={size()}
      class={props.class}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </Button>
  );
}

export function ModernInput(props: {
  value?: string;
  onInput?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "email" | "search";
  disabled?: boolean;
  class?: string;
}) {
  return (
    <Input
      type={props.type || "text"}
      class={props.class}
      value={props.value || ""}
      onInput={(e) => props.onInput?.(e.currentTarget.value)}
      placeholder={props.placeholder}
      disabled={props.disabled}
    />
  );
}

export function ModernCard(props: {
  children: any;
  title?: string;
  class?: string;
  variant?: "bordered" | "compact";
}) {
  return (
    <Card
      class={`${props.variant === "compact" ? "shadow-none" : "shadow-xl"} ${props.class || ""}`}
    >
      <CardBody class={props.variant === "compact" ? "p-4" : "p-6"}>
        <Show when={props.title}>
          <CardTitle>{props.title}</CardTitle>
        </Show>
        {props.children}
      </CardBody>
    </Card>
  );
}

export function ModernModal(props: {
  children: any;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}) {
  return (
    <Dialog open={props.isOpen} onClose={props.onClose}>
      <Show when={props.title}>
        <h3 class="text-lg font-bold">{props.title}</h3>
      </Show>
      <div class="py-4">{props.children}</div>
      <div class="mt-2 flex justify-end">
        <ModernButton variant="ghost" onClick={props.onClose}>
          关闭
        </ModernButton>
      </div>
    </Dialog>
  );
}

export function ModernSelect(props: {
  value?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  class?: string;
}) {
  return (
    <Select
      class={props.class}
      value={props.value}
      onChange={(val) => props.onChange?.(val)}
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

export function ModernToggle(props: {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  class?: string;
}) {
  return (
    <Switch
      class={props.class}
      label={props.label}
      checked={props.checked}
      onChange={props.onChange}
    />
  );
}

export function SubtleBackground() {
  return <div class="fixed inset-0 pointer-events-none z-0 bg-base-100" />;
}

export function ModernBackground() {
  return <SubtleBackground />;
}

export const CyberBackground = ModernBackground;
