import type { JSX, ValidComponent, Component } from "solid-js";
import { Show, splitProps, createSignal, createEffect } from "solid-js";

import * as ComboboxPrimitive from "@kobalte/core/combobox";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";

import { cn } from "~/lib/utils";

// Type for items
type ComboboxItem = {
  value: string;
  label?: string;
};

// Kobalte combobox wrapper for backward compatibility
type LegacyComboboxProps = {
  value?: string;
  onChange?: (value: string) => void;
  onInputChange?: (value: string) => void;
  items?: ComboboxItem[];
  placeholder?: string;
  class?: string;
};

const LegacyCombobox: Component<LegacyComboboxProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "class",
    "value",
    "onChange",
    "onInputChange",
    "items",
    "placeholder",
  ]);

  const [isOpen, setIsOpen] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);
  const [suppressAutoOpen, setSuppressAutoOpen] = createSignal(false);
  const hasExactOptionMatch = (value: string) =>
    (local.items || []).some((item) => item.value === value);

  createEffect(() => {
    const hasItems = (local.items?.length || 0) > 0;
    const input = local.value || "";
    const hasInput = input.trim().length > 0;
    const exactMatch = hasExactOptionMatch(input);

    if (exactMatch) {
      setIsOpen(false);
      return;
    }

    if (isFocused() && hasInput && hasItems && !suppressAutoOpen()) {
      setIsOpen(true);
    }
  });

  return (
    <ComboboxPrimitive.Root
      class={cn("relative", local.class)}
      options={local.items || []}
      optionValue="value"
      optionLabel={(option) => option.value}
      optionTextValue={(option) => option.value}
      open={isOpen()}
      defaultFilter="contains"
      triggerMode="input"
      onOpenChange={(open) => setIsOpen(open)}
      onInputChange={(value) => {
        const exactMatch = hasExactOptionMatch(value);
        setSuppressAutoOpen(exactMatch);
        local.onInputChange?.(value);
        if (exactMatch) {
          setIsOpen(false);
          return;
        }
        if (value.trim().length > 0) {
          setIsOpen(true);
        }
      }}
      onChange={(value) => {
        const next = value?.value || "";
        setSuppressAutoOpen(true);
        local.onInputChange?.(next);
        local.onChange?.(next);
        setIsOpen(false);
      }}
      itemComponent={(props) => (
        <ComboboxPrimitive.Item
          item={props.item}
          class="relative flex cursor-default select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50"
        >
          <ComboboxPrimitive.ItemLabel>
            {props.item.rawValue.label || props.item.rawValue.value}
          </ComboboxPrimitive.ItemLabel>
        </ComboboxPrimitive.Item>
      )}
    >
      <ComboboxPrimitive.HiddenSelect />
      <ComboboxPrimitive.Control class="flex h-10 items-center rounded-md border border-input bg-transparent">
        <ComboboxPrimitive.Input
          placeholder={local.placeholder}
          onInput={(e) => local.onChange?.(e.currentTarget.value)}
          onFocus={() => {
            setIsFocused(true);
            const input = local.value || "";
            if ((local.items?.length || 0) > 0 && !hasExactOptionMatch(input)) {
              setIsOpen(true);
            }
          }}
          onBlur={() => setIsFocused(false)}
          class="flex size-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 ml-3"
          {...rest}
        />
        <ComboboxPrimitive.Trigger class="size-3 opacity-50 inline-flex items-center justify-center">
          <ComboboxPrimitive.Icon>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-4"
            >
              <path d="M8 9l4 -4l4 4" />
              <path d="M16 15l-4 4l-4 -4" />
            </svg>
          </ComboboxPrimitive.Icon>
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.Control>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Content class="relative z-[1000] min-w-32 max-h-[min(40vh,18rem)] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-base-100 text-popover-foreground shadow-lg animate-in fade-in-80">
          <ComboboxPrimitive.Listbox class="m-0 p-1" />
        </ComboboxPrimitive.Content>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
};

const Combobox = LegacyCombobox;
const ComboboxItemLabel = ComboboxPrimitive.ItemLabel;
const ComboboxHiddenSelect = ComboboxPrimitive.HiddenSelect;

type ComboboxItemProps<T extends ValidComponent = "li"> =
  ComboboxPrimitive.ComboboxItemProps<T> & {
    class?: string | undefined;
  };

const ComboboxItem = <T extends ValidComponent = "li">(
  props: PolymorphicProps<T, ComboboxItemProps<T>>,
) => {
  const [local, others] = splitProps(props as ComboboxItemProps, ["class"]);
  return (
    <ComboboxPrimitive.Item
      class={cn(
        "relative flex cursor-default select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
};

type ComboboxItemIndicatorProps<T extends ValidComponent = "div"> =
  ComboboxPrimitive.ComboboxItemIndicatorProps<T> & {
    children?: JSX.Element;
  };

const ComboboxItemIndicator = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ComboboxItemIndicatorProps<T>>,
) => {
  const [local, others] = splitProps(props as ComboboxItemIndicatorProps, [
    "children",
  ]);
  return (
    <ComboboxPrimitive.ItemIndicator {...others}>
      <Show
        when={local.children}
        fallback={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-4"
          >
            <path d="M5 12l5 5l10 -10" />
          </svg>
        }
      >
        {(children) => children()}
      </Show>
    </ComboboxPrimitive.ItemIndicator>
  );
};

type ComboboxSectionProps<T extends ValidComponent = "li"> =
  ComboboxPrimitive.ComboboxSectionProps<T> & { class?: string | undefined };

const ComboboxSection = <T extends ValidComponent = "li">(
  props: PolymorphicProps<T, ComboboxSectionProps<T>>,
) => {
  const [local, others] = splitProps(props as ComboboxSectionProps, ["class"]);
  return (
    <ComboboxPrimitive.Section
      class={cn(
        "overflow-hidden p-1 px-2 py-1.5 text-xs font-medium text-muted-foreground ",
        local.class,
      )}
      {...others}
    />
  );
};

type ComboboxControlProps<
  U,
  T extends ValidComponent = "div",
> = ComboboxPrimitive.ComboboxControlProps<U, T> & {
  class?: string | undefined;
};

const ComboboxControl = <T, U extends ValidComponent = "div">(
  props: PolymorphicProps<U, ComboboxControlProps<T>>,
) => {
  const [local, others] = splitProps(props as ComboboxControlProps<T>, [
    "class",
  ]);
  return (
    <ComboboxPrimitive.Control
      class={cn("flex h-10 items-center rounded-md border px-3", local.class)}
      {...others}
    />
  );
};

type ComboboxInputProps<T extends ValidComponent = "input"> =
  ComboboxPrimitive.ComboboxInputProps<T> & { class?: string | undefined };

const ComboboxInput = <T extends ValidComponent = "input">(
  props: PolymorphicProps<T, ComboboxInputProps<T>>,
) => {
  const [local, others] = splitProps(props as ComboboxInputProps, ["class"]);
  return (
    <ComboboxPrimitive.Input
      class={cn(
        "flex size-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
};

type ComboboxTriggerProps<T extends ValidComponent = "button"> =
  ComboboxPrimitive.ComboboxTriggerProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

const ComboboxTrigger = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, ComboboxTriggerProps<T>>,
) => {
  const [local, others] = splitProps(props as ComboboxTriggerProps, [
    "class",
    "children",
  ]);
  return (
    <ComboboxPrimitive.Trigger
      class={cn("size-4 opacity-50", local.class)}
      {...others}
    >
      <ComboboxPrimitive.Icon>
        <Show
          when={local.children}
          fallback={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-4"
            >
              <path d="M8 9l4 -4l4 4" />
              <path d="M16 15l-4 4l-4 -4" />
            </svg>
          }
        >
          {(children) => children()}
        </Show>
      </ComboboxPrimitive.Icon>
    </ComboboxPrimitive.Trigger>
  );
};

type ComboboxContentProps<T extends ValidComponent = "div"> =
  ComboboxPrimitive.ComboboxContentProps<T> & { class?: string | undefined };

const ComboboxContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ComboboxContentProps<T>>,
) => {
  const [local, others] = splitProps(props as ComboboxContentProps, ["class"]);
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Content
        class={cn(
          "relative z-[1000] min-w-32 max-h-[min(40vh,18rem)] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-base-100 text-popover-foreground shadow-lg animate-in fade-in-80",
          local.class,
        )}
        {...others}
      >
        <ComboboxPrimitive.Listbox class="m-0 p-1" />
      </ComboboxPrimitive.Content>
    </ComboboxPrimitive.Portal>
  );
};

export {
  Combobox,
  ComboboxItem,
  ComboboxItemLabel,
  ComboboxItemIndicator,
  ComboboxSection,
  ComboboxControl,
  ComboboxTrigger,
  ComboboxInput,
  ComboboxHiddenSelect,
  ComboboxContent,
};
